# monad-blitz

A tip jar on Monad Testnet: click a button, pay 0.01 MON, and the money lands in
the owner's wallet immediately. Built as an end-to-end test of the stack —
contract, wallet, RPC, frontend.

```
contracts/   Foundry project (Monad Foundry fork)
web/         Next.js 16 + wagmi v3 + viem
```

## Network

| | |
|---|---|
| Chain ID | `10143` |
| RPC | `https://testnet-rpc.monad.xyz` |
| Explorer | https://testnet.monadvision.com |
| Faucet | https://faucet.monad.xyz |

## Prerequisites

Monad Foundry (a fork of Foundry with Monad's gas model, 128KB code limit and
repriced opcodes baked in — plain upstream Foundry will mis-estimate gas):

```sh
curl -L https://foundry.category.xyz | bash
foundryup --network monad
```

## Develop for free (do this first)

`anvil --monad` is a local Monad EVM with unlimited funds. Iterate here; spend
real testnet MON only on the final deploy.

```sh
cd contracts
forge test -vv          # 9 tests, incl. a fuzz run
anvil --monad           # local node, prints 10 pre-funded accounts
```

## Deploy to testnet

Costs **~0.05 MON** to deploy; each tip is 0.01 MON plus ~0.005 MON gas. Note Monad charges the full `gas_limit`, not
`gas_used`, and Foundry adds a ~30% buffer — so budget above the raw estimate.

Import your key once (stored encrypted, not in a `.env`):

```sh
~/.foundry/bin/cast wallet import monad-deployer --interactive
```

Deploy:

```sh
cd contracts
forge script script/Deploy.s.sol:Deploy \
  --rpc-url monad_testnet --account monad-deployer --broadcast
```

Copy the printed address into `web/.env.local`:

```
NEXT_PUBLIC_TIPJAR_ADDRESS=0xYourDeployedAddress
```

## Run the frontend

```sh
cd web
npm run dev
```

## Making it your idea

`TipJar.sol` is small on purpose. Change the contract, then:

```sh
cd contracts && forge build
cd ../web && npm run abi     # regenerates web/lib/abi.ts from the artifact
```

The frontend wiring — connect, network guard, read, write, receipt, live event
feed — stays identical no matter what the contract does. That's the point: the
plumbing is done, so a new idea only has to fill in the blanks.

**The owner is whoever deploys it.** There is no admin function and no way to
change the recipient afterwards.

## Gotchas worth remembering

- **Gas is charged on `gas_limit`, not `gas_used`.** Hardcode limits where the
  cost is known. If `eth_estimateGas` reverts, MetaMask sets a huge limit — and
  on Monad you pay all of it.
- **Cold storage/account access costs ~4x Ethereum** (8,100 / 10,100 gas).
- **A wallet showing a stale balance is not the chain.** Monad finalizes in
  600ms; the explorer is the source of truth.
- **`TIMESTAMP` is second-granularity** but blocks are 400ms, so 3-4 consecutive
  blocks share a timestamp. Never use it for randomness or ordering.
