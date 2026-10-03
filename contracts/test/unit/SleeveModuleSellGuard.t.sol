// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MODULE_TYPE_EXECUTOR} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {Reason, Status} from "../../src/types/SleeveTypes.sol";
import {SleeveModuleSellUnitBase} from "../harness/SleeveModuleSellUnitBase.sol";
import {MockAccount} from "../mocks/MockAccount.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {TamperingAccount} from "../mocks/TamperingAccount.sol";
import {OwnerOps} from "../utils/OwnerOps.sol";

/// @notice The sell's checks without a fork, one branch each, every revert with nothing moved: the inputs and the
/// override cap, the lots, the ticker and pool, the balance, the guard mirrored from the buy in its order, SellWaits and
/// the off-hours override (B2-13, B2-14), the discount cap with exact edges, and every postcondition of the swap.
contract SleeveModuleSellGuardTest is SleeveModuleSellUnitBase {
    /// @dev Saturday 3 October 2026 10:44:26 EDT: the market is closed, and the rounds set ten minutes before NOW are
    /// 24 hours 10 minutes old, still inside 25.
    uint256 private constant SATURDAY = NOW + 1 days;
    /// @dev Sunday 4 October 2026 20:00 EDT, the next opening of the ALL_DAY session.
    uint256 private constant NEXT_OPEN = WEEK_OPENED_AT + 7 days;

    MockAccount private account;
    uint256 private lotId;

    function setUp() public {
        _setUpSell();
        (account, lotId) = _lotAccount(_defaultRule());
    }

    // Inputs

    function test_sell_byACallerWithoutTheModule_reverts() public {
        OwnerOps.SellArgs memory args = _args(SPY, LOT_TOKENS, 0);
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.NotInstalled.selector, stranger));
        _sellAs(stranger, args);
    }

    function test_sell_zeroAmountOrQuote_reverts() public {
        _assertSellReverts(account, _args(SPY, 0, 0), abi.encodeWithSelector(ISleeveModule.ZeroAmount.selector));
        OwnerOps.SellArgs memory args = _args(SPY, LOT_TOKENS, 0);
        args.quote = 0;
        _assertSellReverts(account, args, abi.encodeWithSelector(ISleeveModule.ZeroQuote.selector));
    }

    /// B2-14: a widened cap lies between the rule's cap and MAX_PREMIUM_CAP_BPS; zero means the rule's cap.
    function test_sell_overrideCapOutOfRange_reverts() public {
        uint16 maxBps = module.MAX_PREMIUM_CAP_BPS();
        uint16[2] memory caps = [uint16(99), maxBps + 1];
        for (uint256 i; i < caps.length; ++i) {
            OwnerOps.SellArgs memory args = _args(SPY, LOT_TOKENS, 0);
            args.overrideCapBps = caps[i];
            _assertSellReverts(
                account,
                args,
                abi.encodeWithSelector(ISleeveModule.OverrideCapOutOfRange.selector, caps[i], uint16(100), maxBps)
            );
        }
    }

    function test_sell_overrideCapAtEitherBound_fills() public {
        uint16[2] memory caps = [uint16(100), module.MAX_PREMIUM_CAP_BPS()];
        for (uint256 i; i < caps.length; ++i) {
            OwnerOps.SellArgs memory args = _args(SPY, 5e16, 0);
            args.overrideCapBps = caps[i];
            vm.recordLogs();
            _sell(account, args);
            assertEq(_onlyReceipt(vm.getRecordedLogs()).overrideCapBps, caps[i], "on the receipt");
        }
    }

    /// D-019: an account whose Kernel no longer lists the module cannot run the swap, so the sell refuses it first.
    function test_sell_moduleNotListed_reverts() public {
        vm.mockCall(address(account), abi.encodeWithSelector(MockAccount.isModuleInstalled.selector), abi.encode(false));
        _assertSellReverts(
            account,
            _args(SPY, LOT_TOKENS, 0),
            abi.encodeWithSelector(ISleeveModule.ModuleNotListed.selector, address(account))
        );
    }

    // Lots

    function test_sell_unknownOrForeignLot_reverts() public {
        _assertSellReverts(
            account, _args(SPY, 1e16, 999), abi.encodeWithSelector(ISleeveModule.UnknownLot.selector, 999)
        );
        (, uint256 foreignLot) = _lotAccount(_defaultRule());
        _assertSellReverts(
            account,
            _args(SPY, 1e16, foreignLot),
            abi.encodeWithSelector(ISleeveModule.LotMismatch.selector, foreignLot)
        );
        _ownerOp(account, OwnerOps.setRule(address(module), _ruleOn(NVDA)));
        uint256 nvdaLot = _buyLot(account);
        _assertSellReverts(
            account, _args(SPY, 1e16, nvdaLot), abi.encodeWithSelector(ISleeveModule.LotMismatch.selector, nvdaLot)
        );
        OwnerOps.SellArgs memory wrongTicker = _args(NVDA, 1e16, lotId);
        _assertSellReverts(account, wrongTicker, abi.encodeWithSelector(ISleeveModule.LotMismatch.selector, lotId));
    }

    /// D-009 Q30: the lots cap a sell; tokens outside lots are not sellable through Sleeve.
    function test_sell_aboveTheLots_reverts() public {
        _assertSellReverts(
            account,
            _args(SPY, LOT_TOKENS + 1, 0),
            abi.encodeWithSelector(ISleeveModule.ExceedsLots.selector, LOT_TOKENS + 1, LOT_TOKENS)
        );
        _assertSellReverts(
            account,
            _args(SPY, LOT_TOKENS + 1, lotId),
            abi.encodeWithSelector(ISleeveModule.ExceedsLots.selector, LOT_TOKENS + 1, LOT_TOKENS)
        );
        tokens[SPY].mint(address(account), 5e16);
        _assertSellReverts(
            account, _args(SPY, 12e16, 0), abi.encodeWithSelector(ISleeveModule.ExceedsLots.selector, 12e16, LOT_TOKENS)
        );
        _assertSellReverts(account, _args(QQQ, 1, 0), abi.encodeWithSelector(ISleeveModule.ExceedsLots.selector, 1, 0));
    }

    /// A ticker id TokenSource never listed has no lots, so it stops at the lots before any TokenSource read.
    function test_sell_unknownTicker_reverts() public {
        uint256 next = module.nextReceiptId();
        address pool = _pool(SPY);
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.ExceedsLots.selector, 1e16, 0));
        vm.prank(address(account));
        module.sell(9, 1e16, 0, pool, 1, false, 0);
        assertEq(module.nextReceiptId(), next);
    }

    /// Audit A1: the token balance caps a sell too, so phantom lots cannot sell tokens that are gone.
    function test_sell_aboveTheBalance_reverts() public {
        _ownerOp(account, OwnerOps.transferToken(address(module), address(tokens[SPY]), sink, 3e16));
        _assertSellReverts(
            account, _args(SPY, 8e16, 0), abi.encodeWithSelector(ISleeveModule.ExceedsBalance.selector, 8e16, 7e16)
        );
    }

    // Ticker and pool

    /// Only the harness can give a feedless ticker a lot; the sell refuses it, since there is no reference to hold
    /// the discount to.
    function test_sell_tickerWithoutAFeed_reverts() public {
        module.seedLot(500, address(account), NO_FEED, Status.FILLED, LOT_TOKENS);
        tokens[NO_FEED].mint(address(account), LOT_TOKENS);
        OwnerOps.SellArgs memory args = _args(NO_FEED, LOT_TOKENS, 0);
        args.quote = FAIR_SELL_PRICE;
        _assertSellReverts(account, args, abi.encodeWithSelector(ISleeveModule.TickerHasNoFeed.selector, NO_FEED));
    }

    function test_sell_poolNotAllowed_reverts() public {
        address[4] memory pools =
            [_pool(QQQ), address(0), factory.createPool(address(usdg), address(tokens[SPY]), 3_000), address(venue)];
        for (uint256 i; i < pools.length; ++i) {
            OwnerOps.SellArgs memory args = _args(SPY, LOT_TOKENS, 0);
            args.pool = pools[i];
            _assertSellReverts(
                account, args, abi.encodeWithSelector(ISleeveModule.PoolNotAllowed.selector, SPY, pools[i])
            );
        }
    }

    // The blocklist

    function test_sell_accountBlocked_reverts() public {
        registry.setBlocked(address(account), true);
        registry.setBlocked(_pool(SPY), true);
        _assertBothWays(abi.encodeWithSelector(ISleeveModule.AccountBlocked.selector, address(account)));
    }

    function test_sell_poolBlocked_reverts() public {
        registry.setBlocked(_pool(SPY), true);
        _assertBothWays(abi.encodeWithSelector(ISleeveModule.PoolBlocked.selector, _pool(SPY)));
    }

    /// Audit LOW: the token's approve and transferFrom check the router too, so a blocked router is refused by name.
    function test_sell_routerBlocked_reverts() public {
        registry.setBlocked(address(venue), true);
        _assertBothWays(abi.encodeWithSelector(ISleeveModule.RouterBlocked.selector, address(venue)));
    }

    // Steps the override never skips

    function test_sell_guardNotClear_PAUSED() public {
        tokens[SPY].setPaused(true);
        _assertBothWays(abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, Reason.PAUSED));
    }

    function test_sell_guardNotClear_ORACLE_PAUSED() public {
        tokens[SPY].setOraclePaused(true);
        _assertBothWays(abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, Reason.ORACLE_PAUSED));
    }

    function test_sell_guardNotClear_MULTIPLIER() public {
        tokens[SPY].scheduleMultiplier(1.002e18, block.timestamp + 600);
        _assertBothWays(abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, Reason.MULTIPLIER));
    }

    function test_sell_guardNotClear_DEPEG_outsideTheBand() public {
        usdgUsdFeed.setRound(2, 1.006e8, block.timestamp - 10 minutes);
        _assertBothWays(abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, Reason.DEPEG));
    }

    function test_sell_guardNotClear_DEPEG_byAge() public {
        usdgUsdFeed.setRound(2, USDG_ANSWER, block.timestamp - 25 hours - 1);
        _assertBothWays(abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, Reason.DEPEG));
    }

    /// The steps the override cannot skip come before SESSION and STALE, so a closed market with a paused token is
    /// never offered the override.
    function test_sell_guardOrder_stepsTheOverrideCannotSkipComeFirst() public {
        vm.warp(SATURDAY);
        tokens[SPY].setPaused(true);
        _assertSellReverts(
            account,
            _args(SPY, LOT_TOKENS, 0),
            abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, Reason.PAUSED)
        );
        tokens[SPY].setPaused(false);
        usdgUsdFeed.setRound(2, 0.99e8, block.timestamp);
        _assertSellReverts(
            account,
            _args(SPY, LOT_TOKENS, 0),
            abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, Reason.DEPEG)
        );
    }

    // SellWaits and the override

    /// B2-13: on a Saturday the sell waits and nothing moves.
    function test_sell_SellWaits_SESSION() public {
        vm.warp(SATURDAY);
        _assertSellReverts(
            account, _args(SPY, LOT_TOKENS, 0), abi.encodeWithSelector(ISleeveModule.SellWaits.selector, Reason.SESSION)
        );
    }

    /// B2-13 and B2-14: with the override the same Saturday sell fills against the round held since Friday, and the
    /// receipt says so.
    function test_sell_override_fillsWhileTheSessionIsClosed() public {
        vm.warp(SATURDAY);
        OwnerOps.SellArgs memory args = _args(SPY, LOT_TOKENS, 0);
        args.overrideClosed = true;
        uint256 usdgOut = venue.quoteSell(LOT_TOKENS);

        vm.recordLogs();
        uint256 id = _sell(account, args);
        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());

        _assertSoldReceipt(
            receipt,
            address(account),
            args,
            Sold({id: id, lotId: lotId, status: Status.SOLD, tokensIn: LOT_TOKENS, share: usdgOut}),
            usdgOut
        );
        assertTrue(receipt.overrideClosed);
        assertEq(receipt.updatedAt, NOW - 10 minutes, "the round held since Friday");
        assertEq(module.sessionOpenedAt(SPY), 0, "closed");
    }

    /// A REGULAR ticker waits after 16:00 New York while an ALL_DAY ticker still sells.
    function test_sell_SellWaits_SESSION_regularHoursOnly() public {
        (MockAccount qqqAccount,) = _lotAccount(_ruleOn(QQQ));
        _buyLot(account);
        vm.warp(NOW + 6 hours);
        _setMarket();
        _assertSellReverts(
            qqqAccount,
            _args(QQQ, LOT_TOKENS, 0),
            abi.encodeWithSelector(ISleeveModule.SellWaits.selector, Reason.SESSION)
        );
        _sell(account, _args(SPY, LOT_TOKENS, 0));
        assertEq(module.lot(lotId).tokensRemaining, 0, "SPY trades all day");
    }

    function test_sell_SellWaits_STALE_byAge() public {
        feeds[SPY].setRound(2, FEED_ANSWER, block.timestamp - 25 hours - 1);
        _assertSellReverts(
            account, _args(SPY, LOT_TOKENS, 0), abi.encodeWithSelector(ISleeveModule.SellWaits.selector, Reason.STALE)
        );
        OwnerOps.SellArgs memory args = _args(SPY, LOT_TOKENS, 0);
        args.overrideClosed = true;
        vm.recordLogs();
        _sell(account, args);
        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());
        assertEq(receipt.roundId, 2, "the override sold on the stale round");
        assertTrue(receipt.overrideClosed);
    }

    /// B2-2 mirrored: half an hour after the Sunday reopen a round from one second before it is fresh by age and still
    /// refused, until the override takes it.
    function test_sell_SellWaits_STALE_roundFromBeforeTheReopen() public {
        vm.warp(NEXT_OPEN + 30 minutes);
        feeds[SPY].setRound(2, FEED_ANSWER, NEXT_OPEN - 1);
        usdgUsdFeed.setRound(2, USDG_ANSWER, block.timestamp - 10 minutes);
        assertEq(module.sessionOpenedAt(SPY), NEXT_OPEN, "open since 20:00");
        _assertSellReverts(
            account, _args(SPY, LOT_TOKENS, 0), abi.encodeWithSelector(ISleeveModule.SellWaits.selector, Reason.STALE)
        );
        OwnerOps.SellArgs memory args = _args(SPY, LOT_TOKENS, 0);
        args.overrideClosed = true;
        _sell(account, args);
        assertEq(module.lot(lotId).tokensRemaining, 0);
    }

    /// The override skips age only: a round with no positive answer, or from the future, cannot price a sell, so the
    /// override gets GuardNotClear instead of SellWaits.
    function test_sell_brokenRound_waitsWithoutTheOverrideAndRefusesWithIt() public {
        feeds[SPY].setAnswer(0);
        _assertSellReverts(
            account, _args(SPY, LOT_TOKENS, 0), abi.encodeWithSelector(ISleeveModule.SellWaits.selector, Reason.STALE)
        );
        OwnerOps.SellArgs memory args = _args(SPY, LOT_TOKENS, 0);
        args.overrideClosed = true;
        _assertSellReverts(account, args, abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, Reason.STALE));
        feeds[SPY].setRound(2, FEED_ANSWER, block.timestamp + 1);
        _assertSellReverts(
            account, _args(SPY, LOT_TOKENS, 0), abi.encodeWithSelector(ISleeveModule.SellWaits.selector, Reason.STALE)
        );
        _assertSellReverts(account, args, abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, Reason.STALE));
    }

    // The discount cap

    function test_sell_discountAboveTheRulesCap_reverts() public {
        venue.setSellPrice(FAIR_SELL_PRICE * 9_899 / 10_000);
        _assertSellReverts(
            account,
            _args(SPY, LOT_TOKENS, 0),
            abi.encodeWithSelector(ISleeveModule.DiscountAboveCap.selector, int256(101), uint16(100))
        );
    }

    /// Equality passes: a discount of exactly the cap fills.
    function test_sell_discountAtTheCap_fills() public {
        venue.setSellPrice(FAIR_SELL_PRICE * 9_900 / 10_000);
        vm.recordLogs();
        _sell(account, _args(SPY, LOT_TOKENS, 0));
        assertEq(_onlyReceipt(vm.getRecordedLogs()).premiumBps, 100, "exactly the cap");
    }

    /// B2-14: the widened cap lets this sell through, and only this one.
    function test_sell_widenedCap_fillsAndStillBounds() public {
        _buyLot(account);
        venue.setSellPrice(FAIR_SELL_PRICE * 9_899 / 10_000);
        OwnerOps.SellArgs memory args = _args(SPY, LOT_TOKENS, 0);
        args.overrideCapBps = 200;
        vm.recordLogs();
        _sell(account, args);
        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());
        assertEq(receipt.premiumBps, 101);
        assertEq(receipt.overrideCapBps, 200);
        _assertSellReverts(
            account,
            _args(SPY, 5e16, 0),
            abi.encodeWithSelector(ISleeveModule.DiscountAboveCap.selector, int256(101), uint16(100))
        );

        venue.setSellPrice(FAIR_SELL_PRICE * 9_499 / 10_000);
        args = _args(SPY, 5e16, 0);
        args.overrideCapBps = 500;
        _assertSellReverts(
            account, args, abi.encodeWithSelector(ISleeveModule.DiscountAboveCap.selector, int256(501), uint16(500))
        );
    }

    /// The cap is the exact inequality usdgOut * 1e20 * 10,000 >= tokensIn * answer * (10,000 - cap): a sell fills
    /// exactly when it holds, and its receipt's discount is then at most the cap.
    /// forge-config: default.fuzz.runs = 2000
    function testFuzz_sell_fillsExactlyWhenTheDiscountIsInsideTheCap(uint256 price, uint256 cap, uint256 amount)
        public
    {
        price = bound(price, FAIR_SELL_PRICE * 9_000 / 10_000, FAIR_SELL_PRICE * 11_000 / 10_000);
        cap = bound(cap, 100, 500);
        amount = bound(amount, 1e12, LOT_TOKENS);
        venue.setSellPrice(price);
        OwnerOps.SellArgs memory args = _args(SPY, amount, 0);
        args.overrideCapBps = cap == 100 ? 0 : uint16(cap);
        uint256 usdgOut = venue.quoteSell(amount);
        vm.assume(usdgOut != 0);
        int256 discount = _discount(usdgOut, amount, FEED_ANSWER);
        bool inside = usdgOut * 1e20 * 10_000 >= amount * uint256(FEED_ANSWER) * (10_000 - cap);

        if (!inside) {
            _assertSellReverts(
                account, args, abi.encodeWithSelector(ISleeveModule.DiscountAboveCap.selector, discount, uint16(cap))
            );
            assertGt(discount, int256(cap), "a refused sell shows a discount above the cap");
            return;
        }
        vm.recordLogs();
        _sell(account, args);
        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());
        assertEq(receipt.premiumBps, discount);
        assertLe(receipt.premiumBps, int256(cap), "a receipt never shows a discount above its cap");
    }

    // The swap's postconditions, each with nothing moved

    /// The quote the venue cannot meet. The owner's minimum is the module's own check, after the discount cap, as the
    /// buy checks its minimum after the premium cap (audit A1-12): a sale at the feed price that falls short of a
    /// doubled quote reverts TooLittleUsdg.
    function test_sell_minimumOutFailure_reverts() public {
        OwnerOps.SellArgs memory args = _args(SPY, LOT_TOKENS, 0);
        args.quote *= 2;
        uint256 minOut = LOT_TOKENS * args.quote / 1e18 * 9_950 / 10_000;
        _assertSellReverts(
            account,
            args,
            abi.encodeWithSelector(ISleeveModule.TooLittleUsdg.selector, venue.quoteSell(LOT_TOKENS), minOut)
        );
    }

    function test_sell_partialFill_reverts() public {
        venue.setFillBps(9_000);
        _assertSellReverts(
            account,
            _args(SPY, LOT_TOKENS, 0),
            abi.encodeWithSelector(ISleeveModule.PartialFill.selector, LOT_TOKENS, LOT_TOKENS * 9 / 10)
        );
    }

    function test_sell_tooLittleUsdgArrives_reverts() public {
        OwnerOps.SellArgs memory args = _args(SPY, LOT_TOKENS, 0);
        uint256 usdgOut = venue.quoteSell(LOT_TOKENS);
        uint256 minOut = LOT_TOKENS * args.quote / 1e18 * 9_950 / 10_000;
        venue.setWithheld(usdgOut - minOut + 1);
        _assertSellReverts(
            account, args, abi.encodeWithSelector(ISleeveModule.TooLittleUsdg.selector, minOut - 1, minOut)
        );
        venue.setWithheld(usdgOut);
        _assertSellReverts(account, args, abi.encodeWithSelector(ISleeveModule.TooLittleUsdg.selector, 0, minOut));
    }

    /// I1 by delta: USDG or tokens that reach the module during the sell revert it.
    function test_sell_moduleBalanceChanges_reverts() public {
        venue.setLeak(address(module), 1);
        _assertSellReverts(
            account,
            _args(SPY, LOT_TOKENS, 0),
            abi.encodeWithSelector(ISleeveModule.ModuleHoldsFunds.selector, address(usdg), 1)
        );
        venue.setLeak(address(0), 0);
        venue.setHook(address(tokens[SPY]), abi.encodeCall(MockERC20.mint, (address(module), 1)));
        _assertSellReverts(
            account,
            _args(SPY, LOT_TOKENS, 0),
            abi.encodeWithSelector(ISleeveModule.ModuleHoldsFunds.selector, address(tokens[SPY]), 1)
        );
    }

    /// I4: an account that approves the router again after the module's batch fails the allowance check.
    function test_sell_allowanceLeftAfterTheBatch_reverts() public {
        TamperingAccount tampering = new TamperingAccount();
        usdg.mint(address(tampering), INSTALLED);
        tampering.installModule(MODULE_TYPE_EXECUTOR, address(module), _installData(address(0), _defaultRule()));
        _pay(address(tampering), PAYMENT);
        _keeperSplit(address(tampering));
        tampering.setExtraCall(address(tokens[SPY]), abi.encodeCall(IERC20.approve, (address(venue), 7)));
        _assertSellRevertsAs(
            address(tampering),
            _args(SPY, LOT_TOKENS, 0),
            abi.encodeWithSelector(ISleeveModule.AllowanceNotReset.selector, 7)
        );
    }

    function test_sell_venueRevert_bubbles() public {
        venue.setFailure(abi.encodeWithSignature("Error(string)", "venue down"));
        _assertSellReverts(account, _args(SPY, LOT_TOKENS, 0), abi.encodeWithSignature("Error(string)", "venue down"));
    }

    /// The reentrancy lock: a venue that calls back into the module during the swap fails the whole sell.
    /// The lock is per account (audit A1-21): a reentry for the selling account reverts AccountLocked, and a reentry
    /// as the venue itself reaches only the venue's own state (D-015), which never installed the module. Either way
    /// the sell reverts with nothing moved.
    function test_sell_reentryFromTheVenue_reverts() public {
        address pool = _pool(SPY);
        venue.setHook(address(module), abi.encodeCall(ISleeveModule.sell, (SPY, 1, 0, pool, 1, false, 0)));
        _assertSellReverts(
            account,
            _args(SPY, LOT_TOKENS, 0),
            abi.encodeWithSelector(ISleeveModule.NotInstalled.selector, address(venue))
        );
        venue.setHook(address(module), abi.encodeCall(ISleeveModule.split, (address(account), pool, 1)));
        _assertSellReverts(
            account,
            _args(SPY, LOT_TOKENS, 0),
            abi.encodeWithSelector(ISleeveModule.AccountLocked.selector, address(account))
        );
    }

    /// Decimals are read at the sell and asserted: the token's and the feed's by the guard, USDG's before the price.
    function test_sell_unexpectedDecimals_revert() public {
        tokens[SPY].setDecimals(17);
        _assertSellReverts(
            account,
            _args(SPY, LOT_TOKENS, 0),
            abi.encodeWithSelector(ISleeveModule.UnexpectedDecimals.selector, address(tokens[SPY]), 17, 18)
        );
        tokens[SPY].setDecimals(18);
        feeds[SPY].setDecimals(9);
        _assertSellReverts(
            account,
            _args(SPY, LOT_TOKENS, 0),
            abi.encodeWithSelector(ISleeveModule.UnexpectedDecimals.selector, address(feeds[SPY]), 9, 8)
        );
        feeds[SPY].setDecimals(8);
        usdg.setDecimals(7);
        _assertSellReverts(
            account,
            _args(SPY, LOT_TOKENS, 0),
            abi.encodeWithSelector(ISleeveModule.UnexpectedDecimals.selector, address(usdg), 7, 6)
        );
    }

    // Helpers

    /// @dev The same revert with and without the override: the step is one the override never skips.
    function _assertBothWays(bytes memory revertData) private {
        OwnerOps.SellArgs memory args = _args(SPY, LOT_TOKENS, 0);
        _assertSellReverts(account, args, revertData);
        args.overrideClosed = true;
        _assertSellReverts(account, args, revertData);
    }
}
