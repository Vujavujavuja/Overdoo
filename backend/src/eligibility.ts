import { airport, isEuEeaCh, distanceBetween } from './airports.js';
import { isEuLicensedCarrier } from './carriers.js';

export type DisruptionKind = 'delay' | 'cancellation' | 'deniedBoarding';

export interface EligibilityInput {
  carrier: string;
  depAirport: string;
  arrAirport: string;
  scheduledArrival: Date;
  actualArrival: Date | null;
  kind: DisruptionKind;
  /** Cancellations notified 14+ days ahead carry no compensation. */
  cancellationNoticeDays?: number;
  /** Article 7(2) only bites when the carrier re-routed under Article 8. */
  wasRerouted?: boolean;
  /** True when arrival came from runway/wheels-down rather than gate time. */
  arrivalTimeApproximate?: boolean;
}

export interface EligibilityResult {
  eligible: boolean;
  statutoryAmountEur: number;
  reason: string;
  distanceKm: number | null;
  delayMinutes: number | null;
  arrivalTimeApproximate: boolean;
  /** Which limb of Article 3 brought this flight into scope. */
  scopeBasis: 'departureInEu' | 'arrivalInEuWithEuCarrier' | 'outOfScope';
}

/** Minutes of arrival delay that trigger compensation under Sturgeon (C-402/07). */
export const DELAY_THRESHOLD_MIN = 180;

/**
 * Article 7(1) base tiers.
 *   <=1500 km                                     -> EUR 250
 *   intra-EU >1500 km, or any other 1500-3500 km  -> EUR 400
 *   everything else (>3500 km, not intra-EU)      -> EUR 600
 */
export function baseAmountEur(distanceKm: number, intraEu: boolean): number {
  if (distanceKm <= 1500) return 250;
  if (intraEu) return 400;
  if (distanceKm <= 3500) return 400;
  return 600;
}

/**
 * Article 7(2): compensation halves only where the carrier offered re-routing
 * under Article 8 AND the re-routed arrival beat the relevant threshold.
 *
 * This does NOT apply to a plain long delay. Sturgeon (C-402/07) and Nelson
 * (C-581/10) award the full Article 7(1) amount at three hours' arrival delay
 * regardless of distance, so a 3h05 delay on a 6000 km route is EUR 600, not
 * EUR 300. Treating it as EUR 300 would systematically underpay long-haul
 * passengers, which is the single most valuable claim class.
 */
export function reroutingReductionApplies(
  distanceKm: number,
  intraEu: boolean,
  delayMinutes: number,
  wasRerouted: boolean,
): boolean {
  if (!wasRerouted) return false;
  if (distanceKm <= 1500) return delayMinutes < 120;
  if (intraEu || distanceKm <= 3500) return delayMinutes < 180;
  return delayMinutes < 240;
}

export function assessEligibility(input: EligibilityInput): EligibilityResult {
  const dep = airport(input.depAirport);
  const arr = airport(input.arrAirport);
  const distanceKm = distanceBetween(input.depAirport, input.arrAirport);

  const base = {
    distanceKm,
    arrivalTimeApproximate: Boolean(input.arrivalTimeApproximate),
  };

  if (!dep || !arr || distanceKm === null) {
    return {
      ...base,
      eligible: false,
      statutoryAmountEur: 0,
      delayMinutes: null,
      reason: `Unknown airport (${input.depAirport} -> ${input.arrAirport})`,
      scopeBasis: 'outOfScope',
    };
  }

  // --- Article 3: territorial scope -------------------------------------
  const depInEu = isEuEeaCh(dep.country);
  const arrInEu = isEuEeaCh(arr.country);
  const euCarrier = isEuLicensedCarrier(input.carrier);

  let scopeBasis: EligibilityResult['scopeBasis'] = 'outOfScope';
  if (depInEu) scopeBasis = 'departureInEu';
  else if (arrInEu && euCarrier) scopeBasis = 'arrivalInEuWithEuCarrier';

  if (scopeBasis === 'outOfScope') {
    return {
      ...base,
      eligible: false,
      statutoryAmountEur: 0,
      delayMinutes: null,
      reason: arrInEu
        ? `Arrival in EU but ${input.carrier} is not an EU-licensed carrier (Art. 3(1)(b))`
        : `Neither departure (${dep.country}) nor arrival (${arr.country}) is in the EU/EEA/CH`,
      scopeBasis,
    };
  }

  const intraEu = depInEu && arrInEu;
  const amount = baseAmountEur(distanceKm, intraEu);

  // --- Cancellation -----------------------------------------------------
  if (input.kind === 'cancellation') {
    const notice = input.cancellationNoticeDays ?? 0;
    if (notice >= 14) {
      return {
        ...base,
        eligible: false,
        statutoryAmountEur: 0,
        delayMinutes: null,
        reason: `Cancellation notified ${notice} days ahead (Art. 5(1)(c) requires under 14)`,
        scopeBasis,
      };
    }
    return {
      ...base,
      eligible: true,
      statutoryAmountEur: amount,
      delayMinutes: null,
      reason: `Cancellation with ${notice} days' notice, ${Math.round(distanceKm)} km${intraEu ? ' intra-EU' : ''} (Art. 5 + Art. 7(1))`,
      scopeBasis,
    };
  }

  // --- Denied boarding --------------------------------------------------
  if (input.kind === 'deniedBoarding') {
    return {
      ...base,
      eligible: true,
      statutoryAmountEur: amount,
      delayMinutes: null,
      reason: `Denied boarding, ${Math.round(distanceKm)} km (Art. 4(3) + Art. 7(1))`,
      scopeBasis,
    };
  }

  // --- Long delay -------------------------------------------------------
  if (!input.actualArrival) {
    return {
      ...base,
      eligible: false,
      statutoryAmountEur: 0,
      delayMinutes: null,
      reason: 'Flight has not arrived yet',
      scopeBasis,
    };
  }

  const delayMinutes = Math.round(
    (input.actualArrival.getTime() - input.scheduledArrival.getTime()) / 60000,
  );

  if (delayMinutes < DELAY_THRESHOLD_MIN) {
    return {
      ...base,
      eligible: false,
      delayMinutes,
      statutoryAmountEur: 0,
      reason: `Arrival delay ${delayMinutes} min is under the 180 min threshold (Sturgeon C-402/07)`,
      scopeBasis,
    };
  }

  const halved = reroutingReductionApplies(
    distanceKm,
    intraEu,
    delayMinutes,
    Boolean(input.wasRerouted),
  );

  return {
    ...base,
    eligible: true,
    delayMinutes,
    statutoryAmountEur: halved ? amount / 2 : amount,
    reason: halved
      ? `Delay ${delayMinutes} min, ${Math.round(distanceKm)} km, re-routed under Art. 8 within threshold: Art. 7(2) halves EUR ${amount}`
      : `Arrival delay ${delayMinutes} min >= 180, ${Math.round(distanceKm)} km${intraEu ? ' intra-EU' : ''} (Art. 7(1) + Sturgeon C-402/07)`,
    scopeBasis,
  };
}

/** EU261 measures arrival as door-open (Germanwings C-452/13). Runway time
 *  under-reports it, so add taxi-in when that is all we have. */
export const TAXI_IN_MINUTES = 5;

export function adjustRunwayToGate(runwayArrival: Date): Date {
  return new Date(runwayArrival.getTime() + TAXI_IN_MINUTES * 60_000);
}
