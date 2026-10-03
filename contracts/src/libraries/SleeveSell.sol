// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Execution, IERC7579Execution} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {IAccessControlsRegistry} from "../interfaces/IAccessControlsRegistry.sol";
import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";
import {ISleeveModule} from "../interfaces/ISleeveModule.sol";
import {IStockToken} from "../interfaces/IStockToken.sol";
import {ISwapRouter02} from "../interfaces/ISwapRouter02.sol";
import {IUniswapV3Pool} from "../interfaces/IUniswapV3Pool.sol";
import {Reason, Status, Trigger} from "../types/SleeveTypes.sol";
import {LedgerMath} from "./LedgerMath.sol";
import {PriceGuard} from "./PriceGuard.sol";
import {SessionCalendar} from "./SessionCalendar.sol";
import {SleeveReceipts} from "./SleeveReceipts.sol";
import {SleeveState} from "./SleeveState.sol";

/// @title SleeveSell
/// @notice Sell-back and the lot reconcile (docs/SPEC.md sections 12 and 14, PRD 7.5): the lots a sell takes from,
/// the guard mirrored from the buy with the off-hours override, one swap on the account through executeFromExecutor
/// checked by balance, the proceeds to spend, and one receipt per lot. External library, reached by DELEGATECALL from
/// SleeveModule, so it runs as the module: msg.sender is the account that called the module, address(this) is the
/// module, and the account sees the module as its executor (D-019).
/// @dev The module's entry points hold the reentrancy lock around every call here. A sell reverts on every failed
/// step, so no step queues anything: the steps the override cannot skip revert GuardNotClear, the two it can skip
/// revert SellWaits (B2-13), and they come last so a sell the override cannot help never offers it.
library SleeveSell {
    using SafeCast for uint256;

    /// @notice One sell as SleeveModule.sell takes it. See ISleeveModule.sell.
    struct Order {
        uint8 tickerId;
        uint256 tokenAmount;
        uint256 lotId;
        address pool;
        uint256 quote;
        bool overrideClosed;
        uint16 overrideCapBps;
    }

    /// @dev The lots a sell takes from, oldest first, how many tokens each gives, and the status each moves to. Only
    /// the first count entries are used.
    struct Plan {
        uint256[] lotIds;
        uint256[] takes;
        uint256 count;
        Status[] statuses;
    }

    /// @dev What the guard read and the swap measured, carried to the receipts.
    struct Sale {
        address account;
        address token;
        address feed;
        uint16 capBps;
        uint256 minOut;
        uint80 roundId;
        int256 answer;
        uint256 updatedAt;
        uint80 usdgRoundId;
        int256 usdgAnswer;
        uint256 usdgOut;
        uint256 execPrice;
        int256 discountBps;
    }

    /// @notice The widest discount cap a sell may ask for, SleeveModule.MAX_PREMIUM_CAP_BPS (B2-14, Q18).
    uint16 internal constant MAX_CAP_BPS = 500;

    /// @dev A sell's quote is in USDG base units per this many token base units (D-009 Q21).
    uint256 private constant QUOTE_UNIT = 1e18;

    /// @dev Receipt venue id of Uniswap v3 through SwapRouter02.
    uint8 private constant VENUE_UNISWAP_V3 = 1;

    /// @dev ERC-7579 mode: batch call type, default exec type (revert on failure), no selector or payload.
    bytes32 private constant BATCH_MODE = bytes32(uint256(1) << 248);

    uint8 private constant USDG_DECIMALS = 6;

    // Entry points

    /// @notice Sells the calling account's lot tokens. See ISleeveModule.sell.
    /// @dev Caller: SleeveModule.sell, for the account itself.
    /// @return firstReceiptId The receipt of the first lot the sell took from.
    function sell(SleeveState.Store storage s, SleeveState.Env memory env, Order memory order)
        external
        returns (uint256 firstReceiptId)
    {
        address account = msg.sender;
        SleeveState.Account storage acct = _enter(s, account, order);
        Plan memory plan = _plan(s, account, order);
        Sale memory sale;
        sale.account = account;
        sale.capBps = order.overrideCapBps == 0 ? acct.rule.premiumCapBps : order.overrideCapBps;
        sale.minOut = Math.mulDiv(
            Math.mulDiv(order.tokenAmount, order.quote, QUOTE_UNIT),
            PriceGuard.BPS - acct.rule.slippageBps,
            PriceGuard.BPS
        );
        SessionCalendar.SessionType sessionType;
        (sale.token, sale.feed, sessionType,) = env.tokenSource.ticker(order.tickerId);
        if (sale.feed == address(0)) revert ISleeveModule.TickerHasNoFeed(order.tickerId);
        if (!env.tokenSource.isPoolAllowed(order.tickerId, order.pool)) {
            revert ISleeveModule.PoolNotAllowed(order.tickerId, order.pool);
        }
        uint256 balance = IERC20(sale.token).balanceOf(account);
        if (balance < order.tokenAmount) revert ISleeveModule.ExceedsBalance(order.tokenAmount, balance);
        _guard(env, sale, order, sessionType);

        _takeFromLots(s, account, order.tickerId, plan);
        sale.usdgOut = _swap(env, sale, order);
        _price(env, sale, order.tokenAmount);
        acct.spend = LedgerMath.creditSpend(acct.spend, sale.usdgOut).toUint128();
        SleeveState.recordModuleDelta(account, sale.usdgOut.toInt256());
        firstReceiptId = _writeReceipts(s, env, plan, sale, _receipt(acct.rule.version, order, sale), order.tokenAmount);
    }

    /// @notice Trims the calling account's lots of a ticker down to its token balance. See
    /// ISleeveModule.reconcileLots.
    /// @dev Caller: SleeveModule.reconcileLots, for the account itself.
    /// @return firstReceiptId The RECONCILED receipt of the newest lot trimmed, or 0 when nothing was trimmed.
    function reconcileLots(SleeveState.Store storage s, SleeveState.Env memory env, uint8 tickerId)
        external
        returns (uint256 firstReceiptId)
    {
        address account = msg.sender;
        SleeveState.Account storage acct = s.accounts[account];
        if (!acct.installed) revert ISleeveModule.NotInstalled(account);
        SleeveState.LotQueue storage queue = s.lotQueues[account][tickerId];
        uint256 lotTokens;
        for (uint256 i = queue.head; i < queue.ids.length; ++i) {
            lotTokens += s.lots[queue.ids[i]].tokensRemaining;
        }
        if (lotTokens == 0) return 0;
        // Lots exist only for tickers TokenSource listed, so ticker() does not revert here.
        ISleeveModule.Receipt memory receipt;
        (receipt.token,,,) = env.tokenSource.ticker(tickerId);
        uint256 balance = IERC20(receipt.token).balanceOf(account);
        if (lotTokens <= balance) return 0;
        receipt.ruleVersion = acct.rule.version;
        receipt.trigger = Trigger.OWNER;
        receipt.status = Status.RECONCILED;
        receipt.tickerId = tickerId;
        firstReceiptId = _trimLots(s, env, account, queue, receipt, lotTokens - balance);
        emit ISleeveModule.LotsReconciled(account, tickerId, balance, lotTokens - balance);
    }

    // Checks

    /// @dev The checks that need no token or feed: an installed account, a non-zero amount and quote, the override
    /// cap in range, and the account still listing the module (D-019).
    function _enter(SleeveState.Store storage s, address account, Order memory order)
        private
        view
        returns (SleeveState.Account storage acct)
    {
        acct = s.accounts[account];
        if (!acct.installed) revert ISleeveModule.NotInstalled(account);
        if (order.tokenAmount == 0) revert ISleeveModule.ZeroAmount();
        if (order.quote == 0) revert ISleeveModule.ZeroQuote();
        uint16 ruleCap = acct.rule.premiumCapBps;
        uint16 overrideCap = order.overrideCapBps;
        if (overrideCap != 0 && (overrideCap < ruleCap || overrideCap > MAX_CAP_BPS)) {
            revert ISleeveModule.OverrideCapOutOfRange(overrideCap, ruleCap, MAX_CAP_BPS);
        }
        if (!SleeveState.listsModule(account)) revert ISleeveModule.ModuleNotListed(account);
    }

    /// @dev The lots the sell takes from, read only. By lot: that lot, which must be the account's and the ticker's
    /// and hold the amount. By amount: the account's lots of the ticker from the queue's head, oldest first, skipping
    /// empty ones, until the amount is covered; when it is not, every lot was read and ExceedsLots reports their sum.
    function _plan(SleeveState.Store storage s, address account, Order memory order)
        private
        view
        returns (Plan memory plan)
    {
        if (order.lotId != 0) {
            ISleeveModule.Lot storage entry = s.lots[order.lotId];
            if (entry.account == address(0)) revert ISleeveModule.UnknownLot(order.lotId);
            if (entry.account != account || entry.tickerId != order.tickerId) {
                revert ISleeveModule.LotMismatch(order.lotId);
            }
            uint256 remaining = entry.tokensRemaining;
            if (remaining < order.tokenAmount) revert ISleeveModule.ExceedsLots(order.tokenAmount, remaining);
            plan.lotIds = new uint256[](1);
            plan.takes = new uint256[](1);
            (plan.lotIds[0], plan.takes[0], plan.count) = (order.lotId, order.tokenAmount, 1);
            return plan;
        }
        SleeveState.LotQueue storage queue = s.lotQueues[account][order.tickerId];
        uint256 length = queue.ids.length;
        uint256 head = queue.head;
        plan.lotIds = new uint256[](length - head);
        plan.takes = new uint256[](length - head);
        uint256 needed = order.tokenAmount;
        for (uint256 i = head; i < length && needed != 0; ++i) {
            uint256 lotId = queue.ids[i];
            uint256 remaining = s.lots[lotId].tokensRemaining;
            if (remaining == 0) continue;
            uint256 take = Math.min(remaining, needed);
            (plan.lotIds[plan.count], plan.takes[plan.count]) = (lotId, take);
            ++plan.count;
            needed -= take;
        }
        if (needed != 0) revert ISleeveModule.ExceedsLots(order.tokenAmount, order.tokenAmount - needed);
    }

    /// @dev The guard mirrored from the buy (PRD 7.4 and 7.5), first failure wins: the account, the pool and the
    /// router off the blocklist, then PAUSED, ORACLE_PAUSED, MULTIPLIER and DEPEG, which revert GuardNotClear with or
    /// without the override, then SESSION and the stock round's age and fresh-round-after-reopen check, which revert
    /// SellWaits unless overrideClosed skips them. With the override the round must still have a positive answer and
    /// not come from the future, else GuardNotClear(STALE). Stores the rounds read for the receipts.
    function _guard(
        SleeveState.Env memory env,
        Sale memory sale,
        Order memory order,
        SessionCalendar.SessionType sessionType
    ) private view {
        IStockToken token = IStockToken(sale.token);
        (bool accountBlocked, Reason reason) = PriceGuard.checkToken(token, sale.account, order.pool);
        if (accountBlocked) revert ISleeveModule.AccountBlocked(sale.account);
        address router = address(env.swapRouter);
        if (IAccessControlsRegistry(token.ACCESS_CONTROLLED_REGISTRY()).isBlocked(router)) {
            revert ISleeveModule.RouterBlocked(router);
        }
        if (reason == Reason.NONE) reason = PriceGuard.checkMultiplier(token, env.params.multiplierWindow);
        if (reason == Reason.NONE) {
            (reason, sale.usdgRoundId, sale.usdgAnswer) =
                PriceGuard.checkUsdg(env.usdgUsdFeed, env.params.depegToleranceBps, env.params.usdgFeedMaxAge);
        }
        if (reason != Reason.NONE) revert ISleeveModule.GuardNotClear(reason);

        uint256 maxAge = type(uint256).max;
        uint256 openedAt;
        if (!order.overrideClosed) {
            bool open;
            (open,, openedAt) = env.calendar.sessionState(block.timestamp, sessionType);
            if (!open) revert ISleeveModule.SellWaits(Reason.SESSION);
            maxAge = env.params.stockFeedMaxAge;
        }
        (reason, sale.roundId, sale.answer, sale.updatedAt) =
            PriceGuard.readStockFeed(IAggregatorV3(sale.feed), maxAge, openedAt);
        if (reason != Reason.NONE) {
            if (order.overrideClosed) revert ISleeveModule.GuardNotClear(reason);
            revert ISleeveModule.SellWaits(reason);
        }
    }

    // Lots

    /// @dev Takes the plan's tokens off its lots and moves each to PART_SOLD, or SOLD when it is empty (I7), then
    /// moves the queue's head past the empty lots at its front. Runs before the swap, which reverts it all on failure.
    function _takeFromLots(SleeveState.Store storage s, address account, uint8 tickerId, Plan memory plan) private {
        plan.statuses = new Status[](plan.count);
        for (uint256 i; i < plan.count; ++i) {
            uint256 lotId = plan.lotIds[i];
            ISleeveModule.Lot storage entry = s.lots[lotId];
            uint128 left = entry.tokensRemaining - plan.takes[i].toUint128();
            entry.tokensRemaining = left;
            plan.statuses[i] = left == 0 ? Status.SOLD : Status.PART_SOLD;
            SleeveState.transitionLot(s, lotId, plan.statuses[i]);
        }
        _advanceHead(s, s.lotQueues[account][tickerId]);
    }

    /// @dev Moves the queue's head past the lots at its front that hold no tokens, so sells by amount start at the
    /// oldest lot that may still hold some.
    function _advanceHead(SleeveState.Store storage s, SleeveState.LotQueue storage queue) private {
        uint256 head = queue.head;
        uint256 next = head;
        uint256 length = queue.ids.length;
        while (next < length && s.lots[queue.ids[next]].tokensRemaining == 0) {
            ++next;
        }
        if (next != head) queue.head = next;
    }

    /// @dev Trims `excess` tokens off the queue's lots, newest first, and writes one RECONCILED receipt per lot it
    /// trims, with the trim as tokensIn and the lot as lotId. Statuses stay as they are.
    /// @return firstReceiptId The first receipt's id.
    function _trimLots(
        SleeveState.Store storage s,
        SleeveState.Env memory env,
        address account,
        SleeveState.LotQueue storage queue,
        ISleeveModule.Receipt memory receipt,
        uint256 excess
    ) private returns (uint256 firstReceiptId) {
        uint32 calendarVersion = env.calendar.version();
        for (uint256 i = queue.ids.length; i > queue.head && excess != 0;) {
            --i;
            uint256 lotId = queue.ids[i];
            uint256 trim = _trimLot(s.lots[lotId], excess);
            if (trim == 0) continue;
            excess -= trim;
            receipt.tokensIn = trim;
            receipt.lotId = lotId;
            uint256 id = SleeveReceipts.write(s.receipts, account, receipt, calendarVersion, env.disclosureHash);
            if (firstReceiptId == 0) firstReceiptId = id;
        }
        _advanceHead(s, queue);
    }

    /// @dev Takes up to `excess` tokens off the lot's remainder.
    /// @return trim The tokens taken, zero for an empty lot.
    function _trimLot(ISleeveModule.Lot storage entry, uint256 excess) private returns (uint256 trim) {
        uint256 remaining = entry.tokensRemaining;
        trim = Math.min(remaining, excess);
        if (trim != 0) entry.tokensRemaining = (remaining - trim).toUint128();
    }

    // Swap

    /// @dev Runs the three calls on the account and checks the postconditions by balance: exactly tokenAmount left
    /// the account (PartialFill), USDG arrived and is at least minOut (TooLittleUsdg), the router's token allowance
    /// is zero again (AllowanceNotReset, I4), and the module's own USDG and token balances did not change
    /// (ModuleHoldsFunds, I1, measured as a delta as in SleeveBuy). Any failing call bubbles its own revert, so a
    /// minimum-out failure is the router's.
    /// @return usdgOut USDG that arrived in the account.
    function _swap(SleeveState.Env memory env, Sale memory sale, Order memory order) private returns (uint256 usdgOut) {
        IERC20 token = IERC20(sale.token);
        uint256 moduleUsdg = env.usdg.balanceOf(address(this));
        uint256 moduleTokens = token.balanceOf(address(this));
        uint256 tokensSpent;
        (tokensSpent, usdgOut) = _run(env, sale, order);
        if (tokensSpent != order.tokenAmount) revert ISleeveModule.PartialFill(order.tokenAmount, tokensSpent);
        if (usdgOut == 0 || usdgOut < sale.minOut) revert ISleeveModule.TooLittleUsdg(usdgOut, sale.minOut);
        uint256 allowance = token.allowance(sale.account, address(env.swapRouter));
        if (allowance != 0) revert ISleeveModule.AllowanceNotReset(allowance);
        _requireNothingKept(env.usdg, moduleUsdg);
        _requireNothingKept(token, moduleTokens);
    }

    /// @dev The batch on the account, measured on the account's balances.
    /// @return tokensSpent Tokens that left the account.
    /// @return usdgOut USDG that arrived.
    function _run(SleeveState.Env memory env, Sale memory sale, Order memory order)
        private
        returns (uint256 tokensSpent, uint256 usdgOut)
    {
        IERC20 token = IERC20(sale.token);
        address account = sale.account;
        uint256 tokensBefore = token.balanceOf(account);
        uint256 usdgBefore = env.usdg.balanceOf(account);
        IERC7579Execution(account).executeFromExecutor(BATCH_MODE, abi.encode(_calls(env, sale, order)));
        uint256 tokensAfter = token.balanceOf(account);
        tokensSpent = tokensBefore > tokensAfter ? tokensBefore - tokensAfter : 0;
        uint256 usdgAfter = env.usdg.balanceOf(account);
        usdgOut = usdgAfter > usdgBefore ? usdgAfter - usdgBefore : 0;
    }

    /// @dev The only batch a sell has the account run (D-019): exact approval of the token, the swap to the account,
    /// and the approval back to zero.
    function _calls(SleeveState.Env memory env, Sale memory sale, Order memory order)
        private
        view
        returns (Execution[] memory calls)
    {
        address router = address(env.swapRouter);
        ISwapRouter02.ExactInputSingleParams memory params = ISwapRouter02.ExactInputSingleParams({
            tokenIn: sale.token,
            tokenOut: address(env.usdg),
            fee: IUniswapV3Pool(order.pool).fee(),
            recipient: sale.account,
            amountIn: order.tokenAmount,
            amountOutMinimum: sale.minOut,
            sqrtPriceLimitX96: 0
        });
        calls = new Execution[](3);
        calls[0] = Execution(sale.token, 0, abi.encodeCall(IERC20.approve, (router, order.tokenAmount)));
        calls[1] = Execution(router, 0, abi.encodeCall(ISwapRouter02.exactInputSingle, (params)));
        calls[2] = Execution(sale.token, 0, abi.encodeCall(IERC20.approve, (router, 0)));
    }

    /// @dev I1: the sell left the module's balance of the asset as it was.
    function _requireNothingKept(IERC20 asset, uint256 heldBefore) private view {
        uint256 held = asset.balanceOf(address(this));
        if (held != heldBefore) revert ISleeveModule.ModuleHoldsFunds(address(asset), held);
    }

    /// @dev The sale's price and discount against the round the guard read, with the three decimals read from their
    /// contracts and asserted, because swapped arguments would silently loosen the cap. Reverts DiscountAboveCap when
    /// usdgOut * 10^(token + feed - usdg) * 10,000 < tokensIn * answer * (10,000 - cap), which undoes the swap.
    function _price(SleeveState.Env memory env, Sale memory sale, uint256 tokensIn) private view {
        uint8 usdgDecimals = _decimals(address(env.usdg), IERC20Metadata(address(env.usdg)).decimals(), USDG_DECIMALS);
        uint8 tokenDecimals = _decimals(sale.token, IERC20Metadata(sale.token).decimals(), PriceGuard.TOKEN_DECIMALS);
        uint8 feedDecimals = _decimals(sale.feed, IAggregatorV3(sale.feed).decimals(), PriceGuard.FEED_DECIMALS);
        sale.discountBps =
            PriceGuard.discountBps(sale.usdgOut, tokensIn, sale.answer, usdgDecimals, tokenDecimals, feedDecimals);
        if (PriceGuard.exceedsDiscount(
                sale.usdgOut, tokensIn, sale.answer, sale.capBps, usdgDecimals, tokenDecimals, feedDecimals
            )) revert ISleeveModule.DiscountAboveCap(sale.discountBps, sale.capBps);
        sale.execPrice = PriceGuard.execPriceSell(sale.usdgOut, tokensIn);
    }

    /// @dev Returns the decimals a contract reported once they equal what the arithmetic assumes.
    function _decimals(address source, uint8 decimals, uint8 expected) private pure returns (uint8) {
        if (decimals != expected) revert ISleeveModule.UnexpectedDecimals(source, decimals, expected);
        return decimals;
    }

    // Receipts

    /// @dev One PART_SOLD or SOLD receipt per lot, in the plan's order, with ids from the next one on. Each lot's
    /// share of the proceeds is usdgOut * take / tokenAmount rounded down, and the last lot takes what is left, so the
    /// shares sum to usdgOut. The other fields are the whole sell's, from `receipt`.
    /// @return firstReceiptId The first receipt's id.
    function _writeReceipts(
        SleeveState.Store storage s,
        SleeveState.Env memory env,
        Plan memory plan,
        Sale memory sale,
        ISleeveModule.Receipt memory receipt,
        uint256 tokenAmount
    ) private returns (uint256 firstReceiptId) {
        firstReceiptId = s.receipts.count + 1;
        uint32 calendarVersion = env.calendar.version();
        uint256 paid;
        for (uint256 i; i < plan.count; ++i) {
            uint256 share =
                i + 1 == plan.count ? sale.usdgOut - paid : Math.mulDiv(sale.usdgOut, plan.takes[i], tokenAmount);
            paid += share;
            receipt.status = plan.statuses[i];
            receipt.tokensIn = plan.takes[i];
            receipt.usdgOut = share;
            receipt.usdgToSpend = share;
            receipt.lotId = plan.lotIds[i];
            SleeveReceipts.write(s.receipts, sale.account, receipt, calendarVersion, env.disclosureHash);
        }
    }

    /// @dev The fields every receipt of the sell shares.
    function _receipt(uint32 ruleVersion, Order memory order, Sale memory sale)
        private
        view
        returns (ISleeveModule.Receipt memory receipt)
    {
        receipt.ruleVersion = ruleVersion;
        receipt.trigger = Trigger.OWNER;
        receipt.tickerId = order.tickerId;
        receipt.token = sale.token;
        receipt.tokenUid = IStockToken(sale.token).uid();
        receipt.uiMultiplier = IStockToken(sale.token).uiMultiplier();
        receipt.execPrice = sale.execPrice;
        receipt.premiumBps = sale.discountBps;
        receipt.roundId = sale.roundId;
        receipt.answer = sale.answer;
        receipt.updatedAt = sale.updatedAt;
        receipt.usdgRoundId = sale.usdgRoundId;
        receipt.usdgAnswer = sale.usdgAnswer;
        receipt.quote = order.quote;
        receipt.minOut = sale.minOut;
        receipt.venueId = VENUE_UNISWAP_V3;
        receipt.pool = order.pool;
        receipt.overrideClosed = order.overrideClosed;
        receipt.overrideCapBps = order.overrideCapBps;
    }
}
