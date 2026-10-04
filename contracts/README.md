# Sleeve contracts

The Foundry project behind Sleeve: an ERC-7579 executor module for ZeroDev Kernel v3.1 accounts that splits incoming USDG by the owner's rule and buys Stock Tokens through allowlisted Uniswap v3 pools, with an onchain market calendar, a price guard against Chainlink, and a receipt for every action. Deployed on Robinhood Chain mainnet (chain id 4663) on 3 October 2026; addresses and verification are in [../docs/DEPLOYMENTS.md](../docs/DEPLOYMENTS.md).

What each function does, its errors and its receipts: [../docs/SPEC.md](../docs/SPEC.md). Threat model and invariants: [../SECURITY.md](../SECURITY.md).

## Layout

| Path | What it is |
| --- | --- |
| `src/SleeveModule.sol` | The executor: install snapshot, rules, owner brackets (`beginOwnerOp`, `endOwnerOp`), `observe`, `split`, `settle`, `release`, `sell`, lots and receipts. Not upgradeable. Delegates its heavy paths to the linked libraries below |
| `src/libraries/SleeveTrade.sol`, `SleeveBuy.sol`, `SleeveSell.sol` | Split and settle, buy execution, sell-back. Deployed as external libraries and linked into the module |
| `src/libraries/SleeveState.sol`, `SleeveReceipts.sol` | The module's storage layout and receipt writing (`ReceiptWritten` plus the stored hash) |
| `src/libraries/LedgerMath.sol` | Pure ledger math: unsorted equals balance minus spend minus pending; outflows apply to spend, then unsorted, then pending; basis-point splits with dust to spend |
| `src/libraries/PriceGuard.sol` | Feed answer and age, token pause, the beacon's blocklist, `oraclePaused`, the pending multiplier, the USDG/USD peg, and the premium from measured balances |
| `src/libraries/SessionCalendar.sol` | The 24/5 US Eastern schedule with precomputed daylight-saving dates and the NYSE holidays for 2026 and 2027 |
| `src/SessionCalendarExtension.sol` | The calendar's timelocked extension path: append a year, add a closure or an early close, move a future switch |
| `src/TokenSource.sol` | The four launch tickers with their tokens, feeds, session types and allowlisted pools. The timelock can remove a ticker and allow or remove a pool; nothing can add a ticker |
| `src/SleeveTimelock.sol` | OpenZeppelin's TimelockController with a minimum delay held between 48 hours and 30 days |
| `src/interfaces/`, `src/types/` | External interfaces (Stock Token, feeds, Uniswap) and shared types |
| `script/Deploy.s.sol` | The mainnet deploy, with its config and checks in `DeployConfig.sol` and `DeployChecks.sol` |
| `script/ReadBack.s.sol` | Reads every deployed value back from chain state and compares it with this checkout's build |
| `script/verify.py`, `script/record_deployment.py`, `script/gas_report.py` | Rebuild and check the verification inputs, write `deployments/4663.json`, and report gas |
| `deployments/4663.json` | The deployment record: addresses, constructor arguments, library links, transactions, blocks, gas and costs |
| `lib/kernel` | ZeroDev Kernel pinned at v3.1 (`03f7f5c`), the version ZeroDev deploys on chain 4663 |

## Build and test

Requirements: Foundry 1.7. Clone with submodules (`git clone --recurse-submodules`).

```bash
forge build

# Unit, audit regression and stateful invariant suites: 671 tests, no RPC needed
forge test --no-match-path "test/{fork,spike}/*"

# Fork tests at pinned Robinhood Chain blocks: real USDG pools, Stock Tokens, feeds and the deployed Kernel stack.
# They need an archive RPC, because the public RPC keeps only minutes of state (docs/DECISIONS.md D-008).
FORK_RPC=https://robinhood.drpc.org forge test --match-path "test/fork/*"

# Gas per call with every slot cold, as on chain (docs/GAS.md)
FORK_RPC=https://robinhood.drpc.org forge test --match-path test/fork/SleeveModuleGas.t.sol --isolate -vv
```

| Folder | Tests | What it covers |
| --- | --- | --- |
| `test/unit` | 582 | Every function, error and receipt field; LedgerMath and module fuzz tests at 10,000 runs for I2, I5, I6, I9 and I14 |
| `test/fork` | 156 | Install, rules, brackets, split, settle, weekends, sell-back and uninstall through `handleOps` on real mainnet state; PriceGuard on the real feeds and TokenSource on the real pools; the deploy script and a deploy smoke test |
| `test/audit` | 67 | Regressions for the confirmed audit round 1 findings ([../docs/audit/AUDIT_R1.md](../docs/audit/AUDIT_R1.md)) |
| `test/invariant` | 22 | Stateful invariants I1, I2, I3, I4, I6, I7, I8 and I10 over random sequences of payments, owner batches, splits, settles and sells |
| `test/spike` | 23 | Gate G6: the account stack on a fork, from account creation to a bracketed batch ([../docs/GATES.md](../docs/GATES.md)) |

## Static analysis

Slither and Aderyn run over `src/` before every commit that touches contracts. The commands and the triage of every result are in [../docs/STATIC_ANALYSIS.md](../docs/STATIC_ANALYSIS.md).

## Standards this code follows

Solidity 0.8.28 with custom errors, checks-effects-interactions and a per-account transient reentrancy lock on every module entry point. Exact approvals, reset to zero in the same call, and no standing approvals from the account. The module holds no funds after any call. Each PRD invariant, I1 to I14, maps to named tests ([../SECURITY.md](../SECURITY.md)).
