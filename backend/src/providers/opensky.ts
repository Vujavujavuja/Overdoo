import type { FlightProvider, ProviderResult } from './types.js';

/**
 * OpenSky corroboration.
 *
 * IMPORTANT LIMITATION, stated rather than hidden: OpenSky indexes by ADS-B
 * callsign (ICAO-style, e.g. "DLH3AH"), which does not map deterministically to
 * an IATA flight number (e.g. "LH1411"). There is no public lookup that closes
 * that gap reliably. So this provider can only corroborate a landing time when a
 * higher-tier provider has already told us the callsign and the arrival airport.
 *
 * It is therefore never a primary source and never counts toward the first two
 * agreeing providers on its own. Treating a fuzzy callsign match as an
 * independent confirmation would be exactly the kind of fake corroboration the
 * threshold oracle exists to prevent.
 */
export function openSky(): FlightProvider & {
  corroborateArrival(
    arrivalIcao: string,
    callSign: string,
    windowStart: Date,
    windowEnd: Date,
  ): Promise<{ actualArrival: Date | null; raw: string }>;
} {
  return {
    name: 'opensky',
    configured: true,

    async fetch(): Promise<ProviderResult> {
      return {
        status: null,
        raw: '',
        source: 'opensky',
        error: 'opensky cannot resolve a flight from an IATA number; corroboration only',
      };
    },

    async corroborateArrival(arrivalIcao, callSign, windowStart, windowEnd) {
      const begin = Math.floor(windowStart.getTime() / 1000);
      const end = Math.floor(windowEnd.getTime() / 1000);
      const url =
        `https://opensky-network.org/api/flights/arrival` +
        `?airport=${arrivalIcao}&begin=${begin}&end=${end}`;

      const res = await fetch(url);
      const raw = await res.text();
      if (!res.ok) return { actualArrival: null, raw };

      try {
        const rows: any[] = JSON.parse(raw);
        const wanted = callSign.replace(/\s+/g, '').toUpperCase();
        const hit = rows.find(
          (r) => (r.callsign ?? '').replace(/\s+/g, '').toUpperCase() === wanted,
        );
        if (!hit?.lastSeen) return { actualArrival: null, raw };
        return { actualArrival: new Date(hit.lastSeen * 1000), raw };
      } catch {
        return { actualArrival: null, raw };
      }
    },
  };
}
