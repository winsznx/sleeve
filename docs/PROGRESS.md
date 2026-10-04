# Progress

Read this first in every session and continue from the last completed step.

## Current phase

4 October 2026, about 11:45 Lagos. The contracts are on Robinhood Chain mainnet and the web app and the keeper are live. Nobody has signed up yet, so no Sleeve account and no receipt exist on chain.

- Contracts: deployed 3 October 2026 at blocks 79,338,287 to 79,338,373, read back from chain state and verified on Sourcify (docs/DEPLOYMENTS.md).
- Web app: https://trysleeve.xyz since about 02:22 Lagos on 4 October, a Cloudflare Worker built with OpenNext (D-033, D-034), with the verifier page at https://trysleeve.xyz/verify.
- Keeper: on the owner's Hostinger VPS under systemd since 09:52 UTC on 4 October (D-036). It indexes into Supabase and tracks 0 accounts.
- Next: the HP1 live payment test (sign up on trysleeve.xyz, a TEST_PAYER payment, the keeper's split, the verifier on the public RPC), then the rest of the HP1 campaign; the HP2 rerun on a second provider, the keeper's QuickNode endpoint, which replaced the Alchemy app (D-032) and answers only the VPS, so the rerun runs there or from this machine once the owner allows it; the submission docs. The waitlist is built (e8c9955, D-038) and goes live once its table migration is applied.

## Done

| Step | Result | Evidence |
| --- | --- | --- |
| A. Setup | Contract renamed and amended, root CLAUDE.md, git, .gitignore, secret scan with pre-push hook | docs/DECISIONS.md D-001 to D-008 |
| A. Keys | DEPLOYER 0xe23e8C58371468A98206f07b571cF7E6194abBc1, KEEPER 0x8649275ca7ce63d2F9E6487570ec0DCe14b6Bf46, TEST_PAYER 0xC595204eb8c03f3a42EFbf91cd2C7A64C571E2AC. Keys in ~/.sleeve-keys, mode 600 | addresses only |
| A. Funding plan | 0.0025, 0.0030 and 0.0003 ETH plus 60 USDG at 0.0316 gwei | docs/FUNDING.md |
| A. Batch 1 | Posted 2 October 15:50 Lagos | open inputs below |
| Research sweep | 18 addresses confirmed, pools picked (D-010), disclosure captured, passkey stack verified on 4663, 48 PRD gaps sorted | docs/research/, docs/disclosure/ |
| Batch 2 | 22 owner decisions posted 17:10 Lagos with recommended defaults; 26 engineering decisions logged | D-009 to D-013, docs/SPEC.md draft 2 |
| Keeper | Indexes the module's events and USDG payments into Supabase, splits and settles under the gas ceiling, and serves a health endpoint, with systemd units, an install script and a runbook. Live on the owner's Hostinger VPS since 09:52 UTC on 4 October (D-036): dry run clean, health ok, its cursor public through /api/index, KEEPER holding 0.001 ETH | commits d58ca3f, cd34e18, 9813dc2, b7bbc48; docs/DEPLOYMENTS.md |
| App | Screens on a mock data layer, then the chain data layer on the live contracts: ZeroDev Kernel accounts and bracketed owner ops simulated before signing, onboarding, rule, payments, holdings with sell-back, send and withdraw, history, settings, notifications and the verify page, in light and dark themes (D-029 to D-031). Supabase schema with row level security, applied 4 October. Live at https://trysleeve.xyz on Cloudflare Workers since about 02:22 Lagos on 4 October (D-033 to D-035). The link preview fix and the brand kit (D-037) followed. Sign-up and payments have not run on mainnet yet | commits c1ff7a7, 2aad349, 91f787c, fb46a3a, 58e44e7, 9139e5c, 964ab48, e352fec; docs/DEPLOYMENTS.md |
| Verifier | Receipt verifier library and the `sleeve verify` CLI: every receipt field recomputed from public chain data, through the public RPC by default, a different provider from the keeper's (D-012, D-032). No mainnet receipt exists yet | commit bd3753f, packages/verifier |
| F. Mainnet deploy | Seven contracts on Robinhood Chain at blocks 79,338,287 to 79,338,373, 0.000424 ETH. Read back from chain state, every check passed. All seven verified on Sourcify, exact match for runtime and creation code | docs/DEPLOYMENTS.md, commit 9a47899 |
| Audit round 1 | 13 lenses, dedup, a verifier per group with proof-of-concept tests, and a stateful invariant suite: 43 findings (1 HIGH, 5 MEDIUM, 19 LOW, 18 INFO), none refuted. 26 fixed in code or tests, 8 accepted, 4 kept as built, 5 left to the owner, of which the deploy settled A1-02, A1-15 and A1-17 (D-028). 812 contract tests passed outside the spike at the integration. Every slither and aderyn result triaged | commits 9a6edba, 40682ef, ddadac9, 5809e3b, 5f9a587; docs/audit/AUDIT_R1.md, docs/STATIC_ANALYSIS.md |
| C6. Sell-back | The mirrored guard, the off-hours override and the lot reconcile, integrated with the audit round 1 fixes; review round 2 pinned how a sell's receipts group (D-027). Fork tests for a fill on every allowlisted pool, a weekend wait (SellWaits SESSION) and an override fill against the held round | commits ad2f656, ddadac9; contracts/test/fork/SleeveModuleSell.t.sol, SleeveModuleSellWeekend.t.sol |
| C5. Split, settle and release | Buys through SwapRouter02 on the allowlisted v3 pools, lots and receipts; 631 contract tests passed outside the spike at the commit; reviewed in audit round 1. Fork tests on the real pools for I1 to I4, I7 and I8, every QUEUED reason, REFUSED_TICKER, REFUSED_ACCOUNT and the minimum-out revert | commit a2f58bf; contracts/test/fork/SleeveModuleSplit.t.sol, SleeveModuleWeekend.t.sol |
| B. G6 | PASSED after adversarial review (every item confirmed). 23 fork tests, Kernel v3.1 pinned at 03f7f5c, bytecode match. Accounting mode WRAPPED | commit 6957589, docs/GATES.md |
| C2. SessionCalendar | Accepted. 116 tests (69 library, 47 extension). Independent oracle (exchange_calendars, pandas_market_calendars, own NYSE rules): 13,224 boundary and 5,000 random vectors, 0 disagreements. Slither triaged | commit cd6e772, docs/STATIC_ANALYSIS.md |
| G. HP2 replay (provisional) | Pre-registered protocol (1837c48) before any fetch. 1,000 payments from chain data, compiled calendar through forge agreeing with the port on 28,745 instants, independent reimplementation agreeing on all 6,000 rows. PASS: +309 bps pooled (209 to 419), driven by SPY's pool launching at about twice the reference; ordinary payments pay about 1.7 bps to wait (D-020). Second-provider rerun pending; QuickNode replaces the Alchemy app the protocol names (D-032) | commit 227f69a, docs/HP2_RESULTS.md |
| C4. SleeveModule state and brackets | Accepted by two reviewers. 95 tests (65 unit, 30 fork through handleOps), 10,000-run fuzzes for I5, I6, I9, I14, both install paths; side task SleeveTimelock (48-hour floor) and TokenSource hardening, 77 tests. 472 contract tests green outside the spike | commit 34aa7fa |
| C3. PriceGuard, TokenSource, timelocked admin | Accepted by two reviewers. 173 tests: a mock per failure reason, fork tests on the real SPY, QQQ, NVDA and AAPL feeds, tokens, pools and registry at block 78,312,136, real 100 USDG swaps, a real pool block through the registry, 1,890 decision and 365 receipt premium vectors. Calendar follow-up: one-pass sessionState, 121 calendar tests | commits e2d2df3, 198a12a |
| C1. LedgerMath | Accepted by adversarial review. 60 tests, 13 fuzz tests at 10,000 runs (I2, I5, I9, outflow order, reconcile). Slither: one informational pragma note | commit c74d7e0 |

## Open inputs

From the owner, as of 4 October 2026. The rest of batch 1 and batch 2 is answered (D-014, D-028, D-032 to D-036, docs/DEPLOYMENTS.md).

- TEST_PAYER 0xC595204eb8c03f3a42EFbf91cd2C7A64C571E2AC needs ETH for gas and USDG for the HP1 payments; it holds none yet. docs/FUNDING.md planned 0.0003 ETH and 60 USDG.
- HP1 needs at least 10 payments from at least 3 distinct payers, one of them off-hours (docs/CLAIM_LEDGER.md 5.3), so at least two payers besides TEST_PAYER.
- CORS off on the keeper's QuickNode endpoint (D-035).
- A public GitHub repo for the submission: this checkout has no remote yet.
- Optional: a Blockscout PRO API key for direct verification on the explorer, which already reads the Sourcify result (docs/DEPLOYMENTS.md).
- Decisions only a later module version can apply: A1-27 and A1-28 (docs/audit/AUDIT_R1.md). The deploy settled the other open audit and sell-back questions (D-028).

## Paused 2 October 2026, 17:35 Lagos (owner turned the PC off)

All background workflows were stopped. Resume exactly here:

1. G6: the spike finished with items a to h PASS, i INFO (RIP-7212 precompile live on 4663), j PASS, 18 of 18 tests at block 78,312,136, Kernel v3.1 (tag commit 03f7f5c) bytecode matching the deployed implementation. Result saved in docs/research/runs/g6_spike.json. The adversarial review was interrupted before a verdict. Rerun the review (prompt in the sleeve-g6-spike workflow: refute each PASS, rerun the tests, confirm handleOps with a real root signature, no pranks) and record G6 only after it accepts. Uncommitted G6 files: contracts/test/spike/*, docs/GATES.md (G6 section), docs/research/g6-notes.md, contracts/remappings.txt, contracts/foundry.lock, and the kernel submodule pointer moving from f2a84a3 to 03f7f5c (tag v3.1). The .gitmodules entry already landed in commit 9acdf7d by accident (forge install had staged it).
2. SessionCalendar: interrupted mid-build. A message sent to the running builder started a second copy of it and both wrote the same files, so the files on disk are inconsistent (the extension API and the tests disagree). Restart with one builder that merges what is on disk: the _session refactor and the session-opened-at function (needed by B2-2 and the public settle grace), offset switches for daylight saving, and in-range closures and early closes behind the timelock per B2-9's recommended default. Then the adversarial review with an independent oracle. Research is complete: docs/research/session-calendar.md, docs/research/assets-api/, docs/research/runs/calendar_research.json.
3. Then component 3, PriceGuard with TokenSource and the timelock, per docs/SPEC.md draft 2.

Never message a running workflow subagent: it starts a second copy that writes the same files. Stop the workflow and restart the step instead.

## Paused 3 October 2026, 21:42 Lagos (Mac closing)

Paused 3 October, 21:42 Lagos, at the owner's request (Mac closing). Every workflow was stopped; nothing failed.

- Frontend (run wf_94b104af-0fd): QA round one finished (code, framing and art-director reviews: 17 blocking items). The fix pass fe:fix1 was interrupted mid-way; its partial edits are on disk under app/src. Owner decision: only this one fix round, then stop the workflow, check the build and commit.
- Backend (run wf_4473ca4d-d04): scaffold done and committed (keeper and verifier packages). The Supabase schema agent was interrupted; partial supabase/ on disk. Still to run: keeper with indexing, verifier library and CLI, reviews. Tests use PGlite, no Docker (owner).
- Dashboard spec (run wf_fcdc14fe-5a6): the reference extraction was interrupted; then the dark theme and the overview, settings and notifications specs (D-029).
- Then the app phase: overview dashboard, light and dark themes, Settings with the optional transaction preview, the notification bell, preview cards before every action, Send and Withdraw, the money trail per payment, Help, real icons everywhere, and the chain data layer on the live contracts.
- Resume in the same session with Workflow resumeFromRunId on each run (completed agents replay from cache). In a new session, relaunch the saved scripts under ~/.claude/projects/-Users-mac-sleeve/<session>/workflows/scripts/. Backup of the uncommitted files and the three journals: ~/sleeve-wip-20261003-2142.

## 4 October 2026: web app live on Cloudflare

- Hosting moved to Cloudflare Workers through OpenNext (D-033). The deploy script keeps every non-public .env value out of the worker and scans the output before upload; server files the cards and disclosure need are embedded modules.
- Log reads go to the public RPC; the browser QuickNode endpoint serves the other reads under a referrer list, a method list without eth_getLogs and per-IP limits (D-035).
- https://trysleeve.xyz is live with www redirecting to it (D-034). Supabase schema applied and checked. ZeroDev project on the Sandbox plan with Robinhood 4663 enabled and an origin rule for https://trysleeve.xyz. Records and checks: docs/DEPLOYMENTS.md.
- Next: ZeroDev gas policy, Reown domain allowlist, Always Use HTTPS, then the keeper on the VPS (needs the host and access), KEEPER funding, and the live payment test.

## 4 October 2026: keeper live on the Hostinger VPS

- The owner moved the keeper to their Hostinger VPS (D-036). keeper/deploy/install.sh installed it; on the first real install systemd 259 handed the key over as 0440 root:root, which the key check refused, and keyFileModeProblem now accepts exactly that case (b7bbc48). Dry run clean, then the keeper went live: health ok, the index in Supabase, and the site's /api/index answering with its cursor.
- QuickNode: the browser endpoint answers only trysleeve.xyz, only 14 read methods and within per-IP limits; the keeper endpoint answers only the VPS. API routes read through the public RPC (01468bc). ZeroDev sponsors under a chain policy with daily and per-op limits, checked by a prepare-only probe. Records: docs/DEPLOYMENTS.md.
- An install on the GreenCloud box by mistake was removed the same day; that box's full disk was freed of caches only.
- Next: CORS off on the keeper endpoint (owner); the live payment test (sign up on trysleeve.xyz, a TEST_PAYER payment, the keeper's split, the verifier); the HP2 rerun, which needs the keeper endpoint from this machine or a run on the VPS; then the submission docs.

## 4 October 2026: CI, the recovery exit, submission docs

- CI on every push (c84d91b): the TypeScript workspace with the copy lint, the contract suites that need no RPC secret, the HP2 harness, and gitleaks over the whole history. The fork suites run weekly and on demand.
- Passkey setup and the recovery wallet step state the accounting limit (206980b).
- The exit through a recovery signer runs on a fork (7d040f9): a passkey account whose recovery wallet is a secondary validator limited to execute releases, withdraws, moves its SPY and removes the module with the recovery key alone, no keeper and no app. Claims 4.6 and 4.7 are MEASURED.
- On iPhones a tap opened the phone menu and every dialog with a focus ring on the first control. Fixed and deployed (53de204, D-039), checked on the live site in WebKit.
- The waitlist (D-038) is deployed with the app. It saves once supabase/migrations/20261004120000_waitlist.sql runs in the hosted project, which has not happened yet.
- Submission docs: docs/THESIS.md, docs/EVAL_CAMPAIGN.md (the HP1 plan), docs/DEMO_SCRIPT.md and SPONSOR_FINDINGS.md.
- Tests: 852 Foundry and 1,681 TypeScript, all passing (docs/CLAIM_LEDGER.md has the breakdown).
- Next: the waitlist SQL (owner), then the live payment test and HP1, the HP2 rerun, and the video after HP1.
