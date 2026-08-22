import { config } from './config.js';
import { onePerf } from './db.js';

export interface PriceBreakdown {
  statutoryEur: number;
  recoveryProbability: number;
  recoveryBasis: 'carrierHistory' | 'default';
  resolvedClaims: number;
  expectedGrossEur: number;
  collectionCostEur: number;
  expectedNetEur: number;
  marginBps: number;
  marginEur: number;
  purchasePriceEur: number;
}

/** Below this many resolved claims the carrier's own history is too noisy to use. */
export const MIN_RESOLVED_FOR_CARRIER_RATE = 20;

/**
 * Laplace-smoothed recovery rate. Smoothing matters: without it a carrier whose
 * first claim happens to fail prices at 0% and we would never buy from them
 * again, so the estimate could never correct itself.
 */
export function recoveryProbability(carrier: string): {
  probability: number;
  basis: PriceBreakdown['recoveryBasis'];
  resolved: number;
} {
  const row = onePerf(carrier.toUpperCase());
  const recovered = row?.recovered ?? 0;
  const written = row?.written_off ?? 0;
  const resolved = recovered + written;

  if (resolved < MIN_RESOLVED_FOR_CARRIER_RATE) {
    return { probability: config.defaultRecoveryProb, basis: 'default', resolved };
  }
  return { probability: (recovered + 1) / (resolved + 2), basis: 'carrierHistory', resolved };
}

export function priceClaim(statutoryEur: number, carrier: string): PriceBreakdown {
  const { probability, basis, resolved } = recoveryProbability(carrier);

  const expectedGrossEur = statutoryEur * probability;
  const expectedNetEur = expectedGrossEur - config.collectionCostEur;
  const marginEur = Math.max(expectedNetEur, 0) * (config.targetMarginBps / 10000);
  const purchasePriceEur = Math.max(expectedNetEur - marginEur, 0);

  const round2 = (n: number) => Math.round(n * 100) / 100;

  return {
    statutoryEur,
    recoveryProbability: probability,
    recoveryBasis: basis,
    resolvedClaims: resolved,
    expectedGrossEur: round2(expectedGrossEur),
    collectionCostEur: config.collectionCostEur,
    expectedNetEur: round2(expectedNetEur),
    marginBps: config.targetMarginBps,
    marginEur: round2(marginEur),
    purchasePriceEur: round2(purchasePriceEur),
  };
}

/** cUSD has 6 decimals; EUR amounts are treated 1:1 with the settlement unit. */
export function eurToUnits(eur: number): bigint {
  return BigInt(Math.round(eur * 1e6));
}

export function unitsToEur(units: bigint): number {
  return Number(units) / 1e6;
}
