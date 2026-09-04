# Overdoo

Insure a flight before you fly. If it lands three hours late, you are paid the
EU261 statutory amount automatically — no forms, no airline.

Everything runs in one Next.js app on Vercel. No separate backend, no tunnel.

---

## Deploy

```bash
git add -A && git commit -m "Overdoo" && git push origin main
```

Vercel → **Settings → Build and Deployment**

| Field | Value |
|---|---|
| Framework Preset | Next.js |
| Root Directory | `web` |

Vercel → **Settings → Environment Variables** (Production). All five are required:

| Key | Value |
|---|---|
| `AERODATABOX_KEY` | your key from [RapidAPI](https://rapidapi.com/aedbx-aedbx/api/aerodatabox) |
| `AVIATIONSTACK_KEY` | your key from [aviationstack.com](https://aviationstack.com) |
| `MONAD_RPC_URL` | `https://rpc.ankr.com/monad_testnet` |
| `DEPLOYER_PRIVATE_KEY` | your key from `.env` (pays gas to settle) |
| `ATTESTOR_A_PRIVATE_KEY` | from `.env` (signs flight attestations) |

None are `NEXT_PUBLIC_` — they are read server-side only and never reach the
browser. Do not add that prefix; it would publish your keys and your key would
be drained within minutes.

Use `https://rpc.ankr.com/monad_testnet`, not `testnet-rpc.monad.xyz`. The
latter throttles at 15 requests/sec and reports the refusal as a JSON-RPC error
inside an HTTP 200, which retry logic does not catch.

Then **Deployments → ⋯ → Redeploy**, cache unchecked.

---

## Demo

**Flight: `FR7392`, date `2026-08-21`.** HER→VIE, really delayed 281 minutes.

1. Enter the flight number and date, hit **check**
2. It shows the real delay and what EU261 entitles you to
3. **connect wallet** → Monad Testnet
4. **pay** the premium — a real MON transaction in MetaMask
5. **claim payout** — the flight is attested on chain and the policy settles

The payout lands in the same wallet, in the same minute.

### Flights to use

| Flight | Cover | Delay | Pays out |
|---|---|---|---|
| `FR7392` | €400 | 281 min | yes |
| `AF989` | €600 | 720 min | yes |
| `IB468` | €250 | 207 min | yes (already used by the deployer wallet — fine from any other wallet) |
| `LH1411` | €250 | arrived early | **no** — settles with no payout |

Show `LH1411` too. A policy that always pays is not insurance; watching it
correctly refuse is what proves the oracle is real.

Any wallet can insure any flight, more than once — a family on one booking pays
from a single wallet.

### Scale

Amounts are scaled so testnet funds last: **€1 = 0.0001 MON**. A €400 cover
pays 0.04 MON and costs a 0.0032 MON premium (8%).

---

## What is real

- Live flight data from AeroDataBox and AviationStack on every lookup
- Distance by haversine over 9,054 airports, within 0.3% of the provider's own
- Articles 3, 5 and 7 of Regulation 261/2004, including Sturgeon (C-402/07) for
  the three-hour rule and Germanwings (C-452/13) for door-open arrival time
- Premium, policy, attestation and payout all on Monad testnet
- 43 passing contract tests

## Known compromises

**The oracle threshold is 1, not 2.** The design wants two independent providers
to sign off before money moves. AviationStack's free tier returns `actual: null`
for most flights and OpenSky removed anonymous access to historical data, so
only AeroDataBox reports arrival times. The threshold was lowered so the payout
is demonstrable. The UI says when a flight is confirmed by a single source.
Restoring 2-of-2 needs a free OpenSky account or a paid AviationStack tier.

**Payouts come from a pre-funded reserve**, not an underwriting pool with real
LPs. The contract refuses to sell cover it cannot honour, but the reserve is
0.5 MON that the deployer put in.

**Nothing is persisted.** No database, so carrier-specific recovery rates always
fall back to the 65% default.

## Contracts (Monad testnet, chain 10143)

| Contract | Address |
|---|---|
| DelayCover | `0xCC79e1e952B4ddb104c9166e47A9F289533a6DC1` |
| FlightOracle | `0xecEb2252024D77512d38bfcF4141658Ea12BC872` |
| CapitalPool | `0xbbb3A3d20A0267b4143f4cD91EFbf4639c870670` |
| ClaimRegistry | `0x2C5aa6422cc2d6232Bf7Ef5ae69E5dd9D24A886f` |
| Settlement | `0x5B03838e92949a8566CD1C7f71b96058bEbAfF55` |

https://testnet.monadvision.com

```bash
cd contracts && forge test    # 39 passing
```

## Finding fresh delayed flights

Delays go stale. To find new ones:

```bash
npm run find-delayed --prefix web -- EDDF,LEMD,LFPG 2026-08-22
```

## Topping up reserves

If the reserve runs low, send MON to `0xCC79e1e952B4ddb104c9166e47A9F289533a6DC1` from any wallet —
it has a `receive()` function.
