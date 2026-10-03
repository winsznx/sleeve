// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";
import {ISleeveModule} from "../interfaces/ISleeveModule.sol";
import {IStockToken} from "../interfaces/IStockToken.sol";
import {Reason, Status, Trigger} from "../types/SleeveTypes.sol";
import {LedgerMath} from "./LedgerMath.sol";
import {PriceGuard} from "./PriceGuard.sol";
import {SessionCalendar} from "./SessionCalendar.sol";
import {SleeveState} from "./SleeveState.sol";

/// @title SleeveTrade
/// @notice observe, split and settle, and their previews (docs/SPEC.md sections 8 to 10 and 15): triggers and grace,
/// reconcile, the share split, the guard in PRD 7.4 order, the queue, the buy through the module's own executeBuy, lots
/// and the receipts. External library, reached by DELEGATECALL from SleeveModule, so it runs as the module and works on
/// the module's storage through the Store pointer and on its immutables through Env (D-019).
/// @dev The module's entry points hold the reentrancy lock of the account they act on around every call here.
library SleeveTrade {
    using SafeCast for uint256;

    /// @dev Receipt venue id of Uniswap v3 through SwapRouter02.
    uint8 private constant VENUE_UNISWAP_V3 = 1;

    /// @dev A quote is in token base units per this many USDG base units (D-009 Q21).
    uint256 private constant QUOTE_UNIT = 1e6;

    /// @dev Where the guard sends the equity: buy, the ticker's bucket, or spend.
    enum Outcome {
        BUY,
        QUEUE,
        REFUSE_TICKER,
        REFUSE_ACCOUNT
    }

    /// @dev What the guard read for one ticker. reason is set when outcome is QUEUE.
    struct Guard {
        Outcome outcome;
        Reason reason;
        address token;
        address feed;
        bool open;
        uint256 openedAt;
        PriceGuard.BuyCheck check;
    }

    /// @dev One split leg or one settle: whose, who triggered it, the ticker, the trigger's pool and quote, and the
    /// USDG it may spend.
    struct Job {
        address account;
        Trigger trigger;
        uint8 tickerId;
        address pool;
        uint256 quote;
        uint256 amount;
    }

    /// @notice Growth in unsorted USDG that restarts the public-trigger clock: 1 USDG. Below it the clock keeps
    /// running, so a stranger cannot postpone the public fallback forever with dust; postponing it costs at least
    /// 1 USDG per restart, and that USDG becomes the owner's income (audit A1-05).
    uint256 internal constant OBSERVE_RESTART_GROWTH = 1e6;

    // Entry points

    /// @notice Starts or restarts the account's public-trigger clock (D-009 Q15). See ISleeveModule.observe.
    /// @dev Caller: SleeveModule.observe, for anyone.
    function observe(SleeveState.Store storage s, IERC20 usdg, address account) external returns (uint64 observedAt) {
        SleeveState.Account storage acct = s.accounts[account];
        if (!acct.installed) revert ISleeveModule.NotInstalled(account);
        uint256 pending = acct.pendingTotal;
        uint256 unsorted = LedgerMath.unsorted(SleeveState.sortingBalance(usdg, account), acct.spend, pending);
        if (unsorted == 0 && pending == 0) revert ISleeveModule.NothingWaiting(account);
        observedAt = acct.observedAt;
        if (_covers(acct, unsorted)) {
            SleeveState.clampObservation(acct, unsorted);
            return observedAt;
        }
        observedAt = block.timestamp.toUint64();
        uint128 observedUnsorted = unsorted.toUint128();
        acct.observedAt = observedAt;
        acct.observedUnsorted = observedUnsorted;
        emit ISleeveModule.Observed(account, observedAt, observedUnsorted);
    }

    /// @notice Sorts the account's unsorted USDG by its rule. See ISleeveModule.split.
    /// @dev Caller: SleeveModule.split, for the account, its keeper or anyone after the grace.
    function split(
        SleeveState.Store storage s,
        SleeveState.Env memory env,
        address account,
        address pool,
        uint256 quote
    ) external returns (uint256 receiptId) {
        (SleeveState.Account storage acct, Trigger trigger) = _enter(s, account, quote);
        ISleeveModule.Rule memory rule = acct.rule;
        uint256 balance = SleeveState.sortingBalance(env.usdg, account);
        uint256 spend = acct.spend;
        uint256 pending = acct.pendingTotal;
        uint256 unsorted = LedgerMath.unsorted(balance, spend, pending);
        if (trigger == Trigger.PUBLIC) _requireSplitGrace(acct, env.grace, unsorted);
        if (unsorted == 0) {
            // Ledgers above the balance leave nothing unsorted, so a split either reconciles or sorts.
            if (LedgerMath.shortfall(balance, spend, pending) == 0) return 0;
            return _reconcile(s, env, acct, account, balance, trigger, rule.version);
        }
        Job memory job =
            Job({account: account, trigger: trigger, tickerId: rule.tickerId, pool: pool, quote: quote, amount: 0});
        receiptId = _sort(s, env, acct, job, rule, unsorted);
        _clearObservation(acct);
    }

    /// @notice Buys a whole bucket once the guard clears. See ISleeveModule.settle.
    /// @dev Caller: SleeveModule.settle, for the account, its keeper or anyone after the grace.
    function settle(
        SleeveState.Store storage s,
        SleeveState.Env memory env,
        address account,
        uint8 tickerId,
        address pool,
        uint256 quote
    ) external returns (uint256 receiptId) {
        (SleeveState.Account storage acct, Trigger trigger) = _enter(s, account, quote);
        Job memory job =
            Job({account: account, trigger: trigger, tickerId: tickerId, pool: pool, quote: quote, amount: 0});
        receiptId = _settle(s, env, acct, job);
    }

    /// @notice Moves a whole bucket to spend and writes its RELEASED receipt: usdgToSpend is the amount, reason and
    /// queuedSince are the bucket's, token is the ticker's from TokenSource. No token or feed is read, so tokenUid and
    /// the market fields stay zero and the release cannot be blocked by the issuer's contracts (I11).
    /// @dev Caller: SleeveModule, for release by the account and for the buckets onInstall and onUninstall release.
    /// Reverts EmptyBucket for an empty bucket.
    /// @return amount USDG released.
    /// @return receiptId The RELEASED receipt.
    function releaseBucket(
        SleeveState.Store storage s,
        SleeveState.Env memory env,
        address account,
        uint8 tickerId,
        Trigger trigger
    ) external returns (uint256 amount, uint256 receiptId) {
        ISleeveModule.Bucket memory bucket = s.buckets[account][tickerId];
        if (bucket.amount == 0) revert ISleeveModule.EmptyBucket(account, tickerId);
        amount = bucket.amount;
        delete s.buckets[account][tickerId];
        SleeveState.Account storage acct = s.accounts[account];
        acct.pendingTotal -= bucket.amount;
        acct.spend = LedgerMath.creditSpend(acct.spend, amount).toUint128();

        ISleeveModule.Receipt memory receipt;
        (receipt.token,,,) = env.tokenSource.ticker(tickerId);
        receipt.ruleVersion = acct.rule.version;
        receipt.trigger = trigger;
        receipt.status = Status.RELEASED;
        receipt.reason = bucket.reason;
        receipt.tickerId = tickerId;
        receipt.usdgToSpend = amount;
        receipt.queuedSince = bucket.since;
        receiptId = SleeveState.writeReceipt(s, env, account, receipt);
    }

    /// @notice Brings the ledgers down to `balance`, spend first, then the buckets in ascending ticker id, with a
    /// RECONCILED receipt and the Reconciled event, as split does (PRD 7.2, D-009 Q4).
    /// @dev Caller: SleeveModule.endOwnerOp before it credits an owner inflow to spend (audit I-01), and SleeveSell.sell
    /// before it credits the proceeds (audit I-03), so neither refills a bucket an outside pull emptied. The caller
    /// checks that the ledgers exceed `balance`.
    /// @param balance The balance the split would compute from: the virtual balance inside a bracket.
    /// @param trigger OWNER for both callers.
    /// @return receiptId The RECONCILED receipt.
    function reconcileLedgers(
        SleeveState.Store storage s,
        SleeveState.Env memory env,
        address account,
        uint256 balance,
        Trigger trigger
    ) external returns (uint256 receiptId) {
        SleeveState.Account storage acct = s.accounts[account];
        return _reconcile(s, env, acct, account, balance, trigger, acct.rule.version);
    }

    // Previews

    /// @notice What split would do now, read without a swap. See ISleeveModule.SplitPreview.
    /// @dev Caller: SleeveModule.previewSplit, for anyone.
    function previewSplit(SleeveState.Store storage s, SleeveState.Env memory env, address account)
        external
        view
        returns (ISleeveModule.SplitPreview memory preview)
    {
        SleeveState.Account storage acct = s.accounts[account];
        ISleeveModule.Rule memory rule = acct.rule;
        preview.ruleStatus = rule.status;
        preview.tickerId = rule.tickerId;
        if (!acct.installed) return preview;
        uint256 balance = SleeveState.sortingBalance(env.usdg, account);
        uint256 spend = acct.spend;
        uint256 pending = acct.pendingTotal;
        preview.shortfall = LedgerMath.shortfall(balance, spend, pending);
        preview.unsorted = LedgerMath.unsorted(balance, spend, pending);
        (preview.spendPart, preview.equityPart) = LedgerMath.splitShares(preview.unsorted, rule.equityBps);
        if (_covers(acct, preview.unsorted)) preview.publicReadyAt = acct.observedAt + env.grace;
        if (rule.status != ISleeveModule.RuleStatus.ACTIVE || preview.unsorted == 0) return preview;
        if (preview.equityPart == 0) {
            (preview.status, preview.reason) = (Status.QUEUED, Reason.CLIP);
            return preview;
        }
        Guard memory guard = _guard(env, account, rule.tickerId, address(0), true);
        (preview.status, preview.reason, preview.buy) =
            _verdict(guard, preview.equityPart < rule.minClip, Status.FILLED);
    }

    /// @notice What settle would do now for a ticker's bucket, read without a swap. See ISleeveModule.SettlePreview.
    /// @dev Caller: SleeveModule.previewSettle, for anyone.
    function previewSettle(SleeveState.Store storage s, SleeveState.Env memory env, address account, uint8 tickerId)
        external
        view
        returns (ISleeveModule.SettlePreview memory preview)
    {
        SleeveState.Account storage acct = s.accounts[account];
        ISleeveModule.Bucket memory bucket = s.buckets[account][tickerId];
        preview.ruleStatus = acct.rule.status;
        preview.amount = bucket.amount;
        preview.since = bucket.since;
        preview.bucketReason = bucket.reason;
        preview.minClip = acct.rule.minClip;
        if (!acct.installed || preview.ruleStatus != ISleeveModule.RuleStatus.ACTIVE) return preview;
        preview.shortfall =
            LedgerMath.shortfall(SleeveState.sortingBalance(env.usdg, account), acct.spend, acct.pendingTotal);
        if (preview.shortfall != 0) {
            preview.status = Status.QUEUED;
            return preview;
        }
        if (bucket.amount == 0) {
            (preview.status, preview.reason) = (Status.QUEUED, Reason.CLIP);
            return preview;
        }
        Guard memory guard = _guard(env, account, tickerId, address(0), true);
        if (!_refused(guard) && bucket.amount < preview.minClip) {
            (preview.status, preview.reason) = (Status.QUEUED, Reason.CLIP);
            return preview;
        }
        preview.publicReadyAt = _settleReadyAt(bucket.since, guard, env.grace);
        (preview.status, preview.reason, preview.buy) = _verdict(guard, false, Status.SETTLED);
    }

    // Split steps

    /// @dev Splits unsorted into the spend part and the equity part, runs the guard on the equity part, and writes
    /// the split's receipt. I2: usdgIn == usdgToSpend + usdgSpent + usdgQueued on every branch.
    function _sort(
        SleeveState.Store storage s,
        SleeveState.Env memory env,
        SleeveState.Account storage acct,
        Job memory job,
        ISleeveModule.Rule memory rule,
        uint256 unsorted
    ) private returns (uint256) {
        (uint256 spendPart, uint256 equityPart) = LedgerMath.splitShares(unsorted, rule.equityBps);
        acct.spend = LedgerMath.creditSpend(acct.spend, spendPart).toUint128();
        job.amount = equityPart;
        Guard memory guard;
        // A zero equity part has nothing to buy or queue, so the guard does not run and no bucket changes.
        if (equityPart == 0) (guard.token,,,) = env.tokenSource.ticker(job.tickerId);
        else guard = _guard(env, job.account, job.tickerId, job.pool, false);
        ISleeveModule.Receipt memory receipt = _receipt(job, rule.version, guard);
        receipt.usdgIn = unsorted;
        receipt.usdgToSpend = spendPart;
        receipt.usdgToEquity = equityPart;

        if (equityPart == 0) {
            (receipt.status, receipt.reason) = (Status.QUEUED, Reason.CLIP);
        } else if (guard.outcome == Outcome.REFUSE_TICKER || guard.outcome == Outcome.REFUSE_ACCOUNT) {
            acct.spend = LedgerMath.creditSpend(acct.spend, equityPart).toUint128();
            receipt.usdgToSpend = spendPart + equityPart;
            receipt.status = _refusal(guard.outcome);
        } else if (guard.outcome == Outcome.QUEUE || equityPart < rule.minClip) {
            _queue(s, acct, job, receipt, guard.outcome == Outcome.QUEUE ? guard.reason : Reason.CLIP);
        } else {
            (bool filled, ISleeveModule.BuyFill memory fill) = _buy(rule, job, guard, receipt);
            if (filled) {
                _recordFill(s, receipt, job, guard, fill, Status.FILLED);
            } else {
                receipt.premiumBps = fill.premiumBps;
                _queue(s, acct, job, receipt, Reason.PREMIUM);
            }
        }
        return SleeveState.writeReceipt(s, env, job.account, receipt);
    }

    // Settle steps

    /// @dev The whole bucket at the current rule's caps (D-009 Q24): LedgersAboveBalance while an outside pull is
    /// unreconciled, since in PRD 7.2's order it may have taken part of the bucket (audit I-02); an empty bucket
    /// reverts BelowClip; a refusal sends the bucket to spend at any size (audit A1-31); otherwise BelowClip under the
    /// clip, the public grace, then GuardNotClear with no state change on a timing step, or the buy.
    function _settle(
        SleeveState.Store storage s,
        SleeveState.Env memory env,
        SleeveState.Account storage acct,
        Job memory job
    ) private returns (uint256) {
        ISleeveModule.Rule memory rule = acct.rule;
        uint256 shortfall =
            LedgerMath.shortfall(SleeveState.sortingBalance(env.usdg, job.account), acct.spend, acct.pendingTotal);
        if (shortfall != 0) revert ISleeveModule.LedgersAboveBalance(job.account, shortfall);
        ISleeveModule.Bucket memory bucket = s.buckets[job.account][job.tickerId];
        if (bucket.amount == 0) revert ISleeveModule.BelowClip(0, rule.minClip);
        job.amount = bucket.amount;
        Guard memory guard = _guard(env, job.account, job.tickerId, job.pool, false);
        if (!_refused(guard) && bucket.amount < rule.minClip) {
            revert ISleeveModule.BelowClip(bucket.amount, rule.minClip);
        }
        if (job.trigger == Trigger.PUBLIC) {
            uint256 readyAt = _settleReadyAt(bucket.since, guard, env.grace);
            if (block.timestamp < readyAt) revert ISleeveModule.GracePeriodActive(readyAt);
        }
        if (guard.outcome == Outcome.QUEUE) revert ISleeveModule.GuardNotClear(guard.reason);

        ISleeveModule.Receipt memory receipt = _receipt(job, rule.version, guard);
        receipt.usdgToEquity = bucket.amount;
        receipt.queuedSince = bucket.since;
        delete s.buckets[job.account][job.tickerId];
        acct.pendingTotal -= bucket.amount;
        if (guard.outcome == Outcome.BUY) {
            receipt.reason = bucket.reason;
            _settleBuy(s, rule, job, guard, receipt);
        } else {
            acct.spend = LedgerMath.creditSpend(acct.spend, bucket.amount).toUint128();
            receipt.usdgToSpend = bucket.amount;
            receipt.status = _refusal(guard.outcome);
        }
        return SleeveState.writeReceipt(s, env, job.account, receipt);
    }

    /// @dev The settle's buy: a fill above the premium cap reverts GuardNotClear(PREMIUM), which also undoes the
    /// bucket's removal.
    function _settleBuy(
        SleeveState.Store storage s,
        ISleeveModule.Rule memory rule,
        Job memory job,
        Guard memory guard,
        ISleeveModule.Receipt memory receipt
    ) private {
        (bool filled, ISleeveModule.BuyFill memory fill) = _buy(rule, job, guard, receipt);
        if (!filled) revert ISleeveModule.GuardNotClear(Reason.PREMIUM);
        _recordFill(s, receipt, job, guard, fill, Status.SETTLED);
    }

    /// @dev Brings spend, then the buckets in ascending ticker id, down to the balance, and writes RECONCILED with the
    /// totals and the Reconciled event with each bucket's cut (PRD 7.2, D-009 Q4, D-019). Nothing is unsorted after
    /// it, so the observed level drops to zero and income arriving later waits out its own grace (audit A1-25).
    function _reconcile(
        SleeveState.Store storage s,
        SleeveState.Env memory env,
        SleeveState.Account storage acct,
        address account,
        uint256 balance,
        Trigger trigger,
        uint32 ruleVersion
    ) private returns (uint256 receiptId) {
        (uint256 fromSpend, uint256[] memory fromBuckets) = LedgerMath.reconcile(
            balance, acct.spend, SleeveState.pendingByTicker(s, env.tokenSource, account)
        );
        acct.spend -= fromSpend.toUint128();
        uint256 fromPending = SleeveState.takeFromBuckets(s, account, fromBuckets);
        acct.pendingTotal -= fromPending.toUint128();
        SleeveState.clampObservation(acct, 0);
        ISleeveModule.Receipt memory receipt;
        receipt.ruleVersion = ruleVersion;
        receipt.trigger = trigger;
        receipt.status = Status.RECONCILED;
        receipt.usdgIn = fromSpend + fromPending;
        receipt.usdgSpent = fromSpend;
        receipt.usdgQueued = fromPending;
        receiptId = SleeveState.writeReceipt(s, env, account, receipt);
        emit ISleeveModule.Reconciled(account, receiptId, balance, fromSpend, fromBuckets);
    }

    /// @dev Adds the job's amount to the ticker's bucket with the reason, setting since when the bucket was empty, and
    /// fills the QUEUED receipt.
    function _queue(
        SleeveState.Store storage s,
        SleeveState.Account storage acct,
        Job memory job,
        ISleeveModule.Receipt memory receipt,
        Reason reason
    ) private {
        ISleeveModule.Bucket storage bucket = s.buckets[job.account][job.tickerId];
        if (bucket.amount == 0) bucket.since = block.timestamp.toUint64();
        uint128 amount = job.amount.toUint128();
        bucket.amount += amount;
        bucket.reason = reason;
        acct.pendingTotal += amount;
        receipt.status = Status.QUEUED;
        receipt.reason = reason;
        receipt.usdgQueued = job.amount;
    }

    // Guard and buy

    /// @dev PRD 7.4 steps 1 to 7, first failure wins. Step 1 refuses a removed ticker, one without a feed and one with
    /// no allowlisted pool; a trigger's pool off a non-empty allowlist reverts PoolNotAllowed, so a public caller
    /// cannot push equity into spend with a bad pool. Steps 2 to 7 are PriceGuard.checkBuy with the calendar's answer
    /// for the ticker's session type. A preview has no pool: it checks that the allowlist is non-empty and passes the
    /// account in the pool's place, which checkBuy tests for a block only after the account itself passed.
    function _guard(SleeveState.Env memory env, address account, uint8 tickerId, address pool, bool preview)
        private
        view
        returns (Guard memory guard)
    {
        SessionCalendar.SessionType sessionType;
        bool active;
        (guard.token, guard.feed, sessionType, active) = env.tokenSource.ticker(tickerId);
        (guard.open,, guard.openedAt) = env.calendar.sessionState(block.timestamp, sessionType);
        if (!active || guard.feed == address(0)) {
            guard.outcome = Outcome.REFUSE_TICKER;
            return guard;
        }
        if (preview || !env.tokenSource.isPoolAllowed(tickerId, pool)) {
            if (env.tokenSource.poolsOf(tickerId).length == 0) {
                guard.outcome = Outcome.REFUSE_TICKER;
                return guard;
            }
            if (!preview) revert ISleeveModule.PoolNotAllowed(tickerId, pool);
            pool = account;
        }
        guard.check = PriceGuard.checkBuy(
            IStockToken(guard.token),
            IAggregatorV3(guard.feed),
            env.usdgUsdFeed,
            account,
            pool,
            guard.open,
            guard.openedAt,
            env.params
        );
        if (guard.check.accountBlocked) {
            guard.outcome = Outcome.REFUSE_ACCOUNT;
        } else if (guard.check.reason != Reason.NONE) {
            guard.outcome = Outcome.QUEUE;
            guard.reason = guard.check.reason;
        }
    }

    /// @dev Runs the buy through the module's own executeBuy and fills the receipt's swap fields. A PremiumAboveCap
    /// revert, which undid the swap, comes back as filled false with its premium; any other revert bubbles, so nothing
    /// moves (D-009 Q12). minOut = amount * quote / 1e6 * (10,000 - slippageBps) / 10,000 (D-009 Q21). A quote whose
    /// product with the amount would make that mulDiv panic reverts QuoteTooLarge instead (audit A1-37).
    function _buy(
        ISleeveModule.Rule memory rule,
        Job memory job,
        Guard memory guard,
        ISleeveModule.Receipt memory receipt
    ) private returns (bool filled, ISleeveModule.BuyFill memory fill) {
        (uint256 high,) = Math.mul512(job.amount, job.quote);
        if (high >= QUOTE_UNIT) revert ISleeveModule.QuoteTooLarge(job.quote);
        uint256 minOut = Math.mulDiv(
            Math.mulDiv(job.amount, job.quote, QUOTE_UNIT), PriceGuard.BPS - rule.slippageBps, PriceGuard.BPS
        );
        receipt.quote = job.quote;
        receipt.minOut = minOut;
        receipt.venueId = VENUE_UNISWAP_V3;
        receipt.pool = job.pool;
        ISleeveModule.BuyOrder memory order = ISleeveModule.BuyOrder({
            account: job.account,
            token: guard.token,
            feed: guard.feed,
            pool: job.pool,
            amountIn: job.amount,
            minOut: minOut,
            answer: guard.check.answer,
            premiumCapBps: rule.premiumCapBps
        });
        try ISleeveModule(address(this)).executeBuy(order) returns (ISleeveModule.BuyFill memory done) {
            return (true, done);
        } catch (bytes memory reason) {
            // forge-lint: disable-next-line(unsafe-typecast)
            if (reason.length != 36 || bytes4(reason) != ISleeveModule.PremiumAboveCap.selector) {
                assembly ("memory-safe") {
                    revert(add(reason, 0x20), mload(reason))
                }
            }
            int256 premium;
            assembly ("memory-safe") {
                premium := mload(add(reason, 0x24))
            }
            fill.premiumBps = premium;
        }
    }

    /// @dev Fills a FILLED or SETTLED receipt from the measured buy, records the USDG that left in an open bracket's
    /// module delta, and creates the lot under the id the receipt is about to take.
    function _recordFill(
        SleeveState.Store storage s,
        ISleeveModule.Receipt memory receipt,
        Job memory job,
        Guard memory guard,
        ISleeveModule.BuyFill memory fill,
        Status status
    ) private {
        SleeveState.recordModuleDelta(job.account, -fill.usdgSpent.toInt256());
        receipt.status = status;
        receipt.usdgSpent = fill.usdgSpent;
        receipt.tokensOut = fill.tokensOut;
        receipt.execPrice = fill.execPrice;
        receipt.premiumBps = fill.premiumBps;
        receipt.tokenUid = IStockToken(guard.token).uid();
        receipt.uiMultiplier = IStockToken(guard.token).uiMultiplier();
        uint256 lotId = s.receipts.count + 1;
        receipt.lotId = lotId;
        SleeveState.createLot(s, lotId, job.account, job.tickerId, status, fill.tokensOut);
    }

    // Triggers and grace

    /// @dev Checks shared by split and settle and names the trigger: the account installed, OWNER, KEEPER or PUBLIC,
    /// no open bracket for keeper and public triggers, the rule ACTIVE, a non-zero quote, and the account still
    /// listing the module (D-019).
    function _enter(SleeveState.Store storage s, address account, uint256 quote)
        private
        view
        returns (SleeveState.Account storage acct, Trigger trigger)
    {
        acct = s.accounts[account];
        if (!acct.installed) revert ISleeveModule.NotInstalled(account);
        if (msg.sender == account) {
            trigger = Trigger.OWNER;
        } else {
            address keeper = acct.keeper;
            trigger = keeper != address(0) && msg.sender == keeper ? Trigger.KEEPER : Trigger.PUBLIC;
            if (SleeveState.ownerOpOpen(account)) revert ISleeveModule.OwnerOpOpen(account);
        }
        if (acct.rule.status != ISleeveModule.RuleStatus.ACTIVE) revert ISleeveModule.RuleNotActive(account);
        if (quote == 0) revert ISleeveModule.ZeroQuote();
        if (!SleeveState.listsModule(account)) revert ISleeveModule.ModuleNotListed(account);
    }

    /// @dev D-009 Q15: a public split needs an observation that covers the unsorted amount and the grace elapsed
    /// since it.
    function _requireSplitGrace(SleeveState.Account storage acct, uint256 grace, uint256 unsorted) private view {
        bool covered = _covers(acct, unsorted);
        uint256 readyAt = (covered ? acct.observedAt : block.timestamp) + grace;
        if (!covered || block.timestamp < readyAt) revert ISleeveModule.GracePeriodActive(readyAt);
    }

    /// @dev Whether the running observation covers this much unsorted USDG: growth under OBSERVE_RESTART_GROWTH rides
    /// it. observe, the public split and previewSplit all use it, so they agree (audit S-01).
    function _covers(SleeveState.Account storage acct, uint256 unsorted) private view returns (bool) {
        return acct.observedAt != 0 && unsorted < uint256(acct.observedUnsorted) + OBSERVE_RESTART_GROWTH;
    }

    /// @dev D-009 Q16 as amended by audit A1-05: the grace after the later of the bucket's since and the open session's
    /// opening instant. It reads no account-wide observation, so a split, an observe or a settle of another bucket
    /// cannot move it, and the keeper still has the first hour after each reopen.
    function _settleReadyAt(uint256 since, Guard memory guard, uint256 grace) private pure returns (uint256) {
        return (guard.open ? Math.max(since, guard.openedAt) : since) + grace;
    }

    /// @dev Any sort that writes a receipt ends the public-trigger clock, so the next payment waits out its own grace.
    /// A settle leaves it alone: its readiness comes from the bucket and the session.
    function _clearObservation(SleeveState.Account storage acct) private {
        if (acct.observedAt == 0) return;
        acct.observedAt = 0;
        acct.observedUnsorted = 0;
    }

    // Receipts

    /// @dev A receipt with the job's trigger and ticker, the rule version, and what the guard read.
    function _receipt(Job memory job, uint32 ruleVersion, Guard memory guard)
        private
        pure
        returns (ISleeveModule.Receipt memory receipt)
    {
        receipt.ruleVersion = ruleVersion;
        receipt.trigger = job.trigger;
        receipt.tickerId = job.tickerId;
        receipt.token = guard.token;
        receipt.roundId = guard.check.roundId;
        receipt.answer = guard.check.answer;
        receipt.updatedAt = guard.check.updatedAt;
        receipt.usdgRoundId = guard.check.usdgRoundId;
        receipt.usdgAnswer = guard.check.usdgAnswer;
    }

    /// @dev Whether the guard sends the equity to spend (PRD 7.4 steps 1 and 2).
    function _refused(Guard memory guard) private pure returns (bool) {
        return guard.outcome == Outcome.REFUSE_TICKER || guard.outcome == Outcome.REFUSE_ACCOUNT;
    }

    /// @dev The receipt status of a refusal outcome.
    function _refusal(Outcome outcome) private pure returns (Status) {
        return outcome == Outcome.REFUSE_TICKER ? Status.REFUSED_TICKER : Status.REFUSED_ACCOUNT;
    }

    /// @dev A preview's status, reason and buy flag from the guard and the clip.
    function _verdict(Guard memory guard, bool belowClip, Status buyStatus)
        private
        pure
        returns (Status status, Reason reason, bool buy)
    {
        if (guard.outcome == Outcome.REFUSE_TICKER || guard.outcome == Outcome.REFUSE_ACCOUNT) {
            return (_refusal(guard.outcome), Reason.NONE, false);
        }
        if (guard.outcome == Outcome.QUEUE) return (Status.QUEUED, guard.reason, false);
        if (belowClip) return (Status.QUEUED, Reason.CLIP, false);
        return (buyStatus, Reason.NONE, true);
    }
}
