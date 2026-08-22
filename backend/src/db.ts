import { DatabaseSync } from 'node:sqlite';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { mkdirSync } from 'node:fs';

const dataDir = resolve(dirname(fileURLToPath(import.meta.url)), '../data');
mkdirSync(dataDir, { recursive: true });

// node:sqlite is built into Node 22+/24, so there is no native module to build.
export const db = new DatabaseSync(resolve(dataDir, 'aeroclaim.db'));
db.exec('PRAGMA journal_mode = WAL');

db.exec(`
CREATE TABLE IF NOT EXISTS watched_flights (
  flight_key TEXT PRIMARY KEY, carrier TEXT, flight_number TEXT,
  dep_airport TEXT, arr_airport TEXT, scheduled_departure INTEGER,
  scheduled_arrival INTEGER, actual_arrival INTEGER, status TEXT,
  distance_km INTEGER, last_polled INTEGER, agreement INTEGER,
  flight_date TEXT, sources TEXT, arrival_approximate INTEGER DEFAULT 0);

CREATE TABLE IF NOT EXISTS raw_responses (
  id INTEGER PRIMARY KEY, flight_key TEXT, provider TEXT,
  body TEXT, sha256 TEXT, fetched_at INTEGER);

CREATE TABLE IF NOT EXISTS assignments (
  flight_key TEXT, passenger_address TEXT, passenger_name TEXT,
  document_text TEXT, document_hash TEXT, signature TEXT, signed_at INTEGER,
  claim_id INTEGER,
  PRIMARY KEY (flight_key, passenger_address));

CREATE TABLE IF NOT EXISTS collection_events (
  id INTEGER PRIMARY KEY, claim_id INTEGER, from_state TEXT, to_state TEXT,
  document TEXT, note TEXT, created_at INTEGER);

CREATE TABLE IF NOT EXISTS carrier_performance (
  carrier TEXT PRIMARY KEY, recovered INTEGER DEFAULT 0,
  written_off INTEGER DEFAULT 0, total_recovered_eur INTEGER DEFAULT 0);

CREATE INDEX IF NOT EXISTS idx_raw_flight ON raw_responses(flight_key);
CREATE INDEX IF NOT EXISTS idx_collection_claim ON collection_events(claim_id);
`);

export interface WatchedFlight {
  flight_key: string;
  carrier: string;
  flight_number: string;
  dep_airport: string;
  arr_airport: string;
  scheduled_departure: number;
  scheduled_arrival: number;
  actual_arrival: number | null;
  status: string;
  distance_km: number;
  last_polled: number;
  agreement: number;
  flight_date: string;
  sources: string;
  arrival_approximate: number;
}

export const upsertFlight = db.prepare(`
INSERT INTO watched_flights (flight_key, carrier, flight_number, dep_airport, arr_airport,
  scheduled_departure, scheduled_arrival, actual_arrival, status, distance_km,
  last_polled, agreement, flight_date, sources, arrival_approximate)
VALUES (@flight_key, @carrier, @flight_number, @dep_airport, @arr_airport,
  @scheduled_departure, @scheduled_arrival, @actual_arrival, @status, @distance_km,
  @last_polled, @agreement, @flight_date, @sources, @arrival_approximate)
ON CONFLICT(flight_key) DO UPDATE SET
  actual_arrival=excluded.actual_arrival, status=excluded.status,
  last_polled=excluded.last_polled, agreement=excluded.agreement,
  sources=excluded.sources, arrival_approximate=excluded.arrival_approximate`);

export const getFlight = db.prepare(
  `SELECT * FROM watched_flights WHERE flight_key = ?`,
);

export const listFlights = db.prepare(
  `SELECT * FROM watched_flights ORDER BY scheduled_arrival DESC LIMIT 100`,
);

export const insertRaw = db.prepare(`
INSERT INTO raw_responses (flight_key, provider, body, sha256, fetched_at)
VALUES (?, ?, ?, ?, ?)`);

export const rawFor = db.prepare(
  `SELECT provider, sha256, fetched_at FROM raw_responses WHERE flight_key = ? ORDER BY fetched_at DESC LIMIT 20`,
);

export const saveAssignment = db.prepare(`
INSERT INTO assignments (flight_key, passenger_address, passenger_name, document_text,
  document_hash, signature, signed_at, claim_id)
VALUES (@flight_key, @passenger_address, @passenger_name, @document_text,
  @document_hash, @signature, @signed_at, @claim_id)
ON CONFLICT(flight_key, passenger_address) DO UPDATE SET
  claim_id=excluded.claim_id, signature=excluded.signature, signed_at=excluded.signed_at`);

export const getAssignment = db.prepare(
  `SELECT * FROM assignments WHERE flight_key = ? AND lower(passenger_address) = lower(?)`,
);

export const getAssignmentByClaim = db.prepare(
  `SELECT * FROM assignments WHERE claim_id = ?`,
);

export const addCollectionEvent = db.prepare(`
INSERT INTO collection_events (claim_id, from_state, to_state, document, note, created_at)
VALUES (?, ?, ?, ?, ?, ?)`);

export const collectionEventsFor = db.prepare(
  `SELECT * FROM collection_events WHERE claim_id = ? ORDER BY created_at ASC`,
);

export const latestCollectionState = db.prepare(
  `SELECT to_state FROM collection_events WHERE claim_id = ? ORDER BY created_at DESC LIMIT 1`,
);

export const carrierPerf = db.prepare(
  `SELECT * FROM carrier_performance WHERE carrier = ?`,
);

export const bumpCarrier = db.prepare(`
INSERT INTO carrier_performance (carrier, recovered, written_off, total_recovered_eur)
VALUES (@carrier, @recovered, @written_off, @eur)
ON CONFLICT(carrier) DO UPDATE SET
  recovered = recovered + excluded.recovered,
  written_off = written_off + excluded.written_off,
  total_recovered_eur = total_recovered_eur + excluded.total_recovered_eur`);

// node:sqlite returns `unknown`; these wrappers restore the shapes callers expect.
export const allFlights = (): WatchedFlight[] => listFlights.all() as unknown as WatchedFlight[];
export const oneFlight = (key: string): WatchedFlight | undefined =>
  getFlight.get(key) as unknown as WatchedFlight | undefined;
export const onePerf = (carrier: string) =>
  carrierPerf.get(carrier) as unknown as
    | { carrier: string; recovered: number; written_off: number; total_recovered_eur: number }
    | undefined;
