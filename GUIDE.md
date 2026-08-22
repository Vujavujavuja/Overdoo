# Overdoo — deploy & demo guide

You are owed money for a delayed flight. Overdoo checks whether Regulation
(EC) 261/2004 entitles you to compensation, using live commercial flight data,
and quotes you cash for the claim today.

Everything runs inside one Next.js app. There is **no separate backend and no
tunnel** — the flight lookup, the EU261 rules engine and the pricing all run in
a Next.js API route on Vercel.

---

## 1. Push

```bash
cd /Users/nemanjavujic/Desktop/Projects/VAI/monad-blitz/monad-blitz
git add -A && git commit -m "Overdoo: EU261 claim checker"
git push origin main
```

## 2. Vercel settings

In your project → **Settings**:

**Build and Deployment**
| Field | Value |
|---|---|
| Framework Preset | Next.js |
| Root Directory | `web` |

**Environment Variables** — add both, for Production:

| Key | Value |
|---|---|
| `AERODATABOX_KEY` | `682f6037e2msh7a81eb025ac36c4p1127d2jsn5f125e9866dc` |
| `AVIATIONSTACK_KEY` | `a34c48fa8d89a02e12d2e12988216af8` |

Optional pricing knobs (defaults shown, safe to omit):

| Key | Default |
|---|---|
| `DEFAULT_RECOVERY_PROB` | `0.65` |
| `COLLECTION_COST_EUR` | `25` |
| `TARGET_MARGIN_BPS` | `1500` |

> These are **server-side** variables. They are read inside the API route and
> never reach the browser, which is why they are not prefixed `NEXT_PUBLIC_`.
> Do not add that prefix — it would publish your API keys to every visitor.

## 3. Redeploy

**Deployments → ⋯ → Redeploy**, with "Use existing Build Cache" unchecked.

Settings only apply to the next build, so a redeploy is required after changing
any of the above.

## 4. Check it is alive

```
https://<your-app>.vercel.app/api/offer?carrier=IB&flightNumber=468&date=2026-08-21
```

Should return JSON with `"statutoryAmountEur": 250`. If it returns
`"No flight data provider configured"`, the env vars did not take — check they
are set for Production and that you redeployed.

---

## Demo script

Give your friend the URL. Flight number, date, hit **check**.

All of these are real flights from **2026-08-21**. Use that date.

| Flight | What happens | Why it matters |
|---|---|---|
| `IB468` | **You are owed €250** — VGO→MAD, 207 min late | The happy path |
| `FR7392` | **€400** — HER→VIE, 281 min late | Middle distance tier |
| `AF989` | **€600** — NSI→CDG, 720 min late | Long-haul, 12 hours late |
| `UA42` | **Nothing owed** — EWR→FRA, 212 min late | Delayed 3.5h and still refused: United is not EU-licensed and Newark is outside the EU, so Article 3(1)(b) puts it out of scope |
| `LH1411` | **Nothing owed** — arrived early | Sanity check |

Show `UA42` second. A tool that always says yes is a paywall; refusing a
genuinely delayed flight for a correct legal reason is what makes the rules
engine credible.

Expand the price line to show the derivation: €250 statutory × 65% recovery
probability − €25 collection cost − our margin = €116.88 to you. That is the
pitch against a 30% no-win-no-fee contingency: the passenger sees exactly how
the number was reached.

---

## What is real, and what is not

**Real**
- Live data from AeroDataBox and AviationStack on every lookup. No fixtures.
- Two providers cross-checked; agreement is measured on actual arrival time,
  within a 15-minute window.
- Distance is great-circle haversine over the OurAirports dataset (9,054
  airports), accurate to ~0.3% against the provider's own figure.
- The rules engine implements Articles 3, 5 and 7 including the Sturgeon
  (C-402/07) three-hour rule and the Germanwings (C-452/13) door-open measure.
- Five contracts are deployed on Monad testnet with 32 passing tests, and the
  capital pool holds 2 MON.

**Not wired into this screen**
- The payout. Contracts are live and tested, but the claim purchase is not
  connected to the UI. See the limitation below.
- Persistence. Nothing is stored between requests, so carrier-specific recovery
  rates always fall back to the 65% default.

## The one honest limitation

A purchase requires two independent sources to agree on the arrival time. In
practice **AviationStack's free tier returns `actual: null` for most flights**,
and OpenSky removed anonymous access to historical data. So eligible flights
resolve at `agreement: 1` and the UI says a second source is needed.

That is the system refusing to pay out on unverified data, which is correct
behaviour rather than a bug — but it does mean the money never moves in this
demo. To close it: register a free OpenSky account and add its credentials, or
pay for an AviationStack tier that populates arrival times.

## Contracts on Monad testnet

| Contract | Address |
|---|---|
| FlightOracle | `0xecEb2252024D77512d38bfcF4141658Ea12BC872` |
| CapitalPool | `0xbbb3A3d20A0267b4143f4cD91EFbf4639c870670` |
| ClaimRegistry | `0x2C5aa6422cc2d6232Bf7Ef5ae69E5dd9D24A886f` |
| Settlement | `0x5B03838e92949a8566CD1C7f71b96058bEbAfF55` |

Explorer: https://testnet.monadvision.com

```bash
cd contracts && forge test    # 32 passing
```

## Finding a fresh delayed flight

Delays expire. To find new ones for a later demo:

```bash
cd backend
./node_modules/.bin/tsx src/scripts/findDemoFlight.ts EDDF,LEMD,LFPG 2026-08-22
```

Scans those airports' arrivals for delays over 180 minutes and reports which are
EU261-eligible.
