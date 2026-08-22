/**
 * Diagnostic: resolve one real flight across all configured providers.
 *   pnpm tsx src/scripts/checkFlight.ts LH 1411 2026-08-22
 */
import { assertFlightDataConfigured } from '../config.js';
import { resolveFlight, providers } from '../providers/index.js';

const [carrier, number, date] = process.argv.slice(2);
if (!carrier || !number || !date) {
  console.error('usage: checkFlight <CARRIER> <NUMBER> <YYYY-MM-DD>');
  process.exit(1);
}

assertFlightDataConfigured();
console.log('providers configured:', providers().map((p) => p.name).join(', '));

const c = await resolveFlight(carrier, number, date);

console.log('\nagreement :', c.agreement, `(sources: ${c.sources.join(', ') || 'none'})`);
console.log('dissenting:', c.dissenting.join(', ') || 'none');
console.log('errors    :', c.errors.map((e) => `${e.provider}: ${e.error}`).join(' | ') || 'none');
console.log('rawHashes :', c.rawHashes.map((h) => h.slice(0, 12)).join(', '));

if (c.status) {
  const s = c.status;
  const delayMin = s.actualArrival
    ? Math.round((s.actualArrival.getTime() - s.scheduledArrival.getTime()) / 60000)
    : null;
  console.log('\nroute     :', s.depAirport, '->', s.arrAirport);
  console.log('sched arr :', s.scheduledArrival.toISOString());
  console.log('actual arr:', s.actualArrival?.toISOString() ?? 'not arrived');
  console.log('delay min :', delayMin);
  console.log('phase     :', s.status);
  console.log('runwayTime fallback used:', s.arrivalIsRunwayTime);
  console.log('provider distance km   :', s.providerDistanceKm);
}
