/**
 * Find flights that are genuinely EU261-eligible, to demo or test with.
 *
 * Uses AeroDataBox's airport-window endpoint: one request returns every arrival
 * in a window, so hundreds of flights can be scanned without burning the
 * per-flight quota. Nothing here fabricates data — it searches real arrivals for
 * ones that were actually late.
 *
 *   npm run find-delayed -- EDDF,LEMD,LFPG 2026-08-21
 */
import "dotenv/config";
import { resolveFlight } from "../lib/flight/consensus";
import { assessEligibility, adjustRunwayToGate } from "../lib/flight/eligibility";
import { distanceBetween } from "../lib/flight/airports";
import { parseUtc } from "../lib/flight/types";

const HOST = "aerodatabox.p.rapidapi.com";
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const key = process.env.AERODATABOX_KEY;
if (!key) {
  console.error("AERODATABOX_KEY is not set. Copy .env.example to .env.local and fill it in.");
  process.exit(1);
}

const airports = (process.argv[2] ?? "EDDF").split(",");
const date = process.argv[3] ?? new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);

interface Candidate {
  carrier: string;
  number: string;
  delayMin: number;
}

/** The BASIC RapidAPI plan allows roughly one request per second. */
async function scanWindow(icao: string, from: string, to: string, attempt = 0): Promise<Candidate[]> {
  const url =
    `https://${HOST}/flights/airports/icao/${icao}/${date}T${from}/${date}T${to}` +
    `?direction=Arrival&withCodeshared=false&withCargo=false&withPrivate=false&withLocation=false`;

  const res = await fetch(url, { headers: { "x-rapidapi-host": HOST, "x-rapidapi-key": key! } });
  const body = await res.text();

  if (res.status === 429 && attempt < 4) {
    await pause(2500 * (attempt + 1));
    return scanWindow(icao, from, to, attempt + 1);
  }
  if (!res.ok) return [];

  let parsed: { arrivals?: unknown[] };
  try {
    parsed = JSON.parse(body);
  } catch {
    return [];
  }

  const out: Candidate[] = [];
  for (const row of parsed.arrivals ?? []) {
    // The airport-schedule endpoint nests times under `movement`, unlike the
    // per-flight endpoint's `arrival`/`departure` shape.
    const f = row as { movement?: Record<string, { utc?: string }>; number?: string };
    const m = f.movement ?? {};
    const sched = parseUtc(m.scheduledTime?.utc);
    const actual =
      parseUtc(m.actualTime?.utc) ?? parseUtc(m.runwayTime?.utc) ?? parseUtc(m.revisedTime?.utc);
    if (!sched || !actual) continue;

    const delayMin = Math.round((actual.getTime() - sched.getTime()) / 60000);
    if (delayMin < 180) continue;

    const parts = (f.number ?? "").replace(/\s+/g, "").match(/^([A-Z0-9]{2})(\d+)$/);
    if (!parts) continue;
    out.push({ carrier: parts[1], number: parts[2], delayMin });
  }
  return out;
}

const candidates: Candidate[] = [];
for (const icao of airports) {
  for (const [a, b] of [["00:00", "12:00"], ["12:00", "23:59"]]) {
    candidates.push(...(await scanWindow(icao, a, b)));
    await pause(1800);
  }
  console.log(`scanned ${icao}: ${candidates.length} delayed 180+ so far`);
}

console.log(`\nchecking ${Math.min(candidates.length, 20)} candidates for eligibility...\n`);

for (const c of candidates.slice(0, 20)) {
  const consensus = await resolveFlight(c.carrier, c.number, date);
  const s = consensus.status;
  if (!s) continue;

  const arrival = s.actualArrival
    ? s.arrivalIsRunwayTime
      ? adjustRunwayToGate(s.actualArrival)
      : s.actualArrival
    : null;

  const el = assessEligibility({
    carrier: c.carrier,
    depAirport: s.depAirport,
    arrAirport: s.arrAirport,
    scheduledArrival: s.scheduledArrival,
    actualArrival: arrival,
    kind: "delay",
  });
  const km = Math.round(distanceBetween(s.depAirport, s.arrAirport) ?? 0);

  console.log(
    `  ${(c.carrier + c.number).padEnd(8)} ${s.depAirport}->${s.arrAirport} ` +
      `${String(el.delayMinutes ?? c.delayMin).padStart(4)}min ${String(km).padStart(5)}km ` +
      `${el.eligible ? `EUR ${el.statutoryAmountEur}` : "not eligible"} ` +
      `[${consensus.sources.join(",") || "none"}]`,
  );
  await pause(1500);
}
