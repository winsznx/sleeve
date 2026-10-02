# PRD questions for M0

Research note for the run's stop condition "the PRD is silent or ambiguous on something that must be decided" (build contract internal/CLAUDE.md line 11, and rule 2 on line 12). It lists every gap, ambiguity and conflict found in a full read of internal/Sleeve-PRD-v1.4.md (lines 1 to 716) and internal/CLAUDE.md (lines 1 to 122) that has to be settled to ship M0, checked against docs/DECISIONS.md (D-001 to D-008), docs/FUNDING.md, docs/PROGRESS.md, docs/GATES.md, docs/SPEC.md (draft 1) and the other notes in docs/research.

Written Friday 2 October 2026 between 15:01 and 16:10 UTC. Chain reads use the public RPC https://rpc.mainnet.chain.robinhood.com unless marked dRPC (https://robinhood.drpc.org). Commands and results are in the appendix and cited as E1, E2 and so on. PRD references are section and line number in internal/Sleeve-PRD-v1.4.md. "Build contract" means internal/CLAUDE.md.

How to read the items:

- Kind OWNER is a product, money, risk or claim choice the owner must confirm. Kind IMPLEMENTATION is an engineering detail that can be decided and logged in docs/DECISIONS.md. Every item has a recommended default. OWNER items stay open until the owner answers.
- "Blocks" uses the build contract's component numbers: 0 G6, 1 LedgerMath, 2 SessionCalendar, 3 PriceGuard, 4 module state and brackets, 5 split, settle, release and receipts, 6 sell-back, 7 keeper, 8 verifier, 9 app core, 10 HP2 replay, 11 HP1 campaign and submission docs. "Deploy" is the mainnet deploy.
- docs/SPEC.md draft 1 already parametrizes five OPEN items (Q-depeg, Q-multiplier, Q-clip-merge, Q-settle-rule, Q-sell-wait) and picks drafts for others. Each item says which SPEC section it touches and where this note's recommendation differs from the draft.

Owner message relayed for this run: "the vs to use is the greencloud, thats wgere flowguard is". Read here as: the keeper's VPS is the GreenCloud server that already runs FlowGuard. docs/PROGRESS.md line 20 records "VPS answered: GreenCloud 172.93.185.150." Q34 covers what sharing that server means for the keeper key.

## 1. The timing fact behind Q1

| Instant | UTC | Lagos |
| --- | --- | --- |
| Last US 24/5 session before the deadline closes, Friday 2 October 20:00 New York time | 2026-10-03T00:00:00Z | Saturday 01:00 |
| V0 checkpoint (PROGRESS line 7) | 2026-10-03T16:00:00Z | Saturday 17:00 |
| Deadline, 23:59 SGT on 4 October (PRD 23 line 599) | 2026-10-04T15:59:00Z | Sunday 16:59 |
| Next session opens, Sunday 4 October 20:00 New York time | 2026-10-05T00:00:00Z | Monday 01:00 |

The market reopens 8 hours and 1 minute after the deadline (E20). Every guarded buy needs the session open (PRD 7.4 step 4, line 191), and the stock feeds never post a round between Friday 20:00 and Sunday 20:00 New York time (E3, 14 weekends). So no FILLED or SETTLED receipt can be written on mainnet between the Friday close and the deadline. Chainlink's own schedule for these feeds is weekly open 20:00 Sunday, weekly close 20:00 Friday, no daily break (E18).

## 2. Summary

| ID | Kind | Topic | Blocks | Needed by |
| --- | --- | --- | --- | --- |
| Q1 | OWNER | Mainnet evidence window before the deadline | deploy, 11 | now, before 21:00 UTC today |
| Q2 | OWNER | Campaign account rules against the 25 USDG minimum clip | 9, 11 | before the first campaign payment |
| Q3 | IMPLEMENTATION | Multi-leg rounding and the one-unit dust bound | 1 | now |
| Q4 | IMPLEMENTATION | Order of reductions across pending buckets | 1, 4 | now |
| Q5 | OWNER | Which issuer field gives the per-ticker session type | 2, 5 | now |
| Q6 | OWNER | Feed freshness at a reopen | 2, 3 | before component 3 |
| Q7 | IMPLEMENTATION | Calendar edge rules: early closes, boundaries, coverage end | 2 | now |
| Q8 | OWNER | Calendar extension path and short-notice closures | 2, deploy | before the extension contract |
| Q9 | OWNER | USDG depeg tolerance and the USDG/USD feed's age | 3 | before component 3 |
| Q10 | OWNER | Pending-multiplier guard window | 3 | before component 3 |
| Q11 | IMPLEMENTATION | Premium arithmetic, units and rounding | 3, 5, 8 | before component 3 |
| Q12 | IMPLEMENTATION | Check order, clip position, swap then check, partial fills | 3, 5 | before component 3 |
| Q13 | IMPLEMENTATION | Module actions inside an owner bracket | 4 | before component 4 |
| Q14 | OWNER | The keeper's identity onchain and its rotation | 4, 7 | before component 4 |
| Q15 | IMPLEMENTATION | When a public split's grace period starts | 4, 5 | before component 4 |
| Q16 | IMPLEMENTATION | When a public settle's grace period starts | 2, 5 | calendar API now, logic before 5 |
| Q17 | OWNER | Income and settles while the rule is paused | 4, 5, 9 | before component 4 |
| Q18 | OWNER | Which guard settings the owner edits, and their bounds | 4, 9 | before component 4 |
| Q19 | OWNER | Owner top-up path | 4, 9, 11 | before component 4 |
| Q20 | IMPLEMENTATION | Uninstall and reinstall | 4 | before component 4 |
| Q21 | IMPLEMENTATION | The trigger's quote and the slippage cap | 5, 7 | before component 5 |
| Q22 | IMPLEMENTATION | Minimum clip and existing buckets | 5, 7 | before component 5 |
| Q23 | IMPLEMENTATION | Lots and queued equity | 5 | before component 5 |
| Q24 | IMPLEMENTATION | Queued equity after a rule edit | 5, 9 | before component 5 |
| Q25 | IMPLEMENTATION | Receipt storage and ids | 5, 8 | before component 5 |
| Q26 | IMPLEMENTATION | Receipt fields the PRD leaves out or leaves vague | 5, 8 | before component 5 |
| Q27 | OWNER | Which issuer text is the disclosure | 5, deploy | before the deploy |
| Q28 | OWNER | What "a sell waits" means onchain | 6, 9 | before component 6 |
| Q29 | OWNER | What the sell override skips | 6, 9 | before component 6 |
| Q30 | IMPLEMENTATION | Selling an amount across lots | 6 | before component 6 |
| Q31 | OWNER | TokenSource admin powers and the initial configuration | 5, deploy | before component 5 |
| Q32 | IMPLEMENTATION | Single hop in M0 | 5 | before component 5 |
| Q33 | IMPLEMENTATION | Timelock and deploy configuration | deploy | before the deploy |
| Q34 | OWNER | The keeper on the shared GreenCloud VPS, and its key | 7, deploy | before KEEPER is funded |
| Q35 | IMPLEMENTATION | Keeper policies the PRD leaves open | 7 | before component 7 |
| Q36 | IMPLEMENTATION | What the verifier recomputes without historical state | 8 | before component 8 |
| Q37 | OWNER | Production domain and the passkey server | 9, 11 | before the first real passkey |
| Q38 | OWNER | A recovery signer in M0 | 9 | before component 9 |
| Q39 | OWNER | Gas sponsorship for owner UserOps | 9, 11 | before component 9 |
| Q40 | OWNER | The eligibility gate with passkey-only login | 9 | before component 9 |
| Q41 | IMPLEMENTATION | Cards | 9 | before component 9 |
| Q42 | IMPLEMENTATION | Account creation and the install snapshot | 9 | before component 9 |
| Q43 | OWNER | Exit copy and the issuer's redemption terms | 9, 11 | before app copy |
| Q44 | OWNER | HP2 definitions fixed before any result is seen | 10 | before the replay runs |
| Q45 | IMPLEMENTATION | HP2 mechanics | 10 | before component 10 |
| Q46 | OWNER | HP1 definitions | 11 | before the campaign |
| Q47 | OWNER | Claim wording the build would make untrue | 9, 11 | before README and app copy |
| Q48 | IMPLEMENTATION | ERC-7579 base and module size | 4 | before component 4 |

Twenty-four items are IMPLEMENTATION and can be logged in DECISIONS.md as soon as the component owner agrees. The other twenty-four need the owner. The OWNER items most urgent for the components running now are Q1, Q5 and Q6.

## 3. Questions

Items are grouped by component, so Q16 follows Q15 and Q48 closes the component 4 group.

### 3.1 Schedule and evidence

#### Q1. Mainnet evidence window before the deadline

- Kind: OWNER.
- PRD: 5 C1 line 118 ("Live target: median under two minutes while the market reference is live"); 12 line 373 (measured gas per split from mainnet receipts in the README); 16 line 480 ("Demos show only paths that have run on mainnet"); 17 lines 488 and 492 (HP1, and a control list that starts with "an in-session fill"); 19 line 510; 23 line 599. Build contract line 65. D-001 ("the in-session question"). FUNDING.md lines 21 and 32.
- Question: the only US session left before the deadline ends at 2026-10-03T00:00:00Z, about 8 hours after this note. The next one opens 8 hours after the deadline (section 1). Which mainnet evidence does M0 aim for, and what does the submission say about fills?
- Options:
  - A. Deploy a minimal stack before 00:00 UTC Saturday and run one in-session split that fills, the in-session test FUNDING.md line 32 budgets 10 USDG for. Gives a real FILLED receipt and a measured gas figure. Compresses components 3 to 5 and the deploy into about 8 hours and puts code that has not met acceptance on a real-money path.
  - B. Deploy over the weekend. Mainnet evidence before the deadline is QUEUED(SESSION) receipts, releases, refusals, a sell that waits, and verifier runs. FILLED and SETTLED appear only in forked tests, labeled as fork. C1's live target and the README gas figure are reported as not yet measured. The first settles happen at 2026-10-05T00:00:00Z.
  - C. B, plus a live receipts page linked from the README that shows the Monday settles once they land, with the submission saying when they are expected.
- Recommendation: B with C's live page, unless components 3 to 5 meet acceptance by about 21:00 UTC today, in which case ask the owner the in-session question for A. B keeps every demo claim true without rushing the module, and the weekend queue is itself journey 8.2 (line 274) and HP1's off-hours payment.
- Blocks: the deploy and component 11. Needed now.

#### Q2. Campaign account rules against the 25 USDG minimum clip

- Kind: OWNER.
- PRD: 7.3 line 179 (onboarding suggests 10 percent to SPY) and line 181 (minimum clip default 25 USDG, "tuned from measured gas"); 0 change 25, line 47; 3 line 95 and 12 line 372 (Sleeve pays keeper gas). FUNDING.md lines 30 to 36 (10 USDG payments). SPEC section 5 (minClip at least 1 USDG).
- Question: with the suggested 10 percent rule, a 10 USDG campaign payment has a 1 USDG equity part. In session that queues with reason CLIP, and the bucket needs 250 USDG of payments to reach 25 USDG, more than the 60 USDG budget. What rule do campaign and demo accounts use, and does 25 USDG stay the product default?
- Facts: a SwapRouter02 single-hop swap on the NVDA fee-500 pool used 160,300 and 166,134 gas (E13). FUNDING.md assumes about 700,000 gas for a whole split. At 31,818,000 wei and ETH at 2,703.24 USD (E12), 700,000 gas is about 0.0000223 ETH, about 6 US cents, and about 19 cents at the keeper's 0.1 gwei ceiling. At a 25 USDG clip that is about 0.24 percent of the clip today and 0.76 percent at the ceiling. At a 1 USDG clip it is about 6 percent, paid by Sleeve, not the earner.
- Options:
  - A. Keep 25 USDG as the product default. Campaign accounts use a 1 USDG clip and a 50 percent equity share, disclosed in EVAL_CAMPAIGN.md. Their buckets buy at the first open after a payment; the rule version on each receipt shows the setting.
  - B. Lower the product default to 5 USDG. More small lots for every user, gas up to about 4 percent of a clip at the ceiling, paid by Sleeve.
  - C. Use 10 percent and 25 USDG for campaign accounts too. No campaign payment ever buys, so HP1 shows only QUEUED receipts.
- Recommendation: A. The default stays tied to measured gas as 7.3 asks, and the 60 USDG budget still produces buys.
- Blocks: components 9 and 11. Before the first campaign payment.

### 3.2 LedgerMath (component 1)

#### Q3. Multi-leg rounding and the one-unit dust bound

- Kind: IMPLEMENTATION.
- PRD: 5 C4 line 124 ("Dust is at most one base unit and goes to spend"); 11 I2 line 356 and I9 line 363; build contract line 112.
- Question: LedgerMath carries weights so I9 can be fuzzed, but flooring each of k legs on its own can leave up to k extra base units beyond the first floor. Where does the leg remainder go?
- Options:
  - A. Equity = floor(amount * equityBps / 10,000). Legs 1 to k-1 are floored, the last leg takes equity minus their sum, spend = amount - equity. Dust to spend stays below one unit for any k.
  - B. Floor every leg and send the whole remainder to spend. Breaks the one-unit bound once k is 2 or more.
  - C. One leg only in LedgerMath for M0. Leaves the weight half of I9 with nothing to test.
- Recommendation: A. Satisfies C4 and I2 for any basket, costs nothing for M0's single leg, and lets M1 baskets reuse the library.
- Blocks: component 1, running now.

#### Q4. Order of reductions across pending buckets

- Kind: IMPLEMENTATION.
- PRD: 7.2 lines 168 and 169; 9 line 296; build contract line 112. SPEC section 6 ("pending in ascending ticker id").
- Question: an outflow or a reconcile takes from spend, then unsorted, then pending. M0 rules have one ticker, but a rule edit can leave buckets on several tickers. In what order do buckets shrink, and where is the split recorded?
- Options:
  - A. Ascending ticker id, as SPEC draft 1 says.
  - B. Buckets for tickers outside the current rule first, then the current ticker. Protects money queued for the owner's current choice.
  - C. Pro rata across buckets. Needs its own dust rule.
- Recommendation: A for M0. LedgerMath returns only the total taken from pending and the module spreads it over buckets, so the library API does not depend on the order. The RECONCILED receipt and the OwnerOutflow event list the amount per bucket so the verifier can recompute it.
- Blocks: component 1 (API shape, now) and component 4.

### 3.3 SessionCalendar (component 2)

docs/research/session-calendar.md already works through the calendar rules (R1 to R9) and its open questions (Q1 to Q9 in that note). The four items below are the ones that need a decision. Everything else in that note can be taken as written.

#### Q5. Which issuer field gives the per-ticker session type

- Kind: OWNER, a confirmation.
- PRD: 7.4 line 202 ("per-ticker session types taken from the issuer's allDayTradability field"); 24.8 line 668 (the two docs pages disagree on the schema). SPEC section 2. session-calendar.md Q1.
- Facts: the live assets API has no allDayTradability field on any of its 194 assets. SPY, QQQ, NVDA and AAPL each return market, extended and overnight as TRADING_STATUS_TRADABLE (E14). The Stock Token APIs page defines allDayTradability as "RH all-day / overnight (24/5) trading flag for the underlier." Chainlink lists all four feeds with marketHours us_equities_24/5 (E2).
- Options:
  - A. Map tradingCapabilities.overnight.whole equal to TRADING_STATUS_TRADABLE to ALL_DAY at runtime in offchain code, and anything else to REGULAR or NONE.
  - B. Set ALL_DAY for the four launch tickers in the TokenSource constructor, citing E14 and E2. The keeper and the release script read A's mapping and alert if it changes.
- Recommendation: B. Same answer as A for M0 without an onchain value that depends on an offchain field name. The owner confirms because it replaces a field the PRD names.
- Blocks: components 2 and 5. Now.

#### Q6. Feed freshness at a reopen

- Kind: OWNER.
- PRD: 7.4 lines 186 to 196 (check order) and line 202; 0 change 18, line 35; 21 line 537. session-calendar.md Q4.
- Question: at each reopen the feed still holds its last pre-close round until the first new round lands. The 25-hour age limit refuses that round after a weekend, but not after a 24-hour midweek closure (1 January 2026, 26 November 2026 and 25 November 2027 in range). Add a rule that the round's updatedAt must be at or after the current session's opening instant?
- Facts: over 14 closures the first round came at 20:00:18 to 20:01:09 New York time, and that first round moved the price by up to 176.6 bps (QQQ, reopen of Sunday 26 July) and 118.5 bps (NVDA, same night) (E3).
- Options:
  - A. Add the check. The calendar exposes the opening instant of the current open interval, and PriceGuard requires updatedAt at or after it. Costs about a minute of queueing per reopen.
  - B. No extra check. A held round from less than an hour before a midweek close passes the age limit at the reopen, bounded only by the premium cap.
- Recommendation: A. It closes the gap the calendar was added for, and Q16 needs the same calendar function. It adds a step to 7.4's list, which is why the owner decides.
- Blocks: component 2 (API) and component 3. Before component 3 starts.

#### Q7. Calendar edge rules: early closes, boundaries, coverage end

- Kind: IMPLEMENTATION.
- PRD: 7.4 line 202; 13 line 385; build contract line 113. session-calendar.md R5, R8, Q3 and Q8.
- Question: the PRD names the 24/5 schedule and the NYSE holiday list but not early closes, interval boundaries, or what happens outside 2026 and 2027.
- Options:
  - A. As session-calendar.md recommends: on the three early-close days (27 November 2026, 24 December 2026, 26 November 2027) the 24/5 session ends at 17:00 New York time; intervals are half open; a timestamp outside coverage reverts with a named error and the module turns the exposed coverage end into a QUEUED reason.
  - B. End the 24/5 session at 13:00 on early-close days. Up to four more hours of queueing, no window of held prices.
- Recommendation: A, and check the feed rounds on 27 November 2026 between 13:00 and 20:00 New York time, correcting before 24 December if they disagree.
- Blocks: component 2, running now.

#### Q8. Calendar extension path and short-notice closures

- Kind: OWNER.
- PRD: 7.4 line 202 ("only the timelock can extend them"); 13 line 385 ("timelocked holiday list"); 14 line 431. D-004. SPEC section 1 (SessionCalendarExtension "appends later years"). session-calendar.md Q5 and Q6.
- Question: what may the timelocked path change, and what happens when the NYSE closes at less than 48 hours' notice, as it did on 9 January 2025?
- Options:
  - A. The timelocked path can append years, add full-day closures and early closes inside the covered range, and replace daylight-saving entries that are still in the future. Nothing is faster than the timelock. A short-notice closure is guarded only by PriceGuard's age, oraclePaused and premium checks, stated in DECISIONS.md.
  - B. A, plus an immediate admin call that can only add a closure. Stricter sooner, but a stolen admin key could close the calendar and stop every buy until a timelocked fix (money stays in accounts as USDG).
  - C. Append-only years, as SPEC draft 1 says. A daylight-saving law change or a short-notice closure cannot be fixed inside 2026 and 2027.
- Recommendation: A. Keeps "only the timelock can extend them" literally true and covers what B would, minus speed. Every change bumps a calendar version that receipts record (Q26).
- Blocks: component 2's extension contract and the deploy.

### 3.4 PriceGuard (component 3)

#### Q9. USDG depeg tolerance and the USDG/USD feed's age

- Kind: OWNER.
- PRD: 7.4 step 7, line 194; 7.4 line 200 (worst case "about 1.5 percent"); 13 line 384. SPEC section 3 (OPEN, Q-depeg).
- Question: 7.4 names a tolerance with no value and gives the USDG/USD feed no age limit.
- Facts: the USDG/USD feed has a 0.5 percent deviation threshold and an 86,400-second heartbeat (E2). All 118 gaps between its 119 rounds were 24.00 to 24.02 hours, so every update since 5 June 2026 was a heartbeat, and answers stayed between 0.99963000 and 1.00041420, at most 4.14 bps from 1 (E3).
- Options:
  - A. 50 bps either way, plus a 25-hour age limit on the USDG/USD round. A stale or out-of-band round queues with reason DEPEG. Equal to the feed's own trigger and more than 12 times the largest move seen.
  - B. 100 bps with the same age limit. Fewer false queues in a stress week. The worst case in USD terms grows to about 2.5 percent.
  - C. 25 bps. Below the feed's 0.5 percent trigger, so between heartbeats the feed cannot report a move this small and the check fires mostly at heartbeats.
- Recommendation: A. Keep the premium math in USDG, treating 1 USDG as 1 USD as 7.4 step 8 reads, and make the app's worst-case line say it is in USDG terms.
- Blocks: component 3. Before it starts.

#### Q10. Pending-multiplier guard window

- Kind: OWNER.
- PRD: 7.4 step 5, line 192; 14 line 432; 21 line 537. SPEC section 3 and section 8 step 5.5 (OPEN, Q-multiplier; the draft also queues while a change has taken effect after the feed's updatedAt).
- Question: 7.4 names a guard window with no length.
- Facts (E6, E7): each launch token has had exactly one multiplier change since launch, each scheduled onchain 580 to 588 seconds before it took effect: AAPL Friday 14 August 11:12:46, NVDA Wednesday 9 September 20:00:30, SPY Thursday 17 September 20:10:33 and QQQ Monday 21 September 20:10:34, New York time, for changes of 5.66 to 17.18 bps. No OraclePaused, OracleUnpaused, Paused or Unpaused event exists on any of the four tokens. The first feed round after each change came 11.8 to 56.8 hours later. The issuer's docs say newUIMultiplier() tracks the current multiplier "Before any update is scheduled" (E19).
- Options:
  - A. Queue while a change is scheduled within the next 24 hours, that is block.timestamp < effectiveAt() <= block.timestamp + 24 hours. With the observed 10-minute notice this queues for about 10 minutes per change.
  - B. A, plus SPEC draft 1's clause: queue after the change until a round with updatedAt at or after effectiveAt() exists. On the four changes seen, buys would have queued for 11.8 to 56.8 hours each.
  - C. B with the after-clause capped at 1 hour.
- Recommendation: A. The feed quotes the token, which already includes the multiplier, so the price is continuous across a dividend or a split by design and the useful protection is around the switch itself. B's clause costs up to two days of queueing per dividend for a few bps of exposure. If the owner wants an after-clause, take C.
- Blocks: component 3. Before it starts.

#### Q11. Premium arithmetic, units and rounding

- Kind: IMPLEMENTATION.
- PRD: 7.4 step 8, line 195; 7.11 lines 249 to 253; 10 line 335 (execution price in USDG per token, premium in signed basis points); 16 line 475. SPEC section 10.
- Question: the PRD fixes neither the scale of the stored execution price nor the rounding, and the verifier must match the module to the unit.
- Options:
  - A. SPEC draft 1's display units (USDG base units per 1e18 token units, premium rounded against the buyer), with pass or fail decided on the exact integer inequality and decimals read at runtime: usdgSpent * 10^tokenDecimals * 10^feedDecimals * 10,000 <= tokensOut * answer * 10^usdgDecimals * (10,000 + capBps), and the mirror with (10,000 - capBps) for sells. Rounded figures go on the receipt for display only.
  - B. Compare the rounded signed bps to the cap. A fill one bp over the cap can pass at the boundary.
- Recommendation: A, with one shared test-vector file that the module tests, the verifier and the replay all read.
- Blocks: components 3, 5 and 8.

#### Q12. Check order, clip position, swap then check, partial fills

- Kind: IMPLEMENTATION.
- PRD: 7.4 lines 186 to 198; 9 lines 299 to 306 and line 326. SPEC sections 8 and 10.
- Question: 7.4's nine checks contain no clip check, while section 9 places the clip after the premium check. The premium check needs a real fill, yet failing it must queue, not revert. And a v3 exact-input swap can fill only part of the amount.
- Options:
  - A. SPEC draft 1: steps 1 to 7, then the clip, then the buy in an external self-call that reverts with PremiumAboveCap after measuring, so the caller catches that one selector and queues. Every other revert, including the minimum out and a partial fill (USDG spent below amountIn), bubbles up and nothing moves. docs/research/pools.md shows a fee-100 pool that fills part of any size.
  - B. Pre-check the premium from a QuoterV2 quote and revert on a measured breach. Reverts where 7.4 line 198 says queue.
- Recommendation: A, with the clip placed before any swap so a small part never costs a swap.
- Blocks: components 3 and 5.

### 3.5 Module state, brackets and rules (component 4)

#### Q13. Module actions inside an owner bracket

- Kind: IMPLEMENTATION.
- PRD: 7.2 line 165; I6 line 360; I14 line 368. SPEC sections 6 and 8. zerodev-passkey.md 9.1.
- Question: I14 puts every owner UserOp inside beginOwnerOp and endOwnerOp, including an owner-triggered split, a sell and an uninstall. The PRD does not say how endOwnerOp treats USDG the module itself moved inside the batch, or what a split sees mid-batch.
- Facts: SPEC section 6 keeps a transient module delta so endOwnerOp books only the owner's residual. SPEC section 8 step 2 reads the real balance, so a batch [begin, transfer 100 out, split, end] would reconcile 100 in the split and then take 100 again in endOwnerOp.
- Options:
  - A. Keep SPEC section 6, and inside an open bracket make split and settle compute unsorted from the virtual balance balanceAtBegin + moduleDelta, leaving the owner's own moves to endOwnerOp. endOwnerOp clears its slots and returns without touching ledgers when the account is no longer installed (the uninstall batch).
  - B. Split and settle revert with a named error while a bracket holds an unbooked owner delta, and the app never builds such a batch.
- Recommendation: A, with fork tests for an owner split inside a bracket, a sell inside a bracket, a transfer out followed by a split in one batch, and an uninstall inside a bracket.
- Blocks: component 4.

#### Q14. The keeper's identity onchain and its rotation

- Kind: OWNER.
- PRD: 7.2 line 171 ("The keeper has no power beyond what anyone has after the grace period"); 10 line 335 (trigger type KEEPER); 14 lines 430, 443 and 454. Build contract line 38. D-004. SPEC section 7 (keeper immutable in M0, rotation means a new module version).
- Question: the keeper may trigger before the grace period, so the module must know who it is. Is it fixed at deploy, set by the admin, or chosen per account, and who can rotate it?
- Facts: the keeper will run on a server that also runs FlowGuard (owner message). A stolen keeper key can trigger before the grace period, which means picking the moment of a buy inside the owner's cap, and can spend its own ETH. It cannot move funds anywhere a public trigger cannot.
- Options:
  - A. One keeper address immutable in the module (SPEC draft 1). Rotation is a new module version and a reinstall for every account, and new accounts then get new addresses (zerodev-passkey.md 11.4).
  - B. The admin sets the keeper through the 48-hour timelock. Adds an admin power that D-004 and PRD 14 line 444 do not list.
  - C. Chosen per account at install, with the app passing Sleeve's keeper, and changeable by an owner op. Rotation is one bracketed UserOp per account and the admin gets nothing new.
- Recommendation: C. It keeps I10 and D-004 as written and lets each owner revoke a leaked key, for one storage field and one setter. A is acceptable for M0 if the owner wants the smallest surface, since accounts are few. Either way, 14 line 443 and D-004 should say what the key can do (Q47).
- Blocks: components 4 and 7. Before component 4.

#### Q15. When a public split's grace period starts

- Kind: IMPLEMENTATION.
- PRD: 7.2 line 171; 9 line 319 (WAITING_GRACE is an offchain state); 14 line 430. SPEC section 7.
- Question: a plain ERC-20 transfer does not call the account, so the module cannot see when unsorted USDG arrived.
- Facts: SPEC draft 1's observe(account) stamps observedAt once and keeps it until a successful split. Anyone can then pre-age the clock: send 1 base unit of USDG, observe, wait 60 minutes, and race the keeper on the next real payment, which 14 line 430 says only the keeper or owner should get to time.
- Options:
  - A. SPEC draft 1 as written.
  - B. observe stores the unsorted amount with the timestamp and restarts the clock whenever unsorted exceeds the stored amount. A public split needs the grace elapsed and unsorted no larger than the stored amount. Any keeper or owner split clears the observation.
  - C. Measure from the last sort. On an idle account a public caller could trigger a new payment at once.
- Recommendation: B. Same size as A, and the clock always starts when the money being sorted was first seen. Grace stays an immutable 3,600 seconds.
- Blocks: components 4 and 5.

#### Q16. When a public settle's grace period starts

- Kind: IMPLEMENTATION.
- PRD: 7.4 line 204 ("Anyone can call it after the grace period"); 14 line 430. SPEC section 7 (the same observation serves split and settle).
- Question: no start instant is given. Weekend buckets are hours old by the Sunday reopen, so a clock that starts at queue time lets anyone settle at the reopen instant, when the first round can move the price by 100 bps or more (E3).
- Options:
  - A. From max(bucket since, current session's opening instant, observation) plus the grace, so the keeper always has the first hour of a session.
  - B. From the bucket's since only.
  - C. From the observation only (SPEC draft 1).
- Recommendation: A, using the calendar function Q6 needs.
- Blocks: component 2 (API, now) and component 5.

#### Q17. Income and settles while the rule is paused

- Kind: OWNER.
- PRD: 5 C1 line 118 (split applies to accounts "with an ACTIVE rule"); 7.2 line 173; 7.3 lines 178 and 182; 9 line 313. SPEC section 8 step 1 (RuleNotActive).
- Question: what happens to new USDG and to queued buckets while the rule is PAUSED, or before any rule is set (SPEC status NONE), and at resume?
- Options:
  - A. Split reverts while paused (SPEC draft 1). New USDG waits unsorted and spendable. Settles stop too. At resume the waiting USDG is split by the resumed rule, and the app shows the amount and warns before resuming.
  - B. While paused, a split sorts everything to spend with a receipt. Needs a receipt status that 7.6 does not list.
  - C. A, plus an owner-only call that credits waiting unsorted USDG to spend at resume. Also needs a status, or RELEASED with a flag.
- Recommendation: A. It is the literal reading of C1 and 7.3, needs no new status, and the warning covers the surprise. Settles stop because pause takes effect at once (line 182).
- Blocks: components 4, 5 and 9.

#### Q18. Which guard settings the owner edits, and their bounds

- Kind: OWNER.
- PRD: 6 line 143; 7.3 line 181 (its "Guards per rule" list includes the session and the 25-hour feed age); 21 line 537; I8 line 362. SPEC section 5 (premium cap at most 1,000 bps, slippage at most 500 bps, minClip at least 1 USDG) and section 3 (feed age, grace, depeg and multiplier window are immutables).
- Options:
  - A. SPEC draft 1 as written.
  - B. A with the premium cap ceiling at 500 bps, the issuer's own threshold for disclosing a sustained deviation (PRD 4 line 104).
  - C. Everything editable with no bounds. A cap typed as 10,000 bps would make "never pays more than the owner's cap" (16 line 473) empty.
- Recommendation: A or B. B if the owner wants the ceiling tied to a public fact.
- Blocks: components 4 and 9.

#### Q19. Owner top-up path

- Kind: OWNER.
- PRD: 7.2 line 172 ("the owner registers their other wallets, and the app's top-up path from a registered wallet credits spend directly"); 15 line 460; 17 line 492 (control: "an owner top-up that does not split"). Build contract line 40 (the app scope does not list top-up). SPEC section 12 (a registered wallet calls topUp).
- Facts: USDG supports EIP-2612 permit and EIP-3009 transferWithAuthorization (E15).
- Options:
  - A. SPEC draft 1: wallets registered by owner op; a registered wallet approves the module and calls topUp(account, amount). New module surface, and the external wallet needs ETH on chain 4663 for two transactions.
  - B. Bracketed pull: the external wallet signs a USDG permit to the account, gasless, and the owner's UserOp runs beginOwnerOp, USDG.permit, USDG.transferFrom(wallet, account, amount), endOwnerOp. The bracket credits spend. "Registered wallets" becomes an app list. No module code, two signatures.
  - C. Leave top-up out of the M0 app and produce the control with a script that runs B.
- Recommendation: B. No new contract surface, and the bracket path already passed G6 items d and e (docs/GATES.md).
- Blocks: component 4 (only for A), 9 and 11.

#### Q20. Uninstall and reinstall

- Kind: IMPLEMENTATION.
- PRD: 7.1 line 159 ("Uninstall releases pending equity to spend. Nothing is stranded"); 7.13 line 266; I7 line 361; I11 line 365. SPEC section 4. g6-notes.md 11.3; zerodev-passkey.md 9.1.
- Facts: Kernel v3.1 calls onUninstall through ExcessivelySafeCall and ignores the result (E17), so a failed onUninstall leaves module state behind while the uninstall succeeds. SPEC section 4's onInstall reverts if the account is marked installed, so stale state would block every later reinstall.
- Options:
  - A. onUninstall releases each bucket with a RELEASED receipt, then deletes ledgers, rule, keeper and observation; receipts and lots stay, keyed by account and sellable after a reinstall. onInstall overwrites stale state with a fresh snapshot instead of reverting, since only the account can call it. endOwnerOp tolerates an uninstalled account (Q13).
  - B. SPEC draft 1 as written. A failed onUninstall blocks reinstall of that module version for that account.
- Recommendation: A.
- Blocks: component 4.

#### Q48. ERC-7579 base and module size

- Kind: IMPLEMENTATION.
- PRD: 13 lines 381 and 383 ("a maintained ERC-7579 module base"). Build contract line 70.
- Facts: the vendored OpenZeppelin is 5.4.0 and ships contracts/interfaces/draft-IERC7579.sol and contracts/account/utils/draft-ERC7579Utils.sol (E21). The Kernel v3.1 implementation is 22,784 bytes (docs/GATES.md), a sense of scale against the usual 24,576-byte limit, which was not checked for chain 4663 here.
- Options:
  - A. Implement the executor against OpenZeppelin's ERC-7579 interfaces, no new dependency. Keep LedgerMath, SessionCalendar and PriceGuard as internal libraries, measure runtime size at each component, and move the calendar lookups or PriceGuard into an external library or the extension contract if the module nears the limit.
  - B. Rhinestone ModuleKit's executor base. A second dependency for a few functions.
- Recommendation: A.
- Blocks: component 4.

### 3.6 Split, settle, release and receipts (component 5)

#### Q21. The trigger's quote and the slippage cap

- Kind: IMPLEMENTATION.
- PRD: 7.3 line 181 ("Slippage cap against the trigger's quote"); 7.4 step 9, line 196; 9 line 306. SPEC section 8.
- Question: who supplies the quote for a public trigger, in what unit, and on which pool?
- Options:
  - A. SPEC draft 1: the caller passes the pool, checked against the allowlist, and a non-zero quote in raw token units per 1e6 USDG base units; minOut = equity * quote / 1e6 * (10,000 - slippageBps) / 10,000. A public caller supplies its own quote, so for public triggers the slippage cap binds only against that caller's quote and the premium cap is the real bound. For sells the quote is USDG base units per 1e18 token units.
  - B. The caller passes minOut directly. The amount the module swaps can differ from what the caller expected.
  - C. The module quotes through QuoterV2 itself. More gas, and a same-block quote adds no protection.
- Recommendation: A, recording the quote, minOut and the pool on the receipt (Q26), and stating the public-trigger point in DECISIONS.md.
- Blocks: components 5 and 7.

#### Q22. Minimum clip and existing buckets

- Kind: IMPLEMENTATION.
- PRD: 7.3 line 181; 9 line 303; 0 change 25, line 47. SPEC section 8 step 5.8 (OPEN, Q-clip-merge).
- Question: does a split combine its new equity part with a bucket for the same ticker?
- Options:
  - A. No merge in split (SPEC draft 1). A part below the clip joins the bucket; a part at or above it buys alone as FILLED. The keeper calls settle on every bucket that has reached the clip and whose guard is clear, in the same block or the next. Two swaps when both exist.
  - B. Split always adds its part to the bucket and, when the bucket reaches the clip and the guard is clear, buys the whole bucket in one swap with a SETTLED receipt while the split's own receipt says QUEUED. One swap, and FILLED appears only when no bucket existed.
- Recommendation: A. Fewer paths, I2 holds per split with no new field, and the second swap costs cents. Without A's keeper policy or B, money queued for CLIP never buys, so the keeper policy is part of the decision (Q35).
- Blocks: components 5 and 7.

#### Q23. Lots and queued equity

- Kind: IMPLEMENTATION.
- PRD: 6 lines 141, 144 and 145 ("Lot: One buy"); 7.6 line 219; 9 lines 308, 309 and 315 (QUEUED, SETTLED and RELEASED listed as lot states); I7 line 361. SPEC section 14.
- Question: when several payments queue on one ticker and one settle buys them all, which lot is which?
- Options:
  - A. SPEC draft 1: one bucket per ticker, not lots. QUEUED receipts record what entered, SETTLED and RELEASED record how it left. A lot exists only for a buy (FILLED or SETTLED) and its id is the receipt id. Release moves the whole bucket.
  - B. Per-payment queued lots consumed first in, first out by settle, release and outflows. More storage and more transitions to test.
- Recommendation: A, and write in DECISIONS.md that the section 9 states QUEUED and RELEASED describe receipts, not lots.
- Blocks: component 5.

#### Q24. Queued equity after a rule edit

- Kind: IMPLEMENTATION.
- PRD: 7.3 line 182; 7.4 line 205 (after five days the app asks the owner to "raise the cap, switch ticker, or release to spend"); 8.6 line 282; I8 line 362. SPEC section 9 (OPEN, Q-settle-rule).
- Question: does settle use the caps of the rule version that queued the money, or the current rule? What happens to a bucket for a ticker the new rule dropped, and what does "switch ticker" do?
- Options:
  - A. The current rule's caps at settle, with the receipt recording the current rule version. I8's "its rule" then means the version on the SETTLED receipt. A dropped ticker's bucket keeps waiting and settles under the current caps unless released. A ticker removed from TokenSource sends its bucket to spend as REFUSED_TICKER at the next settle. "Switch ticker" is a rule edit for future payments plus an optional release; no function moves a bucket between tickers.
  - B. Caps frozen per bucket at queue time. Raising the cap would not help money already waiting.
- Recommendation: A. The five-day prompt to raise the cap only makes sense if the new cap applies to money already queued.
- Blocks: components 5 and 9.

#### Q25. Receipt storage and ids

- Kind: IMPLEMENTATION.
- PRD: 6 line 145; 7.6 lines 219 and 220; 10 lines 335 and 337; I7 line 361. Build contract line 7. SPEC section 13.
- Facts: the public RPC returns old logs and old receipts but no old state (E8).
- Options:
  - A. SPEC draft 1: an event carrying every field, keccak256 of the encoded receipt stored per id, ids global and sequential from 1, lot id equal to the receipt id. The verifier reads the event from logs and checks the stored hash at latest state, with no archive node.
  - B. The full struct in storage. One call reads a receipt on any RPC, at roughly 10 to 12 more storage slots per receipt.
- Recommendation: A.
- Blocks: components 5 and 8.

#### Q26. Receipt fields the PRD leaves out or leaves vague

- Kind: IMPLEMENTATION.
- PRD: 10 line 335 (the field list); 7.2 line 166 and 0 change 28, line 55 (every receipt says WRAPPED); 7.5 line 215 (the receipt records a sell override); 7.4 step 7, line 194; 7.4 line 202. SPEC section 13.
- Question: section 10 omits fields that other sections require, and leaves the encodings open.
- Options:
  - A. Keep SPEC draft 1's list, which already adds the accounting mode, queue reason, lot id, queuedSince and the override flag, and add: the USDG/USD round id and answer used for step 7, without which the verifier cannot recheck the depeg test; the trigger's quote and the computed minOut for step 9; the amount taken per bucket on RECONCILED. Encodings: tokenUid as bytes32 (uid() returns bytes32 on all four tokens, and SPY's value equals its assets API id, E5 and E14); venueId uint8 with 1 meaning Uniswap v3 through SwapRouter02; the pool as an address for v3, with a bytes32 PoolId only in a later version for v4; calendarVersion uint32 from the extension contract (Q8); payer zero in M0.
  - B. Section 10's list only. The verifier cannot recompute the depeg check or the minimum out.
- Recommendation: A.
- Blocks: components 5 and 8.

#### Q27. Which issuer text is the disclosure

- Kind: OWNER.
- PRD: 4 line 108; 10 line 339 (hashed into the module as a constant; a text change means a new module version). Build contract line 63. docs/disclosure/README.md; docs/research/issuer-docs.md.
- Question: the hash is a module constant, so the passage must be final before the deploy. Which passage?
- Options:
  - A. Candidate 3 in docs/disclosure/README.md, the Product page text followed by the Regulatory status paragraph, keccak256 0x8408c7a59df30d1b5dbec102c388048f2bf8bba21a2e91ac0806df7d68068e89.
  - B. Candidate 2, one source page, which loses the statement that the issuer is not regulated.
  - C. Another passage.
- Recommendation: A, for the reasons in that README.
- Blocks: component 5 (the constant) and the deploy.

### 3.7 Sell-back (component 6)

#### Q28. What "a sell waits" means onchain

- Kind: OWNER.
- PRD: 7.5 line 215 ("When the market reference is not live, a sell waits by default"); 9 line 315 (no waiting-sell state); 5 C3 line 122; 14 line 443. SPEC section 11 (OPEN, Q-sell-wait; the draft assumes the revert).
- Options:
  - A. The sell reverts with SellWaits(reason). The app shows the sell as waiting, with the reason and the reopen time, and offers a retry at the open or the override. No new state and no new keeper power.
  - B. An onchain queued sell that the keeper, or anyone after the grace period, executes at the open. Needs a new lot state and a cancel path, and gives the keeper the power to sell an owner's tokens at a moment it picks, which changes C3 and the keeper wording again.
  - C. A scheduled sell through a session key. M1 work.
- Recommendation: A.
- Blocks: components 6 and 9.

#### Q29. What the sell override skips

- Kind: OWNER.
- PRD: 7.5 lines 214 and 215 ("The owner can override once per sell after the app shows the gap risk"); 8.4 line 278. SPEC section 11 (override skips the session and staleness steps only).
- Facts: the first round after a weekend moved prices by up to 176.6 bps (E3). A weekend sell held to the default 100 bps cap against Friday's round fails in the weeks the owner most needs cash.
- Options:
  - A. SPEC draft 1: skip the session and feed-age checks; the discount cap against the last round still applies.
  - B. A, plus the owner sets a one-off cap for that sell, up to the ceiling from Q18, shown with the gap risk and recorded on the receipt.
  - C. Skip every reference check and rely on the owner's minimum out.
  - In every option the override never skips the token pause, the blocklist, oraclePaused, a pending multiplier change or the USDG depeg check.
- Recommendation: B. Every sell keeps a reference bound, and the override still works when the gap is larger than the rule's cap.
- Blocks: components 6 and 9.

#### Q30. Selling an amount across lots

- Kind: IMPLEMENTATION.
- PRD: 7.5 line 214 ("turns a lot or an amount into USDG"); 9 line 315; I7 line 361. SPEC section 11 (first in, first out; ExceedsLots).
- Question: which lots does a sell by amount reduce, and what about tokens outside lots?
- Options:
  - A. By amount: oldest lot with tokens left first. By lot: the owner names it. Tokens held outside lots, from before install or transferred in, cannot be sold through Sleeve in M0, and the app says so. If a lot's recorded remainder exceeds the account's balance because tokens left outside Sleeve, sell at most the balance and record the shortfall. Proceeds split across lots pro rata to tokens taken.
  - B. Also sell unlotted tokens by amount, with receipts carrying an unlotted part.
- Recommendation: A.
- Blocks: component 6.

### 3.8 TokenSource, admin and deploy

#### Q31. TokenSource admin powers and the initial configuration

- Kind: OWNER.
- PRD: 0 change 11, line 23; 7.4 line 206 (pools "set through the timelock"); 9 line 330; 13 line 386 ("The admin can only remove"); 14 lines 438, 444 and 454; I10 line 364 ("cannot add a ticker outside the canonical list"). D-004 ("can only remove tickers or change pools"). SPEC section 2.
- Questions: can the timelock add a pool? Can it add a ticker at all, given that I10's wording implies adds inside the canonical list while sections 13 and 14 forbid adds? Are the launch tickers and first pools set in the constructor, or must they wait out the 48-hour timelock, which would push every first fill past the deadline? Can owners still sell lots of a removed ticker through Sleeve?
- Options:
  - A. SPEC draft 1 plus two changes. Tickers, feeds, session types and initial pools are set in the constructor. Afterwards the timelock can remove a ticker and add or remove a pool. A pool is accepted only if getPool(USDG, token, fee) returns it and its fee is 100, 500 or 3,000; the 1 percent tier is excluded because its fee alone uses the whole default cap (pools.md). No ticker adds in this version. A removed ticker stays sellable for existing lots.
  - B. A, with pools also fixed at deploy. Smallest admin power, but a pool that drains has no fix inside the version.
  - C. Timelocked ticker adds from the issuer's list. Not checkable onchain while G3 is open (22 line 552), so it is trust in the admin.
- Recommendation: A. It matches D-004, keeps I10 true on its strict reading, and the premium cap bounds what a bad pool can cost (14 line 438). Reword I10 to "cannot add a ticker".
- Blocks: component 5 and the deploy.

#### Q32. Single hop in M0

- Kind: IMPLEMENTATION.
- PRD: 7.4 line 206 ("Multi-hop is allowed when the direct USDG pool is thin"); 13 line 387. SPEC section 10 (single hop).
- Facts: each launch ticker has a direct USDG fee-500 v3 pool holding between 126,073 and 2,124,718 USDG (E11). pools.md recommends those pools and parks the WETH route.
- Options:
  - A. Single hop only in M0. Multi-hop later behind the adapter, every hop allowlisted.
  - B. Multi-hop in M0. A second pool per path to allowlist and check, for a few bps on SPY at one block.
- Recommendation: A.
- Blocks: component 5.

#### Q33. Timelock and deploy configuration

- Kind: IMPLEMENTATION.
- PRD: 13 lines 386 and 400; 14 line 444. D-004. SPEC section 1 (TimelockController, 48-hour minimum delay, proposer and executor DEPLOYER, no admin).
- Options:
  - A. SPEC draft 1: OpenZeppelin TimelockController with a 172,800-second minimum delay and no admin role holder, DEPLOYER as proposer, executor and canceller. Every launch value goes in constructors (Q31). A deploy script reads every constant back (13 line 400). Contracts are verified on robinhoodchain.blockscout.com, whose API answered curl with a Cloudflare challenge page at 15:10 UTC (E23), so test forge's Blockscout verification before deploy day.
  - B. DEPLOYER as the timelock's admin. An admin role holder can grant and revoke roles without the delay, which weakens the 48-hour statement in D-004.
- Recommendation: A.
- Blocks: the deploy.

### 3.9 Keeper (component 7)

#### Q34. The keeper on the shared GreenCloud VPS, and its key

- Kind: OWNER.
- PRD: 13 line 395 ("Its hot key holds ETH and no authority"); 14 line 443. Build contract lines 38, 46 and 48. D-002; D-004. PROGRESS line 20. The owner message for this run.
- Question: the keeper will run on the GreenCloud server that also runs FlowGuard. How does the KEEPER key get there, and how is it kept apart from FlowGuard?
- Options:
  - A. The owner copies the existing KEEPER key file to the server himself, into a file only a dedicated keeper user can read. Agents never read or print it.
  - B. Generate a new keeper key on the server, record only its address, fund that address, and retire the laptop KEEPER key. The key never leaves the server. The address changes, which matters only if the old one is already funded or set in the module (Q14).
  - C. Run the keeper on the owner's laptop. Against D-002.
  - For A and B: a dedicated unix user, a systemd unit with restart on failure (build contract line 38 allows systemd or pm2, and pm2 would share FlowGuard's process manager if FlowGuard uses one), no shared env files, and an ETH balance held at the funding plan's 0.003 ETH.
- Recommendation: B, before KEEPER is funded. Also decide who sends the direct factory deployment if ZeroDev's bundler rejects a first UserOp (zerodev-passkey.md 11.3). The keeper key can send it with no new authority, but it is a new duty.
- Blocks: component 7, and Q14's value before the deploy.

#### Q35. Keeper policies the PRD leaves open

- Kind: IMPLEMENTATION.
- PRD: 7.2 lines 171 and 173; 7.4 line 204; 13 line 395.
- Options:
  - A. Poll USDG Transfer logs to installed accounts and every launch feed every few seconds. Split within one poll of a transfer unless the base fee is above 0.1 gwei, and override the ceiling once the oldest unsorted transfer, by its block timestamp, is 24 hours old. Settle every bucket that has reached the clip and passes a dry run (SPEC section 9's GuardNotClear revert means wait), at each session open after the first fresh round (Q6) and on every new round. Quote each allowlisted pool through QuoterV2 and use the best. One nonce manager. Log each decision with its block number. Keeper RPC is Alchemy, never the public RPC the verifier uses (D-008).
  - B. Cron-style polling once a minute. Simpler, and C1's two-minute median gets tight.
- Recommendation: A.
- Blocks: component 7.

### 3.10 Verifier (component 8)

#### Q36. What the verifier recomputes without historical state

- Kind: IMPLEMENTATION.
- PRD: 10 line 349 ("recompute every number through a different RPC provider"). Build contract line 39. D-008 (verifier on the public RPC).
- Facts: the public RPC serves old logs and receipts but no old state (E8). getRoundData at latest state returns any past round; E3 read all 2,530 rounds of the five feeds that way.
- Options:
  - A. Recompute from the receipt event and stored hash, the Transfer logs in the fill transaction (USDG spent, tokens received), getRoundData at latest state, UIMultiplierUpdated events for the multiplier in force at the block time, pause and oracle-pause events, the calendar's pure function and Q11's premium function. Never re-read pool state at the fill block. Show any mismatch. The page calls the public RPC from the browser, or through a Vercel route if CORS blocks it, still on the public RPC.
  - B. Also re-read state at the fill block through an archive endpoint. Adds a provider, and dRPC is already the fork RPC.
- Recommendation: A.
- Blocks: component 8.

### 3.11 App (component 9)

#### Q37. Production domain and the passkey server

- Kind: OWNER.
- PRD: 7.1 line 156 ("The passkey's relying-party id is Sleeve's domain"). D-003. zerodev-passkey.md sections 6 and 11.
- Question: the RP id is permanent for every passkey created, and HP1 accounts need passkeys. Which domain, and does the app use ZeroDev's hosted passkey server or its own WebAuthn ceremony?
- Options:
  - A. A custom domain chosen now, with the app's own WebAuthn ceremony and credential records in Supabase (zerodev-passkey.md option B).
  - B. A custom domain with ZeroDev's hosted server, whose RP id comes from the project dashboard.
  - C. The Vercel project domain as RP id for M0. Passkeys made on it stop working if the app moves.
- Recommendation: A.
- Blocks: component 9 and every HP1 account. Before the first real passkey.

#### Q38. A recovery signer in M0

- Kind: OWNER.
- PRD: 7.2 line 166; 7.13 lines 265 and 266 ("through any ERC-4337 client"); I11 line 365. Build contract line 40 (the app scope omits recovery). zerodev-passkey.md 9.2, 9.3 and 11.6.
- Question: a passkey signs only for its RP id's domain and cannot be exported, so the I11 promise holds only for accounts with a recovery signer. Is one required at onboarding in M0?
- Options:
  - A. Required. Onboarding installs ZeroDev's ECDSA validator as a secondary validator for the owner's existing wallet or a new recovery phrase, as tested on live state in zerodev-passkey.md 9.3. Recovery actions are unbracketed, which the app says.
  - B. Offered and optional. I11 and 7.13 are claimed only for accounts that set it, and campaign accounts set it.
  - C. Deferred to M1. The README narrows I11 to "while Sleeve's domain serves the app".
- Recommendation: B. A adds a step for every user under time pressure, and C leaves a non-custody promise that fails if the domain goes dark.
- Blocks: component 9.

#### Q39. Gas sponsorship for owner UserOps

- Kind: OWNER.
- PRD: 7.1 line 157 ("Owner actions are sponsored UserOps"); 9 line 324; 12 line 373. FUNDING.md has no paymaster line. zerodev-passkey.md section 7 (sponsorship needs a gas policy on the owner's ZeroDev project).
- Options:
  - A. ZeroDev's paymaster with a gas policy and a hard cap, billed to the owner. Needs a funding line.
  - B. Owner accounts pay gas in ETH in M0, and campaign accounts get a small ETH float. An owner op of about 300,000 gas costs about 0.0000095 ETH at today's 0.0318 gwei (E12). App copy must not say sponsored.
  - C. A Sleeve paymaster contract. Too much for M0.
- Recommendation: A if the owner accepts a capped spend, otherwise B.
- Blocks: components 9 and 11, and FUNDING.md.

#### Q40. The eligibility gate with passkey-only login

- Kind: OWNER.
- PRD: 3 line 82 (re-read the issuer's list at every release); 7.12 line 257 ("Residency attestation at onboarding plus an IP check"); 14 line 452; 20 line 522. D-002 (Vercel). issuer-docs.md section 2 (the issuer's lists match PRD section 3 today).
- Questions: where the IP check runs, what it blocks, what is stored, and what judges in blocked countries see.
- Options:
  - A. Block onboarding only, meaning passkey creation, install and rule activation, using Vercel's request geolocation. The landing page, receipts, the verify page and a recorded demo stay open. Store the attestation version, the declared country, the IP country and a timestamp keyed by account address, never the raw IP. A release script refreshes the lists from the issuer page and fails on a hash change.
  - B. Block the whole app for blocked IPs. Judges in the US, Canada, the UK and Switzerland cannot read or verify receipts.
  - C. Attestation only, no IP check. Against 7.12.
- Recommendation: A.
- Blocks: component 9.

#### Q41. Cards

- Kind: IMPLEMENTATION.
- PRD: 6 line 149; 7.10 lines 243 and 244 (amounts and address hidden by default; the receipt id reveals the account); 15 line 465.
- Options:
  - A. Render the receipt card and the week card on the device, canvas to PNG, from data the app already holds. No server route receives an account or a receipt id. Share through the Web Share API or a download. Show-proof adds the receipt id only after the warning. A week runs Monday to Sunday in the owner's local time.
  - B. A Vercel OG image route. It must take only the displayed fields, because a URL carrying a receipt id or an address would reveal the account to anyone the image link reaches.
- Recommendation: A.
- Blocks: component 9.

#### Q42. Account creation and the install snapshot

- Kind: IMPLEMENTATION.
- PRD: 7.1 line 158 ("Money that was in the account before Sleeve is never split"); I5 line 359. zerodev-passkey.md short answer 7 and sections 11.3 and 11.4.
- Question: USDG sent to a counterfactual address before the module is installed lands in the install snapshot and is never split. Install in the deploying UserOp, or later?
- Options:
  - A. Install through initConfig in the deploying UserOp, and show the address only after the deployment is confirmed. Keep the direct factory deployment as the fallback for the ERC-7562 risk zerodev-passkey.md raises (onInstall reads USDG during deployment validation through an unstaked factory), with the sender decided in Q34.
  - B. Install in a second UserOp. The address no longer depends on the module, but the app must still hide it until the install lands.
- Recommendation: A.
- Blocks: component 9.

#### Q43. Exit copy and the issuer's redemption terms

- Kind: OWNER.
- PRD: 10 line 347 ("Holders do not redeem with the issuer and Sleeve offers no redemption into shares"); 20 line 521. issuer-docs.md section 6.
- Facts: the issuer's FAQ says "You can also redeem them directly with the Issuer, where there is no authorized participant (a firm that processes redemptions on investors' behalf), subject to completing the Issuer's KYC/AML (identity verification) processes." (E16).
- Options:
  - A. The wording proposed in issuer-docs.md: "Exit: sell on the secondary market. Redemption with the issuer exists only under the issuer's conditions and identity checks, and it pays cash, not shares. Sleeve offers no redemption."
  - B. Drop the Exit line.
- Recommendation: A.
- Blocks: component 9 copy and the README.

### 3.12 HP2 replay (component 10)

#### Q44. HP2 definitions fixed before any result is seen

- Kind: OWNER.
- PRD: 5 C2 line 120 ("The metric does not change after the result is seen"); 5 lines 129 and 132; 17 line 489; 0 change 18, line 35; 7.4 line 202.
- Facts: no USDG v3 pool for SPY, NVDA or AAPL existed on 1 July 2026 (block 653,327, E9 and E10). The fee-500 pools recommended for the allowlist were created on 21 July (NVDA), 27 July (AAPL), 12 August (SPY) and 27 August (QQQ) (E10). Weekend and holiday closures held the reference for 48 to 92 hours (E3).
- Sub-questions and options:
  1. Window. A: per ticker, from its allowlisted pool's creation, or the first day it meets a depth threshold, to a pinned end block. B: one common window from 27 August for all four. C: from 1 July using whichever pool was deepest at each moment, which is not what the module would have done.
  2. Reference for a buy at arrival outside the session. A: the round in force at execution, the literal reading that matches receipts, which on a weekend is Friday's held price. B: for both policies, the first round at or after the next session open, a live benchmark. The other is reported as secondary.
  3. Ablation. The PRD's reason, that without the feed "off-hours protection cannot exist" (line 132), predates the v1.2 calendar, which now provides the off-hours protection. A: a calendar-only policy that waits for the session with no premium or age check, scored against the feed. B: a pool TWAP guard in place of the feed. C: buy at arrival, which equals the mechanical baseline and measures nothing new.
  4. Size and arrivals. A: 100 USDG of equity per payment, arrivals uniform over wall-clock time. B: 50 USDG (journey 8.1), arrivals weighted to Lagos business hours.
- Recommendation: 1A, 2B as primary with 2A reported beside it, 3A, 4A, plus a 1,000 USDG size sensitivity. 1A uses the pools the module will use, 2B compares both policies against a live price, which is what C2 says it measures, and 3A isolates what the feed adds on top of the calendar. The README must say the window starts later than 1 July and why.
- Blocks: component 10. Before the replay runs.

#### Q45. HP2 mechanics

- Kind: IMPLEMENTATION.
- PRD: 17 line 489 ("Inputs pinned: block range, pool addresses, feed addresses, sampling seed"); 5 C2 line 120 (delay reported next to the premium; failure if the median delay is above 72 hours).
- Options:
  - A. A fixed integer seed committed before the run; 250 arrivals per ticker. The price for buying at arrival comes from QuoterV2 quoteExactInputSingle by eth_call at the arrival block on dRPC, whose archive state reaches 1 July (E9). The guarded policy is evaluated at arrival, at each session open after the first fresh round, at each new feed round, and every 15 minutes in session, and fills at the first instant all checks pass, using the same calendar code as the module (the compiled library through forge, or a port that passes the same table tests). QuoterV2 reverts count as pool unusable. Delay is reported as the median and the 90th percentile. Rounds whose answer is more than 10 times the feed's median are dropped; these are the first 7 to 24 rounds of each stock feed, all before 23 June 2026 at 13:53 UTC (E4). Calls sleep 0.2 to 0.5 seconds and every response is cached with its block number.
  - B. Evaluate the guarded policy every 5 seconds like the live keeper. About 300 times more archive calls than A within dRPC's free tier.
- Recommendation: A.
- Blocks: component 10.

### 3.13 HP1 campaign (component 11)

#### Q46. HP1 definitions

- Kind: OWNER.
- PRD: 17 line 488 ("at least 10 real payments from at least 3 distinct payers on mainnet, at least one arriving off-hours, each receipt verified by the verifier on a separate RPC"); 16 line 478 (no counts that are not published receipt counts). FUNDING.md lines 30 to 36 (TEST_PAYER makes 4 of the 10 payments).
- Questions: what counts as a distinct payer, a real payment, off-hours and verified?
- Options:
  - A. A distinct payer is a distinct sending address controlled by a distinct person, each listed in EVAL_CAMPAIGN.md with its relationship to the team. TEST_PAYER counts as one team payer. A real payment is a mainnet USDG transfer to a Sleeve account from a non-Sleeve address, labeled honestly. Off-hours means SessionCalendar says closed at the transfer's block timestamp, which any weekend payment meets. Verified means `sleeve verify` on the public RPC with zero mismatches and its output committed.
  - B. A distinct payer is any distinct address. One person with three wallets would count as three payers.
- Recommendation: A.
- Blocks: component 11. Before the campaign.

### 3.14 Claims

#### Q47. Claim wording the build would make untrue

- Kind: OWNER.
- PRD: 5 C3 line 122; 7.1 line 156; 14 lines 442 and 443. Build contract lines 29 and 38. D-004. g6-notes.md 11.1.
- Items:
  1. C3 says the module can move only unsorted or queued USDG. M0's sell-back moves stock tokens through the module on an owner call. Proposed: "Without an owner signature, the module can move only unsorted or queued USDG, only to an allowlisted pool in the same call, and bought tokens must land in the account. An owner-signed sell moves stock tokens to an allowlisted pool under the mirrored guard, and proceeds land in the account."
  2. The keeper key "has no authority beyond public functions" (14 line 443, build contract line 38, D-004), yet it can trigger before the grace period. Proposed: "The keeper key can trigger sorting before the grace period. It cannot move funds anywhere a public trigger cannot."
  3. PRD 7.1 line 156, 14 line 442 and build contract line 29 say Kernel exempts the root validator from validation hooks. The G6 spike found that the deployed v3.1 enforces a root validator's hook on UserOps (g6-notes.md 11.1). The bracket design does not depend on either reading, but the README, SECURITY.md and the video must not repeat the statement. Proposed: "Sleeve relies on no hook."
- Options: A. accept the three rewordings. B. keep the PRD text, which would put three untrue statements into submission material.
- Recommendation: A.
- Blocks: app copy, README and SECURITY.md (components 9 and 11).

## 4. Conflicts

Owner overrides already logged, which replace PRD text for this run:

- Hosting. PRD 13 line 395 runs the keeper on Cloudflare Workers with a cron and a queue. Build contract line 46 and D-002 move the app, verifier page and API routes to Vercel and the keeper to the owner's VPS. Resolved by D-002. PROGRESS line 20 and the owner's message for this run name the GreenCloud server that also runs FlowGuard (Q34).
- Login. PRD 7.1 line 155 allows passkey or email. Build contract lines 40 and 47 make passkey the only M0 login. Resolved by D-003. Left over: 7.13 line 266 and I11 assume the owner can act through any ERC-4337 client, which a domain-bound passkey cannot do (Q38).
- Keys. PRD 14 line 454 describes a keeper hot key and a deny-only timelocked admin key without saying single key or multisig. Build contract line 48 and D-004 make DEPLOYER, KEEPER and TEST_PAYER single EOAs. Resolved by D-004, which adds rather than contradicts.

Open conflicts, each tied to an item above:

1. Admin pool power. D-004 says the admin can "change pools" and PRD 7.4 line 206 sets pools through the timelock, while PRD 13 line 386 and 14 line 444 say the admin "can only remove". (Q31)
2. Ticker adds. I10 (line 364) forbids adding a ticker "outside the canonical list", which implies adds inside it, while 0 change 11 (line 23), 13 line 386 and 14 line 444 allow removal only. (Q31)
3. Keeper authority. Build contract line 38, D-004 and PRD 14 line 443 give the keeper key no authority beyond public functions, while PRD 7.2 line 171 lets the keeper trigger before the grace period, which the public cannot. (Q14, Q47)
4. C3 against sell-back. C3 (line 122) lets the module move only unsorted or queued USDG, while sell-back, in M0 per 7.5 line 211 and build contract line 37, moves stock tokens through the module. (Q47)
5. Root validator hooks. PRD 7.1 line 156, 14 line 442 and build contract line 29 say Kernel exempts the root validator from hooks; the G6 spike found the deployed v3.1 does not (g6-notes.md 11.1). No M0 mechanism depends on it. (Q47)
6. Receipt fields. 7.2 line 166 and 0 change 28 (line 55) put the accounting mode on every receipt, and 7.5 line 215 records the sell override on the receipt; the section 10 field list (line 335) has neither. (Q26)
7. Session type field. 7.4 line 202 takes session types from the issuer's allDayTradability field; the live assets API has no such field and returns tradingCapabilities.overnight instead (E14), a mismatch PRD 24.8 line 668 already notes. (Q5)
8. Exit copy. PRD 10 line 347 says holders do not redeem with the issuer; the issuer's FAQ says they can, under conditions (E16). (Q43)
9. HP2 window. PRD 17 line 489 and C2 line 120 start the replay on 1 July 2026, but no USDG v3 pool for SPY, NVDA or AAPL existed then, and the fee-500 pools for the allowlist arrived between 21 July and 27 August (E9, E10). (Q44)
10. Ablation rationale. PRD 5 line 132 says that without the feed "off-hours protection cannot exist", but since v1.2 the session calendar provides off-hours protection (0 change 18, line 35; 7.4 line 202). (Q44)
11. Wrong G5 source. PRD 22 line 554 and source S24 (line 698) cite pool 0xae1685599288831eb0844cb59058116ee3184b9a as a USDG/NVDA v3 pool. Onchain it pairs USDG with 0xE1E5f00A9B0255ca4dF85B3130eE0F77d15acC2D, a token whose name starts "Pushin'" and which the issuer's API does not list (E22; also docs/research/pools.md). It must stay off the allowlist.
12. Check order. PRD 7.4 lines 186 to 196 list nine checks with no clip check, while 9 lines 301 to 303 place the clip after the premium check, which needs a swap. (Q12)
13. Waiting sells. 7.5 line 215 says a sell waits by default; the lot states in 9 line 315 have no waiting-sell state. (Q28)
14. Lot states. 6 line 144 defines a lot as one buy, while 9 line 315 lists QUEUED and RELEASED, which involve no buy, as lot states. (Q23)
15. Top-up scope. Owner top-up (7.2 line 172) is an M0 control in 17 line 492, but the build contract's app scope (line 40) does not list it. (Q19)
16. Recovery scope. 7.13 lines 265 and 266 and I11 need a recovery signer, which the build contract's app scope (line 40) does not list. (Q38)
17. Sponsorship budget. PRD 7.1 line 157 makes owner actions sponsored UserOps, while FUNDING.md budgets only DEPLOYER, KEEPER and TEST_PAYER. (Q39)
18. Demo rule against the calendar. Build contract line 65 and PRD 16 line 480 allow demos only of paths that ran on mainnet, while no US session is open between 2026-10-03T00:00:00Z and the deadline. (Q1)
19. Funding plan against the default clip. FUNDING.md's 10 USDG campaign payments at the suggested 10 percent give 1 USDG equity parts, below the 25 USDG default clip (7.3 line 181). (Q2)
20. Worst-case line. 7.4 line 200 says the worst case against the live price is about 1.5 percent with the default cap. That holds in USDG terms and ignores a USDG move inside the depeg tolerance. (Q9)
21. Multiplier window. SPEC draft 1 section 8 step 5.5 also queues until the feed posts after a multiplier change, which the onchain record shows would have blocked buys for 11.8 to 56.8 hours per change. Not a PRD conflict, a draft choice to revisit. (Q10)
22. Crews milestone. Build contract line 56 puts crews in M1, while PRD 19 line 513 lists "crews public" at M3 and 23 line 595 orders crews after borrow. No M0 effect.
23. Fuzz runs. Build contract line 73 asks for at least 10,000 LedgerMath fuzz runs, while contracts/foundry.toml line 15 sets runs = 1000 for the whole project. The LedgerMath tests need a per-test or profile override. No PRD effect.

Checked and consistent, recorded so nobody rechecks them: the beacon that build contract line 27 names for isBlocked is the token's ACCESS_CONTROLLED_REGISTRY, the same address on all four tokens (E5); USDG has 6 decimals, stock tokens 18 and feeds 8 (E3, E5, E15); Chainlink's own feed list carries the SPY, QQQ, NVDA, AAPL and USDG/USD proxies of the constants table with a 0.5 percent threshold and a 24-hour heartbeat (E2); the issuer's restricted and prohibited lists match PRD section 3 (issuer-docs.md section 2).

## Appendix. Evidence

Times are UTC on Friday 2 October 2026. "Public RPC" is https://rpc.mainnet.chain.robinhood.com. Scratch scripts are in the session scratchpad folder prdq.

E1. Time and head block. `date -u` returned `Fri Oct  2 15:01:58 UTC 2026`. `cast block-number --rpc-url https://rpc.mainnet.chain.robinhood.com` returned `78322700` at 15:02:09.

E2. Chainlink feed metadata. `curl -s https://reference-data-directory.vercel.app/feeds-robinhood-mainnet.json` at 15:09:48 (the URL is the rddUrl for "Robinhood Chain Mainnet" in Chainlink's docs chain config). SPY proxy 0x319724394D3A0e3669269846abE664Cd621f9f6A: `"threshold": 0.5, "heartbeat": 86400, "decimals": 8`, marketHours `us_equities_24/5`. USDG / USD proxy 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2: `"threshold": 0.5, "heartbeat": 86400, "decimals": 8`, marketHours `Crypto`. QQQ, NVDA and AAPL carry the same threshold, heartbeat and market hours as SPY. ETH / USD proxy 0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9.

E3. Every round of the five feeds. `cast call --rpc-url <public> <feed> 'latestRoundData()(uint80,int256,uint256,uint256,uint80)'` at 15:02 gave the latest round ids: SPY 18446744073709551770, QQQ 18446744073709552017, NVDA 18446744073709552774, AAPL 18446744073709552314, USDG/USD 18446744073709551735, that is phase 1 rounds 154, 401, 1,158, 698 and 119. A script then sent JSON-RPC batches of eth_call to `getRoundData(uint80)` (selector 0x9a6fc8f5) for every round id from (1 << 64) + 1 to the latest, against the public RPC at latest state, 15:04 to 15:07:47. Results:
- Stock feeds: first round 2026-06-22 00:00 UTC. Rounds with updatedAt between Friday 20:00 and Sunday 20:00 New York time: 0 on each of the four feeds. Gaps over 25 hours: 14 per feed, each ending at 20:00 New York time on a Sunday, or on Monday 7 September for Labor Day. The gap from Thursday 2 July to Sunday 5 July 20:00 covers the 3 July holiday. The longest gaps are QQQ 91.5 hours (4 to 7 September) and SPY 80.8 hours.
- First round after each closure: 20:00:18 to 20:01:09 New York time.
- Price change at that first round, in bps: SPY from -68.3 to +70.5; QQQ from -117.7 (13 September) to +176.6 (26 July); NVDA from -111.6 (13 September) to +118.5 (26 July); AAPL from -39.3 to +95.0.
- USDG/USD: 119 rounds from 2026-06-05 15:02 UTC. All 118 gaps are 24.00 to 24.02 hours. Answers range 99963000 to 100041420 at 8 decimals, at most 4.14 bps from 1.00000000. 34 rounds fall between Friday 20:00 and Sunday 20:00 New York time, at about 11:00 New York time each day.

E4. Early stock rounds at the wrong scale, from the same data. SPY rounds 1 to 7 (round 1 answer 7424400000000000000 at 2026-06-22T00:00:43Z; round 8 answer 73683695000 at 2026-06-23 13:51 UTC), QQQ 1 to 13, NVDA 1 to 24 and AAPL 1 to 17 carry answers about 1e8 times the normal scale. The last of them is NVDA round 24 at 2026-06-23 13:48 UTC, and the first normal rounds land between 13:51 and 13:53 UTC that day.

E5. Token state at block 78,328,079 (15:11:10). For each of SPY 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C, QQQ 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68, NVDA 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC and AAPL 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9:
- `cast storage <token> 0xa3f0ad74e5423aebfd80d3ef4346578335a9a72aeaee59ff6cb3582b35133d50` (the ERC-1967 beacon slot) returned 0x...e10b6f6b275de231345c20d14ab812db62151b00.
- `cast call <token> 'ACCESS_CONTROLLED_REGISTRY()(address)'` returned 0xe10b6f6B275de231345c20D14Ab812db62151b00, the same address.
- `paused()(bool)`, `tokenPaused()(bool)` and `oraclePaused()(bool)` returned false; `decimals()(uint8)` returned 18.
- `uid()(bytes32)`: SPY 0x000000000000000000000000000000001c6f27a62789417d8ed359ed3c2d3da1, QQQ ...2470b933c52d47ccad017ed9ee80c9ed, NVDA ...915f477416294f5099a5e0e09f327ce5, AAPL ...c2425be3658540dd8e2424cbf3c5c649.
- `uiMultiplier()(uint256)` equals `newUIMultiplier()(uint256)` on each token (SPY 1001717991187472003). `effectiveAt()(uint256)`: SPY 1789690233, QQQ 1790035834, NVDA 1788998430, AAPL 1786720366, all in the past.

E6. Multiplier events. `cast keccak 'UIMultiplierUpdated(uint256,uint256,uint256)'` returned 0x2205df4534432b2f60654a3fdb48737ffdaf3e9edb1a498bd985bc026b15b055. eth_getLogs on the public RPC for each token with that topic, in 10,000,000-block windows from 0 to 78,329,847 (15:15), with block times from eth_getBlockByNumber. One event per token:

| Token | Block | Logged, New York time | effectiveAt, New York time | Notice | Change |
| --- | --- | --- | --- | --- | --- |
| AAPL | 36,345,344 | Fri 14 Aug 11:03:06 | 11:12:46 | 580 s | +5.66 bps |
| NVDA | 58,952,659 | Wed 9 Sep 19:50:42 | 20:00:30 | 588 s | +7.75 bps |
| SPY | 65,779,981 | Thu 17 Sep 20:00:49 | 20:10:33 | 584 s | +17.18 bps |
| QQQ | 69,210,998 | Mon 21 Sep 20:00:50 | 20:10:34 | 584 s | +7.01 bps |

First feed round after effectiveAt, from E3: SPY round 138 at Fri 18 Sep 08:22:01 (731.5 minutes later), QQQ round 366 at Tue 22 Sep 09:52:32 (822.0 minutes), NVDA round 1010 at Thu 10 Sep 07:51:02 (710.5 minutes), AAPL round 463 at Sun 16 Aug 20:00:49 (3,408.1 minutes). Rounds before each change are round numbers (SPY round 137: 76285845000) and rounds after are not (SPY round 138: 76155079369).

E7. Pause events. `cast keccak` of `OraclePaused()`, `OracleUnpaused()`, `Paused()` and `Unpaused()` gave 0xe28b7053f432ae5400c6168140cbe15638399715519a0a39b16b505fb9fc9d9a, 0xa274116fec684497d55e11cc9516edaa8d206c8b5f84c4603e32572c37f8e6dd, 0x9e87fac88ff661f02d44f95383c817fece4bce600a3dab7a54406878b965e752 and 0xa45f47fdea8a1efdd9029a5691c7f759c32b7c698632b563573e155625d16933. One eth_getLogs per topic per 10,000,000-block window on each token, 0 to 78,331,148 (15:19): no logs on any of the four tokens.

E8. Public RPC history limits.
- eth_getLogs from 0x0 to latest returned `"query spans 78329651 blocks (0 to 78329650), but only 10000000 are allowed for this request; narrow the block range"`.
- With four topic values in one position: `"only 100000 are allowed for this request; narrow the block range, or send one value per position"`.
- `cast receipt --rpc-url <public> 0x6d72ca599d812b9eb483fa82ba204e6d079e981b675669c9b659b7fac8adff35 blockNumber` returned `36345344` (a receipt from 14 August).
- `cast call --rpc-url <public> --block 36345344 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9 'uiMultiplier()(uint256)'` returned `historical state b711f4bdc2df8bc7f8890b5e49fa8763692fdb4d8baa717a49c6a1dc1f45b838 is not available` (15:20).

E9. State on 1 July through dRPC. `cast find-block --rpc-url <public> 1782864000` returned `653327`, and that block's timestamp is 1782864000, 2026-07-01T00:00:00Z. At 15:21: `cast call --rpc-url https://robinhood.drpc.org --block 653327 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 'totalSupply()(uint256)'` returned 96310200324991; SPY feed `latestRoundData()` at that block returned answer 74604570000 and updatedAt 1782835280; `cast code --rpc-url https://robinhood.drpc.org --block 653327 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3` (the NVDA fee-500 pool) returned 0x.

E10. Pool creation dates. Creation blocks from docs/research/pools.md, times by `cast block --rpc-url <public> <n> -f timestamp`: 15,511,376 is 2026-07-21 11:02 UTC (NVDA fee 500, 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3); 20,889,404 is 2026-07-27 16:51 UTC (AAPL fee 500, 0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D); 34,839,529 is 2026-08-12 21:07 UTC (SPY fee 500, 0xa7Bb1AC63BBaB0C44316E6c8C455213441689167); 47,501,593 is 2026-08-27 14:07 UTC (QQQ fee 500, 0xD60A5d14dB690B7Afad71F76B108071D7175597d). The earliest USDG v3 pool for any launch ticker in pools.md is QQQ fee 3000 at block 1,672,833.

E11. Direct pools at block 78,336,618 (15:25:27). `cast call 0x1f7d7550b1b028f7571e69a784071f0205fd2efa 'getPool(address,address,uint24)(address)' 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168 <token> 500`, then `balanceOf(pool)` on USDG and the token:

| Ticker | Fee-500 pool | USDG held | Token held |
| --- | --- | --- | --- |
| SPY | 0xa7Bb1AC63BBaB0C44316E6c8C455213441689167 | 216,409.89 | 184.8106 |
| QQQ | 0xD60A5d14dB690B7Afad71F76B108071D7175597d | 688,679.63 | 743.4581 |
| NVDA | 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3 | 2,124,717.54 | 3,413.0504 |
| AAPL | 0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D | 126,073.38 | 642.9731 |

E12. Gas and ETH price at block 78,345,656 (15:40:36). `cast gas-price` returned 31818000 and `cast base-fee` 32342000. `cast call 0x78F3556b67E17Df817D51Ef5a990cDaF09E8d3A9 'latestRoundData()(uint80,int256,uint256,uint256,uint80)'` returned answer 270324173021 (2,703.24 USD at 8 decimals) with updatedAt 1790952915.

E13. SwapRouter02 single-hop gas, 15:57. `cast receipt --rpc-url <public> 0xb72137045869a44c7d181189d07be216e945600833d887810f5316413a6fea0b gasUsed` returned 160300 (block 78,344,781) and the same for 0xdb238ea2264320879137e10786657d7781b75c99b47efa8b9146783812545aa3 returned 166134 (block 78,342,295). Both `cast tx ... to` return 0xCaf681a66D020601342297493863E78C959E5cb2, both inputs start 0x04e45aaf, which `cast sig 'exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))'` confirms, and each emits one Swap log on the NVDA fee-500 pool.

E14. Issuer assets API. `curl -s https://api.robinhood.com/rhj/assets` at 15:24:16 returned HTTP 200, 162,103 bytes, 194 assets. No asset has an allDayTradability key. SPY, QQQ, NVDA and AAPL each return `"tradingCapabilities": {"market": {"whole": "TRADING_STATUS_TRADABLE", "fractional": "TRADING_STATUS_TRADABLE"}, "extended": {"whole": "TRADING_STATUS_TRADABLE", "fractional": "TRADING_STATUS_TRADABLE"}, "overnight": {"whole": "TRADING_STATUS_TRADABLE", "fractional": "TRADING_STATUS_TRADABLE"}}`. SPY's id is 0x000000000000000000000000000000001c6f27a62789417d8ed359ed3c2d3da1. The docs page https://docs.robinhood.com/chain/stock-token-apis, fetched at 15:07, defines allDayTradability as "RH all-day / overnight (24/5) trading flag for the underlier."

E15. USDG at 15:39 to 15:40 against 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168: `PERMIT_TYPEHASH()(bytes32)` returned 0x6e71edae12b1b97f4d1f60370fef10105fa2faae0126114a169c64845d6126c9, equal to `cast keccak 'Permit(address owner,address spender,uint256 value,uint256 nonce,uint256 deadline)'`. `TRANSFER_WITH_AUTHORIZATION_TYPEHASH()(bytes32)` returned 0x7c7c6cdb67a18743f49ec6fa9b35f50d52ed05cbed4cc592e13b44501c1a2267, equal to `cast keccak 'TransferWithAuthorization(address from,address to,uint256 value,uint256 validAfter,uint256 validBefore,bytes32 nonce)'`. `DOMAIN_SEPARATOR()(bytes32)` returned 0x7a3d7400b27830f4f91c2c16a082486d67c1befecaec2f53b33f1f35d5b62036, `nonces(address)(uint256)` for 0x...01 returned 0, and `decimals()(uint8)` returned 6.

E16. Issuer FAQ. `curl -sL https://docs.robinhood.com/rhj/faq` at 15:23:08: "You can also redeem them directly with the Issuer, where there is no authorized participant (a firm that processes redemptions on investors' behalf), subject to completing the Issuer's KYC/AML (identity verification) processes."

E17. Kernel v3.1 uninstall. `curl -s https://raw.githubusercontent.com/zerodevapp/kernel/v3.1/src/utils/ModuleLib.sol` at 15:22:08: "(result,) = ExcessivelySafeCall.excessivelySafeCall(" followed by "emit ModuleUninstallResult(module, result);". src/core/ExecutorManager.sol at the same tag, lines 46 to 52, calls ModuleLib.uninstallModule and then emits ModuleUninstalled. docs/GATES.md records v3.1 as the version ZeroDev deploys on 4663.

E18. Chainlink market hours. `curl -s https://raw.githubusercontent.com/smartcontractkit/documentation/main/src/content/data-streams/market-hours.mdx` at 15:23:42. The row for "24/5 US Equities and ETFs" reads weekly open "20:00 Sun", weekly close "20:00 Fri", daily breaks "None", bank holidays "NYSE holiday calendar".

E19. Robinhood chain docs fetched at 15:07. https://docs.robinhood.com/chain/oracles-and-price-feeds: "The flag is advisory and not enforced on-chain, so a paused oracle may still return a value". https://docs.robinhood.com/chain/building-with-stock-tokens: "Before any update is scheduled this tracks the current multiplier."

E20. Time conversions with Python's zoneinfo (America/New_York, Asia/Singapore, Africa/Lagos): Friday 2 October 20:00 New York is 2026-10-03T00:00:00Z (1790985600); Sunday 4 October 20:00 New York is 2026-10-05T00:00:00Z (1791158400); 23:59 SGT on 4 October is 2026-10-04T15:59:00Z (1791129540); 17:00 Lagos on 3 October is 2026-10-03T16:00:00Z. The reopen is 8.0167 hours after the deadline.

E21. Vendored OpenZeppelin. contracts/lib/openzeppelin-contracts/package.json has `"version": "5.4.0"`, and `find` lists contracts/interfaces/draft-IERC7579.sol and contracts/account/utils/draft-ERC7579Utils.sol.

E22. The pool cited by PRD S24, 15:25. `cast call <public> 0xae1685599288831eb0844cb59058116ee3184b9a 'token0()(address)'` returned USDG, `'token1()(address)'` returned 0xE1E5f00A9B0255ca4dF85B3130eE0F77d15acC2D, and `'fee()(uint24)'` returned 10000. That token's `name()(string)` starts "Pushin'", and its address appears in no deployment of the issuer's assets API (E14).

E23. Explorer access. `curl -s -A '<browser user agent>' 'https://robinhoodchain.blockscout.com/api?module=contract&action=getsourcecode&address=0x117cc2133c37B721F49dE2A7a74833232B3B4C0C'` at about 15:10 returned an HTML page titled "Just a moment...", a Cloudflare browser check, instead of JSON.
