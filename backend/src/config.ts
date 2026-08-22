import { config as loadEnv } from 'dotenv';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// .env lives at the monorepo root; backend processes run from backend/.
loadEnv({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env') });

function required(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === '') {
    throw new Error(`Missing required env var ${name}`);
  }
  return v.trim();
}

function optional(name: string): string | undefined {
  const v = process.env[name];
  return v && v.trim() !== '' ? v.trim() : undefined;
}

export const config = {
  rpcUrl: required('MONAD_RPC_URL'),
  chainId: Number(required('MONAD_CHAIN_ID')),
  deployerKey: optional('DEPLOYER_PRIVATE_KEY'),
  attestorAKey: optional('ATTESTOR_A_PRIVATE_KEY'),
  attestorBKey: optional('ATTESTOR_B_PRIVATE_KEY'),
  aeroDataBoxKey: optional('AERODATABOX_KEY'),
  aviationStackKey: optional('AVIATIONSTACK_KEY'),
  targetMarginBps: Number(process.env.TARGET_MARGIN_BPS ?? 1500),
  defaultRecoveryProb: Number(process.env.DEFAULT_RECOVERY_PROB ?? 0.65),
  collectionCostEur: Number(process.env.COLLECTION_COST_EUR ?? 25),
  port: Number(process.env.PORT ?? 3001),
  /** Demo scale: statutory EUR amounts are paid in native MON at this rate, so a
   *  EUR 400 claim settles for 0.04 MON and testnet funds last. */
  monPerEur: Number(process.env.MON_PER_EUR ?? 0.0001),
};

/**
 * Refuse to boot without live flight data. There is deliberately no synthetic
 * fallback: a system that silently invents flight outcomes and then pays real
 * money against them is worse than one that does not start.
 */
export function assertFlightDataConfigured(): void {
  if (!config.aeroDataBoxKey && !config.aviationStackKey) {
    throw new Error(
      'No flight-data provider configured. Set AERODATABOX_KEY and/or AVIATIONSTACK_KEY. ' +
        'Aeroclaim will not run against synthetic data.',
    );
  }
}
