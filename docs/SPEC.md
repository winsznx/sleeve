# Sleeve M0 contract spec

Status: draft 1, 2 October 2026. Source of truth for components 3 to 6, the keeper, the verifier and the app. The PRD (internal/Sleeve-PRD-v1.4.md) wins on any conflict. Items marked OPEN wait on the owner; the code parametrizes them so the answer changes a constant, not a structure.

## 1. Contracts

| Contract | Kind | Owner or admin | Holds funds |
| --- | --- | --- | --- |
| LedgerMath | library, pure | none | no |
| SessionCalendar | library, pure, 2026 and 2027 | none | no |
| SessionCalendarExtension | contract, appends later years | TimelockController | no |
| PriceGuard | library, view | none | no |
| TokenSource | contract, launch tickers, feeds, session types, pool allowlist, deny list | TimelockController | no |
| SleeveModule | ERC-7579 executor, type 2, not upgradeable | none | no, ever (I1) |
| TimelockController | OpenZeppelin v5.4, 48-hour min delay | proposer and executor DEPLOYER, no admin | no |

DEPLOYER is a single EOA (D-004). The timelock has no admin role holder, so only a scheduled, delayed operation can change its roles.

## 2. TokenSource

Tickers are set once in the constructor from the launch set: SPY, QQQ, NVDA, AAPL, each with token, Chainlink feed, session type and initial pools. Ticker ids are array indexes, 0 to 3.

Admin functions, callable only by the timelock:

- `removeTicker(uint8 id)`: marks the ticker denied. One way. There is no add function (PRD change 11, I10).
- `setPool(uint8 id, address pool, bool allowed)`: adds or removes an allowlisted pool. A pool is accepted only if `IUniswapV3Factory(V3_FACTORY).getPool(USDG, token, pool.fee()) == pool`, which proves it is the canonical v3 pool for that pair and fee.

Views: `ticker(id)`, `tickerCount()`, `isActive(id)`, `isPoolAllowed(id, pool)`, `poolsOf(id)`.

Every change emits an event. The timelock delay makes each change public 48 hours before it takes effect.

## 3. SleeveModule state

Per account:

```
Account {
  bool installed;
  uint128 spend;          // spend ledger, USDG base units
  uint128 pendingTotal;   // sum of pending over tickers
  uint64 observedAt;      // public-trigger observation, 0 when none
  Rule rule;
}
Rule {
  uint32 version;         // increments on every setRule
  RuleStatus status;      // NONE, ACTIVE, PAUSED
  uint16 equityBps;       // spend share is 10,000 minus this (I9 checked on write)
  uint8 tickerId;         // one leg in M0; baskets are M1
  uint16 premiumCapBps;   // default 100
  uint16 slippageBps;     // default 50
  uint128 minClip;        // USDG base units, default 25e6
}
Pending[account][tickerId] { uint128 amount; uint64 since; uint8 reason; }
topUpWallet[account][wallet] -> bool
```

Global: `nextReceiptId`, `receiptHash[id]`, `lots[id]`, `lotIds[account][tickerId]` with a head index for FIFO sells.

Immutables: USDG, TokenSource, SessionCalendarExtension, SwapRouter02, USDG/USD feed, keeper, disclosure hash, grace seconds (3,600), max feed age (25 hours), depeg tolerance (OPEN, Q-depeg), multiplier window (OPEN, Q-multiplier).

## 4. Install and uninstall

- `onInstall(bytes data)`, caller is the account. Reverts if installed. Sets `spend = USDG.balanceOf(account)` and `pendingTotal = 0`, so USDG present at install is never split (I5). `data` may carry an initial rule, validated as in `setRule`. Emits `Installed(account, spendSnapshot)`.
- `onUninstall(bytes)`, caller is the account. Releases every pending bucket to spend with a RELEASED receipt each, then deletes the account's state so a later install starts from a fresh snapshot. Must not revert on a well-formed account, because Kernel calls it during uninstall. Emits `Uninstalled(account)`.
- `isModuleType(2)` is true. `isInitialized(account)` returns `installed`.

## 5. Rules

All callable only by the account (msg.sender == account, installed).

- `setRule(RuleInput)`: checks `LedgerMath.validateShares(10_000 - equityBps, equityBps)`, the ticker is active in TokenSource, caps are in range (premium cap at most 1,000 bps, slippage at most 500 bps, minClip at least 1 USDG). Writes version + 1, status ACTIVE. Emits `RuleSet`.
- `pauseRule()` and `resumeRule()`: status PAUSED or ACTIVE. Emits `RuleStatusChanged`.
- An edit never re-sorts USDG that is already sorted. A split that is running reads the rule once.

## 6. Owner-batch brackets (WRAPPED accounting)

- `beginOwnerOp()`: caller is an installed account. Reverts `OwnerOpAlreadyOpen` if a bracket is open for the account in this transaction. Stores `balance + 1` in transient storage keyed by account, and zeroes the transient module delta.
- `endOwnerOp()`: reverts `OwnerOpNotOpen` without a matching begin. Computes `ownerDelta = balanceNow - balanceAtBegin - moduleDelta`, clears both transient slots, then:
  - `ownerDelta > 0`: `spend += ownerDelta` (owner inflow is never income, I6).
  - `ownerDelta < 0`: `LedgerMath.applyOutflow` over spend, then unsorted, then pending in ascending ticker id, where unsorted is computed from the virtual balance `balanceAtBegin + moduleDelta`. Emits `OwnerOutflow(account, fromSpend, fromUnsorted, fromPending)`.
- Module delta: every module function that changes the account's USDG balance while a bracket is open adds its own net change (swap spend negative, sale proceeds positive, top-up positive) to the transient module delta, because it already updated the ledgers itself. This is what keeps a sell inside an owner batch from being credited twice.
- An owner batch without brackets leaves its USDG delta unrecorded: an outflow is caught by reconcile on the next split, an inflow is treated as income. Documented limit, G6 item f.

## 7. Triggers and the grace period

Trigger type: OWNER when `msg.sender == account`, KEEPER when `msg.sender == keeper`, PUBLIC otherwise. PAYLINK is reserved for M1.

- KEEPER and OWNER may call `split` and `settle` at any time. Each successful call clears `observedAt`.
- PUBLIC needs an observation that has aged past the grace period:
  - `observe(account)`: anyone. Reverts `NothingWaiting` when unsorted and pending are both zero. Sets `observedAt = block.timestamp` if it is zero. Emits `Observed`.
  - A PUBLIC `split` or `settle` reverts `GracePeriodActive(readyAt)` unless `observedAt != 0` and `block.timestamp >= observedAt + grace`. On success it clears `observedAt`.
- The keeper has no power beyond what anyone has after the grace period (PRD 7.2). The keeper address is immutable in M0; rotating it means a new module version. Its key holds ETH and nothing else.

## 8. split(account, pool, quote)

`quote` is the trigger's quoted tokens out, in raw token units, per 1e6 USDG base units, for the expected equity size. It must be non-zero. `minOut = equity * quote / 1e6 * (10,000 - slippageBps) / 10,000`, rounded down.

1. Trigger and grace checks (section 7). Rule must be ACTIVE (`RuleNotActive` otherwise, so a paused rule leaves new USDG unsorted and spendable).
2. `balance = USDG.balanceOf(account)`. If `balance < spend + pendingTotal`, reconcile with `LedgerMath.reconcile` and write a RECONCILED receipt.
3. `unsorted = balance - spend - pendingTotal`. Zero is a no-op: return 0, no receipt.
4. `(spendPart, equityPart) = LedgerMath.splitAmount(unsorted, equityBps)`; `spend += spendPart`.
5. Guard, in PRD 7.4 order. The first failure decides the outcome:
   1. ticker active, feed set, pool allowlisted for the ticker: else REFUSED_TICKER, equity to spend.
   2. account not on the token's blocklist: else REFUSED_ACCOUNT, equity to spend.
   3. token not paused and oraclePaused false: else QUEUED(PAUSED or ORACLE_PAUSED).
   4. session open for the ticker's session type: else QUEUED(SESSION).
   5. no multiplier change due inside the window, and none that took effect after the feed's updatedAt: else QUEUED(MULTIPLIER).
   6. feed answer positive and age at most 25 hours: else QUEUED(STALE).
   7. USDG/USD within tolerance: else QUEUED(DEPEG).
   8. `equityPart < minClip` queues as QUEUED(CLIP). A split never merges its equity part with an existing bucket. Settle buys the bucket once it reaches the clip (OPEN, Q-clip-merge).
   9. Attempt the buy (section 10). Premium above the cap: QUEUED(PREMIUM), the swap is undone. Tokens below minOut: the whole call reverts and nothing moves.
6. QUEUED adds `equityPart` to `pending[ticker]` (sets `since` if the bucket was empty, records the reason) and `pendingTotal`.
7. Write one receipt: FILLED, QUEUED(reason), REFUSED_TICKER or REFUSED_ACCOUNT. FILLED creates a lot.

Conservation per split, I2: `usdgIn == usdgToSpend + usdgSpent + usdgQueued`, dust at most one base unit, all in spend.

## 9. settle(account, tickerId, pool, quote) and release(tickerId)

- `settle`: trigger and grace checks. Bucket must hold at least the rule's minClip (`BelowClip` otherwise). Runs guard steps 1 to 7 and 9 on the whole bucket. A refusal (steps 1 and 2) moves the bucket to spend with a REFUSED receipt. A timing failure reverts `GuardNotClear(reason)` and changes nothing, so a keeper simulation tells it to wait without spending gas. A fill empties the bucket, writes SETTLED with `queuedSince`, and creates a lot. The current rule's caps apply and the receipt records the current rule version (OPEN, Q-settle-rule).
- `release(tickerId)`: caller is the account. Moves the whole bucket to spend and writes RELEASED. Works whatever the guard says, so the owner can always get the money back (I11).

## 10. Buy and sell execution

Venue id 1 is Uniswap v3 through SwapRouter02, single hop on an allowlisted pool. The module never holds tokens. All movements run through `executeFromExecutor` on the account as one batch:

1. `USDG.approve(router, amountIn)`, exact.
2. `router.exactInputSingle({tokenIn: USDG, tokenOut: token, fee: pool.fee(), recipient: account, amountIn, amountOutMinimum: minOut, sqrtPriceLimitX96: 0})`.
3. `USDG.approve(router, 0)`.

The module reads both balances before and after. Postconditions, each a named revert: USDG spent equals amountIn, tokens received at least minOut and above zero, allowance back to zero, module balances zero (I1, I3, I4).

The premium check needs a real fill, so the buy runs in an external self-call: `this.executeBuy(...)` reverts with `PremiumAboveCap(premiumBps)` after measuring, and the caller catches exactly that selector and queues. Any other revert data bubbles up, which is how the minOut failure reverts the whole call. `executeBuy` only accepts `msg.sender == address(this)`. The outer entry point holds the transient reentrancy lock for the whole call.

Execution price, from balances only, in USDG base units per 1e18 token units: `usdgSpent * 1e18 / tokensOut`. Premium in signed basis points against the feed answer converted to USDG base units, rounded against the buyer. The same function with the sign flipped gives the sell discount.

Sell-back mirrors this with the token as input and USDG as output. Proceeds go to spend.

## 11. Sell-back

`sell(tickerId, tokenAmount, pool, quote, overrideClosed)`, caller is the account, normally inside an owner batch.

- Sells FIFO across the account's lots for the ticker. The amount cannot exceed the lots' remaining tokens (`ExceedsLots`).
- Guard mirrored: steps 1 to 7 as for a buy; the execution price must be no more than the cap below the feed price (`DiscountAboveCap` reverts the whole sell).
- When the market reference is not live (session closed, stale feed) the sell waits by default. OPEN, Q-sell-wait: revert `SellWaits(reason)` so the app shows waiting and lets the owner retry or override, or record a queued sell for the keeper. Draft 1 assumes the revert.
- `overrideClosed = true` skips the session and staleness steps only, once for this call. The receipt records the override.
- Proceeds credit spend directly and count in the module delta. Each touched lot gets a receipt: PART_SOLD or SOLD with its share of the proceeds.

## 12. Top-up

- `setTopUpWallet(wallet, allowed)`, caller is the account.
- `topUp(account, amount)`, caller must be a registered wallet. Pulls USDG from the wallet straight to the account with `transferFrom` and credits spend. Emits `TopUp`. A plain transfer from any wallet still counts as income, because the contract cannot see who sent it.

## 13. Receipts

Written in the same transaction as the action, as an event carrying every field plus `receiptHash[id] = keccak256(abi.encode(receipt))` in storage. Ids are global and sequential from 1. Append-only by construction (I7): a hash is written once and never changed.

Fields from PRD section 10 plus the accounting mode, the queue reason and lot references:

```
Receipt {
  uint256 id; address account; uint32 ruleVersion; Trigger trigger; address payer;
  Status status; QueueReason reason; AccountingMode mode;      // mode is WRAPPED
  address token; <uid type> tokenUid;
  uint256 usdgIn; uint256 usdgToSpend; uint256 usdgToEquity; uint256 usdgSpent; uint256 usdgQueued;
  uint256 tokensOut; uint256 uiMultiplier; uint256 execPrice; int256 premiumBps;
  uint80 roundId; int256 answer; uint256 updatedAt;
  uint8 venueId; address pool; uint32 calendarVersion; bytes32 disclosureHash;
  uint256 l2Block; uint256 timestamp;                          // ArbSys.arbBlockNumber(), block.timestamp
  uint256 lotId; uint64 queuedSince; bool overrideClosed;
}
```

Derived, labeled as derived, never written by the contract: transaction hash, senders of passive transfers, which inbound transfers a lot sorted.

Status values: FILLED, QUEUED, SETTLED, REFUSED_TICKER, REFUSED_ACCOUNT, RELEASED, PART_SOLD, SOLD, RECONCILED. POSTED is M1.

## 14. Lots

A lot is a buy that delivered tokens: FILLED from a split or SETTLED from a settle. Lot id is the receipt id. Allowed transitions: FILLED or SETTLED to PART_SOLD or SOLD, PART_SOLD to SOLD. Anything else reverts `BadLotTransition` (I7). Pending buckets are not lots: QUEUED receipts record what entered a bucket, SETTLED or RELEASED receipts record how it left.

## 15. Views for the keeper, app and verifier

`ledger(account)` returns balance, spend, pendingTotal, unsorted. `pendingOf(account, tickerId)`, `ruleOf(account)`, `lot(id)`, `lotsOf(account, tickerId)`, `receiptHash(id)`, `nextReceiptId()`, and `previewSplit(account)` returning the amounts, the first failing guard step that can be read without a swap, and whether a buy would be attempted.

## 16. Invariant map

| Invariant | Test |
| --- | --- |
| I1 module holds nothing | invariant suite with mocks, plus a balance assert after every fork action |
| I2 conservation | LedgerMath fuzz (10,000 runs), receipt fields in every split test |
| I3 tokens land in the account | fork fill tests, postcondition revert test |
| I4 moves only unsorted or queued, only to the venue, exact approval reset | invariant suite, fork tests reading allowance after |
| I5 install snapshot | LedgerMath fuzz, fork install test |
| I6 bracketed and module-moved USDG never split | fork tests through handleOps, invariant suite |
| I7 append-only receipts and lot transitions | unit tests on hashes and transitions |
| I8 no fill above cap, stale or paused | fork tests per reason, invariant suite |
| I9 shares and weights | LedgerMath fuzz (10,000 runs) and setRule tests |
| I10 admin powers | TokenSource and timelock tests |
| I11 owner exits without keeper or app | fork test: withdraw, release, transfer tokens, uninstall through handleOps |
| I12 copy lint | app CI lint over UI strings |
| I13 borrowed USDG | borrow is M1; documented as not applicable in M0 |
| I14 brackets on every owner UserOp | app unit test on the UserOp builder |
