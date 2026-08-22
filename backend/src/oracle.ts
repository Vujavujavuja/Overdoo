import { encodePacked, keccak256, type Address, type Hex } from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { config } from './config.js';
import { addresses, monadTestnet, submitAttestation, isAttested } from './chain.js';
import { aeroDataBox } from './providers/aerodatabox.js';
import { aviationStack } from './providers/aviationstack.js';
import { AGREEMENT_WINDOW_MIN, type Consensus } from './providers/index.js';
import type { FlightProvider } from './providers/types.js';

export const EIP712_DOMAIN = {
  name: 'Aeroclaim',
  version: '1',
  chainId: monadTestnet.id,
  verifyingContract: addresses.FlightOracle as Address,
} as const;

export const ATTESTATION_TYPES = {
  Attestation: [
    { name: 'flightKey', type: 'bytes32' },
    { name: 'scheduledArrival', type: 'uint64' },
    { name: 'actualArrival', type: 'uint64' },
    { name: 'delayMinutes', type: 'uint32' },
    { name: 'status', type: 'uint8' },
    { name: 'distanceKm', type: 'uint32' },
    { name: 'attestedAt', type: 'uint64' },
  ],
} as const;

export interface AttestationMessage {
  flightKey: Hex;
  scheduledArrival: bigint;
  actualArrival: bigint;
  delayMinutes: number;
  status: number;
  distanceKm: number;
  attestedAt: bigint;
}

export function flightKeyHash(
  carrier: string,
  flightNumber: string,
  scheduledDeparture: Date,
): Hex {
  return keccak256(
    encodePacked(
      ['string', 'string', 'uint64'],
      [
        carrier.toUpperCase(),
        flightNumber,
        BigInt(Math.floor(scheduledDeparture.getTime() / 1000)),
      ],
    ),
  );
}

export function statusCode(phase: string): number {
  switch (phase) {
    case 'cancelled':
      return 2;
    case 'diverted':
      return 3;
    case 'landed':
    case 'active':
      return 1;
    default:
      return 0;
  }
}

function withPrefix(key: string): Hex {
  return (key.startsWith('0x') ? key : `0x${key}`) as Hex;
}

/**
 * Each attestor is bound to a DIFFERENT provider and independently re-reads it
 * before signing. Signing the same object twice with two keys would satisfy the
 * contract's threshold while providing zero additional information — it is the
 * exact failure the threshold exists to prevent, so the binding is structural
 * here rather than a convention.
 */
interface AttestorBinding {
  label: 'A' | 'B';
  privateKey: string | undefined;
  provider: FlightProvider;
}

function bindings(): AttestorBinding[] {
  return [
    { label: 'A', privateKey: config.attestorAKey, provider: aeroDataBox(config.aeroDataBoxKey) },
    { label: 'B', privateKey: config.attestorBKey, provider: aviationStack(config.aviationStackKey) },
  ];
}

export interface SigningReport {
  signatures: Hex[];
  signers: { label: string; address: Address }[];
  refusals: { label: string; reason: string }[];
}

/**
 * Ask each attestor to independently verify and sign. An attestor refuses when
 * its own provider cannot confirm the arrival within the agreement window.
 */
export async function collectSignatures(
  message: AttestationMessage,
  carrier: string,
  flightNumber: string,
  dateISO: string,
): Promise<SigningReport> {
  const signatures: { address: Address; sig: Hex }[] = [];
  const refusals: { label: string; reason: string }[] = [];

  for (const b of bindings()) {
    if (!b.privateKey) {
      refusals.push({ label: b.label, reason: 'attestor key not configured' });
      continue;
    }
    if (!b.provider.configured) {
      refusals.push({ label: b.label, reason: `${b.provider.name} not configured` });
      continue;
    }

    const own = await b.provider.fetch(carrier, flightNumber, dateISO);
    if (!own.status?.actualArrival) {
      refusals.push({
        label: b.label,
        reason: `${b.provider.name} has no actual arrival (${own.error ?? 'not landed'})`,
      });
      continue;
    }

    const ownSeconds = BigInt(Math.floor(own.status.actualArrival.getTime() / 1000));
    const deltaMin =
      Math.abs(Number(ownSeconds - message.actualArrival)) / 60;

    if (deltaMin > AGREEMENT_WINDOW_MIN) {
      refusals.push({
        label: b.label,
        reason: `${b.provider.name} differs from consensus by ${deltaMin.toFixed(1)} min (limit ${AGREEMENT_WINDOW_MIN})`,
      });
      continue;
    }

    const account = privateKeyToAccount(withPrefix(b.privateKey));
    const sig = await account.signTypedData({
      domain: EIP712_DOMAIN,
      types: ATTESTATION_TYPES,
      primaryType: 'Attestation',
      message,
    });
    signatures.push({ address: account.address, sig });
  }

  // The contract requires strictly ascending signer addresses to make duplicate
  // detection cheap, so we sort before submitting.
  signatures.sort((x, y) => (x.address.toLowerCase() < y.address.toLowerCase() ? -1 : 1));

  return {
    signatures: signatures.map((s) => s.sig),
    signers: signatures.map((s) => ({ label: '', address: s.address })),
    refusals,
  };
}

export interface AttestOutcome {
  attested: boolean;
  alreadyAttested: boolean;
  txHash?: Hex;
  signatureCount: number;
  refusals: { label: string; reason: string }[];
}

export async function attestFlight(
  consensus: Consensus,
  carrier: string,
  flightNumber: string,
  dateISO: string,
  distanceKm: number,
): Promise<AttestOutcome> {
  const s = consensus.status;
  if (!s?.actualArrival) {
    return { attested: false, alreadyAttested: false, signatureCount: 0, refusals: [{ label: '-', reason: 'flight has not arrived' }] };
  }

  const flightKey = flightKeyHash(carrier, flightNumber, s.scheduledDeparture);
  if (await isAttested(flightKey)) {
    return { attested: true, alreadyAttested: true, signatureCount: 0, refusals: [] };
  }

  const delayMinutes = Math.max(
    0,
    Math.round((s.actualArrival.getTime() - s.scheduledArrival.getTime()) / 60000),
  );

  const message: AttestationMessage = {
    flightKey,
    scheduledArrival: BigInt(Math.floor(s.scheduledArrival.getTime() / 1000)),
    actualArrival: BigInt(Math.floor(s.actualArrival.getTime() / 1000)),
    delayMinutes,
    status: statusCode(s.status),
    distanceKm: Math.round(distanceKm),
    attestedAt: BigInt(Math.floor(Date.now() / 1000)),
  };

  const report = await collectSignatures(message, carrier, flightNumber, dateISO);
  if (report.signatures.length < 2) {
    return {
      attested: false,
      alreadyAttested: false,
      signatureCount: report.signatures.length,
      refusals: report.refusals,
    };
  }

  const txHash = await submitAttestation(message, report.signatures);
  return {
    attested: true,
    alreadyAttested: false,
    txHash,
    signatureCount: report.signatures.length,
    refusals: report.refusals,
  };
}
