# Static analysis triage

Slither 0.11.5 runs on every contract before its commit, with `--exclude-dependencies`. Every finding is listed with its triage. This file feeds SECURITY.md.

| Component | Detector | Location | Triage |
| --- | --- | --- | --- |
| LedgerMath | pragma | OpenZeppelin ^0.8.20 next to our ^0.8.28 | Informational. The project compiles everything with solc 0.8.28. |
| SessionCalendarExtension | uninitialized-local | `_offsetAt`, `low` | False positive. `low` is the binary-search lower bound and starts at zero by design. |
| SessionCalendarExtension | timestamp | `addClosure`, `addEarlyClose`, `replaceFutureSwitch` deadlines | By design. These writes are refused once the affected instant has passed, which is the point of the check. Sequencer timestamp drift is seconds; the deadlines are hours. |
| SessionCalendarExtension | operator-fee-outlier | constructor, `appendYear` | Not applicable. The detector models an OP Stack operator fee; Robinhood Chain is an Arbitrum Orbit chain with no such fee, and both functions run once per year at most. |
| TokenSource | missing-zero-check | constructor `usdg_`, `v3Factory_` | Construction already fails for a zero value (every pool's canonical check calls the factory with USDG). An explicit code check for both is added as hardening in the component 4 side task so the failure is a named error. |
| TokenSource | calls-loop | `_list`, `_canonicalFee` in the constructor | By design. Each launch ticker's token, feed and pools are validated once at deploy; the loop is bounded by the ticker count. |
| TokenSource | low-level-calls | `_canonicalFee` staticcall to `pool.fee()` | By design. A non-pool address must fail with PoolNotCanonical instead of an opaque revert, so the call result is checked by hand. |
| TokenSource | operator-fee-outlier | constructor, `_list` | Not applicable (OP Stack fee model; Robinhood Chain is Arbitrum Orbit). |
| TokenSource | pragma | OpenZeppelin interface pragmas | Informational. |
| SleeveModule | incorrect-equality | `_takeFromBuckets` | False positive. The strict equality stops the bucket walk once the outflow is covered; amounts are exact integers, not balances an attacker can nudge. |
| SleeveModule | uninitialized-local | `_takeFromBuckets`, `_bookOwnerOp`, `_releaseBucket`, `onUninstall` | False positive. Accumulators and receipt structs start at zero by design. |
| SleeveModule, PriceGuard | unused-return | tuple reads of `tokenSource.ticker`, `latestRoundData`, `Math.mul512` | By design. Only the fields the check needs are read: `updatedAt` decides freshness, so `startedAt` and `answeredInRound` are unused; `mul512`'s low word is unused where only the high word bounds the product. |
| SleeveModule | calls-loop | `_releaseBucket` and `_writeReceipt` inside `onInstall` and `onUninstall` | Bounded. The loop runs over TokenSource's tickers, fixed at four with no add function. Each iteration reads one ticker and the calendar version. |
| SleeveTimelock | pragma | OpenZeppelin pragmas | Informational. |
