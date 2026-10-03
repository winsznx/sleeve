// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MODULE_TYPE_EXECUTOR} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {
    ERC7579Utils,
    Mode,
    ModePayload,
    ModeSelector
} from "@openzeppelin/contracts/account/utils/draft-ERC7579Utils.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {Reason, Status, Trigger} from "../../src/types/SleeveTypes.sol";
import {SleeveModuleTradeUnitBase} from "../harness/SleeveModuleTradeUnitBase.sol";
import {MockAccount} from "../mocks/MockAccount.sol";
import {TamperingAccount} from "../mocks/TamperingAccount.sol";
import {OwnerOps} from "../utils/OwnerOps.sol";

/// @notice split without a fork, on the mock router and mock market: every receipt field of a fill, every trigger and
/// the grace, each guard step and its order, the clip and premium queues, the refusals, every revert with nothing
/// moved, a zero equity part, the reconcile, and the I1 to I4 checks on each path.
contract SleeveModuleSplitTest is SleeveModuleTradeUnitBase {
    uint256 private constant EQUITY = 50e6;
    uint256 private constant SPEND_PART = 450e6;

    function setUp() public {
        _setUpTrade();
    }

    // FILLED

    function test_split_FILLED_byKeeper_writesEveryReceiptFieldAndALot() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        (address pool, uint256 quote) = _splitInputs(address(account));
        uint256 tokensOut = router.quote(EQUITY);
        uint256 routerBefore = usdg.balanceOf(address(router));

        vm.recordLogs();
        vm.prank(keeper);
        uint256 id = module.split(address(account), pool, quote);
        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());

        ISleeveModule.Receipt memory expected = _fillReceipt(address(account), Trigger.KEEPER, pool, quote, tokensOut);
        assertEq(id, 1, "receipt id");
        assertEq(abi.encode(receipt), abi.encode(expected), "every field");
        _assertI2(receipt);
        ISleeveModule.Lot memory lot = module.lot(1);
        assertEq(lot.account, address(account));
        assertEq(lot.tickerId, SPY);
        assertEq(uint8(lot.status), uint8(Status.FILLED));
        assertEq(lot.tokensBought, tokensOut);
        assertEq(lot.tokensRemaining, tokensOut);
        (uint256[] memory lotIds, uint256 head) = module.lotsOf(address(account), SPY);
        assertEq(lotIds.length, 1);
        assertEq(lotIds[0], 1);
        assertEq(head, 0);
        _assertLedger(address(account), INSTALLED + SPEND_PART, INSTALLED + SPEND_PART, 0, 0);
        assertEq(tokens[SPY].balanceOf(address(account)), tokensOut, "I3: tokens in the account");
        assertEq(usdg.balanceOf(address(router)) - routerBefore, EQUITY, "I4: the equity part went to the venue");
        assertEq(IERC20(address(usdg)).allowance(address(account), address(router)), 0, "I4: allowance zero");
        _assertI1();
        _assertLedgersWhole(address(account));
    }

    /// The owner's split inside its bracket: the buy is the module's USDG delta, so endOwnerOp books nothing for the
    /// owner (D-009 Q13).
    function test_split_FILLED_byOwnerInsideABracket_isTheModulesDelta() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);

        vm.recordLogs();
        _ownerSplit(account);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        ISleeveModule.Receipt memory receipt = _onlyReceipt(logs);
        assertEq(uint8(receipt.status), uint8(Status.FILLED));
        assertEq(uint8(receipt.trigger), uint8(Trigger.OWNER));
        _assertI2(receipt);
        bool ended;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != ISleeveModule.OwnerOpEnded.selector) continue;
            (uint256 balanceAtBegin, int256 moduleDelta, int256 ownerDelta,,,) =
                abi.decode(logs[i].data, (uint256, int256, int256, uint256, uint256, uint256[]));
            assertEq(balanceAtBegin, INSTALLED + PAYMENT);
            assertEq(moduleDelta, -int256(EQUITY), "the buy is the module's delta");
            assertEq(ownerDelta, 0, "nothing booked for the owner");
            ended = true;
        }
        assertTrue(ended, "OwnerOpEnded");
        _assertLedger(address(account), INSTALLED + SPEND_PART, INSTALLED + SPEND_PART, 0, 0);
        _assertI1();
    }

    function test_split_FILLED_byOwnerWithoutABracket() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        (address pool, uint256 quote) = _splitInputs(address(account));
        Mode single = ERC7579Utils.encodeMode(
            ERC7579Utils.CALLTYPE_SINGLE, ERC7579Utils.EXECTYPE_DEFAULT, ModeSelector.wrap(0), ModePayload.wrap(0)
        );

        vm.recordLogs();
        account.execute(
            Mode.unwrap(single),
            abi.encodePacked(
                address(module), uint256(0), abi.encodeCall(ISleeveModule.split, (address(account), pool, quote))
            )
        );

        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());
        assertEq(uint8(receipt.status), uint8(Status.FILLED));
        assertEq(uint8(receipt.trigger), uint8(Trigger.OWNER));
        _assertLedger(address(account), INSTALLED + SPEND_PART, INSTALLED + SPEND_PART, 0, 0);
    }

    function test_split_FILLED_byPublicAfterObserveAndTheGrace_clearsTheObservation() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        vm.prank(stranger);
        module.observe(address(account));
        vm.warp(block.timestamp + GRACE);
        _setMarket();
        (address pool, uint256 quote) = _splitInputs(address(account));

        vm.recordLogs();
        vm.prank(stranger);
        module.split(address(account), pool, quote);

        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());
        assertEq(uint8(receipt.status), uint8(Status.FILLED));
        assertEq(uint8(receipt.trigger), uint8(Trigger.PUBLIC));
        (uint64 observedAt, uint128 observedUnsorted) = module.observationOf(address(account));
        assertEq(observedAt, 0, "a sort clears the observation");
        assertEq(observedUnsorted, 0);
    }

    function test_split_aKeeperOfZeroLeavesOnlyOwnerAndPublic() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        _ownerOp(account, OwnerOps.setKeeper(address(module), address(0)));
        (address pool, uint256 quote) = _splitInputs(address(account));
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.GracePeriodActive.selector, block.timestamp + GRACE));
        vm.prank(keeper);
        module.split(address(account), pool, quote);
    }

    function test_split_returnsZeroAndWritesNothingWhenNothingIsUnsorted() public {
        MockAccount account = _account(_defaultRule(), 0);
        State memory before = _state(address(account));
        vm.recordLogs();
        assertEq(_keeperSplit(address(account)), 0);
        assertEq(_receipts(vm.getRecordedLogs()).length, 0);
        _assertUnchanged(before, _state(address(account)));
    }

    // The guard, step by step

    function test_split_QUEUED_PAUSED() public {
        tokens[SPY].setPaused(true);
        _assertQueued(_defaultRule(), Reason.PAUSED);
    }

    function test_split_QUEUED_ORACLE_PAUSED() public {
        tokens[SPY].setOraclePaused(true);
        _assertQueued(_defaultRule(), Reason.ORACLE_PAUSED);
    }

    /// Saturday 3 October 2026 10:44 EDT: the ALL_DAY session is closed.
    function test_split_QUEUED_SESSION() public {
        vm.warp(NOW + 1 days);
        _assertQueued(_defaultRule(), Reason.SESSION);
    }

    function test_split_QUEUED_MULTIPLIER() public {
        tokens[SPY].scheduleMultiplier(1.001e18, block.timestamp + 600);
        _assertQueued(_defaultRule(), Reason.MULTIPLIER);
    }

    /// A round from inside the session that is one second past the 25-hour limit.
    function test_split_QUEUED_STALE_byAge() public {
        feeds[SPY].setRound(2, FEED_ANSWER, block.timestamp - 25 hours - 1);
        assertGt(block.timestamp - 25 hours - 1, WEEK_OPENED_AT, "the round is from this session");
        ISleeveModule.Receipt memory receipt = _assertQueued(_defaultRule(), Reason.STALE);
        assertEq(receipt.updatedAt, block.timestamp - 25 hours - 1, "the stale round is on the receipt");
    }

    /// B2-2: a round only 75 minutes old that predates the REGULAR session's 09:30 opening is refused.
    function test_split_QUEUED_STALE_freshRoundAfterReopen() public {
        uint256 openedAt = module.sessionOpenedAt(QQQ);
        assertEq(openedAt, NOW - (10 hours + 44 minutes + 26 - 9 hours - 30 minutes), "Friday 09:30 EDT");
        feeds[QQQ].setRound(2, FEED_ANSWER, openedAt - 1);
        _assertQueued(_ruleOn(QQQ), Reason.STALE);

        feeds[QQQ].setRound(3, FEED_ANSWER, openedAt);
        MockAccount account = _account(_ruleOn(QQQ), PAYMENT);
        _keeperSplit(address(account));
        assertEq(tokens[QQQ].balanceOf(address(account)), router.quote(EQUITY), "a round from the opening second fills");
    }

    function test_split_QUEUED_DEPEG_byAnswerAndByAge() public {
        usdgUsdFeed.setRound(2, 0.994e8, block.timestamp - 10 minutes);
        _assertQueued(_defaultRule(), Reason.DEPEG);
        usdgUsdFeed.setRound(3, USDG_ANSWER, block.timestamp - 25 hours - 1);
        _assertQueued(_defaultRule(), Reason.DEPEG);
    }

    function test_split_QUEUED_CLIP() public {
        ISleeveModule.RuleInput memory rule = _defaultRule();
        rule.minClip = uint128(EQUITY + 1);
        ISleeveModule.Receipt memory receipt = _assertQueued(rule, Reason.CLIP);
        assertGt(receipt.roundId, 0, "the guard ran before the clip");
        assertEq(router.swaps(), 0, "no swap");
    }

    /// The fill is undone and the equity part queues PREMIUM, with the undone swap's premium on the receipt.
    function test_split_QUEUED_PREMIUM() public {
        router.setPrice(FAIR_PRICE * 10_000 / 10_150);
        uint256 tokensOut = router.quote(EQUITY);
        int256 premium = int256(Math.ceilDiv(EQUITY * 1e20 * 10_000, tokensOut * uint256(FEED_ANSWER))) - 10_000;
        assertGt(premium, 100, "above the default cap");

        ISleeveModule.Receipt memory receipt = _assertQueued(_defaultRule(), Reason.PREMIUM);

        assertEq(receipt.premiumBps, premium, "the undone swap's premium");
        assertEq(receipt.tokensOut, 0, "no tokens arrived");
        assertEq(receipt.venueId, 1, "the swap ran");
        assertGt(receipt.minOut, 0);
        assertEq(router.swaps(), 0, "the swap was undone");
    }

    /// A fill whose premium, rounded up for the receipt, equals the cap stands: the cap compares the exact value.
    function test_split_FILLED_whenTheRoundedPremiumIsTheCap() public {
        router.setPrice(FAIR_PRICE * 10_000 / 10_099);
        MockAccount account = _account(_defaultRule(), PAYMENT);
        uint256 tokensOut = router.quote(EQUITY);
        int256 premium = int256(Math.ceilDiv(EQUITY * 1e20 * 10_000, tokensOut * uint256(FEED_ANSWER))) - 10_000;
        vm.recordLogs();
        _keeperSplit(address(account));
        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());
        assertEq(uint8(receipt.status), uint8(Status.FILLED));
        assertEq(receipt.premiumBps, premium);
        assertEq(receipt.premiumBps, 100, "rounded up to the cap");
    }

    function test_split_REFUSED_TICKER_whenTheTickerWasRemoved() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        tokenSource.removeTicker(SPY);
        _assertRefused(account, Status.REFUSED_TICKER, _pool(SPY));
    }

    /// A ticker with no allowlisted pool left is refused whatever pool the trigger passes.
    function test_split_REFUSED_TICKER_whenTheTickerHasNoAllowlistedPool() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        address pool = _pool(SPY);
        tokenSource.setPool(SPY, pool, false);
        _assertRefused(account, Status.REFUSED_TICKER, makeAddr("any pool"));
    }

    function test_split_REFUSED_ACCOUNT() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        registry.setBlocked(address(account), true);
        _assertRefused(account, Status.REFUSED_ACCOUNT, _pool(SPY));
    }

    /// PRD 7.4 order, first failure wins: each case adds the next step's failure on top of every later one.
    function test_split_guardOrder_firstFailureWins() public {
        Reason[6] memory expected =
            [Reason.PAUSED, Reason.ORACLE_PAUSED, Reason.SESSION, Reason.MULTIPLIER, Reason.STALE, Reason.DEPEG];
        for (uint256 first; first < expected.length; ++first) {
            uint256 snapshot = vm.snapshotState();
            if (first <= 5) usdgUsdFeed.setRound(9, 0.9e8, block.timestamp - 10 minutes);
            if (first <= 4) feeds[SPY].setRound(9, FEED_ANSWER, WEEK_OPENED_AT - 1);
            if (first <= 3) tokens[SPY].scheduleMultiplier(1.001e18, block.timestamp + 1 days - 1);
            if (first <= 2) vm.warp(block.timestamp + 10 hours);
            if (first <= 1) tokens[SPY].setOraclePaused(true);
            if (first == 0) tokens[SPY].setPaused(true);
            _assertQueued(_defaultRule(), expected[first]);
            vm.revertToState(snapshot);
        }
    }

    function test_split_guardOrder_tickerThenAccountThenTiming() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        tokens[SPY].setPaused(true);
        registry.setBlocked(address(account), true);
        uint256 snapshot = vm.snapshotState();
        tokenSource.removeTicker(SPY);
        _assertRefused(account, Status.REFUSED_TICKER, _pool(SPY));
        vm.revertToState(snapshot);
        _assertRefused(account, Status.REFUSED_ACCOUNT, _pool(SPY));
    }

    // Reverts with nothing moved

    function test_split_poolNotAllowed_reverts() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        address[3] memory pools = [_pool(QQQ), makeAddr("not a pool"), address(0)];
        for (uint256 i; i < pools.length; ++i) {
            _assertRevertsAndNothingMoves(
                account, pools[i], 1, abi.encodeWithSelector(ISleeveModule.PoolNotAllowed.selector, SPY, pools[i])
            );
        }
    }

    function test_split_poolBlocked_reverts() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        address pool = _pool(SPY);
        registry.setBlocked(pool, true);
        (, uint256 quote) = _splitInputs(address(account));
        _assertRevertsAndNothingMoves(
            account, pool, quote, abi.encodeWithSelector(ISleeveModule.PoolBlocked.selector, pool)
        );
    }

    /// A blocked account wins over a blocked pool: the equity goes to spend.
    function test_split_blockedAccountWinsOverABlockedPool() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        registry.setBlocked(_pool(SPY), true);
        registry.setBlocked(address(account), true);
        _assertRefused(account, Status.REFUSED_ACCOUNT, _pool(SPY));
    }

    /// PRD 7.4 step 9: tokens below the trigger's minimum revert the whole call and nothing moves.
    function test_split_minimumOutFailure_revertsWithNothingMoved() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        (address pool, uint256 quote) = _splitInputs(address(account));
        _assertRevertsAndNothingMoves(
            account, pool, quote * 2, abi.encodeWithSignature("Error(string)", "Too little received")
        );
    }

    function test_split_partialFill_revertsWithNothingMoved() public {
        router.setFillBps(9_000);
        MockAccount account = _account(_defaultRule(), PAYMENT);
        (address pool, uint256 quote) = _splitInputs(address(account));
        _assertRevertsAndNothingMoves(
            account,
            pool,
            quote,
            abi.encodeWithSelector(ISleeveModule.PartialFill.selector, EQUITY, EQUITY * 9_000 / 10_000)
        );
    }

    /// I3: fewer tokens than minOut, or none at all, reverts even when the venue reported success.
    function test_I3_split_tooFewTokens_revertsWithNothingMoved() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        (address pool, uint256 quote) = _splitInputs(address(account));
        uint256 amountOut = router.quote(EQUITY);
        uint256 minOut = EQUITY * quote / 1e6 * 9_950 / 10_000;
        router.setWithheld(amountOut / 100);
        _assertRevertsAndNothingMoves(
            account,
            pool,
            quote,
            abi.encodeWithSelector(ISleeveModule.TooFewTokens.selector, amountOut - amountOut / 100, minOut)
        );
        router.setWithheld(amountOut);
        _assertRevertsAndNothingMoves(
            account,
            pool,
            1,
            abi.encodeWithSelector(ISleeveModule.TooFewTokens.selector, 0, EQUITY / 1e6 * 9_950 / 10_000)
        );
    }

    /// I1: a venue that sends tokens to the module makes the buy revert.
    function test_I1_split_moduleHoldingTokensAfterTheBuy_reverts() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        (address pool, uint256 quote) = _splitInputs(address(account));
        router.setLeak(address(module), 5);
        _assertRevertsAndNothingMoves(
            account,
            pool,
            quote,
            abi.encodeWithSelector(ISleeveModule.ModuleHoldsFunds.selector, address(tokens[SPY]), 5)
        );
    }

    /// Audit A1 regression: a stray USDG or Stock Token balance donated to the module does not block buys.
    function test_I1_split_donationToModule_doesNotBlockBuys() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        (address pool, uint256 quote) = _splitInputs(address(account));
        usdg.mint(address(module), 1);
        tokens[SPY].mint(address(module), 1);
        vm.prank(keeper);
        module.split(address(account), pool, quote);
        assertEq(usdg.balanceOf(address(module)), 1, "donated USDG untouched");
        assertEq(tokens[SPY].balanceOf(address(module)), 1, "donated token untouched");
        assertGt(tokens[SPY].balanceOf(address(account)), 0, "the buy filled");
    }

    /// I4: an account that leaves the router an allowance after the batch makes the buy revert.
    function test_I4_split_allowanceLeftAfterTheBuy_reverts() public {
        TamperingAccount account = new TamperingAccount();
        usdg.mint(address(account), INSTALLED);
        account.installModule(MODULE_TYPE_EXECUTOR, address(module), _installData(address(0), _defaultRule()));
        _pay(address(account), PAYMENT);
        account.setExtraCall(address(usdg), abi.encodeCall(IERC20.approve, (address(router), 7)));
        (address pool, uint256 quote) = _splitInputs(address(account));
        State memory before = _state(address(account));

        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.AllowanceNotReset.selector, 7));
        vm.prank(keeper);
        module.split(address(account), pool, quote);

        _assertUnchanged(before, _state(address(account)));
    }

    /// The buy reads USDG's decimals at the fill and asserts 6.
    function test_split_usdgDecimalsChangedAfterDeploy_reverts() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        (address pool, uint256 quote) = _splitInputs(address(account));
        usdg.setDecimals(18);
        _assertRevertsAndNothingMoves(
            account,
            pool,
            quote,
            abi.encodeWithSelector(ISleeveModule.UnexpectedDecimals.selector, address(usdg), 18, 6)
        );
    }

    function test_split_zeroQuote_reverts() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        _assertRevertsAndNothingMoves(account, _pool(SPY), 0, abi.encodeWithSelector(ISleeveModule.ZeroQuote.selector));
    }

    function test_split_ruleNotActive_reverts() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        _ownerOp(account, OwnerOps.pauseRule(address(module)));
        _assertRevertsAndNothingMoves(
            account, _pool(SPY), 1, abi.encodeWithSelector(ISleeveModule.RuleNotActive.selector, address(account))
        );

        MockAccount noRule = _accountWith(address(module), 0, "");
        _pay(address(noRule), PAYMENT);
        address pool = _pool(SPY);
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.RuleNotActive.selector, address(noRule)));
        vm.prank(keeper);
        module.split(address(noRule), pool, 1);
    }

    function test_split_notInstalled_reverts() public {
        address pool = _pool(SPY);
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.NotInstalled.selector, stranger));
        vm.prank(keeper);
        module.split(stranger, pool, 1);
    }

    /// D-019: an account whose ERC-7579 config no longer lists the module, as after a failed onUninstall that
    /// the account ignored, is refused for every trigger.
    function test_split_staleModuleAccount_reverts() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        vm.mockCallRevert(address(module), abi.encodeCall(ISleeveModule.onUninstall, ("")), "");
        account.uninstallModule(MODULE_TYPE_EXECUTOR, address(module), "");
        vm.clearMockedCalls();
        assertTrue(module.isInitialized(address(account)), "the module's state is stale");
        assertFalse(account.isModuleInstalled(MODULE_TYPE_EXECUTOR, address(module), ""));

        (address pool, uint256 quote) = _splitInputs(address(account));
        bytes memory refused = abi.encodeWithSelector(ISleeveModule.ModuleNotListed.selector, address(account));
        _assertRevertsAndNothingMoves(account, pool, quote, refused);
    }

    /// Keeper and public triggers cannot run while the owner's bracket is open in the same transaction.
    function test_split_keeperAndPublicWhileTheOwnersBracketIsOpen_revert() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        vm.prank(address(account));
        module.observe(address(account));
        vm.warp(block.timestamp + GRACE);
        _setMarket();
        (address pool, uint256 quote) = _splitInputs(address(account));
        vm.prank(address(account));
        module.beginOwnerOp();

        bytes memory open = abi.encodeWithSelector(ISleeveModule.OwnerOpOpen.selector, address(account));
        vm.expectRevert(open);
        vm.prank(keeper);
        module.split(address(account), pool, quote);
        vm.expectRevert(open);
        vm.prank(stranger);
        module.split(address(account), pool, quote);
    }

    // Public grace

    function test_split_publicWithoutAnObservation_reverts() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        (address pool, uint256 quote) = _splitInputs(address(account));
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.GracePeriodActive.selector, block.timestamp + GRACE));
        vm.prank(stranger);
        module.split(address(account), pool, quote);
    }

    function test_split_publicBeforeTheGrace_reverts() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        vm.prank(stranger);
        uint64 observedAt = module.observe(address(account));
        vm.warp(block.timestamp + GRACE - 1);
        (address pool, uint256 quote) = _splitInputs(address(account));
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.GracePeriodActive.selector, observedAt + GRACE));
        vm.prank(stranger);
        module.split(address(account), pool, quote);
    }

    /// D-009 Q15: a dust payment observed early cannot pre-age the clock for a later payment.
    function test_split_dustTransferCannotPreAgeTheObservation() public {
        MockAccount account = _account(_defaultRule(), 0);
        _pay(address(account), 1);
        vm.prank(stranger);
        module.observe(address(account));
        vm.warp(block.timestamp + 2 hours);
        _setMarket();
        _pay(address(account), PAYMENT);
        (address pool, uint256 quote) = _splitInputs(address(account));

        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.GracePeriodActive.selector, block.timestamp + GRACE));
        vm.prank(stranger);
        module.split(address(account), pool, quote);

        vm.prank(stranger);
        uint64 restarted = module.observe(address(account));
        assertEq(restarted, block.timestamp, "the clock restarts for the larger amount");
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.GracePeriodActive.selector, restarted + GRACE));
        vm.prank(stranger);
        module.split(address(account), pool, quote);
    }

    /// Audit A1 regression: dust below 1 USDG does not restart the clock, so a stranger cannot postpone the public
    /// fallback forever; growth of 1 USDG or more still restarts it.
    function test_split_dustCannotPostponeThePublicFallback() public {
        MockAccount account = _account(_defaultRule(), 0);
        _pay(address(account), PAYMENT);
        vm.prank(stranger);
        uint64 first = module.observe(address(account));
        vm.warp(block.timestamp + 30 minutes);
        _pay(address(account), 1e6 - 1);
        vm.prank(stranger);
        assertEq(module.observe(address(account)), first, "dust keeps the clock");
        vm.warp(uint256(first) + GRACE);
        _setMarket();
        (address pool, uint256 quote) = _splitInputs(address(account));
        vm.prank(stranger);
        module.split(address(account), pool, quote);
        (,,, uint256 unsorted) = module.ledger(address(account));
        assertEq(unsorted, 0, "the public split sorted everything");
    }

    // Zero equity part

    /// Nothing to buy or queue: the split sorts all of it to spend with QUEUED CLIP and zero queued, without running
    /// the guard, so a paused token or a blocked pool cannot hold spend money back.
    function test_split_zeroEquityPart_sortsEverythingToSpendWithoutTheGuard() public {
        ISleeveModule.RuleInput memory allSpend = _defaultRule();
        (allSpend.spendBps, allSpend.equityBps) = (10_000, 0);
        MockAccount account = _account(allSpend, PAYMENT);
        address pool = _pool(SPY);
        tokens[SPY].setPaused(true);
        registry.setBlocked(pool, true);

        vm.recordLogs();
        vm.prank(keeper);
        module.split(address(account), pool, 1);
        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());

        assertEq(uint8(receipt.status), uint8(Status.QUEUED));
        assertEq(uint8(receipt.reason), uint8(Reason.CLIP));
        assertEq(receipt.usdgIn, PAYMENT);
        assertEq(receipt.usdgToSpend, PAYMENT);
        assertEq(receipt.usdgQueued, 0);
        assertEq(receipt.roundId, 0, "no guard read");
        assertEq(receipt.token, address(tokens[SPY]));
        _assertI2(receipt);
        assertEq(module.bucketOf(address(account), SPY).since, 0, "no bucket");
        _assertLedger(address(account), INSTALLED + PAYMENT, INSTALLED + PAYMENT, 0, 0);
    }

    function test_split_dustBelowOneEquityUnit_goesToSpend() public {
        MockAccount account = _account(_defaultRule(), 9);
        vm.recordLogs();
        _keeperSplit(address(account));
        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());
        assertEq(receipt.usdgToEquity, 0);
        assertEq(receipt.usdgToSpend, 9);
        _assertI2(receipt);
    }

    // Reconcile

    /// PRD 7.2: a third-party pull through an old approval shows as a shortfall; the next split takes it off spend
    /// first, then the buckets, writes RECONCILED with the totals and Reconciled with each bucket's cut.
    function test_split_reconcilesAThirdPartyPullSpendFirstThenBuckets() public {
        ISleeveModule.RuleInput memory rule = _defaultRule();
        rule.minClip = uint128(EQUITY + 1);
        MockAccount account = _account(rule, PAYMENT);
        _keeperSplit(address(account));
        assertEq(module.bucketOf(address(account), SPY).amount, EQUITY, "CLIP bucket");
        address puller = makeAddr("old approval");
        Mode single = ERC7579Utils.encodeMode(
            ERC7579Utils.CALLTYPE_SINGLE, ERC7579Utils.EXECTYPE_DEFAULT, ModeSelector.wrap(0), ModePayload.wrap(0)
        );
        account.execute(
            Mode.unwrap(single),
            abi.encodePacked(address(usdg), uint256(0), abi.encodeCall(IERC20.approve, (puller, 580e6)))
        );
        vm.prank(puller);
        IERC20(address(usdg)).transferFrom(address(account), puller, 580e6);
        _assertLedger(address(account), 20e6, INSTALLED + SPEND_PART, EQUITY, 0);

        vm.recordLogs();
        uint256 id = _keeperSplit(address(account));
        Vm.Log[] memory logs = vm.getRecordedLogs();

        ISleeveModule.Receipt memory receipt = _onlyReceipt(logs);
        assertEq(id, receipt.id, "returns the RECONCILED receipt");
        assertEq(uint8(receipt.status), uint8(Status.RECONCILED));
        assertEq(uint8(receipt.trigger), uint8(Trigger.KEEPER));
        assertEq(receipt.usdgIn, 580e6, "the shortfall");
        assertEq(receipt.usdgSpent, INSTALLED + SPEND_PART, "off spend first");
        assertEq(receipt.usdgQueued, 30e6, "then off the buckets");
        assertEq(receipt.token, address(0));
        assertEq(receipt.ruleVersion, 1);
        uint256[] memory fromBuckets = new uint256[](TICKER_COUNT);
        fromBuckets[SPY] = 30e6;
        bool seen;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].topics[0] != ISleeveModule.Reconciled.selector) continue;
            assertEq(logs[i].topics[1], bytes32(uint256(uint160(address(account)))));
            assertEq(logs[i].topics[2], bytes32(receipt.id));
            assertEq(logs[i].data, abi.encode(20e6, INSTALLED + SPEND_PART, fromBuckets), "Reconciled fields");
            seen = true;
        }
        assertTrue(seen, "Reconciled");
        _assertLedger(address(account), 20e6, 0, 20e6, 0);
        _assertLedgersWhole(address(account));
    }

    // Helpers

    function _fillReceipt(address account, Trigger trigger, address pool, uint256 quote, uint256 tokensOut)
        private
        view
        returns (ISleeveModule.Receipt memory receipt)
    {
        receipt.id = 1;
        receipt.account = account;
        receipt.ruleVersion = 1;
        receipt.trigger = trigger;
        receipt.status = Status.FILLED;
        receipt.tickerId = SPY;
        receipt.token = address(tokens[SPY]);
        receipt.tokenUid = keccak256(abi.encode("uid", uint256(SPY)));
        receipt.usdgIn = PAYMENT;
        receipt.usdgToSpend = SPEND_PART;
        receipt.usdgToEquity = EQUITY;
        receipt.usdgSpent = EQUITY;
        receipt.tokensOut = tokensOut;
        receipt.uiMultiplier = 1e18;
        receipt.execPrice = Math.ceilDiv(EQUITY * 1e18, tokensOut);
        receipt.premiumBps = 0;
        receipt.roundId = 1;
        receipt.answer = FEED_ANSWER;
        receipt.updatedAt = NOW - 10 minutes;
        receipt.usdgRoundId = 1;
        receipt.usdgAnswer = USDG_ANSWER;
        receipt.quote = quote;
        receipt.minOut = EQUITY * quote / 1e6 * 9_950 / 10_000;
        receipt.venueId = 1;
        receipt.pool = pool;
        receipt.calendarVersion = CALENDAR_VERSION;
        receipt.disclosureHash = DISCLOSURE_HASH;
        receipt.l2Block = L2_BLOCK;
        receipt.timestamp = block.timestamp;
        receipt.lotId = 1;
    }

    /// @dev A fresh account under `rule` paid PAYMENT, a keeper split, and the QUEUED receipt it must write.
    function _assertQueued(ISleeveModule.RuleInput memory rule, Reason reason)
        private
        returns (ISleeveModule.Receipt memory receipt)
    {
        MockAccount account = _account(rule, PAYMENT);
        uint256 routerBefore = usdg.balanceOf(address(router));
        vm.recordLogs();
        uint256 id = _keeperSplit(address(account));
        receipt = _onlyReceipt(vm.getRecordedLogs());
        assertEq(id, receipt.id);
        assertEq(uint8(receipt.status), uint8(Status.QUEUED), "QUEUED");
        assertEq(uint8(receipt.reason), uint8(reason), "reason");
        assertEq(receipt.usdgIn, PAYMENT);
        assertEq(receipt.usdgToSpend, SPEND_PART);
        assertEq(receipt.usdgToEquity, EQUITY);
        assertEq(receipt.usdgQueued, EQUITY);
        assertEq(receipt.usdgSpent, 0);
        assertEq(receipt.lotId, 0, "no lot");
        assertEq(uint8(receipt.trigger), uint8(Trigger.KEEPER));
        _assertModuleFields(receipt, address(account));
        _assertI2(receipt);
        ISleeveModule.Bucket memory bucket = module.bucketOf(address(account), rule.tickerId);
        assertEq(bucket.amount, EQUITY, "bucket");
        assertEq(bucket.since, block.timestamp, "since");
        assertEq(uint8(bucket.reason), uint8(reason), "bucket reason");
        _assertLedger(address(account), INSTALLED + PAYMENT, INSTALLED + SPEND_PART, EQUITY, 0);
        assertEq(usdg.balanceOf(address(router)), routerBefore, "no USDG left the account");
        _assertI1();
        _assertLedgersWhole(address(account));
    }

    /// @dev A keeper split that must refuse: the whole payment to spend, no bucket, no swap.
    function _assertRefused(MockAccount account, Status status, address pool) private {
        vm.recordLogs();
        vm.prank(keeper);
        module.split(address(account), pool, 1);
        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());
        assertEq(uint8(receipt.status), uint8(status), "refusal");
        assertEq(uint8(receipt.reason), uint8(Reason.NONE));
        assertEq(receipt.usdgToSpend, PAYMENT, "the equity part went to spend");
        assertEq(receipt.usdgToEquity, EQUITY);
        assertEq(receipt.usdgQueued + receipt.usdgSpent, 0);
        assertEq(receipt.venueId, 0, "no swap");
        _assertI2(receipt);
        _assertLedger(address(account), INSTALLED + PAYMENT, INSTALLED + PAYMENT, 0, 0);
        assertEq(router.swaps(), 0);
        _assertI1();
    }

    function _assertRevertsAndNothingMoves(MockAccount account, address pool, uint256 quote, bytes memory reason)
        private
    {
        State memory before = _state(address(account));
        vm.expectRevert(reason);
        vm.prank(keeper);
        module.split(address(account), pool, quote);
        _assertUnchanged(before, _state(address(account)));
        _assertI1();
    }

    function _assertLedger(address account, uint256 balance, uint256 spend, uint256 pendingTotal, uint256 unsorted)
        private
        view
    {
        (uint256 actualBalance, uint256 actualSpend, uint256 actualPending, uint256 actualUnsorted) =
            module.ledger(account);
        assertEq(actualBalance, balance, "balance");
        assertEq(actualSpend, spend, "spend");
        assertEq(actualPending, pendingTotal, "pendingTotal");
        assertEq(actualUnsorted, unsorted, "unsorted");
    }
}
