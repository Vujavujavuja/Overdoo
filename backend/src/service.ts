import { parseEther, type Address, type Hex } from 'viem';
import { config } from './config.js';
import { distanceBetween } from './airports.js';
import { assessEligibility, adjustRunwayToGate, type EligibilityResult } from './eligibility.js';
import { priceClaim, type PriceBreakdown } from './pricing.js';
import { resolveFlight, type Consensus } from './providers/index.js';
import { flightKeyHash } from './oracle.js';
import { isAttested, getClaim, purchaseClaim, explorerTx } from './chain.js';
import { insertRaw, upsertFlight, getFlight, saveAssignment, getAssignment } from './db.js';
import {
  assignmentText,
  documentHash,
  verifyAssignmentSignature,
  type AssignmentFacts,
} from './assignment.js';

/** EUR are settled in native MON at the demo scale so testnet funds last. */
export function eurToWei(eur: number): bigint {
  return parseEther((eur * config.monPerEur).toFixed(18));
}

export interface FlightView {
  flightKey: Hex;
  carrier: string;
  flightNumber: string;
  date: string;
  depAirport: string;
  arrAirport: string;
  scheduledDeparture: string;
  scheduledArrival: string;
  actualArrival: string | null;
  phase: string;
  distanceKm: number | null;
  consensus: {
    agreement: number;
    sources: string[];
    dissenting: string[];
    errors: { provider: string; error: string }[];
    rawHashes: string[];
    singleSource: boolean;
  };
  eligibility: EligibilityResult;
  attested: boolean;
}

export async function trackFlight(
  carrier: string,
  flightNumber: string,
  date: string,
): Promise<FlightView> {
  const consensus: Consensus = await resolveFlight(carrier, flightNumber, date);
  if (!consensus.status) {
    const detail = consensus.errors.map((e) => `${e.provider}: ${e.error}`).join('; ');
    throw new Error(`No provider could resolve ${carrier}${flightNumber} on ${date}. ${detail}`);
  }

  const s = consensus.status;
  const flightKey = flightKeyHash(carrier, flightNumber, s.scheduledDeparture);
  const distanceKm = distanceBetween(s.depAirport, s.arrAirport);

  // EU261 measures arrival at door-open (Germanwings C-452/13). When all we have
  // is runway time we add taxi-in and mark the figure approximate.
  const arrival = s.actualArrival
    ? s.arrivalIsRunwayTime
      ? adjustRunwayToGate(s.actualArrival)
      : s.actualArrival
    : null;

  const eligibility = assessEligibility({
    carrier,
    depAirport: s.depAirport,
    arrAirport: s.arrAirport,
    scheduledArrival: s.scheduledArrival,
    actualArrival: arrival,
    kind: s.status === 'cancelled' ? 'cancellation' : 'delay',
    cancellationNoticeDays: 0,
    arrivalTimeApproximate: s.arrivalIsRunwayTime,
  });

  const now = Date.now();
  upsertFlight.run({
    flight_key: flightKey,
    carrier: carrier.toUpperCase(),
    flight_number: flightNumber,
    dep_airport: s.depAirport,
    arr_airport: s.arrAirport,
    scheduled_departure: s.scheduledDeparture.getTime(),
    scheduled_arrival: s.scheduledArrival.getTime(),
    actual_arrival: arrival?.getTime() ?? null,
    status: s.status,
    distance_km: Math.round(distanceKm ?? 0),
    last_polled: now,
    agreement: consensus.agreement,
    flight_date: date,
    sources: consensus.sources.join(','),
    arrival_approximate: s.arrivalIsRunwayTime ? 1 : 0,
  });

  for (const r of consensus.raws) {
    insertRaw.run(flightKey, r.provider, r.body, r.sha256, now);
  }

  return {
    flightKey,
    carrier: carrier.toUpperCase(),
    flightNumber,
    date,
    depAirport: s.depAirport,
    arrAirport: s.arrAirport,
    scheduledDeparture: s.scheduledDeparture.toISOString(),
    scheduledArrival: s.scheduledArrival.toISOString(),
    actualArrival: arrival?.toISOString() ?? null,
    phase: s.status,
    distanceKm,
    consensus: {
      agreement: consensus.agreement,
      sources: consensus.sources,
      dissenting: consensus.dissenting,
      errors: consensus.errors,
      rawHashes: consensus.rawHashes,
      singleSource: consensus.agreement === 1,
    },
    eligibility,
    attested: await isAttested(flightKey),
  };
}

export interface Offer {
  flight: FlightView;
  purchasable: boolean;
  blockers: string[];
  breakdown: PriceBreakdown | null;
  statutoryWei: string | null;
  purchaseWei: string | null;
  monPerEur: number;
}

export async function buildOffer(
  carrier: string,
  flightNumber: string,
  date: string,
): Promise<Offer> {
  const flight = await trackFlight(carrier, flightNumber, date);
  const blockers: string[] = [];

  if (!flight.eligibility.eligible) blockers.push(flight.eligibility.reason);
  if (flight.consensus.agreement < 2) {
    blockers.push(
      flight.consensus.agreement === 1
        ? `Single-source data (${flight.consensus.sources[0]}). A second provider must confirm before purchase.`
        : 'No provider has confirmed an actual arrival time yet.',
    );
  }

  const breakdown = flight.eligibility.eligible
    ? priceClaim(flight.eligibility.statutoryAmountEur, carrier)
    : null;

  return {
    flight,
    purchasable: blockers.length === 0 && breakdown !== null,
    blockers,
    breakdown,
    statutoryWei: breakdown ? eurToWei(breakdown.statutoryEur).toString() : null,
    purchaseWei: breakdown ? eurToWei(breakdown.purchasePriceEur).toString() : null,
    monPerEur: config.monPerEur,
  };
}

/** The exact text and hash the passenger is asked to sign. */
export async function prepareAssignment(
  carrier: string,
  flightNumber: string,
  date: string,
  passengerAddress: string,
  passengerName: string,
) {
  const offer = await buildOffer(carrier, flightNumber, date);
  if (!offer.breakdown) throw new Error(offer.blockers.join('; ') || 'Not eligible');

  const facts: AssignmentFacts = {
    passengerName,
    passengerAddress,
    carrier: offer.flight.carrier,
    flightNumber: offer.flight.flightNumber,
    depAirport: offer.flight.depAirport,
    arrAirport: offer.flight.arrAirport,
    flightDate: date,
    delayMinutes: offer.flight.eligibility.delayMinutes ?? 0,
    statutoryEur: offer.breakdown.statutoryEur,
    purchasePriceEur: offer.breakdown.purchasePriceEur,
  };

  const text = assignmentText(facts);
  return {
    offer,
    text,
    documentHash: documentHash(text),
    typedData: {
      domain: (await import('./assignment.js')).ASSIGNMENT_DOMAIN,
      types: (await import('./assignment.js')).ASSIGNMENT_TYPES,
      primaryType: 'ClaimAssignment' as const,
      message: {
        flightKey: offer.flight.flightKey,
        statutoryAmount: offer.statutoryWei!,
        purchasePrice: offer.purchaseWei!,
        documentHash: documentHash(text),
      },
    },
  };
}

export interface AcceptResult {
  claimId: string;
  txHash: Hex;
  explorer: string;
  attestationTx?: Hex;
  paidWei: string;
  paidMon: string;
}

export async function acceptClaim(args: {
  carrier: string;
  flightNumber: string;
  date: string;
  passengerAddress: Address;
  passengerName: string;
  signature: Hex;
}): Promise<AcceptResult> {
  const prepared = await prepareAssignment(
    args.carrier,
    args.flightNumber,
    args.date,
    args.passengerAddress,
    args.passengerName,
  );
  const { offer, text } = prepared;

  if (!offer.purchasable) {
    throw new Error(`Not purchasable: ${offer.blockers.join('; ')}`);
  }

  const docHash = documentHash(text);
  const statutoryWei = BigInt(offer.statutoryWei!);
  const purchaseWei = BigInt(offer.purchaseWei!);

  const validSignature = await verifyAssignmentSignature({
    passenger: args.passengerAddress,
    flightKey: offer.flight.flightKey,
    statutoryAmount: statutoryWei,
    purchasePrice: purchaseWei,
    documentHash: docHash,
    signature: args.signature,
  });
  if (!validSignature) {
    throw new Error('Assignment signature does not match the passenger address.');
  }

  // Attest on chain first; purchaseClaim reverts without it.
  const { attestFlight } = await import('./oracle.js');
  const consensus = await resolveFlight(args.carrier, args.flightNumber, args.date);
  const distanceKm = distanceBetween(offer.flight.depAirport, offer.flight.arrAirport) ?? 0;
  const attestation = await attestFlight(
    consensus,
    args.carrier,
    args.flightNumber,
    args.date,
    distanceKm,
  );
  if (!attestation.attested) {
    throw new Error(
      `Attestation failed (${attestation.signatureCount}/2 signatures): ` +
        attestation.refusals.map((r) => `${r.label}: ${r.reason}`).join('; '),
    );
  }

  const { hash, claimId } = await purchaseClaim({
    flightKey: offer.flight.flightKey,
    passenger: args.passengerAddress,
    statutoryAmount: statutoryWei,
    purchasePrice: purchaseWei,
    assignmentHash: docHash,
  });

  saveAssignment.run({
    flight_key: offer.flight.flightKey,
    passenger_address: args.passengerAddress,
    passenger_name: args.passengerName,
    document_text: text,
    document_hash: docHash,
    signature: args.signature,
    signed_at: Date.now(),
    claim_id: Number(claimId),
  });

  return {
    claimId: claimId.toString(),
    txHash: hash,
    explorer: explorerTx(hash),
    attestationTx: attestation.txHash,
    paidWei: purchaseWei.toString(),
    paidMon: (Number(purchaseWei) / 1e18).toFixed(6),
  };
}

export { getClaim, getFlight, getAssignment };
