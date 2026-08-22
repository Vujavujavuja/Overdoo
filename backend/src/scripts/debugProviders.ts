import { config } from '../config.js';
import { aeroDataBox } from '../providers/aerodatabox.js';
import { aviationStack } from '../providers/aviationstack.js';

const [carrier, number, date] = process.argv.slice(2);
const ps = [aeroDataBox(config.aeroDataBoxKey), aviationStack(config.aviationStackKey)];

for (const p of ps) {
  const r = await p.fetch(carrier, number, date);
  console.log(`\n--- ${p.name} ---`);
  if (r.error) console.log('error:', r.error);
  if (r.status) {
    console.log('schedArr :', r.status.scheduledArrival.toISOString());
    console.log('actualArr:', r.status.actualArrival?.toISOString() ?? 'null');
    console.log('phase    :', r.status.status);
  }
  if (p.name === 'aviationstack' && r.raw) {
    const row = JSON.parse(r.raw).data?.find((x: any) => x.flight_date === date);
    if (row) console.log('raw arrival:', JSON.stringify(row.arrival));
  }
}
