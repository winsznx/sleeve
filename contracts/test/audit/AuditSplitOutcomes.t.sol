// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    ERC7579Utils,
    Mode,
    ModePayload,
    ModeSelector
} from "@openzeppelin/contracts/account/utils/draft-ERC7579Utils.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {Reason, Status} from "../../src/types/SleeveTypes.sol";
import {SleeveModuleTradeUnitBase} from "../harness/SleeveModuleTradeUnitBase.sol";
import {MockAccount} from "../mocks/MockAccount.sol";

/// @notice Audit round 1, split outcomes and receipt fields: A1-14, A1-16 and A1-32 are confirmed and kept as built,
/// because the encodings follow PRD 9 and the ISleeveModule NatSpec; their fixes are documentation and the readers
/// (SPEC 9, 10 and 13, the app, the verifier, the metrics scripts and the keeper). A1-30's fix is keeper policy. These
/// tests pin the behavior those readers must handle, so a change to it shows up here.
contract AuditSplitOutcomesTest is SleeveModuleTradeUnitBase {
    /// @dev Saturday 3 October 2026 12:00 EDT, inside the weekend closure.
    uint256 private constant SATURDAY = 1_791_043_200;
    /// @dev Monday 5 October 2026 10:00 EDT, inside the session that opened Sunday 20:00 EDT.
    uint256 private constant MONDAY = 1_791_208_800;
    /// @dev Thursday 8 October 2026 12:00 EDT, five days after SATURDAY.
    uint256 private constant THURSDAY = SATURDAY + 5 days;
    /// @dev A router price that fills 150 bps above the feed, over the default 100 bps cap.
    uint256 private constant PRICE_ABOVE_CAP = FAIR_PRICE * 10_000 / 10_150;
    uint128 private constant CLIP = 25e6;

    function setUp() public {
        _setUpTrade();
    }

    // A1-14

    /// A 100 percent spend rule passes setRule (validateShares(10,000, 0)). Every payment then writes QUEUED with
    /// reason CLIP and usdgToEquity 0, as PRD 9 line 303 reads for a zero part, although nothing entered a bucket.
    /// Readers key on usdgToEquity == 0, never on the status alone. Whether an ACTIVE rule may invest nothing is an
    /// open owner question.
    function test_A1_14_zeroEquityRuleWritesQueuedClipForEveryPaymentWithNothingQueued() public {
        ISleeveModule.RuleInput memory allSpend = _defaultRule();
        (allSpend.spendBps, allSpend.equityBps) = (10_000, 0);
        MockAccount account = _account(allSpend, PAYMENT);
        assertEq(module.ruleOf(address(account)).equityBps, 0, "the rule was accepted");

        ISleeveModule.SplitPreview memory preview = module.previewSplit(address(account));
        assertEq(uint8(preview.status), uint8(Status.QUEUED), "preview: QUEUED");
        assertEq(uint8(preview.reason), uint8(Reason.CLIP), "preview: CLIP");
        assertEq(preview.equityPart, 0, "preview: nothing to queue");

        vm.recordLogs();
        _keeperSplit(address(account));
        _pay(address(account), 300e6);
        _keeperSplit(address(account));
        ISleeveModule.Receipt[] memory receipts = _receipts(vm.getRecordedLogs());

        assertEq(receipts.length, 2);
        uint256 queuedTotal;
        for (uint256 i; i < receipts.length; ++i) {
            assertEq(uint8(receipts[i].status), uint8(Status.QUEUED), "status QUEUED, also the indexed topic");
            assertEq(uint8(receipts[i].reason), uint8(Reason.CLIP), "reason CLIP");
            assertEq(receipts[i].usdgToEquity, 0, "no equity part");
            assertEq(receipts[i].usdgToSpend, receipts[i].usdgIn, "all of it went to spend");
            _assertI2(receipts[i]);
            queuedTotal += receipts[i].usdgQueued;
        }
        assertEq(queuedTotal, 0, "two QUEUED receipts, nothing queued");

        ISleeveModule.Bucket memory bucket = module.bucketOf(address(account), SPY);
        assertEq(bucket.amount, 0, "no bucket");
        assertEq(bucket.since, 0, "no bucket");
        _assertLedger(address(account), INSTALLED + PAYMENT + 300e6, INSTALLED + PAYMENT + 300e6, 0, 0);

        _expectKeeperSettleReverts(account, SPY, abi.encodeWithSelector(ISleeveModule.BelowClip.selector, 0, CLIP));
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.EmptyBucket.selector, address(account), SPY));
        vm.prank(address(account));
        module.release(SPY);
    }

    /// The same receipt for dust under the default 10 percent rule: 9 base units round to a zero equity part.
    function test_A1_14_dustWritesQueuedClipWithNothingQueued() public {
        MockAccount account = _account(_defaultRule(), 9);
        vm.recordLogs();
        _keeperSplit(address(account));
        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());

        assertEq(uint8(receipt.status), uint8(Status.QUEUED));
        assertEq(uint8(receipt.reason), uint8(Reason.CLIP));
        assertEq(receipt.usdgToSpend, 9);
        assertEq(receipt.usdgQueued, 0);
        assertEq(module.bucketOf(address(account), SPY).since, 0, "no bucket");
    }

    // A1-16

    /// A RECONCILED receipt puts the cut off spend in usdgSpent and the cut off the buckets in usdgQueued, with
    /// tickerId 0 and token zero, which mean no ticker. Readers sum usdgSpent as equity bought over FILLED and SETTLED
    /// only and usdgQueued as queued over QUEUED only: summed without regard to status, a third-party pull would count
    /// as investment, and the I2 identity holds on the RECONCILED receipt, so a status-blind check cannot catch it.
    function test_A1_16_reconciledReceiptReusesUsdgSpentAndUsdgQueuedForLedgerCuts() public {
        MockAccount account = _account(_ruleOn(NVDA), PAYMENT);
        vm.recordLogs();
        tokens[NVDA].setPaused(true);
        _keeperSplit(address(account));
        tokens[NVDA].setPaused(false);
        _pay(address(account), PAYMENT);
        _keeperSplit(address(account));
        uint256 nvdaBought = tokens[NVDA].balanceOf(address(account));
        assertGt(nvdaBought, 0, "one real buy");
        _assertLedger(address(account), 1_050e6, 1_000e6, 50e6, 0);

        _pullThroughOldApproval(account, 1_040e6);
        assertEq(module.previewSplit(address(account)).shortfall, 1_040e6);
        uint256 reconciledId = _keeperSplit(address(account));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        ISleeveModule.Receipt[] memory receipts = _receipts(logs);

        assertEq(receipts.length, 3);
        assertEq(uint8(receipts[0].status), uint8(Status.QUEUED));
        assertEq(uint8(receipts[1].status), uint8(Status.FILLED));
        ISleeveModule.Receipt memory reconciled = receipts[2];
        assertEq(reconciled.id, reconciledId);
        assertEq(uint8(reconciled.status), uint8(Status.RECONCILED));
        assertEq(reconciled.usdgIn, 1_040e6, "the shortfall");
        assertEq(reconciled.usdgSpent, 1_000e6, "usdgSpent is the cut off spend");
        assertEq(reconciled.usdgQueued, 40e6, "usdgQueued is a cut off the NVDA bucket");
        assertEq(reconciled.tokensOut, 0, "no buy");
        assertEq(reconciled.lotId, 0, "no lot");
        assertEq(module.lot(reconciled.id).account, address(0), "no lot");
        assertEq(reconciled.tickerId, SPY, "tickerId 0 reads as SPY, a ticker this account never touched");
        assertEq(reconciled.token, address(0));
        assertEq(module.bucketOf(address(account), NVDA).amount, 10e6, "the bucket shrank by usdgQueued");
        assertEq(
            reconciled.usdgIn,
            reconciled.usdgToSpend + reconciled.usdgSpent + reconciled.usdgQueued,
            "the I2 identity holds, so a status-blind check passes"
        );
        uint256[] memory fromBuckets = new uint256[](TICKER_COUNT);
        fromBuckets[NVDA] = 40e6;
        assertEq(_reconciledData(logs), abi.encode(10e6, 1_000e6, fromBuckets), "the event names the NVDA cut");

        (uint256 spentBlind, uint256 queuedBlind, uint256 spentByStatus, uint256 queuedByStatus) = _sums(receipts);
        assertEq(spentByStatus, 50e6, "USDG that bought NVDA");
        assertEq(spentBlind, 1_050e6, "a status-blind sum counts 1,000 USDG of phantom investment");
        assertEq(queuedByStatus, 50e6, "USDG that entered a bucket");
        assertEq(queuedBlind, 90e6, "a status-blind sum counts 40 USDG that left a bucket as queued");
    }

    // A1-32

    /// A bucket queued SESSION on Saturday. From Monday every settle fails PREMIUM and reverts with no state change,
    /// so on Thursday, five days after since, bucketOf still says SESSION and previewSettle says a buy would run.
    /// bucket.reason is the latest queue reason, as documented: the PRD 7.4 five-day prompt comes from the keeper's
    /// settle simulations, not from chain state.
    function test_A1_32_bucketKeepsTheWeekendReasonWhileEverySettleFailsOnPremium() public {
        vm.warp(SATURDAY);
        _setMarket();
        MockAccount account = _account(_defaultRule(), PAYMENT);
        _keeperSplit(address(account));
        _assertBucket(account, 50e6, SATURDAY, Reason.SESSION);

        router.setPrice(PRICE_ABOVE_CAP);
        uint256[2] memory days_ = [MONDAY, THURSDAY];
        for (uint256 i; i < days_.length; ++i) {
            vm.warp(days_[i]);
            _setMarket();
            ISleeveModule.SettlePreview memory preview = module.previewSettle(address(account), SPY);
            assertTrue(preview.buy, "the preview sees a clear guard");
            assertEq(uint8(preview.bucketReason), uint8(Reason.SESSION));
            _expectKeeperSettleReverts(
                account, SPY, abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, Reason.PREMIUM)
            );
            _assertBucket(account, 50e6, SATURDAY, Reason.SESSION);
        }
        assertGe(block.timestamp - SATURDAY, 5 days, "five days since the bucket's since");
        assertLt(block.timestamp - MONDAY, 5 days, "under five days on PREMIUM");
    }

    /// A later part below the clip overwrites the reason of a bucket above the clip that waits on PREMIUM: the bucket
    /// reads CLIP, a reason that does not apply to it, and since keeps the first queue time.
    function test_A1_32_aClipPartOverwritesTheReasonOfABucketWaitingOnPremium() public {
        router.setPrice(PRICE_ABOVE_CAP);
        MockAccount account = _account(_defaultRule(), PAYMENT);
        _keeperSplit(address(account));
        uint256 since = block.timestamp;
        _assertBucket(account, 50e6, since, Reason.PREMIUM);

        vm.warp(block.timestamp + 2 hours);
        _setMarket();
        _pay(address(account), 100e6);
        _keeperSplit(address(account));
        _assertBucket(account, 60e6, since, Reason.CLIP);
        assertGe(module.bucketOf(address(account), SPY).amount, CLIP, "the bucket is above the clip");

        ISleeveModule.SettlePreview memory preview = module.previewSettle(address(account), SPY);
        assertTrue(preview.buy);
        assertEq(uint8(preview.bucketReason), uint8(Reason.CLIP));
        _expectKeeperSettleReverts(
            account, SPY, abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, Reason.PREMIUM)
        );
        _assertBucket(account, 60e6, since, Reason.CLIP);
    }

    // A1-30

    /// One base unit to each of 20 installed accounts makes the keeper write 20 full receipts, each QUEUED CLIP with
    /// nothing queued. The fix is keeper policy (D-009 Q35): split at once from 1 USDG of unsorted, otherwise wait for
    /// the oldest inflow to reach 24 hours or for more income.
    function test_A1_30_oneBaseUnitMakesTheKeeperWriteAFullReceipt() public {
        uint256 count = 20;
        MockAccount[] memory accounts = new MockAccount[](count);
        for (uint256 i; i < count; ++i) {
            accounts[i] = _account(_defaultRule(), 1);
        }
        uint256 firstId = module.nextReceiptId();
        for (uint256 i; i < count; ++i) {
            vm.recordLogs();
            _keeperSplit(address(accounts[i]));
            ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());
            assertEq(uint8(receipt.status), uint8(Status.QUEUED));
            assertEq(uint8(receipt.reason), uint8(Reason.CLIP));
            assertEq(receipt.usdgIn, 1);
            assertEq(receipt.usdgQueued, 0, "nothing queued");
        }
        assertEq(module.nextReceiptId() - firstId, count, "one receipt per base unit sent");
    }

    // Helpers

    /// @dev A third party pulls USDG through an approval the account gave outside a bracket.
    function _pullThroughOldApproval(MockAccount account, uint256 amount) private {
        address puller = makeAddr("old approval");
        Mode single = ERC7579Utils.encodeMode(
            ERC7579Utils.CALLTYPE_SINGLE, ERC7579Utils.EXECTYPE_DEFAULT, ModeSelector.wrap(0), ModePayload.wrap(0)
        );
        account.execute(
            Mode.unwrap(single),
            abi.encodePacked(address(usdg), uint256(0), abi.encodeCall(IERC20.approve, (puller, amount)))
        );
        vm.prank(puller);
        IERC20(address(usdg)).transferFrom(address(account), puller, amount);
    }

    function _expectKeeperSettleReverts(MockAccount account, uint8 tickerId, bytes memory reason) private {
        uint256 amount = module.bucketOf(address(account), tickerId).amount;
        address pool = _pool(tickerId);
        uint256 quote = _quote(amount == 0 ? 1e6 : amount);
        vm.expectRevert(reason);
        vm.prank(keeper);
        module.settle(address(account), tickerId, pool, quote);
    }

    function _assertBucket(MockAccount account, uint256 amount, uint256 since, Reason reason) private view {
        ISleeveModule.Bucket memory bucket = module.bucketOf(address(account), SPY);
        assertEq(bucket.amount, amount, "bucket amount");
        assertEq(bucket.since, since, "bucket since");
        assertEq(uint8(bucket.reason), uint8(reason), "bucket reason");
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

    function _reconciledData(Vm.Log[] memory logs) private view returns (bytes memory data) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(module) && logs[i].topics[0] == ISleeveModule.Reconciled.selector) {
                return logs[i].data;
            }
        }
        revert("no Reconciled event");
    }

    /// @dev usdgSpent and usdgQueued summed over every receipt, and only over the statuses that give them their
    /// buy and queue meanings.
    function _sums(ISleeveModule.Receipt[] memory receipts)
        private
        pure
        returns (uint256 spentBlind, uint256 queuedBlind, uint256 spentByStatus, uint256 queuedByStatus)
    {
        for (uint256 i; i < receipts.length; ++i) {
            ISleeveModule.Receipt memory receipt = receipts[i];
            spentBlind += receipt.usdgSpent;
            queuedBlind += receipt.usdgQueued;
            if (receipt.status == Status.FILLED || receipt.status == Status.SETTLED) {
                spentByStatus += receipt.usdgSpent;
            }
            if (receipt.status == Status.QUEUED) queuedByStatus += receipt.usdgQueued;
        }
    }
}
