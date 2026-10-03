# Audit round 1

Scope: commit e16bb96, every contract under contracts/src (LedgerMath, SessionCalendar, SessionCalendarExtension, PriceGuard, TokenSource, SleeveTimelock, SleeveReceipts, SleeveState, SleeveTrade, SleeveBuy, SleeveModule). Out of scope: component 6 sell-back, not yet written.

Method: 13 independent audit agents, one per lens (reentrancy, funds, access, oracle, transient storage, tokens, account abstraction, time, arithmetic, DoS, current exploit patterns, spec fidelity, static analysis), each reading the frozen snapshot and writing proof-of-concept tests where useful. The static-analysis lens and the invariant-suite agent did not finish, and the planned dedup and two-verifier pass did not run, because the agent service hit its usage limit on 3 October 2026. The triage below was done by hand by the orchestrator. Round 2 reruns the full pipeline, including verification, over every contract before mainnet.

## Summary

| Severity | Raw findings |
| --- | --- |
| CRITICAL | 0 |
| HIGH | 5 |
| MEDIUM | 7 |
| LOW | 27 |
| INFO | 12 |

Five lenses independently reported the same HIGH (a donated base unit blocking every buy). The seven MEDIUM reports reduce to six issues.

## HIGH and MEDIUM, with triage

### HIGH: One base unit donated to the module permanently blocks every buy (absolute-balance I1 check)

Location: SleeveBuy.sol:115. Lenses: dos, funds, modern, reentrancy, tokens.

Scenario: Attacker calls USDG.transfer(sleeveModule, 1). From then on every executeBuy reverts ModuleHoldsFunds(USDG, 1), so every split whose guard says BUY reverts for every account, and every settle reverts too. Sending 1 wei of SPY does the same for every SPY buy. Confirmed by test/audit/reentrancy_DustAndForgedRevert.t.sol: test_dustDonationBricksEveryBuy and test_tokenDustDonationBricksTickerBuys both pass. A sell-back that copies this check would be blocked the same way.

Impact: The core product stops working for every user, permanently, for 0.000001 USDG. Recovery means deploying a new module and having every account reinstall. Funds are not lost: USDG stays spendable and buckets can still be released. That is why this is HIGH and not CRITICAL, but it is unrecoverable on this deploy. By the rubric's DoS wording it could be argued down to MEDIUM.

Triage: FIXED in commit "measure module balances as a delta": the I1 check compares the module balance before and after the buy. Regression test test_I1_split_donationToModule_doesNotBlockBuys.

### MEDIUM: Unscheduled closure or market-wide halt: the held price passes as live for the whole day

Location: PriceGuard.sol:235. Lenses: oracle.

Scenario: An event like Hurricane Sandy or a short-notice national day of mourning closes NYSE and the 24 Hour Market on a Wednesday, and the timelock misses the addClosure deadline. The NVDA feed stops at Tue 19:59 EDT. The calendar still says Wednesday is open. A payment lands, and the keeper splits, or a public caller after the grace, on a pool trading on news while the feed is frozen. The fill passes at up to premiumCap above the held price, and Thursday reopens 10% lower. PoC: test/audit/oracle_HeldPrice.t.sol shows a round 24h old, from before an unlisted closure, accepted with Reason.NONE.

Impact: The equity share is bought against a held price that the PRD's weekend and holiday guard was meant to exclude. The owner takes the reopen gap, which is the exact risk 'Weekend or holiday gap: equity share queues' was written to remove. Each unscheduled closure or halt exposes up to about 25 hours of payments.

Triage: ACCEPTED, documented: an unscheduled closure the timelock cannot add in time leaves the held round looking live; the premium cap still bounds the fill against that round. Recorded in SECURITY.md as a known gap next to the missing sequencer feed (PRD 9).

### MEDIUM: Lots are never reconciled with the account's stock-token balance, so sell-back will act on phantom lots

Location: SleeveState.sol:164. Lenses: funds, spec, tokens.

Scenario: The owner gets lot 7 with 10 SPY, then moves the 10 SPY out in a bracketed batch. Lot 7 still shows 10 tokensRemaining, and the app, verifier and receipts show holdings that don't exist. Later 4 SPY arrive from outside Sleeve. sell(SPY, 4, 0, ...) sells those 4 non-lot tokens, contradicting Q30, and writes PART_SOLD receipts against lot 7 that attribute proceeds to tokens that left long ago. If the balance is short, the swap reverts with an opaque error.

Impact: Wrong accounting on the trust surface (receipts and lots) that never corrects itself, and a spec deviation from D-009 Q30 and the PRD conservation check. No direct loss, because only the owner can sell.

Triage: OPEN for component 6: sells cap at the smaller of the lots' remaining tokens and the account balance, measure tokensIn by balance delta, and an owner lot reconcile trims lots to the balance with a receipt.

### MEDIUM: The lot transition rule forbids PART_SOLD to PART_SOLD, so a lot can only be partly sold once

Location: SleeveState.sol:181. Lenses: funds.

Scenario: An owner sells 3 of a 10-token lot (FILLED to PART_SOLD), then tries to sell 2 more. Sell-by-amount starts at the head lot, still PART_SOLD with 7 left, and the transition reverts. Verified by contracts/test/audit/funds_LotTransition.t.sol. After the first partial sale the owner can only sell that lot's whole remainder, or sell a specific later lot by id.

Impact: Sell-back, the owner's main way back to USDG through Sleeve, fails for any partial amount smaller than the head lot's remainder. Since tokens outside lots aren't sellable through Sleeve in M0 (D-009 Q30), owners have to over-sell or leave Sleeve to reach their tokens.

Triage: OPEN for component 6: sell-back will allow PART_SOLD to PART_SOLD and SPEC 14 and I7 will list it.

### MEDIUM: Dust transfers keep the public trigger from ever firing for split and settle

Location: SleeveTrade.sol:73. Lenses: access, dos, spec.

Scenario: PoC: contracts/test/audit/spec_PublicGraceGrief.t.sol, tests test_dustEvery50MinutesBlocksPublicSplitIndefinitely and test_dustPlusObserveBlocksPublicSettleIndefinitely, both pass. A payment is observed at t0. A griefer sends 1 base unit of USDG every 50 minutes and calls observe(). Nine hours later the public split still reverts GracePeriodActive(now + 3600). A queued bucket observed the same way stays refused to a public settle.

Impact: The public liveness fallback can be blocked for good for about 1e-6 USDG plus gas per hour. The owner trigger still works, so funds aren't locked, but when the keeper is down the spec'd anyone-can-trigger path is gone. A compromised keeper can do the same to public settles by sending dust and running keeper splits.

Triage: FIXED in commit "dust below 1 USDG no longer restarts the public-trigger clock": restarting needs 1 USDG of growth, which then becomes the owner's income. Regression test test_split_dustCannotPostponeThePublicFallback.

### MEDIUM: Caller-chosen quote makes the slippage cap meaningless for keeper and public triggers, so every buy can be pushed to the premium cap

Location: SleeveTrade.sol:417. Lenses: arithmetic, funds, modern, oracle.

Scenario: After the grace, an attacker contract buys the token in an allowlisted thin pool until the price sits just under answer*(1+cap). It then calls split(account, pool, 1), the account buys at that price, and the attacker sells back into the higher price. A stolen keeper key can do the same on every split right away with no grace, even though PRD 14 says it has 'no authority beyond public functions'.

Impact: The PRD's 'worst case' of about 1.5% at the default cap becomes the expected case for any non-owner trigger, and up to about 5.5 to 6% at the 500 bps maximum cap. Value goes to the trigger, minus pool fees. Loss is bounded by the cap, which PRD 7.4 accepts as the residual bound, but the slippage setting owners see doesn't protect them.

Triage: ACCEPTED per PRD 7.4 and 14: the slippage cap applies to the trigger's own quote, and the premium cap against the Chainlink reference is the bound for keeper and public triggers. The app and SECURITY.md say so, and the keeper wording follows D-014.

## LOW and INFO

Listed as reported, not yet verified. Each is reviewed in round 2.

- LOW (dos), SleeveModule.sol:155: onUninstall release costs about 250k+ gas, and a short callGasLimit silently skips it while Kernel still removes the module
- LOW (tokens), PriceGuard.sol:184: The planned sell-back guard misses the router blocklist, which Stock.approve and transferFrom enforce
- LOW (oracle), PriceGuard.sol:210: No post-change multiplier check: the immediate updateMultiplier form never queues, and a pre-change feed round is accepted right after effectiveAt
- LOW (oracle), PriceGuard.sol:237: Reopen freshness test uses updatedAt (transmit time), not startedAt (observation time)
- LOW (oracle), SleeveBuy.sol:45: Premium cap compares USDG spent with a USD feed price, ignoring the USDG/USD answer it already read
- LOW (spec), SleeveBuy.sol:105: The minimum-out check (PRD step 9) runs before the premium check (step 8), so a fill above the cap reverts where the spec says it queues
- LOW (funds), SleeveState.sol:164: Lots aren't tied to token balances and survive uninstall, so sell-back plumbing can point at tokens that are gone
- LOW (dos), SleeveState.sol:171: Lot queues grow without bound per account and ticker, and a by-amount sell writes one receipt per lot in a single call
- LOW (spec), SleeveTrade.sol:241: A zero equity part writes QUEUED with reason CLIP while nothing is queued
- LOW (funds), SleeveTrade.sol:247: An equity part below the clip strands in its bucket once a later payment fills directly
- LOW (spec), SleeveTrade.sol:335: RECONCILED receipts repurpose usdgSpent and usdgQueued
- LOW (spec), SleeveTrade.sol:382: A trigger's pool off a non-empty allowlist reverts PoolNotAllowed, where SPEC 9 and PRD 7.4 say REFUSED_TICKER, and no DECISIONS entry records it
- LOW (spec), SleeveTrade.sol:383: An empty pool allowlist on an active ticker turns every split and every bucket into spend
- LOW (funds), SleeveTrade.sol:417: The caller-chosen quote makes the owner's slippageBps decorative for keeper and public triggers
- LOW (reentrancy), SleeveTrade.sol:434: Code inside the account batch can forge PremiumAboveCap and make split write a fake PREMIUM queue receipt
- LOW (tokens), SleeveTrade.sol:438: USDG pause or freeze reverts split and settle wholesale instead of queueing or refusing with a named reason
- LOW (funds), SleeveTrade.sol:509: Dust transfers plus observe() can push the public-trigger fallback back forever
- LOW (transient), SleeveModule.sol:35: The module-wide transient reentrancy lock lets any self-installed contract make other accounts' Sleeve calls fail while it holds control
- LOW (access), SleeveModule.sol:141: defaultKeeper is immutable and shared by every account, so a leaked KEEPER key cannot be rotated centrally
- LOW (aa), SleeveModule.sol:141: Any contract can self-register, get the default keeper, and write authentic-looking FILLED receipts and lots with fabricated fills into the global log
- LOW (aa), SleeveModule.sol:155: onUninstall wipes the module's state even when Kernel still lists the executor (uninstallModule with type 4/5/6, or a direct call)
- LOW (transient), SleeveModule.sol:428: Observation clock survives an owner outflow, so a later payment is publicly splittable with no grace
- LOW (access), TokenSource.sol:168: The 48-hour admin delay is never bound on chain: TokenSource, the calendar and the module accept any contract as timelock
- LOW (time), TokenSource.sol:247: Session type is fixed at construction, so a ticker that loses overnight trading cannot be moved to REGULAR
- LOW (arithmetic), PriceGuard.sol:299: Premium cap treats USDG as exactly 1 USD, so the USD premium can pass the cap by up to the depeg tolerance
- LOW (access), SleeveBuy.sol:68: A contract posing as an account can write genuine module receipts that record fills at any price
- LOW (modern), SleeveTrade.sol:417: The trigger's quote makes the owner's slippage cap void for keeper and public triggers. An atomic sandwich fills at the premium cap every time
- INFO (spec), SleeveState.sol:164: Lots for component 6 are keyed to this module instance and never follow tokens that leave outside Sleeve
- INFO (funds), SleeveTrade.sol:95: Income arriving before an outside pull is reconciled is netted against the shortfall and isn't split in full
- INFO (dos), SleeveTrade.sol:97: Any unsorted amount, down to 1 base unit, makes the keeper pay for a full split and receipt
- INFO (spec), SleeveTrade.sol:273: A removed ticker's bucket below the current clip can't be refused to spend by settle
- INFO (spec), SleeveTrade.sol:355: bucket.reason is the latest queue reason and settle never updates it, so the five-day same-reason prompt can't be driven from chain state
- INFO (spec), SleeveModuleInvariants.t.sol:15: The commit snapshot has no stateful invariant suite for I1, I4 and I8
- INFO (aa), SleeveModule.sol:159: Measured silent-skip window for the uninstall release: callGasLimit from about 120k to about 320k removes the module and skips onUninstall
- INFO (transient), SleeveState.sol:108: Sell-back must feed the bracket's module delta or sale proceeds are booked to spend twice
- INFO (access), SleeveState.sol:176: Lot plumbing has no ownership check: component 6 must enforce lot.account and the ticker
- INFO (arithmetic), SleeveTrade.sol:242: A split whose equity part rounds to zero writes QUEUED/CLIP although nothing is queued
- INFO (time), SleeveTrade.sol:377: Expired calendar coverage reads as an ordinary SESSION queue: the OUT_OF_RANGE reason is dropped and nothing warns before the 2028 cliff
- INFO (arithmetic), SleeveTrade.sol:417: A trigger-supplied quote can make the minOut mulDiv panic instead of reverting with a named error
