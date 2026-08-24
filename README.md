# Overdoo

Parametric flight delay insurance on Monad.

Insure a flight before you fly. If it lands three hours or more late, Regulation
(EC) 261/2004 says the airline owes you €250–€600. Overdoo pays that out
automatically from an on-chain policy — no claim form, no airline, no waiting.

Flight outcomes come from live commercial flight-status APIs, are attested
on-chain by a signing oracle, and settle against a pre-funded reserve.

```
web/         Next.js app — UI, EU261 rules engine, flight APIs, settlement routes
contracts/   Foundry — DelayCover, FlightOracle, CapitalPool, ClaimRegistry, Settlement
```

There is **no server to run**. The rules engine and settlement logic live in
Next.js API routes, so `web/` is the entire deployable app.

---

## Quick start

```bash
pnpm install
cd contracts && forge test        # 39 passing
cd ../web && npm run dev
```

Copy `.env.example` to `web/.env.local` and fill it in. You need a free key from
[AeroDataBox](https://rapidapi.com/aedbx-aedbx/api/aerodatabox) or
[AviationStack](https://aviationstack.com), plus a funded Monad testnet key from
the [faucet](https://faucet.monad.xyz).

To find flights to test with:

```bash
pnpm find-delayed -- EDDF,LEMD,LFPG 2026-08-21
```

Without a flight-data key the app refuses to answer rather than inventing a
result. See [GUIDE.md](GUIDE.md) for deployment and a demo script.

---

## How it works

**1. Quote.** You enter a flight. The app resolves it across AeroDataBox and
AviationStack, computes great-circle distance over the OurAirports dataset, and
prices cover at the Article 7 tier for that distance. The delay is deliberately
**not** shown — you are buying before you know.

**2. Buy.** `DelayCover.buy()` takes a premium in native MON (8% of cover) and
records the policy. No oracle is involved: nothing has happened to the flight
yet, so there is nothing to verify.

**3. Settle.** Once the flight lands, the outcome is signed by an attestor and
written to `FlightOracle`. `DelayCover.settle()` reads it and pays out if the
arrival delay is 180 minutes or more, or the flight was cancelled. Settlement is
public — anyone can trigger it, and the oracle decides, not the caller.

### EU261, implemented as written

| Distance | Compensation |
|---|---|
| ≤ 1500 km | €250 |
| Intra-EU > 1500 km, or 1500–3500 km | €400 |
| > 3500 km | €600 |

Scope follows Article 3: departure inside the EU/EEA/CH, **or** arrival inside it
on an EU-licensed carrier. A Newark→Frankfurt flight delayed four hours on United
is out of scope; the same delay on Lufthansa is not.

Two points worth flagging, because both are commonly got wrong:

- **Article 7(2)'s 50% reduction applies only on re-routing under Article 8.** It
  does not apply to a plain long delay. Under *Sturgeon* (C-402/07) and *Nelson*
  (C-581/10) a 3h05 delay on a 6000 km route is €600, not €300.
- **Arrival means door-open**, per *Germanwings* (C-452/13). Where a provider
  reports only runway time, taxi-in is added and the figure marked approximate.

### The timezone bug worth knowing about

AviationStack emits airport-**local** wall-clock time stamped `+00:00`. Taken at
face value every timestamp is wrong by the airport's UTC offset — two hours at
Frankfurt in summer — which would corrupt delay minutes and therefore payouts.
`lib/flight/tz.ts` reinterprets those readings in the airport's IANA zone. The
cross-provider agreement check is what surfaced it.

---

## Contracts (Monad testnet, chain 10143)

| Contract | Address |
|---|---|
| DelayCover | `0xCC79e1e952B4ddb104c9166e47A9F289533a6DC1` |
| FlightOracle | `0xecEb2252024D77512d38bfcF4141658Ea12BC872` |
| CapitalPool | `0xbbb3A3d20A0267b4143f4cD91EFbf4639c870670` |
| ClaimRegistry | `0x2C5aa6422cc2d6232Bf7Ef5ae69E5dd9D24A886f` |
| Settlement | `0x5B03838e92949a8566CD1C7f71b96058bEbAfF55` |

Explorer: https://testnet.monadvision.com

`CapitalPool`, `ClaimRegistry` and `Settlement` implement the underwriting and
claim-purchase side — deployed and tested, but not wired to the current UI, which
uses `DelayCover`'s own reserve.

Amounts are scaled for testnet: **€1 = 0.0001 MON**. A €400 policy pays 0.04 MON
for a 0.0032 MON premium.

---

## Known limitations

These are real and stated rather than hidden.

**Cover can be bought on a flight that has already landed.** `buy()` does not
check departure time, so the demo lets you insure a known-delayed flight. The fix
is a server-signed quote carrying `scheduledDeparture` and an expiry, verified
on-chain — which also stops a buyer naming their own cover amount.

**The oracle threshold is 1, not 2.** The design wants two independent providers
to agree before money moves. AviationStack's free tier returns `actual: null` for
most flights and OpenSky removed anonymous historical access, so only AeroDataBox
reports arrival times in practice. The UI states when a flight is single-source.
Restoring 2-of-2 needs an OpenSky account or a paid AviationStack tier.

**Payouts come from a pre-funded reserve**, not underwriters. `DelayCover` refuses
to sell cover it cannot honour, but the reserve is deployer-funded.

**Nothing is persisted.** No database, so carrier-specific recovery rates always
fall back to the 65% default.

---

## Monad specifics

- **Gas is charged on `gas_limit`, not `gas_used`.** Set limits explicitly where
  the cost is known; a wallet that gives up on estimation and sets a huge limit
  costs the user the full amount.
- **Use a high-limit RPC.** `testnet-rpc.monad.xyz` throttles at 15 req/sec and
  returns the refusal as a JSON-RPC error inside an HTTP 200, which retry logic
  does not catch. Ankr allows 300 per 10s.
- **Cold storage/account access costs ~4x Ethereum** (8,100 / 10,100 gas).
- **`TIMESTAMP` is second-granularity** but blocks are 400ms, so several
  consecutive blocks share one timestamp.
