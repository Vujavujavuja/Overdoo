# Contributing

## Getting set up

Contract dependencies are git submodules, so clone recursively:

```bash
git clone --recursive https://github.com/Vujavujavuja/monad-blitz
# already cloned? git submodule update --init --recursive
```

```bash
pnpm install
cp .env.example web/.env.local     # then fill it in
cd contracts && forge test
cd ../web && npm run dev
```

You need [Monad Foundry](https://docs.monad.xyz/tooling-and-infra/toolkits/monad-foundry),
not upstream Foundry — it applies Monad's gas model, opcode pricing and the
128KB code limit, so tests here behave like the chain does:

```bash
curl -L https://foundry.category.xyz | bash
foundryup --network monad
```

A free [AeroDataBox](https://rapidapi.com/aedbx-aedbx/api/aerodatabox) or
[AviationStack](https://aviationstack.com) key is required. The app refuses to
answer without one rather than inventing flight data — please keep it that way.

## Making a change

`main` is protected. Work on a branch and open a pull request.

If you don't have write access, fork the repo and open the PR from your fork —
that's the normal path and needs no permissions from anyone.

```bash
git checkout -b your-change
# ...
git push origin your-change
```

CI runs `forge test`, `tsc --noEmit`, `npm run lint` and `npm run build` on
every PR. All four must pass.

## What we care about in review

- **No synthetic flight data.** Ever. If a provider can't answer, the correct
  behaviour is an error, not a plausible-looking guess. Real money is quoted
  against these numbers.
- **The rules engine is the rules.** Changes to `lib/flight/eligibility.ts`
  should cite the article or the case. See the Article 7(2) note in the README
  for why this matters.
- **Contract changes need tests.** Especially anything touching payouts,
  reserves, or the oracle threshold.
- Match the surrounding style. Comments explain *why*, not *what*.

## Contract addresses

Deployed addresses live in `deployments.json` and the README. If you redeploy,
update both plus `web/lib/flight/cover.ts`.
