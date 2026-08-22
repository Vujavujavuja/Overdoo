import { writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const URL = 'https://davidmegginson.github.io/ourairports-data/airports.csv';
const out = resolve(dirname(fileURLToPath(import.meta.url)), '../../data/airports.csv');

const res = await fetch(URL);
if (!res.ok) throw new Error(`airports.csv fetch failed: HTTP ${res.status}`);
const body = await res.text();
await writeFile(out, body, 'utf8');
console.log(`wrote ${out} (${(body.length / 1e6).toFixed(1)} MB)`);
