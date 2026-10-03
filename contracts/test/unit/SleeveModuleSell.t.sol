// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Execution} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {Status, Trigger} from "../../src/types/SleeveTypes.sol";
import {SleeveModuleSellUnitBase} from "../harness/SleeveModuleSellUnitBase.sol";
import {MockAccount} from "../mocks/MockAccount.sol";
import {OwnerOps} from "../utils/OwnerOps.sol";

/// @notice sell and reconcileLots without a fork, on MockTwoWayRouter and the mock market: every receipt field of a
/// sell, lots taken oldest first or by id, PART_SOLD sold again, pro rata shares that sum to the proceeds, the head of
/// the lot queue, proceeds in spend inside and outside a bracket and never split, a paused or missing rule, a removed
/// ticker, the lot reconcile after tokens left outside Sleeve, and I1, I3, I4, I6 and I7 for sells.
contract SleeveModuleSellTest is SleeveModuleSellUnitBase {
    function setUp() public {
        _setUpSell();
    }

    // PART_SOLD and SOLD

    function test_sell_PART_SOLD_writesEveryFieldAndCreditsSpend() public {
        (MockAccount account, uint256 lotId) = _lotAccount(_defaultRule());
        OwnerOps.SellArgs memory args = _args(SPY, 4e16, 0);
        uint256 usdgOut = venue.quoteSell(4e16);
        uint256 poolTokens = tokens[SPY].balanceOf(_pool(SPY));

        vm.recordLogs();
        uint256 id = _sell(account, args);
        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());

        assertEq(id, lotId + 1, "the receipt after the fill");
        assertEq(usdgOut, 20e6, "0.04 token at 500 USDG");
        _assertSoldReceipt(
            receipt,
            address(account),
            args,
            Sold({id: id, lotId: lotId, status: Status.PART_SOLD, tokensIn: 4e16, share: usdgOut}),
            usdgOut
        );
        assertEq(receipt.premiumBps, 0, "sold at the feed price");
        assertEq(receipt.execPrice, FAIR_SELL_PRICE);
        ISleeveModule.Lot memory lot = module.lot(lotId);
        assertEq(uint8(lot.status), uint8(Status.PART_SOLD));
        assertEq(lot.tokensBought, LOT_TOKENS);
        assertEq(lot.tokensRemaining, LOT_TOKENS - 4e16);
        (, uint256 head) = module.lotsOf(address(account), SPY);
        assertEq(head, 0, "the lot still holds tokens");
        _assertLedger(address(account), SPEND_AFTER_LOT + usdgOut, SPEND_AFTER_LOT + usdgOut, 0, 0);
        assertEq(tokens[SPY].balanceOf(address(account)), LOT_TOKENS - 4e16, "the tokens left the account");
        assertEq(tokens[SPY].balanceOf(_pool(SPY)) - poolTokens, 4e16, "to the pool");
        assertEq(IERC20(address(tokens[SPY])).allowance(address(account), address(venue)), 0, "I4: allowance zero");
        _assertI1();
    }

    /// Audit A1: a lot sold in part can be sold in part again, then to the end.
    function test_sell_aPartSoldLotSellsAgainThenSells() public {
        (MockAccount account, uint256 lotId) = _lotAccount(_defaultRule());
        uint256[3] memory amounts = [uint256(4e16), 3e16, 3e16];
        Status[3] memory statuses = [Status.PART_SOLD, Status.PART_SOLD, Status.SOLD];
        uint256 remaining = LOT_TOKENS;
        for (uint256 i; i < amounts.length; ++i) {
            OwnerOps.SellArgs memory args = _args(SPY, amounts[i], 0);
            uint256 usdgOut = venue.quoteSell(amounts[i]);
            vm.recordLogs();
            uint256 id = _sell(account, args);
            ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());
            remaining -= amounts[i];
            _assertSoldReceipt(
                receipt,
                address(account),
                args,
                Sold({id: id, lotId: lotId, status: statuses[i], tokensIn: amounts[i], share: usdgOut}),
                usdgOut
            );
            assertEq(uint8(module.lot(lotId).status), uint8(statuses[i]), "lot status");
            assertEq(module.lot(lotId).tokensRemaining, remaining, "lot remaining");
        }
        (, uint256 head) = module.lotsOf(address(account), SPY);
        assertEq(head, 1, "the head moved past the sold lot");
        assertEq(tokens[SPY].balanceOf(address(account)), 0);
        _assertSellReverts(account, _args(SPY, 1, 0), abi.encodeWithSelector(ISleeveModule.ExceedsLots.selector, 1, 0));
        _assertSellReverts(
            account, _args(SPY, 1, lotId), abi.encodeWithSelector(ISleeveModule.ExceedsLots.selector, 1, 0)
        );
    }

    /// D-009 Q30: by amount the oldest lot goes first. Each lot's receipt carries its part and its pro rata share,
    /// rounded down, and the last lot takes the remainder, so the shares sum to the USDG received exactly.
    function test_sell_byAmount_takesOldestLotsFirstWithProRataShares() public {
        (MockAccount account, uint256 first) = _lotAccount(_defaultRule());
        uint256 second = _buyLot(account);
        uint256 third = _buyLot(account);
        venue.setSellPrice(FAIR_SELL_PRICE - 1);
        OwnerOps.SellArgs memory args = _args(SPY, 25e16, 0);
        uint256 usdgOut = venue.quoteSell(25e16);
        uint256 usdgBefore = usdg.balanceOf(address(account));

        vm.recordLogs();
        uint256 id = _sell(account, args);
        ISleeveModule.Receipt[] memory receipts = _receipts(vm.getRecordedLogs());

        assertEq(usdgOut, 124_999_999, "a price that leaves a remainder");
        assertEq(receipts.length, 3, "one receipt per lot");
        assertEq(id, third + 1, "the first receipt's id");
        uint256 share = Math.mulDiv(usdgOut, LOT_TOKENS, 25e16);
        assertEq(share, 49_999_999);
        _assertSoldReceipt(
            receipts[0],
            address(account),
            args,
            Sold({id: id, lotId: first, status: Status.SOLD, tokensIn: LOT_TOKENS, share: share}),
            usdgOut
        );
        _assertSoldReceipt(
            receipts[1],
            address(account),
            args,
            Sold({id: id + 1, lotId: second, status: Status.SOLD, tokensIn: LOT_TOKENS, share: share}),
            usdgOut
        );
        _assertSoldReceipt(
            receipts[2],
            address(account),
            args,
            Sold({id: id + 2, lotId: third, status: Status.PART_SOLD, tokensIn: 5e16, share: usdgOut - 2 * share}),
            usdgOut
        );
        assertEq(receipts[2].usdgOut, 25_000_001, "the last lot takes the remainder");
        assertEq(
            receipts[0].usdgOut + receipts[1].usdgOut + receipts[2].usdgOut,
            usdg.balanceOf(address(account)) - usdgBefore,
            "the shares sum to the USDG received"
        );
        assertEq(receipts[0].premiumBps, 1, "the whole sell's discount, rounded against the owner");
        (, uint256 head) = module.lotsOf(address(account), SPY);
        assertEq(head, 2, "the head moved past both sold lots");
        assertEq(module.lot(third).tokensRemaining, 5e16);
    }

    /// By lot: only the named lot changes, wherever it sits in the queue.
    function test_sell_byLot_takesOnlyTheNamedLot() public {
        (MockAccount account, uint256 first) = _lotAccount(_defaultRule());
        uint256 second = _buyLot(account);

        vm.recordLogs();
        _sell(account, _args(SPY, 5e16, second));
        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());

        assertEq(receipt.lotId, second);
        assertEq(uint8(receipt.status), uint8(Status.PART_SOLD));
        assertEq(module.lot(second).tokensRemaining, 5e16);
        assertEq(module.lot(first).tokensRemaining, LOT_TOKENS, "the older lot untouched");
        assertEq(uint8(module.lot(first).status), uint8(Status.FILLED));
        (, uint256 head) = module.lotsOf(address(account), SPY);
        assertEq(head, 0);

        _sell(account, _args(SPY, LOT_TOKENS, first));
        assertEq(uint8(module.lot(first).status), uint8(Status.SOLD));
        (, head) = module.lotsOf(address(account), SPY);
        assertEq(head, 1, "selling the head lot out by id moves the head");
    }

    /// A sell by amount skips a lot an earlier sell by id emptied, and the head jumps over both empty lots.
    function test_sell_byAmount_skipsLotsSoldOutById() public {
        (MockAccount account, uint256 first) = _lotAccount(_defaultRule());
        uint256 second = _buyLot(account);
        uint256 third = _buyLot(account);
        _sell(account, _args(SPY, LOT_TOKENS, second));

        vm.recordLogs();
        _sell(account, _args(SPY, 15e16, 0));
        ISleeveModule.Receipt[] memory receipts = _receipts(vm.getRecordedLogs());

        assertEq(receipts.length, 2, "the emptied lot gets no receipt");
        assertEq(receipts[0].lotId, first);
        assertEq(uint8(receipts[0].status), uint8(Status.SOLD));
        assertEq(receipts[1].lotId, third);
        assertEq(uint8(receipts[1].status), uint8(Status.PART_SOLD));
        assertEq(receipts[1].tokensIn, 5e16);
        (, uint256 head) = module.lotsOf(address(account), SPY);
        assertEq(head, 2);
    }

    /// Lots of a SETTLED buy sell like FILLED ones.
    function test_sell_aSettledLot() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        tokens[SPY].setPaused(true);
        _keeperSplit(address(account));
        tokens[SPY].setPaused(false);
        uint256 lotId = _keeperSettle(address(account), SPY);
        assertEq(uint8(module.lot(lotId).status), uint8(Status.SETTLED));

        _sell(account, _args(SPY, 4e16, lotId));
        assertEq(uint8(module.lot(lotId).status), uint8(Status.PART_SOLD));
        _sell(account, _args(SPY, 6e16, lotId));
        assertEq(uint8(module.lot(lotId).status), uint8(Status.SOLD));
    }

    // Proceeds and the ledgers

    /// I6: the owner's sell inside its bracket is the module's USDG delta, so endOwnerOp books nothing for the owner,
    /// the proceeds sit in spend, and the next split sorts only the next payment.
    function test_I6_sell_insideABracket_proceedsAreTheModulesDeltaAndNeverSplit() public {
        (MockAccount account,) = _lotAccount(_defaultRule());
        uint256 usdgOut = venue.quoteSell(LOT_TOKENS);
        uint256 balanceAtBegin = usdg.balanceOf(address(account));

        vm.recordLogs();
        _ownerSell(account, _args(SPY, LOT_TOKENS, 0));
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(uint8(_onlyReceipt(logs).status), uint8(Status.SOLD));
        assertEq(uint8(_onlyReceipt(logs).trigger), uint8(Trigger.OWNER));
        _assertOwnerOpEnded(logs, balanceAtBegin, int256(usdgOut), 0, 0);
        _assertLedger(address(account), SPEND_AFTER_LOT + usdgOut, SPEND_AFTER_LOT + usdgOut, 0, 0);

        _pay(address(account), PAYMENT);
        vm.recordLogs();
        _keeperSplit(address(account));
        ISleeveModule.Receipt memory split = _onlyReceipt(vm.getRecordedLogs());
        assertEq(split.usdgIn, PAYMENT, "I6: the proceeds were not split");
        _assertLedgersWhole(address(account));
    }

    /// I6 outside a bracket: the owner's direct sell credits spend with exactly what arrived, so nothing becomes
    /// unsorted.
    function test_I6_sell_outsideABracket_creditsSpendDirectly() public {
        (MockAccount account,) = _lotAccount(_defaultRule());
        _pay(address(account), 30e6);
        uint256 usdgOut = venue.quoteSell(LOT_TOKENS);

        _sell(account, _args(SPY, LOT_TOKENS, 0));

        _assertLedger(address(account), SPEND_AFTER_LOT + 30e6 + usdgOut, SPEND_AFTER_LOT + usdgOut, 0, 30e6);
        vm.recordLogs();
        _keeperSplit(address(account));
        assertEq(_onlyReceipt(vm.getRecordedLogs()).usdgIn, 30e6, "I6: only the payment is split");
    }

    /// A sell inside a bracket after an owner outflow in the same batch: the outflow comes off spend, the proceeds
    /// go to spend, and endOwnerOp books exactly the outflow.
    function test_I6_sell_andAnOutflowInOneBracket() public {
        (MockAccount account,) = _lotAccount(_defaultRule());
        uint256 usdgOut = venue.quoteSell(LOT_TOKENS);
        uint256 balanceAtBegin = usdg.balanceOf(address(account));
        Execution[] memory calls = new Execution[](2);
        calls[0] = Execution(address(usdg), 0, abi.encodeCall(IERC20.transfer, (sink, 70e6)));
        OwnerOps.SellArgs memory args = _args(SPY, LOT_TOKENS, 0);
        calls[1] = Execution(
            address(module),
            0,
            abi.encodeCall(ISleeveModule.sell, (args.tickerId, args.tokenAmount, 0, args.pool, args.quote, false, 0))
        );

        vm.recordLogs();
        _ownerOp(account, OwnerOps.callData(address(module), calls));

        _assertOwnerOpEnded(vm.getRecordedLogs(), balanceAtBegin, int256(usdgOut), -70e6, 70e6);
        _assertLedger(address(account), SPEND_AFTER_LOT - 70e6 + usdgOut, SPEND_AFTER_LOT - 70e6 + usdgOut, 0, 0);
    }

    /// I6 inside one batch: the owner sells and then splits in the same bracket, and the split sorts only the income
    /// that arrived before, never the proceeds (D-009 Q13).
    function test_I6_sell_thenSplitInTheSameBracket() public {
        (MockAccount account,) = _lotAccount(_defaultRule());
        _pay(address(account), 30e6);
        uint256 usdgOut = venue.quoteSell(LOT_TOKENS);
        OwnerOps.SellArgs memory args = _args(SPY, LOT_TOKENS, 0);
        (address pool, uint256 quote) = _splitInputs(address(account));
        Execution[] memory calls = new Execution[](2);
        calls[0] = Execution(
            address(module),
            0,
            abi.encodeCall(ISleeveModule.sell, (SPY, LOT_TOKENS, 0, args.pool, args.quote, false, 0))
        );
        calls[1] = Execution(address(module), 0, abi.encodeCall(ISleeveModule.split, (address(account), pool, quote)));

        vm.recordLogs();
        _ownerOp(account, OwnerOps.callData(address(module), calls));
        ISleeveModule.Receipt[] memory receipts = _receipts(vm.getRecordedLogs());

        assertEq(receipts.length, 2);
        assertEq(uint8(receipts[0].status), uint8(Status.SOLD));
        assertEq(uint8(receipts[1].status), uint8(Status.QUEUED), "3 USDG of equity waits under the clip");
        assertEq(receipts[1].usdgIn, 30e6, "I6: only the income, never the proceeds");
        _assertLedger(address(account), SPEND_AFTER_LOT + 30e6 + usdgOut, SPEND_AFTER_LOT + 27e6 + usdgOut, 3e6, 0);
    }

    /// A paused rule does not stop a sell; the rule's caps and version still apply.
    function test_sell_withThePausedRule() public {
        (MockAccount account,) = _lotAccount(_defaultRule());
        _ownerOp(account, OwnerOps.pauseRule(address(module)));

        vm.recordLogs();
        _sell(account, _args(SPY, LOT_TOKENS, 0));
        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());

        assertEq(uint8(receipt.status), uint8(Status.SOLD));
        assertEq(receipt.ruleVersion, 1);
        assertEq(receipt.minOut, receipt.quote * LOT_TOKENS / 1e18 * 9_950 / 10_000, "the rule's slippage cap");
    }

    /// Without a rule the discount cap is zero unless the sell widens it, and minOut is the quote itself. The lot is
    /// seeded, since an account without a rule never buys.
    function test_sell_withoutARule() public {
        MockAccount account = _accountWith(address(module), INSTALLED, "");
        module.seedLot(77, address(account), SPY, Status.FILLED, LOT_TOKENS);
        tokens[SPY].mint(address(account), LOT_TOKENS);

        venue.setSellPrice(FAIR_SELL_PRICE - 50_000);
        _assertSellReverts(
            account,
            _args(SPY, 4e16, 0),
            abi.encodeWithSelector(ISleeveModule.DiscountAboveCap.selector, int256(1), uint16(0))
        );

        venue.setSellPrice(FAIR_SELL_PRICE);
        vm.recordLogs();
        _sell(account, _args(SPY, 4e16, 0));
        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());
        assertEq(receipt.ruleVersion, 0);
        assertEq(receipt.minOut, receipt.quote * 4e16 / 1e18, "no slippage allowance");
        assertEq(receipt.premiumBps, 0);

        venue.setSellPrice(FAIR_SELL_PRICE - 50_000);
        OwnerOps.SellArgs memory widened = _args(SPY, 4e16, 0);
        widened.overrideCapBps = 1;
        vm.recordLogs();
        _sell(account, widened);
        assertEq(_onlyReceipt(vm.getRecordedLogs()).overrideCapBps, 1, "widened from zero for this sell");
    }

    /// TokenSource keeps a removed ticker's pools, so lots bought before the removal still sell.
    function test_sell_aRemovedTickerStillSellsItsLots() public {
        (MockAccount account, uint256 lotId) = _lotAccount(_defaultRule());
        tokenSource.removeTicker(SPY);

        vm.recordLogs();
        _sell(account, _args(SPY, LOT_TOKENS, 0));
        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());

        assertEq(uint8(receipt.status), uint8(Status.SOLD));
        assertEq(receipt.lotId, lotId);
        assertEq(tokens[SPY].balanceOf(address(account)), 0);
    }

    // Invariants for sells

    /// I1: after sells by amount, by lot and inside a bracket the module holds no USDG and no stock token.
    function test_I1_sell_moduleHoldsNothingAfterEverySell() public {
        (MockAccount account, uint256 lotId) = _lotAccount(_defaultRule());
        _buyLot(account);
        _sell(account, _args(SPY, 3e16, 0));
        _assertI1();
        _sell(account, _args(SPY, 2e16, lotId));
        _assertI1();
        _ownerSell(account, _args(SPY, 15e16, 0));
        _assertI1();
    }

    /// I1 is a delta: balances someone sent the module before do not block a sell and are still there after.
    function test_I1_sell_strayBalancesOnTheModuleDoNotBlockSells() public {
        (MockAccount account,) = _lotAccount(_defaultRule());
        usdg.mint(address(module), 1);
        tokens[SPY].mint(address(module), 7);

        _sell(account, _args(SPY, LOT_TOKENS, 0));

        assertEq(usdg.balanceOf(address(module)), 1, "unchanged");
        assertEq(tokens[SPY].balanceOf(address(module)), 7, "unchanged");
        assertEq(tokens[SPY].balanceOf(address(account)), 0, "the sell ran");
    }

    /// I3 for sells: the USDG lands in the account, measured by balance, equal to the receipts' shares, and at least
    /// the minimum out.
    function test_I3_sell_usdgLandsInTheAccount() public {
        (MockAccount account,) = _lotAccount(_defaultRule());
        _buyLot(account);
        venue.setSellPrice(FAIR_SELL_PRICE - 333);
        uint256 usdgBefore = usdg.balanceOf(address(account));
        uint256 poolBefore = usdg.balanceOf(_pool(SPY));

        vm.recordLogs();
        _sell(account, _args(SPY, 13e16, 0));
        ISleeveModule.Receipt[] memory receipts = _receipts(vm.getRecordedLogs());

        uint256 arrived = usdg.balanceOf(address(account)) - usdgBefore;
        assertEq(arrived, venue.quoteSell(13e16), "I3: the proceeds are in the account");
        assertEq(receipts[0].usdgOut + receipts[1].usdgOut, arrived, "the receipts carry exactly what arrived");
        assertGe(arrived, receipts[0].minOut, "at least the minimum out");
        assertEq(poolBefore - usdg.balanceOf(_pool(SPY)), arrived, "the pool paid exactly what arrived");
        assertEq(usdg.balanceOf(address(venue)), 0, "the router holds no USDG");
    }

    /// I4 for sells: exactly tokenAmount leaves the account, only to the venue, under an exact approval that the same
    /// batch sets back to zero.
    function test_I4_sell_exactApprovalResetInTheSameCall() public {
        (MockAccount account,) = _lotAccount(_defaultRule());
        uint256 poolBefore = tokens[SPY].balanceOf(_pool(SPY));

        vm.recordLogs();
        _sell(account, _args(SPY, 6e16, 0));
        Vm.Log[] memory logs = vm.getRecordedLogs();

        uint256[] memory approvals = _approvals(logs, address(tokens[SPY]), address(account), address(venue));
        assertEq(approvals.length, 2, "one approval and its reset");
        assertEq(approvals[0], 6e16, "I4: exact");
        assertEq(approvals[1], 0, "I4: reset to zero");
        assertEq(IERC20(address(tokens[SPY])).allowance(address(account), address(venue)), 0);
        assertEq(tokens[SPY].balanceOf(address(account)), LOT_TOKENS - 6e16, "exactly the amount left");
        assertEq(tokens[SPY].balanceOf(_pool(SPY)) - poolBefore, 6e16, "I4: only to the pool");
        assertEq(tokens[SPY].balanceOf(address(venue)), 0, "the router holds no tokens");
    }

    /// I7 through real sells: FILLED to PART_SOLD, PART_SOLD to PART_SOLD, PART_SOLD to SOLD, and nothing after SOLD.
    function test_I7_sell_lotTransitionsThroughSells() public {
        (MockAccount account, uint256 lotId) = _lotAccount(_defaultRule());
        bytes32 filledHash = module.receiptHash(lotId);
        assertEq(uint8(module.lot(lotId).status), uint8(Status.FILLED));
        _sell(account, _args(SPY, 1e16, lotId));
        assertEq(uint8(module.lot(lotId).status), uint8(Status.PART_SOLD));
        _sell(account, _args(SPY, 1e16, lotId));
        assertEq(uint8(module.lot(lotId).status), uint8(Status.PART_SOLD));
        _sell(account, _args(SPY, 8e16, lotId));
        assertEq(uint8(module.lot(lotId).status), uint8(Status.SOLD));
        bytes32 soldHash = module.receiptHash(lotId + 3);
        _assertSellReverts(
            account, _args(SPY, 1, lotId), abi.encodeWithSelector(ISleeveModule.ExceedsLots.selector, 1, 0)
        );
        assertEq(module.receiptHash(lotId + 3), soldHash, "I7: the SOLD receipt stays as written");
        assertEq(module.receiptHash(lotId), filledHash, "I7: the FILLED receipt too");
    }

    /// Conservation across lots for any sell: the parts sum to the amount, the shares to the USDG received, each
    /// share but the last is rounded down, and each lot ends PART_SOLD or SOLD by what it has left.
    /// forge-config: default.fuzz.runs = 500
    function testFuzz_sell_partsAndSharesSumExactly(uint256 lotCount, uint256 amount, uint256 price) public {
        lotCount = bound(lotCount, 1, 5);
        (MockAccount account,) = _lotAccount(_defaultRule());
        for (uint256 i = 1; i < lotCount; ++i) {
            _buyLot(account);
        }
        // From 0.001 token the rounding of usdgOut stays under 0.2 bps, so every price here is inside the 100 bps cap.
        amount = bound(amount, 1e15, lotCount * LOT_TOKENS);
        price = bound(price, FAIR_SELL_PRICE * 9_910 / 10_000, FAIR_SELL_PRICE * 2);
        venue.setSellPrice(price);
        uint256 usdgOut = venue.quoteSell(amount);
        uint256 usdgBefore = usdg.balanceOf(address(account));

        vm.recordLogs();
        _sell(account, _args(SPY, amount, 0));
        ISleeveModule.Receipt[] memory receipts = _receipts(vm.getRecordedLogs());

        uint256 parts;
        uint256 shares;
        for (uint256 i; i < receipts.length; ++i) {
            parts += receipts[i].tokensIn;
            shares += receipts[i].usdgOut;
            if (i + 1 < receipts.length) {
                assertEq(receipts[i].usdgOut, usdgOut * receipts[i].tokensIn / amount, "rounded down");
            }
            ISleeveModule.Lot memory lot = module.lot(receipts[i].lotId);
            Status expected = lot.tokensRemaining == 0 ? Status.SOLD : Status.PART_SOLD;
            assertEq(uint8(receipts[i].status), uint8(expected), "status by what is left");
            assertEq(uint8(lot.status), uint8(expected));
        }
        assertEq(parts, amount, "the parts sum to the amount");
        assertEq(shares, usdg.balanceOf(address(account)) - usdgBefore, "the shares sum to the USDG received");
        assertEq(receipts.length, Math.ceilDiv(amount, LOT_TOKENS), "oldest lots first, each emptied before the next");
        _assertI1();
    }

    // reconcileLots

    function test_reconcileLots_withNothingToTrim_writesNothing() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        vm.prank(address(account));
        assertEq(module.reconcileLots(SPY), 0, "no lots");
        _keeperSplit(address(account));
        tokens[SPY].mint(address(account), 5);
        uint256 next = module.nextReceiptId();
        vm.prank(address(account));
        assertEq(module.reconcileLots(SPY), 0, "the balance covers the lots");
        assertEq(module.nextReceiptId(), next, "no receipt");
    }

    /// Audit A1-03, phantom lots: tokens moved out in a bracketed batch leave the lots above the balance. A sell above
    /// the balance reverts; reconcileLots trims the oldest lot first, the order sells take lots in, with one
    /// RECONCILED receipt per lot, and then the lots match the balance.
    function test_reconcileLots_trimsOldestFirstAfterTokensLeft() public {
        (MockAccount account, uint256 first) = _lotAccount(_defaultRule());
        uint256 second = _buyLot(account);
        _ownerOp(account, OwnerOps.transferToken(address(module), address(tokens[SPY]), sink, 15e16));
        uint256 balance = tokens[SPY].balanceOf(address(account));
        assertEq(balance, 5e16);

        _assertSellReverts(
            account, _args(SPY, 6e16, 0), abi.encodeWithSelector(ISleeveModule.ExceedsBalance.selector, 6e16, 5e16)
        );

        uint256 next = module.nextReceiptId();
        vm.recordLogs();
        vm.expectEmit(address(module));
        emit ISleeveModule.LotsReconciled(address(account), SPY, 5e16, 15e16);
        vm.prank(address(account));
        uint256 id = module.reconcileLots(SPY);
        ISleeveModule.Receipt[] memory receipts = _receipts(vm.getRecordedLogs());

        assertEq(id, next);
        assertEq(receipts.length, 2);
        _assertReconciledLot(receipts[0], address(account), next, first, LOT_TOKENS);
        _assertReconciledLot(receipts[1], address(account), next + 1, second, 5e16);
        assertEq(module.lot(first).tokensRemaining, 0);
        assertEq(module.lot(second).tokensRemaining, 5e16);
        assertEq(uint8(module.lot(first).status), uint8(Status.FILLED), "status unchanged");
        assertEq(uint8(module.lot(second).status), uint8(Status.FILLED), "status unchanged");
        (, uint256 head) = module.lotsOf(address(account), SPY);
        assertEq(head, 1, "the head moved past the emptied oldest lot");

        _assertSellReverts(
            account, _args(SPY, 6e16, 0), abi.encodeWithSelector(ISleeveModule.ExceedsLots.selector, 6e16, 5e16)
        );
        vm.recordLogs();
        _sell(account, _args(SPY, 5e16, 0));
        ISleeveModule.Receipt memory sold = _onlyReceipt(vm.getRecordedLogs());
        assertEq(sold.lotId, second);
        assertEq(uint8(sold.status), uint8(Status.SOLD));
        (, head) = module.lotsOf(address(account), SPY);
        assertEq(head, 2, "both lots are empty now");
    }

    /// A trim keeps a PART_SOLD lot PART_SOLD, and a trim to zero moves the head past every emptied lot.
    function test_reconcileLots_toZeroKeepsStatusesAndMovesTheHead() public {
        (MockAccount account, uint256 first) = _lotAccount(_defaultRule());
        uint256 second = _buyLot(account);
        _sell(account, _args(SPY, 3e16, first));
        _ownerOp(account, OwnerOps.transferToken(address(module), address(tokens[SPY]), sink, 17e16));

        vm.prank(address(account));
        module.reconcileLots(SPY);

        assertEq(module.lot(first).tokensRemaining, 0);
        assertEq(module.lot(second).tokensRemaining, 0);
        assertEq(uint8(module.lot(first).status), uint8(Status.PART_SOLD));
        assertEq(uint8(module.lot(second).status), uint8(Status.FILLED));
        (, uint256 head) = module.lotsOf(address(account), SPY);
        assertEq(head, 2);
        _assertSellReverts(account, _args(SPY, 1, 0), abi.encodeWithSelector(ISleeveModule.ExceedsLots.selector, 1, 0));
    }

    /// A lot already sold out by id inside the trimmed range gets no receipt; the trim goes on to the next newer lot.
    function test_reconcileLots_skipsEmptyLots() public {
        (MockAccount account, uint256 first) = _lotAccount(_defaultRule());
        uint256 second = _buyLot(account);
        uint256 third = _buyLot(account);
        _sell(account, _args(SPY, LOT_TOKENS, second));
        _ownerOp(account, OwnerOps.transferToken(address(module), address(tokens[SPY]), sink, 15e16));

        vm.recordLogs();
        vm.prank(address(account));
        module.reconcileLots(SPY);
        ISleeveModule.Receipt[] memory receipts = _receipts(vm.getRecordedLogs());

        assertEq(receipts.length, 2, "no receipt for the empty lot");
        assertEq(receipts[0].lotId, first);
        assertEq(receipts[0].tokensIn, LOT_TOKENS);
        assertEq(receipts[1].lotId, third);
        assertEq(receipts[1].tokensIn, 5e16);
        assertEq(module.lot(first).tokensRemaining, 0);
        assertEq(module.lot(third).tokensRemaining, 5e16);
        assertEq(uint8(module.lot(second).status), uint8(Status.SOLD));
    }

    function test_reconcileLots_byACallerWithoutTheModule_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.NotInstalled.selector, stranger));
        vm.prank(stranger);
        module.reconcileLots(SPY);
    }

    // Helpers

    function _assertReconciledLot(
        ISleeveModule.Receipt memory receipt,
        address account,
        uint256 id,
        uint256 lotId,
        uint256 trimmed
    ) private view {
        ISleeveModule.Receipt memory expected;
        expected.id = id;
        expected.account = account;
        expected.ruleVersion = 1;
        expected.trigger = Trigger.OWNER;
        expected.status = Status.RECONCILED;
        expected.tickerId = SPY;
        expected.token = address(tokens[SPY]);
        expected.tokensIn = trimmed;
        expected.calendarVersion = CALENDAR_VERSION;
        expected.disclosureHash = DISCLOSURE_HASH;
        expected.l2Block = L2_BLOCK;
        expected.timestamp = block.timestamp;
        expected.lotId = lotId;
        assertEq(abi.encode(receipt), abi.encode(expected), "every RECONCILED field");
        assertEq(module.receiptHash(id), keccak256(abi.encode(expected)), "stored hash");
    }

    /// @dev The one OwnerOpEnded in `logs` books the sell's proceeds as the module's delta and only the owner's own
    /// outflow, off spend, as the owner's.
    function _assertOwnerOpEnded(
        Vm.Log[] memory logs,
        uint256 balanceAtBegin,
        int256 moduleDelta,
        int256 ownerDelta,
        uint256 fromSpend
    ) private view {
        uint256 seen;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(module) || logs[i].topics[0] != ISleeveModule.OwnerOpEnded.selector) {
                continue;
            }
            ++seen;
            assertEq(
                logs[i].data,
                abi.encode(balanceAtBegin, moduleDelta, ownerDelta, fromSpend, uint256(0), new uint256[](0)),
                "the proceeds are the module's delta"
            );
        }
        assertEq(seen, 1, "one OwnerOpEnded");
    }

    /// @dev Every Approval(owner, spender, value) the token emitted in `logs`, in order.
    function _approvals(Vm.Log[] memory logs, address token, address owner, address spender)
        private
        pure
        returns (uint256[] memory values)
    {
        bytes32 approval = keccak256("Approval(address,address,uint256)");
        uint256 count;
        for (uint256 i; i < logs.length; ++i) {
            if (_isApproval(logs[i], token, approval, owner, spender)) ++count;
        }
        values = new uint256[](count);
        count = 0;
        for (uint256 i; i < logs.length; ++i) {
            if (_isApproval(logs[i], token, approval, owner, spender)) {
                values[count++] = abi.decode(logs[i].data, (uint256));
            }
        }
    }

    function _isApproval(Vm.Log memory log, address token, bytes32 topic0, address owner, address spender)
        private
        pure
        returns (bool)
    {
        return log.emitter == token && log.topics.length == 3 && log.topics[0] == topic0
            && log.topics[1] == bytes32(uint256(uint160(owner))) && log.topics[2] == bytes32(uint256(uint160(spender)));
    }
}
