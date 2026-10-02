# Sleeve M0 contract spec

Status: draft 2, 2 October 2026. Source of truth for components 3 to 6, the keeper, the verifier and the app. The PRD (internal/Sleeve-PRD-v1.4.md) wins on any conflict. Engineering choices cite docs/DECISIONS.md. Items marked B2-n follow the recommended default of batch 2 item n, sent to the owner on 2 October; the code keeps each one a constant or a small branch so an override is cheap.

## 1. Contracts

| Contract | Kind | Admin | Holds funds |
| --- | --- | --- | --- |
| LedgerMath | library, pure | none | no |
| SessionCalendar | library, pure, 2026 and 2027 | none | no |
| SessionCalendarExtension | contract, later years and in-range closures (B2-9) | TimelockController | no |
| PriceGuard | library, view | none | no |
| TokenSource | contract: launch tickers, feeds, session types, pool allowlist, removals | TimelockController | no |
| SleeveModule | ERC-7579 executor, module type 2, not upgradeable | none | no, ever (I1) |
| SleeveTimelock | OpenZeppelin v5.4 TimelockController with a 172,800-second floor and a ceiling on its own delay (D-018, D-019) | DEPLOYER proposes, executes and cancels; no admin role holder (D-009 Q33) | no |

## 2. Chain facts the code depends on

From docs/research/chain-constants.md and pools.md. Every one is asserted in a fork test.

- USDG 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168: 6 decimals, UUPS proxy, has its own pause and an address freeze (isFrozen). A frozen account cannot move USDG, which Sleeve cannot prevent (PRD 9 failure table).
- Stock tokens: 18 decimals, BeaconProxy, beacon is the AccessControlsRegistry 0xe10b6f6B275de231345c20D14Ab812db62151b00. Views used: `paused()` (token flag or registry pause), `oraclePaused()`, `uiMultiplier()`, `newUIMultiplier()`, `effectiveAt()`, `uid()` (bytes32), `ACCESS_CONTROLLED_REGISTRY()`. Registry: `isBlocked(address)`. Transfers check sender and recipient, so the pool must be unblocked too (D-011).
- Feeds: 8 decimals, read through the proxy (aggregators are access controlled). Stock feeds have a 24-hour heartbeat and a 0.5 percent trigger, stop between the Friday close and the Sunday 20:00 New York reopen, and post a round within about a minute of each reopen. The USDG/USD feed runs on crypto hours with a 24-hour heartbeat and is routinely 23 to 24 hours old.
- Multiplier changes so far were scheduled about 10 minutes ahead, 5.66 to 17.18 bps each.
- v3 fee tiers: 100, 500, 3000, 10000 only. Launch pools in D-010.
- `block.number` is the L1 estimate. Receipts use `ArbSys(0x64).arbBlockNumber()`. Forge cannot run ArbSys, so tests etch a mock (contracts/test/utils/ForkBase.sol).

## 3. TokenSource

Constructor sets, for SPY, QQQ, NVDA and AAPL (ids 0 to 3): token, feed, session type ALL_DAY (B2-1), and the D-010 pools. Each pool is checked in the constructor and in `setPool`: `IUniswapV3Factory(V3_FACTORY).getPool(USDG, token, fee) == pool` with fee in {100, 500, 3000}.

Timelock-only functions (B2-8):

- `removeTicker(uint8 id)`: one way. No add function exists (I10 reads "cannot add a ticker").
- `setPool(uint8 id, address pool, bool allowed)`.

Views: `ticker(id)` (token, feed, sessionType, active), `tickerCount()`, `isPoolAllowed(id, pool)`, `poolsOf(id)`. Every change emits an event. Removed tickers stay sellable for existing lots.

## 4. PriceGuard library

As built in component 3 (contracts/src/libraries/PriceGuard.sol), internal functions inlined into the module. Market conditions come back as a Reason; malformed input reverts with a named error.

- `checkBuy(token, feed, usdgUsdFeed, account, pool, sessionOpen, sessionOpenedAt, params) -> BuyCheck{accountBlocked, reason, roundId, answer, updatedAt, usdgRoundId, usdgAnswer}`: PRD 7.4 steps 2 to 7 in order, first failure wins: account block, pool block (reverts `PoolBlocked`), PAUSED, ORACLE_PAUSED, SESSION (from the module's flag), MULTIPLIER, STALE, DEPEG. The module checks `accountBlocked` before `reason`: a blocked account returns `accountBlocked = true` with reason NONE and must become REFUSED_ACCOUNT, never a swap.
- `checkToken(token, account, pool) -> (accountBlocked, reason)`: registry read through `token.ACCESS_CONTROLLED_REGISTRY()` on every call; 18 decimals asserted.
- `checkMultiplier(token, window) -> reason`: MULTIPLIER when `newUIMultiplier() != uiMultiplier()` and `now < effectiveAt() <= now + window` (24 hours). No after-clause.
- `readStockFeed(feed, maxAge, sessionOpenedAt) -> (reason, roundId, answer, updatedAt)`: 8 decimals asserted; STALE when the answer is not positive, the round is from the future, older than 25 hours, or older than the session's opening instant. Equality passes.
- `checkUsdg(usdgUsdFeed, toleranceBps, maxAge) -> (reason, roundId, answer)`: DEPEG outside 1.0 plus or minus 50 bps at the feed's decimals, or older than 25 hours, or not positive. Both edges pass.
- `exceedsPremium(usdgSpent, tokensOut, answer, capBps, usdgDecimals, tokenDecimals, feedDecimals)` and `exceedsDiscount(usdgOut, tokensIn, answer, capBps, ...)`: exact 512-bit comparisons, equality passes. The module reads each decimals value from its own contract and asserts 6, 18 and 8 before calling them, because swapped arguments would silently loosen the cap.
- `execPriceBuy` (rounded up), `execPriceSell` (rounded down), `premiumBps` and `discountBps` (ceiling of the exact value) for receipts, in USDG base units per 1e18 token units and signed basis points.
- `defaultGuardParams()`: stock feed 25 hours, USDG feed 25 hours, 50 bps, 24-hour multiplier window (D-014).
- contracts/test/fixtures/premium_vectors.json (1,890 decision and 365 receipt vectors from scripts/premium_vectors.py) pins these for the module, the verifier and the replay.

## 5. SleeveModule state

```
Account {
  bool installed;
  uint128 spend;           // spend ledger
  uint128 pendingTotal;    // sum of buckets
  address keeper;          // per account, set at install, owner can change (B2-7)
  uint64 observedAt;       // public-trigger clock (D-009 Q15)
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

Global: `nextReceiptId`, `receiptHash[id]`, `lots[id]`, `lotIds[account][tickerId]` with a head index for oldest-first sells. Immutables: USDG, TokenSource, SessionCalendarExtension, SwapRouter02, USDG/USD feed, default keeper, disclosure hash (B2-10), grace 3,600 s, stock feed max age 90,000 s, USDG feed max age 90,000 s, depeg tolerance 50 bps, multiplier window 86,400 s.

## 6. Install, uninstall, rules

- `onInstall(bytes data)`: caller is the account. Overwrites any stale state (D-009 Q20). `spend = USDG.balanceOf(account)`, buckets empty (I5). `data` = abi.encode(keeper, RuleInput) with keeper zero meaning the default keeper and an empty rule meaning status NONE. Emits `Installed`.
- `onUninstall(bytes)`: releases each non-empty bucket with a RELEASED receipt, deletes ledgers, rule, keeper and observation. Receipts and lots stay. Never reverts for an installed account.
- `setRule(RuleInput)`, `pauseRule()`, `resumeRule()`, `setKeeper(address)`: caller is the account. setRule takes spendBps and equityBps and checks `LedgerMath.validateShares(spendBps, equityBps)` (I9), an active ticker, and the B2-5 ranges, then writes version + 1 and ACTIVE.
- Paused or unset rule (B2-6): split and settle revert `RuleNotActive`. New USDG stays unsorted and spendable; at resume it is split by the resumed rule.

## 7. Owner-batch brackets

- `beginOwnerOp()`: caller is an installed account. Reverts `OwnerOpAlreadyOpen` if open. Transient slots per account: balance at begin plus one, module delta zero.
- `endOwnerOp()`: `OwnerOpNotOpen` without a begin. If the account uninstalled inside the bracket, clear the slots and return. Otherwise `ownerDelta = balanceNow - balanceAtBegin - moduleDelta`. Positive: spend += ownerDelta (I6). Negative: `LedgerMath.allocateOutflow` over spend, then unsorted computed from the virtual balance `balanceAtBegin + moduleDelta`, then buckets in ascending ticker id. Emits one `OwnerOpEnded` per closed bracket, inflow or outflow, with the per-bucket amounts (D-019).
- Inside an open bracket every module action that moves the account's USDG adds its net change to the module delta, and split and settle compute unsorted from the virtual balance (D-009 Q13).

## 8. Triggers and grace

Trigger type: OWNER when `msg.sender == account`, KEEPER when `msg.sender == accounts[account].keeper`, PUBLIC otherwise. PAYLINK is M1.

- `observe(account)`: anyone. Reverts `NothingWaiting` when unsorted and buckets are empty. Stores `observedAt = now` and `observedUnsorted = unsorted` when no observation exists or unsorted grew past the stored amount.
- PUBLIC split: needs `observedAt != 0`, `now >= observedAt + 3,600` and `unsorted <= observedUnsorted`, else `GracePeriodActive(readyAt)`.
- PUBLIC settle: needs `now >= max(bucket.since, sessionOpenedAt, observedAt) + 3,600` with `observedAt != 0`.
- Any successful keeper or owner split or settle clears the observation.

## 9. split(account, pool, quote)

1. Trigger and grace (section 8). Rule ACTIVE.
2. Balance (virtual inside a bracket). If below spend + pendingTotal, reconcile spend first then buckets, RECONCILED receipt.
3. `unsorted = balance - spend - pendingTotal`; zero returns 0 with no receipt.
4. `(spendPart, equityPart) = LedgerMath.splitShares(unsorted, rule.equityBps)`; spend += spendPart.
5. Guard on the rule's ticker, first failure wins:
   1. ticker active with a feed, pool allowlisted for it: else REFUSED_TICKER, equity to spend.
   2. account not blocked: else REFUSED_ACCOUNT, equity to spend. Pool blocked reverts `PoolBlocked`.
   3. PAUSED, ORACLE_PAUSED.
   4. SESSION: calendar closed for the ticker's session type, or timestamp outside coverage.
   5. MULTIPLIER (B2-4).
   6. STALE: answer, age, fresh round after reopen (B2-2).
   7. DEPEG (B2-3).
   8. CLIP: `equityPart < rule.minClip` (D-009 Q12, Q22).
   9. Buy through the self-call (section 11). PremiumAboveCap gives PREMIUM; any other failure reverts everything.
6. Timing failures add equityPart to the bucket (sets `since` when empty) with the reason.
7. One receipt: FILLED, QUEUED(reason), REFUSED_TICKER or REFUSED_ACCOUNT. FILLED creates a lot. I2: `usdgIn == usdgToSpend + usdgSpent + usdgQueued`.

## 10. settle(account, tickerId, pool, quote) and release(tickerId)

- `settle`: trigger and grace. Bucket must be at least the current rule's minClip (`BelowClip`). Steps 1 and 2 failing send the bucket to spend with a REFUSED receipt. Steps 3 to 7 failing revert `GuardNotClear(reason)` with no state change, so the keeper learns to wait from a simulation. Step 9 PREMIUM also reverts `GuardNotClear(PREMIUM)`. A fill empties the bucket, writes SETTLED with `queuedSince` and the current rule version (D-009 Q24), and creates a lot.
- `release(tickerId)`: caller is the account. Whole bucket to spend, RELEASED receipt, no guard (I11).

## 11. Buy and sell execution

Venue 1: Uniswap v3 SwapRouter02, single hop, allowlisted pool. Through `executeFromExecutor` on the account, one batch:

1. `USDG.approve(router, amountIn)`
2. `router.exactInputSingle({tokenIn, tokenOut, fee: pool.fee(), recipient: account, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0})`
3. `USDG.approve(router, 0)`

`minOut = amountIn * quote / 1e6 * (10_000 - slippageBps) / 10_000` (D-009 Q21). The module reads both balances before and after and reverts on any broken postcondition: USDG spent equal to amountIn (`PartialFill`), tokens received at least minOut and above zero, allowance zero, module balances zero (I1, I3, I4).

`executeBuy` is external, accepts only `msg.sender == address(this)`, measures, and reverts `PremiumAboveCap(premiumBps)` when the exact inequality fails. The caller catches only that selector. The outer entry point holds the transient reentrancy lock.

Sells mirror this with the token as input. Proceeds go to spend and into the module delta.

## 12. sell(tickerId, tokenAmount, lotId, pool, quote, overrideClosed, overrideCapBps)

Caller is the account, normally inside an owner bracket.

- `lotId == 0` sells by amount, oldest lot first; otherwise that lot only. `ExceedsLots` if the lots cannot cover the amount. Tokens outside lots are not sellable through Sleeve in M0 (D-009 Q30).
- Guard mirrored: ticker known (removed tickers still sell), account not blocked, not paused, not oraclePaused, no multiplier change due, USDG not depegged, feed fresh and session open, discount at most the cap below the feed price (`DiscountAboveCap` reverts the sell).
- Session closed or feed stale without override: revert `SellWaits(reason)`; the app shows waiting with the reopen time (B2-13).
- `overrideClosed`: skips the session and feed-age steps for this call only. `overrideCapBps` may widen the discount cap for this sell up to 500 bps (B2-14). Both go on the receipt.
- Each touched lot gets a PART_SOLD or SOLD receipt with its pro rata share of proceeds.

## 13. Receipts

Event `ReceiptWritten(uint256 indexed id, address indexed account, Status indexed status, Receipt r)` and `receiptHash[id] = keccak256(abi.encode(r))`. Ids global from 1 (D-009 Q25).

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

## 14. Lots

Lot id equals the FILLED or SETTLED receipt id. Stored: account, tickerId, status, tokensBought, tokensRemaining. Allowed: FILLED or SETTLED to PART_SOLD or SOLD, PART_SOLD to SOLD; anything else reverts `BadLotTransition` (I7).

## 15. Views

`ledger(account)` (balance, spend, pendingTotal, unsorted), `bucketOf(account, tickerId)`, `ruleOf(account)`, `keeperOf(account)`, `lot(id)`, `lotsOf(account, tickerId)`, `receiptHash(id)`, `nextReceiptId()`, `previewSplit(account)` (amounts, the first failing guard step readable without a swap, whether a buy would run), `sessionOpenedAt(tickerId)`.

## 16. Top-up

No module function (B2-12). The app pulls USDG from a registered wallet with a USDG permit inside a bracketed owner op, so it lands in spend through the bracket.

## 17. Invariant map

| Invariant | Test |
| --- | --- |
| I1 module holds nothing | invariant suite with mocks, balance assert after every fork action |
| I2 conservation | LedgerMath fuzz at 10,000 runs, receipt fields in every split test |
| I3 tokens land in the account | fork fills, postcondition revert test |
| I4 moves only unsorted or queued, only to the venue, approval reset | invariant suite, fork allowance reads |
| I5 install snapshot | LedgerMath fuzz, fork install test |
| I6 bracketed and module-moved USDG never split | fork tests through handleOps, invariant suite |
| I7 append-only receipts, lot transitions | unit tests |
| I8 no fill above cap, stale or paused | fork tests per reason, invariant suite |
| I9 shares and weights | LedgerMath fuzz at 10,000 runs, setRule tests |
| I10 admin powers | TokenSource and timelock tests |
| I11 owner exits without keeper or app | fork test through handleOps: withdraw, release, transfer tokens, uninstall |
| I12 copy lint | app CI over UI strings |
| I13 borrowed USDG | borrow is M1, not applicable in M0 |
| I14 brackets on every owner UserOp | app unit test on the UserOp builder |
