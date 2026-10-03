# Progress

Read this first in every session and continue from the last completed step.

## Current phase

Resumed 2 October 19:41 Lagos. Owner directive D-014: build the whole stack, leaving funding, allocation, deploy and live tests. Running in parallel: G6 review with the SessionCalendar rebuild; the app UI on a mock data layer (phase E part 1); the HP2 harness under the pre-registered protocol (docs/HP2_PROTOCOL.md, commit 1837c48). Contract components 3 to 6 follow in strict order once G6 and SessionCalendar are accepted; keeper and verifier follow the module ABI.

## Done

| Step | Result | Evidence |
| --- | --- | --- |
| A. Setup | Contract renamed and amended, root CLAUDE.md, git, .gitignore, secret scan with pre-push hook | docs/DECISIONS.md D-001 to D-008 |
| A. Keys | DEPLOYER 0xe23e8C58371468A98206f07b571cF7E6194abBc1, KEEPER 0x8649275ca7ce63d2F9E6487570ec0DCe14b6Bf46, TEST_PAYER 0xC595204eb8c03f3a42EFbf91cd2C7A64C571E2AC. Keys in ~/.sleeve-keys, mode 600 | addresses only |
| A. Funding plan | 0.0025, 0.0030 and 0.0003 ETH plus 60 USDG at 0.0316 gwei | docs/FUNDING.md |
| A. Batch 1 | Posted 2 October 15:50 Lagos | open inputs below |
| Research sweep | 18 addresses confirmed, pools picked (D-010), disclosure captured, passkey stack verified on 4663, 48 PRD gaps sorted | docs/research/, docs/disclosure/ |
| Batch 2 | 22 owner decisions posted 17:10 Lagos with recommended defaults; 26 engineering decisions logged | D-009 to D-013, docs/SPEC.md draft 2 |
| F. Mainnet deploy | Seven contracts on Robinhood Chain at blocks 79,338,287 to 79,338,373, 0.000424 ETH. Read back from chain state, every check passed. All seven verified on Sourcify, exact match for runtime and creation code | docs/DEPLOYMENTS.md, commit 9a47899 |
| B. G6 | PASSED after adversarial review (every item confirmed). 23 fork tests, Kernel v3.1 pinned at 03f7f5c, bytecode match. Accounting mode WRAPPED | commit 6957589, docs/GATES.md |
| C2. SessionCalendar | Accepted. 116 tests (69 library, 47 extension). Independent oracle (exchange_calendars, pandas_market_calendars, own NYSE rules): 13,224 boundary and 5,000 random vectors, 0 disagreements. Slither triaged | commit cd6e772, docs/STATIC_ANALYSIS.md |
| G. HP2 replay (provisional) | Pre-registered protocol (1837c48) before any fetch. 1,000 payments from chain data, compiled calendar through forge agreeing with the port on 28,745 instants, independent reimplementation agreeing on all 6,000 rows. PASS: +309 bps pooled (209 to 419), driven by SPY's pool launching at about twice the reference; ordinary payments pay about 1.7 bps to wait (D-020). Alchemy rerun pending | commit 227f69a, docs/HP2_RESULTS.md |
| C4. SleeveModule state and brackets | Accepted by two reviewers. 95 tests (65 unit, 30 fork through handleOps), 10,000-run fuzzes for I5, I6, I9, I14, both install paths; side task SleeveTimelock (48-hour floor) and TokenSource hardening, 77 tests. 472 contract tests green outside the spike | commit 34aa7fa |
| C3. PriceGuard, TokenSource, timelocked admin | Accepted by two reviewers. 173 tests: a mock per failure reason, fork tests on the real SPY, QQQ, NVDA and AAPL feeds, tokens, pools and registry at block 78,312,136, real 100 USDG swaps, a real pool block through the registry, 1,890 decision and 365 receipt premium vectors. Calendar follow-up: one-pass sessionState, 121 calendar tests | commits e2d2df3, 198a12a |
| C1. LedgerMath | Accepted by adversarial review. 60 tests, 13 fuzz tests at 10,000 runs (I2, I5, I9, outflow order, reconcile). Slither: one informational pragma note | commit c74d7e0 |

## Open inputs

- Batch 1: funding, ZeroDev, Alchemy, Supabase, Vercel scope, GitHub repo, production domain, closeout folder path. VPS answered: GreenCloud 172.93.185.150.
- Batch 2: owner decisions 1 to 22 (docs/research/prd-questions.md). Items 1 to 9 gate PriceGuard constants and the module.

## Paused 2 October 2026, 17:35 Lagos (owner turned the PC off)

All background workflows were stopped. Resume exactly here:

1. G6: the spike finished with items a to h PASS, i INFO (RIP-7212 precompile live on 4663), j PASS, 18 of 18 tests at block 78,312,136, Kernel v3.1 (tag commit 03f7f5c) bytecode matching the deployed implementation. Result saved in docs/research/runs/g6_spike.json. The adversarial review was interrupted before a verdict. Rerun the review (prompt in the sleeve-g6-spike workflow: refute each PASS, rerun the tests, confirm handleOps with a real root signature, no pranks) and record G6 only after it accepts. Uncommitted G6 files: contracts/test/spike/*, docs/GATES.md (G6 section), docs/research/g6-notes.md, contracts/remappings.txt, contracts/foundry.lock, and the kernel submodule pointer moving from f2a84a3 to 03f7f5c (tag v3.1). The .gitmodules entry already landed in commit 9acdf7d by accident (forge install had staged it).
2. SessionCalendar: interrupted mid-build. A message sent to the running builder started a second copy of it and both wrote the same files, so the files on disk are inconsistent (the extension API and the tests disagree). Restart with one builder that merges what is on disk: the _session refactor and the session-opened-at function (needed by B2-2 and the public settle grace), offset switches for daylight saving, and in-range closures and early closes behind the timelock per B2-9's recommended default. Then the adversarial review with an independent oracle. Research is complete: docs/research/session-calendar.md, docs/research/assets-api/, docs/research/runs/calendar_research.json.
3. Then component 3, PriceGuard with TokenSource and the timelock, per docs/SPEC.md draft 2.

Never message a running workflow subagent: it starts a second copy that writes the same files. Stop the workflow and restart the step instead.

## Next step

Paused 3 October, 21:42 Lagos, at the owner's request (Mac closing). Every workflow was stopped; nothing failed.

- Frontend (run wf_94b104af-0fd): QA round one finished (code, framing and art-director reviews: 17 blocking items). The fix pass fe:fix1 was interrupted mid-way; its partial edits are on disk under app/src. Owner decision: only this one fix round, then stop the workflow, check the build and commit.
- Backend (run wf_4473ca4d-d04): scaffold done and committed (keeper and verifier packages). The Supabase schema agent was interrupted; partial supabase/ on disk. Still to run: keeper with indexing, verifier library and CLI, reviews. Tests use PGlite, no Docker (owner).
- Dashboard spec (run wf_fcdc14fe-5a6): the reference extraction was interrupted; then the dark theme and the overview, settings and notifications specs (D-029).
- Then the app phase: overview dashboard, light and dark themes, Settings with the optional transaction preview, the notification bell, preview cards before every action, Send and Withdraw, the money trail per payment, Help, real icons everywhere, and the chain data layer on the live contracts.
- Resume in the same session with Workflow resumeFromRunId on each run (completed agents replay from cache). In a new session, relaunch the saved scripts under ~/.claude/projects/-Users-mac-sleeve/<session>/workflows/scripts/. Backup of the uncommitted files and the three journals: ~/sleeve-wip-20261003-2142.