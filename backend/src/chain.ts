import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  createPublicClient,
  createWalletClient,
  defineChain,
  http,
  type Address,
  type Hex,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from './config.js';
import {
  capitalPoolAbi,
  claimRegistryAbi,
  claimUSDAbi,
  flightOracleAbi,
  settlementAbi,
} from './abis.js';

export const monadTestnet = defineChain({
  id: 10143,
  name: 'Monad Testnet',
  nativeCurrency: { name: 'MON', symbol: 'MON', decimals: 18 },
  rpcUrls: { default: { http: [config.rpcUrl] } },
  blockExplorers: {
    default: { name: 'MonadVision', url: 'https://testnet.monadvision.com' },
  },
});

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../..');

export interface Deployments {
  chainId: number;
  ClaimUSD: Address;
  FlightOracle: Address;
  CapitalPool: Address;
  ClaimRegistry: Address;
  Settlement: Address;
  ops: Address;
  attestorA: Address;
  attestorB: Address;
}

export function deployments(): Deployments {
  const path = resolve(root, 'deployments.json');
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    throw new Error(
      `deployments.json not found at ${path}. Run the Foundry deploy script first.`,
    );
  }
}

export const addresses = deployments();

export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: http(config.rpcUrl),
});

function withPrefix(key: string): Hex {
  return (key.startsWith('0x') ? key : `0x${key}`) as Hex;
}

export const opsAccount = config.deployerKey
  ? privateKeyToAccount(withPrefix(config.deployerKey))
  : null;

export const walletClient = opsAccount
  ? createWalletClient({ account: opsAccount, chain: monadTestnet, transport: http(config.rpcUrl) })
  : null;

/**
 * Refuse to run against the wrong network. Deploying claim capital to a chain
 * that merely answers on the same RPC shape is a silent, expensive failure.
 */
export async function assertChain(): Promise<void> {
  const id = await publicClient.getChainId();
  if (id !== config.chainId) {
    throw new Error(`RPC reports chainId ${id}, expected ${config.chainId}. Refusing to start.`);
  }
  if (addresses.chainId !== config.chainId) {
    throw new Error(
      `deployments.json is for chainId ${addresses.chainId}, expected ${config.chainId}.`,
    );
  }
}

export const contracts = {
  cusd: { address: addresses.ClaimUSD, abi: claimUSDAbi } as const,
  oracle: { address: addresses.FlightOracle, abi: flightOracleAbi } as const,
  pool: { address: addresses.CapitalPool, abi: capitalPoolAbi } as const,
  registry: { address: addresses.ClaimRegistry, abi: claimRegistryAbi } as const,
  settlement: { address: addresses.Settlement, abi: settlementAbi } as const,
};

function requireWallet() {
  if (!walletClient || !opsAccount) {
    throw new Error('DEPLOYER_PRIVATE_KEY not set; backend cannot send transactions.');
  }
  return { walletClient, opsAccount };
}

// ---------------------------------------------------------------- reads

export async function isAttested(flightKey: Hex): Promise<boolean> {
  return publicClient.readContract({
    ...contracts.oracle,
    functionName: 'isAttested',
    args: [flightKey],
  }) as Promise<boolean>;
}

export async function poolState() {
  const [idle, deployed, totalAssets, sharePrice, totalShares] = await Promise.all([
    publicClient.readContract({ ...contracts.pool, functionName: 'idle' }),
    publicClient.readContract({ ...contracts.pool, functionName: 'deployed' }),
    publicClient.readContract({ ...contracts.pool, functionName: 'totalAssets' }),
    publicClient.readContract({ ...contracts.pool, functionName: 'sharePrice' }),
    publicClient.readContract({ ...contracts.pool, functionName: 'totalShares' }),
  ]);
  return {
    idle: idle as bigint,
    deployed: deployed as bigint,
    totalAssets: totalAssets as bigint,
    sharePrice: sharePrice as bigint,
    totalShares: totalShares as bigint,
  };
}

export async function registryStats() {
  const [total, recovered, written, outstanding] = (await publicClient.readContract({
    ...contracts.registry,
    functionName: 'stats',
  })) as [bigint, bigint, bigint, bigint];
  return { total, recovered, written, outstanding };
}

export interface OnChainClaim {
  flightKey: Hex;
  passenger: Address;
  statutoryAmount: bigint;
  purchasePrice: bigint;
  recoveredAmount: bigint;
  assignmentHash: Hex;
  status: number;
  purchasedAt: bigint;
  resolvedAt: bigint;
}

export async function getClaim(id: bigint): Promise<OnChainClaim> {
  return publicClient.readContract({
    ...contracts.registry,
    functionName: 'getClaim',
    args: [id],
  }) as Promise<OnChainClaim>;
}

export async function nextClaimId(): Promise<bigint> {
  return publicClient.readContract({
    ...contracts.registry,
    functionName: 'nextId',
  }) as Promise<bigint>;
}

export async function cusdBalance(who: Address): Promise<bigint> {
  return publicClient.readContract({
    ...contracts.cusd,
    functionName: 'balanceOf',
    args: [who],
  }) as Promise<bigint>;
}

// ---------------------------------------------------------------- writes

export async function submitAttestation(
  attestation: {
    flightKey: Hex;
    scheduledArrival: bigint;
    actualArrival: bigint;
    delayMinutes: number;
    status: number;
    distanceKm: number;
    attestedAt: bigint;
  },
  signatures: Hex[],
): Promise<Hex> {
  const { walletClient: wc } = requireWallet();
  const hash = await wc.writeContract({
    ...contracts.oracle,
    functionName: 'attest',
    args: [attestation, signatures],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function purchaseClaim(args: {
  flightKey: Hex;
  passenger: Address;
  statutoryAmount: bigint;
  purchasePrice: bigint;
  assignmentHash: Hex;
}): Promise<{ hash: Hex; claimId: bigint }> {
  const { walletClient: wc } = requireWallet();
  const idBefore = await nextClaimId();
  const hash = await wc.writeContract({
    ...contracts.settlement,
    functionName: 'purchaseClaim',
    args: [
      args.flightKey,
      args.passenger,
      args.statutoryAmount,
      args.purchasePrice,
      args.assignmentHash,
    ],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return { hash, claimId: idBefore };
}

export async function markInPursuit(claimId: bigint): Promise<Hex> {
  const { walletClient: wc } = requireWallet();
  const hash = await wc.writeContract({
    ...contracts.registry,
    functionName: 'markInPursuit',
    args: [claimId],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function settleRecovery(claimId: bigint, recovered: bigint): Promise<Hex> {
  const { walletClient: wc, opsAccount: ops } = requireWallet();
  // Ops must hold and approve the recovered cUSD before Settlement can pull it.
  const allowance = (await publicClient.readContract({
    ...contracts.cusd,
    functionName: 'allowance',
    args: [ops.address, contracts.settlement.address],
  })) as bigint;

  if (allowance < recovered) {
    const approveHash = await wc.writeContract({
      ...contracts.cusd,
      functionName: 'approve',
      args: [contracts.settlement.address, 2n ** 255n],
    });
    await publicClient.waitForTransactionReceipt({ hash: approveHash });
  }

  const hash = await wc.writeContract({
    ...contracts.settlement,
    functionName: 'settleRecovery',
    args: [claimId, recovered],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function settleWriteOff(claimId: bigint): Promise<Hex> {
  const { walletClient: wc } = requireWallet();
  const hash = await wc.writeContract({
    ...contracts.settlement,
    functionName: 'settleWriteOff',
    args: [claimId],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export async function mintCusd(to: Address, amount: bigint): Promise<Hex> {
  const { walletClient: wc } = requireWallet();
  const hash = await wc.writeContract({
    ...contracts.cusd,
    functionName: 'mint',
    args: [to, amount],
  });
  await publicClient.waitForTransactionReceipt({ hash });
  return hash;
}

export const explorerTx = (hash: string) => `https://testnet.monadvision.com/tx/${hash}`;
