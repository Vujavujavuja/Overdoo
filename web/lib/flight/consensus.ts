import { createHash } from "node:crypto";
import { aeroDataBox } from "./aerodatabox";
import { aviationStack } from "./aviationstack";
import type { FlightProvider, FlightStatus, ProviderResult } from "./types";

export const AGREEMENT_WINDOW_MIN = 15;

export interface Consensus {
  status: FlightStatus | null;
  agreement: number;
  sources: string[];
  dissenting: string[];
  rawHashes: string[];
  errors: { provider: string; error: string }[];
}

const sha256 = (b: string) => createHash("sha256").update(b).digest("hex");

export function providers(): FlightProvider[] {
  return [
    aeroDataBox(process.env.AERODATABOX_KEY),
    aviationStack(process.env.AVIATIONSTACK_KEY),
  ].filter((p) => p.configured);
}

/**
 * Agreement is measured on ACTUAL ARRIVAL only, because that is the field the
 * payout depends on. Providers agreeing on the schedule while disagreeing on the
 * landing time is not agreement for our purposes.
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
    s.status === "fulfilled"
      ? s.value
      : { status: null, raw: "", source: active[i].name, error: String(s.reason) },
  );

  const rawHashes = results.filter((r) => r.raw).map((r) => sha256(r.raw));
  const errors = results.filter((r) => r.error).map((r) => ({ provider: r.source, error: r.error! }));
  const answered = results.filter(
    (r): r is ProviderResult & { status: FlightStatus } => Boolean(r.status),
  );

  if (answered.length === 0) {
    return { status: null, agreement: 0, sources: [], dissenting: [], rawHashes, errors };
  }

  const landed = answered.filter((r) => r.status.actualArrival !== null);
  if (landed.length === 0) {
    return {
      status: answered[0].status,
      agreement: 0,
      sources: answered.map((r) => r.source),
      dissenting: [],
      rawHashes,
      errors,
    };
  }

  const windowMs = AGREEMENT_WINDOW_MIN * 60_000;
  let best: typeof landed = [];
  for (const anchor of landed) {
    const cluster = landed.filter(
      (o) =>
        Math.abs(
          o.status.actualArrival!.getTime() - anchor.status.actualArrival!.getTime(),
        ) <= windowMs,
    );
    if (cluster.length > best.length) best = cluster;
  }

  // Prefer AeroDataBox's figure when it is inside the winning cluster: it reports
  // gate times, which is what EU261 measures.
  const chosen = best.find((r) => r.source === "aerodatabox") ?? best[0];
  const winners = new Set(best.map((r) => r.source));

  return {
    status: chosen.status,
    agreement: best.length,
    sources: best.map((r) => r.source),
    dissenting: answered.filter((r) => !winners.has(r.source)).map((r) => r.source),
    rawHashes,
    errors,
  };
}
