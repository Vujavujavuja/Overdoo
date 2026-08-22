// Regenerate web/lib/abi.ts from the compiled Foundry artifact.
import { readFileSync, writeFileSync } from "node:fs";
const art = JSON.parse(readFileSync("../contracts/out/TipJar.sol/TipJar.json", "utf8"));
writeFileSync(
  "lib/abi.ts",
  `// AUTO-GENERATED from contracts/out/TipJar.sol/TipJar.json\n` +
    `// Regenerate after changing the contract:  cd web && npm run abi\n` +
    `export const tipJarAbi = ${JSON.stringify(art.abi, null, 2)} as const;\n`,
);
console.log("wrote lib/abi.ts");
