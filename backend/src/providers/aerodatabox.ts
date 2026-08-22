import { createHash } from 'node:crypto';
import { parseUtc, type FlightProvider, type FlightPhase, type ProviderResult } from './types.js';

const HOST = 'aerodatabox.p.rapidapi.com';

/** AeroDataBox status vocabulary -> our phases. */
function mapStatus(raw: string | undefined): FlightPhase {
  switch ((raw ?? '').toLowerCase()) {
    case 'arrived':
      return 'landed';
    case 'canceled':
    case 'cancelled':
      return 'cancelled';
    case 'diverted':
      return 'diverted';
    case 'enroute':
    case 'departed':
    case 'approaching':
      return 'active';
    default:
      return 'scheduled';
  }
}

export function aeroDataBox(apiKey: string | undefined): FlightProvider {
  return {
    name: 'aerodatabox',
    configured: Boolean(apiKey),

    async fetch(carrier, flightNumber, dateISO): Promise<ProviderResult> {
      const url = `https://${HOST}/flights/number/${carrier}${flightNumber}/${dateISO}`;
      const res = await fetch(url, {
        headers: { 'x-rapidapi-host': HOST, 'x-rapidapi-key': apiKey! },
      });
      const raw = await res.text();

      if (!res.ok) {
        return { status: null, raw, source: 'aerodatabox', error: `HTTP ${res.status}` };
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return { status: null, raw, source: 'aerodatabox', error: 'unparseable body' };
      }

      // A rate-limit or "not found" arrives as an object with `message`, not an array.
      if (!Array.isArray(parsed) || parsed.length === 0) {
        const message =
          typeof parsed === 'object' && parsed && 'message' in parsed
            ? String((parsed as { message: unknown }).message)
            : 'no flight returned';
        return { status: null, raw, source: 'aerodatabox', error: message };
      }

      const f = parsed[0] as any;

      // This provider does not always populate actualTime even for landed flights;
      // runwayTime and revisedTime are the real-world fallbacks.
      const gate = parseUtc(f.arrival?.actualTime?.utc);
      const runway = parseUtc(f.arrival?.runwayTime?.utc);
      const revised = parseUtc(f.arrival?.revisedTime?.utc);
      const actualArrival = gate ?? runway ?? revised;

      const scheduledDeparture = parseUtc(f.departure?.scheduledTime?.utc);
      const scheduledArrival = parseUtc(f.arrival?.scheduledTime?.utc);
      if (!scheduledDeparture || !scheduledArrival) {
        return { status: null, raw, source: 'aerodatabox', error: 'missing scheduled times' };
      }

      return {
        source: 'aerodatabox',
        raw,
        status: {
          carrier,
          flightNumber,
          depAirport: f.departure?.airport?.iata ?? '',
          arrAirport: f.arrival?.airport?.iata ?? '',
          scheduledDeparture,
          scheduledArrival,
          actualArrival,
          status: mapStatus(f.status),
          arrivalIsRunwayTime: !gate && Boolean(runway ?? revised),
          providerDistanceKm: f.greatCircleDistance?.km ?? null,
          callSign: (f.callSign ?? null) || null,
          arrAirportIcao: f.arrival?.airport?.icao ?? null,
          source: 'aerodatabox',
        },
      };
    },
  };
}

export function sha256(body: string): string {
  return createHash('sha256').update(body).digest('hex');
}
