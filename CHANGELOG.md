# Changelog

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versions follow [Semantic Versioning](https://semver.org/).

## [Unreleased]

## [0.1.0] — 2026-08-24

First public release. Built at [Monad Blitz](https://blitz.devnads.com), placed
2nd.

### Added

- **`DelayCover`** — buy cover on a flight, paid out automatically if it lands
  three or more hours late, or is cancelled. Denominated in native MON.
- **`FlightOracle`** — EIP-712 threshold-signed flight attestations with
  duplicate-signer protection via enforced ascending signer order.
- **`CapitalPool`** — underwriter capital where a write-off cuts share price in
  the same transaction, so losses cannot be deferred or restated.
- **`ClaimRegistry`** and **`Settlement`** — claim-purchase side. Deployed and
  tested; not wired to the current UI.
- **EU261 rules engine** implementing Articles 3, 5 and 7, including *Sturgeon*
  (C-402/07) for the three-hour rule and *Germanwings* (C-452/13) for door-open
  arrival time.
- **Two-provider flight resolution** across AeroDataBox and AviationStack, with
  agreement measured on actual arrival within a 15-minute window.
- Great-circle distance over the OurAirports dataset, bundled at build time.
- Next.js app with the entire backend in API routes — one deploy, no server.
- 39 contract tests.

### Fixed

- **AviationStack emits airport-local wall-clock time stamped `+00:00`.** Parsed
  literally, every timestamp was wrong by the airport's UTC offset — two hours at
  Frankfurt — which shifted delay minutes across the payout threshold. Now
  reinterpreted in the airport's IANA zone.
- AeroDataBox often omits `arrival.actualTime`; the real chain is
  `actualTime ?? runwayTime ?? revisedTime`.
- The airport-schedule endpoint nests times under `movement`, not
  `arrival`/`departure`.

### Known limitations

Documented in full in the README:

- Cover can be bought on a flight that has already landed.
- Oracle threshold is 1, not 2 — only AeroDataBox reliably reports arrivals on
  the free tiers available.
- Payouts come from a pre-funded reserve, not underwriters.
- No persistence, so carrier recovery rates always use the default.

[Unreleased]: https://github.com/Vujavujavuja/monad-blitz/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/Vujavujavuja/monad-blitz/releases/tag/v0.1.0
