export type FlightPhase =
  | 'scheduled'
  | 'active'
  | 'landed'
  | 'cancelled'
  | 'diverted';

export interface FlightStatus {
  carrier: string; // IATA, e.g. "LH"
  flightNumber: string; // e.g. "1411"
  depAirport: string; // IATA
  arrAirport: string; // IATA
  scheduledDeparture: Date;
  scheduledArrival: Date;
  actualArrival: Date | null;
  status: FlightPhase;
  /** Set when the provider gave us runway/wheels-down rather than gate arrival. */
  arrivalIsRunwayTime: boolean;
  /** Great-circle km, when the provider supplies it. We compute our own too. */
  providerDistanceKm: number | null;
  /** ADS-B callsign, e.g. "DLH4TP". Needed to reach OpenSky. */
  callSign: string | null;
  /** ICAO of the arrival airport, e.g. "EDDF". */
  arrAirportIcao: string | null;
  source: string;
}

export interface ProviderResult {
  status: FlightStatus | null;
  raw: string;
  source: string;
  error?: string;
}

export interface FlightProvider {
  readonly name: string;
  readonly configured: boolean;
  fetch(carrier: string, flightNumber: string, dateISO: string): Promise<ProviderResult>;
}

/** AeroDataBox emits "2026-08-22 11:40Z"; JS needs the T. */
export function parseUtc(value: string | undefined | null): Date | null {
  if (!value) return null;
  const normalised = value.includes('T') ? value : value.replace(' ', 'T');
  const d = new Date(normalised);
  return Number.isNaN(d.getTime()) ? null : d;
}
