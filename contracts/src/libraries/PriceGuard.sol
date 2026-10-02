// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAccessControlsRegistry} from "../interfaces/IAccessControlsRegistry.sol";
import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";
import {IStockToken} from "../interfaces/IStockToken.sol";
import {GuardParams, Reason} from "../types/SleeveTypes.sol";

/// @title PriceGuard
/// @notice The guard SleeveModule runs before a buy, and the premium arithmetic its receipts carry. PRD 7.4, 7.11 and
/// docs/SPEC.md section 4. Reads go to the live token, its registry and the feed proxies on every call, so the guard
/// follows the issuer's current state (D-011).
///
/// Guard steps in PRD 7.4 order and what each gives the module:
///
/// 1. Ticker known, active, with a feed, pool allowlisted: the module checks this against TokenSource before calling.
///    Failing it is REFUSED_TICKER.
/// 2. The token registry's isBlocked(account): `accountBlocked` true, the REFUSED_ACCOUNT signal. Reason stays NONE
///    and the module sends the equity part to spend. isBlocked(pool) reverts PoolBlocked, because the swap would revert
///    anyway and the trigger can pass another allowlisted pool. A blocked account wins over a blocked pool.
/// 3. token.paused() gives PAUSED, then token.oraclePaused() gives ORACLE_PAUSED.
/// 4. The module's calendar answer: closed gives SESSION.
/// 5. A multiplier change due inside the window gives MULTIPLIER.
/// 6. The stock feed: a non-positive answer, a round from the future, a round older than the maximum age, or a round
///    from before the current session opened gives STALE.
/// 7. The USDG/USD feed: outside 1 plus or minus the tolerance, non-positive, from the future or too old gives DEPEG.
/// 8. CLIP and 9. PREMIUM are the module's: the clip compares the equity part with the rule, and the premium is
///    exceedsPremium on the balances measured around the swap.
///
/// NONE with accountBlocked false means every step this library ran passed. A blocked account returns accountBlocked
/// true with reason NONE, so callers check accountBlocked before reason. A failed market condition is returned, never
/// reverted. Malformed
/// input reverts with a named error: a zero address, decimals other than 18 for a token or 8 for a feed, a tolerance
/// or discount cap above 10,000 bps, a non-positive answer given to the premium arithmetic.
/// @dev Internal functions only, inlined into the module. No storage and no events.
library PriceGuard {
    /// @notice Basis points in a whole.
    uint256 internal constant BPS = 10_000;

    int256 private constant SIGNED_BPS = 10_000;

    /// @notice Decimals every stock token must report.
    uint8 internal constant TOKEN_DECIMALS = 18;

    /// @notice Decimals every feed must report, stock feeds and the USDG/USD feed alike.
    uint8 internal constant FEED_DECIMALS = 8;

    /// @notice Token amount an execution price is quoted per: USDG base units per 1e18 token base units.
    uint256 internal constant PRICE_UNIT = 1e18;

    /// @notice Largest tokenDecimals + feedDecimals - usdgDecimals the premium arithmetic takes, so that
    /// 10^exponent * 10,000 fits in a uint256.
    uint256 internal constant MAX_SCALE_EXPONENT = 73;

    /// @notice D-014: a stock feed round counts for 25 hours, the 24-hour heartbeat plus a margin (PRD 7.3).
    uint256 internal constant DEFAULT_STOCK_FEED_MAX_AGE = 25 hours;

    /// @notice D-014: the USDG/USD round counts for 25 hours. It runs on a 24-hour heartbeat and is routinely 23 to 24
    /// hours old.
    uint256 internal constant DEFAULT_USDG_FEED_MAX_AGE = 25 hours;

    /// @notice D-014: USDG/USD within 50 bps of 1, the feed's own deviation trigger.
    uint16 internal constant DEFAULT_DEPEG_TOLERANCE_BPS = 50;

    /// @notice D-014: queue while a multiplier change is scheduled within the next 24 hours. No after-clause.
    uint256 internal constant DEFAULT_MULTIPLIER_WINDOW = 24 hours;

    /// @notice What checkBuy found, with the round data a receipt records.
    /// @param accountBlocked The REFUSED_ACCOUNT signal. When true, reason is NONE and no later step ran.
    /// @param reason The first failing step's reason, or NONE.
    /// @param roundId The stock feed round read, or zero when an earlier step failed.
    /// @param answer That round's answer, 8 decimals, already including the multiplier.
    /// @param updatedAt That round's updatedAt.
    /// @param usdgRoundId The USDG/USD round read, or zero when an earlier step failed.
    /// @param usdgAnswer That round's answer.
    struct BuyCheck {
        bool accountBlocked;
        Reason reason;
        uint80 roundId;
        int256 answer;
        uint256 updatedAt;
        uint80 usdgRoundId;
        int256 usdgAnswer;
    }

    /// @notice A token or feed address is zero.
    error ZeroAddress();

    /// @notice A token or feed reports decimals other than the ones Sleeve's arithmetic assumes.
    /// @param source The token or feed.
    /// @param decimals What it reported.
    /// @param expected 18 for a stock token, 8 for a feed.
    error UnexpectedDecimals(address source, uint8 decimals, uint8 expected);

    /// @notice The token's ACCESS_CONTROLLED_REGISTRY() is zero, so there is no blocklist to read.
    /// @param token The token.
    error NoRegistry(address token);

    /// @notice The pool the trigger picked is on the token's blocklist, so the swap would revert. Pick another
    /// allowlisted pool.
    /// @param pool The blocked pool.
    error PoolBlocked(address pool);

    /// @notice A depeg tolerance above 10,000 bps.
    /// @param toleranceBps The tolerance given.
    error ToleranceAboveTotal(uint16 toleranceBps);

    /// @notice A discount cap above 10,000 bps.
    /// @param capBps The cap given.
    error DiscountCapAboveTotal(uint16 capBps);

    /// @notice The premium arithmetic was given a feed answer at or below zero.
    /// @param answer The answer given.
    error AnswerNotPositive(int256 answer);

    /// @notice tokenDecimals + feedDecimals is below usdgDecimals or exceeds it by more than MAX_SCALE_EXPONENT.
    error UnsupportedDecimals(uint8 usdgDecimals, uint8 tokenDecimals, uint8 feedDecimals);

    /// @notice A price was asked for a zero token amount.
    error ZeroTokenAmount();

    /// @notice A receipt figure does not fit its type: an execution price above type(uint256).max, a ratio above
    /// type(int256).max, or a token amount times answer above type(uint256).max. No real fill comes near.
    error PriceOutOfRange();

    /// @notice The D-014 guard parameters.
    function defaultGuardParams() internal pure returns (GuardParams memory) {
        return GuardParams({
            stockFeedMaxAge: DEFAULT_STOCK_FEED_MAX_AGE,
            usdgFeedMaxAge: DEFAULT_USDG_FEED_MAX_AGE,
            depegToleranceBps: DEFAULT_DEPEG_TOLERANCE_BPS,
            multiplierWindow: DEFAULT_MULTIPLIER_WINDOW
        });
    }

    /// @notice Runs guard steps 2 to 7 of PRD 7.4 in order and stops at the first failure. Step 1 is the module's
    /// TokenSource check before this call; steps 8 and 9 are the module's after it.
    /// @dev The session step takes the module's calendar answer, so the order stays PRD 7.4's while the calendar
    /// stays out of this library. Later steps do not run once one fails, so a failing step never reads a feed it does
    /// not need, and the round fields of steps that did not run are zero.
    /// @param token The ticker's stock token.
    /// @param feed The ticker's Chainlink feed proxy.
    /// @param usdgUsdFeed The USDG/USD feed proxy.
    /// @param account The Sleeve account that would receive the tokens.
    /// @param pool The allowlisted pool the trigger picked.
    /// @param sessionOpen Whether the calendar says the ticker's session is open now.
    /// @param sessionOpenedAt When the open session began. Read only when sessionOpen is true.
    /// @param params The guard limits.
    /// @return check The REFUSED_ACCOUNT signal, the first failing reason, and the rounds read.
    function checkBuy(
        IStockToken token,
        IAggregatorV3 feed,
        IAggregatorV3 usdgUsdFeed,
        address account,
        address pool,
        bool sessionOpen,
        uint256 sessionOpenedAt,
        GuardParams memory params
    ) internal view returns (BuyCheck memory check) {
        (check.accountBlocked, check.reason) = checkToken(token, account, pool);
        if (check.accountBlocked || check.reason != Reason.NONE) return check;
        if (!sessionOpen) {
            check.reason = Reason.SESSION;
            return check;
        }
        check.reason = checkMultiplier(token, params.multiplierWindow);
        if (check.reason != Reason.NONE) return check;
        (check.reason, check.roundId, check.answer, check.updatedAt) =
            readStockFeed(feed, params.stockFeedMaxAge, sessionOpenedAt);
        if (check.reason != Reason.NONE) return check;
        (check.reason, check.usdgRoundId, check.usdgAnswer) =
            checkUsdg(usdgUsdFeed, params.depegToleranceBps, params.usdgFeedMaxAge);
    }

    /// @notice Guard steps 2 and 3: the blocklist, then the pauses.
    /// @dev The registry comes from token.ACCESS_CONTROLLED_REGISTRY() on each call, which follows a beacon upgrade.
    /// token.paused() already ORs the registry's global pause.
    /// @param token The stock token. Must report 18 decimals.
    /// @param account The account that would receive the tokens.
    /// @param pool The pool that would send them.
    /// @return accountBlocked True when the registry blocks the account: the REFUSED_ACCOUNT signal.
    /// @return reason PAUSED, ORACLE_PAUSED or NONE. Always NONE when accountBlocked is true.
    function checkToken(IStockToken token, address account, address pool)
        internal
        view
        returns (bool accountBlocked, Reason reason)
    {
        if (address(token) == address(0)) revert ZeroAddress();
        uint8 decimals = token.decimals();
        if (decimals != TOKEN_DECIMALS) revert UnexpectedDecimals(address(token), decimals, TOKEN_DECIMALS);
        IAccessControlsRegistry registry = IAccessControlsRegistry(token.ACCESS_CONTROLLED_REGISTRY());
        if (address(registry) == address(0)) revert NoRegistry(address(token));
        if (registry.isBlocked(account)) return (true, Reason.NONE);
        if (registry.isBlocked(pool)) revert PoolBlocked(pool);
        if (token.paused()) return (false, Reason.PAUSED);
        if (token.oraclePaused()) return (false, Reason.ORACLE_PAUSED);
        return (false, Reason.NONE);
    }

    /// @notice Guard step 5: MULTIPLIER while a change to a different multiplier is scheduled at most `window` seconds
    /// ahead, that is newUIMultiplier() != uiMultiplier() and block.timestamp < effectiveAt() <= block.timestamp +
    /// window. Nothing queues once the change has taken effect (D-014, no after-clause).
    /// @param token The stock token.
    /// @param window How far ahead a change queues buys, in seconds.
    /// @return MULTIPLIER or NONE.
    function checkMultiplier(IStockToken token, uint256 window) internal view returns (Reason) {
        if (address(token) == address(0)) revert ZeroAddress();
        uint256 effectiveAt = token.effectiveAt();
        if (effectiveAt <= block.timestamp || effectiveAt - block.timestamp > window) return Reason.NONE;
        if (token.newUIMultiplier() == token.uiMultiplier()) return Reason.NONE;
        return Reason.MULTIPLIER;
    }

    /// @notice Guard step 6: reads the stock feed's latest round and judges it. STALE when the answer is at or below
    /// zero, updatedAt is after block.timestamp, block.timestamp - updatedAt > maxAge, or updatedAt < sessionOpenedAt,
    /// which refuses the round held over a closure until the first round after the reopen lands (B2-2).
    /// @dev The answer already includes the multiplier. The round is returned whatever the verdict.
    /// @param feed The feed proxy. Must report 8 decimals.
    /// @param maxAge Oldest round accepted, in seconds.
    /// @param sessionOpenedAt When the current session opened. A round from that second on counts.
    /// @return reason STALE or NONE.
    /// @return roundId The latest round id.
    /// @return answer Its answer.
    /// @return updatedAt Its updatedAt.
    function readStockFeed(IAggregatorV3 feed, uint256 maxAge, uint256 sessionOpenedAt)
        internal
        view
        returns (Reason reason, uint80 roundId, int256 answer, uint256 updatedAt)
    {
        if (address(feed) == address(0)) revert ZeroAddress();
        uint8 decimals = feed.decimals();
        if (decimals != FEED_DECIMALS) revert UnexpectedDecimals(address(feed), decimals, FEED_DECIMALS);
        (roundId, answer,, updatedAt,) = feed.latestRoundData();
        if (
            answer <= 0 || updatedAt > block.timestamp || block.timestamp - updatedAt > maxAge
                || updatedAt < sessionOpenedAt
        ) {
            reason = Reason.STALE;
        }
    }

    /// @notice Guard step 7: reads the USDG/USD feed's latest round. DEPEG when the answer is at or below zero,
    /// updatedAt is after block.timestamp, the round is more than maxAge old, or the answer is outside
    /// [one * (10,000 - toleranceBps), one * (10,000 + toleranceBps)] / 10,000, where one is 10^decimals at the feed's
    /// runtime decimals. Both band edges pass.
    /// @param usdgUsdFeed The USDG/USD feed proxy. Must report 8 decimals.
    /// @param toleranceBps How far from 1 the answer may sit, at most 10,000.
    /// @param maxAge Oldest round accepted, in seconds.
    /// @return reason DEPEG or NONE.
    /// @return roundId The latest round id, whatever the verdict.
    /// @return answer Its answer, whatever the verdict.
    function checkUsdg(IAggregatorV3 usdgUsdFeed, uint16 toleranceBps, uint256 maxAge)
        internal
        view
        returns (Reason reason, uint80 roundId, int256 answer)
    {
        if (address(usdgUsdFeed) == address(0)) revert ZeroAddress();
        if (toleranceBps > BPS) revert ToleranceAboveTotal(toleranceBps);
        uint8 decimals = usdgUsdFeed.decimals();
        if (decimals != FEED_DECIMALS) revert UnexpectedDecimals(address(usdgUsdFeed), decimals, FEED_DECIMALS);
        uint256 updatedAt;
        (roundId, answer,, updatedAt,) = usdgUsdFeed.latestRoundData();
        if (answer <= 0 || updatedAt > block.timestamp || block.timestamp - updatedAt > maxAge) {
            return (Reason.DEPEG, roundId, answer);
        }
        uint256 one = 10 ** decimals;
        uint256 price = _positive(answer);
        // Every band ends at or below 2 * one, and the bound keeps price * BPS far inside a uint256.
        if (price > 2 * one) return (Reason.DEPEG, roundId, answer);
        uint256 priceBps = price * BPS;
        if (priceBps < one * (BPS - toleranceBps) || priceBps > one * (BPS + toleranceBps)) reason = Reason.DEPEG;
    }

    /// @notice Whether a buy paid more than capBps above the feed price. True exactly when
    /// usdgSpent * 10^(tokenDecimals + feedDecimals - usdgDecimals) * 10,000 > tokensOut * answer * (10,000 + capBps).
    /// @dev Both sides are full 512-bit products, so the test is exact for every uint256 input and rounding never
    /// decides a fill (D-009 Q11). Equality passes. When the right side needs more than 512 bits it exceeds the left,
    /// which never does, and the buy passes. With 6, 18 and 8 decimals the scale is 10^20.
    /// @param usdgSpent USDG that left the account, in base units, measured by balance.
    /// @param tokensOut Tokens that arrived, in base units, measured by balance.
    /// @param answer The feed answer the guard read. Must be positive.
    /// @param capBps The premium cap in basis points.
    /// @param usdgDecimals USDG decimals, read at runtime.
    /// @param tokenDecimals Stock token decimals, read at runtime.
    /// @param feedDecimals Feed decimals, read at runtime.
    /// @return True when the fill is above the cap and must not stand.
    function exceedsPremium(
        uint256 usdgSpent,
        uint256 tokensOut,
        int256 answer,
        uint16 capBps,
        uint8 usdgDecimals,
        uint8 tokenDecimals,
        uint8 feedDecimals
    ) internal pure returns (bool) {
        (uint256 paidHigh, uint256 paidLow) =
            Math.mul512(usdgSpent, _usdgScale(usdgDecimals, tokenDecimals, feedDecimals));
        (bool overflow, uint256 limitHigh, uint256 limitLow) = _product512(tokensOut, _positive(answer), BPS + capBps);
        return !overflow && _greaterThan(paidHigh, paidLow, limitHigh, limitLow);
    }

    /// @notice Whether a sell received less than capBps below the feed price allows. True exactly when
    /// usdgOut * 10^(tokenDecimals + feedDecimals - usdgDecimals) * 10,000 < tokensIn * answer * (10,000 - capBps).
    /// @dev Exact for every uint256 input, as exceedsPremium. Equality passes. When the right side needs more than 512
    /// bits the sell fails. A cap of 10,000 accepts any proceeds.
    /// @param usdgOut USDG that arrived, in base units, measured by balance.
    /// @param tokensIn Tokens that left, in base units, measured by balance.
    /// @param answer The feed answer. Must be positive.
    /// @param capBps The discount cap in basis points, at most 10,000.
    /// @param usdgDecimals USDG decimals, read at runtime.
    /// @param tokenDecimals Stock token decimals, read at runtime.
    /// @param feedDecimals Feed decimals, read at runtime.
    /// @return True when the sale is below the cap and must not stand.
    function exceedsDiscount(
        uint256 usdgOut,
        uint256 tokensIn,
        int256 answer,
        uint16 capBps,
        uint8 usdgDecimals,
        uint8 tokenDecimals,
        uint8 feedDecimals
    ) internal pure returns (bool) {
        if (capBps > BPS) revert DiscountCapAboveTotal(capBps);
        (uint256 receivedHigh, uint256 receivedLow) =
            Math.mul512(usdgOut, _usdgScale(usdgDecimals, tokenDecimals, feedDecimals));
        (bool overflow, uint256 floorHigh, uint256 floorLow) = _product512(tokensIn, _positive(answer), BPS - capBps);
        return overflow || _greaterThan(floorHigh, floorLow, receivedHigh, receivedLow);
    }

    /// @notice A buy's execution price for its receipt: ceil(usdgSpent * 1e18 / tokensOut), USDG base units per 1e18
    /// token base units, rounded up, against the owner.
    /// @param usdgSpent USDG spent, in base units.
    /// @param tokensOut Tokens received, in base units. Must be above zero.
    /// @return The execution price. Reverts PriceOutOfRange when it does not fit a uint256.
    function execPriceBuy(uint256 usdgSpent, uint256 tokensOut) internal pure returns (uint256) {
        if (tokensOut == 0) revert ZeroTokenAmount();
        return _mulDivChecked(usdgSpent, PRICE_UNIT, tokensOut, true);
    }

    /// @notice A sell's execution price for its receipt: floor(usdgOut * 1e18 / tokensIn), USDG base units per 1e18
    /// token base units, rounded down, against the owner.
    /// @param usdgOut USDG received, in base units.
    /// @param tokensIn Tokens sold, in base units. Must be above zero.
    /// @return The execution price. Reverts PriceOutOfRange when it does not fit a uint256.
    function execPriceSell(uint256 usdgOut, uint256 tokensIn) internal pure returns (uint256) {
        if (tokensIn == 0) revert ZeroTokenAmount();
        return _mulDivChecked(usdgOut, PRICE_UNIT, tokensIn, false);
    }

    /// @notice A buy's premium over the feed price for its receipt, in signed basis points rounded up, against the
    /// owner: ceil(10,000 * usdgSpent * 10^(tokenDecimals + feedDecimals - usdgDecimals) / (tokensOut * answer)) -
    /// 10,000, the ceiling of the exact premium 10,000 * (execution price / feed price - 1). Negative when the fill
    /// beat the feed.
    /// @dev Because the rounding is a ceiling and caps are whole basis points, premiumBps > capBps exactly when
    /// exceedsPremium is true, so a receipt never shows a passing fill above its cap. Reverts PriceOutOfRange when
    /// tokensOut * answer or the ratio does not fit, which no real fill approaches.
    /// @param usdgSpent USDG spent, in base units.
    /// @param tokensOut Tokens received, in base units. Must be above zero.
    /// @param answer The feed answer. Must be positive.
    /// @param usdgDecimals USDG decimals, read at runtime.
    /// @param tokenDecimals Stock token decimals, read at runtime.
    /// @param feedDecimals Feed decimals, read at runtime.
    /// @return The premium in basis points.
    function premiumBps(
        uint256 usdgSpent,
        uint256 tokensOut,
        int256 answer,
        uint8 usdgDecimals,
        uint8 tokenDecimals,
        uint8 feedDecimals
    ) internal pure returns (int256) {
        return _ratioBps(usdgSpent, tokensOut, answer, _usdgScale(usdgDecimals, tokenDecimals, feedDecimals), true)
            - SIGNED_BPS;
    }

    /// @notice A sell's discount below the feed price for its receipt, in signed basis points rounded up, against the
    /// owner: 10,000 - floor(10,000 * usdgOut * 10^(tokenDecimals + feedDecimals - usdgDecimals) / (tokensIn *
    /// answer)), the ceiling of the exact discount 10,000 * (1 - execution price / feed price). Negative when the sale
    /// beat the feed.
    /// @dev discountBps > capBps exactly when exceedsDiscount is true. Reverts PriceOutOfRange as premiumBps.
    /// @param usdgOut USDG received, in base units.
    /// @param tokensIn Tokens sold, in base units. Must be above zero.
    /// @param answer The feed answer. Must be positive.
    /// @param usdgDecimals USDG decimals, read at runtime.
    /// @param tokenDecimals Stock token decimals, read at runtime.
    /// @param feedDecimals Feed decimals, read at runtime.
    /// @return The discount in basis points.
    function discountBps(
        uint256 usdgOut,
        uint256 tokensIn,
        int256 answer,
        uint8 usdgDecimals,
        uint8 tokenDecimals,
        uint8 feedDecimals
    ) internal pure returns (int256) {
        return SIGNED_BPS
            - _ratioBps(usdgOut, tokensIn, answer, _usdgScale(usdgDecimals, tokenDecimals, feedDecimals), false);
    }

    /// @dev 10^(tokenDecimals + feedDecimals - usdgDecimals) * BPS: puts USDG base units on the scale of token base
    /// units times answer units, in basis points.
    function _usdgScale(uint8 usdgDecimals, uint8 tokenDecimals, uint8 feedDecimals) private pure returns (uint256) {
        uint256 valueDecimals = uint256(tokenDecimals) + feedDecimals;
        if (usdgDecimals > valueDecimals || valueDecimals - usdgDecimals > MAX_SCALE_EXPONENT) {
            revert UnsupportedDecimals(usdgDecimals, tokenDecimals, feedDecimals);
        }
        return 10 ** (valueDecimals - usdgDecimals) * BPS;
    }

    function _positive(int256 answer) private pure returns (uint256) {
        if (answer <= 0) revert AnswerNotPositive(answer);
        // forge-lint: disable-next-line(unsafe-typecast)
        return uint256(answer);
    }

    /// @dev x * y * z as a 512-bit number. overflow is true, and high and low are meaningless, when it needs more.
    function _product512(uint256 x, uint256 y, uint256 z)
        private
        pure
        returns (bool overflow, uint256 high, uint256 low)
    {
        (uint256 xyHigh, uint256 xyLow) = Math.mul512(x, y);
        (uint256 carry, uint256 lowWord) = Math.mul512(xyLow, z);
        (uint256 top, uint256 middle) = Math.mul512(xyHigh, z);
        (bool fits, uint256 highWord) = Math.tryAdd(middle, carry);
        return (top != 0 || !fits, highWord, lowWord);
    }

    function _greaterThan(uint256 aHigh, uint256 aLow, uint256 bHigh, uint256 bLow) private pure returns (bool) {
        return aHigh > bHigh || (aHigh == bHigh && aLow > bLow);
    }

    /// @dev round(usdgAmount * usdgScale / (tokenAmount * answer)) in the given direction: the execution price over the
    /// feed price, in basis points.
    function _ratioBps(uint256 usdgAmount, uint256 tokenAmount, int256 answer, uint256 usdgScale, bool roundUp)
        private
        pure
        returns (int256)
    {
        if (tokenAmount == 0) revert ZeroTokenAmount();
        (uint256 valueHigh, uint256 value) = Math.mul512(tokenAmount, _positive(answer));
        if (valueHigh != 0) revert PriceOutOfRange();
        uint256 ratio = _mulDivChecked(usdgAmount, usdgScale, value, roundUp);
        if (ratio > uint256(type(int256).max)) revert PriceOutOfRange();
        // forge-lint: disable-next-line(unsafe-typecast)
        return int256(ratio);
    }

    /// @dev x * y / denominator, rounded up or down, with PriceOutOfRange where Math.mulDiv would panic. denominator
    /// is never zero here.
    function _mulDivChecked(uint256 x, uint256 y, uint256 denominator, bool roundUp) private pure returns (uint256) {
        (uint256 high,) = Math.mul512(x, y);
        if (high >= denominator) revert PriceOutOfRange();
        uint256 result = Math.mulDiv(x, y, denominator);
        if (roundUp && mulmod(x, y, denominator) != 0) {
            if (result == type(uint256).max) revert PriceOutOfRange();
            ++result;
        }
        return result;
    }
}
