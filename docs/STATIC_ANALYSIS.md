# Static analysis triage

Slither 0.11.5 runs on every contract before its commit, with `--exclude-dependencies`. Every finding is listed with its triage. This file feeds SECURITY.md.

| Component | Detector | Location | Triage |
| --- | --- | --- | --- |
| LedgerMath | pragma | OpenZeppelin ^0.8.20 next to our ^0.8.28 | Informational. The project compiles everything with solc 0.8.28. |
| SessionCalendarExtension | uninitialized-local | `_offsetAt`, `low` | False positive. `low` is the binary-search lower bound and starts at zero by design. |
| SessionCalendarExtension | timestamp | `addClosure`, `addEarlyClose`, `replaceFutureSwitch` deadlines | By design. These writes are refused once the affected instant has passed, which is the point of the check. Sequencer timestamp drift is seconds; the deadlines are hours. |
| SessionCalendarExtension | operator-fee-outlier | constructor, `appendYear` | Not applicable. The detector models an OP Stack operator fee; Robinhood Chain is an Arbitrum Orbit chain with no such fee, and both functions run once per year at most. |
