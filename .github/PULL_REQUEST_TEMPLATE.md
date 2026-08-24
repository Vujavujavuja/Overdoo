## What this changes

<!-- One or two sentences. What is different after this merges? -->

## Why

<!-- The problem being solved. Link the issue if there is one: Closes #123 -->

## Checklist

- [ ] `cd contracts && forge test` passes
- [ ] `cd web && npx tsc --noEmit && npm run lint && npm run build` passes
- [ ] Contract changes have tests covering the new behaviour
- [ ] No synthetic or fallback flight data was introduced
- [ ] Changes to `eligibility.ts` cite the article or case law involved
- [ ] Redeployed contracts? Updated `deployments.json`, `web/lib/flight/cover.ts` and the README

## Anything reviewers should look at closely

<!-- Tradeoffs, things you were unsure about, alternatives you rejected. -->
