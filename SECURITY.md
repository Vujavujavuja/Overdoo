# Security Policy

## Scope

Overdoo quotes and pays real money against flight data. The parts where a bug
costs someone money, in rough order of severity:

| Area | Why it matters |
|---|---|
| `contracts/src/DelayCover.sol` | Holds the reserve and decides payouts |
| `contracts/src/FlightOracle.sol` | Threshold signing — a forged attestation drains the reserve |
| `contracts/src/CapitalPool.sol` | Share price and solvency accounting |
| `web/lib/flight/eligibility.ts` | Wrong compensation tier = wrong payout |
| `web/lib/flight/tz.ts` | A timezone error shifts delay minutes across the payout threshold |
| `web/app/api/settle/route.ts` | Holds the attestor key and triggers settlement |

## Reporting a vulnerability

**Do not open a public issue for a security bug.**

Use GitHub's [private vulnerability reporting](https://github.com/Vujavujavuja/Overdoo/security/advisories/new).
It goes only to the maintainers and lets us discuss a fix before anything is
public.

Please include: what you can make happen, the steps to reproduce it, and which
contract or file is involved. A failing `forge test` is the most useful thing you
can send.

We'll acknowledge within a few days. This is a hackathon project maintained in
spare time — we are not going to promise a 24-hour SLA we cannot keep.

## Known issues, already public

These are documented in the README and do **not** need a private report. They are
design gaps we know about, not undisclosed vulnerabilities:

- **Cover can be bought on a flight that has already landed.** `buy()` does not
  check departure time. Tracked as an open issue.
- **The oracle threshold is 1, not 2.** Lowered so payouts could be demonstrated
  when only one provider reported arrival times. A single compromised attestor
  key can currently authorise any payout.
- **The attestor and ops keys live in environment variables.** Anyone with the
  deployment's env has full control of settlement.

## Deployment status

Everything is on **Monad testnet** with valueless MON. Nothing here has been
audited. Do not deploy this to a chain where the money is real without an audit
and without fixing the three items above.
