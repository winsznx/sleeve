// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {ISwapRouter02} from "../../src/interfaces/ISwapRouter02.sol";
import {Reason, Status} from "../../src/types/SleeveTypes.sol";
import {SleeveModuleSellUnitBase} from "../harness/SleeveModuleSellUnitBase.sol";
import {SleeveModuleTradeUnitBase} from "../harness/SleeveModuleTradeUnitBase.sol";
import {MockAccount} from "../mocks/MockAccount.sol";
import {OwnerOps} from "../utils/OwnerOps.sol";

/// @notice Rules docs/SPEC.md sections 8, 10 and 11 and D-025 and D-026 state that no other test pinned on its own:
/// which calls clear, keep or ignore the public-trigger observation, the order of settle's checks with the shortfall
/// previewSettle reports, the router's zero minimum, and the premium measured in USDG at par.
contract SleeveModuleSpecTradeTest is SleeveModuleTradeUnitBase {
    uint256 private constant EQUITY = 50e6;

    address private puller = makeAddr("old approval");

    function setUp() public {
        _setUpTrade();
    }

    // SPEC 8: the observation

    /// Every split that sorts clears the observation, whatever its trigger, so the next payment waits out a grace of
    /// its own (D-025, which replaces D-009 Q15's keeper and owner splits only).
    function test_observation_everySortClearsIt_whateverTheTrigger() public {
        MockAccount byOwner = _observed();
        _ownerSplit(byOwner);
        _assertObservation(address(byOwner), 0, 0);

        MockAccount byKeeper = _observed();
        _keeperSplit(address(byKeeper));
        _assertObservation(address(byKeeper), 0, 0);

        MockAccount byPublic = _observed();
        vm.warp(block.timestamp + GRACE);
        _setMarket();
        (address pool, uint256 quote) = _splitInputs(address(byPublic));
        vm.prank(stranger);
        module.split(address(byPublic), pool, quote);
        _assertObservation(address(byPublic), 0, 0);
    }

    /// A split that finds the ledgers above the balance only reconciles. It sorts nothing, so the clock keeps running,
    /// at level zero, and income that arrives later is not covered by it (D-025, audit A1-25).
    function test_observation_aReconcileOnlySplitKeepsTheClockAtLevelZero() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        vm.prank(stranger);
        uint64 observedAt = module.observe(address(account));
        _pull(account, INSTALLED + PAYMENT);
        vm.warp(block.timestamp + 10 minutes);
        _setMarket();

        vm.recordLogs();
        _keeperSplit(address(account));

        assertEq(uint8(_onlyReceipt(vm.getRecordedLogs()).status), uint8(Status.RECONCILED));
        _assertObservation(address(account), observedAt, 0);
    }

    /// A split with nothing to sort or reconcile, and a settle, leave the observation as it is: a settle's readiness
    /// comes from its bucket and the session, never from the observation (D-025).
    function test_observation_anIdleSplitAndASettleLeaveIt() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        tokens[SPY].setPaused(true);
        _keeperSplit(address(account));
        tokens[SPY].setPaused(false);
        vm.prank(stranger);
        uint64 observedAt = module.observe(address(account));
        assertEq(observedAt, block.timestamp, "a bucket alone is worth observing");

        assertEq(_keeperSplit(address(account)), 0, "nothing to sort");
        _assertObservation(address(account), observedAt, 0);
        _keeperSettle(address(account), SPY);
        _assertObservation(address(account), observedAt, 0);
    }

    // SPEC 10: settle's checks in order

    /// settle checks in this order, each failing one with nothing moved: the ledgers against the balance
    /// (LedgersAboveBalance, audit I-02), an empty bucket (BelowClip), the guard's pool check and its refusals at any
    /// size (audit A1-31), the clip, a public trigger's grace, then the timing steps (GuardNotClear). previewSettle
    /// reports the shortfall with status QUEUED and reason NONE.
    function test_settle_checksRunInTheSpecifiedOrder() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        tokens[SPY].setPaused(true);
        _keeperSplit(address(account));
        uint256 readyAt = uint256(module.bucketOf(address(account), SPY).since) + GRACE;
        address spyPool = _pool(SPY);
        address qqqPool = _pool(QQQ);
        uint256 quote = _quote(EQUITY);

        // An outside pull not reconciled yet comes before an empty bucket, a pool off the allowlist and a public
        // trigger's grace. Nothing was unsorted, so the whole pull is the shortfall.
        uint256 snapshot = vm.snapshotState();
        _pull(account, 560e6);
        _expectSettleRevert(
            stranger,
            account,
            QQQ,
            spyPool,
            quote,
            abi.encodeWithSelector(ISleeveModule.LedgersAboveBalance.selector, address(account), 560e6)
        );
        ISleeveModule.SettlePreview memory preview = module.previewSettle(address(account), SPY);
        assertEq(uint8(preview.status), uint8(Status.QUEUED), "the preview says settle would revert");
        assertEq(uint8(preview.reason), uint8(Reason.NONE), "reason NONE marks LedgersAboveBalance");
        assertEq(preview.shortfall, 560e6, "the shortfall a split reconciles first");
        assertEq(preview.publicReadyAt, 0);
        assertFalse(preview.buy);
        vm.revertToState(snapshot);

        // An empty bucket comes before the guard reads the pool.
        _expectSettleRevert(
            keeper, account, QQQ, spyPool, quote, abi.encodeWithSelector(ISleeveModule.BelowClip.selector, 0, 25e6)
        );

        // The guard comes before the clip: a pool off the allowlist reverts, and a refusal takes a bucket under the
        // clip to spend.
        ISleeveModule.RuleInput memory bigger = _defaultRule();
        bigger.minClip = uint128(EQUITY + 1);
        _ownerOp(account, OwnerOps.setRule(address(module), bigger));
        _expectSettleRevert(
            keeper,
            account,
            SPY,
            qqqPool,
            quote,
            abi.encodeWithSelector(ISleeveModule.PoolNotAllowed.selector, SPY, qqqPool)
        );
        snapshot = vm.snapshotState();
        registry.setBlocked(address(account), true);
        vm.recordLogs();
        vm.prank(keeper);
        module.settle(address(account), SPY, spyPool, quote);
        assertEq(uint8(_onlyReceipt(vm.getRecordedLogs()).status), uint8(Status.REFUSED_ACCOUNT), "under the clip");
        vm.revertToState(snapshot);

        // The clip comes before a public trigger's grace.
        _expectSettleRevert(
            stranger,
            account,
            SPY,
            spyPool,
            quote,
            abi.encodeWithSelector(ISleeveModule.BelowClip.selector, EQUITY, EQUITY + 1)
        );
        _ownerOp(account, OwnerOps.setRule(address(module), _defaultRule()));

        // The grace comes before the timing steps, which revert GuardNotClear last.
        _expectSettleRevert(
            stranger,
            account,
            SPY,
            spyPool,
            quote,
            abi.encodeWithSelector(ISleeveModule.GracePeriodActive.selector, readyAt)
        );
        vm.warp(readyAt);
        _setMarket();
        _expectSettleRevert(
            stranger,
            account,
            SPY,
            spyPool,
            quote,
            abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, Reason.PAUSED)
        );
        tokens[SPY].setPaused(false);
        vm.recordLogs();
        vm.prank(stranger);
        module.settle(address(account), SPY, spyPool, quote);
        assertEq(uint8(_onlyReceipt(vm.getRecordedLogs()).status), uint8(Status.SETTLED));
    }

    // SPEC 11: the router's minimum

    /// The batch passes the router amountOutMinimum 0 and no price limit. The trigger's minimum is the module's own
    /// check, after the premium cap, and the receipt records it (audit A1-12, D-026).
    function test_buy_theRouterGetsNoMinimum() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        (address pool, uint256 quote) = _splitInputs(address(account));
        ISwapRouter02.ExactInputSingleParams memory params = ISwapRouter02.ExactInputSingleParams({
            tokenIn: address(usdg),
            tokenOut: address(tokens[SPY]),
            fee: 500,
            recipient: address(account),
            amountIn: EQUITY,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0
        });

        vm.expectCall(address(router), abi.encodeCall(ISwapRouter02.exactInputSingle, (params)), 1);
        vm.recordLogs();
        vm.prank(keeper);
        module.split(address(account), pool, quote);

        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());
        assertEq(uint8(receipt.status), uint8(Status.FILLED));
        assertEq(receipt.minOut, EQUITY * quote / 1e6 * 9_950 / 10_000, "the module's own minimum");
        assertGt(receipt.minOut, 0);
    }

    // D-026: the premium in USDG at par

    /// The USDG/USD answer only gates DEPEG. Inside the band, at 1.004 or at 0.996, the same fill has the same premium,
    /// computed as if 1 USDG were 1 USD, and a fill at the cap in USDG terms stands (audit A1-11).
    function test_premium_isMeasuredInUsdgAtPar() public {
        router.setPrice(FAIR_PRICE * 10_000 / 10_099);
        int256[2] memory usdgAnswers = [int256(1.004e8), int256(0.996e8)];
        for (uint256 i; i < usdgAnswers.length; ++i) {
            uint256 snapshot = vm.snapshotState();
            usdgUsdFeed.setRound(2, usdgAnswers[i], block.timestamp - 10 minutes);
            MockAccount account = _account(_defaultRule(), PAYMENT);

            vm.recordLogs();
            _keeperSplit(address(account));

            ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());
            assertEq(uint8(receipt.status), uint8(Status.FILLED), "inside the band the fill stands");
            assertEq(receipt.usdgAnswer, usdgAnswers[i], "the USDG/USD round the guard read");
            assertEq(receipt.premiumBps, 100, "the premium in USDG at par, at the cap");
            vm.revertToState(snapshot);
        }
    }

    // Helpers

    /// @dev An account paid PAYMENT whose public-trigger clock a stranger started.
    function _observed() private returns (MockAccount account) {
        account = _account(_defaultRule(), PAYMENT);
        vm.prank(stranger);
        module.observe(address(account));
        _assertObservation(address(account), uint64(block.timestamp), uint128(PAYMENT));
    }

    function _assertObservation(address account, uint64 observedAt, uint128 level) private view {
        (uint64 at, uint128 unsorted) = module.observationOf(account);
        assertEq(at, observedAt, "observedAt");
        assertEq(unsorted, level, "observedUnsorted");
    }

    /// @dev A settle by `caller` that reverts with `revertData` and leaves everything as it was.
    function _expectSettleRevert(
        address caller,
        MockAccount account,
        uint8 tickerId,
        address pool,
        uint256 quote,
        bytes memory revertData
    ) private {
        State memory before = _state(address(account));
        vm.expectRevert(revertData);
        vm.prank(caller);
        module.settle(address(account), tickerId, pool, quote);
        _assertUnchanged(before, _state(address(account)));
    }

    /// @dev A pull through an approval the owner gave outside Sleeve.
    function _pull(MockAccount account, uint256 amount) private {
        vm.prank(address(account));
        assertTrue(IERC20(address(usdg)).approve(puller, amount));
        vm.prank(puller);
        assertTrue(IERC20(address(usdg)).transferFrom(address(account), puller, amount));
    }
}

/// @notice Rules docs/SPEC.md sections 12 and 13 and D-027 state for sell-back that no other test pinned on its own:
/// the whole guard order with and without the off-hours override, the override and the widened cap working apart, and
/// the sign of a sell receipt's premiumBps.
contract SleeveModuleSpecSellTest is SleeveModuleSellUnitBase {
    /// @dev Saturday 3 October 2026 10:44:26 EDT: the market is closed, and the rounds set ten minutes before NOW are
    /// 24 hours 10 minutes old, still inside 25.
    uint256 private constant SATURDAY = NOW + 1 days;
    /// @dev Where the failures begin that the override skips: SESSION, then the stock round's age.
    uint256 private constant FIRST_SKIPPABLE = 7;

    MockAccount private account;
    uint256 private lotId;

    function setUp() public {
        _setUpSell();
        (account, lotId) = _lotAccount(_defaultRule());
    }

    // SPEC 12: the guard order

    /// First failure wins in SPEC 12's order: the account, the pool and the router on the blocklist, then PAUSED,
    /// ORACLE_PAUSED, MULTIPLIER and DEPEG, which revert GuardNotClear with or without the override, then SESSION and
    /// the stock round's age, which revert SellWaits and which the override skips. Each case adds its failure on top of
    /// every later one, so it wins only by coming first.
    function test_sell_guardOrder_firstFailureWins() public {
        bytes[9] memory expected = [
            abi.encodeWithSelector(ISleeveModule.AccountBlocked.selector, address(account)),
            abi.encodeWithSelector(ISleeveModule.PoolBlocked.selector, _pool(SPY)),
            abi.encodeWithSelector(ISleeveModule.RouterBlocked.selector, address(venue)),
            abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, Reason.PAUSED),
            abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, Reason.ORACLE_PAUSED),
            abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, Reason.MULTIPLIER),
            abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, Reason.DEPEG),
            abi.encodeWithSelector(ISleeveModule.SellWaits.selector, Reason.SESSION),
            abi.encodeWithSelector(ISleeveModule.SellWaits.selector, Reason.STALE)
        ];
        for (uint256 first; first < expected.length; ++first) {
            uint256 snapshot = vm.snapshotState();
            _failFrom(first);
            OwnerOps.SellArgs memory args = _args(SPY, LOT_TOKENS, 0);
            _assertSellReverts(account, args, expected[first]);

            args.overrideClosed = true;
            if (first < FIRST_SKIPPABLE) {
                _assertSellReverts(account, args, expected[first]);
            } else {
                _sell(account, args);
                assertEq(module.lot(lotId).tokensRemaining, 0, "the override skips the session and the round's age");
            }
            vm.revertToState(snapshot);
        }
    }

    // SPEC 12: the override and the widened cap

    /// overrideClosed alone keeps the rule's cap, and overrideCapBps alone widens the cap but does not skip the
    /// session. Together they do both (D-027, pending the owner's reading of B2-14).
    function test_sell_overrideClosedAndOverrideCapBpsWorkApart() public {
        venue.setSellPrice(FAIR_SELL_PRICE * 9_899 / 10_000);
        OwnerOps.SellArgs memory args = _args(SPY, 5e16, 0);
        args.overrideClosed = true;
        _assertSellReverts(
            account, args, abi.encodeWithSelector(ISleeveModule.DiscountAboveCap.selector, int256(101), uint16(100))
        );

        args.overrideClosed = false;
        args.overrideCapBps = 200;
        ISleeveModule.Receipt memory receipt = _sellReceipt(args);
        assertEq(receipt.premiumBps, 101, "a 101 bps discount under the widened cap");
        assertFalse(receipt.overrideClosed);
        assertEq(receipt.overrideCapBps, 200);

        vm.warp(SATURDAY);
        _assertSellReverts(account, args, abi.encodeWithSelector(ISleeveModule.SellWaits.selector, Reason.SESSION));

        args.overrideClosed = true;
        receipt = _sellReceipt(args);
        assertTrue(receipt.overrideClosed);
        assertEq(receipt.overrideCapBps, 200);
        assertEq(module.lot(lotId).tokensRemaining, 0);
    }

    // SPEC 13: premiumBps on a sell receipt

    /// A sell receipt's premiumBps is the discount below the feed price: positive for a sale below the feed, negative
    /// for a sale above it.
    function test_sell_receiptPremiumIsTheDiscount_positiveBelowTheFeed() public {
        venue.setSellPrice(FAIR_SELL_PRICE * 10_030 / 10_000);
        ISleeveModule.Receipt memory above = _sellReceipt(_args(SPY, 5e16, 0));
        assertEq(above.premiumBps, -30, "30 bps above the feed");
        assertGt(above.execPrice, FAIR_SELL_PRICE);

        venue.setSellPrice(FAIR_SELL_PRICE * 9_970 / 10_000);
        ISleeveModule.Receipt memory below = _sellReceipt(_args(SPY, 5e16, 0));
        assertEq(below.premiumBps, 30, "30 bps below the feed");
        assertLt(below.execPrice, FAIR_SELL_PRICE);
    }

    // Helpers

    /// @dev Sets the guard failure at position `first` of test_sell_guardOrder_firstFailureWins and every later one.
    /// The stock round is always 25 hours and a second old, so only the failures before it can win.
    function _failFrom(uint256 first) private {
        vm.warp(first <= FIRST_SKIPPABLE ? SATURDAY : NOW);
        feeds[SPY].setRound(9, FEED_ANSWER, block.timestamp - 25 hours - 1);
        if (first <= 6) usdgUsdFeed.setRound(9, 0.99e8, block.timestamp - 10 minutes);
        if (first <= 5) tokens[SPY].scheduleMultiplier(1.002e18, block.timestamp + 600);
        if (first <= 4) tokens[SPY].setOraclePaused(true);
        if (first <= 3) tokens[SPY].setPaused(true);
        if (first <= 2) registry.setBlocked(address(venue), true);
        if (first <= 1) registry.setBlocked(_pool(SPY), true);
        if (first == 0) registry.setBlocked(address(account), true);
    }

    /// @dev The account's sell with `args` and the one receipt it wrote.
    function _sellReceipt(OwnerOps.SellArgs memory args) private returns (ISleeveModule.Receipt memory) {
        vm.recordLogs();
        _sell(account, args);
        return _onlyReceipt(vm.getRecordedLogs());
    }
}
