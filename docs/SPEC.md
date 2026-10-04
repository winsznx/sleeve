# Sleeve M0 contract spec

Status: draft 3, 3 October 2026, as built through component 6 (sell-back) and the audit round 1 fixes (docs/audit/AUDIT_R1.md). That is the code deployed on 3 October 2026 (docs/DEPLOYMENTS.md): contracts/src has not changed since the audit integration, commit ddadac9. Source of truth for the keeper, the verifier, the app and the deploy script. The PRD (internal/Sleeve-PRD-v1.4.md) wins on any conflict. Engineering choices cite docs/DECISIONS.md. Items marked B2-n follow the recommended default of batch 2 item n, adopted by D-014; the code keeps each one a constant or a small branch so an override is cheap. Deploying the module as built settled the owner questions this draft had marked pending (D-028), and the sections below say so. Items still marked "pending the owner" describe what is built while the owner decides, and DECISIONS or AUDIT_R1 states the question.

## 1. Contracts

| Contract | Kind | Admin | Holds funds |
| --- | --- | --- | --- |
| LedgerMath | library, pure | none | no |
| SessionCalendar | library, pure, 2026 and 2027 | none | no |
| SessionCalendarExtension | contract, later years and in-range closures (B2-9) | the SleeveTimelock TokenSource uses | no |
| PriceGuard | library, view | none | no |
| TokenSource | contract: launch tickers, feeds, session types, pool allowlist, removals | the SleeveTimelock the calendar uses | no |
| SleeveModule | ERC-7579 executor, module type 2, not upgradeable | none | no: no call changes its USDG or stock token balance (I1 as a delta, D-026) |
| SleeveTrade, SleeveBuy, SleeveSell | external libraries the module reaches by DELEGATECALL, working on its storage (D-019): observe, split, settle, release, the reconcile and the previews; the buy; sell and reconcileLots. The deploy links SleeveTrade into SleeveSell as well as into the module | none | no |
| SleeveState, SleeveReceipts | internal libraries: storage, brackets, the per-account lock, lots and the receipt log | none | no |
| SleeveTimelock | OpenZeppelin v5.4 TimelockController with its delay held between 172,800 seconds and 30 days, no admin role holder, and at least one proposer and one executor, none of them zero (D-018, D-019, audit A1-26) | DEPLOYER proposes, executes and cancels (D-009 Q33) | no |

## 2. Chain facts the code depends on

From docs/research/chain-constants.md and pools.md. Every one is asserted in a fork test.

- USDG 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168: 6 decimals, UUPS proxy, has its own pause and an address freeze (isFrozen). A frozen account cannot move USDG, which Sleeve cannot prevent (PRD 9 failure table).
- Stock tokens: 18 decimals, BeaconProxy, beacon is the AccessControlsRegistry 0xe10b6f6B275de231345c20D14Ab812db62151b00. Views used: `paused()` (token flag or registry pause), `oraclePaused()`, `uiMultiplier()`, `newUIMultiplier()`, `effectiveAt()`, `uid()` (bytes32), `ACCESS_CONTROLLED_REGISTRY()`. Registry: `isBlocked(address)`. Transfers check sender and recipient, so the pool must be unblocked too (D-011), and approve and transferFrom check the router.
- Feeds: 8 decimals, read through the proxy (aggregators are access controlled). Stock feeds have a 24-hour heartbeat and a 0.5 percent trigger, stop between the Friday close and the Sunday 20:00 New York reopen, and post a round within about a minute of each reopen. A round's startedAt is when it was observed: the reopen rounds read in the audit (SPY round 147, NVDA round 1107) were observed 12 seconds before their updatedAt, so a round observed before an opening and transmitted after it carries the closed market's answer (audit A1-10). The USDG/USD feed runs on crypto hours with a 24-hour heartbeat and is routinely 23 to 24 hours old.
- Multiplier changes so far were scheduled about 10 minutes ahead, 5.66 to 17.18 bps each.
- v3 fee tiers: 100, 500, 3000, 10000 only. Launch pools in D-010.
- `block.number` is the L1 estimate. Receipts use `ArbSys(0x64).arbBlockNumber()`. Forge cannot run ArbSys, so tests etch a mock (contracts/test/utils/ForkBase.sol).

## 3. TokenSource

The constructor lists SPY, QQQ, NVDA and AAPL (ids 0 to 3): token, feed, session type ALL_DAY (B2-1) and the D-010 pools. It checks code at every address, USDG at 6 decimals, each token at 18 and each feed at 8, no token twice, session type NONE exactly when a ticker has no feed (`SessionTypeMismatch`), and at least one pool for a ticker with a feed (`NoPools`, audit A1-18). A pool is accepted, in the constructor and in `setPool`, when `IUniswapV3Factory(V3_FACTORY).getPool(USDG, token, pool.fee()) == pool` (`PoolNotCanonical`) and the fee is 100, 500 or 3000 (`FeeNotAllowed`).

Timelock-only functions (B2-8), each emitting an event:

- `removeTicker(uint8 id)`: one way (`TickerAlreadyRemoved`). No add function exists (I10 reads "cannot add a ticker").
- `setPool(uint8 id, address pool, bool allowed)`: adds a canonical pool or removes an allowlisted one. Removing an active ticker's last pool reverts `LastPoolOfActiveTicker`, so a rotation is one scheduleBatch that adds before it removes (audit A1-18, D-026).

Views: `ticker(id)` (token, feed, sessionType, active), `tickerCount()`, `isPoolAllowed(id, pool)`, `poolsOf(id)`, `idOf(token)`, `timelock()`, `usdg()`, `v3Factory()`. A removed ticker keeps its pools, so its lots still sell through Sleeve. The timelock may still empty a removed ticker's list, and after that its lots no longer sell through Sleeve; the owner moves those tokens outside it.

## 4. PriceGuard library

As built in component 3 and amended by audit round 1 (contracts/src/libraries/PriceGuard.sol), internal functions inlined into the module. Market conditions come back as a Reason; malformed input reverts with a named error.

- `checkBuy(token, feed, usdgUsdFeed, account, pool, sessionOpen, sessionOpenedAt, params) -> BuyCheck{accountBlocked, reason, roundId, answer, updatedAt, usdgRoundId, usdgAnswer}`: PRD 7.4 steps 2 to 7 in order, first failure wins: account block, pool block (reverts `PoolBlocked`), PAUSED, ORACLE_PAUSED, SESSION (from the module's flag), MULTIPLIER, STALE, DEPEG. The module checks `accountBlocked` before `reason`: a blocked account returns `accountBlocked = true` with reason NONE and must become REFUSED_ACCOUNT, never a swap.
- `checkToken(token, account, pool) -> (accountBlocked, reason)`: registry read through `token.ACCESS_CONTROLLED_REGISTRY()` on every call; 18 decimals asserted.
- `checkMultiplier(token, window) -> reason`: MULTIPLIER when `newUIMultiplier() != uiMultiplier()` and `now < effectiveAt() <= now + window` (24 hours). No after-clause.
- `readStockFeed(feed, maxAge, sessionOpenedAt) -> (reason, roundId, answer, updatedAt)`: 8 decimals asserted; STALE when the answer is not positive, updatedAt is after now, `now - updatedAt > maxAge` (25 hours), or the round was observed (startedAt) or transmitted (updatedAt) before the session's opening instant (B2-2, audit A1-10). A round observed and transmitted at the opening second or later passes. Receipts keep updatedAt; the verifier reads startedAt with `getRoundData(roundId)`.
- `checkUsdg(usdgUsdFeed, toleranceBps, maxAge) -> (reason, roundId, answer)`: DEPEG outside 1.0 plus or minus 50 bps at the feed's decimals, or older than 25 hours, from the future, or not positive. Both edges pass.
- `exceedsPremium(usdgSpent, tokensOut, answer, capBps, usdgDecimals, tokenDecimals, feedDecimals)` and `exceedsDiscount(usdgOut, tokensIn, answer, capBps, ...)`: exact 512-bit comparisons, equality passes. Both price USDG at par: the USDG/USD answer gates DEPEG and nothing else (D-026, audit A1-11). The module reads each decimals value from its own contract and asserts 6, 18 and 8 before calling them, because swapped arguments would silently loosen the cap.
- `execPriceBuy` (rounded up), `execPriceSell` (rounded down), `premiumBps` and `discountBps` (ceiling of the exact value) for receipts, in USDG base units per 1e18 token units and signed basis points. premiumBps is positive when a buy paid more than the feed price and discountBps is positive when a sale received less, so both round against the owner and a receipt never shows more than the cap of a fill that stood.
- `defaultGuardParams()`: stock feed 25 hours, USDG feed 25 hours, 50 bps, 24-hour multiplier window (D-014).
- contracts/test/fixtures/premium_vectors.json (1,890 decision and 365 receipt vectors from scripts/premium_vectors.py) pins these for the module, the verifier and the replay.

## 5. SleeveModule state

```
Account {
  bool installed;
  uint128 spend;           // spend ledger
  uint128 pendingTotal;    // sum of buckets
  address keeper;          // per account, set at install, owner can change (B2-7)
  uint64 observedAt;       // public-trigger clock (D-025)
  uint128 observedUnsorted;
  Rule rule;
}
Rule {
  uint32 version; RuleStatus status;   // NONE, ACTIVE, PAUSED
  uint16 equityBps; uint8 tickerId;    // one leg in M0
  uint16 premiumCapBps;                // default 100, owner range 0 to 500 (B2-5)
  uint16 slippageBps;                  // default 50, owner range 0 to 500
  uint128 minClip;                     // default 25e6, at least 1e6
}
Bucket[account][tickerId] { uint128 amount; uint64 since; uint8 reason; }
```

Global: `nextReceiptId`, `receiptHash[id]`, `lots[id]`, `lotIds[account][tickerId]` with a head index for oldest-first sells, and each account's last rule version, kept across uninstall and reinstall (D-019). Immutables: USDG, TokenSource, SessionCalendarExtension, SwapRouter02, USDG/USD feed, default keeper, disclosure hash (B2-10), grace 3,600 s, stock feed max age 90,000 s, USDG feed max age 90,000 s, depeg tolerance 50 bps, multiplier window 86,400 s.

The constructor checks, because the module is immutable (D-019): code at every address; USDG at 6 decimals and the USDG/USD feed at 8; the calendar answers `version()`; TokenSource lists pools against the same USDG; the router's `factory()` is TokenSource's `v3Factory()`; TokenSource and the calendar answer to the same timelock, which has more code than an EIP-7702 designator, reports `MIN_DELAY_FLOOR` as 172,800 and has a delay at or above it (`TimelockMismatch`, `TimelockNotSleeve`, audit A1-26, D-026); a non-zero default keeper and disclosure hash; guard parameters equal to `PriceGuard.defaultGuardParams()`; and a grace of 3,600 seconds.

Reentrancy: one transient lock per account instead of a module-wide ReentrancyGuardTransient (audit A1-21, D-026, kept at the deploy, D-028). Owner functions lock msg.sender, and observe, split and settle lock their account argument. A second entry for the same account in the same call stack reverts `AccountLocked(account)`, while calls for other accounts go through. executeBuy takes no lock: only the module calls it, from inside split and settle.

## 6. Install, uninstall, rules

- `onInstall(bytes data)`: caller is the account. Buckets left by a failed onUninstall go to spend first with RELEASED receipts. Then the state is overwritten with a fresh snapshot (D-009 Q20, D-019): `spend = USDG.balanceOf(account)`, nothing unsorted (I5), the keeper set, no observation, no rule. `data` is empty or `abi.encode(keeper, RuleInput)`, 224 bytes, else `InvalidInstallData`; a zero keeper means the default keeper, an all-zero rule means status NONE, and any other rule must pass the setRule checks. An open owner bracket restarts from the snapshot. Emits `Installed`, and `RuleSet` when a rule comes with it.
- `onUninstall(bytes)`: reverts `NotInstalled` for an account that never installed, and `ModuleStillListed` while the account still lists the module as an executor, as after an uninstallModule of type 4, 5 or 6 or a direct call, keeping the state (audit A1-24, D-026). Otherwise it releases each non-empty bucket with a RELEASED receipt, trigger OWNER, and deletes ledgers, rule, keeper and observation. Receipts, lots and the rule version counter stay. Emits `Uninstalled`. Kernel v3.1 removes the executor, then calls onUninstall with whatever gas is left and ignores a failure, so a release can run out of gas: the app sends uninstall ops with a fixed callGasLimit of 450,000 to 500,000, above D-019's 400,000 floor and never the bundler's estimate, checks ModuleUninstallResult, and a second uninstall or the next install recovers a skipped release (D-019, audit A1-07).
- `setRule(RuleInput)`, `pauseRule()`, `resumeRule()`, `setKeeper(address)`: caller is the installed account. setRule takes spendBps and equityBps and checks, in order, `LedgerMath.validateShares(spendBps, equityBps)` (I9), a ticker that is listed, active and has a feed and a session (`TickerNotListed`, `TickerNotActive`, `TickerHasNoFeed`, `TickerHasNoSession`), and the B2-5 ranges (`PremiumCapAboveMax`, `SlippageAboveMax`, `MinClipBelowFloor`), then writes the account's next version and ACTIVE. pauseRule and resumeRule revert `NoRule` without a rule, and `RuleNotActive` or `RuleNotPaused` when there is nothing to change. setKeeper takes any address; zero leaves owner and public triggers.
- Paused or unset rule (B2-6): split and settle revert `RuleNotActive`. New USDG stays unsorted and spendable; at resume it is split by the resumed rule. release, sell and reconcileLots work whatever the rule's status.

## 7. Owner-batch brackets

- `beginOwnerOp()`: caller is an installed account. Reverts `OwnerOpAlreadyOpen` if open. Transient slots per account: balance at begin plus one, module delta zero.
- `endOwnerOp()`: `OwnerOpNotOpen` without an open bracket, or `NotInstalled` when the caller has neither a bracket nor the module. If the account uninstalled inside the bracket, clear the slots and return. Otherwise `ownerDelta = balanceNow - balanceAtBegin - moduleDelta`.
  - Positive: when spend + pendingTotal exceed the virtual balance `balanceAtBegin + moduleDelta`, an outside pull is not booked yet, so it is reconciled there first, spend and then the buckets in ascending ticker id, with a RECONCILED receipt (trigger OWNER) and the Reconciled event (audit I-01, D-026). Then spend += ownerDelta (I6).
  - Negative: `LedgerMath.allocateOutflow` over spend, then unsorted computed from the virtual balance, then the buckets in ascending ticker id. The observed level drops to the unsorted USDG left (section 8).
  - Emits one `OwnerOpEnded` per closed bracket, inflow or outflow, with the per-bucket amounts (D-019).
- Inside an open bracket every module action that moves the account's USDG adds its net change to the module delta, and split, settle and sell compute unsorted and any shortfall from the virtual balance (D-009 Q13).

## 8. Triggers, the observation and grace

Trigger type: OWNER when `msg.sender == account`, KEEPER when `msg.sender` is the account's non-zero keeper, PUBLIC otherwise. Keeper and public triggers revert `OwnerOpOpen` while the account's bracket is open (D-019). PAYLINK is M1. D-025 replaces D-009 Q15 and Q16 for everything in this section.

- Coverage: an observation covers an unsorted amount when `observedAt != 0` and `unsorted < observedUnsorted + 1 USDG` (OBSERVE_RESTART_GROWTH, 1e6 base units). observe, the public split and previewSplit apply this one rule (audit S-01).
- `observe(account)`: anyone. Reverts `NotInstalled`, and `NothingWaiting` when unsorted and the buckets are empty. While the running observation covers unsorted it keeps observedAt and lowers observedUnsorted to unsorted when unsorted is smaller. Otherwise it stores `observedAt = now` and `observedUnsorted = unsorted` and emits `Observed`. Growth under 1 USDG rides the running clock, so dust cannot postpone the public fallback, and each restart costs 1 USDG, which becomes the owner's income (audit A1-05).
- PUBLIC split: needs an observation that covers unsorted and `now >= observedAt + 3,600`, else `GracePeriodActive(readyAt)`, where readyAt is the observation plus the grace, or now plus the grace when observe must run first. The check comes before the split looks at unsorted, so a public split that would only reconcile needs an observation too.
- Every split that sorts clears the observation, whatever its trigger, so the next payment waits out a grace of its own. A split that only reconciles keeps observedAt and drops observedUnsorted to zero, and a split with nothing to do changes nothing. An owner outflow lowers observedUnsorted to the unsorted USDG left (audit A1-25).
- PUBLIC settle: needs `now >= max(bucket.since, sessionOpenedAt) + 3,600` while the ticker's session is open, and `now >= bucket.since + 3,600` while it is closed. It needs no observation, and settle never changes one, so no split, observe or other settle moves a bucket's clock. The keeper keeps the first hour after every reopen (D-017, audit A1-05).
- Residuals (D-025): income of 1 USDG or more arriving at least hourly keeps the public split shut while the keeper is down, since each payment needs its own observation and hour, and a stranger can postpone the public split at 1 USDG per restart. Owner triggers and release never wait. Up to 1 USDG of later income can be sorted on an older clock.

## 9. split(account, pool, quote)

1. The account installed, the trigger (section 8), `OwnerOpOpen`, the rule ACTIVE (`RuleNotActive`), a non-zero quote (`ZeroQuote`), and the account still listing the module (`ModuleNotListed`, D-019). Then a PUBLIC trigger's grace.
2. Balance (virtual inside a bracket). If below spend + pendingTotal, reconcile spend first, then the buckets in ascending ticker id, with a RECONCILED receipt and the Reconciled event (D-009 Q4). Nothing is unsorted after it, so the split ends there and returns that receipt.
3. `unsorted = balance - spend - pendingTotal`; zero returns 0 with no receipt.
4. `(spendPart, equityPart) = LedgerMath.splitShares(unsorted, rule.equityBps)`; spend += spendPart. A zero equity part, from a rule with equityBps 0 or from dust, writes QUEUED with reason CLIP, usdgToEquity 0 and nothing queued, without running the guard (PRD 9 applied to a zero part, audit A1-14). Readers key on `usdgToEquity == 0` and show it as sorted to spend. An ACTIVE rule may invest nothing, as deployed (D-028).
5. Guard on the rule's ticker, first failure wins:
   1. The ticker active, with a feed and a non-empty pool allowlist: else REFUSED_TICKER, equity to spend. A trigger's pool off a non-empty allowlist reverts `PoolNotAllowed`, so a public caller cannot push equity into spend with a junk pool. PRD 7.4 step 1 reads REFUSED_TICKER for that case, and the deploy kept the revert (audit A1-17, D-028). Under the A1-18 rule an active ticker always has a pool.
   2. The account not blocked: else REFUSED_ACCOUNT, equity to spend. A blocked pool reverts `PoolBlocked`; a blocked account wins over a blocked pool.
   3. PAUSED, ORACLE_PAUSED.
   4. SESSION: calendar closed for the ticker's session type, or timestamp outside coverage.
   5. MULTIPLIER (B2-4).
   6. STALE: the answer, the age, and the fresh round after a reopen by startedAt and updatedAt (B2-2, section 4).
   7. DEPEG (B2-3).
   8. CLIP: `equityPart < rule.minClip` (D-009 Q12, Q22).
   9. The buy through executeBuy (section 11). The module's own PremiumAboveCap gives PREMIUM, with the undone swap's premium on the receipt; any other failure reverts everything and nothing moves.
6. Guard steps 3 to 8 failing, and PREMIUM, add equityPart to the ticker's bucket, setting `since` when the bucket was empty and the bucket's reason to this one. A buy spends only the split's own equity part, never the bucket with it (D-009 Q22; the deploy kept them apart, audit A1-15, D-028).
7. One receipt: FILLED, QUEUED(reason), REFUSED_TICKER or REFUSED_ACCOUNT. FILLED creates a lot. I2: `usdgIn == usdgToSpend + usdgSpent + usdgQueued`. The observation is then cleared (section 8).

## 10. settle(account, tickerId, pool, quote) and release(tickerId)

settle acts on a whole bucket at the current rule's caps (D-009 Q24). Its checks run in this order, and a failing one reverts with nothing moved unless it says otherwise:

1. As split's step 1, without the grace.
2. `LedgersAboveBalance(account, shortfall)` while spend + pendingTotal exceed the balance, virtual inside a bracket: an outside pull is not reconciled yet, and in PRD 7.2's order it may own part of the bucket. A split reconciles first (audit I-02, D-026).
3. An empty bucket reverts `BelowClip(0, minClip)`.
4. The guard runs, guard steps 1 to 7 as in split, with the same `PoolNotAllowed` and `PoolBlocked` reverts.
5. Unless guard step 1 or 2 refused the bucket, a bucket below the current rule's minClip reverts `BelowClip(amount, minClip)`. A refused bucket goes on at any size (audit A1-31).
6. A PUBLIC trigger waits for the grace of section 8 (`GracePeriodActive`).
7. Guard steps 3 to 7 failing revert `GuardNotClear(reason)`, so the keeper learns to wait from a simulation.
8. Guard step 1 or 2 failing sends the whole bucket to spend with REFUSED_TICKER or REFUSED_ACCOUNT. Otherwise the buy runs (section 11), and the module's own PremiumAboveCap reverts `GuardNotClear(PREMIUM)`. A fill empties the bucket, writes SETTLED with the bucket's reason, `queuedSince` and the current rule version, and creates a lot.

settle never changes the observation. `bucket.reason` is the reason of the latest QUEUED receipt into the bucket and settle never rewrites it (audit A1-32), so the PRD 7.4 five-day prompt comes from the keeper, which records the reason, when it was first seen and when it was last seen per account and ticker from its settle simulations.

`release(tickerId)`: caller is the account. The whole bucket goes to spend with a RELEASED receipt carrying the bucket's reason and since. No guard runs and no token or feed is read, so the rule may be paused or unset and the issuer's contracts cannot block it (I11). `EmptyBucket` for an empty bucket.

## 11. Buy and sell execution

Venue 1: Uniswap v3 SwapRouter02, single hop, allowlisted pool. Through `executeFromExecutor` on the account, one batch with fixed targets and selectors (D-019):

1. `USDG.approve(router, amountIn)`
2. `router.exactInputSingle({tokenIn, tokenOut, fee: pool.fee(), recipient: account, amountIn, amountOutMinimum: 0, sqrtPriceLimitX96: 0})`
3. `USDG.approve(router, 0)`

The router gets no minimum of its own. The trigger's minimum is the module's check after the premium cap, so a fill that fails both queues PREMIUM in PRD 7.4's order (audit A1-12, D-026). `minOut = amountIn * quote / 1e6 * (10_000 - slippageBps) / 10_000` (D-009 Q21); a quote whose product with amountIn would overflow that arithmetic reverts `QuoteTooLarge` (audit A1-37).

`executeBuy` is external and accepts only `msg.sender == address(this)` (`NotSelf`). It reads the module's own USDG and token balances and the account's and the pool's balances before and after the batch, then checks in this order, where any failure undoes the swap:

1. The batch: a revert carrying the PremiumAboveCap selector becomes `BatchReverted(reason)`, so only the module's own check can make split queue PREMIUM (audit A1-19); any other revert bubbles.
2. USDG spent equals amountIn (`PartialFill`), and tokens arrived (`TooFewTokens(0, minOut)`, I3).
3. The pool gained exactly the USDG the account spent and lost exactly the tokens it received (`FillNotFromPool`, audit A1-23).
4. The allowance is zero (`AllowanceNotReset`, I4).
5. The module's USDG and token balances did not change (`ModuleHoldsFunds`). I1 is checked as this delta, because anyone can send the module a balance it can neither refuse nor return, and an absolute check let one base unit block every buy (audit A1-01). PRD I1 still reads "holds no USDG and no stock tokens before or after any call"; the deploy settled I1 as this delta (D-026, D-028).
6. The three decimals, read from their contracts and asserted 6, 18 and 8 (`UnexpectedDecimals`).
7. `PremiumAboveCap(premiumBps)` when exceedsPremium holds for the rule's cap and the round the guard read.
8. `TooFewTokens(tokensOut, minOut)` below minOut.

split catches only a 36-byte PremiumAboveCap from executeBuy itself and queues PREMIUM; settle turns it into `GuardNotClear(PREMIUM)`. The outer entry point holds the account's lock (section 5). Sells mirror this with the token as input (section 12).

## 12. sell(tickerId, tokenAmount, lotId, pool, quote, overrideClosed, overrideCapBps)

Caller is the account, normally inside an owner bracket. The account's lock is held, and the rule may be paused or unset. Returns the id of the receipt for the oldest lot the sell took from; a RECONCILED receipt from step 6 comes before it. D-027 records the choices in this section.

Checks, in this order, each a revert with nothing moved:

1. `NotInstalled`, `ZeroAmount`, `ZeroQuote`, `OverrideCapOutOfRange` unless overrideCapBps is 0 or between the rule's premiumCapBps and 500 (B2-14), then `ModuleNotListed`.
2. The lots. `lotId != 0`: that lot only, which must exist (`UnknownLot`), be the caller's and the ticker's (`LotMismatch`) and hold the amount (`ExceedsLots`). `lotId == 0`: the caller's lots of the ticker from the queue's head, oldest first, skipping empty lots, until the amount is covered. `ExceedsLots(tokenAmount, lotTokens)` when they cannot cover it, and `TooManyLots(sellableTokens, 100)` when it would take from more than 100 lots, where sellableTokens is what the first 100 cover (audit A1-13). Tokens outside lots are not sellable through Sleeve in M0 (D-009 Q30).
3. `QuoteTooLarge`, `TickerHasNoFeed`, and `PoolNotAllowed` unless the pool is on the ticker's allowlist. A removed ticker keeps its pools, so its lots still sell (section 3).
4. `ExceedsBalance(tokenAmount, balance)` when the account holds fewer tokens of the ticker than asked though the lots cover the amount: tokens left outside Sleeve, and reconcileLots brings the lots down first (audit A1-03).
5. The guard mirrored from the buy, first failure wins:
   1. `AccountBlocked`, then `PoolBlocked`, then `RouterBlocked` when the registry blocks SwapRouter02, because the Stock Token's approve and transferFrom check it (audit A1-08).
   2. `GuardNotClear(PAUSED)`, `GuardNotClear(ORACLE_PAUSED)`, `GuardNotClear(MULTIPLIER)`, `GuardNotClear(DEPEG)`. The override skips none of these, and DEPEG keeps the USDG/USD round's 25-hour age limit.
   3. Without the override, `SellWaits(SESSION)` while the ticker's session is closed, then `SellWaits(STALE)` when the stock round fails readStockFeed (section 4). The app shows the sell as waiting with the reopen time (B2-13).

   With `overrideClosed` the session step and the stock round's age and fresh-round-after-reopen checks are skipped for this call only. The round must still have a positive answer and not come from the future, else `GuardNotClear(STALE)`. The steps the override cannot skip come first, so a sell that waits on SESSION or STALE is one the override can help, except for a broken round: `SellWaits(STALE)` without the override and `GuardNotClear(STALE)` with it. The app does not offer the override for an answer at or below zero or a round from the future.
6. An outside USDG pull the ledgers have not booked is reconciled at the sorting balance, with a RECONCILED receipt (trigger OWNER), before any token moves and before the proceeds land, so the proceeds never refill a bucket the pull emptied (PRD 7.2 order, audit I-03, D-026).
7. Each lot's tokensRemaining goes down by its part and the lot moves to PART_SOLD, or to SOLD when it is empty (section 14), and the queue's head moves past the empty lots at its front. Then one batch on the account: `token.approve(router, tokenAmount)`, `exactInputSingle` from the token to USDG with the account as recipient, amountOutMinimum 0 and sqrtPriceLimitX96 0, and `token.approve(router, 0)`.
8. Postconditions by balance, where any failure undoes everything: exactly tokenAmount left the account (`PartialFill`), USDG arrived (`TooLittleUsdg(0, minOut)`), the pool lost exactly that USDG and gained exactly those tokens (`FillNotFromPool`), the token allowance is zero (`AllowanceNotReset`), the module's balances did not change (`ModuleHoldsFunds`), the three decimals (`UnexpectedDecimals`), then `DiscountAboveCap(discountBps, capBps)` when `usdgOut * 10^(18 + 8 - 6) * 10_000 < tokenAmount * answer * (10_000 - capBps)`, then `TooLittleUsdg(usdgOut, minOut)` below minOut (audit A1-12).
9. The proceeds go to spend and into the open bracket's module delta, so they are never split (I6, audit A1-34). One PART_SOLD or SOLD receipt per lot (section 13).

Caps:

- The discount cap is the rule's premiumCapBps, or overrideCapBps when it is not zero (B2-14). overrideCapBps widens the cap with or without overrideClosed, and overrideClosed alone keeps the rule's cap. The deploy kept the two apart (D-027, D-028). Both go on every receipt of the sell.
- `minOut = tokenAmount * quote / 1e18 * (10_000 - slippageBps) / 10_000` with the rule's slippage cap (D-009 Q21).
- Without a rule both caps are zero, so a sell fills only at or above the feed price and at or above the quote, unless overrideCapBps widens the discount cap. Kept at the deploy (D-027, D-028).

`reconcileLots(tickerId)`: caller is the installed account (`NotInstalled`). When the caller's lots of the ticker, read from the head, hold more tokens than its balance, it trims tokensRemaining oldest first, the order sells take lots in, at most 100 lots per call (audit A1-03, A1-13). It writes one RECONCILED receipt per trimmed lot and emits `LotsReconciled(account, tickerId, balance, trimmed)`, never changes a status, moves the head past the empty lots at its front, and moves no tokens or USDG. It returns the first receipt's id, or 0 with no receipt when the lots fit the balance; a call that stopped at 100 lots returns an id, and the next call trims on. The bound limits the receipts per call. The sum over the lots from the head is read in full, so its gas still grows with the queue (D-027).

tokensRemaining is an upper bound on a lot's tokens in the account until reconcileLots runs, and tokens arriving from outside Sleeve can refill a phantom lot, the token side of PRD 7.2's WRAPPED limit (D-027). The app adds reconcileLots for every ticker with lots to the install op, and to every owner batch that moves a stock token, after the move and before any sell in the batch.

## 13. Receipts

Event `ReceiptWritten(uint256 indexed id, address indexed account, Status indexed status, Receipt r)` and `receiptHash[id] = keccak256(abi.encode(r))`. Ids global from 1 (D-009 Q25). SleeveReceipts fills id, account, mode, calendarVersion, disclosureHash, l2Block and timestamp on every receipt.

```
Receipt {
  uint256 id; address account; uint32 ruleVersion; Trigger trigger; address payer;
  Status status; Reason reason; AccountingMode mode;                 // WRAPPED
  uint8 tickerId; address token; bytes32 tokenUid;
  uint256 usdgIn; uint256 usdgToSpend; uint256 usdgToEquity; uint256 usdgSpent; uint256 usdgQueued;
  uint256 tokensIn; uint256 tokensOut; uint256 usdgOut;              // sells use tokensIn and usdgOut
  uint256 uiMultiplier; uint256 execPrice; int256 premiumBps;
  uint80 roundId; int256 answer; uint256 updatedAt;
  uint80 usdgRoundId; int256 usdgAnswer;
  uint256 quote; uint256 minOut; uint8 venueId; address pool;
  uint32 calendarVersion; bytes32 disclosureHash;
  uint256 l2Block; uint256 timestamp;
  uint256 lotId; uint64 queuedSince; bool overrideClosed; uint16 overrideCapBps;
}
```

Statuses: FILLED, QUEUED, SETTLED, REFUSED_TICKER, REFUSED_ACCOUNT, RELEASED, PART_SOLD, SOLD, RECONCILED. Reasons: NONE, PAUSED, ORACLE_PAUSED, SESSION, MULTIPLIER, STALE, DEPEG, CLIP, PREMIUM. Derived fields (transaction hash, passive senders, which inbound transfers a lot sorted) come from logs and are labeled derived.

What each receipt fills. Fields not named stay zero.

- Split receipts (FILLED, QUEUED, and REFUSED_TICKER or REFUSED_ACCOUNT from a split): usdgIn is the unsorted USDG sorted, usdgToSpend the spend part plus any refused equity part, usdgToEquity the equity part, and I2 holds: `usdgIn == usdgToSpend + usdgSpent + usdgQueued`. A QUEUED receipt with usdgToEquity 0 sorted everything to spend (section 9, step 4), so readers count a QUEUED receipt as waiting only when usdgQueued is above zero.
- Settle receipts (SETTLED, and the refusals a settle writes): usdgIn 0, usdgToEquity the bucket, queuedSince the bucket's since. SETTLED keeps the bucket's reason; a refusal puts the bucket in usdgToSpend.
- RELEASED: usdgToSpend the bucket, reason and queuedSince the bucket's, token from TokenSource, no market fields.
- The swap fields (quote, minOut, venueId 1, pool) are set exactly when a swap ran: FILLED, SETTLED, PART_SOLD, SOLD, and QUEUED with reason PREMIUM, whose swap was undone and whose premiumBps is that swap's.
- FILLED and SETTLED: usdgSpent and tokensOut measured by balance, execPrice rounded up, premiumBps, uiMultiplier and tokenUid at the fill, and lotId the receipt's own id.
- PART_SOLD and SOLD: one per lot a sell took from, in the order taken. tokensIn is the lot's part. usdgOut and usdgToSpend are its pro rata share of the proceeds, `usdgOut * part / tokenAmount` rounded down, with the last lot taking the remainder, so the shares sum to the USDG received. lotId is the lot. tokenUid and uiMultiplier are read from the token at the sale. execPrice, premiumBps, the rounds, quote, minOut, pool, overrideClosed and overrideCapBps are the whole sell's (D-027). premiumBps on a sell is the discount below the feed price, PriceGuard.discountBps: positive when the sale received less than the feed price and negative when it received more, so a receipt never shows a discount above the cap the sell passed. execPrice is rounded down, the trigger is OWNER and the reason NONE. No receipt carries the sell's total amount or proceeds. One transaction can hold several sells, even of one ticker (lots sold by id in one owner batch, or a sell split at the 100-lot bound). The verifier therefore groups a sell's receipts as the run of consecutive PART_SOLD and SOLD receipts with sequential ids, the same account and tickerId, written after one Swap log of the receipt's pool and sharing every whole-sell field (execPrice, premiumBps, roundId, answer, updatedAt, usdgRoundId, usdgAnswer, quote, minOut, pool, overrideClosed, overrideCapBps). It sums tokensIn and usdgOut over that run, never over the whole transaction.
- RECONCILED from a ledger reconcile (a split, endOwnerOp or sell): usdgIn is the shortfall, usdgSpent the cut off spend and usdgQueued the cut off the buckets, so `usdgIn == usdgSpent + usdgQueued`. usdgToSpend, tickerId, token and lotId are zero, and the trigger is the caller's: OWNER from endOwnerOp and sell. The Reconciled event gives the balance and each bucket's cut. usdgSpent means investment only on FILLED and SETTLED, so readers sum it by status (audit A1-16, D-026).
- RECONCILED from reconcileLots: tickerId, token, lotId the trimmed lot and tokensIn the tokens trimmed off it, trigger OWNER, every USDG field zero, and the lot's status unchanged. LotsReconciled gives the balance and the total trimmed.

premiumBps is measured in USDG at par: the verifier and the HP2 replay never convert it with the USDG/USD answer (audit A1-11, D-026).

## 14. Lots

Lot id equals the FILLED or SETTLED receipt id. Stored: account, tickerId, status, tokensBought, tokensRemaining. Allowed: FILLED, SETTLED or PART_SOLD to PART_SOLD or SOLD; SOLD is final; anything else reverts `BadLotTransition`, and an id with no lot `UnknownLot` (I7). A sell sets SOLD exactly when it takes a lot's last token, and PART_SOLD otherwise, so PART_SOLD to PART_SOLD is a second partial sell of the same lot (audit A1-04). reconcileLots trims tokensRemaining oldest first, at most 100 lots per call, and never changes a status, so a FILLED, SETTLED or PART_SOLD lot can reach tokensRemaining zero without becoming SOLD, and readers key on tokensRemaining. After a sell or a reconcile the head moves past the empty lots at the front. Lots stay in the module instance that bought them; how a later version takes them over is pending the owner (audit A1-28).

## 15. Views

`ledger(account)` (balance, spend, pendingTotal, unsorted, from the virtual balance while a bracket is open in the transaction), `bucketOf(account, tickerId)`, `ruleOf(account)`, `keeperOf(account)`, `isInitialized(account)`, `ownerOpOpen(account)`, `observationOf(account)`, `lot(id)`, `lotsOf(account, tickerId)` (ids in creation order and the head), `receiptHash(id)`, `nextReceiptId()`, `sessionOpenedAt(tickerId)` (zero while closed), `guardParams()`, the immutables, and the constants MAX_PREMIUM_CAP_BPS, MAX_SLIPPAGE_BPS and MIN_CLIP_FLOOR.

- `previewSplit(account)`: ruleStatus, tickerId, shortfall, unsorted, spendPart and equityPart, then status, reason (the first failing guard step readable without a swap) and buy, which mean something only when the rule is ACTIVE and unsorted is above zero; otherwise they keep their zero values, and status zero reads as FILLED. publicReadyAt is the observation plus the grace while the observation covers unsorted, and zero otherwise (section 8).
- `previewSettle(account, tickerId)`: ruleStatus, amount, since, bucketReason, minClip, status, reason, buy, publicReadyAt and shortfall. It follows section 10's order: status QUEUED with reason NONE and the shortfall while settle would revert `LedgersAboveBalance`, QUEUED with reason CLIP for an empty or a below-clip bucket, the refusal at any size, QUEUED with the first failing timing reason, or SETTLED with buy true, where a buy can still revert `GuardNotClear(PREMIUM)`. publicReadyAt is zero when settle would revert LedgersAboveBalance or BelowClip.

Neither preview has a pool: each checks only that the ticker's allowlist is not empty, not whether a given pool is allowlisted or blocked.

## 16. Top-up

No module function (B2-12). The app pulls USDG from a registered wallet with a USDG permit inside a bracketed owner op, so it lands in spend through the bracket, after the bracket reconciles any outside pull not yet booked (section 7). The app does not offer top-up yet; G7 in docs/GATES.md asks for a fork test of the real permit first.

## 17. Invariant map

| Invariant | Test |
| --- | --- |
| I1 module holds nothing: no call changes its USDG or stock token balance (a delta, settled at the deploy, D-026, D-028; PRD I1's text is unchanged) | invariant_I1_moduleBalancesMoveOnlyByDonation, the ModuleHoldsFunds check in every buy and sell, test_I1 unit and fork tests |
| I2 conservation | LedgerMath fuzz at 10,000 runs, testFuzz_I2_everySplitReceiptConservesUsdg, invariant_I2_everySplitReceiptConservesUsdg, receipt fields in every split test |
| I3 tokens land in the account | fork fills, postcondition revert tests, invariant_I3_boughtTokensLandInTheAccount |
| I4 moves only unsorted or queued, only to the venue, approval reset | invariant_I4_onlyTheVenueWithExactApprovalReset, fork allowance reads, the SleevePullOrder sequences |
| I5 install snapshot | LedgerMath fuzz, testFuzz_I5_installSnapshotNeverLeavesUnsortedAndInflowIsExact, fork install tests |
| I6 bracketed and module-moved USDG never split | fork tests through handleOps, invariant_I6_onlyIncomeIsEverSplit, testFuzz_I6_bracketMatchesAReferenceModel |
| I7 append-only receipts, lot transitions | test_I7_lotTransitionsOnlyAsAllowed, test_I7_aSoldLotIsFinal, test_I7_sell_lotTransitionsThroughSells, invariant_I7_receiptIdsIncreaseAndHashesNeverChange |
| I8 no fill above cap, stale or paused | fork tests per reason, testFuzz_I8_noFillAboveTheCapOnAStaleRoundOrPausedOracle, invariant_I8_everyFillWithinItsCapOnAFreshUnpausedRound |
| I9 shares and weights | LedgerMath fuzz at 10,000 runs, setRule tests |
| I10 admin powers | TokenSource and timelock tests, the SleeveI10 tests, invariant_I10_timelockWritesMoveNoFunds |
| I11 owner exits without keeper or app | fork tests through handleOps: withdraw, release, transfer tokens, uninstall (SleeveI11Fork) |
| I12 copy lint | app CI over UI strings |
| I13 borrowed USDG | borrow is M1, not applicable in M0 |
| I14 brackets on every owner UserOp | app unit test on the UserOp builder, test_I14 unit and fork tests |
