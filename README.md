<p align="center">
  <img src="docs/banner.png" alt="Overdoo" width="100%">
</p>

<p align="center">
  <strong>Parametric flight delay insurance on Monad.</strong><br>
  Insure your flight. If it lands three hours late, you're paid before you leave the airport.
</p>

<p align="center">
  <a href="#quick-start">Quick start</a> ·
  <a href="#how-it-works">How it works</a> ·
  <a href="#known-limitations">Limitations</a> ·
  <a href="#monad-blitz">Monad Blitz</a>
</p>

---

EU Regulation 261/2004 says a three-hour flight delay owes you €250–€600. Almost
nobody collects — the process is slow, adversarial, and most passengers don't
know the right exists.

Overdoo sells you cover before you fly. If the flight lands late, live flight
data is attested on-chain and the policy pays out automatically. No claim form,
no airline, no waiting months.

```
web/         Next.js app — UI, EU261 rules engine, flight APIs, settlement routes
contracts/   Foundry — DelayCover, FlightOracle, CapitalPool, ClaimRegistry, Settlement
```

There is **no server to run**. The rules engine and settlement logic live in
Next.js API routes, so `web/` is the whole deployable app.

---

## Quick start

```bash
pnpm install
cd contracts && forge test        # 39 passing
cd ../web && npm run dev
```

Copy `.env.example` to `web/.env.local` and fill it in. You need a free key from
[AeroDataBox](https://rapidapi.com/aedbx-aedbx/api/aerodatabox) or
[AviationStack](https://aviationstack.com), plus a funded testnet key.

Without a flight-data key the app returns an error rather than inventing a
result. To find real delayed flights to test with:

```bash
pnpm find-delayed -- EDDF,LEMD,LFPG 2026-08-21
```

Deployment and a demo script are in [GUIDE.md](GUIDE.md).

---

## How it works

**1. Quote.** You enter a flight. The app resolves it across AeroDataBox and
AviationStack, computes great-circle distance over the OurAirports dataset, and
prices cover at the Article 7 tier for that distance. The delay is deliberately
**not shown** — you are buying before you know.

**2. Buy.** `DelayCover.buy()` takes a premium in native MON (8% of cover) and
records the policy. No oracle is involved: nothing has happened to the flight
yet, so there is nothing to verify.

**3. Settle.** Once the flight lands, the outcome is signed by an attestor and
written to `FlightOracle`. `DelayCover.settle()` reads it and pays out if arrival
delay is ≥180 minutes, or the flight was cancelled. Settlement is public — anyone
can trigger it, and the oracle decides, not the caller.

### EU261, implemented as written

| Distance | Compensation |
|---|---|
| ≤ 1500 km | €250 |
| Intra-EU > 1500 km, or 1500–3500 km | €400 |
| > 3500 km | €600 |

Scope follows Article 3: departure inside the EU/EEA/CH, **or** arrival inside it
on an EU-licensed carrier. Newark→Frankfurt delayed four hours on United is out
of scope; the same delay on Lufthansa is not.

Two points commonly got wrong, both handled here:

- **Article 7(2)'s 50% reduction applies only on re-routing under Article 8.** Not
  to a plain long delay. Under *Sturgeon* (C-402/07) and *Nelson* (C-581/10), a
  3h05 delay on a 6000 km route is €600, not €300.
- **Arrival means door-open**, per *Germanwings* (C-452/13). Where a provider
  reports only runway time, taxi-in is added and the figure marked approximate.

### The timezone bug worth knowing about

AviationStack emits airport-**local** wall-clock time stamped `+00:00`. Taken at
face value every timestamp is wrong by the airport's UTC offset — two hours at
Frankfurt in summer — which would corrupt delay minutes and therefore payouts.
[`lib/flight/tz.ts`](web/lib/flight/tz.ts) reinterprets those readings in the
airport's IANA zone. The cross-provider agreement check is what surfaced it.

---

## Contracts

Monad testnet, chain `10143`. Explorer: [testnet.monadvision.com](https://testnet.monadvision.com)

| Contract | Address |
|---|---|
| DelayCover | `0xCC79e1e952B4ddb104c9166e47A9F289533a6DC1` |
| FlightOracle | `0xecEb2252024D77512d38bfcF4141658Ea12BC872` |
| CapitalPool | `0xbbb3A3d20A0267b4143f4cD91EFbf4639c870670` |
| ClaimRegistry | `0x2C5aa6422cc2d6232Bf7Ef5ae69E5dd9D24A886f` |
| Settlement | `0x5B03838e92949a8566CD1C7f71b96058bEbAfF55` |

`CapitalPool`, `ClaimRegistry` and `Settlement` implement the underwriting and
claim-purchase side — deployed and tested, but not wired to the current UI, which
uses `DelayCover`'s own reserve.

Amounts are scaled for testnet: **€1 = 0.0001 MON**. A €400 policy pays 0.04 MON
for a 0.0032 MON premium.

---

## Known limitations

Stated rather than hidden.

**Cover can be bought on a flight that has already landed.** `buy()` does not
check departure time, so you can insure a known-delayed flight. The fix is a
server-signed quote carrying `scheduledDeparture` and an expiry, verified
on-chain — which also stops a buyer naming their own cover amount.

**The oracle threshold is 1, not 2.** The design wants two independent providers
to agree before money moves. AviationStack's free tier returns `actual: null` for
most flights and OpenSky removed anonymous historical access, so in practice only
AeroDataBox reports arrival times. The UI states when a flight is single-source.
Restoring 2-of-2 needs an OpenSky account or a paid AviationStack tier.

**Payouts come from a pre-funded reserve**, not underwriters. `DelayCover` refuses
to sell cover it cannot honour, but the reserve is deployer-funded.

**Nothing is persisted.** No database, so carrier-specific recovery rates always
fall back to the 65% default.

---

## Building on Monad

Things that cost us time, in case they save you some:

- **Gas is charged on `gas_limit`, not `gas_used`.** Set limits explicitly where
  the cost is known. A wallet that gives up estimating and sets a huge limit
  charges the user the full amount.
- **Don't use `testnet-rpc.monad.xyz`.** It throttles at 15 req/sec and returns
  the refusal as a JSON-RPC error inside an HTTP 200, which retry logic doesn't
  catch. Use `https://rpc.ankr.com/monad_testnet`.
- **Cold storage/account access costs ~4x Ethereum** (8,100 / 10,100 gas).
- **`TIMESTAMP` is second-granularity** but blocks are 400ms, so several
  consecutive blocks share one timestamp. Never use it for ordering or entropy.
- **Contracts can be 128KB** (vs 24.5KB on Ethereum), so proxy-splitting for size
  is usually unnecessary.

---

## Monad Blitz

Built at **[Monad Blitz](https://blitz.devnads.com)**, a one-day hackathon on
Monad. **Placed 2nd**, judged by peer vote.

Resources that mattered:

| | |
|---|---|
| [Blitz resources](https://blitz.devnads.com/resources) | Curated starting point for the whole event |
| [Monad docs](https://docs.monad.xyz) | Also available as [`llms.txt`](https://docs.monad.xyz/llms.txt) for agents |
| [Monad vs Ethereum](https://docs.monad.xyz/developer-essentials/differences) | Read this first — the gas model genuinely differs |
| [Monad Foundry](https://docs.monad.xyz/tooling-and-infra/toolkits/monad-foundry) | Foundry fork with Monad's gas model baked in |
| [Faucet](https://faucet.monad.xyz) | Testnet MON |
| [MonadVision](https://testnet.monadvision.com) | Explorer |
| [MONSKILLS](https://skills.devnads.com) | Monad skill pack for coding agents |
| [Dev Discord](https://discord.gg/monaddev) | Full Access role raises the faucet from 0.05 to 5 MON per claim |

Monad testnet is chain `10143`. Blocks are ~400ms with 600ms finality, which is
why the payout lands while the demo is still on screen.

---

## License

MIT. See [LICENSE](LICENSE).

