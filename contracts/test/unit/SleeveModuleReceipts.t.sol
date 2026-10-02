// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {MODULE_TYPE_EXECUTOR} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {AccountingMode, Reason, Status, Trigger} from "../../src/types/SleeveTypes.sol";
import {SleeveModuleHarness} from "../harness/SleeveModuleHarness.sol";
import {SleeveModuleUnitBase} from "../harness/SleeveModuleUnitBase.sol";
import {MockAccount} from "../mocks/MockAccount.sol";
import {OwnerOps} from "../utils/OwnerOps.sol";

/// @notice Receipt plumbing without a fork: sequential ids from 1, the fields the module fills, the stored hash
/// against an independent abi.encode, append-only hashes (I7), and the RELEASED receipts of _releaseBucket, the
/// uninstall release and an install over stale buckets.
contract SleeveModuleReceiptsTest is SleeveModuleUnitBase {
    /// @dev Fork block 78,312,136, which the ArbSys mock returns as the L2 block.
    uint256 private constant L2_BLOCK = 78_312_136;
    /// @dev Wednesday 3 March 2027, a trading day, as a New York day number.
    uint256 private constant TRADING_DAY_2027 = 20_880;
    address private constant POOL = 0xa7Bb1AC63BBaB0C44316E6c8C455213441689167;

    SleeveModuleHarness private module;

    function setUp() public {
        _setUpMocks();
        vm.roll(L2_BLOCK);
        module = _deployHarness();
    }

    function test_writeReceipt_assignsSequentialIdsFromOne() public {
        address account = makeAddr("account");
        assertEq(module.nextReceiptId(), 1);
        for (uint256 expected = 1; expected <= 3; ++expected) {
            ISleeveModule.Receipt memory receipt;
            receipt.status = Status.QUEUED;
            assertEq(module.writeReceipt(account, receipt), expected, "id");
            assertEq(module.nextReceiptId(), expected + 1, "next id");
        }
    }

    /// The caller's fields pass through; id, account, mode, calendar version, disclosure hash, L2 block and timestamp
    /// are the module's, whatever the caller put there. The hash and the event match an encoding built here.
    function test_writeReceipt_fillsTheModuleFieldsAndHashesTheWholeReceipt() public {
        address account = makeAddr("account");
        ISleeveModule.Receipt memory written = _sample();
        written.id = 99;
        written.account = makeAddr("not the account");
        written.calendarVersion = 7;
        written.disclosureHash = keccak256("other");
        written.l2Block = 1;
        written.timestamp = 1;

        vm.recordLogs();
        uint256 id = module.writeReceipt(account, written);

        ISleeveModule.Receipt memory expected = _sample();
        expected.id = 1;
        expected.account = account;
        expected.mode = AccountingMode.WRAPPED;
        expected.calendarVersion = 0x00010000;
        expected.disclosureHash = DISCLOSURE_HASH;
        expected.l2Block = L2_BLOCK;
        expected.timestamp = NOW;
        assertEq(id, 1);
        assertEq(module.receiptHash(1), keccak256(abi.encode(expected)), "stored hash");
        _assertReceiptEvent(vm.getRecordedLogs(), 0, expected);
    }

    function test_writeReceipt_carriesTheCalendarVersionInForce() public {
        address account = makeAddr("account");
        ISleeveModule.Receipt memory receipt;
        vm.recordLogs();
        module.writeReceipt(account, receipt);
        calendar.addClosure(TRADING_DAY_2027);
        module.writeReceipt(account, receipt);
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertEq(_decodeReceipt(logs, 0).calendarVersion, 0x00010000, "library version 1, no writes");
        assertEq(_decodeReceipt(logs, 1).calendarVersion, 0x00010001, "one write");
    }

    /// I7: a stored hash never changes as later receipts are written.
    function test_I7_receiptHashesAreAppendOnly() public {
        address account = makeAddr("account");
        ISleeveModule.Receipt memory first = _sample();
        module.writeReceipt(account, first);
        bytes32 firstHash = module.receiptHash(1);
        for (uint256 i; i < 5; ++i) {
            vm.warp(block.timestamp + 1 hours);
            ISleeveModule.Receipt memory later = _sample();
            later.usdgIn = i;
            module.writeReceipt(account, later);
        }
        assertEq(module.receiptHash(1), firstHash);
        assertEq(module.receiptHash(7), bytes32(0), "an id not written yet has no hash");
    }

    function test_releaseBucket_movesTheWholeBucketToSpendWithAReleasedReceipt() public {
        MockAccount account = _accountWith(address(module), 100e6, _installData(address(0), _defaultRule()));
        _pay(address(account), 40e6);
        uint256 queuedAt = block.timestamp;
        module.seedBucket(address(account), QQQ, 7e6, Reason.PREMIUM);
        vm.warp(block.timestamp + 3 days);

        vm.recordLogs();
        uint256 released = module.releaseBucket(address(account), QQQ, Trigger.OWNER);

        assertEq(released, 7e6);
        (, uint256 spend, uint256 pendingTotal, uint256 unsorted) = module.ledger(address(account));
        assertEq(spend, 107e6, "bucket went to spend");
        assertEq(pendingTotal, 0);
        assertEq(unsorted, 33e6, "unsorted untouched");
        ISleeveModule.Bucket memory bucket = module.bucketOf(address(account), QQQ);
        assertEq(bucket.amount, 0);
        assertEq(bucket.since, 0, "deleted");
        ISleeveModule.Receipt memory expected =
            _released(address(account), 1, QQQ, 7e6, Reason.PREMIUM, queuedAt, 1, Trigger.OWNER);
        assertEq(module.receiptHash(1), keccak256(abi.encode(expected)));
        _assertReceiptEvent(vm.getRecordedLogs(), 0, expected);
    }

    /// PRD 7.1: uninstall releases pending equity to spend. Every non-empty bucket gets a RELEASED receipt in
    /// ascending ticker id, then the account's state goes; the receipts stay.
    function test_onUninstall_releasesEveryBucketInTickerOrderThenDeletesTheState() public {
        MockAccount account = _accountWith(address(module), 100e6, _installData(address(0), _defaultRule()));
        _ownerOp(account, OwnerOps.setRule(address(module), _defaultRule()));
        _pay(address(account), 60e6);
        uint256 nvdaSince = block.timestamp;
        module.seedBucket(address(account), NVDA, 11e6, Reason.SESSION);
        vm.warp(block.timestamp + 1 hours);
        uint256 spySince = block.timestamp;
        module.seedBucket(address(account), SPY, 13e6, Reason.STALE);

        vm.recordLogs();
        vm.expectEmit(address(module));
        emit ISleeveModule.Uninstalled(address(account), 24e6);
        _ownerOp(account, OwnerOps.uninstall(address(module), address(account)));
        Vm.Log[] memory logs = vm.getRecordedLogs();

        ISleeveModule.Receipt memory spy =
            _released(address(account), 1, SPY, 13e6, Reason.STALE, spySince, 2, Trigger.OWNER);
        ISleeveModule.Receipt memory nvda =
            _released(address(account), 2, NVDA, 11e6, Reason.SESSION, nvdaSince, 2, Trigger.OWNER);
        _assertReceiptEvent(logs, 0, spy);
        _assertReceiptEvent(logs, 1, nvda);
        assertEq(module.receiptHash(1), keccak256(abi.encode(spy)));
        assertEq(module.receiptHash(2), keccak256(abi.encode(nvda)));
        assertFalse(module.isInitialized(address(account)));
        assertEq(module.bucketOf(address(account), SPY).amount, 0);
        assertEq(module.bucketOf(address(account), NVDA).amount, 0);
        (uint256 balance, uint256 spend, uint256 pendingTotal,) = module.ledger(address(account));
        assertEq(balance, 160e6, "no USDG moved");
        assertEq(spend + pendingTotal, 0, "ledgers deleted");
        assertEq(module.ruleOf(address(account)).version, 0, "rule deleted");
        assertEq(usdg.balanceOf(address(module)), 0, "I1");
    }

    /// A removed ticker and a ticker without a feed still release: the uninstall reads neither token nor feed.
    function test_onUninstall_releasesBucketsOfRemovedAndFeedlessTickers() public {
        MockAccount account = _accountWith(address(module), 0, "");
        _pay(address(account), 50e6);
        for (uint8 t; t < TICKER_COUNT; ++t) {
            module.seedBucket(address(account), t, 10e6 + t, Reason.SESSION);
        }
        tokenSource.removeTicker(QQQ);
        tokens[SPY].setPaused(true);

        vm.recordLogs();
        account.uninstallModule(MODULE_TYPE_EXECUTOR, address(module), "");
        Vm.Log[] memory logs = vm.getRecordedLogs();

        assertTrue(_uninstallSucceeded(logs, address(account)), "onUninstall did not revert");
        assertEq(module.nextReceiptId(), 1 + TICKER_COUNT, "one RELEASED receipt per bucket");
        for (uint8 t; t < TICKER_COUNT; ++t) {
            ISleeveModule.Receipt memory receipt = _decodeReceipt(logs, t);
            assertEq(receipt.tickerId, t, "ascending ticker id");
            assertEq(receipt.usdgToSpend, 10e6 + t);
            assertEq(receipt.token, address(tokens[t]));
        }
        assertFalse(module.isInitialized(address(account)));
    }

    /// Kernel v3.1 installs again over whatever a failed onUninstall left. Leftover buckets are released with
    /// receipts first, so the receipt trail never loses money that left a bucket.
    function test_onInstall_overLeftoverBucketsReleasesThemFirst() public {
        MockAccount account = _accountWith(address(module), 100e6, "");
        _pay(address(account), 30e6);
        module.seedBucket(address(account), QQQ, 30e6, Reason.SESSION);

        vm.recordLogs();
        account.installModule(MODULE_TYPE_EXECUTOR, address(module), "");
        Vm.Log[] memory logs = vm.getRecordedLogs();

        ISleeveModule.Receipt memory receipt = _decodeReceipt(logs, 0);
        assertEq(uint8(receipt.status), uint8(Status.RELEASED));
        assertEq(receipt.tickerId, QQQ);
        assertEq(receipt.usdgToSpend, 30e6);
        (uint256 balance, uint256 spend, uint256 pendingTotal, uint256 unsorted) = module.ledger(address(account));
        assertEq(balance, 130e6);
        assertEq(spend, 130e6, "fresh snapshot");
        assertEq(pendingTotal + unsorted, 0);
    }

    // Helpers

    /// @dev Every field the caller sets, each with a distinct value.
    function _sample() private view returns (ISleeveModule.Receipt memory receipt) {
        receipt.ruleVersion = 3;
        receipt.trigger = Trigger.KEEPER;
        receipt.payer = address(0);
        receipt.status = Status.FILLED;
        receipt.reason = Reason.NONE;
        receipt.tickerId = NVDA;
        receipt.token = address(tokens[NVDA]);
        receipt.tokenUid = keccak256("NVDA uid");
        receipt.usdgIn = 500e6;
        receipt.usdgToSpend = 450e6;
        receipt.usdgToEquity = 50e6;
        receipt.usdgSpent = 50e6;
        receipt.usdgQueued = 0;
        receipt.tokensIn = 0;
        receipt.tokensOut = 268_000_000_000_000_000;
        receipt.usdgOut = 0;
        receipt.uiMultiplier = 1e18;
        receipt.execPrice = 186_567_164;
        receipt.premiumBps = 37;
        receipt.roundId = 154;
        receipt.answer = 18_580_000_000;
        receipt.updatedAt = NOW - 2 hours;
        receipt.usdgRoundId = 119;
        receipt.usdgAnswer = 100_001_038;
        receipt.quote = 5_400_000_000_000_000;
        receipt.minOut = 267_000_000_000_000_000;
        receipt.venueId = 1;
        receipt.pool = POOL;
        receipt.lotId = 0;
        receipt.queuedSince = 0;
        receipt.overrideClosed = false;
        receipt.overrideCapBps = 0;
    }

    function _released(
        address account,
        uint256 id,
        uint8 tickerId,
        uint256 amount,
        Reason reason,
        uint256 since,
        uint32 ruleVersion,
        Trigger trigger
    ) private view returns (ISleeveModule.Receipt memory receipt) {
        receipt.id = id;
        receipt.account = account;
        receipt.ruleVersion = ruleVersion;
        receipt.trigger = trigger;
        receipt.status = Status.RELEASED;
        receipt.reason = reason;
        receipt.mode = AccountingMode.WRAPPED;
        receipt.tickerId = tickerId;
        receipt.token = address(tokens[tickerId]);
        receipt.usdgToSpend = amount;
        receipt.calendarVersion = 0x00010000;
        receipt.disclosureHash = DISCLOSURE_HASH;
        receipt.l2Block = L2_BLOCK;
        receipt.timestamp = block.timestamp;
        receipt.queuedSince = uint64(since);
    }

    /// @dev The index-th ReceiptWritten in `logs` matches `expected` in every topic and in its data.
    function _assertReceiptEvent(Vm.Log[] memory logs, uint256 index, ISleeveModule.Receipt memory expected)
        private
        view
    {
        Vm.Log memory log = _receiptLog(logs, index);
        assertEq(log.topics[1], bytes32(expected.id), "indexed id");
        assertEq(log.topics[2], bytes32(uint256(uint160(expected.account))), "indexed account");
        assertEq(log.topics[3], bytes32(uint256(uint8(expected.status))), "indexed status");
        assertEq(log.data, abi.encode(expected), "receipt fields");
        assertEq(keccak256(log.data), module.receiptHash(expected.id), "stored hash is the hash of the event data");
    }

    function _decodeReceipt(Vm.Log[] memory logs, uint256 index) private view returns (ISleeveModule.Receipt memory) {
        return abi.decode(_receiptLog(logs, index).data, (ISleeveModule.Receipt));
    }

    function _receiptLog(Vm.Log[] memory logs, uint256 index) private view returns (Vm.Log memory) {
        uint256 seen;
        for (uint256 i; i < logs.length; ++i) {
            if (
                logs[i].emitter == address(module) && logs[i].topics.length == 4
                    && logs[i].topics[0] == ISleeveModule.ReceiptWritten.selector
            ) {
                if (seen == index) return logs[i];
                ++seen;
            }
        }
        revert("receipt log not found");
    }

    function _uninstallSucceeded(Vm.Log[] memory logs, address account) private view returns (bool) {
        for (uint256 i; i < logs.length; ++i) {
            if (
                logs[i].emitter != account || logs[i].topics.length == 0
                    || logs[i].topics[0] != MockAccount.ModuleUninstallResult.selector
            ) continue;
            (address uninstalled, bool result) = abi.decode(logs[i].data, (address, bool));
            if (uninstalled == address(module)) return result;
        }
        revert("no ModuleUninstallResult");
    }
}
