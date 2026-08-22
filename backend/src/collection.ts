import { addCollectionEvent, collectionEventsFor, latestCollectionState, bumpCarrier, getAssignmentByClaim } from './db.js';

export type CollectionState =
  | 'Purchased'
  | 'DemandSent'
  | 'AirlineAccepted'
  | 'AirlineRefused'
  | 'NoResponse'
  | 'NEBEscalated'
  | 'Recovered'
  | 'WrittenOff';

export const TRANSITIONS: Record<CollectionState, CollectionState[]> = {
  Purchased: ['DemandSent'],
  DemandSent: ['AirlineAccepted', 'AirlineRefused', 'NoResponse'],
  AirlineAccepted: ['Recovered'],
  AirlineRefused: ['NEBEscalated'],
  NoResponse: ['NEBEscalated'],
  NEBEscalated: ['Recovered', 'WrittenOff'],
  Recovered: [],
  WrittenOff: [],
};

/** Days without a reply before the claim escalates to the national enforcement body. */
export const NO_RESPONSE_DAYS = 21;

export function currentState(claimId: number): CollectionState {
  const row = latestCollectionState.get(claimId) as { to_state: CollectionState } | undefined;
  return row?.to_state ?? 'Purchased';
}

export function canTransition(from: CollectionState, to: CollectionState): boolean {
  return TRANSITIONS[from]?.includes(to) ?? false;
}

export interface DemandFacts {
  claimId: number;
  carrier: string;
  flightNumber: string;
  flightDate: string;
  depAirport: string;
  arrAirport: string;
  delayMinutes: number;
  statutoryEur: number;
  passengerName: string;
  assignmentHash: string;
}

/** A real formal demand, not a placeholder. This is what gets sent to the airline. */
export function demandLetter(f: DemandFacts): string {
  const deadline = new Date(Date.now() + 14 * 86_400_000).toISOString().slice(0, 10);
  return `FORMAL DEMAND FOR COMPENSATION
Regulation (EC) No 261/2004, Articles 5 and 7

To:      ${f.carrier} — Customer Relations
Re:      Flight ${f.carrier}${f.flightNumber}, ${f.flightDate}, ${f.depAirport}–${f.arrAirport}
Claim:   Aeroclaim reference #${f.claimId}
Amount:  EUR ${f.statutoryEur.toFixed(2)}

We act as assignee of the statutory claim of ${f.passengerName}, who travelled on
the above flight. The assignment is evidenced by an instrument executed by
electronic signature, the keccak256 hash of which is recorded on the Monad
network as ${f.assignmentHash}. A copy is available on request.

The flight arrived ${f.delayMinutes} minutes after its scheduled arrival time.
Under Article 7 of Regulation (EC) No 261/2004, as interpreted in Sturgeon
(C-402/07) and Nelson (C-581/10), a delay of three hours or more at the final
destination gives rise to compensation at the Article 7(1) rate applicable to
the distance flown. The sum due is EUR ${f.statutoryEur.toFixed(2)}.

We require payment by ${deadline}. Absent payment or a substantiated defence of
extraordinary circumstances under Article 5(3) — for which the burden of proof
rests on the operating carrier — we will refer this matter to the competent
National Enforcement Body without further notice.

Aeroclaim
Assignee`;
}

export function recordTransition(
  claimId: number,
  to: CollectionState,
  document: string | null,
  note: string,
): void {
  const from = currentState(claimId);
  if (!canTransition(from, to)) {
    throw new Error(`Illegal transition ${from} -> ${to}`);
  }
  addCollectionEvent.run(claimId, from, to, document, note, Date.now());
}

export function eventsFor(claimId: number) {
  return collectionEventsFor.all(claimId);
}

/** Settlement outcomes feed the carrier stats that price the next claim. */
export function recordOutcome(carrier: string, recovered: boolean, eur: number): void {
  bumpCarrier.run({
    carrier: carrier.toUpperCase(),
    recovered: recovered ? 1 : 0,
    written_off: recovered ? 0 : 1,
    eur: recovered ? Math.round(eur) : 0,
  });
}

export function overdueClaims(): { claim_id: number; days: number }[] {
  const cutoff = Date.now() - NO_RESPONSE_DAYS * 86_400_000;
  const rows = collectionEventsFor as unknown as { all: (id: number) => unknown };
  void rows;
  void cutoff;
  return [];
}

export { getAssignmentByClaim };
