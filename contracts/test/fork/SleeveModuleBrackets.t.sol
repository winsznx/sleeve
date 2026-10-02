// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Execution} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {PackedUserOperation} from "kernel/interfaces/PackedUserOperation.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {Reason} from "../../src/types/SleeveTypes.sol";
import {SleeveModuleForkBase} from "../harness/SleeveModuleForkBase.sol";
import {SleeveModuleHarness} from "../harness/SleeveModuleHarness.sol";
import {MockAccount} from "../mocks/MockAccount.sol";
import {UsdgPayer} from "../mocks/UsdgPayer.sol";
import {OwnerOps} from "../utils/OwnerOps.sol";

/// @notice Owner-batch brackets on a forked Kernel v3.1 account at block 78,312,136, every owner op signed by the
/// root key and sent through EntryPoint v0.7 handleOps: bracketed inflows and outflows (I6), the spend, unsorted,
/// buckets order, a module action inside a bracket through the real executeFromExecutor, the bracket errors, a
/// bracket left open across UserOps of one bundle, an uninstall inside a bracket, the builder (I14) and its
/// documented limit, and the caller checks. Buckets are seeded through SleeveModuleHarness.
contract SleeveModuleBracketsForkTest is SleeveModuleForkBase {
    uint256 private constant INSTALLED = 100e6;

    SleeveModuleHarness private module;
    address private account;

    function setUp() public {
        _setUpFork();
        module = _deployHarness();
        account = _installedAccount(address(module), bytes32(0), INSTALLED, "");
    }

    // I6

    function test_I6_fork_bracketedInflowCreditsSpendExactly() public {
        _pay(account, 20e6);
        UsdgPayer wallet = _payerHolding(7_250_000);

        OpResult memory result = _ownerOp(account, _bracketed(_one(address(wallet), _payCaller(7_250_000))));

        assertTrue(result.success, "bracketed inflow");
        assertEq(USDG.balanceOf(address(wallet)), 0, "wallet paid");
        _assertLedger(127_250_000, 107_250_000, 0, 20e6);
        _assertEnded(result, abi.encode(120e6, int256(0), int256(7_250_000), 0, 0, new uint256[](0)));
        _assertHoldsNothing(address(module));
    }

    function test_I6_fork_bracketedOutflowComesOffSpendFirst() public {
        _pay(account, 20e6);
        uint256 recipientBefore = USDG.balanceOf(recipient);

        OpResult memory result = _ownerOp(account, OwnerOps.transferUsdg(address(module), USDG, recipient, 10e6));

        assertTrue(result.success, "bracketed outflow");
        assertEq(USDG.balanceOf(recipient) - recipientBefore, 10e6);
        _assertLedger(110e6, 90e6, 0, 20e6);
        _assertEnded(result, abi.encode(120e6, int256(0), -int256(10e6), 10e6, 0, new uint256[](0)));
    }

    function test_I6_fork_outflowTakesSpendThenUnsortedThenBucketsInAscendingTickerId() public {
        _pay(account, 50e6);
        module.seedBucket(account, AAPL, 10e6, Reason.SESSION);
        module.seedBucket(account, SPY, 15e6, Reason.STALE);
        module.seedBucket(account, QQQ, 5e6, Reason.PREMIUM);
        _assertLedger(150e6, 100e6, 30e6, 20e6);

        OpResult memory result = _ownerOp(account, OwnerOps.transferUsdg(address(module), USDG, recipient, 138e6));

        assertTrue(result.success);
        _assertLedger(12e6, 0, 12e6, 0);
        assertEq(module.bucketOf(account, SPY).amount, 0, "SPY first");
        assertEq(module.bucketOf(account, QQQ).amount, 2e6, "QQQ next");
        assertEq(module.bucketOf(account, NVDA).amount, 0, "NVDA was empty");
        assertEq(module.bucketOf(account, AAPL).amount, 10e6, "AAPL untouched");
        uint256[] memory fromBuckets = new uint256[](4);
        (fromBuckets[SPY], fromBuckets[QQQ]) = (15e6, 3e6);
        _assertEnded(result, abi.encode(150e6, int256(0), -int256(138e6), 100e6, 20e6, fromBuckets));
    }

    /// The harness pays out of a bucket through the deployed Kernel's executeFromExecutor inside the owner's bracket,
    /// as a settle will. That USDG is the module's delta, not the owner's.
    function test_I6_fork_aModuleActionInsideTheBracketIsNotOwnerMoney() public {
        _pay(account, 35e6);
        module.seedBucket(account, SPY, 15e6, Reason.SESSION);
        Execution[] memory calls = new Execution[](2);
        calls[0] = Execution(
            address(module), 0, abi.encodeCall(SleeveModuleHarness.payFromBucket, (account, SPY, recipient, 10e6))
        );
        calls[1] = Execution(address(USDG), 0, abi.encodeCall(IERC20.transfer, (recipient, 5e6)));

        OpResult memory result = _ownerOp(account, OwnerOps.callData(address(module), calls));

        assertTrue(result.success);
        _assertLedger(120e6, 95e6, 5e6, 20e6);
        _assertEnded(result, abi.encode(135e6, -int256(10e6), -int256(5e6), 5e6, 0, new uint256[](0)));
        _assertHoldsNothing(address(module));
    }

    function test_I6_fork_aNestedBeginReverts() public {
        Execution[] memory calls = new Execution[](3);
        calls[0] = Execution(address(module), 0, abi.encodeCall(ISleeveModule.beginOwnerOp, ()));
        calls[1] = Execution(address(module), 0, abi.encodeCall(ISleeveModule.beginOwnerOp, ()));
        calls[2] = Execution(address(module), 0, abi.encodeCall(ISleeveModule.endOwnerOp, ()));

        OpResult memory result = _ownerOp(account, _unbracketedBatch(calls));

        assertFalse(result.success);
        assertEq(result.revertReason, abi.encodeWithSelector(ISleeveModule.OwnerOpAlreadyOpen.selector, account));
        _assertLedger(INSTALLED, INSTALLED, 0, 0);
    }

    function test_I6_fork_anOrphanEndReverts() public {
        OpResult memory result =
            _ownerOp(account, _unbracketedBatch(_one(address(module), abi.encodeCall(ISleeveModule.endOwnerOp, ()))));

        assertFalse(result.success);
        assertEq(result.revertReason, abi.encodeWithSelector(ISleeveModule.OwnerOpNotOpen.selector, account));
    }

    /// Transient storage lasts for the transaction, so a bracket one UserOp leaves open is still open for the
    /// account's next UserOp in the same bundle, whose beginOwnerOp then fails loudly. The unclosed op's outflow
    /// stays unbooked, the documented limit, and a later split reconciles it.
    function test_I6_fork_aBracketLeftOpenFailsTheNextOpOfTheBundle() public {
        Execution[] memory openOnly = new Execution[](2);
        openOnly[0] = Execution(address(module), 0, abi.encodeCall(ISleeveModule.beginOwnerOp, ()));
        openOnly[1] = Execution(address(USDG), 0, abi.encodeCall(IERC20.transfer, (recipient, 4e6)));
        PackedUserOperation[] memory ops = new PackedUserOperation[](2);
        ops[0] = _userOp(account, _rootNonceKey(0), "", _unbracketedBatch(openOnly));
        ops[0].signature = _signUserOp(ops[0], ownerKey);
        ops[1] = _userOp(account, _rootNonceKey(0), "", OwnerOps.transferUsdg(address(module), USDG, recipient, 1e6));
        ops[1].nonce += 1;
        ops[1].signature = _signUserOp(ops[1], ownerKey);

        OpResult[] memory results = _handleOps(ops);

        assertTrue(results[0].success, "the op that leaves its bracket open");
        assertFalse(results[1].success, "the next op of the bundle");
        assertEq(results[1].revertReason, abi.encodeWithSelector(ISleeveModule.OwnerOpAlreadyOpen.selector, account));
        _assertLedger(96e6, INSTALLED, 0, 0);
    }

    /// An open bracket stays with its account: another account's bracketed op later in the bundle books normally.
    function test_I6_fork_anotherAccountsOpenBracketDoesNotReachThisAccount() public {
        (address otherOwner, uint256 otherKey) = makeAddrAndKey("other owner");
        address other = _createAccount(otherOwner, bytes32(uint256(1)));
        assertTrue(_installThroughOp(other, otherKey, address(module), "").success);
        PackedUserOperation[] memory ops = new PackedUserOperation[](2);
        ops[0] = _rootUserOp(
            other,
            "",
            _unbracketedBatch(_one(address(module), abi.encodeCall(ISleeveModule.beginOwnerOp, ()))),
            otherKey
        );
        ops[1] = _rootUserOp(account, "", OwnerOps.transferUsdg(address(module), USDG, recipient, 2e6), ownerKey);

        OpResult[] memory results = _handleOps(ops);

        assertTrue(results[0].success && results[1].success);
        _assertLedger(98e6, 98e6, 0, 0);
    }

    /// The app brackets the uninstall like any owner op. endOwnerOp clears the bracket of the account that is gone.
    function test_I6_fork_anUninstallInsideTheBracketIsTolerated() public {
        _pay(account, 20e6);

        OpResult memory result = _ownerOp(account, OwnerOps.uninstall(address(module), account));

        assertTrue(result.success, "bracketed uninstall");
        (bool found, bool succeeded) = _uninstallResult(result, account, address(module));
        assertTrue(found && succeeded, "ModuleUninstallResult(module, true)");
        assertFalse(module.isInitialized(account));
        assertFalse(module.ownerOpOpen(account), "bracket cleared");
        assertEq(_logsOf(result, address(module), ISleeveModule.OwnerOpEnded.selector).length, 0, "nothing booked");
        assertEq(USDG.balanceOf(account), 120e6, "no USDG moved");
    }

    // I14

    function test_I14_fork_anOpBuiltByTheBuilderRecordsTheExactDelta() public {
        _pay(account, 25e6);
        UsdgPayer wallet = _payerHolding(41e6);

        assertTrue(_ownerOp(account, OwnerOps.transferUsdg(address(module), USDG, recipient, 33e6)).success);
        _assertLedger(92e6, 67e6, 0, 25e6);

        assertTrue(_ownerOp(account, _bracketed(_one(address(wallet), _payCaller(41e6)))).success);
        _assertLedger(133e6, 108e6, 0, 25e6);
    }

    /// G6 item f with the real module: a batch built without the builder moves USDG and no ledger moves. The outflow
    /// shows as a shortfall for the next split's reconcile; the inflow shows as unsorted income.
    function test_I14_fork_anOpBuiltWithoutTheBuilderIsTheDocumentedLimit() public {
        Execution[] memory calls = new Execution[](2);
        calls[0] = Execution(address(USDG), 0, abi.encodeCall(IERC20.transfer, (recipient, 3e6)));
        calls[1] = Execution(address(USDG), 0, abi.encodeCall(IERC20.transfer, (stranger, 2e6)));
        assertTrue(_ownerOp(account, _unbracketedBatch(calls)).success, "unbracketed outflow");
        _assertLedger(95e6, INSTALLED, 0, 0);

        UsdgPayer wallet = _payerHolding(12e6);
        assertTrue(_ownerOp(account, _unbracketedBatch(_one(address(wallet), _payCaller(12e6)))).success);
        _assertLedger(107e6, INSTALLED, 0, 7e6);
    }

    // Callers

    /// D-015: begin and end reject an EOA, a contract that is not an account, and a Kernel account without the
    /// module, each with NotInstalled.
    function test_fork_bracketCallsRejectCallersWithoutTheModule() public {
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.NotInstalled.selector, stranger));
        vm.prank(stranger);
        module.beginOwnerOp();
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.NotInstalled.selector, stranger));
        vm.prank(stranger);
        module.endOwnerOp();

        MockAccount plain = new MockAccount();
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.NotInstalled.selector, address(plain)));
        plain.execute(OwnerOps.batchMode(), _encodedBatch(_one(address(module), _begin())));

        (address otherOwner, uint256 otherKey) = makeAddrAndKey("other owner");
        address other = _createAccount(otherOwner, bytes32(uint256(2)));
        OpResult memory begun = _sendOp(other, otherKey, _unbracketedBatch(_one(address(module), _begin())));
        assertFalse(begun.success);
        assertEq(begun.revertReason, abi.encodeWithSelector(ISleeveModule.NotInstalled.selector, other));
        _assertLedger(INSTALLED, INSTALLED, 0, 0);
    }

    // Helpers

    function _assertLedger(uint256 balance, uint256 spend, uint256 pendingTotal, uint256 unsorted) private view {
        (uint256 actualBalance, uint256 actualSpend, uint256 actualPending, uint256 actualUnsorted) =
            module.ledger(account);
        assertEq(actualBalance, balance, "balance");
        assertEq(actualSpend, spend, "spend");
        assertEq(actualPending, pendingTotal, "pendingTotal");
        assertEq(actualUnsorted, unsorted, "unsorted");
    }

    /// @dev Exactly one OwnerOpEnded from the module for the account, with these non-indexed fields.
    function _assertEnded(OpResult memory result, bytes memory expectedData) private view {
        Vm.Log[] memory ended = _logsOf(result, address(module), ISleeveModule.OwnerOpEnded.selector);
        assertEq(ended.length, 1, "one OwnerOpEnded");
        assertEq(ended[0].topics[1], bytes32(uint256(uint160(account))), "indexed account");
        assertEq(ended[0].data, expectedData, "OwnerOpEnded fields");
    }

    function _bracketed(Execution[] memory calls) private view returns (bytes memory) {
        return OwnerOps.callData(address(module), calls);
    }

    function _one(address target, bytes memory data) private pure returns (Execution[] memory calls) {
        calls = new Execution[](1);
        calls[0] = Execution(target, 0, data);
    }

    function _payCaller(uint256 amount) private pure returns (bytes memory) {
        return abi.encodeCall(UsdgPayer.payCaller, (amount));
    }

    function _begin() private pure returns (bytes memory) {
        return abi.encodeCall(ISleeveModule.beginOwnerOp, ());
    }

    function _encodedBatch(Execution[] memory calls) private pure returns (bytes memory) {
        return abi.encode(calls);
    }
}
