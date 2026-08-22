export interface PriceBreakdown {
  statutoryEur: number;
  recoveryProbability: number;
  expectedGrossEur: number;
  collectionCostEur: number;
  expectedNetEur: number;
  marginEur: number;
  purchasePriceEur: number;
}

/**
 * No claim history is persisted in the deployed app, so every carrier prices at
 * the default recovery probability. Wiring a store back in would let this learn
 * per carrier; the formula is unchanged either way.
 */
export function priceClaim(statutoryEur: number): PriceBreakdown {
  const probability = Number(process.env.DEFAULT_RECOVERY_PROB ?? 0.65);
  const collectionCostEur = Number(process.env.COLLECTION_COST_EUR ?? 25);
  const marginBps = Number(process.env.TARGET_MARGIN_BPS ?? 1500);

  const expectedGrossEur = statutoryEur * probability;
  const expectedNetEur = expectedGrossEur - collectionCostEur;
  const marginEur = Math.max(expectedNetEur, 0) * (marginBps / 10000);
  const purchasePriceEur = Math.max(expectedNetEur - marginEur, 0);
  const r2 = (n: number) => Math.round(n * 100) / 100;

  return {
    statutoryEur,
    recoveryProbability: probability,
    expectedGrossEur: r2(expectedGrossEur),
    collectionCostEur,
    expectedNetEur: r2(expectedNetEur),
    marginEur: r2(marginEur),
    purchasePriceEur: r2(purchasePriceEur),
  };
}
