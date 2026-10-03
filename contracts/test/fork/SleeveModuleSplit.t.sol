// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MODULE_TYPE_EXECUTOR} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {Kernel} from "kernel/Kernel.sol";
import {SleeveModule} from "../../src/SleeveModule.sol";
import {TokenSource} from "../../src/TokenSource.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {ISwapRouter02} from "../../src/interfaces/ISwapRouter02.sol";
import {IStockToken} from "../../src/interfaces/IStockToken.sol";
import {Reason, Status, Trigger} from "../../src/types/SleeveTypes.sol";
import {SleeveModuleForkTradeBase} from "../harness/SleeveModuleForkTradeBase.sol";
import {LaunchConfig} from "../mocks/LaunchConfig.sol";
import {PartialFillRouter} from "../mocks/PartialFillRouter.sol";
import {Chain4663} from "../utils/Chain4663.sol";
import {OwnerOps} from "../utils/OwnerOps.sol";

/// @notice An account's keeper that triggers from inside the owner's own batch, so the module sees a keeper call while
/// the owner's bracket is open in the same transaction.
contract KeeperProbe {
    function split(ISleeveModule module, address account, address pool, uint256 quote) external {
        module.split(account, pool, quote);
    }
}

/// @notice split on chain 4663 forked at block 78,312,136 (Friday 2 October 2026 10:44 EDT), with real USDG, the real
/// SPY, QQQ, NVDA and AAPL tokens, feeds and D-010 pools, SwapRouter02, the issuer's registry and role holders, and
/// accounts on the deployed Kernel v3.1 driven through EntryPoint handleOps with real signatures: a fill on every
/// allowlisted pool by each trigger, every QUEUED reason this block can show, both refusals, every revert with
/// nothing moved, the trigger abuses, and I1 to I4, I7 and I8. SESSION and STALE run in SleeveModuleWeekend.t.sol at
/// the weekend and reopen blocks.
contract SleeveModuleSplitForkTest is SleeveModuleForkTradeBase {
    function setUp() public {
        _setUpTrade();
    }

    // FILLED on every allowlisted pool

    function test_fork_FILLED_byKeeper_onEveryAllowlistedPool() public {
        Leg[5] memory legs = _legs();
        for (uint256 i; i < legs.length; ++i) {
            address account = _account(bytes32(i), _ruleOn(legs[i].tickerId));
            uint256 quote = _quote(legs[i].tickerId, legs[i].pool, EQUITY);
            Measured memory m = _measure(account, legs[i].tickerId, legs[i].pool);

            ISleeveModule.Receipt memory receipt = _onlyReceipt(_keeperSplit(account, legs[i].pool, quote));

            _assertFill(receipt, account, legs[i], m, Status.FILLED, Trigger.KEEPER, PAYMENT, EQUITY, quote);
            _assertSorted(account);
        }
    }

    /// The owner's split inside its bracket through handleOps: the buy is the module's delta, so OwnerOpEnded books
    /// nothing for the owner (D-009 Q13).
    function test_fork_FILLED_byOwnerInsideABracket_onEveryAllowlistedPool() public {
        Leg[5] memory legs = _legs();
        for (uint256 i; i < legs.length; ++i) {
            address account = _account(bytes32(i), _ruleOn(legs[i].tickerId));
            uint256 quote = _quote(legs[i].tickerId, legs[i].pool, EQUITY);
            Measured memory m = _measure(account, legs[i].tickerId, legs[i].pool);

            OpResult memory result = _ownerSplit(account, legs[i].pool, quote);

            ISleeveModule.Receipt[] memory receipts = _receiptsIn(result.logs, address(module));
            assertEq(receipts.length, 1);
            _assertFill(receipts[0], account, legs[i], m, Status.FILLED, Trigger.OWNER, PAYMENT, EQUITY, quote);
            Vm.Log[] memory ended = _logsOf(result, address(module), ISleeveModule.OwnerOpEnded.selector);
            assertEq(ended.length, 1, "OwnerOpEnded");
            assertEq(
                ended[0].data,
                abi.encode(PAYMENT, -int256(EQUITY), int256(0), uint256(0), uint256(0), new uint256[](0)),
                "the buy is the module's delta, nothing is the owner's"
            );
            _assertSorted(account);
        }
    }

    /// A public trigger after observe and the grace. The USDG/USD round is 24.09 hours old by then, still inside 25.
    function test_fork_FILLED_byPublicAfterObserveAndTheGrace_onEveryAllowlistedPool() public {
        Leg[5] memory legs = _legs();
        address[5] memory accounts;
        for (uint256 i; i < legs.length; ++i) {
            accounts[i] = _account(bytes32(i), _ruleOn(legs[i].tickerId));
            vm.prank(stranger);
            module.observe(accounts[i]);
        }
        vm.warp(block.timestamp + GRACE);
        for (uint256 i; i < legs.length; ++i) {
            uint256 quote = _quote(legs[i].tickerId, legs[i].pool, EQUITY);
            Measured memory m = _measure(accounts[i], legs[i].tickerId, legs[i].pool);
            vm.recordLogs();
            vm.prank(stranger);
            module.split(accounts[i], legs[i].pool, quote);

            ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());

            _assertFill(receipt, accounts[i], legs[i], m, Status.FILLED, Trigger.PUBLIC, PAYMENT, EQUITY, quote);
            (uint64 observedAt,) = module.observationOf(accounts[i]);
            assertEq(observedAt, 0, "the sort cleared the observation");
        }
    }

    // QUEUED reasons at this block

    /// The issuer's TOKEN_PAUSER_ROLE holder pauses SPY.
    function test_fork_QUEUED_PAUSED_byTheTokenPause() public {
        address account = _account(0, _defaultRule());
        uint256 quote = _quote(SPY, LaunchConfig.SPY_POOL_500, EQUITY);
        _pauseToken(Chain4663.SPY);
        _assertQueuedSplit(account, SPY, LaunchConfig.SPY_POOL_500, quote, Reason.PAUSED);
    }

    /// The issuer's PAUSER_ROLE holder pauses every stock token through the registry; token.paused() includes it.
    function test_fork_QUEUED_PAUSED_byTheRegistryPause() public {
        address account = _account(0, _ruleOn(NVDA));
        uint256 quote = _quote(NVDA, LaunchConfig.NVDA_POOL_500, EQUITY);
        _pauseRegistry();
        assertTrue(IStockToken(Chain4663.NVDA).paused());
        _assertQueuedSplit(account, NVDA, LaunchConfig.NVDA_POOL_500, quote, Reason.PAUSED);
    }

    function test_fork_QUEUED_ORACLE_PAUSED() public {
        address account = _account(0, _ruleOn(QQQ));
        _pauseOracle(Chain4663.QQQ);
        _assertQueuedSplit(account, QQQ, LaunchConfig.QQQ_POOL_500, Reason.ORACLE_PAUSED);
    }

    /// The issuer's MULTIPLIER_UPDATER_ROLE holder schedules a change ten minutes ahead, as every real one was.
    function test_fork_QUEUED_MULTIPLIER() public {
        address account = _account(0, _ruleOn(AAPL));
        _scheduleMultiplier(Chain4663.AAPL, IStockToken(Chain4663.AAPL).uiMultiplier() + 1e15);
        assertTrue(IStockToken(Chain4663.AAPL).newUIMultiplier() != IStockToken(Chain4663.AAPL).uiMultiplier());
        _assertQueuedSplit(account, AAPL, LaunchConfig.AAPL_POOL_3000, Reason.MULTIPLIER);
    }

    /// The real USDG/USD round is 23.09 hours old at this block. Two hours later it is past 25 while every stock
    /// round is still fresh and the session open.
    function test_fork_QUEUED_DEPEG_whenTheUsdgRoundAgesPast25Hours() public {
        address account = _account(0, _defaultRule());
        vm.warp(block.timestamp + 2 hours);
        (,,, uint256 updatedAt,) = IAggregatorV3(Chain4663.USDG_USD_FEED).latestRoundData();
        assertGt(block.timestamp - updatedAt, 25 hours, "USDG/USD past 25 hours");
        ISleeveModule.Receipt memory receipt = _assertQueuedSplit(account, SPY, LaunchConfig.SPY_POOL_500, Reason.DEPEG);
        assertEq(receipt.usdgRoundId, 18_446_744_073_709_551_735, "the real round on the receipt");
        assertEq(receipt.usdgAnswer, 100_001_038);
    }

    function test_fork_QUEUED_CLIP() public {
        ISleeveModule.RuleInput memory rule = _defaultRule();
        rule.minClip = uint128(EQUITY + 1);
        address account = _account(0, rule);
        _assertQueuedSplit(account, SPY, LaunchConfig.SPY_POOL_500, Reason.CLIP);
    }

    /// The real SPY premium of a 100 USDG buy at this block is 36 bps, so a zero cap queues PREMIUM and the swap is
    /// undone.
    function test_fork_QUEUED_PREMIUM_capTighterThanTheRealPremium() public {
        ISleeveModule.RuleInput memory rule = _defaultRule();
        rule.premiumCapBps = 0;
        address account = _account(0, rule);
        uint256 poolUsdg = USDG.balanceOf(LaunchConfig.SPY_POOL_500);
        ISleeveModule.Receipt memory receipt =
            _assertQueuedSplit(account, SPY, LaunchConfig.SPY_POOL_500, Reason.PREMIUM);
        assertEq(receipt.premiumBps, 36, "the undone swap's premium, as pools.md measured");
        assertEq(receipt.venueId, 1);
        assertEq(USDG.balanceOf(LaunchConfig.SPY_POOL_500), poolUsdg, "the swap was undone");
    }

    /// A whale pushes the SPY pool before the split: the premium cap holds at the default 100 bps.
    function test_fork_QUEUED_PREMIUM_poolPushedBeforeTheSplit() public {
        address account = _account(0, _defaultRule());
        _pushPool(SPY, LaunchConfig.SPY_POOL_500, 100_000e6);
        ISleeveModule.Receipt memory receipt =
            _assertQueuedSplit(account, SPY, LaunchConfig.SPY_POOL_500, Reason.PREMIUM);
        assertGt(receipt.premiumBps, 100, "pushed past the cap");
    }

    // Refusals

    /// The ticker is removed through SleeveTimelock after the 48 hours, so the split refuses it before any other step,
    /// although it is now Sunday and the market is closed.
    function test_fork_REFUSED_TICKER_afterATimelockedRemoval() public {
        address account = _account(0, _defaultRule());
        _throughTimelock(address(tokenSource), abi.encodeCall(TokenSource.removeTicker, (SPY)), "remove SPY");
        (,,, bool active) = tokenSource.ticker(SPY);
        assertFalse(active, "removed");
        _assertRefusedSplit(account, LaunchConfig.SPY_POOL_500, Status.REFUSED_TICKER);
    }

    /// The issuer's BLOCKER_ROLE holder blocks the account in the real registry.
    function test_fork_REFUSED_ACCOUNT_byTheRealRegistry() public {
        address account = _account(0, _ruleOn(NVDA));
        _blockInRegistry(account);
        _assertRefusedSplit(account, LaunchConfig.NVDA_POOL_500, Status.REFUSED_ACCOUNT);
    }

    // Reverts with nothing moved

    function test_fork_poolNotAllowed_reverts() public {
        address account = _account(0, _defaultRule());
        address[3] memory pools = [LaunchConfig.SPY_POOL_3000, LaunchConfig.MEMECOIN_POOL, LaunchConfig.QQQ_POOL_500];
        for (uint256 i; i < pools.length; ++i) {
            _assertSplitRevertsWithNothingMoved(
                account,
                keeper,
                pools[i],
                1,
                abi.encodeWithSelector(ISleeveModule.PoolNotAllowed.selector, SPY, pools[i])
            );
        }
    }

    function test_fork_poolBlocked_reverts() public {
        address account = _account(0, _defaultRule());
        uint256 quote = _quote(SPY, LaunchConfig.SPY_POOL_500, EQUITY);
        _blockInRegistry(LaunchConfig.SPY_POOL_500);
        _assertSplitRevertsWithNothingMoved(
            account,
            keeper,
            LaunchConfig.SPY_POOL_500,
            quote,
            abi.encodeWithSelector(ISleeveModule.PoolBlocked.selector, LaunchConfig.SPY_POOL_500)
        );
    }

    /// PRD 7.4 step 9: a quote the pool cannot meet reverts TooFewTokens, the module's own check after the premium
    /// cap (audit A1-12), and nothing moves.
    function test_fork_minimumOutFailure_revertsWithNothingMoved() public {
        Leg[5] memory legs = _legs();
        for (uint256 i; i < legs.length; ++i) {
            address account = _account(bytes32(i), _ruleOn(legs[i].tickerId));
            uint256 quote = _quote(legs[i].tickerId, legs[i].pool, EQUITY);
            uint256 tokensOut = _quoteOut(legs[i].tickerId, legs[i].pool, EQUITY);
            _assertSplitRevertsWithNothingMoved(
                account,
                keeper,
                legs[i].pool,
                quote * 2,
                abi.encodeWithSelector(ISleeveModule.TooFewTokens.selector, tokensOut, _minOut(quote * 2))
            );
        }
    }

    /// Fallback, listed: no allowlisted pool fills part of an order, so the venue here is PartialFillRouter, which
    /// fills 90 percent through the real SwapRouter02 and the real SPY pool. PartialFill reverts the split.
    function test_fork_partialFill_revertsWithNothingMoved() public {
        PartialFillRouter partialVenue = new PartialFillRouter(ISwapRouter02(Chain4663.SWAP_ROUTER_02), 9_000);
        ISleeveModule.ModuleConfig memory config = _config();
        config.swapRouter = partialVenue;
        module = new SleeveModule(config);
        address account = _account(0, _defaultRule());
        uint256 quote = _quote(SPY, LaunchConfig.SPY_POOL_500, EQUITY * 9 / 10) * 9 / 10;
        _assertSplitRevertsWithNothingMoved(
            account,
            keeper,
            LaunchConfig.SPY_POOL_500,
            quote,
            abi.encodeWithSelector(ISleeveModule.PartialFill.selector, EQUITY, EQUITY * 9 / 10)
        );
    }

    function test_fork_zeroQuote_reverts() public {
        address account = _account(0, _defaultRule());
        _assertSplitRevertsWithNothingMoved(
            account, keeper, LaunchConfig.SPY_POOL_500, 0, abi.encodeWithSelector(ISleeveModule.ZeroQuote.selector)
        );
    }

    // Trigger abuse

    function test_fork_publicSplitBeforeTheGrace_reverts() public {
        address account = _account(0, _defaultRule());
        uint256 quote = _quote(SPY, LaunchConfig.SPY_POOL_500, EQUITY);
        _assertSplitRevertsWithNothingMoved(
            account,
            stranger,
            LaunchConfig.SPY_POOL_500,
            quote,
            abi.encodeWithSelector(ISleeveModule.GracePeriodActive.selector, block.timestamp + GRACE)
        );
        vm.prank(stranger);
        uint64 observedAt = module.observe(account);
        vm.warp(block.timestamp + GRACE - 1);
        _assertSplitRevertsWithNothingMoved(
            account,
            stranger,
            LaunchConfig.SPY_POOL_500,
            quote,
            abi.encodeWithSelector(ISleeveModule.GracePeriodActive.selector, observedAt + GRACE)
        );
    }

    /// D-009 Q15: one base unit of dust observed early does not pre-age the clock for the payment after it.
    function test_fork_dustTransferCannotPreAgeTheObservation() public {
        address account = _installedAccount(address(module), 0, 0, _installData(address(0), _defaultRule()));
        _pay(account, 1);
        vm.prank(stranger);
        module.observe(account);
        vm.warp(block.timestamp + GRACE);
        _pay(account, PAYMENT);
        uint256 quote = _quote(SPY, LaunchConfig.SPY_POOL_500, EQUITY);

        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.GracePeriodActive.selector, block.timestamp + GRACE));
        vm.prank(stranger);
        module.split(account, LaunchConfig.SPY_POOL_500, quote);

        vm.prank(keeper);
        module.split(account, LaunchConfig.SPY_POOL_500, quote);
        assertGt(IERC20(Chain4663.SPY).balanceOf(account), 0, "the keeper is never held by the grace");
    }

    /// A keeper call inside the owner's bracketed UserOp: the bracket is open, so the keeper trigger fails and the
    /// UserOp reverts with it.
    function test_fork_keeperSplitWhileTheOwnersBracketIsOpen_reverts() public {
        address account = _account(0, _defaultRule());
        KeeperProbe probe = new KeeperProbe();
        assertTrue(_ownerOp(account, OwnerOps.setKeeper(address(module), address(probe))).success);
        uint256 quote = _quote(SPY, LaunchConfig.SPY_POOL_500, EQUITY);
        uint256 nextId = module.nextReceiptId();

        OpResult memory result = _ownerOp(
            account,
            OwnerOps.single(
                address(module),
                address(probe),
                abi.encodeCall(KeeperProbe.split, (module, account, LaunchConfig.SPY_POOL_500, quote))
            )
        );

        assertFalse(result.success, "the owner's op failed");
        assertEq(result.revertReason, abi.encodeWithSelector(ISleeveModule.OwnerOpOpen.selector, account));
        assertEq(module.nextReceiptId(), nextId, "no receipt");
        (,,, uint256 unsorted) = module.ledger(account);
        assertEq(unsorted, PAYMENT, "still unsorted");
    }

    function test_fork_publicCallerWithANonAllowlistedPool_reverts() public {
        address account = _account(0, _defaultRule());
        vm.prank(stranger);
        module.observe(account);
        vm.warp(block.timestamp + GRACE);
        _assertSplitRevertsWithNothingMoved(
            account,
            stranger,
            LaunchConfig.SPY_POOL_3000,
            1,
            abi.encodeWithSelector(ISleeveModule.PoolNotAllowed.selector, SPY, LaunchConfig.SPY_POOL_3000)
        );
    }

    /// Fallback, listed: the module's onUninstall is made to revert with vm.mockCallRevert for one uninstall
    /// UserOp, the case D-019 covers where Kernel ignores a failed onUninstall. Kernel drops the module while its state
    /// stays, and every trigger is then refused.
    function test_fork_staleModuleAccount_reverts() public {
        address account = _account(0, _defaultRule());
        vm.mockCallRevert(address(module), abi.encodeCall(ISleeveModule.onUninstall, ("")), "");
        OpResult memory uninstalled = _uninstallThroughOp(account, ownerKey, address(module));
        vm.clearMockedCalls();
        (bool found, bool succeeded) = _uninstallResult(uninstalled, account, address(module));
        assertTrue(found && !succeeded, "ModuleUninstallResult(module, false)");
        assertFalse(Kernel(payable(account)).isModuleInstalled(MODULE_TYPE_EXECUTOR, address(module), ""));
        assertTrue(module.isInitialized(account), "stale state");
        uint256 quote = _quote(SPY, LaunchConfig.SPY_POOL_500, EQUITY);

        _assertSplitRevertsWithNothingMoved(
            account,
            keeper,
            LaunchConfig.SPY_POOL_500,
            quote,
            abi.encodeWithSelector(ISleeveModule.ModuleNotListed.selector, account)
        );
    }

    // I1, I2, I7 and I8 as named tests

    /// I1: the module holds no USDG and no stock token after observe, a fill on each pool, a queue and a refusal.
    function test_I1_fork_moduleHoldsNothingAfterEveryAction() public {
        Leg[5] memory legs = _legs();
        for (uint256 i; i < legs.length; ++i) {
            address account = _account(bytes32(i), _ruleOn(legs[i].tickerId));
            vm.prank(stranger);
            module.observe(account);
            _assertHoldsNothingAtAll(address(module));
            _keeperSplit(account, legs[i].pool, _quote(legs[i].tickerId, legs[i].pool, EQUITY));
            _assertHoldsNothingAtAll(address(module));
        }
        address queued = _account(bytes32(uint256(10)), _defaultRule());
        _pauseOracle(Chain4663.SPY);
        _keeperSplit(queued, LaunchConfig.SPY_POOL_500, 1);
        _assertHoldsNothingAtAll(address(module));
        _blockInRegistry(queued);
        _pay(queued, PAYMENT);
        _keeperSplit(queued, LaunchConfig.SPY_POOL_500, 1);
        _assertHoldsNothingAtAll(address(module));
    }

    /// I2 on every receipt status a split writes on this block.
    function test_I2_fork_everySplitReceiptConservesUsdg() public {
        Status[4] memory seen;
        address filled = _account(bytes32(uint256(1)), _defaultRule());
        seen[0] = _assertI2Split(filled, _quote(SPY, LaunchConfig.SPY_POOL_500, EQUITY));
        ISleeveModule.RuleInput memory clip = _defaultRule();
        clip.minClip = 500e6;
        seen[1] = _assertI2Split(_account(bytes32(uint256(2)), clip), 1);
        address refused = _account(bytes32(uint256(3)), _defaultRule());
        _blockInRegistry(refused);
        seen[2] = _assertI2Split(refused, 1);
        ISleeveModule.RuleInput memory odd = _defaultRule();
        (odd.spendBps, odd.equityBps, odd.minClip) = (6_667, 3_333, 1e6);
        address dusty = _installedAccount(address(module), bytes32(uint256(4)), 0, _installData(address(0), odd));
        _pay(dusty, 1_000_000_007);
        seen[3] = _assertI2Split(dusty, _quote(SPY, LaunchConfig.SPY_POOL_500, 333_300_002));
        assertEq(uint8(seen[0]), uint8(Status.FILLED));
        assertEq(uint8(seen[1]), uint8(Status.QUEUED));
        assertEq(uint8(seen[2]), uint8(Status.REFUSED_ACCOUNT));
        assertEq(uint8(seen[3]), uint8(Status.FILLED));
    }

    /// I3: on every pool the bought tokens land in the account, measured by balance; a buy that cannot deliver the
    /// trigger's minimum reverts and no token arrives anywhere.
    function test_I3_fork_tokensLandInTheAccountOrTheCallReverts() public {
        Leg[5] memory legs = _legs();
        for (uint256 i; i < legs.length; ++i) {
            (address token,) = _tokenOf(legs[i].tickerId);
            address account = _account(bytes32(i), _ruleOn(legs[i].tickerId));
            uint256 quote = _quote(legs[i].tickerId, legs[i].pool, EQUITY);
            uint256 poolTokens = IERC20(token).balanceOf(legs[i].pool);
            uint256 tokensOut = _quoteOut(legs[i].tickerId, legs[i].pool, EQUITY);

            vm.expectRevert(abi.encodeWithSelector(ISleeveModule.TooFewTokens.selector, tokensOut, _minOut(quote * 2)));
            vm.prank(keeper);
            module.split(account, legs[i].pool, quote * 2);
            assertEq(IERC20(token).balanceOf(account), 0, "I3: no tokens without a fill");
            assertEq(IERC20(token).balanceOf(legs[i].pool), poolTokens, "the pool kept its tokens");

            ISleeveModule.Receipt memory receipt = _onlyReceipt(_keeperSplit(account, legs[i].pool, quote));
            assertEq(IERC20(token).balanceOf(account), receipt.tokensOut, "I3: the tokens are in the account");
            assertEq(poolTokens - IERC20(token).balanceOf(legs[i].pool), receipt.tokensOut, "from the pool");
            assertGe(receipt.tokensOut, receipt.minOut, "I3: at least the trigger's minimum");
            _assertHoldsNothingAtAll(address(module));
        }
    }

    /// I4: a split moves at most the unsorted amount, exactly its equity part, only to the allowlisted pool, and the
    /// router's allowance is zero after; a settle moves exactly the bucket.
    function test_I4_fork_movesOnlyTheEquityPartOrTheBucketToTheVenue() public {
        Leg[5] memory legs = _legs();
        for (uint256 i; i < legs.length; ++i) {
            ISleeveModule.RuleInput memory rule = _ruleOn(legs[i].tickerId);
            rule.minClip = uint128(EQUITY + 1);
            address account = _account(bytes32(i), rule);
            _keeperSplit(account, legs[i].pool, 1);
            _pay(account, PAYMENT);
            (,,, uint256 unsorted) = module.ledger(account);
            uint256 accountUsdg = USDG.balanceOf(account);
            uint256 poolUsdg = USDG.balanceOf(legs[i].pool);
            uint256 routerUsdg = USDG.balanceOf(Chain4663.SWAP_ROUTER_02);

            rule.minClip = 1e6;
            assertTrue(_ownerOp(account, OwnerOps.setRule(address(module), rule)).success);
            _keeperSplit(account, legs[i].pool, _quote(legs[i].tickerId, legs[i].pool, EQUITY));

            uint256 moved = accountUsdg - USDG.balanceOf(account);
            assertEq(moved, EQUITY, "I4: exactly the equity part");
            assertLe(moved, unsorted, "I4: at most the unsorted amount");
            assertEq(USDG.balanceOf(legs[i].pool) - poolUsdg, moved, "I4: only to the pool");
            assertEq(USDG.balanceOf(Chain4663.SWAP_ROUTER_02), routerUsdg, "the router keeps nothing");
            assertEq(USDG.allowance(account, Chain4663.SWAP_ROUTER_02), 0, "I4: allowance zero");

            uint256 bucket = module.bucketOf(account, legs[i].tickerId).amount;
            assertEq(bucket, EQUITY, "the first part still waits");
            accountUsdg = USDG.balanceOf(account);
            poolUsdg = USDG.balanceOf(legs[i].pool);
            _keeperSettle(account, legs[i].tickerId, legs[i].pool, _quote(legs[i].tickerId, legs[i].pool, bucket));
            assertEq(accountUsdg - USDG.balanceOf(account), bucket, "I4: a settle moves exactly the bucket");
            assertEq(USDG.balanceOf(legs[i].pool) - poolUsdg, bucket, "I4: only to the pool");
            assertEq(USDG.allowance(account, Chain4663.SWAP_ROUTER_02), 0, "I4: allowance zero");
            _assertHoldsNothingAtAll(address(module));
        }
    }

    /// I7: receipt ids run on across accounts and every stored hash stays as written.
    function test_I7_fork_receiptHashesWriteOnce() public {
        Leg[5] memory legs = _legs();
        bytes32[] memory hashes = new bytes32[](6);
        for (uint256 i; i < legs.length; ++i) {
            address account = _account(bytes32(i), _ruleOn(legs[i].tickerId));
            _keeperSplit(account, legs[i].pool, _quote(legs[i].tickerId, legs[i].pool, EQUITY));
            hashes[i + 1] = module.receiptHash(i + 1);
            assertTrue(hashes[i + 1] != bytes32(0));
            for (uint256 id = 1; id <= i + 1; ++id) {
                assertEq(module.receiptHash(id), hashes[id], "I7: a written hash never changes");
            }
        }
        assertEq(module.nextReceiptId(), 6);
    }

    /// I8 on every pool: a cap below the real premium, a paused oracle, or a stale USDG round never fills, and every
    /// fill has its premium inside the cap.
    function test_I8_fork_noFillAboveTheCapOrWithThePausedOracle() public {
        Leg[5] memory legs = _legs();
        for (uint256 i; i < legs.length; ++i) {
            uint256 snapshot = vm.snapshotState();
            uint256 quote = _quote(legs[i].tickerId, legs[i].pool, EQUITY);
            ISleeveModule.RuleInput memory rule = _ruleOn(legs[i].tickerId);
            rule.premiumCapBps = 0;
            address capped = _account(bytes32(i), rule);
            ISleeveModule.Receipt memory receipt = _onlyReceipt(_keeperSplit(capped, legs[i].pool, quote));
            if (receipt.status == Status.FILLED) {
                assertLe(receipt.premiumBps, 0, "I8: a fill under a zero cap paid no premium");
                _assertI8(receipt, capped);
            } else {
                assertEq(uint8(receipt.reason), uint8(Reason.PREMIUM));
                assertGt(receipt.premiumBps, 0);
            }
            vm.revertToState(snapshot);

            (address token,) = _tokenOf(legs[i].tickerId);
            _pauseOracle(token);
            address paused = _account(bytes32(i), _ruleOn(legs[i].tickerId));
            receipt = _onlyReceipt(_keeperSplit(paused, legs[i].pool, quote));
            assertEq(uint8(receipt.status), uint8(Status.QUEUED), "I8: no fill with the oracle paused");
            assertEq(uint8(receipt.reason), uint8(Reason.ORACLE_PAUSED));
            vm.revertToState(snapshot);
        }
    }

    // Helpers

    function _assertSorted(address account) private view {
        (uint256 balance, uint256 spend, uint256 pendingTotal, uint256 unsorted) = module.ledger(account);
        assertEq(balance, SPEND_PART, "the equity part left");
        assertEq(spend, SPEND_PART, "spend");
        assertEq(pendingTotal + unsorted, 0);
    }

    /// @dev The keeper's quote comes from QuoterV2, which simulates the swap; while a token is paused that
    /// simulation reverts, so those cases quote before the pause.
    function _assertQueuedSplit(address account, uint8 tickerId, address pool, Reason reason)
        private
        returns (ISleeveModule.Receipt memory)
    {
        return _assertQueuedSplit(account, tickerId, pool, _quote(tickerId, pool, EQUITY), reason);
    }

    function _assertQueuedSplit(address account, uint8 tickerId, address pool, uint256 quote, Reason reason)
        private
        returns (ISleeveModule.Receipt memory receipt)
    {
        uint256 poolUsdg = USDG.balanceOf(pool);
        receipt = _onlyReceipt(_keeperSplit(account, pool, quote));
        _assertQueued(receipt, account, tickerId, reason);
        assertEq(USDG.balanceOf(pool), poolUsdg, "no USDG reached the pool");
    }

    function _assertRefusedSplit(address account, address pool, Status status) private {
        ISleeveModule.Receipt memory receipt = _onlyReceipt(_keeperSplit(account, pool, 1));
        assertEq(uint8(receipt.status), uint8(status), "refused");
        assertEq(receipt.usdgToSpend, PAYMENT, "the equity part went to spend");
        assertEq(receipt.usdgToEquity, EQUITY);
        assertEq(receipt.usdgIn, receipt.usdgToSpend + receipt.usdgSpent + receipt.usdgQueued, "I2");
        (uint256 balance, uint256 spend, uint256 pendingTotal, uint256 unsorted) = module.ledger(account);
        assertEq(balance, PAYMENT);
        assertEq(spend, PAYMENT);
        assertEq(pendingTotal + unsorted, 0);
        _assertHoldsNothingAtAll(address(module));
    }

    function _assertI2Split(address account, uint256 quote) private returns (Status) {
        ISleeveModule.Receipt memory receipt = _onlyReceipt(_keeperSplit(account, LaunchConfig.SPY_POOL_500, quote));
        assertEq(receipt.usdgIn, receipt.usdgToSpend + receipt.usdgSpent + receipt.usdgQueued, "I2: conservation");
        (uint256 balance, uint256 spend, uint256 pendingTotal, uint256 unsorted) = module.ledger(account);
        assertEq(spend + pendingTotal + unsorted, balance, "the ledgers account for the balance");
        assertEq(unsorted, 0);
        return receipt.status;
    }

    /// @dev Balances of the account and the pool, ledgers, buckets, receipt count and observation are unchanged.
    function _assertSplitRevertsWithNothingMoved(
        address account,
        address caller,
        address pool,
        uint256 quote,
        bytes memory reason
    ) private {
        bytes memory before = _snapshot(account, pool);
        vm.expectRevert(reason);
        vm.prank(caller);
        module.split(account, pool, quote);
        assertEq(_snapshot(account, pool), before, "nothing moved");
        _assertHoldsNothingAtAll(address(module));
    }

    /// @dev What a reverted trigger must leave as it was.
    struct Snap {
        uint256 balance;
        uint256 spend;
        uint256 pendingTotal;
        uint256 unsorted;
        uint256[4] buckets;
        uint256[4] held;
        uint256 nextId;
        uint64 observedAt;
        uint128 observedUnsorted;
        uint256 poolUsdg;
        uint256 allowance;
    }

    function _snapshot(address account, address pool) private view returns (bytes memory) {
        Snap memory snap;
        (snap.balance, snap.spend, snap.pendingTotal, snap.unsorted) = module.ledger(account);
        (snap.observedAt, snap.observedUnsorted) = module.observationOf(account);
        address[4] memory tokens = [Chain4663.SPY, Chain4663.QQQ, Chain4663.NVDA, Chain4663.AAPL];
        for (uint8 t; t < 4; ++t) {
            snap.buckets[t] = module.bucketOf(account, t).amount;
            snap.held[t] = IERC20(tokens[t]).balanceOf(account);
        }
        snap.nextId = module.nextReceiptId();
        snap.poolUsdg = pool.code.length == 0 ? 0 : USDG.balanceOf(pool);
        snap.allowance = USDG.allowance(account, Chain4663.SWAP_ROUTER_02);
        return abi.encode(snap);
    }

    /// @dev The module's minOut for EQUITY under the default 50 bps slippage cap.
    function _minOut(uint256 quote) private pure returns (uint256) {
        return EQUITY * quote / 1e6 * 9_950 / 10_000;
    }
}
