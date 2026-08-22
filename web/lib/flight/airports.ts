import data from "../airports.json";

export interface Airport {
  iata: string;
  icao: string;
  lat: number;
  lon: number;
  country: string;
}

/** [lat, lon, isoCountry, icao], pre-compacted at build time from OurAirports. */
const TABLE = data as unknown as Record<string, [number, number, string, string]>;

/**
 * EU + EEA + Switzerland by ISO country code. A legal fact defining Regulation
 * 261/2004's territorial scope, so it lives in code rather than in data.
 * Includes the outermost regions; excludes GB, which runs its own UK261.
 */
export const EU_EEA_CH = new Set([
  "AT","BE","BG","HR","CY","CZ","DK","EE","FI","FR","DE","GR","HU","IE","IT",
  "LV","LT","LU","MT","NL","PL","PT","RO","SK","SI","ES","SE",
  "IS","LI","NO","CH",
  "GP","MQ","GF","RE","YT","MF","BL",
]);

export function isEuEeaCh(country: string | undefined): boolean {
  return Boolean(country) && EU_EEA_CH.has(country!.toUpperCase());
}

export function airport(iata: string): Airport | undefined {
  const row = TABLE[iata.toUpperCase()];
  if (!row) return undefined;
  return { iata: iata.toUpperCase(), lat: row[0], lon: row[1], country: row[2], icao: row[3] };
}

const R_KM = 6371;
const toRad = (deg: number) => (deg * Math.PI) / 180;

export function haversineKm(aLat: number, aLon: number, bLat: number, bLon: number): number {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.sin(dLon / 2) ** 2 * Math.cos(toRad(aLat)) * Math.cos(toRad(bLat));
  return 2 * R_KM * Math.asin(Math.sqrt(h));
}

export function distanceBetween(depIata: string, arrIata: string): number | null {
  const a = airport(depIata);
  const b = airport(arrIata);
  if (!a || !b) return null;
  return haversineKm(a.lat, a.lon, b.lat, b.lon);
}
