import { encodePacked, keccak256, type Hex } from "viem";

export const DELAY_COVER_ADDRESS =
  "0xCC79e1e952B4ddb104c9166e47A9F289533a6DC1" as const;

/** Premium as a fraction of cover, matching DelayCover.premiumBps on chain. */
export const PREMIUM_BPS = 800n;

/** EUR are settled in native MON at this demo scale, so testnet funds last. */
export const MON_PER_EUR = 0.0001;

/** Must match the contract's key exactly: keccak256(carrier, number, schedDepUTC). */
export function flightKeyHash(
  carrier: string,
  flightNumber: string,
  scheduledDeparture: Date,
): Hex {
  return keccak256(
    encodePacked(
      ["string", "string", "uint64"],
      [
        carrier.toUpperCase(),
        flightNumber,
        BigInt(Math.floor(scheduledDeparture.getTime() / 1000)),
      ],
    ),
  );
}

export function eurToWei(eur: number): bigint {
  return BigInt(Math.round(eur * MON_PER_EUR * 1e18));
}

export function premiumFor(coverWei: bigint): bigint {
  return (coverWei * PREMIUM_BPS) / 10_000n;
}
