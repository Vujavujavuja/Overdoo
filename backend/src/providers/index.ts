import { createHash } from 'node:crypto';
import { config } from '../config.js';
import { aeroDataBox } from './aerodatabox.js';
import { aviationStack } from './aviationstack.js';
import { openSky } from './opensky.js';
import type { FlightProvider, FlightStatus, ProviderResult } from './types.js';

export const AGREEMENT_WINDOW_MIN = 15;

export interface RawCapture {
  provider: string;
  body: string;
  sha256: string;
}

export interface Consensus {
  status: FlightStatus | null;
  /** How many providers agree on actual arrival within the window. */
  agreement: number;
  sources: string[];
  rawHashes: string[];
  raws: RawCapture[];
  /** Providers that answered but disagreed with the winning cluster. */
  dissenting: string[];
  errors: { provider: string; error: string }[];
}

export function providers(): FlightProvider[] {
  return [aeroDataBox(config.aeroDataBoxKey), aviationStack(config.aviationStackKey)].filter(
    (p) => p.configured,
  );
}

export const corroborator = openSky();

const sha256 = (body: string) => createHash('sha256').update(body).digest('hex');

/**
 * Query every configured provider and find the largest set that agrees on the
 * actual arrival time within AGREEMENT_WINDOW_MIN minutes.
 *
 * Agreement is measured on ACTUAL ARRIVAL specifically, because that is the only
 * field the payout depends on. Two providers agreeing on the schedule while
 * disagreeing on when the aircraft landed is not agreement for our purposes.
 */
export async function resolveFlight(
  carrier: string,
  flightNumber: string,
  dateISO: string,
): Promise<Consensus> {
  const active = providers();
  const settled = await Promise.allSettled(
    active.map((p) => p.fetch(carrier, flightNumber, dateISO)),
  );

  const results: ProviderResult[] = settled.map((s, i) =>
    s.status === 'fulfilled'
      ? s.value
      : { status: null, raw: '', source: active[i].name, error: String(s.reason) },
  );

  const raws: RawCapture[] = results
    .filter((r) => r.raw.length > 0)
    .map((r) => ({ provider: r.source, body: r.raw, sha256: sha256(r.raw) }));

  const errors = results
    .filter((r) => r.error)
    .map((r) => ({ provider: r.source, error: r.error! }));

  const answered = results.filter((r): r is ProviderResult & { status: FlightStatus } =>
    Boolean(r.status),
  );

  if (answered.length === 0) {
    return { status: null, agreement: 0, sources: [], rawHashes: raws.map((r) => r.sha256), raws, dissenting: [], errors };
  }

  // AviationStack's free tier frequently returns actual: null. Rather than let a
  // single feed decide a payout, we reach for OpenSky — ADS-B, an entirely
  // different measurement mechanism than an airline schedule feed.
  //
  // Honest caveat: OpenSky is reached using the callsign that AeroDataBox
  // supplied, so the flight IDENTIFICATION is not independent of AeroDataBox.
  // The arrival TIME measurement is. That is a real, if partial, second opinion,
  // and it is labelled as such rather than presented as a peer source.
  const withCallsign = answered.find((r) => r.status.callSign && r.status.arrAirportIcao);
  const alreadyLanded = answered.filter((r) => r.status.actualArrival !== null);

  if (alreadyLanded.length < 2 && withCallsign) {
    const ref = withCallsign.status;
    const anchor = ref.actualArrival ?? ref.scheduledArrival;
    try {
      const { actualArrival, raw } = await corroborator.corroborateArrival(
        ref.arrAirportIcao!,
        ref.callSign!,
        new Date(anchor.getTime() - 6 * 3_600_000),
        new Date(anchor.getTime() + 6 * 3_600_000),
      );
      if (raw) raws.push({ provider: 'opensky', body: raw, sha256: sha256(raw) });
      if (actualArrival) {
        answered.push({
          source: 'opensky',
          raw,
          status: { ...ref, actualArrival, source: 'opensky', arrivalIsRunwayTime: true },
        } as ProviderResult & { status: FlightStatus });
      }
    } catch {
      /* corroboration is best-effort; absence just means no second opinion */
    }
  }

  const landed = answered.filter((r) => r.status.actualArrival !== null);

  // Nothing has landed yet: report the schedule, but agreement on arrival is zero
  // so nothing downstream can treat this as purchasable.
  if (landed.length === 0) {
    return {
      status: answered[0].status,
      agreement: 0,
      sources: answered.map((r) => r.source),
      rawHashes: raws.map((r) => r.sha256),
      raws,
      dissenting: [],
      errors,
    };
  }

  // Largest cluster of arrival times within the window.
  const windowMs = AGREEMENT_WINDOW_MIN * 60_000;
  let best: typeof landed = [];
  for (const anchor of landed) {
    const cluster = landed.filter(
      (other) =>
        Math.abs(
          other.status.actualArrival!.getTime() - anchor.status.actualArrival!.getTime(),
        ) <= windowMs,
    );
    if (cluster.length > best.length) best = cluster;
  }

  // Prefer AeroDataBox as the reported figure when it is inside the winning
  // cluster: it reports gate times, which is what EU261 measures.
  const chosen = best.find((r) => r.source === 'aerodatabox') ?? best[0];
  const winners = new Set(best.map((r) => r.source));

  return {
    status: chosen.status,
    agreement: best.length,
    sources: best.map((r) => r.source),
    rawHashes: raws.map((r) => r.sha256),
    raws,
    dissenting: answered.filter((r) => !winners.has(r.source)).map((r) => r.source),
    errors,
  };
}

export function flightKeyOf(carrier: string, flightNumber: string, scheduledDeparture: Date): string {
  return `${carrier.toUpperCase()}-${flightNumber}-${scheduledDeparture.toISOString()}`;
}
