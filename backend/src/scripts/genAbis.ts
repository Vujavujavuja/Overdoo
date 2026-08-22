import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const names = ['ClaimUSD', 'FlightOracle', 'CapitalPool', 'ClaimRegistry', 'Settlement'];

let out = '// AUTO-GENERATED from contracts/out. Regenerate: pnpm gen-abis\n';
for (const n of names) {
  const art = JSON.parse(readFileSync(resolve(root, `contracts/out/${n}.sol/${n}.json`), 'utf8'));
  out += `export const ${n.charAt(0).toLowerCase() + n.slice(1)}Abi = ${JSON.stringify(art.abi)} as const;\n`;
}
writeFileSync(resolve(root, 'backend/src/abis.ts'), out);
writeFileSync(resolve(root, 'web/lib/abis.ts'), out);
console.log('wrote backend/src/abis.ts and web/lib/abis.ts');
