<p>
  <picture>
    <source media="(prefers-color-scheme: dark)" srcset="app/public/brand/sleeve-lockup-horizontal-reversed.svg">
    <img alt="Sleeve" src="app/public/brand/sleeve-lockup-horizontal-positive.svg" height="48">
  </picture>
</p>

# Sleeve

A payment address on Robinhood Chain that invests part of every payment.

USDG arrives at your Sleeve address. Your rule, set once, splits it: the spend share stays USDG, and the equity share buys a US Stock Token into your own smart account. When the market is closed, or the price sits further above the Chainlink reference than your cap allows, the equity share waits as USDG in the same account and buys when the guard clears. Every action writes a receipt anyone can recompute from public chain data.

Stock Tokens are debt securities issued by Robinhood Assets (Jersey) Limited. They are not shares. Sleeve is not affiliated with, endorsed by, or officially connected with Robinhood Markets, Inc.

## Status

M0 is in development. Nothing is deployed on mainnet yet, so this README makes no live claim. What runs today, and what each part proves:

| Part | State | Evidence |
| --- | --- | --- |
| Account stack (G6) | Passed on a fork of chain 4663 | [docs/GATES.md](docs/GATES.md), `contracts/test/spike` |
| LedgerMath, SessionCalendar, PriceGuard, TokenSource, SleeveTimelock | Built, reviewed | `contracts/test/unit`, `contracts/test/fork` |
| SleeveModule split, settle, release, receipts | Built, audit round 1 triaged | [docs/audit/AUDIT_R1.md](docs/audit/AUDIT_R1.md) |
| Sell-back | Not built | |
| Keeper, verifier | Not built | |
| App | Screens on sample data, not wired to the chain | `app/` |
| HP2 price-discipline replay | Provisional result | [docs/HP2_RESULTS.md](docs/HP2_RESULTS.md) |

## How it works

1. You sign in with a passkey, and Sleeve deploys your ERC-7579 smart account (ZeroDev Kernel v3.1) with the Sleeve module installed. Its address is your payment address.
2. You set a rule: the share of each payment that buys a Stock Token, which ticker (SPY, QQQ, NVDA or AAPL), a premium cap against the Chainlink reference, a slippage cap and a minimum buy size.
3. A payer sends USDG. The keeper sees the transfer and calls `split`. The module sorts the new USDG, runs the guard (ticker, account block, pause, market session, corporate action, feed freshness, USDG peg, minimum size, premium from the measured fill) and either buys through an allowlisted Uniswap v3 pool or queues the equity share with a reason.
4. Queued money stays in your account as USDG. The keeper settles it when the guard clears, or you release it to spend at any time.
5. Every action emits a receipt and stores its hash. The verifier recomputes each field through a different RPC provider from the keeper's.

The details are in [docs/SPEC.md](docs/SPEC.md). Design choices a reviewer would question are in [docs/DECISIONS.md](docs/DECISIONS.md).

## Repository

```
contracts/   Foundry project: module, libraries, TokenSource, timelock, tests
app/         Next.js web app
packages/    shared TypeScript (types, formatting, premium math)
scripts/     replay harness, vector generators, lint and secret scan
docs/        spec, decisions, gates, audit, gas, research
results/     HP2 replay data and outputs
```

## Build and test

Requirements: Foundry 1.7, Node 22 or later, pnpm 11, Python 3.11.

```
git clone --recurse-submodules <repo>
cd contracts
FORK_RPC=https://robinhood.drpc.org forge test --no-match-path "test/spike/*"
cd ..
pnpm install
pnpm -r typecheck && pnpm -r test && pnpm copy-lint
```

Forked tests pin blocks on Robinhood Chain mainnet (chain id 4663) and need an archive RPC, because the public RPC keeps only a few minutes of state. See [docs/DECISIONS.md](docs/DECISIONS.md) D-008.

## Security

Audit round 1 findings and their fixes are in [docs/audit/AUDIT_R1.md](docs/audit/AUDIT_R1.md). Static analysis triage is in [docs/STATIC_ANALYSIS.md](docs/STATIC_ANALYSIS.md).

## License

MIT. See [LICENSE](LICENSE).
