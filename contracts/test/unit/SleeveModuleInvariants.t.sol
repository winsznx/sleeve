// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {Reason, Status} from "../../src/types/SleeveTypes.sol";
import {SleeveModuleTradeUnitBase} from "../harness/SleeveModuleTradeUnitBase.sol";
import {MockAccount} from "../mocks/MockAccount.sol";
import {OwnerOps} from "../utils/OwnerOps.sol";

/// @notice PRD invariants I1 to I4, I7 and I8 for split, settle and release without a fork: fuzzed against every
/// guard outcome on the mock market, plus the append-only receipt log and the lot transition table. The sell's named
/// invariant tests are in SleeveModuleSell.t.sol.
contract SleeveModuleInvariantsTest is SleeveModuleTradeUnitBase {
    /// @dev Market conditions a fuzz run picks from.
    uint256 private constant PATHS = 10;

    function setUp() public {
        _setUpTrade();
    }

    // I1

    /// I1: after every action the module holds no USDG and no stock token.
    function test_I1_moduleHoldsNothingAfterEveryAction() public {
        ISleeveModule.RuleInput memory rule = _defaultRule();
        MockAccount account = _account(rule, PAYMENT);
        vm.prank(stranger);
        module.observe(address(account));
        _assertI1();
        _keeperSplit(address(account));
        _assertI1();
        tokens[SPY].setPaused(true);
        _pay(address(account), PAYMENT);
        _keeperSplit(address(account));
        _assertI1();
        tokens[SPY].setPaused(false);
        _keeperSettle(address(account), SPY);
        _assertI1();
        tokens[SPY].setPaused(true);
        _pay(address(account), PAYMENT);
        _keeperSplit(address(account));
        vm.prank(address(account));
        module.release(SPY);
        _assertI1();
        _ownerSplit(account);
        _assertI1();
    }

    // I2

    /// I2 on every split path: usdgIn == usdgToSpend + usdgSpent + usdgQueued, the ledgers account for the whole
    /// balance, and pendingTotal stays the sum of the buckets.
    /// forge-config: default.fuzz.runs = 2000
    function testFuzz_I2_everySplitReceiptConservesUsdg(uint256 payment, uint256 equityBps, uint256 path) public {
        payment = bound(payment, 1, 1e13);
        equityBps = bound(equityBps, 0, 10_000);
        path = bound(path, 0, PATHS - 1);
        ISleeveModule.RuleInput memory rule = _defaultRule();
        (rule.spendBps, rule.equityBps) = (uint16(10_000 - equityBps), uint16(equityBps));
        MockAccount account = _account(rule, payment);
        _setPath(address(account), path);

        vm.recordLogs();
        _keeperSplit(address(account));
        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());

        _assertI2(receipt);
        assertEq(receipt.usdgIn, payment, "the whole payment sorted");
        assertEq(receipt.usdgToEquity, payment * equityBps / 10_000, "equity part rounds down");
        assertEq(receipt.usdgIn - receipt.usdgToEquity, payment - payment * equityBps / 10_000, "dust to spend");
        (,,, uint256 unsorted) = module.ledger(address(account));
        assertEq(unsorted, 0, "nothing left unsorted");
        _assertLedgersWhole(address(account));
        _assertI1();
    }

    // I3 and I4

    /// I3 and I4 on fills of any size: exactly the equity part leaves the account, all of it reaches the venue,
    /// the tokens land in the account, and the allowance is zero again.
    /// forge-config: default.fuzz.runs = 1000
    function testFuzz_I3_I4_aFillMovesExactlyTheEquityPartToTheVenue(uint256 payment, uint256 equityBps) public {
        payment = bound(payment, 1e6, 1e13);
        equityBps = bound(equityBps, 1, 10_000);
        uint256 equity = payment * equityBps / 10_000;
        vm.assume(equity >= 1e6);
        ISleeveModule.RuleInput memory rule = _defaultRule();
        (rule.spendBps, rule.equityBps, rule.minClip) = (uint16(10_000 - equityBps), uint16(equityBps), 1e6);
        MockAccount account = _account(rule, payment);
        uint256 accountBefore = usdg.balanceOf(address(account));
        uint256 routerBefore = usdg.balanceOf(address(router));

        vm.recordLogs();
        _keeperSplit(address(account));
        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());

        assertEq(uint8(receipt.status), uint8(Status.FILLED));
        assertEq(accountBefore - usdg.balanceOf(address(account)), equity, "I4: at most the equity part left");
        assertEq(usdg.balanceOf(address(router)) - routerBefore, equity, "I4: only to the venue");
        assertEq(IERC20(address(usdg)).allowance(address(account), address(router)), 0, "I4: allowance zero");
        assertEq(tokens[SPY].balanceOf(address(account)), receipt.tokensOut, "I3: tokens in the account");
        assertGe(receipt.tokensOut, receipt.minOut, "I3: at least the minimum");
        _assertI1();
    }

    // I7

    /// I7: ids run 1, 2, 3 across accounts and actions, and a stored hash never changes once written.
    function test_I7_receiptHashesWriteOnceAcrossEveryAction() public {
        MockAccount first = _account(_defaultRule(), PAYMENT);
        MockAccount second = _account(_ruleOn(NVDA), PAYMENT);
        bytes32[] memory hashes = new bytes32[](8);
        uint256 written;

        _keeperSplit(address(first));
        tokens[NVDA].setPaused(true);
        _keeperSplit(address(second));
        tokens[NVDA].setPaused(false);
        _keeperSettle(address(second), NVDA);
        tokens[SPY].setOraclePaused(true);
        _pay(address(first), PAYMENT);
        _keeperSplit(address(first));
        vm.prank(address(first));
        module.release(SPY);
        written = module.nextReceiptId() - 1;
        assertEq(written, 5);
        for (uint256 id = 1; id <= written; ++id) {
            hashes[id] = module.receiptHash(id);
            assertTrue(hashes[id] != bytes32(0), "written");
        }

        tokens[SPY].setOraclePaused(false);
        _pay(address(first), PAYMENT);
        _keeperSplit(address(first));
        _ownerOp(first, OwnerOps.uninstall(address(module), address(first)));

        for (uint256 id = 1; id <= written; ++id) {
            assertEq(module.receiptHash(id), hashes[id], "I7: a written hash never changes");
        }
        assertEq(module.receiptHash(module.nextReceiptId()), bytes32(0), "the next id is not written");
    }

    /// I7: lots exist only for FILLED and SETTLED receipts, under the receipt's id.
    function test_I7_onlyFillsCreateLots() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        tokens[SPY].setPaused(true);
        _keeperSplit(address(account));
        tokens[SPY].setPaused(false);
        uint256 settled = _keeperSettle(address(account), SPY);
        _pay(address(account), PAYMENT);
        uint256 filled = _keeperSplit(address(account));
        tokens[SPY].setPaused(true);
        _pay(address(account), PAYMENT);
        uint256 queued = _keeperSplit(address(account));
        vm.prank(address(account));
        uint256 released = module.release(SPY);

        assertEq(uint8(module.lot(settled).status), uint8(Status.SETTLED));
        assertEq(uint8(module.lot(filled).status), uint8(Status.FILLED));
        assertEq(module.lot(1).account, address(0), "QUEUED made no lot");
        assertEq(module.lot(queued).account, address(0), "QUEUED made no lot");
        assertEq(module.lot(released).account, address(0), "RELEASED made no lot");
        (uint256[] memory lotIds,) = module.lotsOf(address(account), SPY);
        assertEq(lotIds.length, 2);
        assertEq(lotIds[0], settled, "oldest first");
        assertEq(lotIds[1], filled);
    }

    /// I7, SPEC section 14: FILLED, SETTLED or PART_SOLD to PART_SOLD or SOLD. PART_SOLD to PART_SOLD is a second
    /// partial sell of the same lot (audit A1). Every other pair of statuses reverts BadLotTransition, and an id with
    /// no lot reverts UnknownLot.
    function test_I7_lotTransitionsOnlyAsAllowed() public {
        address account = makeAddr("lot holder");
        uint256 statuses = uint256(type(Status).max) + 1;
        for (uint256 from; from < statuses; ++from) {
            for (uint256 to; to < statuses; ++to) {
                uint256 lotId = 1_000 + from * statuses + to;
                module.seedLot(lotId, account, SPY, Status(from), 1e18);
                bool allowed = _allowed(Status(from), Status(to));
                if (!allowed) {
                    vm.expectRevert(
                        abi.encodeWithSelector(ISleeveModule.BadLotTransition.selector, lotId, Status(from), Status(to))
                    );
                }
                module.transitionLot(lotId, Status(to));
                assertEq(uint8(module.lot(lotId).status), allowed ? to : from, "status");
            }
        }
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.UnknownLot.selector, 7));
        module.transitionLot(7, Status.SOLD);
    }

    /// I7, audit A1: a lot sold in part can be sold in part again, as often as it keeps tokens, and then sold out.
    function test_I7_aPartSoldLotCanBePartSoldAgain() public {
        module.seedLot(1, makeAddr("holder"), SPY, Status.SETTLED, 1e18);
        module.transitionLot(1, Status.PART_SOLD);
        for (uint256 i; i < 3; ++i) {
            module.transitionLot(1, Status.PART_SOLD);
            assertEq(uint8(module.lot(1).status), uint8(Status.PART_SOLD));
        }
        module.transitionLot(1, Status.SOLD);
        assertEq(uint8(module.lot(1).status), uint8(Status.SOLD));
    }

    /// I7: a lot that went SOLD cannot move again.
    function test_I7_aSoldLotIsFinal() public {
        module.seedLot(1, makeAddr("holder"), SPY, Status.FILLED, 1e18);
        module.transitionLot(1, Status.PART_SOLD);
        module.transitionLot(1, Status.SOLD);
        for (uint256 to; to <= uint256(type(Status).max); ++to) {
            vm.expectRevert(abi.encodeWithSelector(ISleeveModule.BadLotTransition.selector, 1, Status.SOLD, Status(to)));
            module.transitionLot(1, Status(to));
        }
    }

    // I8

    /// I8: whatever the venue's premium, the cap, the stock round's age and the oracle pause, a FILLED receipt never
    /// shows a premium above its cap, a round older than 25 hours or from before the session, or a paused oracle.
    /// forge-config: default.fuzz.runs = 2000
    function testFuzz_I8_noFillAboveTheCapOnAStaleRoundOrPausedOracle(
        uint256 venuePremiumBps,
        uint256 capBps,
        uint256 age,
        bool oraclePaused
    ) public {
        venuePremiumBps = bound(venuePremiumBps, 0, 1_000);
        capBps = bound(capBps, 0, 500);
        age = bound(age, 0, 2 days);
        router.setPrice(FAIR_PRICE * 10_000 / (10_000 + venuePremiumBps));
        feeds[SPY].setRound(2, FEED_ANSWER, block.timestamp - age);
        tokens[SPY].setOraclePaused(oraclePaused);
        ISleeveModule.RuleInput memory rule = _defaultRule();
        rule.premiumCapBps = uint16(capBps);
        MockAccount account = _account(rule, PAYMENT);

        vm.recordLogs();
        _keeperSplit(address(account));
        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());

        bool stale = age > 25 hours || block.timestamp - age < WEEK_OPENED_AT;
        if (receipt.status == Status.FILLED) {
            assertFalse(oraclePaused, "I8: no fill with the oracle paused");
            assertFalse(stale, "I8: no fill on a stale round");
            assertLe(receipt.premiumBps, int256(capBps), "I8: no fill above the cap");
            assertLe(block.timestamp - receipt.updatedAt, 25 hours);
            assertGe(receipt.updatedAt, WEEK_OPENED_AT);
            uint256 paid = receipt.usdgSpent * 1e20 * 10_000;
            uint256 limit = receipt.tokensOut * uint256(receipt.answer) * (10_000 + capBps);
            assertLe(paid, limit, "I8: exact premium inside the cap");
        } else {
            assertEq(uint8(receipt.status), uint8(Status.QUEUED));
            Reason expected = oraclePaused ? Reason.ORACLE_PAUSED : stale ? Reason.STALE : Reason.PREMIUM;
            assertEq(uint8(receipt.reason), uint8(expected), "queued for the first failing step");
        }
    }

    // Helpers

    /// @dev Sets one market condition for the next split: 0 clear, then PAUSED, ORACLE_PAUSED, SESSION, MULTIPLIER,
    /// STALE, DEPEG, PREMIUM, a removed ticker and a blocked account.
    function _setPath(address account, uint256 path) private {
        if (path == 1) tokens[SPY].setPaused(true);
        if (path == 2) tokens[SPY].setOraclePaused(true);
        if (path == 3) vm.warp(block.timestamp + 1 days);
        if (path == 4) tokens[SPY].scheduleMultiplier(1.003e18, block.timestamp + 1 hours);
        if (path == 5) feeds[SPY].setRound(2, FEED_ANSWER, block.timestamp - 26 hours);
        if (path == 6) usdgUsdFeed.setRound(2, 0.9e8, block.timestamp);
        if (path == 7) router.setPrice(FAIR_PRICE / 2);
        if (path == 8) tokenSource.removeTicker(SPY);
        if (path == 9) registry.setBlocked(account, true);
    }

    /// @dev The six allowed pairs of SPEC section 14, listed.
    function _allowed(Status from, Status to) private pure returns (bool) {
        Status[2][6] memory pairs = [
            [Status.FILLED, Status.PART_SOLD],
            [Status.FILLED, Status.SOLD],
            [Status.SETTLED, Status.PART_SOLD],
            [Status.SETTLED, Status.SOLD],
            [Status.PART_SOLD, Status.PART_SOLD],
            [Status.PART_SOLD, Status.SOLD]
        ];
        for (uint256 i; i < pairs.length; ++i) {
            if (pairs[i][0] == from && pairs[i][1] == to) return true;
        }
        return false;
    }
}
