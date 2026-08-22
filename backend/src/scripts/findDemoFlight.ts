/**
 * Find a flight that is (a) genuinely EU261-eligible and (b) confirmed by two
 * providers, so it is actually purchasable under the spec's own rules.
 *
 *   tsx src/scripts/findDemoFlight.ts EDDF,EHAM,LFPG 2026-08-21
 */
import { config, assertFlightDataConfigured } from '../config.js';
import { parseUtc } from '../providers/types.js';
import { resolveFlight } from '../providers/index.js';
import { assessEligibility, adjustRunwayToGate } from '../eligibility.js';
import { distanceBetween } from '../airports.js';

assertFlightDataConfigured();
const HOST = 'aerodatabox.p.rapidapi.com';
const pause = (ms: number) => new Promise((r) => setTimeout(r, ms));

const airports = (process.argv[2] ?? 'EDDF').split(',');
const date = process.argv[3] ?? new Date(Date.now() - 86400000).toISOString().slice(0, 10);

interface Cand { carrier: string; number: string; from: string; delayMin: number }

async function scan(icao: string, fromH: string, toH: string, attempt = 0): Promise<Cand[]> {
  const url =
    `https://${HOST}/flights/airports/icao/${icao}/${date}T${fromH}/${date}T${toH}` +
    `?direction=Arrival&withCodeshared=false&withCargo=false&withPrivate=false&withLocation=false`;
  const res = await fetch(url, {
    headers: { 'x-rapidapi-host': HOST, 'x-rapidapi-key': config.aeroDataBoxKey! },
  });
  const body = await res.text();
  if (res.status === 429 && attempt < 4) {
    await pause(2500 * (attempt + 1));
    return scan(icao, fromH, toH, attempt + 1);
  }
  if (!res.ok) return [];

  let parsed: any;
  try { parsed = JSON.parse(body); } catch { return []; }

  const out: Cand[] = [];
  for (const f of parsed.arrivals ?? []) {
    const m = f.movement ?? {};
    const sched = parseUtc(m.scheduledTime?.utc);
    const actual = parseUtc(m.actualTime?.utc) ?? parseUtc(m.runwayTime?.utc) ?? parseUtc(m.revisedTime?.utc);
    if (!sched || !actual) continue;
    const delayMin = Math.round((actual.getTime() - sched.getTime()) / 60000);
    if (delayMin < 180) continue;
    const parts = (f.number ?? '').replace(/\s+/g, '').match(/^([A-Z0-9]{2})(\d+)$/);
    if (!parts) continue;
    out.push({ carrier: parts[1], number: parts[2], from: m.airport?.iata ?? '?', delayMin });
  }
  return out;
}

const candidates: Cand[] = [];
for (const icao of airports) {
  for (const [a, b] of [['00:00', '12:00'], ['12:00', '23:59']]) {
    candidates.push(...(await scan(icao, a, b)));
    await pause(1800);
  }
  console.log(`scanned ${icao}: running total ${candidates.length} delayed 180+`);
}

console.log(`\n${candidates.length} candidates delayed 180+ min. Checking two-source coverage...\n`);

for (const c of candidates.slice(0, 40)) {
  const consensus = await resolveFlight(c.carrier, c.number, date);
  const s = consensus.status;
  if (!s) { console.log(`  ${c.carrier}${c.number}: unresolvable`); continue; }

  const arrival = s.actualArrival
    ? (s.arrivalIsRunwayTime ? adjustRunwayToGate(s.actualArrival) : s.actualArrival)
    : null;
  const el = assessEligibility({
    carrier: c.carrier, depAirport: s.depAirport, arrAirport: s.arrAirport,
    scheduledArrival: s.scheduledArrival, actualArrival: arrival, kind: 'delay',
  });
  const km = distanceBetween(s.depAirport, s.arrAirport);

  const verdict =
    el.eligible && consensus.agreement >= 2 ? '  <<< PURCHASABLE'
    : el.eligible ? `  (eligible but agreement=${consensus.agreement})`
    : `  (${el.scopeBasis === 'outOfScope' ? 'out of scope' : 'not eligible'})`;

  console.log(
    `  ${c.carrier}${c.number.padEnd(5)} ${s.depAirport}->${s.arrAirport} ` +
    `${String(el.delayMinutes ?? c.delayMin).padStart(4)}min ${String(Math.round(km ?? 0)).padStart(5)}km ` +
    `EUR${String(el.statutoryAmountEur).padStart(4)} agree=${consensus.agreement} [${consensus.sources.join(',')}]${verdict}`,
  );
  await pause(1500);
}
