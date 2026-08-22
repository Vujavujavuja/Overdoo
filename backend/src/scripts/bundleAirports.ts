/** Compact the 12.7MB OurAirports CSV into a small JSON the web app can bundle,
 *  so the deployed app has no runtime file or network dependency for airports. */
import { writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadAirports } from '../airports.js';

const out: Record<string, [number, number, string, string]> = {};
for (const [iata, a] of loadAirports()) {
  out[iata] = [Math.round(a.lat * 1e4) / 1e4, Math.round(a.lon * 1e4) / 1e4, a.country, a.icao];
}
const path = resolve(dirname(fileURLToPath(import.meta.url)), '../../../web/lib/airports.json');
writeFileSync(path, JSON.stringify(out));
console.log(`wrote ${path}: ${Object.keys(out).length} airports`);
