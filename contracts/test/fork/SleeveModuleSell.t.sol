// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {ISwapRouter02} from "../../src/interfaces/ISwapRouter02.sol";
import {IStockToken} from "../../src/interfaces/IStockToken.sol";
import {Reason, Status} from "../../src/types/SleeveTypes.sol";
import {SleeveModuleForkSellBase} from "../harness/SleeveModuleForkSellBase.sol";
import {SleeveModuleHarness} from "../harness/SleeveModuleHarness.sol";
import {LaunchConfig} from "../mocks/LaunchConfig.sol";
import {PartialFillRouter} from "../mocks/PartialFillRouter.sol";
import {Chain4663} from "../utils/Chain4663.sol";
import {OwnerOps} from "../utils/OwnerOps.sol";

/// @notice sell and reconcileLots on chain 4663 forked at block 78,312,136 (Friday 2 October 2026 10:44 EDT), with real
/// USDG, the real stock tokens, feeds, registry and D-010 pools, SwapRouter02, and accounts on the deployed Kernel v3.1
/// driven through EntryPoint handleOps with real signatures. Lots come from real keeper splits. Covers PART_SOLD sold
/// again and then SOLD in bracketed owner UserOps on SPY and QQQ, a sell on every allowlisted pool, proceeds that a
/// later split never sorts, phantom lots and reconcileLots, a removed ticker, every guard revert this block can show
/// with nothing moved, the minimum-out and partial-fill reverts, and I1, I3, I4, I6 and I7 for sells. The closed
/// market and the override run in SleeveModuleSellWeekend.t.sol.
contract SleeveModuleSellForkTest is SleeveModuleForkSellBase {
    function setUp() public {
        _setUpTrade();
    }

    // PART_SOLD, PART_SOLD again, SOLD

    /// The owner sells 40 percent of a lot, then 30, then the rest, each in its own bracketed UserOp: PART_SOLD,
    /// PART_SOLD to PART_SOLD (audit A1), then SOLD. Every receipt is rebuilt from chain state, the proceeds are the
    /// module's delta in each bracket, and a later payment's split sorts only that payment.
    function test_fork_PART_SOLD_twiceThenSOLD_inBracketedUserOps_onSPYandQQQ() public {
        Leg[2] memory legs = [_legs()[0], _legs()[1]];
        for (uint256 i; i < legs.length; ++i) {
            address account = _account(bytes32(i), _ruleOn(legs[i].tickerId));
            ISleeveModule.Receipt memory fill =
                _onlyReceipt(_keeperSplit(account, legs[i].pool, _quote(legs[i].tickerId, legs[i].pool, EQUITY)));
            uint256 proceeds = _sellInThree(account, legs[i], fill);
            _assertLaterSplitSortsOnlyThePayment(account, legs[i], proceeds);
        }
    }

    /// I1, I3 and I4 on every allowlisted pool: a sell moves exactly the tokens to the pool, the USDG lands in the
    /// account, the allowance is zero and the module holds nothing.
    function test_I1_I3_I4_fork_sellOnEveryAllowlistedPool() public {
        Leg[5] memory legs = _legs();
        for (uint256 i; i < legs.length; ++i) {
            address account = _account(bytes32(i), _ruleOn(legs[i].tickerId));
            ISleeveModule.Receipt memory fill =
                _onlyReceipt(_keeperSplit(account, legs[i].pool, _quote(legs[i].tickerId, legs[i].pool, EQUITY)));
            _sellAndCheck(account, legs[i], fill.tokensOut, fill.id, Status.SOLD);
        }
    }

    /// A sell by amount across two lots: the older lot is sold out, the newer one in part, and the two shares sum to
    /// the USDG the pool paid.
    function test_fork_sellByAmountAcrossTwoLots() public {
        Leg memory leg = _legs()[0];
        address account = _account(0, _defaultRule());
        uint256 quote = _quote(SPY, leg.pool, EQUITY);
        ISleeveModule.Receipt memory first = _onlyReceipt(_keeperSplit(account, leg.pool, quote));
        _pay(account, PAYMENT);
        ISleeveModule.Receipt memory second =
            _onlyReceipt(_keeperSplit(account, leg.pool, _quote(SPY, leg.pool, EQUITY)));
        uint256 amount = first.tokensOut + second.tokensOut / 2;
        OwnerOps.SellArgs memory args = _sellArgs(SPY, leg.pool, amount, 0);
        uint256 usdgBefore = USDG.balanceOf(account);

        OpResult memory result = _ownerSell(account, args);

        assertTrue(result.success, "sell UserOp");
        ISleeveModule.Receipt[] memory receipts = _receiptsIn(result.logs, address(module));
        assertEq(receipts.length, 2);
        uint256 usdgOut = USDG.balanceOf(account) - usdgBefore;
        assertEq(receipts[0].lotId, first.id);
        assertEq(uint8(receipts[0].status), uint8(Status.SOLD));
        assertEq(receipts[0].tokensIn, first.tokensOut);
        assertEq(receipts[0].usdgOut, usdgOut * first.tokensOut / amount, "pro rata, rounded down");
        assertEq(receipts[1].lotId, second.id);
        assertEq(uint8(receipts[1].status), uint8(Status.PART_SOLD));
        assertEq(receipts[1].tokensIn, second.tokensOut / 2);
        assertEq(receipts[0].usdgOut + receipts[1].usdgOut, usdgOut, "the shares sum to the USDG received");
        assertEq(receipts[0].premiumBps, receipts[1].premiumBps, "the whole sell's discount on both");
        _assertProceedsAreTheModulesDelta(result, usdgBefore, usdgOut);
    }

    // Phantom lots

    /// Audit A1: the owner moves half the lot's tokens out in a bracketed batch. A sell above the balance reverts;
    /// reconcileLots trims the lot to the balance with a RECONCILED receipt; the rest then sells and the lot is SOLD.
    function test_fork_phantomLot_reconcileLotsThenSellTheRest() public {
        Leg memory leg = _legs()[0];
        address account = _account(0, _defaultRule());
        ISleeveModule.Receipt memory fill = _onlyReceipt(_keeperSplit(account, leg.pool, _quote(SPY, leg.pool, EQUITY)));
        uint256 kept = fill.tokensOut / 2;
        uint256 moved = fill.tokensOut - kept;
        assertTrue(
            _ownerOp(account, OwnerOps.transferToken(address(module), Chain4663.SPY, recipient, moved)).success,
            "tokens moved out"
        );

        _assertSellOpReverts(
            account,
            _sellArgs(SPY, leg.pool, kept + 1, 0),
            abi.encodeWithSelector(ISleeveModule.ExceedsBalance.selector, kept + 1, kept)
        );

        OpResult memory reconciled = _ownerOp(account, OwnerOps.reconcileLots(address(module), SPY));
        assertTrue(reconciled.success, "reconcile UserOp");
        ISleeveModule.Receipt[] memory receipts = _receiptsIn(reconciled.logs, address(module));
        assertEq(receipts.length, 1);
        assertEq(uint8(receipts[0].status), uint8(Status.RECONCILED));
        assertEq(receipts[0].lotId, fill.id);
        assertEq(receipts[0].tokensIn, moved, "the tokens that left");
        assertEq(receipts[0].token, Chain4663.SPY);
        assertEq(receipts[0].usdgIn + receipts[0].usdgOut + receipts[0].usdgToSpend, 0, "no USDG");
        assertEq(
            _logsOf(reconciled, address(module), ISleeveModule.LotsReconciled.selector)[0].data,
            abi.encode(kept, moved),
            "LotsReconciled"
        );
        assertEq(module.lot(fill.id).tokensRemaining, kept);
        assertEq(uint8(module.lot(fill.id).status), uint8(Status.FILLED), "a trim is not a sale");

        _sellAndCheck(account, leg, kept, fill.id, Status.SOLD);
    }

    // A removed ticker

    /// TokenSource keeps a removed ticker's pools, so its lots still sell. Fallback, listed: the removal runs as the
    /// timelock's own call instead of waiting out the 48 hours, because no new round lands in a fork, and two days
    /// later the USDG/USD round would be past 25 hours; the timelock's delay has its own tests.
    function test_fork_aRemovedTickerStillSells() public {
        Leg memory leg = _legs()[0];
        address account = _account(0, _defaultRule());
        ISleeveModule.Receipt memory fill = _onlyReceipt(_keeperSplit(account, leg.pool, _quote(SPY, leg.pool, EQUITY)));
        vm.prank(address(timelock));
        tokenSource.removeTicker(SPY);
        (,,, bool active) = tokenSource.ticker(SPY);
        assertFalse(active, "removed");

        _sellAndCheck(account, leg, fill.tokensOut, fill.id, Status.SOLD);
    }

    // Reverts with nothing moved

    function test_fork_sell_accountBlocked_reverts() public {
        (address account, uint256 lotTokens) = _lotAccount(NVDA);
        _blockInRegistry(account);
        _assertSellOpReverts(
            account,
            _sellArgsBeforeTheChange(NVDA, lotTokens),
            abi.encodeWithSelector(ISleeveModule.AccountBlocked.selector, account)
        );
    }

    function test_fork_sell_poolBlocked_reverts() public {
        (address account, uint256 lotTokens) = _lotAccount(SPY);
        OwnerOps.SellArgs memory args = _sellArgsBeforeTheChange(SPY, lotTokens);
        _blockInRegistry(LaunchConfig.SPY_POOL_500);
        _assertSellOpReverts(
            account, args, abi.encodeWithSelector(ISleeveModule.PoolBlocked.selector, LaunchConfig.SPY_POOL_500)
        );
    }

    /// Audit LOW: the real Stock token checks the router on approve and transferFrom, so the guard names it first.
    function test_fork_sell_routerBlocked_reverts() public {
        (address account, uint256 lotTokens) = _lotAccount(SPY);
        OwnerOps.SellArgs memory args = _sellArgsBeforeTheChange(SPY, lotTokens);
        _blockInRegistry(Chain4663.SWAP_ROUTER_02);
        _assertSellOpReverts(
            account, args, abi.encodeWithSelector(ISleeveModule.RouterBlocked.selector, Chain4663.SWAP_ROUTER_02)
        );
    }

    function test_fork_sell_tokenPaused_reverts() public {
        (address account, uint256 lotTokens) = _lotAccount(SPY);
        OwnerOps.SellArgs memory args = _sellArgsBeforeTheChange(SPY, lotTokens);
        _pauseToken(Chain4663.SPY);
        _assertSellOpReverts(account, args, abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, Reason.PAUSED));
        args.overrideClosed = true;
        _assertSellOpReverts(account, args, abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, Reason.PAUSED));
    }

    function test_fork_sell_registryPaused_reverts() public {
        (address account, uint256 lotTokens) = _lotAccount(QQQ);
        OwnerOps.SellArgs memory args = _sellArgsBeforeTheChange(QQQ, lotTokens);
        _pauseRegistry();
        _assertSellOpReverts(account, args, abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, Reason.PAUSED));
    }

    function test_fork_sell_oraclePaused_reverts() public {
        (address account, uint256 lotTokens) = _lotAccount(QQQ);
        OwnerOps.SellArgs memory args = _sellArgsBeforeTheChange(QQQ, lotTokens);
        _pauseOracle(Chain4663.QQQ);
        args.overrideClosed = true;
        _assertSellOpReverts(
            account, args, abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, Reason.ORACLE_PAUSED)
        );
    }

    function test_fork_sell_multiplierDue_reverts() public {
        (address account, uint256 lotTokens) = _lotAccount(AAPL);
        OwnerOps.SellArgs memory args = _sellArgsBeforeTheChange(AAPL, lotTokens);
        _scheduleMultiplier(Chain4663.AAPL, IStockToken(Chain4663.AAPL).uiMultiplier() + 1e15);
        _assertSellOpReverts(
            account, args, abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, Reason.MULTIPLIER)
        );
    }

    /// The real USDG/USD round passes 25 hours two hours after this block while the stock round is still fresh: the
    /// sell refuses, with or without the override.
    function test_fork_sell_usdgRoundPast25Hours_reverts() public {
        (address account, uint256 lotTokens) = _lotAccount(SPY);
        OwnerOps.SellArgs memory args = _sellArgsBeforeTheChange(SPY, lotTokens);
        vm.warp(block.timestamp + 2 hours);
        (,,, uint256 updatedAt,) = IAggregatorV3(Chain4663.USDG_USD_FEED).latestRoundData();
        assertGt(block.timestamp - updatedAt, 25 hours, "USDG/USD past 25 hours");
        _assertSellOpReverts(account, args, abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, Reason.DEPEG));
        args.overrideClosed = true;
        _assertSellOpReverts(account, args, abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, Reason.DEPEG));
    }

    /// A quote the pool cannot meet: the module's own minimum check, after the discount cap, reverts TooLittleUsdg
    /// (audit A1-12) and nothing moves.
    function test_fork_sell_minimumOutFailure_reverts() public {
        Leg[5] memory legs = _legs();
        for (uint256 i; i < legs.length; ++i) {
            address account = _account(bytes32(i), _ruleOn(legs[i].tickerId));
            ISleeveModule.Receipt memory fill =
                _onlyReceipt(_keeperSplit(account, legs[i].pool, _quote(legs[i].tickerId, legs[i].pool, EQUITY)));
            OwnerOps.SellArgs memory args = _sellArgs(legs[i].tickerId, legs[i].pool, fill.tokensOut, 0);
            args.quote *= 2;
            uint256 usdgOut = _quoteSellOut(legs[i].tickerId, legs[i].pool, fill.tokensOut);
            uint256 minOut = fill.tokensOut * args.quote / 1e18 * 9_950 / 10_000;
            _assertSellOpReverts(
                account, args, abi.encodeWithSelector(ISleeveModule.TooLittleUsdg.selector, usdgOut, minOut)
            );
        }
    }

    /// Fallback, listed: no allowlisted pool fills part of an order, so the venue is PartialFillRouter, which sells 90
    /// percent through the real SwapRouter02 and SPY pool. A module on that venue cannot buy (its buys fill in part
    /// too), so the lot is seeded through SleeveModuleHarness over SPY the account bought from the real pool itself.
    function test_fork_sell_partialFill_reverts() public {
        ISleeveModule.ModuleConfig memory config = _config();
        config.swapRouter = new PartialFillRouter(ISwapRouter02(Chain4663.SWAP_ROUTER_02), 9_000);
        SleeveModuleHarness harness = new SleeveModuleHarness(config);
        module = harness;
        address account = _installedAccount(address(module), 0, 0, _installData(address(0), _defaultRule()));
        uint256 lotTokens = _ownerBuysDirectly(account, SPY, LaunchConfig.SPY_POOL_500, 100e6);
        harness.seedLot(77, account, SPY, Status.FILLED, lotTokens);
        OwnerOps.SellArgs memory args = _sellArgs(SPY, LaunchConfig.SPY_POOL_500, lotTokens, 0);
        args.quote = args.quote * 9 / 10;

        _assertSellOpReverts(
            account,
            args,
            abi.encodeWithSelector(ISleeveModule.PartialFill.selector, lotTokens, lotTokens * 9_000 / 10_000)
        );
    }

    // I6 and I7 as named tests

    /// I6: sale proceeds land in spend through the bracket, and neither endOwnerOp nor any later split counts them.
    function test_I6_fork_sell_proceedsAreNeverSplit() public {
        Leg memory leg = _legs()[0];
        address account = _account(0, _defaultRule());
        ISleeveModule.Receipt memory fill = _onlyReceipt(_keeperSplit(account, leg.pool, _quote(SPY, leg.pool, EQUITY)));
        uint256 usdgOut = _sellAndCheck(account, leg, fill.tokensOut, fill.id, Status.SOLD);

        vm.prank(stranger);
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.NothingWaiting.selector, account));
        module.observe(account);
        (,,, uint256 unsorted) = module.ledger(account);
        assertEq(unsorted, 0, "nothing for a split to sort");
        assertGt(usdgOut, 0);
    }

    /// I7 on the real pool: FILLED to PART_SOLD, PART_SOLD to PART_SOLD, PART_SOLD to SOLD, and the FILLED receipt's
    /// hash never changes.
    function test_I7_fork_sell_lotTransitions() public {
        Leg memory leg = _legs()[2];
        address account = _account(0, _ruleOn(NVDA));
        ISleeveModule.Receipt memory fill =
            _onlyReceipt(_keeperSplit(account, leg.pool, _quote(NVDA, leg.pool, EQUITY)));
        bytes32 filledHash = module.receiptHash(fill.id);
        _sellAndCheck(account, leg, fill.tokensOut / 10, fill.id, Status.PART_SOLD);
        _sellAndCheck(account, leg, fill.tokensOut / 10, fill.id, Status.PART_SOLD);
        _sellAndCheck(account, leg, fill.tokensOut - 2 * (fill.tokensOut / 10), fill.id, Status.SOLD);
        assertEq(module.receiptHash(fill.id), filledHash, "I7: the FILLED receipt stays as written");
        _assertSellOpReverts(
            account,
            OwnerOps.SellArgs({
                tickerId: NVDA,
                tokenAmount: 1,
                lotId: fill.id,
                pool: leg.pool,
                quote: 1,
                overrideClosed: false,
                overrideCapBps: 0
            }),
            abi.encodeWithSelector(ISleeveModule.ExceedsLots.selector, 1, 0)
        );
    }

    // Helpers

    /// @dev Sells 40 percent of the lot, then 30, then the rest, each in its own bracketed UserOp.
    /// @return proceeds USDG the three sells received.
    function _sellInThree(address account, Leg memory leg, ISleeveModule.Receipt memory fill)
        private
        returns (uint256 proceeds)
    {
        uint256 lotTokens = fill.tokensOut;
        uint256[3] memory amounts = [lotTokens * 4 / 10, lotTokens * 3 / 10, 0];
        amounts[2] = lotTokens - amounts[0] - amounts[1];
        Status[3] memory statuses = [Status.PART_SOLD, Status.PART_SOLD, Status.SOLD];
        for (uint256 j; j < amounts.length; ++j) {
            proceeds += _sellAndCheck(account, leg, amounts[j], fill.id, statuses[j]);
        }
        ISleeveModule.Lot memory lot = module.lot(fill.id);
        assertEq(uint8(lot.status), uint8(Status.SOLD));
        assertEq(lot.tokensRemaining, 0);
        (, uint256 head) = module.lotsOf(account, leg.tickerId);
        assertEq(head, 1, "the head moved past the sold lot");
        (address token,) = _tokenOf(leg.tickerId);
        assertEq(IERC20(token).balanceOf(account), 0, "every token sold");
    }

    /// @dev I6: the next payment's split sorts that payment only, and spend holds both spend parts and the proceeds.
    function _assertLaterSplitSortsOnlyThePayment(address account, Leg memory leg, uint256 proceeds) private {
        _pay(account, PAYMENT);
        ISleeveModule.Receipt memory split =
            _onlyReceipt(_keeperSplit(account, leg.pool, _quote(leg.tickerId, leg.pool, EQUITY)));
        assertEq(split.usdgIn, PAYMENT, "I6: the proceeds were never split");
        (uint256 balance, uint256 spend, uint256 pendingTotal, uint256 unsorted) = module.ledger(account);
        assertEq(spend, 2 * SPEND_PART + proceeds, "spend holds both spend parts and the proceeds");
        assertEq(balance, spend, "the second lot's USDG left");
        assertEq(pendingTotal + unsorted, 0);
    }

    /// @dev One sell of `amount` from the account's lots in a bracketed UserOp, checked against chain state.
    /// @return usdgOut USDG the pool paid.
    function _sellAndCheck(address account, Leg memory leg, uint256 amount, uint256 lotId, Status status)
        private
        returns (uint256 usdgOut)
    {
        OwnerOps.SellArgs memory args = _sellArgs(leg.tickerId, leg.pool, amount, 0);
        SellMeasured memory m = _measureSell(account, leg.tickerId, leg.pool);
        OpResult memory result = _ownerSell(account, args);
        assertTrue(result.success, string.concat(leg.name, ": sell UserOp"));
        ISleeveModule.Receipt[] memory receipts = _receiptsIn(result.logs, address(module));
        assertEq(receipts.length, 1, "one lot, one receipt");
        usdgOut = _assertSold(receipts[0], account, args, m, lotId, status);
        _assertProceedsAreTheModulesDelta(result, m.accountUsdg, usdgOut);
    }

    /// @dev An account with one lot of the ticker from a keeper split, and the lot's tokens.
    function _lotAccount(uint8 tickerId) private returns (address account, uint256 lotTokens) {
        Leg memory leg = _legOf(tickerId);
        account = _account(bytes32(uint256(tickerId)), _ruleOn(tickerId));
        lotTokens = _onlyReceipt(_keeperSplit(account, leg.pool, _quote(tickerId, leg.pool, EQUITY))).tokensOut;
    }

    /// @dev The sell's arguments, quoted before a pause or block that makes QuoterV2's simulation revert.
    function _sellArgsBeforeTheChange(uint8 tickerId, uint256 amount) private returns (OwnerOps.SellArgs memory) {
        return _sellArgs(tickerId, _legOf(tickerId).pool, amount, 0);
    }

    function _legOf(uint8 tickerId) private pure returns (Leg memory) {
        return _legs()[tickerId];
    }
}
