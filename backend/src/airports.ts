import { readFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export interface Airport {
  iata: string;
  icao: string;
  lat: number;
  lon: number;
  country: string; // ISO 3166-1 alpha-2
  name: string;
}

/**
 * EU + EEA + Switzerland, by ISO country code. This is a legal fact, not data:
 * it defines Regulation 261/2004's territorial scope, so it is hardcoded and
 * versioned with the code rather than fetched.
 *
 * Includes the French overseas departments and other outermost regions, which
 * are inside EU law and carry their own ISO codes. Excludes GB: post-Brexit the
 * UK operates its own UK261 and is out of scope here.
 */
export const EU_EEA_CH = new Set([
  // EU-27
  'AT','BE','BG','HR','CY','CZ','DK','EE','FI','FR','DE','GR','HU','IE','IT',
  'LV','LT','LU','MT','NL','PL','PT','RO','SK','SI','ES','SE',
  // EEA
  'IS','LI','NO',
  // Switzerland (bilateral agreement)
  'CH',
  // Outermost regions inside EU law
  'GP','MQ','GF','RE','YT','MF','BL',
]);

export function isEuEeaCh(country: string | undefined): boolean {
  return Boolean(country) && EU_EEA_CH.has(country!.toUpperCase());
}

/** Split one CSV line, honouring double-quoted fields. */
function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = '';
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      out.push(cur);
      cur = '';
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

const CSV_PATH = resolve(dirname(fileURLToPath(import.meta.url)), '../data/airports.csv');

let byIata: Map<string, Airport> | null = null;

export function loadAirports(): Map<string, Airport> {
  if (byIata) return byIata;
  if (!existsSync(CSV_PATH)) {
    throw new Error(
      `airports.csv missing at ${CSV_PATH}. Run: pnpm --filter @aeroclaim/backend fetch-airports`,
    );
  }

  const text = readFileSync(CSV_PATH, 'utf8');
  const lines = text.split('\n');
  const header = splitCsvLine(lines[0]).map((h) => h.replace(/"/g, ''));
  const idx = (name: string) => header.indexOf(name);

  const iIata = idx('iata_code');
  const iIcao = idx('icao_code');
  const iLat = idx('latitude_deg');
  const iLon = idx('longitude_deg');
  const iCountry = idx('iso_country');
  const iName = idx('name');

  const map = new Map<string, Airport>();
  for (let i = 1; i < lines.length; i++) {
    if (!lines[i]) continue;
    const f = splitCsvLine(lines[i]).map((v) => v.replace(/^"|"$/g, ''));
    const iata = f[iIata];
    if (!iata || iata.length !== 3) continue;
    const lat = Number(f[iLat]);
    const lon = Number(f[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    map.set(iata.toUpperCase(), {
      iata: iata.toUpperCase(),
      icao: (f[iIcao] || '').toUpperCase(),
      lat,
      lon,
      country: (f[iCountry] || '').toUpperCase(),
      name: f[iName] || '',
    });
  }

  byIata = map;
  return map;
}

export function airport(iata: string): Airport | undefined {
  return loadAirports().get(iata.toUpperCase());
}

const R_KM = 6371;
const toRad = (deg: number) => (deg * Math.PI) / 180;

/** Great-circle distance in km. EU261 measures this between first departure and
 *  final destination, not the flown track. */
export function haversineKm(
  aLat: number,
  aLon: number,
  bLat: number,
  bLon: number,
): number {
  const dLat = toRad(bLat - aLat);
  const dLon = toRad(bLon - aLon);
  const lat1 = toRad(aLat);
  const lat2 = toRad(bLat);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.sin(dLon / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R_KM * Math.asin(Math.sqrt(h));
}

export function distanceBetween(depIata: string, arrIata: string): number | null {
  const a = airport(depIata);
  const b = airport(arrIata);
  if (!a || !b) return null;
  return haversineKm(a.lat, a.lon, b.lat, b.lon);
}
