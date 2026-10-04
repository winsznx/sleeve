# Security

Sleeve automates buying Stock Tokens with other people's income, so its first job is to never put that money at risk. This file is the threat model, the invariants with the tests behind each, the audit and static analysis record, and the limits we know about. Checked on 4 October 2026.

## Reporting a vulnerability

Report it privately through GitHub's private vulnerability reporting on this repository, not in a public issue. Include the contract or file, the steps or a proof of concept, and the impact. Please give us time to fix and redeploy before disclosing.

## What is deployed

Seven contracts on Robinhood Chain mainnet (chain id 4663), deployed 3 October 2026 at blocks 79,338,287 to 79,338,373, all verified on Sourcify with an exact match for runtime and creation code and read back from chain state ([docs/DEPLOYMENTS.md](docs/DEPLOYMENTS.md)). SleeveModule is not upgradeable: USDG, TokenSource, the calendar, SwapRouter02, the USDG/USD feed, the default keeper, the disclosure hash, the guard limits and the grace are constructor values with no setter. Off chain: the web app on Cloudflare Workers, the keeper on a VPS, a Supabase index and a verifier.

## Who can do what

| Actor | Can | Cannot |
| --- | --- | --- |
| Owner (passkey root validator on their own Kernel account) | Everything on the account: set or pause the rule, withdraw, release buckets to spend, sell lots, transfer tokens, change the keeper, uninstall the module | Act on anyone else's account |
| Keeper `0x8649275ca7ce63d2F9E6487570ec0DCe14b6Bf46`, or the keeper the owner names | Call `split` and `settle` on accounts that name it, without waiting out the one-hour grace | Move funds out of an account, change a rule, buy outside the rule's ticker, caps and allowlisted pools |
| Anyone | `observe`, then `split` once an observation is an hour old; `settle` an hour after a bucket started or its session reopened; read every view | Skip the grace, or push the equity share into spend with a junk pool (`PoolNotAllowed`) |
| SleeveTimelock, 48-hour minimum delay, DEPLOYER as proposer, canceller and executor, no admin role holder | Through TokenSource: `removeTicker`, `setPool` (allow or remove a pool). Through the calendar: `appendYear`, `addClosure`, `addEarlyClose`, `replaceFutureSwitch`. `updateDelay`, only within 48 hours to 30 days | Add a ticker, touch any account's funds or ledgers, upgrade the module (I10) |
| ZeroDev bundler and gas sponsor | Include or refuse the owner's UserOps | Change them: the passkey signs every field. If sponsorship fails, the owner can pay gas in ETH |

If the keeper key leaks, it can trigger `split` and `settle` early on every account that names it, and each buy stays bounded by that account's premium cap and slippage (audit A1-22). The owner rotates it with `setKeeper`. The key lives on the VPS at mode 600 owned by root and reaches the service through systemd's private credentials directory ([keeper/deploy/README.md](keeper/deploy/README.md)).

## Invariants

Every PRD invariant maps to named tests ([docs/SPEC.md](docs/SPEC.md) section 17). Stateful invariant suites live in `contracts/test/invariant/`.

| Invariant | What it says | Tests |
| --- | --- | --- |
| I1 | The module holds nothing after any call, checked as a delta of its own USDG and token balances, so a donation cannot block buys | `invariant_I1_moduleBalancesMoveOnlyByDonation`, the `ModuleHoldsFunds` check in every buy and sell, `test_I1` unit tests |
| I2 | Every split conserves USDG: `usdgIn == usdgToSpend + usdgSpent + usdgQueued` | LedgerMath fuzz at 10,000 runs, `testFuzz_I2_everySplitReceiptConservesUsdg`, `invariant_I2_everySplitReceiptConservesUsdg` |
| I3 | Bought tokens land in the owner's account | fork fills, postcondition revert tests, `invariant_I3_boughtTokensLandInTheAccount` |
| I4 | Only unsorted or queued USDG moves, only to the venue, with the approval reset to zero | `invariant_I4_onlyTheVenueWithExactApprovalReset`, fork allowance reads, the `SleevePullOrder` sequences |
| I5 | The balance held at install is never split | LedgerMath fuzz, `testFuzz_I5_installSnapshotNeverLeavesUnsortedAndInflowIsExact`, fork install tests |
| I6 | USDG the owner moves inside a bracket, and USDG the module moves, is never split as income | fork tests through `handleOps`, `invariant_I6_onlyIncomeIsEverSplit`, `testFuzz_I6_bracketMatchesAReferenceModel` |
| I7 | Receipts are append-only and lots move only through allowed transitions | `test_I7_*`, `invariant_I7_receiptIdsIncreaseAndHashesNeverChange` |
| I8 | No fill above the premium cap, on a stale round or with a paused oracle | fork tests per reason, `testFuzz_I8_noFillAboveTheCapOnAStaleRoundOrPausedOracle`, `invariant_I8_everyFillWithinItsCapOnAFreshUnpausedRound` |
| I9 | Rule shares are valid basis points | LedgerMath fuzz at 10,000 runs, `setRule` tests |
| I10 | Admin powers are limited to the list above and move no funds | TokenSource and timelock tests, the `SleeveI10` tests, `invariant_I10_timelockWritesMoveNoFunds` |
| I11 | The owner can exit without the keeper or the app | fork tests through `handleOps`: withdraw, release, transfer, uninstall, with the root key (`SleeveI11Fork`) and through a recovery signer on a passkey account (`SleeveI11RecoveryFork`) |
| I12 | No forbidden copy in the interface | `scripts/copy-lint.mjs` over every UI string, in `pnpm lint` |
| I13 | Borrowed USDG is never split | Borrow is not built in M0 (gate G1) |
| I14 | Every owner UserOp is bracketed | the app's UserOp builder tests, `test_I14` unit and fork tests |

## Tests

Counts from 4 October 2026, every suite passing:

| Suite | Tests | Command |
| --- | --- | --- |
| Contracts, unit | 582 | `cd contracts && forge test --match-path "test/unit/*"` |
| Contracts, audit regressions | 67 | `forge test --match-path "test/audit/*"` |
| Contracts, stateful invariants | 24 | `forge test --match-path "test/invariant/*"` |
| Contracts, fork at pinned mainnet blocks: real USDG pools, Stock Tokens, feeds and the deployed Kernel stack | 156 | `FORK_RPC=https://robinhood.drpc.org forge test --match-path "test/fork/*"` |
| Contracts, G6 account-stack spike | 23 | `forge test --match-path "test/spike/*"` (needs `FORK_RPC`) |
| App | 1003 | `pnpm --filter @sleeve/app test` |
| Keeper | 440 | `pnpm --filter @sleeve/keeper test` |
| Verifier | 158 | `pnpm --filter @sleeve/verifier test` |
| Shared core | 80 | `pnpm --filter @sleeve/core test` |

Fuzzing: the default is 1,000 runs per fuzz test and 256 runs per invariant (`contracts/foundry.toml`); LedgerMath's 13 fuzz tests and the module fuzzes for I5, I6, I9 and I14 run 10,000 times each. The session calendar was checked against an independent oracle on 13,224 boundary and 5,000 random instants with no disagreement ([docs/PROGRESS.md](docs/PROGRESS.md)).

## Audit

An internal audit round on 3 October 2026 ([docs/audit/AUDIT_R1.md](docs/audit/AUDIT_R1.md)) ran several review lenses, a static lens and the invariant suite against the integrated contracts. It found 43 issues: 1 HIGH, 5 MEDIUM, 19 LOW and 18 INFO, none refuted. When the round closed, 26 were fixed in code or tests, with regression tests in `contracts/test/audit/`; 8 were accepted against a recorded requirement or decision; 4 stay as built with the fix in the docs, the keeper or the app; and 5 waited on an owner decision. No open finding lets anyone take funds out of an account.

The HIGH, A1-01, is fixed: an absolute "module holds nothing" check let anyone block every buy by sending the module one base unit, so I1 is now measured as a delta of the module's balances around each swap.

Five findings waited on an owner decision when the audit closed. The module is immutable, so deploying it as built on 3 October settled three of them the way the code behaves ([D-028](docs/DECISIONS.md)):

- A1-02, MEDIUM, kept as a documented gap rather than a new emergency admin power: an unscheduled market closure the timelock cannot list in time leaves the held feed round looking live for up to about 25 hours. A buy in that window is still capped against the held price, which may differ from the market.
- A1-15: a bucket below the minimum is never merged into the next fill. The keeper settles it once it reaches the minimum, and the owner can release it at any time.
- A1-17: a trigger's pool off the allowlist reverts `PoolNotAllowed` instead of writing `REFUSED_TICKER`.

Two stay open, and neither touches funds:

- A1-27: a ticker's session type is fixed at construction; `removeTicker` is the only lever.
- A1-28: lots live in the module instance that bought them, so a later module version must import them.

This was an internal review, not an external audit. Treat it as such.

## Static analysis

Slither 0.11.5 (117 detectors, 91 results) and Aderyn 0.6.8 (12 issue types, 101 instances) ran over `contracts/src` on 3 October 2026. Every result is triaged in [docs/STATIC_ANALYSIS.md](docs/STATIC_ANALYSIS.md): none is a new true positive, and the static lens's three true positives, S-01 to S-03, are fixed.

## Known limits

- **Income sorting is exact only for actions taken through Sleeve.** Owner batches made through the app run inside `beginOwnerOp` and `endOwnerOp`. An action signed outside Sleeve can make the owner's own USDG look like income and get split. Receipts carry the accounting mode, and non-custody holds either way.
- **Keeper liveness.** If the keeper is down, anyone can split after the one-hour grace. Income of 1 USDG or more arriving at least hourly keeps that public path shut, since each payment needs its own observation and hour (D-025). The owner can always trigger a split or release directly.
- **Oracles.** Stock feeds have a 24-hour heartbeat and a 0.5 percent deviation trigger and hold the last price off-hours, so market state comes from the onchain calendar, not feed age. Chainlink publishes no sequencer uptime feed for Robinhood Chain, and Sleeve does not fake one. The issuer's `oraclePaused()` is treated as a reason to queue.
- **Issuer controls.** Stock Tokens are beacon proxies with a pause flag and an address blocklist. Sleeve reads both before a buy, but the issuer or the USDG issuer can freeze balances, and Sleeve cannot prevent that.
- **Account stack.** Kernel's current source exempts the root validator from validation hooks, while the deployed v3.1 still runs them, so Sleeve relies on no hook and uses explicit brackets, which behave the same on either. Kernel v3.1 ignores a reverting `onUninstall`, so the module refuses `onUninstall` while the account still lists it (A1-24), and the app never leaves a release to it: Remove Sleeve in Settings releases every waiting bucket in its own calls first, each of which reverts the batch if gas runs short, then uninstalls, so onUninstall has nothing left to release and the op can take the sponsor's gas estimate (D-040). The removal resolves only when the transaction carries `ModuleUninstallResult(module, true)` from the account and the account reads back without the module; a missing or false result is refused as UninstallFailed. A bare uninstall op keeps a fixed 450,000 call gas, above D-019's floor of 400,000 (A1-07). The Kernel factories are not staked in the EntryPoint on this chain; ZeroDev sponsored the first UserOps of the sign-ups of 4 October 2026, which deployed accounts through them (claim 6.9).
- **The index is a convenience.** Supabase holds the keeper's index for fast screens. Receipts and their hashes onchain are authoritative, and the verifier reads the chain directly.
- **Calendar coverage.** The calendar covers 2026 and 2027. 2028 must be appended through the 48-hour timelock before Sunday 2 January 2028, 20:00 EST; the keeper alerts ahead of `coverageEnd()` (A1-36, D-017).

## Operational security

- No secret is in the repository. Private keys live outside it at mode 600 and are loaded through files, never printed. `gitleaks` runs before every commit, and a full-history scan on 4 October 2026 found nothing.
- The app's Cloudflare build blanks every non-public variable, empties the env module OpenNext copies into the worker, and scans the whole output for each secret value before uploading; the one server secret reaches the worker as a Cloudflare secret (`app/scripts/cloudflare.mjs`, D-033).
- The browser's RPC endpoint is public by nature, so it accepts only Sleeve's origin, only 14 read methods and limited requests per IP address. The keeper's endpoint accepts only the keeper host's IP address (D-035).
- The keeper runs as an unprivileged user under a hardened systemd unit with memory caps, and its health report listens on localhost only.
