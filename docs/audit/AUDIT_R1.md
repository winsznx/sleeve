# Audit round 1

Round 1 covers every contract under contracts/src: LedgerMath, SessionCalendar, SessionCalendarExtension, PriceGuard, TokenSource, SleeveTimelock, SleeveReceipts, SleeveState, SleeveTrade, SleeveBuy, SleeveSell and SleeveModule. The lenses read commit e16bb96. Verification ran on a frozen snapshot of commit 6535108, whose contracts differ from e16bb96 only by the two early fixes, 9a6edba (A1-01) and 40682ef (A1-05). Component 6, sell-back (commit ad2f656), was written after the lenses ran, so findings that needed a sell path were deferred to it and then checked against it. Every fix in this file is integrated on top of component 6.

Where it stands on 3 October 2026: 43 findings, 37 from the lenses, 3 from the static lens and 3 from the invariant suite. By verified severity: 1 HIGH, 5 MEDIUM, 19 LOW, 18 INFO. None was refuted. 26 are fixed in code or tests, 8 are accepted against a recorded PRD line or decision, 4 stay as built with their fix in the docs, the keeper or the app, and 5 wait on an owner decision. No open finding lets anyone take funds out of an account: the open ones bound what a buy can pay above the market (A1-02, A1-06, A1-27) or touch liveness and records. The full suite outside the G6 spike passes, 812 tests: the 800 of the integration, 9 from review round 1 in contracts/test/unit/SleeveModuleSpec.t.sol, which pin rules SPEC draft 3 states, and 3 from review round 2 in contracts/test/unit/SleeveModuleSellRuns.t.sol and contracts/test/fork/SleeveModuleSellRuns.t.sol, which pin how SPEC 13 groups a sell's receipts (see Rerun).

## Method

1. Lenses. 13 agents, one per lens: reentrancy, funds, access, oracle, transient storage, tokens, account abstraction, time, arithmetic, denial of service, current exploit patterns, spec fidelity and static analysis. Each read the frozen e16bb96 tree and wrote proof-of-concept tests where it could. They filed 51 raw reports: 5 HIGH, 7 MEDIUM, 27 LOW and 12 INFO, kept in docs/audit/audit_r1_raw.json.
2. Dedup. One agent merged reports with the same root cause into 37 findings, A1-01 to A1-37, in seven groups by code area. Every raw report maps to a finding. Five lenses filed the same HIGH (A1-01), four the same dust grief (A1-05) and three the same quote problem (A1-06).
3. Verification. One verifier per group, on the 6535108 snapshot: rerun the round 1 proof of concept, write a new one where none existed or the code had moved, measure on a fork of chain 4663 where it mattered, judge the severity again against the PRD and docs/DECISIONS.md, and propose a fix. Most fixes were first checked in a throwaway copy of the snapshot against the whole unit and fork suite. Raw results, including every verifier's coverage notes, are in docs/audit/round1-verification.json.
4. Static lens. Slither 0.11.5 and aderyn 0.6.8 over the snapshot gave 67 slither results and 88 aderyn instances. Each was triaged, which produced S-01 to S-03. Both tools ran again on the integrated tree, and docs/STATIC_ANALYSIS.md lists every result with its triage.
5. Invariant suite. A stateful suite with a reference model of the module, built during the audit, found I-01 to I-03. It is now committed with the integration and covers sells (see Invariant suite).
6. Integration. Each confirmed finding got its verified fix unless the fix is documentation or an owner decision. Each proof of concept that proved a confirmed finding was rewritten into contracts/test/audit to assert the fixed behavior, or the documented behavior where the code stays as built. Tests whose names contain `open` or `residual` pin behavior that waits on the owner or is the accepted remainder of a fix. Deferred findings were checked against component 6 and closed with a fix or a test where it had none.

Statuses. FIXED: fixed before verification and confirmed fixed. CONFIRMED: reproduced on the snapshot. DEFERRED_C6: needed the sell path. ACCEPTED: reproduced, and the behavior is what a PRD line or a recorded decision asks for. REFUTED: did not reproduce.

Line numbers in this file are those of the 6535108 snapshot unless a function name is given instead. Test paths are under contracts/test.

## Status

### Fixed in code or tests

| Id | Severity | Status | Fix | Regression tests |
| --- | --- | --- | --- | --- |
| A1-01 | HIGH | FIXED | 9a6edba: I1 is measured as a delta of the module's balances around each swap. Sells use the same delta. | unit/SleeveModuleSplit.t.sol test_I1_split_donationToModule_doesNotBlockBuys; audit/AuditBuyExec.t.sol test_A1_01_strayBalancesOnTheModuleBlockNoSplitAndNoSettle, test_A1_01_aLeakDuringTheBuyStillReverts; invariant_I1_moduleBalancesMoveOnlyByDonation |
| A1-05 | LOW | CONFIRMED, fixed | Public settle readiness comes from the bucket's since and the session's opening only; one coverage rule for observe, the public split and previewSplit | audit/AuditClock.t.sol test_A1_05b_settleReadinessIgnoresKeeperAndPublicDustSplits, test_A1_05a_settleReadinessIgnoresOneUsdgRestarts, test_A1_05_keeperKeepsTheFirstHourAfterTheOpening; residual pins test_A1_05a_residual_oneUsdgPerRestartPostponesThePublicSplit, test_A1_05a_residual_hourlyIncomeKeepsThePublicSplitShutWhileTheKeeperIsDown; unit test_split_dustCannotPostponeThePublicFallback (40682ef) |
| A1-10 | LOW | CONFIRMED, fixed | readStockFeed also requires startedAt at or after the session's opening | audit/AuditGuard.t.sol test_A1_10_roundObservedBeforeTheReopenIsStale, test_A1_10_roundObservedAfterTheReopenSettles, test_A1_10_sellWaitsOnARoundObservedBeforeTheReopen |
| A1-12 | LOW | CONFIRMED, fixed | No router minimum; the module checks minOut after the premium cap (buys) and after the discount cap (sells) | audit/AuditBuyExec.t.sol test_A1_12_poolMovedAfterTheQuote_queuesPremium, test_A1_12_minimumOutAloneStillReverts, test_A1_12_settleWithAStaleQuoteWaitsOnThePremium; audit/AuditBuyExecFork.t.sol test_fork_A1_12_poolPushedAfterTheQuote_queuesPremium |
| A1-13 | LOW | DEFERRED_C6, fixed in the integration | A sell by amount takes from at most 100 lots (TooManyLots) and a lot reconcile trims at most 100 lots per call | audit/AuditLots.t.sol test_A1_13_aSellByAmountTakesFromAtMostOneHundredLots, test_A1_13_emptyLotsDoNotCountTowardTheBound, test_A1_13_reconcileLotsTrimsAtMostOneHundredLotsPerCall; fork/SleeveModuleGas.t.sol test_gas_sell_SOLD_acrossOneHundredLots |
| A1-18 | LOW | CONFIRMED, fixed | TokenSource refuses to remove an active ticker's last pool and to list a feed ticker without pools | audit/AuditAdmin.t.sol test_A1_18_activeTickersLastPoolCannotBeRemoved_rotationAddsFirst, test_A1_18_removedTickerMayStillEmptyItsList, test_A1_18_constructorRefusesAFeedTickerWithoutPools |
| A1-19 | LOW | CONFIRMED, fixed | A PremiumAboveCap from inside the account's batch becomes BatchReverted | audit/AuditBuyExec.t.sol test_A1_19_aForgedPremiumFromTheBatchRevertsTheSplit, test_A1_19_aForgedPremiumOnSettleRevertsBatchReverted, test_A1_19_otherBatchRevertsStillBubbleUnchanged, test_A1_19_theRealPremiumStillQueues; residual pin test_A1_19_residual_aReadInsideExecuteBuyCanStillRaiseIt; audit/AuditBuyExecFork.t.sol test_fork_A1_19_kernelExecutorHookCannotForgeAPremiumQueue |
| A1-21 | INFO | CONFIRMED, fixed | The transient reentrancy lock is per account | audit/AuditAccountTrust.t.sol test_A1_21_anotherAccountsOwnerOpRunsInsideABuy, test_A1_21_sameAccountReentryStillReverts, test_fork_A1_21_nestedOwnerOpSucceedsInsideAnotherAccountsBuy |
| A1-23 | LOW | CONFIRMED, fixed | A fill must show on the allowlisted pool's balances (FillNotFromPool), for buys and sells | audit/AuditAccountTrust.t.sol test_A1_23_fabricatedFillReverts, test_A1_23_fabricatedSaleReverts, test_fork_A1_23_fabricatedFillOnTheRealSpyTokenReverts |
| A1-24 | INFO | CONFIRMED, fixed | onUninstall reverts ModuleStillListed while the account still lists the module | audit/AuditAccountTrust.t.sol test_A1_24_directOnUninstallRevertsWhileListed, test_A1_24_executorUninstallStillReleases, test_fork_A1_24_hookTypeUninstallKeepsTheStateAndSplitsStillRun |
| A1-25 | LOW | CONFIRMED, fixed | The observed level drops to the unsorted USDG left after an owner outflow, a reconcile or an unseen pull | audit/AuditClock.t.sol test_A1_25_ownerOutflowLowersTheObservedLevel, test_A1_25_pausedRuleSpentThenResumed_newPaymentWaits, test_A1_25_reconcileLowersTheObservedLevel, test_A1_25_observeLowersTheLevelAfterAnUnseenPull; residual pin test_A1_25_residual_unseenPullWithNoModuleCallInBetween |
| A1-26 | LOW | CONFIRMED, fixed | The module binds to one SleeveTimelock at its 48-hour floor; SleeveTimelock refuses empty and zero role holders | audit/AuditAdmin.t.sol test_A1_26_moduleRefusesAZeroDelayTimelock, test_A1_26_moduleRefusesTwoTimelocks, test_A1_26_moduleRefusesADelegatedEoa, test_A1_26_moduleAcceptsOneSleeveTimelock, test_A1_26_sleeveTimelockRefusesEmptyAndZeroRoleHolders |
| A1-31 | INFO | CONFIRMED, fixed | A bucket the guard refuses goes to spend at any size; an empty bucket still reverts BelowClip | audit/AuditClock.t.sol test_A1_31_settleRefusesARemovedTickersBucketBelowTheClip, test_A1_31_settleRefusesABlockedAccountsBucketBelowTheClipAndStillRejectsAnEmptyOne |
| A1-33 | INFO | CONFIRMED, fixed | The stateful invariant suite is committed | invariant/SleeveInvariants.t.sol (11 invariants), invariant/SleeveInvariantsReach.t.sol, invariant/SleevePullOrder.t.sol, invariant/SleeveI10.t.sol, invariant/SleeveI11Fork.t.sol |
| A1-37 | INFO | CONFIRMED, fixed | A quote too large for the minOut arithmetic reverts QuoteTooLarge, for buys and sells | audit/AuditBuyExec.t.sol test_A1_37_hugeQuoteRevertsQuoteTooLarge, test_A1_37_sell_hugeQuoteRevertsQuoteTooLarge |
| S-01 | LOW | CONFIRMED, fixed | previewSplit uses the split's own coverage rule | audit/AuditClock.t.sol test_S01_previewSplitAgreesWithThePublicSplitOnGrowthUnderOneUsdg |
| S-02 | INFO | CONFIRMED, fixed | `_recordModuleDelta` removed from SleeveModule | the harness calls SleeveState.recordModuleDelta; every bracket test |
| S-03 | INFO | CONFIRMED, fixed | docs/STATIC_ANALYSIS.md rewritten from a full rerun of both tools | none, a document |
| I-01 | MEDIUM | CONFIRMED, fixed | endOwnerOp reconciles an outside pull before it credits an owner inflow | invariant/SleevePullOrder.t.sol test_I6_aTopUpAfterADrainLandsWholeInSpend; invariant_I6_onlyIncomeIsEverSplit; unit testFuzz_I6_bracketMatchesAReferenceModel |
| I-02 | LOW | CONFIRMED, fixed | settle reverts LedgersAboveBalance while an outside pull is unreconciled | invariant/SleevePullOrder.t.sol test_I4_aSettleInTheTopUpBatchBuysOnlyWhatTheDrainLeft, test_I4_aKeeperSettleAfterTheTopUpBuysOnlyWhatTheDrainLeft; invariant_I4_onlyTheVenueWithExactApprovalReset |
| I-03 | MEDIUM | DEFERRED_C6, fixed in the integration | sell reconciles an outside pull before its proceeds land | audit/AuditLots.t.sol test_I03_aSellReconcilesAnOutsidePullBeforeItsProceedsLand |
| A1-03 | MEDIUM | DEFERRED_C6, fixed with a residual | Component 6 caps sells at the balance and adds reconcileLots; the integration trims oldest first | see Deferred to component 6 |
| A1-04 | MEDIUM | DEFERRED_C6, fixed by component 6 | PART_SOLD to PART_SOLD allowed | see Deferred to component 6 |
| A1-08 | LOW | DEFERRED_C6, fixed by component 6 | RouterBlocked in the sell guard | see Deferred to component 6 |
| A1-34 | INFO | DEFERRED_C6, fixed by component 6 | Sale proceeds are the bracket's module delta | see Deferred to component 6 |
| A1-35 | INFO | DEFERRED_C6, fixed by component 6 | sell checks the lot's account and ticker | see Deferred to component 6 |

### Deferred to component 6

| Id | Severity | How component 6 handled it | Integration | Tests |
| --- | --- | --- | --- | --- |
| A1-03 | MEDIUM | A sell is capped by the account's token balance (ExceedsBalance), tokensIn is measured by balance delta, and reconcileLots trims lots down to the balance with RECONCILED receipts. It trimmed newest first, which zeroed the lot bought after a reinstall and kept the phantom. | reconcileLots trims oldest first, the order sells take lots in. Outside tokens that refill a phantom lot stay a pinned limit, the token side of the WRAPPED limit. | audit/AuditLots.t.sol test_A1_03_reconcileTrimsTheLotWhoseTokensLeft, test_A1_03_aSellAfterTheReconcileIsBookedOnTheRightLot, test_fork_A1_03_acrossAnUninstallTheSellIsBookedOnTheLotThatHoldsTheTokens; pin test_A1_03_open_outsideTokensRefillAPhantomLot; unit/SleeveModuleSell.t.sol test_reconcileLots_trimsOldestFirstAfterTokensLeft; fork/SleeveModuleSell.t.sol test_fork_phantomLot_reconcileLotsThenSellTheRest |
| A1-04 | MEDIUM | SleeveState.transitionLot allows FILLED, SETTLED or PART_SOLD to PART_SOLD or SOLD. | None needed. SPEC 14 lists these pairs since review round 1. | unit/SleeveModuleInvariants.t.sol test_I7_lotTransitionsOnlyAsAllowed, test_I7_aPartSoldLotCanBePartSoldAgain; fork/SleeveModuleSell.t.sol test_fork_PART_SOLD_twiceThenSOLD_inBracketedUserOps_onSPYandQQQ; invariant_I7_receiptIdsIncreaseAndHashesNeverChange |
| A1-08 | LOW | The sell guard reverts RouterBlocked(router) when the registry blocks SwapRouter02. | None needed. | unit/SleeveModuleSellGuard.t.sol test_sell_routerBlocked_reverts; fork/SleeveModuleSell.t.sol test_fork_sell_routerBlocked_reverts |
| A1-13 | LOW | The queue's head moves past emptied lots and a sell by lot id touches one lot, but a sell by amount had no bound. | Bound of 100 lots per sell and per lot reconcile. | see Fixed in code or tests |
| A1-28 | INFO | Not handled. Lots stay in the module instance that bought them. | Pinned; the import path for a later version is an owner decision. | audit/AuditLots.t.sol test_A1_28_open_lotsStayWithTheModuleInstanceTheyWereBoughtIn |
| A1-34 | INFO | SleeveSell.sell credits the measured proceeds to spend and records them as the bracket's module delta. | None needed. | unit/SleeveModuleSell.t.sol test_I6_sell_insideABracket_proceedsAreTheModulesDeltaAndNeverSplit; fork/SleeveModuleSell.t.sol test_I6_fork_sell_proceedsAreNeverSplit |
| A1-35 | INFO | sell reverts LotMismatch unless the lot is the caller's and the ticker's, takes tokensRemaining down before the swap and sets SOLD exactly when the lot empties. | None needed. | unit/SleeveModuleSellGuard.t.sol test_sell_unknownOrForeignLot_reverts |
| I-03 | MEDIUM | Not handled: sell credited the proceeds without reconciling an outside pull first. | Fixed, see Fixed in code or tests. | audit/AuditLots.t.sol test_I03_aSellReconcilesAnOutsidePullBeforeItsProceedsLand |

### Confirmed, kept as built

The behavior follows the PRD and the ISleeveModule NatSpec. The fix is in the readers: SPEC, the app, the verifier, the metrics scripts or the keeper. Each has a pin test so a change to the behavior shows up.

| Id | Severity | Behavior kept | Pin tests |
| --- | --- | --- | --- |
| A1-14 | LOW | A zero equity part writes QUEUED, reason CLIP, with nothing queued (PRD 9: "part < minClip ... QUEUED(CLIP)"). Owner question below on whether an ACTIVE rule may invest nothing. | audit/AuditSplitOutcomes.t.sol test_A1_14_zeroEquityRuleWritesQueuedClipForEveryPaymentWithNothingQueued, test_A1_14_dustWritesQueuedClipWithNothingQueued |
| A1-16 | INFO | RECONCILED puts the cut off spend in usdgSpent and the cut off the buckets in usdgQueued, tickerId 0 and token zero. | audit/AuditSplitOutcomes.t.sol test_A1_16_reconciledReceiptReusesUsdgSpentAndUsdgQueuedForLedgerCuts |
| A1-30 | INFO | split has no floor, so 1 base unit makes the keeper pay for a full receipt. The fix is keeper policy. | audit/AuditSplitOutcomes.t.sol test_A1_30_oneBaseUnitMakesTheKeeperWriteAFullReceipt |
| A1-32 | INFO | bucket.reason is the latest queue reason and settle never rewrites it. The five-day prompt comes from the keeper's simulations. | audit/AuditSplitOutcomes.t.sol test_A1_32_bucketKeepsTheWeekendReasonWhileEverySettleFailsOnPremium, test_A1_32_aClipPartOverwritesTheReasonOfABucketWaitingOnPremium |

### Waiting on an owner decision

| Id | Severity | What is built | Question | Pin tests |
| --- | --- | --- | --- | --- |
| A1-02 | MEDIUM | The false comment in SessionCalendarExtension.addClosure is corrected. The gap stays: a closure the timelock could not list in time leaves the held round looking live for up to about 25 hours. | Adopt prd-questions Q8 option B, a close-only guardian halt of at most 36 hours per call, which reverses D-014's adoption of option A? | audit/AuditGuard.t.sol test_A1_02_residual_unlistedClosureBuysOnTheHeldRoundAtTheCap, test_A1_02_closureListedBeforeTheDeadlineQueuesSession |
| A1-15 | LOW | D-009 Q22: a split never merges its part with a bucket, so a bucket under the clip waits for more sub-clip parts, a clip change or a release. | Merge a sub-clip bucket into the next fill? A merged split can move more than its own unsorted amount, so PRD I4's "at most the unsorted amount in a split" would read as unsorted plus the merged bucket. | audit/AuditClock.t.sol test_A1_15_open_subClipBucketWaitsWhileLaterPaymentsFillDirectly |
| A1-17 | LOW | A trigger's pool off a non-empty allowlist reverts PoolNotAllowed, so a public caller cannot push equity into spend with a junk pool. | PRD 7.4 step 1 says REFUSED_TICKER. Keep the revert and record it in DECISIONS, SPEC 9 and SPEC 10? | audit/AuditAdmin.t.sol test_A1_17_open_poolOffANonEmptyAllowlistReverts |
| A1-27 | LOW | A ticker's session type is fixed at construction; removeTicker is the only lever. | Add a one-way timelocked narrowSessionType from ALL_DAY to REGULAR? It extends the admin's writes past PRD 13 and 14's remove-only wording. | audit/AuditAdmin.t.sol test_A1_27_open_sessionTypeIsFixedAndRemovalIsTheOnlyLever |
| A1-28 | INFO | Lots live in the module instance that bought them; v1 keeps public lot and lotsOf views. | How a later version takes over holdings: import v1 lots by reading v1, or let a sell take tokens beyond the lots. | audit/AuditLots.t.sol test_A1_28_open_lotsStayWithTheModuleInstanceTheyWereBoughtIn |

### Accepted

| Id | Severity | Basis |
| --- | --- | --- |
| A1-06 | LOW | PRD 7.3 "Slippage cap against the trigger's quote"; PRD 7.4 step 9 "Tokens received meet the trigger's quoted minimum" and "The premium cap bounds whatever manipulation remains"; PRD 14 "A moved pool cannot make Sleeve pay more than the cap"; D-009 Q21 "Public callers bring their own quote, so the premium cap is their real bound". |
| A1-07 | INFO | D-019 "Uninstall gas": the app sets callGasLimit to at least 400,000 for uninstall ops and checks ModuleUninstallResult; a skipped release is recovered by a second uninstall or the next install. |
| A1-09 | LOW | D-014, batch 2 default "a 24-hour pending-multiplier window with no after-clause"; SPEC 4 "No after-clause". |
| A1-11 | LOW | D-014 adopting prd-questions Q9 option A: premium math in USDG at par, as PRD 7.4 step 8 reads it ("computed from USDG spent and tokens received"). |
| A1-20 | INFO | PRD 9 failure table "Venue reverts or minimum not met: Whole call reverts" and "Issuer or Paxos freeze: Sleeve cannot prevent it"; D-009 Q12; D-018 (external reverts bubble). |
| A1-22 | INFO | PRD 14 "Keeper key stolen: It has no authority beyond public functions"; PRD 7.2 "The keeper has no power beyond what anyone has after the grace period"; D-004; D-014 batch 2 item 7 (a per-account keeper the owner can change). |
| A1-29 | INFO | D-013, first bullet: a pull the module cannot see shows up as less income, because the contract sees balances, not transfers. |
| A1-36 | INFO | SPEC 9 step 5.4 (SESSION covers a timestamp outside coverage); D-009 Q7; D-017 (2028 must be appended before Sunday 2 January 2028 20:00 EST, and the keeper alerts ahead of coverageEnd()). |

### Refuted

None. Every one of the 51 raw reports reproduced, at e16bb96 for the parts fixed before verification and on the snapshot for the rest, or was merged into a finding that did. The verifiers corrected some details:

- A1-02: the longest in-session gap across the four feeds in the audit week was 13 h 05 min (Tue 29 Sep 18:06:27 to Wed 30 Sep 07:11:17 EDT), not about 12 hours.
- A1-03: in the uninstall form a sell by amount of 5 does not revert; the account really holds 5 tokens, so the swap succeeds and the sale is booked against the phantom lot. Only amounts above the real balance revert, with SwapRouter02's opaque "STF".
- A1-09: the proposed `>=` variant only adds the rest of one second, so it gives no real protection.
- A1-05, A1-06, A1-07, A1-16, A1-20, A1-21, A1-22 and A1-24 were judged one level lower than raw, and the per-finding sections give the reasons.
- The earlier version of this file said several accepted gaps were recorded in SECURITY.md. No SECURITY.md exists yet. The residuals it needs are listed below.

## Findings

### Buy execution, the trigger's quote and buy invariants

#### A1-01 HIGH: One base unit donated to the module blocked every buy

- Where: contracts/src/libraries/SleeveBuy.sol:119 (`_requireNothingKept`, called from `execute`); lines 115 to 118 at e16bb96. Lenses: reentrancy, funds, tokens, denial of service, current exploit patterns.
- Scenario: anyone calls USDG.transfer(module, 1). At e16bb96 every executeBuy then reverted ModuleHoldsFunds(USDG, 1), so every split whose guard reached the buy reverted for every account, and every settle too. One base unit of SPY did the same for every SPY buy. The module is immutable and has no sweep, so recovery meant a new module and every account reinstalling. USDG stayed spendable and buckets could be released.
- Evidence: the four round 1 proofs of concept pass at e16bb96 and fail at 6535108 with "next call did not revert as expected". Five new tests pass at 6535108, including the settle case the committed regression did not cover and a check that a leak during the buy still reverts.
- Status: FIXED in 9a6edba. execute reads the module's USDG and token balances before the batch and reverts only when either changed. Component 6's sell uses the same delta, and the invariant suite asserts it after every call. The integration adds the settle regression and states I1 as a delta in the NatSpec of SleeveModule, SleeveBuy and ISleeveModule. ModuleHoldsFunds documents that it carries the module's balance after the swap.
- Owner decision: PRD I1 still reads "The module holds no USDG and no stock tokens before or after any call", which no code can keep once a stranger transfers to the module. Restating it as "No call changes the module's USDG or stock token balance" changes how a PRD invariant holds, so it is the owner's call under the build contract. D-026 records the question. SPEC sections 1, 11 and 17 describe the delta as built and mark the wording pending; CLAIM_LEDGER claim 3.7 and its I1 row, and PROGRESS line 47, follow once the owner agrees.

#### A1-06 LOW (raw MEDIUM): The caller-chosen quote makes the slippage cap meaningless for keeper and public triggers

- Where: contracts/src/libraries/SleeveTrade.sol:422 (minOut in `_buy`), with `_enter` at line 499 rejecting only a zero quote. Lenses: oracle, funds, current exploit patterns.
- Scenario: once the grace has run, an attacker pushes an allowlisted pool to just under the premium cap, calls split(account, pool, 1) and unwinds. minOut comes from the caller's quote, so the owner's slippage cap does not bind; the premium cap against the Chainlink answer does. A leaked KEEPER key can do the same with no grace (A1-22).
- Evidence: mock proof of concept, 4 of 4: a public quote of 1 fills with minOut 49 and premiumBps 100 under a 50 bps slippage rule, and slippage 0 under a 500 bps cap fills at about 500 bps. Fork proof of concept at block 78,312,136 on the real SPY fee-500 pool, SwapRouter02 and a Kernel v3.1 account: on a 100 USDG buy the highest push that still fills is 90 bps, 35,160.76 USDG through the pool, and the attacker loses 34.52 USDG; on a 25,000 USDG buy a 65 bps push fills at 97 bps against an honest 55 bps, and the attacker gains 80.30 USDG.
- Status: ACCEPTED, judged LOW because the loss stays inside the owner's own cap, which the app shows as the worst case, and the sandwich loses money on payday-sized buys. Basis in the Accepted table. Follow-ups: SECURITY.md with the fork numbers, the app's rule summary, and a CLAIM_LEDGER note that live premiums can cluster at the cap when public triggers fire. Optional hardening, an owner decision: floor minOut for KEEPER and PUBLIC triggers at the feed-implied output less the slippage cap, checked after the premium step so a failure queues.

#### A1-12 LOW: The minimum-out check ran before the premium check

- Where: contracts/src/libraries/SleeveBuy.sol:108 (amountOutMinimum in `_calls`) and the TooFewTokens check in `_swap`. Lens: spec fidelity.
- Scenario: the keeper quotes, then the pool moves 150 bps, so PRD 7.4 steps 8 and 9 both fail. The router's "Too little received" reverted the split with no receipt, where PRD 7.4 orders step 8 first and writes QUEUED(PREMIUM) with a bucket. settle returned the router's string instead of GuardNotClear(PREMIUM). Nothing moved either way.
- Evidence: mock proof of concept 3 of 3, and a fork proof of concept after a 100,000 USDG whale push on the real SPY pool, where a fresh quote queues PREMIUM and the stale quote reverted. The round 1 proof of concept passes at both commits.
- Status: CONFIRMED, fixed. The batch passes amountOutMinimum 0. `_swap` keeps the I3 check, TooFewTokens(0, minOut) when no tokens arrived. execute checks the premium cap and then TooFewTokens(tokensOut, minOut), inside executeBuy, so a failure still undoes the swap. Sells do the same: TooLittleUsdg below minOut is checked after DiscountAboveCap. Regression tests in the status table. Tests that pinned the router string now expect the named errors: test_split_minimumOutFailure_revertsWithNothingMoved, test_settle_otherReverts, test_fork_minimumOutFailure_revertsWithNothingMoved, test_I3_fork_tokensLandInTheAccountOrTheCallReverts, test_sell_minimumOutFailure_reverts and test_fork_sell_minimumOutFailure_reverts. test_I3_split_tooFewTokens_revertsWithNothingMoved now uses a 0.6 percent short fill, inside the cap, because a 1 percent short fill is 101 bps over the feed and queues PREMIUM as PRD 7.4 orders.

#### A1-19 LOW: Code inside the account batch could forge PremiumAboveCap

- Where: contracts/src/libraries/SleeveTrade.sol:439 (`_buy` catching any 36-byte revert with the PremiumAboveCap selector). Lens: reentrancy.
- Scenario: the owner installs Sleeve with a Kernel executor hook whose postCheck reverts PremiumAboveCap(-4242), or runs a custom account. Kernel v3.1 runs executor hooks inside executeFromExecutor and passes the revert through, so split wrote QUEUED(PREMIUM) with premiumBps -4242 and a bucket, and the swap was undone. Only the owner's own code, or the USDG, token and feed contracts, can raise it.
- Evidence: mock proof of concept 4 of 4, and a fork proof of concept at 78,312,136 where a hook installed through a root UserOp on a deployed Kernel v3.1 account turns a FILLED split into a forged QUEUED(PREMIUM) receipt while the pool's USDG does not move.
- Status: CONFIRMED, fixed. SleeveBuy._swap wraps the batch; a revert from it with the PremiumAboveCap selector becomes BatchReverted(reason), and every other revert bubbles unchanged. Residual, pinned by test_A1_19_residual_aReadInsideExecuteBuyCanStillRaiseIt: a read executeBuy makes outside the batch (USDG, the stock token or the feed) can still raise the selector. Those contracts can already fake a fill through balanceOf, so screening each read adds nothing. SleeveBuy grows to 6,099 bytes with A1-12 and A1-23.

#### A1-33 INFO: No stateful invariant suite for I1, I4 and I8 in the audited commit

- Where: contracts/test/unit/SleeveModuleInvariants.t.sol:15, stateless fuzz only. Lens: spec fidelity.
- Scenario: SPEC 17, PRD C3 ("Tested by invariant fuzzing") and HP3 ask for invariant fuzzing; the commit had only the TokenSource I10 invariants. CLAIM_LEDGER rows 1.9 and 3.7 stayed PENDING.
- Status: CONFIRMED, fixed. The suite is committed and extended to sells (see Invariant suite). For the PROGRESS note the verifier asked for, the fork tests that rely on mocks are: the reopen latestRoundData mocks in SleeveModuleWeekend and SleeveModuleSellWeekend, PartialFillRouter in the fork split and sell suites, the onUninstall mockCallRevert in the fork split suite, the harness's seeded lots in SleeveModuleSell and SleeveModuleSellWeekend, and the ArbSys etch in every fork test. CLAIM_LEDGER rows 1.9 and 3.7 can move off PENDING once this lands.

#### A1-37 INFO: A trigger-supplied quote could make the minOut mulDiv panic

- Where: contracts/src/libraries/SleeveTrade.sol:422. Lens: arithmetic.
- Scenario: split(account, pool, type(uint256).max) reverted Panic(0x11) from OpenZeppelin's mulDiv instead of a named error. Only the caller's own transaction failed.
- Evidence: mock proof of concept 3 of 3. The edge is exactly amount * quote >= 2^256 * 1e6.
- Status: CONFIRMED, fixed. `_buy` reverts QuoteTooLarge(quote) when the high word of amount * quote reaches the quote unit, which is exactly mulDiv's panic condition, so no other quote changes. The sell's `_minOut` does the same with its 1e18 unit.

### Public-trigger clock, settle liveness and keeper load

#### A1-05 LOW (raw MEDIUM): Dust and keeper splits kept the public trigger from firing

- Where: contracts/src/libraries/SleeveTrade.sol:78 (observe), 528 (`_settleReadyAt`) and 110 and 301 (clearing the observation). Lenses: spec fidelity, denial of service, access, funds.
- Scenario: at e16bb96 a griefer kept the public split shut for good with 1 base unit and an observe every 50 minutes. 40682ef raised the restart to 1 USDG of growth, paid to the owner. What remained at 6535108: (a) 1 USDG per restart still postpones the public split, and income arriving at least hourly keeps it shut while the keeper is down, with no griefer; (b) any keeper or public split, even of dust, cleared the observation a public settle needed, so 8 base units kept a bucket from public settlement for 8 hours, and on a REGULAR ticker a public dust split before the opening did it with no race; (c) previewSplit disagreed with the split for growth under 1 USDG (S-01); (d) growth under 1 USDG rides the older clock.
- Evidence: the round 1 dust proofs of concept fail at 6535108. Ten residual proofs of concept pass at 6535108, and the fix patch makes the (b) and (c) cases and the settle half of (a) fail.
- Status: CONFIRMED, fixed for (b) and (c), with (a) and (d) bounded and pinned. `_settleReadyAt` reads only the bucket's since and, while the session is open, its opening, plus the grace; settle no longer touches the observation and no longer needs one. The keeper keeps the first hour after every reopen. One predicate, `_covers`, serves observe, the public split and previewSplit. Trade-off: a sub-clip part that lifts an old bucket over the clip no longer gives the keeper a fresh hour. Regression tests in the status table; unit tests on the old D-009 Q16 rule were updated (test_settle_publicGraceRunsFromTheLaterOfSinceAndTheOpening, test_settle_publicNeedsNoObservation, test_settle_publicGraceRunsFromSinceWhenTheBucketIsNewer, test_previewSettle_matchesWhatSettleDoes, and the fork weekend settle). D-025 replaces D-009 Q15 and Q16 with the 1 USDG restart, its bound and the hourly-income residual, and SPEC 8 describes the clock as built.

#### A1-15 LOW: An equity part below the clip strands in its bucket once later payments fill directly

- Where: contracts/src/libraries/SleeveTrade.sol:254 (the buy branch of `_sort`) and 278 (BelowClip in `_settle`). Lens: funds.
- Scenario: default rule. A 100 USDG payment queues 10 USDG as CLIP. Five later 1,000 USDG payments each fill exactly 100 USDG. The 10 USDG bucket never reaches the 25 USDG clip, so neither the keeper nor a public caller can settle it; only a release or a clip change frees it.
- Evidence: proof of concept on 6535108, and the round 1 proof of concept passes unchanged. A merge prototype passes the module unit suite and the fork split and settle suites.
- Status: CONFIRMED, waiting on the owner. D-009 Q22 documents the no-merge rule but assumes the keeper settles any bucket that reaches the clip, and nothing documents a bucket that never does. Nothing is lost: the money waits as pending USDG and release always works. If the owner keeps Q22, the minimum fix is a Q22 note and the app's five-day CLIP prompt offering "lower the clip" and "release to spend".

#### A1-25 LOW: The observation level survived an owner outflow or a reconcile

- Where: contracts/src/SleeveModule.sol:428 (`_bookOwnerOutflow`) and SleeveTrade.sol:105 (the reconcile branch of split). Lens: transient storage.
- Scenario: a 500 USDG payment is observed at T0. The owner withdraws 600 USDG in a bracketed batch, emptying unsorted, but the observation still covers 500. Five hours later a 400 USDG payment is split by a stranger in the block it lands, skipping the keeper's hour. The everyday form: the rule is paused, a payment is observed, the owner spends it and resumes. A third-party pull reconciled by a keeper split leaves the same stale level.
- Evidence: five proofs of concept on 6535108, and the round 1 proof of concept passes unchanged.
- Status: CONFIRMED, fixed. SleeveState.clampObservation lowers observedUnsorted to the unsorted USDG left after an owner outflow, to zero after a reconcile, and to the current unsorted when observe finds the level above it. observedAt is kept, so a pending bucket's clock and dust coverage are unchanged. Residual, pinned by test_A1_25_residual_unseenPullWithNoModuleCallInBetween: a pull smaller than unsorted that no module call sees leaves the level high, the same limit D-013 records for WRAPPED.

#### A1-30 INFO: Any unsorted amount, down to 1 base unit, makes the keeper pay for a full split and receipt

- Where: contracts/src/libraries/SleeveTrade.sol:102 (split has no floor). Lens: denial of service.
- Scenario: 1 base unit sent to each of 1,000 installed accounts makes a keeper that splits any unsorted balance write 1,000 receipts.
- Evidence: on the fork at 78,312,136 the sender's USDG transfer costs 65,342 gas, the keeper's split of 1 base unit 146,539 and of 10 base units 286,826. Dusting 1,000 accounts costs the keeper 0.0046 to 0.0091 ETH against 0.0021 ETH for the sender at the docs/GAS.md gas price.
- Status: CONFIRMED, kept as built. The fix is keeper policy. Split at once when unsorted is at least 1 USDG; below that, wait until the oldest unsorted inflow is 24 hours old, the PRD 7.2 gas-ceiling override age, or until more income lifts unsorted past 1 USDG. Do not use minClip * 10,000 / equityBps as the floor, which would hold an ordinary 100 USDG payment for a day and break C1's two-minute median. Exclude sub-1-USDG inflows from the C1 measurement.

#### A1-31 INFO: A removed ticker's or a blocked account's bucket below the clip was not refused to spend

- Where: contracts/src/libraries/SleeveTrade.sol:278 (BelowClip before the guard) and previewSettle line 212. Lens: spec fidelity.
- Scenario: two accounts hold NVDA buckets of 10 and 50 USDG. After removeTicker(NVDA) the 50 USDG bucket settles REFUSED_TICKER as D-009 Q24 says, but the 10 USDG one reverted BelowClip and stayed pending. The same for a blocked account and step 2.
- Status: CONFIRMED, fixed. settle reverts BelowClip for an empty bucket first, runs the guard, and applies the clip only when steps 1 and 2 do not refuse the bucket. previewSettle mirrors it. SPEC 10 says steps 1 and 2 send the bucket to spend at any size.

### Price guard, feeds and USDG

#### A1-02 MEDIUM: An unscheduled closure or market-wide halt lets the held price pass as live for the whole day

- Where: contracts/src/libraries/PriceGuard.sol:237 (`readStockFeed`) with SessionCalendarExtension.sol:188 (addClosure's deadline). Lens: oracle.
- Scenario: a short-notice closure, such as a national day of mourning, closes NYSE and the 24 Hour Market on a Wednesday after addClosure's deadline, 00:00Z on the day, on top of the 48-hour timelock. The calendar still says open since Sunday 20:00, so the feed's last round before the closure passes the 25-hour age check and the reopen check, and a keeper or public split fills within the premium cap of that held price while the pool trades on news.
- Evidence: end-to-end proofs of concept through the module with the real SessionCalendarExtension and TokenSource: addClosure reverts ClosureTooLate even with no timelock delay, a keeper split on the Wednesday writes FILLED against a 23 h 1 min old round at the cap, and previewSplit says FILLED every hour of the closed day. A closure listed in time queues SESSION.
- Status: CONFIRMED. The integration corrects the addClosure NatSpec, which claimed PriceGuard guards a late closure. The gap stays until the owner decides: D-014 adopted prd-questions Q8 option A on the premise that age, freshness, oraclePaused and the premium cap guard a short-notice closure, and the proof of concept shows age and freshness do not trip, while oraclePaused has never been set on these tokens. Proposed option B: a close-only guardian halt in SessionCalendarExtension, at most 36 hours per call and only extendable, which can never open a session or move funds. A cross-feed liveness bound in PriceGuard is not a substitute, because normal nights had a 13 h 05 min gap across all four feeds. Docs to follow: D-017's "Timelock deadlines" bullet and SECURITY.md.

#### A1-09 LOW: No post-change multiplier check

- Where: contracts/src/libraries/PriceGuard.sol:210 (`checkMultiplier` returns NONE once effectiveAt has passed). Lens: oracle.
- Scenario: the issuer applies a multiplier with the immediate form of updateMultiplier. It is never pending, so the guard never queues, and a round from before the change passes right after effectiveAt.
- Evidence: proofs of concept for the immediate and the scheduled form, both passing.
- Status: ACCEPTED (basis in the Accepted table). It only bites if the feed is built from mismatched parts; every observed change, 5.66 to 17.18 bps, used the scheduled form. Optional, an owner decision: Q10 option C, MULTIPLIER for one hour after effectiveAt when the round predates it, mirrored in the sell guard.

#### A1-10 LOW: The reopen freshness test used updatedAt, not startedAt

- Where: contracts/src/libraries/PriceGuard.sol:234 to 237. Lens: oracle.
- Scenario: at the Sunday 20:00 EDT reopen, a round observed at 19:59:55 and transmitted at 20:00:07 carries Friday's answer with updatedAt after the opening, and the keeper's settle at the open buys on it.
- Evidence: real reopen rounds read through the archive RPC show startedAt as the observation time, 12 seconds before updatedAt (SPY round 147, NVDA round 1107). The proof of concept settles on such a round at 6535108; a round transmitted one second before the reopen is STALE.
- Status: CONFIRMED, fixed. readStockFeed reads startedAt and returns STALE when the round was observed or transmitted before the session opened. The SleeveTypes STALE text, the PriceGuard NatSpec and the sell's mirrored guard follow; under the sell override the opening is zero, so the rule does not apply there. SPEC 4 says the same, and D-026 amends D-017's sessionOpenedAt bullet. The receipt layout is unchanged: the verifier derives startedAt from getRoundData(roundId).

#### A1-11 LOW: The premium cap treats USDG as exactly 1 USD

- Where: contracts/src/libraries/PriceGuard.sol:299 (`exceedsPremium`) and 365 (`premiumBps`). Lenses: oracle, arithmetic.
- Scenario: with USDG/USD at 1.005, inside the 50 bps band, a fill at the 100 bps cap in USDG is 150 bps over the USD reference.
- Evidence: proofs of concept at 1.005 and 0.995 show the effect is symmetric and bounded by the band. USDG/USD has stayed within 4.14 bps of 1 since 5 June 2026.
- Status: ACCEPTED (basis in the Accepted table). D-026 and SPEC 13 now say directly that premiumBps on receipts is the USDG premium at par, so the verifier and the HP2 replay never convert. Still to do: the app's worst-case line must say it is in USDG terms, and SECURITY.md records it.

#### A1-20 INFO (raw LOW): A USDG pause or freeze reverts split and settle wholesale

- Where: contracts/src/libraries/SleeveTrade.sol:443 (`_buy` rethrows every revert but the premium). Lens: tokens.
- Scenario: Paxos pauses USDG or freezes SwapRouter02 in USDG. Every split whose guard would buy reverts with USDG's own error and no receipt, and keepers retry.
- Evidence: unit tests with a Paxos-like USDG, and fork tests against the real USDG with the pause and freeze flags set: ContractPaused (0xab35696f) and AddressFrozen (0x1fd1cc44) on the approve that opens every buy batch. Nothing moves, and release keeps working.
- Status: ACCEPTED (basis in the Accepted table), judged INFO because only liveness and receipts are affected during a Paxos action Sleeve cannot prevent. Optional, an owner decision because it extends PRD 7.4: queue PAUSED when USDG is paused or the router or pool is frozen.

### Lots and sell-back

#### A1-03 MEDIUM: Lots were never reconciled with the account's token balance

- Where: contracts/src/libraries/SleeveState.sol:164 (createLot is the only writer of tokensRemaining). Lenses: tokens, funds, spec fidelity.
- Scenario: a bracketed owner batch moves a lot's tokens out, or the owner uninstalls, sends the tokens away and reinstalls. The lot still claims the tokens, so receipts and holdings show tokens that are gone, and a sell is booked against the phantom lot, which breaks D-009 Q30.
- Evidence: precondition proofs of concept on 6535108, and three residual proofs of concept against component 6's working tree: (a) in the uninstall form a sell was booked PART_SOLD on the pre-uninstall lot while the new lot still claimed the tokens; (b) reconcileLots trimmed newest first, zeroing the new lot that holds every token; (c) after a bracketed transfer of a whole lot and an equal outside inflow, reconcileLots trims nothing and the outside tokens sell as the lot.
- Status: DEFERRED_C6, fixed with a residual. Component 6 caps a sell at the balance and adds reconcileLots; the integration makes it trim oldest first, the order sells take lots in, which fixes (a) and (b) once reconcileLots runs before the sell. (c) stays: tokensRemaining is an upper bound until reconciled, and tokens arriving from outside Sleeve can refill a lot, the token side of PRD 7.2's WRAPPED limit. App duties: add reconcileLots for every ticker with lots to the install op, and to every owner batch that moves a stock token, after the move and before any sell in the batch. D-027 records the upper bound and the app duty.

#### A1-04 MEDIUM: The lot transition rule forbade PART_SOLD to PART_SOLD

- Where: contracts/src/libraries/SleeveState.sol:181. Lens: funds.
- Scenario: an owner sells 3 of a 10-token lot, then tries 2 more. The second partial sale of the same lot reverted BadLotTransition.
- Status: DEFERRED_C6, fixed by component 6 (allowed pairs: FILLED, SETTLED or PART_SOLD to PART_SOLD or SOLD; SOLD is final). No PRD change: PRD 7.5 says "The lot becomes PART_SOLD or SOLD" and I7 defers to the listed transitions, which are SPEC 14's. SPEC 14 lists the new pairs since review round 1.

#### A1-08 LOW: The planned sell guard missed the router blocklist

- Where: contracts/src/libraries/PriceGuard.sol:184 (`checkToken` reads the account and the pool only). Lens: tokens.
- Scenario: the registry's BLOCKER_ROLE blocks SwapRouter02. The Stock Token's approve checks the spender and transferFrom checks the caller, so every sell would revert inside the batch, through SwapRouter02 as an opaque "STF". Buys are unaffected, because on a buy the pool moves the token.
- Evidence: unit and fork proofs of concept, the fork one impersonating the real BLOCKER_ROLE holder 0x913cA87347391218e5De2C17c5A0AEba8B0b28fD.
- Status: DEFERRED_C6, fixed by component 6: the sell guard reverts RouterBlocked(router).

#### A1-13 LOW: Lot queues grow without bound and a by-amount sell wrote one receipt per lot

- Where: contracts/src/libraries/SleeveState.sol:171 (createLot pushes every lot). Lens: denial of service.
- Scenario: an account on the campaign rule builds hundreds of lots, and a "sell everything" by amount runs out of gas or past a bundler's callGasLimit.
- Evidence: against component 6's working tree, 56,475 gas per extra lot: 2,970,064 gas for a sell over 50 lots and 17,089,005 over 300.
- Status: DEFERRED_C6. Component 6 moves the queue's head past emptied lots and a sell by lot id touches one lot, but a sell by amount had no bound. Fixed in the integration: a sell by amount takes from at most 100 lots and reverts TooManyLots(sellableTokens, 100) when it would need more, telling the app how much one call can sell; a lot reconcile trims at most 100 lots per call and LotsReconciled reports what that call trimmed. Measured on the fork, a sell across 100 real lots costs 6,000,591 gas. The bound limits the receipts per call, not every read: reconcileLots sums every lot from the head, and a sell by amount and the head's walk step over empty lots, so a very long queue still costs more (D-027). A paged lotsOf view was not added: it is an off-chain read bounded by the RPC's call gas cap, about 2,400 gas per lot.

#### A1-28 INFO: Lots are keyed to this module instance

- Where: contracts/src/libraries/SleeveState.sol:164 (lots live in the module's storage). Lens: spec fidelity.
- Scenario: the issuer edits its disclosure, Sleeve ships v2 with the new hash, and the owner installs v2. The account still holds its SPY, but v2 has no lots for it, so it is not sellable through v2 (D-009 Q30).
- Status: DEFERRED_C6, waiting on the owner. v1 keeps public lot() and lotsOf() views, so a later version can import v1 lots without any v1 change. The DECISIONS entry should pick (a) a v2 that imports the caller's v1 lots oldest first, capped at the token balance, with one receipt per imported lot, or (b) a v2 that lets a sell take tokens beyond the lots under the same guard, booked to no lot.

#### A1-34 INFO: Sell-back must record its proceeds in the bracket's module delta

- Where: contracts/src/libraries/SleeveState.sol:108 (the module delta's only writer was `_recordFill`). Lens: transient storage.
- Scenario: a sell inside a bracket that credits spend without recording the module delta makes endOwnerOp credit the proceeds a second time.
- Status: DEFERRED_C6, fixed by component 6: SleeveSell.sell measures usdgOut by balance delta, credits spend and records it as the module delta.

#### A1-35 INFO: Lot plumbing has no ownership check

- Where: contracts/src/libraries/SleeveState.sol:176 (`transitionLot` checks only existence and the status pair). Lens: access.
- Status: DEFERRED_C6, fixed by component 6: `_plan` reverts LotMismatch unless the lot is the caller's and the ticker's, tokensRemaining drops before the swap, and the status is SOLD exactly when the lot empties, otherwise PART_SOLD.

### Install, uninstall, keeper and self-registered accounts

#### A1-07 INFO (raw LOW): The uninstall release needs about 250k to 330k gas, and a short callGasLimit skips it silently

- Where: contracts/src/SleeveModule.sol:155 (onUninstall). Lenses: denial of service, account abstraction.
- Scenario: Kernel v3.1 clears the executor, then calls onUninstall with whatever gas is left and ignores the result. A bundler-estimated callGasLimit can land in a band where the op succeeds, Kernel no longer lists the module, and the buckets are not released.
- Evidence: fork map at 78,312,136 with four buckets, in 5,000-gas steps: a plain uninstall op is SILENT between 110k and 120k, 160k to 180k and 190k to 315k, and FULL from 315,502; the bracketed op as the app builds it is FULL from 345k. The outcomes are not monotonic. At the D-019 floor of 400,000 both forms release in full, and a second uninstall recovers a skipped release.
- Status: ACCEPTED (basis in the Accepted table). Follow-ups: the app's uninstall op uses a fixed callGasLimit floor of 450,000 to 500,000, never the bundler estimate, asserts ModuleUninstallResult(module, true) and recovers on false; the outcome map goes in docs/GAS.md. SPEC 6 says onUninstall can run out of gas.

#### A1-21 INFO (raw LOW): The module-wide reentrancy lock let a self-installed contract fail other accounts' calls

- Where: contracts/src/SleeveModule.sol:35 (one ReentrancyGuardTransient slot for the whole module, held across executeFromExecutor). Lens: transient storage.
- Scenario: a contract that installed the module on itself runs EntryPoint.handleOps with a victim's signed owner op from inside its own buy. The victim's op passes validation, then fails at beginOwnerOp with ReentrancyGuardReentrantCall, and the victim pays for it.
- Evidence: unit and fork proofs of concept. On the fork the victim's op paid 259,424 gas to the attacker's beneficiary and its transfer did not happen.
- Status: CONFIRMED, fixed. The lock is a transient slot per account: owner entry points lock msg.sender, observe, split and settle lock their account argument, and a second entry for the same account reverts AccountLocked(account). The account's own reentry into any writer of its state still reverts. This replaces OpenZeppelin's ReentrancyGuardTransient, the guard this run's contract standards name, so D-026 records it, flagged for the owner. On 4663 the attack also needed the victim's op before inclusion, which only the bundler the app uses would see.

#### A1-22 INFO (raw LOW): defaultKeeper is immutable and shared

- Where: contracts/src/SleeveModule.sol:141 (onInstall assigns defaultKeeper for a zero keeper). Lens: access.
- Scenario: a leaked KEEPER key keeps the no-grace trigger on every account that uses the default keeper until each owner rotates, bounded by each rule's premium cap.
- Evidence: proof of concept: the default keeper splits a fresh payment at once with quote 1 and fills at 99 bps under a 100 bps cap, while a stranger gets GracePeriodActive; setKeeper on one account rotates only that account.
- Status: ACCEPTED (basis in the Accepted table). Operations: the app always passes an explicit keeper in the install data, and the keeper runbook for a leak appends setKeeper to each account's next owner op. SECURITY.md should state the exposure. A timelocked, rotatable default-keeper pointer would add an admin power over accounts and is not recommended.

#### A1-23 LOW: Any contract could write genuine-looking FILLED receipts with fabricated fills

- Where: contracts/src/libraries/SleeveBuy.sol:71 (fills measured on the account only). Lenses: account abstraction, access.
- Scenario: a contract installs the module on itself, gets the default keeper, and answers the buy batch by sending the equity USDG to its own sink and minting or pulling tokens. The receipt is FILLED with a premium below -9,000 bps, its hash matches, a lot exists, and the pool never moved. Repeated, it pollutes the shared receipt log and every metric that aggregates it, and makes the keeper pay gas.
- Evidence: unit and fork proofs of concept, the fork one with the real SPY token pulled from the contract's own stash.
- Status: CONFIRMED, fixed. SleeveBuy and SleeveSell read the allowlisted pool's USDG and token balances around the batch and revert FillNotFromPool unless the pool gained exactly what the account spent and lost exactly what it received, or the reverse for a sell. A real SwapRouter02 swap on a v3 pool passes on all five allowlisted pools. The pool reads are most of the 10,800 gas each fill gained in the integration (docs/GAS.md). Off chain, the keeper should trigger only app-registered accounts on the Kernel v3.1 implementation 0xBAC849bB641841b44E965fB01A4Bf5F074f84b4D with a hard gas limit per call, and the verifier and metric scripts should count only such accounts.

#### A1-24 INFO (raw LOW): onUninstall wiped the state while Kernel still listed the executor

- Where: contracts/src/SleeveModule.sol:155. Lens: account abstraction.
- Scenario: an uninstallModule of type 4, 5 or 6 naming Sleeve, or a direct call in an owner batch, ran onUninstall without removing the executor. The state was deleted, so the next paycheck could not be split and the reinstall snapshot booked it all to spend.
- Evidence: fork proof of concept on a deployed Kernel v3.1 account for types 4, 5 and 6 and a direct call.
- Status: CONFIRMED, fixed. onUninstall reverts ModuleStillListed(account) while the account still lists the module; Kernel clears the executor config before a real executor uninstall, which still releases. The check is SleeveState.listsModule, the same one the triggers use. SPEC 6 now says onUninstall reverts ModuleStillListed while the account still lists the module.

### Split outcomes, reconcile and receipt fields

#### A1-14 LOW: A zero equity part writes QUEUED with reason CLIP though nothing is queued

- Where: contracts/src/libraries/SleeveTrade.sol:246. Lenses: spec fidelity, arithmetic.
- Scenario: a 100 percent spend rule, or dust under the default rule, writes QUEUED/CLIP with usdgToEquity 0 for every payment. The app showed these as waiting buys that no settle or release can clear.
- Status: CONFIRMED, kept as built: it is PRD 9's "part < minClip, QUEUED(CLIP)" applied to a zero part, and PRD 7.6 fixes the status list. Fix in the readers: SPEC 9 and 13 say readers key on usdgToEquity == 0, the app titles these "Sorted to spend", and the verifier and metrics count a QUEUED receipt as queued only when usdgQueued > 0. Owner question: if an ACTIVE rule must invest, setRule reverts a new ZeroEquityShare for equityBps 0.

#### A1-16 INFO (raw LOW): RECONCILED receipts repurpose usdgSpent and usdgQueued

- Where: contracts/src/libraries/SleeveTrade.sol:340 (`_reconcile`). Lens: spec fidelity.
- Scenario: summed without regard to status, usdgSpent counts a third-party pull as investment, and the I2 identity holds on the RECONCILED receipt, so a status-blind check cannot catch it.
- Status: CONFIRMED, kept as built: the receipt is hashed and the mapping is in the ISleeveModule NatSpec. SPEC 13 and D-026 define it; the app's mock engine, CSV export and correction section should follow it; the verifier gets a RECONCILED test vector (usdgIn == usdgSpent + usdgQueued, usdgToSpend 0, tickerId 0, token zero, and the cuts equal to the Reconciled event).

#### A1-29 INFO: Income arriving before an outside pull is reconciled is netted against the shortfall

- Where: contracts/src/libraries/SleeveTrade.sol:100. Lens: funds.
- Scenario: spend 100, a pull of 100, then a 1,000 USDG payment before the keeper runs: the split sorts 900.
- Evidence: proofs of concept, one reproducing D-013's own example exactly.
- Status: ACCEPTED (basis in the Accepted table). Keeper: split any account whose previewSplit shortfall is above zero on every poll. The inbox explains a split whose usdgIn is below the transfers it sorted.

#### A1-32 INFO: bucket.reason is the latest queue reason and settle never updates it

- Where: contracts/src/libraries/SleeveTrade.sol:360 (`_queue`). Lens: spec fidelity.
- Scenario: a bucket queued SESSION on Saturday reads SESSION on Thursday while every settle since Monday failed PREMIUM, and a later CLIP part overwrites the reason of a bucket waiting on PREMIUM.
- Status: CONFIRMED, kept as built, as documented in ISleeveModule. The PRD 7.4 five-day prompt comes from the keeper: it stores reason, firstSeen and lastSeen per account and ticker from each settle simulation, and the app prompts when one reason has held for five days. SPEC 10 says so.

### Admin powers, pool allowlist and calendar coverage

#### A1-17 LOW: A trigger's pool off a non-empty allowlist reverts where PRD 7.4 says REFUSED_TICKER

- Where: contracts/src/libraries/SleeveTrade.sol:387 (`_guard` step 1). Lens: spec fidelity.
- Scenario: the timelock removes a pool the keeper cached. The keeper's split reverts PoolNotAllowed with no receipt, where SPEC 9 and PRD 7.4 step 1 expect REFUSED_TICKER with the equity in spend.
- Status: CONFIRMED, waiting on the owner. The revert is safer than the literal PRD: under it any public caller after the grace could push every equity share and bucket into spend with a junk pool. With the A1-18 fix an active ticker always has a pool, so step 1 never gives two outcomes for an active ticker. SPEC 9 and 10 describe the revert as built and mark it pending. If kept: a DECISIONS entry, and the keeper re-reads poolsOf before each trigger and refreshes on PoolNotAllowed.

#### A1-18 LOW: An empty allowlist on an active ticker turned every equity part and bucket into spend

- Where: contracts/src/libraries/SleeveTrade.sol:388 and TokenSource `_disallowPool`. Lens: spec fidelity.
- Scenario: a pool rotation proposed as two operations, or remove first, leaves SPY active with no pool. Every split then refuses SPY's equity to spend, and any stranger settles every SPY bucket into spend after the grace. A real SleeveTimelock lets the executor run the removal alone.
- Status: CONFIRMED, fixed. TokenSource reverts LastPoolOfActiveTicker on removing an active ticker's last pool and NoPools on a launch ticker with a feed and no pool. A removed ticker may still empty its list. The runbook rotates with one scheduleBatch that adds before it removes.

#### A1-26 LOW: The 48-hour admin delay was never bound on chain

- Where: contracts/src/TokenSource.sol:168 and SessionCalendarExtension.sol:131 (code checks only), the SleeveModule constructor, and SleeveTimelock.sol:48. Lens: access.
- Scenario: the deploy passes a zero-delay TimelockController, two different timelocks, an EIP-7702 delegated EOA, or a SleeveTimelock with an open executor or no proposer. Every check passed, and the immutable module was bound for good to admin writes with no 48-hour public window.
- Status: CONFIRMED, fixed. The module's constructor requires TokenSource and the calendar to answer to the same admin, with more code than an EIP-7702 designator, reporting SleeveTimelock's MIN_DELAY_FLOOR of 172,800 and a delay at or above it. SleeveTimelock's constructor refuses an empty or zero proposer or executor list. The deploy script should still read back both timelock() values, getMinDelay() and the role grants.

#### A1-27 LOW: A ticker's session type is fixed at construction

- Where: contracts/src/TokenSource.sol:247 (`_list` is the only writer). Lens: time.
- Scenario: the overnight venue stops for weeks, or the issuer flips overnight tradability, while the ticker stays ALL_DAY. The feed holds the 20:00 round overnight, a thin overnight pool can be lifted to the held answer plus the cap, and a public settle buys well above the real market, every night until the timelock acts.
- Status: CONFIRMED, waiting on the owner. The verified fix is a one-way, timelocked narrowSessionType from ALL_DAY to REGULAR; the module needs no change because it reads the type on every call. It extends the admin's writes beyond PRD 13 and 14's remove-only wording, so it needs the owner's sign-off. If declined, a DECISIONS entry names removeTicker as the lever and SECURITY.md records the exposure next to A1-02.

#### A1-36 INFO: Expired calendar coverage reads as an ordinary SESSION queue

- Where: contracts/src/libraries/SleeveTrade.sol:382 (`_guard` drops the calendar's reason). Lens: time.
- Scenario: no one appends 2028 in time; from 1830474000, Sunday 2 January 2028 20:00 EST, every split queues SESSION and every settle reverts GuardNotClear(SESSION) on what looks like a weekend.
- Status: ACCEPTED (basis in the Accepted table). The keeper must alert when coverageEnd() is less than 30 days away and map a SESSION queue at or after coverageEnd() to "calendar expired". appendYear(2028) must be scheduled no later than Friday 31 December 2027 20:00 EST.

### Static lens

#### S-01 LOW: previewSplit reported no coverage after growth under 1 USDG while a public split succeeded

- Where: contracts/src/libraries/SleeveTrade.sol:184. Found while triaging slither's incorrect-equality results on previewSplit.
- Scenario: one base unit sent after an observation made previewSplit return publicReadyAt 0 while observe and the public split still covered it, so a caller that waits for a non-zero publicReadyAt never fired the fallback.
- Status: CONFIRMED, fixed with A1-05's `_covers` predicate.

#### S-02 INFO: SleeveModule._recordModuleDelta was dead code kept for the harness

- Where: contracts/src/SleeveModule.sol:358.
- Status: CONFIRMED, fixed: removed. The harness calls SleeveState.recordModuleDelta.

#### S-03 INFO: docs/STATIC_ANALYSIS.md claimed to list every finding but missed most

- Where: docs/STATIC_ANALYSIS.md:3. It missed 44 of 67 slither results and every aderyn result and kept four stale rows.
- Status: CONFIRMED, fixed: both tools reran on the integrated tree, and every result is triaged there. They run again before the deploy.

### Invariant suite

#### I-01 MEDIUM: An owner top-up booked before an outside pull was reconciled refilled pending equity

- Where: contracts/src/SleeveModule.sol:417 (`_bookOwnerOp` credits a positive owner delta without reconciling).
- Scenario: a 200 USDG payment is split while NVDA is paused (spend 100, bucket 100), a third party pulls 150 through an old approval, and the owner tops up 500 in a bracketed op. The next split reconciled the pull spend first out of the top-up and left the bucket the pull had emptied, so the keeper later bought 100 USDG of NVDA with the owner's money. PRD 7.2 books the pull spend first, then the bucket, which leaves bucket 50 and spend 500.
- Evidence: invariant_I6_onlyIncomeIsEverSplit failed at 256 runs and depth 64, and the fuzzer shrank 39 calls to 3. Not reported in the lens round.
- Status: CONFIRMED, fixed. endOwnerOp first reconciles at the virtual balance, with a RECONCILED receipt through SleeveTrade.reconcileLedgers, whenever an owner inflow meets ledgers above that balance. PRD 7.2 says the next split reconciles; this adds an earlier reconcile without changing any invariant, which D-026 records next to D-013.

#### I-02 LOW: settle bought a whole bucket an unreconciled pull had already emptied

- Where: contracts/src/libraries/SleeveTrade.sol:278 (`_settle` never compared the ledgers with the balance).
- Scenario: after the same drain, the owner's batch tops up and settles NVDA, or the keeper settles after the top-up; the settle bought the whole bucket with the top-up. Outside a bracket, with buckets on two tickers, it bought a lower-id bucket in full and let the next reconcile cut a higher one, against D-009 Q4.
- Evidence: invariant_I4_onlyTheVenueWithExactApprovalReset failed, and the fuzzer shrank 42 calls to 4.
- Status: CONFIRMED, fixed. settle reverts LedgersAboveBalance(account, shortfall) while the ledgers exceed the balance it computes from; the keeper splits first, which reconciles. SettlePreview carries the shortfall, with status QUEUED and reason NONE.

#### I-03 MEDIUM: A sell credited its proceeds without reconciling first

- Where: contracts/src/libraries/SleeveSell.sol, `sell` in component 6.
- Scenario: the same refill as I-01 with sale proceeds in place of a top-up: after a drain that reached the buckets, the next reconcile took the drain out of the proceeds, so the proceeds refilled pending equity, which PRD 7.2 ("Sale proceeds ... land in spend and are never split") and I6 forbid.
- Status: DEFERRED_C6, fixed in the integration. sell reconciles an outside pull at the sorting balance, with a RECONCILED receipt, before the swap and before the proceeds land; the deploy links SleeveTrade into SleeveSell for it.

## Invariant suite

Files: contracts/test/invariant/SleeveInvariants.t.sol, SleeveInvariantsReach.t.sol, SleevePullOrder.t.sol, SleeveI10.t.sol and SleeveI11Fork.t.sol, the handlers SleeveWorld.sol, SleeveModel.sol and SleeveHandler.sol, and the mocks InvPool, InvRouter, InvFactory and InvRelay under contracts/test/mocks.

The handler drives the real SleeveModule, TokenSource and SessionCalendarExtension over mocks with 39 weighted actions: payments and splits by every trigger, settles, releases, sells by amount and by lot with and without the off-hours override, lot reconciles, bracketed owner batches with inflows, outflows, owner sales outside Sleeve and module actions, outside pulls and drains followed by a top-up, donations of USDG, stock tokens and ether to the module, rule and keeper edits, uninstall by the executor path, by a direct call and reinstall, faulty and overcharging pools, market, feed, pause, blocklist and multiplier changes, rounds stamped around a session's opening, and the timelock's writes. SleeveModel predicts every call's revert or every event it emits, receipts field by field and every balance it moves, so a call that differs from the model fails the suite even when no named invariant breaks.

Invariants, each checked after every call: I1 as a delta (the module holds exactly what was donated, and no call that reached it changed its balances), I2, I3, I4 (allowances zero after every call, USDG leaves an account only as a buy's input to that buy's pool and never more than the split sorted or the bucket held, tokens leave only as a sell's input to that sell's pool), I6 (only outsiders' payments are ever split; no owner inflow or sale proceeds land while a pull still owes part of a bucket), I7 (receipt ids without gaps, hashes that never change, and every lot with its queue and head exactly what its fill, sells and reconciles left), I8, I10, pendingTotal as the sum of the buckets, ledgers within the balance after a reconcile, and the module equal to the model.

Results:

- On the 6535108 snapshot, before the pull-order checks existed, a 1,024-run, depth-128 campaign with seed 0xbeef, 131,072 calls per invariant, passed all of them. With the pull-order checks, invariant_I6 failed (I-01) and invariant_I4 failed (I-02) at 256 runs and depth 64. A mutation check on the snapshot suite killed all 15 source mutants and 3 double mutants where the module and the model are wrong together.
- On the integrated tree, with sells and lot reconciles in the handler: all 11 invariants pass at 256 runs and depth 64, 16,384 calls each, with 0 handler reverts, seed 0x5, in about 95 seconds.
- SleeveInvariantsReachTest replays 100 seeded sequences of 64 actions with every check after every action and reports what it reached: FILLED 185, QUEUED 423, SETTLED 24, REFUSED_TICKER 18, REFUSED_ACCOUNT 14, RELEASED 67, PART_SOLD 51, SOLD 15 and RECONCILED 61 receipts; every QUEUED reason but NONE; 60 sells through the module, 6 of them reconciling an outside pull first, and 7 lot reconciles that trimmed a lot; 42 LedgersAboveBalance and 7 ModuleStillListed reverts the model predicted; 13 fills while the module held a donation; ModuleHoldsFunds 0.
- SleevePullOrderTest's three fixed sequences fail on the snapshot and pass now. SleeveI10Test's 5 tests and SleeveI11ForkTest's 2 fork tests through EntryPoint v0.7 handleOps pass.

## Residual risks for SECURITY.md

SECURITY.md does not exist yet. These are the residuals round 1 leaves, each with its finding:

- A1-02: an unscheduled closure or halt the timelock cannot list in time leaves the held round looking live for up to about 25 hours; fills stay within the premium cap of that held price, and only an issuer oraclePaused would queue them.
- PRD 9: Chainlink publishes no sequencer uptime feed for chain 4663, so there is no grace-period check after a sequencer outage.
- A1-06 and A1-22: for KEEPER and PUBLIC triggers the caller picks the quote, so the bound is premiumCapBps above the feed, plus feed lag and USDG taken at par; a leaked KEEPER key has the no-grace trigger on every default-keeper account until its owner rotates.
- A1-11: the premium is measured in USDG at par, up to about 0.5 percent more in US dollars while USDG sits inside its band.
- A1-19: a stock token, USDG or feed implementation can still raise PremiumAboveCap from a read.
- A1-03 and A1-25: tokens or USDG moved outside Sleeve are seen only through balances, the WRAPPED limit.
- A1-05: income arriving at least hourly keeps the public split shut while the keeper is down; restarting the clock costs 1 USDG per restart, paid to the owner.
- A1-27, if the owner declines the narrowing: a ticker that loses overnight trading keeps ALL_DAY until removed.

## Follow-ups outside the contracts

The SPEC and DECISIONS parts landed with review round 1 as SPEC draft 3 and D-025 to D-027. The last column says what is left.

| Finding | Where | Change | State |
| --- | --- | --- | --- |
| A1-01 | PRD I1 (owner), SPEC 1, 11, 17, CLAIM_LEDGER 3.7, PROGRESS line 47, DECISIONS | I1 as a delta, once the owner agrees | SPEC and D-026 describe the delta and mark it pending; PRD, CLAIM_LEDGER and PROGRESS wait on the owner |
| A1-04 | SPEC 14 | FILLED, SETTLED or PART_SOLD to PART_SOLD or SOLD; SOLD is final | done |
| A1-05, S-01 | D-009 Q15 and Q16, SPEC 8, DECISIONS | the 1 USDG restart and its bound; settle readiness from since and the opening; the hourly-income limit | done: D-025, SPEC 8 |
| A1-06 | SECURITY.md, app rule summary, CLAIM_LEDGER | the quote residual with the fork numbers | open |
| A1-07 | app uninstall op, docs/GAS.md, SPEC 6 | fixed callGasLimit floor, ModuleUninstallResult check, the outcome map | SPEC 6 done; app and GAS.md open |
| A1-10 | SPEC 4, D-017, packages/core guard port, verifier | observed and transmitted at or after the opening | SPEC 4 and D-026 done; port and verifier open |
| A1-11 | app worst-case line, DECISIONS | the premium is in USDG at par | D-026 done; app open |
| A1-12 | SPEC 11, D-009 Q12 | no router minimum; minOut after the premium cap | done: SPEC 11, D-026 |
| A1-13 | app sell flow, errors list, verifier | split a sell over more than 100 lots; decode TooManyLots; sum each sell's receipts over its own run, never over the transaction | open; SPEC 12 and D-027 describe the bound, SPEC 13 the grouping (review round 2) |
| A1-14 | SPEC 9 and 13, app receipt text, verifier, metrics | key on usdgToEquity == 0 | SPEC done; app, verifier and metrics open |
| A1-16 | SPEC 13, D-019, app mock engine and CSV, verifier vector | the RECONCILED field mapping | SPEC 13 and D-026 done; app and verifier open |
| A1-17 | DECISIONS, SPEC 9 and 10, keeper | once the owner answers | SPEC 9 and 10 describe the revert, marked pending; the rest waits on the owner |
| A1-18 | runbook, proposal script | rotate with one scheduleBatch that adds first | open; D-026 records the rule |
| A1-19, A1-21, A1-23, A1-24, A1-26, A1-31, A1-37, I-02, A1-13 | app errors list (app/src/data/errors.ts) | BatchReverted, AccountLocked, FillNotFromPool, ModuleStillListed, TimelockMismatch, TimelockNotSleeve, QuoteTooLarge, LedgersAboveBalance, TooManyLots | open |
| A1-21 | DECISIONS | per-account transient lock in place of ReentrancyGuardTransient | done: D-026, flagged for the owner |
| A1-23 | keeper, verifier, metric scripts | trigger and count only app-registered Kernel v3.1 accounts | open |
| A1-24 | SPEC 6 | onUninstall reverts ModuleStillListed while listed | done |
| A1-26 | deploy script | read back both timelock() values, getMinDelay() and the role grants | open |
| A1-29 | keeper, inbox | split on a positive shortfall every poll; explain netted income | open |
| A1-30 | keeper policy, D-009 | the 1 USDG or 24-hour rule; exclude sub-1-USDG inflows from C1 | open |
| A1-31 | SPEC 10 | steps 1 and 2 send a bucket to spend at any size | done |
| A1-32 | keeper, app, SPEC 10 | the five-day prompt from the keeper's reason record | SPEC 10 done; keeper and app open |
| A1-03 | app install op and token-moving batches, DECISIONS | add reconcileLots after the move and before any sell; tokensRemaining is an upper bound | D-027 done; app open |
| A1-33 | PROGRESS, CLAIM_LEDGER 1.9 and 3.7 | list the fork tests that rely on mocks; move the claims off PENDING | open |
| A1-36 | keeper, ops checklist | coverage alert 30 days ahead; schedule appendYear(2028) by early December 2027 | open |
| I-01, I-03 | DECISIONS next to D-013 | the earlier reconcile at endOwnerOp and before a sale's proceeds | done: D-026 |

## Sizes and gas

Runtime bytes against the 24,576 limit, solc 0.8.28, optimizer 200 runs: SleeveModule 16,610 (15,777 after component 6), SleeveTrade 19,534 (18,924), SleeveSell 17,799 (16,488), SleeveBuy 6,099 (5,375), TokenSource 3,511 (3,425), SleeveTimelock 6,720 and SessionCalendarExtension 7,414 (both unchanged). The test-only SleeveModuleHarness is 22,312.

docs/GAS.md has the fork figures after the fixes: a SPY fill by the keeper is 543,779 gas, about 10,800 more than after component 6, mostly the pool's balances read for A1-23; a one-lot sell is 456,076, about 13,700 more; a sell across 100 lots is 6,000,591.

## Rerun

From contracts/:

```
FOUNDRY_OUT=out-int FOUNDRY_CACHE_PATH=cache-int forge test --no-match-path "test/spike/*"
FOUNDRY_OUT=out-int FOUNDRY_CACHE_PATH=cache-int forge test --match-path "test/audit/*"
FOUNDRY_OUT=out-int FOUNDRY_CACHE_PATH=cache-int FOUNDRY_INVARIANT_FAILURE_PERSIST_DIR=cache-int/invariant forge test --match-path "test/invariant/*" -vv
FOUNDRY_OUT=out-int FOUNDRY_CACHE_PATH=cache-int forge test --match-path test/fork/SleeveModuleGas.t.sol --isolate -vv
```

Fork tests read FORK_RPC, which defaults to the dRPC archive endpoint https://robinhood.drpc.org (D-008), and pin blocks 78,312,136 and 73,280,794.
