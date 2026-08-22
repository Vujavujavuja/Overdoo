import { assessEligibility, baseAmountEur, reroutingReductionApplies } from '../eligibility.js';

let pass = 0;
let fail = 0;
function expect(label: string, actual: unknown, want: unknown) {
  const ok = JSON.stringify(actual) === JSON.stringify(want);
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${label}  -> ${JSON.stringify(actual)}${ok ? '' : ` (want ${JSON.stringify(want)})`}`);
  ok ? pass++ : fail++;
}

const sched = new Date('2026-08-21T13:20:00Z');
const late = (min: number) => new Date(sched.getTime() + min * 60_000);

console.log('--- Article 7(1) tiers ---');
expect('<=1500km', baseAmountEur(1200, true), 250);
expect('intra-EU >1500km', baseAmountEur(2500, true), 400);
expect('extra-EU 1500-3500', baseAmountEur(2500, false), 400);
expect('extra-EU >3500km', baseAmountEur(6000, false), 600);

console.log('\n--- Article 7(2): only on re-routing ---');
expect('>3500km 200min NOT rerouted -> no reduction', reroutingReductionApplies(6000, false, 200, false), false);
expect('>3500km 200min rerouted -> reduction', reroutingReductionApplies(6000, false, 200, true), true);
expect('>3500km 250min rerouted -> no reduction', reroutingReductionApplies(6000, false, 250, true), false);

console.log('\n--- Scope (Article 3) ---');
const r1 = assessEligibility({
  carrier: 'LH', depAirport: 'BEG', arrAirport: 'FRA',
  scheduledArrival: sched, actualArrival: late(200), kind: 'delay',
});
expect('BEG->FRA on LH in scope', r1.scopeBasis, 'arrivalInEuWithEuCarrier');
expect('BEG->FRA 200min eligible', r1.eligible, true);
expect('BEG->FRA amount (1055km)', r1.statutoryAmountEur, 250);

const r2 = assessEligibility({
  carrier: 'JU', depAirport: 'BEG', arrAirport: 'FRA',
  scheduledArrival: sched, actualArrival: late(200), kind: 'delay',
});
expect('BEG->FRA on Air Serbia out of scope', r2.eligible, false);

const r3 = assessEligibility({
  carrier: 'BA', depAirport: 'LHR', arrAirport: 'JFK',
  scheduledArrival: sched, actualArrival: late(300), kind: 'delay',
});
expect('LHR->JFK post-Brexit out of scope', r3.eligible, false);

console.log('\n--- The long-haul case the spec got wrong ---');
const r4 = assessEligibility({
  carrier: 'AF', depAirport: 'CDG', arrAirport: 'JFK',
  scheduledArrival: sched, actualArrival: late(185), kind: 'delay',
});
expect('CDG->JFK 185min = EUR600 (not 300)', r4.statutoryAmountEur, 600);

console.log('\n--- Thresholds ---');
const r5 = assessEligibility({
  carrier: 'LH', depAirport: 'FRA', arrAirport: 'BEG',
  scheduledArrival: sched, actualArrival: late(179), kind: 'delay',
});
expect('179 min not eligible', r5.eligible, false);

const r6 = assessEligibility({
  carrier: 'LH', depAirport: 'FRA', arrAirport: 'BEG',
  scheduledArrival: sched, actualArrival: null, kind: 'cancellation',
  cancellationNoticeDays: 3,
});
expect('cancellation 3 days notice eligible', r6.eligible, true);

const r7 = assessEligibility({
  carrier: 'LH', depAirport: 'FRA', arrAirport: 'BEG',
  scheduledArrival: sched, actualArrival: null, kind: 'cancellation',
  cancellationNoticeDays: 20,
});
expect('cancellation 20 days notice NOT eligible', r7.eligible, false);

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail === 0 ? 0 : 1);
