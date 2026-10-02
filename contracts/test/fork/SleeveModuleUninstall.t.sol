// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {console} from "forge-std/console.sol";
import {MODULE_TYPE_EXECUTOR} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {Kernel} from "kernel/Kernel.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {AccountingMode, Reason, Status, Trigger} from "../../src/types/SleeveTypes.sol";
import {SleeveModuleForkBase} from "../harness/SleeveModuleForkBase.sol";
import {SleeveModuleHarness} from "../harness/SleeveModuleHarness.sol";
import {Chain4663} from "../utils/Chain4663.sol";
import {OwnerOps} from "../utils/OwnerOps.sol";

/// @notice The uninstall release and receipts on a forked Kernel v3.1 account at block 78,312,136: every non-empty
/// bucket goes to spend with a RELEASED receipt before the account's state is deleted (PRD 7.1, I11), with or without
/// a bracket; receipt ids are global and sequential and each stored hash equals keccak256 of an encoding built here;
/// a reinstall takes a fresh snapshot; and the release fits the uninstall UserOp's call gas with every bucket full.
contract SleeveModuleUninstallForkTest is SleeveModuleForkBase {
    uint256 private constant INSTALLED = 100e6;
    uint256 private constant INCOME = 80e6;
    uint32 private constant CALENDAR_VERSION_1 = 0x00010000;

    SleeveModuleHarness private module;
    address private account;
    uint256 private queuedAt;

    function setUp() public {
        _setUpFork();
        module = _deployHarness();
        account = _installedAccount(address(module), bytes32(0), INSTALLED, _installData(address(0), _defaultRule()));
        _pay(account, INCOME);
        queuedAt = block.timestamp;
        module.seedBucket(account, SPY, 10e6, Reason.SESSION);
        module.seedBucket(account, NVDA, 20e6, Reason.STALE);
        module.seedBucket(account, AAPL, 30e6, Reason.PREMIUM);
        vm.warp(block.timestamp + 2 hours);
    }

    function test_fork_bracketedUninstallReleasesEveryBucketWithReleasedReceipts() public {
        OpResult memory result = _ownerOp(account, OwnerOps.uninstall(address(module), account));

        assertTrue(result.success, "bracketed uninstall");
        _assertReleasedThenDeleted(result, 1);
    }

    /// Any ERC-4337 client can send the uninstall without brackets, and the release still happens (I11).
    function test_fork_unbracketedUninstallAlsoReleasesEveryBucket() public {
        OpResult memory result = _uninstallThroughOp(account, ownerKey, address(module));

        assertTrue(result.success, "plain uninstall");
        _assertReleasedThenDeleted(result, 1);
    }

    function test_fork_receiptIdsContinueAcrossAccounts() public {
        (address otherOwner, uint256 otherKey) = makeAddrAndKey("other owner");
        address other = _createAccount(otherOwner, bytes32(uint256(1)));
        _pay(other, 40e6);
        assertTrue(_installThroughOp(other, otherKey, address(module), "").success);
        _pay(other, 9e6);
        module.seedBucket(other, QQQ, 9e6, Reason.CLIP);

        OpResult memory first = _sendOp(other, otherKey, OwnerOps.uninstall(address(module), other));
        OpResult memory second = _ownerOp(account, OwnerOps.uninstall(address(module), account));

        assertTrue(first.success && second.success);
        ISleeveModule.Receipt memory otherReceipt = _receiptsIn(first)[0];
        assertEq(otherReceipt.id, 1);
        assertEq(otherReceipt.account, other);
        assertEq(otherReceipt.ruleVersion, 0, "no rule");
        _assertReleasedThenDeleted(second, 2);
        assertEq(module.nextReceiptId(), 5);
    }

    function test_fork_reinstallAfterTheReleaseTakesAFreshSnapshot() public {
        assertTrue(_ownerOp(account, OwnerOps.uninstall(address(module), account)).success);

        assertTrue(_installThroughOp(account, ownerKey, address(module), "").success, "reinstall");

        (uint256 balance, uint256 spend, uint256 pendingTotal, uint256 unsorted) = module.ledger(account);
        assertEq(balance, INSTALLED + INCOME);
        assertEq(spend, balance, "fresh snapshot");
        assertEq(pendingTotal + unsorted, 0);
        assertEq(module.bucketOf(account, AAPL).amount, 0);
        assertEq(module.receiptHash(3) != bytes32(0), true, "receipts stay");
    }

    /// Every launch ticker's bucket full, uninstall through a UserOp with the test call gas limit: the release fits
    /// and Kernel reports success. The gas figure is for the app's callGasLimit (g6-notes section 7).
    function test_fork_uninstallWithEveryBucketFullFitsTheCallGas() public {
        module.seedBucket(account, QQQ, 15e6, Reason.MULTIPLIER);

        OpResult memory result = _ownerOp(account, OwnerOps.uninstall(address(module), account));

        assertTrue(result.success);
        (bool found, bool succeeded) = _uninstallResult(result, account, address(module));
        assertTrue(found && succeeded, "ModuleUninstallResult(module, true)");
        assertEq(_receiptsIn(result).length, 4);
        console.log("uninstall UserOp with four RELEASED receipts, actualGasUsed", result.actualGasUsed);
    }

    // Helpers

    /// @dev The uninstall wrote RELEASED receipts for SPY, NVDA and AAPL in that order from `firstId`, each equal
    /// field by field to a receipt built here and stored under keccak256 of its encoding, then deleted the state.
    function _assertReleasedThenDeleted(OpResult memory result, uint256 firstId) private view {
        (bool found, bool succeeded) = _uninstallResult(result, account, address(module));
        assertTrue(found && succeeded, "ModuleUninstallResult(module, true)");
        ISleeveModule.Receipt[] memory receipts = _receiptsIn(result);
        assertEq(receipts.length, 3, "one receipt per non-empty bucket");
        _assertReceipt(receipts[0], _released(firstId, SPY, Chain4663.SPY, 10e6, Reason.SESSION));
        _assertReceipt(receipts[1], _released(firstId + 1, NVDA, Chain4663.NVDA, 20e6, Reason.STALE));
        _assertReceipt(receipts[2], _released(firstId + 2, AAPL, Chain4663.AAPL, 30e6, Reason.PREMIUM));
        Vm.Log[] memory uninstalled = _logsOf(result, address(module), ISleeveModule.Uninstalled.selector);
        assertEq(uninstalled.length, 1);
        assertEq(uninstalled[0].data, abi.encode(uint256(60e6)), "released total");
        assertFalse(module.isInitialized(account));
        assertFalse(Kernel(payable(account)).isModuleInstalled(MODULE_TYPE_EXECUTOR, address(module), ""));
        (uint256 balance, uint256 spend, uint256 pendingTotal,) = module.ledger(account);
        assertEq(balance, INSTALLED + INCOME, "no USDG moved");
        assertEq(spend + pendingTotal, 0, "ledgers deleted");
        assertEq(module.keeperOf(account), address(0), "keeper deleted");
        assertEq(module.ruleOf(account).version, 0, "rule deleted");
        assertEq(module.bucketOf(account, NVDA).amount, 0, "buckets deleted");
        _assertHoldsNothing(address(module));
    }

    function _released(uint256 id, uint8 tickerId, address token, uint256 amount, Reason reason)
        private
        view
        returns (ISleeveModule.Receipt memory receipt)
    {
        receipt.id = id;
        receipt.account = account;
        receipt.ruleVersion = 1;
        receipt.trigger = Trigger.OWNER;
        receipt.status = Status.RELEASED;
        receipt.reason = reason;
        receipt.mode = AccountingMode.WRAPPED;
        receipt.tickerId = tickerId;
        receipt.token = token;
        receipt.usdgToSpend = amount;
        receipt.calendarVersion = CALENDAR_VERSION_1;
        receipt.disclosureHash = DISCLOSURE_HASH;
        receipt.l2Block = block.number;
        receipt.timestamp = block.timestamp;
        receipt.queuedSince = uint64(queuedAt);
    }

    function _assertReceipt(ISleeveModule.Receipt memory actual, ISleeveModule.Receipt memory expected) private view {
        assertEq(abi.encode(actual), abi.encode(expected), "receipt fields");
        assertEq(module.receiptHash(expected.id), keccak256(abi.encode(expected)), "stored hash");
    }

    /// @dev Every ReceiptWritten in the op's logs, in order, checked against its indexed topics.
    function _receiptsIn(OpResult memory result) private view returns (ISleeveModule.Receipt[] memory receipts) {
        Vm.Log[] memory logs = _logsOf(result, address(module), ISleeveModule.ReceiptWritten.selector);
        receipts = new ISleeveModule.Receipt[](logs.length);
        for (uint256 i; i < logs.length; ++i) {
            receipts[i] = abi.decode(logs[i].data, (ISleeveModule.Receipt));
            assertEq(logs[i].topics[1], bytes32(receipts[i].id), "indexed id");
            assertEq(logs[i].topics[2], bytes32(uint256(uint160(receipts[i].account))), "indexed account");
            assertEq(logs[i].topics[3], bytes32(uint256(uint8(receipts[i].status))), "indexed status");
        }
    }
}
