/**
 * Operating carriers licensed in the EU/EEA/CH ("Community carriers").
 *
 * This matters for Article 3(1)(b): a flight ARRIVING in the EU from outside it
 * is only covered when the operating carrier is EU-licensed. A Serbia->Germany
 * flight on Lufthansa is covered; the same route on Air Serbia is not.
 *
 * Hardcoded because it is a licensing fact, not live data.
 */
export const EU_LICENSED_CARRIERS = new Set([
  'LH','LX','OS','SN','EN','WK', // Lufthansa Group
  'AF','KL','HV','TO', // Air France-KLM
  'IB','VY','I2','UX','YW', // IAG (Iberia/Vueling/Air Europa feed)
  'AY','SK','DY','D8','NO', // Finnair, SAS, Norwegian
  'AZ','ITA','FR','RK','EI', // ITA, Ryanair group, Aer Lingus
  'TP','A3','OA','OU','JU', // TAP, Aegean, Olympic, Croatia
  'LO','OK','RO','BT','FB', // LOT, CSA, TAROM, airBaltic, Bulgaria Air
  'W6','W4','W9', // Wizz Air group
  'EW','DE','X3','ST', // Eurowings, Condor, TUIfly
  'PC','XQ', // (Turkish low-cost, NOT EU — see note below)
  'KM','TB','SM', // Air Malta, TUI Belgium
  'FI','RC', // Icelandair, Atlantic Airways
  'U2','EC','DS', // easyJet Europe/Switzerland
]);

// Deliberately NOT EU-licensed, listed to make the exclusions explicit and
// reviewable rather than silent: BA/VS (UK, post-Brexit), TK/PC/XQ (Turkey),
// JU (Serbia), MS, QR, EK, AA, DL, UA.
const EXPLICITLY_NOT_EU = new Set(['BA','VS','TK','PC','XQ','JU','MS','QR','EK','AA','DL','UA','LO2']);

export function isEuLicensedCarrier(iata: string): boolean {
  const code = iata.toUpperCase();
  if (EXPLICITLY_NOT_EU.has(code)) return false;
  return EU_LICENSED_CARRIERS.has(code);
}
