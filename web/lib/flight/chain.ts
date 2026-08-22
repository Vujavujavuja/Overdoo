import {
  createPublicClient,
  createWalletClient,
  defineChain,
  encodePacked,
  http,
  keccak256,
  type Hex,
} from "viem";
import { privateKeyToAccount } from "viem/accounts";

// testnet-rpc.monad.xyz throttles hard and returns the refusal as a JSON-RPC
// error inside a 200, which viem's retry does not catch. Ankr allows 300 req
// per 10s and is the safer default for a live demo.
export const RPC =
  process.env.MONAD_RPC_URL ?? "https://rpc.ankr.com/monad_testnet";

export const monadTestnet = defineChain({
  id: 10143,
  name: "Monad Testnet",
  nativeCurrency: { name: "MON", symbol: "MON", decimals: 18 },
  rpcUrls: { default: { http: [RPC] } },
  blockExplorers: {
    default: { name: "MonadVision", url: "https://testnet.monadvision.com" },
  },
});

const transport = () => http(RPC, { retryCount: 5, retryDelay: 400, timeout: 30_000 });

export const publicClient = createPublicClient({
  chain: monadTestnet,
  transport: transport(),
});

const hex = (k: string): Hex => (k.startsWith("0x") ? k : `0x${k}`) as Hex;

export function opsWallet() {
  const key = process.env.DEPLOYER_PRIVATE_KEY;
  if (!key) throw new Error("DEPLOYER_PRIVATE_KEY not set");
  return createWalletClient({
    account: privateKeyToAccount(hex(key)),
    chain: monadTestnet,
    transport: transport(),
  });
}

export function attestorAccount() {
  const key = process.env.ATTESTOR_A_PRIVATE_KEY;
  if (!key) throw new Error("ATTESTOR_A_PRIVATE_KEY not set");
  return privateKeyToAccount(hex(key));
}

export const FLIGHT_ORACLE = (process.env.FLIGHT_ORACLE_ADDRESS ??
  "0xecEb2252024D77512d38bfcF4141658Ea12BC872") as Hex;

export function flightKeyHash(
  carrier: string,
  flightNumber: string,
  scheduledDeparture: Date,
): Hex {
  return keccak256(
    encodePacked(
      ["string", "string", "uint64"],
      [
        carrier.toUpperCase(),
        flightNumber,
        BigInt(Math.floor(scheduledDeparture.getTime() / 1000)),
      ],
    ),
  );
}

export const ATTESTATION_TYPES = {
  Attestation: [
    { name: "flightKey", type: "bytes32" },
    { name: "scheduledArrival", type: "uint64" },
    { name: "actualArrival", type: "uint64" },
    { name: "delayMinutes", type: "uint32" },
    { name: "status", type: "uint8" },
    { name: "distanceKm", type: "uint32" },
    { name: "attestedAt", type: "uint64" },
  ],
} as const;

export function domain() {
  return {
    name: "Aeroclaim",
    version: "1",
    chainId: monadTestnet.id,
    verifyingContract: FLIGHT_ORACLE,
  } as const;
}
