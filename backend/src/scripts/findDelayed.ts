/**
 * Hunt for a genuinely EU261-eligible flight to demo with.
 *
 * Uses AeroDataBox's airport-window endpoint: one request returns every arrival
 * in an 8-hour window, so we can scan hundreds of flights without burning the
 * per-flight quota. Nothing here fabricates data — it only searches real
 * arrivals for one that is actually late.
 *
 *   tsx src/scripts/findDelayed.ts EDDF 2026-08-21
 */
import { config, assertFlightDataConfigured } from '../config.js';
import { parseUtc } from '../providers/types.js';

assertFlightDataConfigured();
const HOST = 'aerodatabox.p.rapidapi.com';

const icao = process.argv[2] ?? 'EDDF';
const date = process.argv[3] ?? new Date(Date.now() - 86400000).toISOString().slice(0, 10);

interface Hit {
  carrier: string;
  number: string;
  from: string;
  delayMin: number;
  sched: string;
  actual: string;
}

const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** The BASIC RapidAPI plan allows roughly one request per second. */
async function window(fromH: string, toH: string, attempt = 0): Promise<Hit[]> {
  const url =
    `https://${HOST}/flights/airports/icao/${icao}/${date}T${fromH}/${date}T${toH}` +
    `?direction=Arrival&withCodeshared=false&withCargo=false&withPrivate=false&withLocation=false`;

  const res = await fetch(url, {
    headers: { 'x-rapidapi-host': HOST, 'x-rapidapi-key': config.aeroDataBoxKey! },
  });
  const body = await res.text();
  if (res.status === 429 && attempt < 4) {
    await pause(2500 * (attempt + 1));
    return window(fromH, toH, attempt + 1);
  }
  if (!res.ok) {
    console.error(`  ${fromH}-${toH}: HTTP ${res.status} ${body.slice(0, 120)}`);
    return [];
  }

  let parsed: any;
  try { parsed = JSON.parse(body); } catch { return []; }
  const arrivals: any[] = parsed.arrivals ?? [];

  const hits: Hit[] = [];
  for (const f of arrivals) {
    // The airport-schedule endpoint nests times under `movement` (whose `airport`
    // is the OTHER end of the leg) rather than the `arrival`/`departure` shape the
    // per-flight endpoint uses. Different shape, same provider.
    const m = f.movement ?? {};
    const sched = parseUtc(m.scheduledTime?.utc);
    const actual =
      parseUtc(m.actualTime?.utc) ??
      parseUtc(m.runwayTime?.utc) ??
      parseUtc(m.revisedTime?.utc);
    if (!sched || !actual) continue;

    const delayMin = Math.round((actual.getTime() - sched.getTime()) / 60000);
    if (delayMin < 120) continue;

    const num: string = (f.number ?? '').replace(/\s+/g, '');
    const parts = num.match(/^([A-Z0-9]{2})(\d+)$/);
    if (!parts) continue;

    hits.push({
      carrier: parts[1],
      number: parts[2],
      from: m.airport?.iata ?? '?',
      delayMin,
      sched: sched.toISOString(),
      actual: actual.toISOString(),
    });
  }
  return hits;
}

console.log(`scanning ${icao} arrivals on ${date} for delays >= 120 min...\n`);

const all: Hit[] = [];
for (const [a, b] of [['00:00', '08:00'], ['08:00', '16:00'], ['16:00', '23:59']]) {
  all.push(...(await window(a, b)));
  await pause(2000);
}

all.sort((x, y) => y.delayMin - x.delayMin);
if (all.length === 0) {
  console.log('No arrivals delayed 120+ min found in this window. Try another airport or date.');
} else {
  console.log(`${all.length} delayed arrivals found:\n`);
  for (const h of all.slice(0, 15)) {
    const flag = h.delayMin >= 180 ? 'EU261-ELIGIBLE' : 'under 180';
    console.log(
      `  ${h.carrier}${h.number.padEnd(5)} from ${h.from}  delay ${String(h.delayMin).padStart(4)} min  ${flag}`,
    );
  }
}
