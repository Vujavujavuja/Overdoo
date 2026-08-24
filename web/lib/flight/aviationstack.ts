import type { FlightPhase, FlightProvider, ProviderResult } from "./types";
import { aviationStackTimeToUtc } from "./tz";

/** Only the fields we read. */
interface Endpoint {
  iata?: string;
  icao?: string;
  timezone?: string;
  scheduled?: string;
  actual?: string;
  actual_runway?: string;
}

interface AviationStackFlight {
  flight_date?: string;
  flight_status?: string;
  departure?: Endpoint;
  arrival?: Endpoint;
  flight?: { icao?: string };
}

interface AviationStackResponse {
  data?: AviationStackFlight[];
  error?: { message?: string; info?: string };
}

function mapStatus(raw: string | undefined): FlightPhase {
  switch ((raw ?? '').toLowerCase()) {
    case 'landed':
      return 'landed';
    case 'active':
      return 'active';
    case 'cancelled':
      return 'cancelled';
    case 'diverted':
      return 'diverted';
    default:
      return 'scheduled';
  }
}

export function aviationStack(apiKey: string | undefined): FlightProvider {
  return {
    name: 'aviationstack',
    configured: Boolean(apiKey),

    async fetch(carrier, flightNumber, dateISO): Promise<ProviderResult> {
      // The free tier is HTTP-only and rejects the flight_date filter, so we ask
      // for the flight and select the right date ourselves.
      const url =
        `http://api.aviationstack.com/v1/flights` +
        `?access_key=${apiKey}&flight_iata=${carrier}${flightNumber}&limit=100`;

      const res = await fetch(url);
      const raw = await res.text();

      if (!res.ok) {
        return { status: null, raw, source: 'aviationstack', error: `HTTP ${res.status}` };
      }

      let parsed: AviationStackResponse;
      try {
        parsed = JSON.parse(raw);
      } catch {
        return { status: null, raw, source: 'aviationstack', error: 'unparseable body' };
      }

      if (parsed.error) {
        return {
          status: null,
          raw,
          source: 'aviationstack',
          error: parsed.error?.message ?? parsed.error?.info ?? 'api error',
        };
      }

      const rows: AviationStackFlight[] = Array.isArray(parsed.data) ? parsed.data : [];
      const f = rows.find((r) => r.flight_date === dateISO);
      if (!f) {
        return { status: null, raw, source: 'aviationstack', error: `no row for ${dateISO}` };
      }

      const depTz: string | undefined = f.departure?.timezone;
      const arrTz: string | undefined = f.arrival?.timezone;

      const scheduledDeparture = aviationStackTimeToUtc(f.departure?.scheduled, depTz);
      const scheduledArrival = aviationStackTimeToUtc(f.arrival?.scheduled, arrTz);
      if (!scheduledDeparture || !scheduledArrival) {
        return { status: null, raw, source: 'aviationstack', error: 'missing scheduled times' };
      }

      const gate = aviationStackTimeToUtc(f.arrival?.actual, arrTz);
      const runway = aviationStackTimeToUtc(f.arrival?.actual_runway, arrTz);

      return {
        source: 'aviationstack',
        raw,
        status: {
          carrier,
          flightNumber,
          depAirport: f.departure?.iata ?? '',
          arrAirport: f.arrival?.iata ?? '',
          scheduledDeparture,
          scheduledArrival,
          actualArrival: gate ?? runway,
          status: mapStatus(f.flight_status),
          arrivalIsRunwayTime: !gate && Boolean(runway),
          providerDistanceKm: null,
          callSign: f.flight?.icao ?? null,
          arrAirportIcao: f.arrival?.icao ?? null,
          source: 'aviationstack',
        },
      };
    },
  };
}
