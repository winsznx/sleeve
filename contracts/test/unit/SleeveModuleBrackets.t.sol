// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    Execution,
    IERC7579Execution,
    IERC7579ModuleConfig,
    MODULE_TYPE_EXECUTOR
} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {ERC7579Utils} from "@openzeppelin/contracts/account/utils/draft-ERC7579Utils.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {Reason} from "../../src/types/SleeveTypes.sol";
import {SleeveModuleHarness} from "../harness/SleeveModuleHarness.sol";
import {SleeveModuleUnitBase} from "../harness/SleeveModuleUnitBase.sol";
import {MockAccount} from "../mocks/MockAccount.sol";
import {UsdgPayer} from "../mocks/UsdgPayer.sol";
import {OwnerOps} from "../utils/OwnerOps.sol";

/// @notice Records what _sortingBalance returns at a point inside an owner batch.
contract SortingBalanceProbe {
    uint256[] public seen;

    function record(SleeveModuleHarness module, address account) external {
        seen.push(module.sortingBalance(account));
    }
}

/// @notice Owner-batch brackets without a fork: what endOwnerOp books for owner inflows and outflows (I6), the
/// spend, unsorted, buckets order, module actions inside a bracket, the bracket errors, uninstall and reinstall inside
/// a bracket, the module-delta hooks, a fuzz against a reference model, and the OwnerOps builder (I14). Buckets are
/// seeded through SleeveModuleHarness, as component 5's queue step will fill them.
contract SleeveModuleBracketsTest is SleeveModuleUnitBase {
    uint256 private constant MAX_STEPS = 8;
    uint256 private constant MAX_INFLOW = 1e15;

    SleeveModuleHarness private module;

    /// @dev Expected state of one account, rebuilt by hand in the fuzz test.
    struct Model {
        uint256 spend;
        uint256[4] buckets;
    }

    /// @dev The batch being built: the account, its balance at that point, and the net owner and module moves so far.
    struct Steps {
        address account;
        uint256 running;
        int256 ownerNet;
        int256 moduleNet;
    }

    /// @dev One fuzz run's account and the figures taken at beginOwnerOp.
    struct Run {
        MockAccount account;
        uint256 balanceAtBegin;
        uint256 unsortedBefore;
        uint256 shortfallBefore;
        int256 ownerNet;
        int256 moduleNet;
    }

    function setUp() public {
        _setUpMocks();
        module = _deployHarness();
    }

    // I6: what an owner batch books

    function test_I6_bracketedInflowCreditsSpendInFull() public {
        MockAccount account = _accountWith(address(module), 100e6, "");
        _pay(address(account), 20e6);

        vm.expectEmit(address(module));
        emit ISleeveModule.OwnerOpEnded(address(account), 120e6, 0, 30e6, 0, 0, new uint256[](0));
        _ownerOp(account, _ownerCalls(_call(address(payer), abi.encodeCall(UsdgPayer.payCaller, (30e6)))));

        _assertLedger(address(account), 150e6, 130e6, 0, 20e6);
    }

    function test_I6_bracketedOutflowComesOffSpendFirst() public {
        MockAccount account = _accountWith(address(module), 100e6, "");
        _pay(address(account), 20e6);

        vm.expectEmit(address(module));
        emit ISleeveModule.OwnerOpEnded(address(account), 120e6, 0, -60e6, 60e6, 0, new uint256[](0));
        _ownerOp(account, OwnerOps.transferUsdg(address(module), IERC20(address(usdg)), sink, 60e6));

        _assertLedger(address(account), 60e6, 40e6, 0, 20e6);
    }

    function test_I6_outflowTakesSpendThenUnsortedThenBucketsInAscendingTickerId() public {
        MockAccount account = _accountWith(address(module), 100e6, "");
        _pay(address(account), 50e6);
        module.seedBucket(address(account), NVDA, 10e6, Reason.SESSION);
        module.seedBucket(address(account), SPY, 15e6, Reason.STALE);
        module.seedBucket(address(account), QQQ, 5e6, Reason.PREMIUM);
        _assertLedger(address(account), 150e6, 100e6, 30e6, 20e6);

        uint256[] memory fromBuckets = new uint256[](TICKER_COUNT);
        (fromBuckets[SPY], fromBuckets[QQQ]) = (15e6, 3e6);
        vm.expectEmit(address(module));
        emit ISleeveModule.OwnerOpEnded(address(account), 150e6, 0, -138e6, 100e6, 20e6, fromBuckets);
        _ownerOp(account, OwnerOps.transferUsdg(address(module), IERC20(address(usdg)), sink, 138e6));

        _assertLedger(address(account), 12e6, 0, 12e6, 0);
        assertEq(module.bucketOf(address(account), SPY).amount, 0, "SPY emptied first");
        assertEq(module.bucketOf(address(account), SPY).since, 0, "an emptied bucket is deleted");
        assertEq(module.bucketOf(address(account), QQQ).amount, 2e6, "QQQ next");
        assertEq(uint8(module.bucketOf(address(account), QQQ).reason), uint8(Reason.PREMIUM), "reason kept");
        assertEq(module.bucketOf(address(account), NVDA).amount, 10e6, "NVDA untouched");
    }

    function test_I6_anOutflowOfTheWholeBalanceEmptiesEveryLedger() public {
        MockAccount account = _accountWith(address(module), 100e6, "");
        _pay(address(account), 50e6);
        module.seedBucket(address(account), QQQ, 30e6, Reason.SESSION);

        _ownerOp(account, OwnerOps.transferUsdg(address(module), IERC20(address(usdg)), sink, 150e6));

        _assertLedger(address(account), 0, 0, 0, 0);
        assertEq(module.bucketOf(address(account), QQQ).amount, 0);
    }

    /// The module's own moves inside the bracket are excluded from the owner's delta, and the ledger changes the
    /// actions made stand: a settle-like payment out of a bucket and sell-like proceeds into spend.
    function test_I6_moduleActionsInsideTheBracketAreNotOwnerMoney() public {
        MockAccount account = _accountWith(address(module), 100e6, "");
        _pay(address(account), 35e6);
        module.seedBucket(address(account), SPY, 15e6, Reason.SESSION);

        Execution[] memory calls = new Execution[](3);
        calls[0] = _call(address(module), abi.encodeCall(module.payFromBucket, (address(account), SPY, sink, 10e6)));
        calls[1] = _call(address(module), abi.encodeCall(module.receiveToSpend, (address(account), payer, 7e6)));
        calls[2] = _call(address(usdg), abi.encodeCall(IERC20.transfer, (sink, 5e6)));
        vm.expectEmit(address(module));
        emit ISleeveModule.OwnerOpEnded(address(account), 135e6, -3e6, -5e6, 5e6, 0, new uint256[](0));
        _ownerOp(account, OwnerOps.callData(address(module), calls));

        _assertLedger(address(account), 127e6, 102e6, 5e6, 20e6);
        assertEq(usdg.balanceOf(address(module)), 0, "I1");
    }

    /// Unsorted comes from the virtual balance. After the module paid a whole bucket out of the account, the real
    /// balance alone would leave nothing for the owner's outflow to come out of.
    function test_I6_ownerOutflowAfterAModuleOutflowUsesTheVirtualBalance() public {
        MockAccount account = _accountWith(address(module), 0, "");
        _pay(address(account), 50e6);
        module.seedBucket(address(account), SPY, 30e6, Reason.SESSION);

        Execution[] memory calls = new Execution[](2);
        calls[0] = _call(address(module), abi.encodeCall(module.payFromBucket, (address(account), SPY, sink, 30e6)));
        calls[1] = _call(address(usdg), abi.encodeCall(IERC20.transfer, (sink, 20e6)));
        vm.expectEmit(address(module));
        emit ISleeveModule.OwnerOpEnded(address(account), 50e6, -30e6, -20e6, 0, 20e6, new uint256[](0));
        _ownerOp(account, OwnerOps.callData(address(module), calls));

        _assertLedger(address(account), 0, 0, 0, 0);
    }

    /// A pull the module did not see before the bracket stays a shortfall for reconcile; the bracket books only the
    /// owner's own outflow.
    function test_I6_aShortfallFromAnUnseenPullSurvivesTheBracket() public {
        MockAccount account = _accountWith(address(module), 100e6, "");
        vm.prank(address(account));
        assertTrue(usdg.transfer(sink, 30e6));
        _assertLedger(address(account), 70e6, 100e6, 0, 0);

        _ownerOp(account, OwnerOps.transferUsdg(address(module), IERC20(address(usdg)), sink, 20e6));

        _assertLedger(address(account), 50e6, 80e6, 0, 0);
    }

    // Bracket errors

    function test_beginOwnerOp_revertsWhenTheBracketIsAlreadyOpen() public {
        MockAccount account = _accountWith(address(module), 10e6, "");
        Execution[] memory calls = new Execution[](3);
        calls[0] = _call(address(module), abi.encodeCall(ISleeveModule.beginOwnerOp, ()));
        calls[1] = _call(address(module), abi.encodeCall(ISleeveModule.beginOwnerOp, ()));
        calls[2] = _call(address(module), abi.encodeCall(ISleeveModule.endOwnerOp, ()));
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.OwnerOpAlreadyOpen.selector, address(account)));
        _ownerOp(account, _unbracketed(calls));
    }

    function test_endOwnerOp_revertsWithoutAnOpenBracket() public {
        MockAccount account = _accountWith(address(module), 10e6, "");
        Execution[] memory calls = new Execution[](1);
        calls[0] = _call(address(module), abi.encodeCall(ISleeveModule.endOwnerOp, ()));
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.OwnerOpNotOpen.selector, address(account)));
        _ownerOp(account, _unbracketed(calls));
    }

    function test_bracketCalls_revertNotInstalledForCallersWithoutTheModule() public {
        address eoa = makeAddr("eoa");
        bytes memory notInstalled = abi.encodeWithSelector(ISleeveModule.NotInstalled.selector, eoa);
        vm.expectRevert(notInstalled);
        vm.prank(eoa);
        module.beginOwnerOp();
        vm.expectRevert(notInstalled);
        vm.prank(eoa);
        module.endOwnerOp();

        MockAccount bare = new MockAccount();
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.NotInstalled.selector, address(bare)));
        _ownerOp(bare, OwnerOps.transferUsdg(address(module), IERC20(address(usdg)), sink, 0));
    }

    /// The uninstall is an owner op like any other, so the app brackets it; endOwnerOp then clears the bracket of an
    /// account that is gone and books nothing.
    function test_endOwnerOp_closesWithoutBookingAfterAnUninstallInsideTheBracket() public {
        MockAccount account = _accountWith(address(module), 100e6, "");
        Execution[] memory calls = new Execution[](2);
        calls[0] = _call(address(usdg), abi.encodeCall(IERC20.transfer, (sink, 10e6)));
        calls[1] = _call(
            address(account),
            abi.encodeCall(IERC7579ModuleConfig.uninstallModule, (MODULE_TYPE_EXECUTOR, address(module), ""))
        );

        vm.recordLogs();
        _ownerOp(account, OwnerOps.callData(address(module), calls));

        assertFalse(module.isInitialized(address(account)));
        assertFalse(module.ownerOpOpen(address(account)), "bracket cleared");
        assertEq(_count(vm.getRecordedLogs(), ISleeveModule.OwnerOpEnded.selector), 0, "nothing booked");
        _assertLedger(address(account), 90e6, 0, 0, 0);
    }

    /// Uninstall then install inside one bracket: the install snapshot already holds the earlier outflow, so the
    /// bracket restarts from it and books only what moves after the install.
    function test_onInstall_insideAnOpenBracketRestartsItFromTheSnapshot() public {
        MockAccount account = _accountWith(address(module), 100e6, "");
        _pay(address(account), 20e6);
        Execution[] memory calls = new Execution[](4);
        calls[0] = _call(address(usdg), abi.encodeCall(IERC20.transfer, (sink, 10e6)));
        calls[1] = _call(
            address(account),
            abi.encodeCall(IERC7579ModuleConfig.uninstallModule, (MODULE_TYPE_EXECUTOR, address(module), ""))
        );
        calls[2] = _call(
            address(account),
            abi.encodeCall(IERC7579ModuleConfig.installModule, (MODULE_TYPE_EXECUTOR, address(module), ""))
        );
        calls[3] = _call(address(usdg), abi.encodeCall(IERC20.transfer, (sink, 4e6)));

        _ownerOp(account, OwnerOps.callData(address(module), calls));

        _assertLedger(address(account), 106e6, 106e6, 0, 0);
    }

    // Hooks

    function test_recordModuleDelta_doesNothingWithoutAnOpenBracket() public {
        MockAccount account = _accountWith(address(module), 100e6, "");
        module.recordModuleDelta(address(account), -40e6);
        assertFalse(module.ownerOpOpen(address(account)));

        _ownerOp(account, OwnerOps.transferUsdg(address(module), IERC20(address(usdg)), sink, 10e6));

        _assertLedger(address(account), 90e6, 90e6, 0, 0);
    }

    function test_sortingBalance_isTheVirtualBalanceInsideABracketAndTheBalanceOutside() public {
        MockAccount account = _accountWith(address(module), 100e6, "");
        _pay(address(account), 20e6);
        module.seedBucket(address(account), SPY, 10e6, Reason.SESSION);
        SortingBalanceProbe probe = new SortingBalanceProbe();
        Execution memory look =
            _call(address(probe), abi.encodeCall(SortingBalanceProbe.record, (module, address(account))));

        Execution[] memory calls = new Execution[](6);
        calls[0] = _call(address(usdg), abi.encodeCall(IERC20.transfer, (sink, 50e6)));
        calls[1] = look;
        calls[2] = _call(address(module), abi.encodeCall(module.payFromBucket, (address(account), SPY, sink, 10e6)));
        calls[3] = look;
        calls[4] = _call(address(module), abi.encodeCall(module.receiveToSpend, (address(account), payer, 4e6)));
        calls[5] = look;
        _ownerOp(account, OwnerOps.callData(address(module), calls));

        assertEq(probe.seen(0), 120e6, "owner outflow excluded");
        assertEq(probe.seen(1), 110e6, "module outflow included");
        assertEq(probe.seen(2), 114e6, "module inflow included");
        assertEq(module.sortingBalance(address(account)), usdg.balanceOf(address(account)), "outside a bracket");
    }

    function test_sortingBalance_isZeroWhenTheVirtualBalanceIsNegative() public {
        MockAccount account = _accountWith(address(module), 0, "");
        module.seedBucket(address(account), SPY, 30e6, Reason.SESSION);
        SortingBalanceProbe probe = new SortingBalanceProbe();

        Execution[] memory calls = new Execution[](3);
        calls[0] = _call(address(payer), abi.encodeCall(UsdgPayer.payCaller, (50e6)));
        calls[1] = _call(address(module), abi.encodeCall(module.payFromBucket, (address(account), SPY, sink, 30e6)));
        calls[2] = _call(address(probe), abi.encodeCall(SortingBalanceProbe.record, (module, address(account))));
        _ownerOp(account, OwnerOps.callData(address(module), calls));

        assertEq(probe.seen(0), 0);
        _assertLedger(address(account), 20e6, 50e6, 0, 0);
    }

    // I6 against a reference model

    /// Mixed owner inflows and outflows and module actions in one bracket, after an install, an income, buckets seeded
    /// from it and an optional pull the module did not see. A hand-written model books the batch; the module must
    /// agree on spend, every bucket and the event, unsorted must end at its value before the bracket less what the
    /// owner's outflow took from it, the shortfall must not move, and the module must hold nothing.
    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_I6_bracketMatchesAReferenceModel(
        uint96 installed,
        uint96 income,
        uint96[3] calldata seeds,
        uint96 pull,
        uint256[8] calldata steps,
        uint8 stepCount
    ) public {
        Model memory model;
        Run memory run;
        run.account = _startRun(installed, income, seeds, pull, model);
        run.balanceAtBegin = usdg.balanceOf(address(run.account));
        run.unsortedBefore = _unsorted(run.balanceAtBegin, model);
        run.shortfallBefore = _shortfall(run.balanceAtBegin, model);
        Execution[] memory calls;
        (calls, run.ownerNet, run.moduleNet) =
            _buildSteps(address(run.account), steps, _bound(stepCount, 0, MAX_STEPS), run.balanceAtBegin, model);

        vm.recordLogs();
        _ownerOp(run.account, OwnerOps.callData(address(module), calls));

        _checkRun(run, model, vm.getRecordedLogs());
    }

    // I14: the builder

    function test_I14_builderPutsBeginFirstAndEndLastAroundTheOwnersCalls() public view {
        Execution[] memory calls = new Execution[](3);
        calls[0] = _call(address(usdg), abi.encodeCall(IERC20.transfer, (sink, 1)));
        calls[1] = _call(address(module), abi.encodeCall(ISleeveModule.setKeeper, (sink)));
        calls[2] = _call(address(payer), abi.encodeCall(UsdgPayer.payCaller, (2)));

        (bytes4 selector, bytes32 mode, Execution[] memory built) =
            this.decodeOp(OwnerOps.callData(address(module), calls));

        assertEq(selector, IERC7579Execution.execute.selector, "account execute");
        assertEq(mode, OwnerOps.batchMode(), "batch call type, default exec type");
        _assertBracketed(built, calls);
    }

    function test_I14_builderBracketsAnEmptyCallList() public view {
        (,, Execution[] memory built) = this.decodeOp(OwnerOps.callData(address(module), new Execution[](0)));
        _assertBracketed(built, new Execution[](0));
    }

    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_I14_builderBracketsAnyCallList(uint8 count, uint256 seed) public view {
        Execution[] memory calls = new Execution[](_bound(count, 0, 16));
        for (uint256 i; i < calls.length; ++i) {
            uint256 draw = uint256(keccak256(abi.encode(seed, i)));
            address target = draw % 3 == 0 ? address(module) : address(uint160(draw >> 96));
            bytes4 selector = draw % 3 == 0 ? ISleeveModule.setRule.selector : bytes4(uint32(draw));
            calls[i] = Execution(target, draw % 5, abi.encodePacked(selector, keccak256(abi.encode(draw))));
        }
        (bytes4 opSelector, bytes32 mode, Execution[] memory built) =
            this.decodeOp(OwnerOps.callData(address(module), calls));
        assertEq(opSelector, IERC7579Execution.execute.selector);
        assertEq(mode, OwnerOps.batchMode());
        _assertBracketed(built, calls);
    }

    function test_I14_builderRefusesACallListThatAlreadyHoldsABracketCall() public {
        Execution[] memory calls = new Execution[](2);
        calls[0] = _call(address(usdg), abi.encodeCall(IERC20.transfer, (sink, 1)));
        calls[1] = _call(address(module), abi.encodeCall(ISleeveModule.endOwnerOp, ()));
        vm.expectRevert(abi.encodeWithSelector(OwnerOps.NestedBracketCall.selector, 1));
        this.build(address(module), calls);

        calls[0] = _call(address(module), abi.encodeCall(ISleeveModule.beginOwnerOp, ()));
        vm.expectRevert(abi.encodeWithSelector(OwnerOps.NestedBracketCall.selector, 0));
        this.build(address(module), calls);
    }

    function test_I14_anOpBuiltByTheBuilderRecordsTheExactDelta() public {
        MockAccount account = _accountWith(address(module), 100e6, "");
        _pay(address(account), 25e6);

        _ownerOp(account, OwnerOps.transferUsdg(address(module), IERC20(address(usdg)), sink, 33e6));
        _assertLedger(address(account), 92e6, 67e6, 0, 25e6);

        _ownerOp(account, _ownerCalls(_call(address(payer), abi.encodeCall(UsdgPayer.payCaller, (41e6)))));
        _assertLedger(address(account), 133e6, 108e6, 0, 25e6);
    }

    /// The documented limit (PRD 7.2, G6 item f): without brackets the ledgers do not move. The outflow shows as a
    /// shortfall for the next split's reconcile, and the inflow as unsorted income that would be split.
    function test_I14_anOpBuiltWithoutTheBuilderIsTheDocumentedLimit() public {
        MockAccount account = _accountWith(address(module), 100e6, "");
        Execution[] memory calls = new Execution[](2);
        calls[0] = _call(address(usdg), abi.encodeCall(IERC20.transfer, (sink, 3e6)));
        calls[1] = _call(address(usdg), abi.encodeCall(IERC20.transfer, (sink, 2e6)));
        _ownerOp(account, _unbracketed(calls));
        _assertLedger(address(account), 95e6, 100e6, 0, 0);

        calls = new Execution[](1);
        calls[0] = _call(address(payer), abi.encodeCall(UsdgPayer.payCaller, (12e6)));
        _ownerOp(account, _unbracketed(calls));
        _assertLedger(address(account), 107e6, 100e6, 0, 7e6);
    }

    // External helpers, so tests can decode calldata slices and expect the builder's reverts

    function decodeOp(bytes calldata callData)
        external
        pure
        returns (bytes4 selector, bytes32 mode, Execution[] memory calls)
    {
        selector = bytes4(callData[:4]);
        bytes memory executionCalldata;
        (mode, executionCalldata) = abi.decode(callData[4:], (bytes32, bytes));
        calls = abi.decode(executionCalldata, (Execution[]));
    }

    function build(address target, Execution[] memory calls) external pure returns (bytes memory) {
        return OwnerOps.callData(target, calls);
    }

    // Reference model

    /// @dev Installs on an account holding `installed`, pays it `income`, seeds the first three buckets from that
    /// income, then lets an outside pull take part of the balance unseen.
    function _startRun(uint96 installed, uint96 income, uint96[3] calldata seeds, uint96 pull, Model memory model)
        private
        returns (MockAccount account)
    {
        account = _accountWith(address(module), installed, "");
        usdg.mint(address(account), income);
        model.spend = installed;
        uint256 incomeLeft = income;
        for (uint8 t; t < 3; ++t) {
            uint256 seeded = _bound(seeds[t], 0, incomeLeft);
            if (seeded != 0) module.seedBucket(address(account), t, uint128(seeded), Reason.SESSION);
            model.buckets[t] = seeded;
            incomeLeft -= seeded;
        }
        uint256 pulled = _bound(pull, 0, usdg.balanceOf(address(account)));
        vm.prank(address(account));
        assertTrue(usdg.transfer(sink, pulled));
    }

    function _checkRun(Run memory run, Model memory model, Vm.Log[] memory logs) private view {
        (uint256 fromSpend, uint256 fromUnsorted, uint256[] memory fromBuckets) =
            _bookReference(model, run.ownerNet, run.balanceAtBegin, run.moduleNet);
        _assertMatchesModel(address(run.account), model);
        _assertEndEvent(
            logs, abi.encode(run.balanceAtBegin, run.moduleNet, run.ownerNet, fromSpend, fromUnsorted, fromBuckets)
        );
        (uint256 balance,, uint256 pendingTotal, uint256 unsortedAfter) = module.ledger(address(run.account));
        assertEq(unsortedAfter, run.unsortedBefore - fromUnsorted, "I6: no bracketed USDG became unsorted");
        assertEq(_shortfall(balance, model), run.shortfallBefore, "shortfall unchanged");
        assertEq(pendingTotal, _sum(model.buckets), "pendingTotal is the sum of the buckets");
        assertEq(usdg.balanceOf(address(module)), 0, "I1");
    }

    /// @dev Turns fuzzed steps into the batch's calls, keeping every amount payable at its point in the batch, and
    /// applies the module actions' own ledger changes to the model as they happen.
    function _buildSteps(
        address account,
        uint256[8] calldata steps,
        uint256 count,
        uint256 balanceAtBegin,
        Model memory model
    ) private view returns (Execution[] memory calls, int256 ownerNet, int256 moduleNet) {
        calls = new Execution[](count);
        Steps memory built = Steps({account: account, running: balanceAtBegin, ownerNet: 0, moduleNet: 0});
        for (uint256 i; i < count; ++i) {
            calls[i] = _step(built, steps[i], model);
        }
        return (calls, built.ownerNet, built.moduleNet);
    }

    /// @dev Step kinds: 0 owner inflow, 1 owner outflow, 2 module payment out of a bucket, 3 module proceeds to spend.
    function _step(Steps memory built, uint256 step, Model memory model) private view returns (Execution memory) {
        uint256 kind = step % 4;
        uint256 raw = step >> 8;
        if (kind == 0) {
            uint256 amount = _bound(raw, 0, MAX_INFLOW);
            built.running += amount;
            built.ownerNet += int256(amount);
            return _call(address(payer), abi.encodeCall(UsdgPayer.payCaller, (amount)));
        }
        if (kind == 1) {
            uint256 amount = _bound(raw, 0, built.running);
            built.running -= amount;
            built.ownerNet -= int256(amount);
            return _call(address(usdg), abi.encodeCall(IERC20.transfer, (sink, amount)));
        }
        if (kind == 2) {
            uint8 t = uint8((step >> 2) % 3);
            uint128 amount = uint128(_bound(raw, 0, Math.min(model.buckets[t], built.running)));
            model.buckets[t] -= amount;
            built.running -= amount;
            built.moduleNet -= int256(uint256(amount));
            return _call(address(module), abi.encodeCall(module.payFromBucket, (built.account, t, sink, amount)));
        }
        uint128 proceeds = uint128(_bound(raw, 0, MAX_INFLOW));
        model.spend += proceeds;
        built.running += proceeds;
        built.moduleNet += int256(uint256(proceeds));
        return _call(address(module), abi.encodeCall(module.receiveToSpend, (built.account, payer, proceeds)));
    }

    /// @dev PRD 7.2 as written: an owner inflow is spend; an owner outflow comes off spend, then unsorted at the
    /// balance the account would have without the owner's moves, then the buckets in ticker order.
    function _bookReference(Model memory model, int256 ownerNet, uint256 balanceAtBegin, int256 moduleNet)
        private
        pure
        returns (uint256 fromSpend, uint256 fromUnsorted, uint256[] memory fromBuckets)
    {
        if (ownerNet >= 0) {
            model.spend += uint256(ownerNet);
            return (0, 0, new uint256[](0));
        }
        uint256 outflow = uint256(-ownerNet);
        int256 signedVirtual = int256(balanceAtBegin) + moduleNet;
        uint256 virtualBalance = signedVirtual > 0 ? uint256(signedVirtual) : 0;
        uint256 available = _unsorted(virtualBalance, model);
        fromSpend = Math.min(outflow, model.spend);
        model.spend -= fromSpend;
        outflow -= fromSpend;
        fromUnsorted = Math.min(outflow, available);
        outflow -= fromUnsorted;
        if (outflow == 0) return (fromSpend, fromUnsorted, new uint256[](0));
        fromBuckets = new uint256[](TICKER_COUNT);
        for (uint256 t; t < TICKER_COUNT; ++t) {
            fromBuckets[t] = Math.min(outflow, model.buckets[t]);
            model.buckets[t] -= fromBuckets[t];
            outflow -= fromBuckets[t];
        }
        assertEq(outflow, 0, "model: outflow larger than the ledgers");
    }

    function _assertMatchesModel(address account, Model memory model) private view {
        (, uint256 spend,,) = module.ledger(account);
        assertEq(spend, model.spend, "spend");
        for (uint8 t; t < TICKER_COUNT; ++t) {
            assertEq(module.bucketOf(account, t).amount, model.buckets[t], "bucket");
        }
    }

    function _assertEndEvent(Vm.Log[] memory logs, bytes memory expectedData) private view {
        uint256 seen;
        for (uint256 i; i < logs.length; ++i) {
            if (
                logs[i].emitter != address(module) || logs[i].topics.length == 0
                    || logs[i].topics[0] != ISleeveModule.OwnerOpEnded.selector
            ) continue;
            assertEq(logs[i].data, expectedData, "OwnerOpEnded fields");
            ++seen;
        }
        assertEq(seen, 1, "one OwnerOpEnded per bracket");
    }

    function _unsorted(uint256 balance, Model memory model) private pure returns (uint256) {
        uint256 ledgers = model.spend + _sum(model.buckets);
        return balance > ledgers ? balance - ledgers : 0;
    }

    function _shortfall(uint256 balance, Model memory model) private pure returns (uint256) {
        uint256 ledgers = model.spend + _sum(model.buckets);
        return ledgers > balance ? ledgers - balance : 0;
    }

    function _sum(uint256[4] memory amounts) private pure returns (uint256 total) {
        for (uint256 i; i < amounts.length; ++i) {
            total += amounts[i];
        }
    }

    // Helpers

    function _assertBracketed(Execution[] memory built, Execution[] memory calls) private view {
        assertEq(built.length, calls.length + 2, "two calls added");
        assertEq(built[0].target, address(module), "first call targets the module");
        assertEq(built[0].value, 0);
        assertEq(built[0].callData, abi.encodeCall(ISleeveModule.beginOwnerOp, ()), "first call is beginOwnerOp");
        Execution memory last = built[built.length - 1];
        assertEq(last.target, address(module), "last call targets the module");
        assertEq(last.value, 0);
        assertEq(last.callData, abi.encodeCall(ISleeveModule.endOwnerOp, ()), "last call is endOwnerOp");
        for (uint256 i; i < calls.length; ++i) {
            assertEq(built[i + 1].target, calls[i].target, "owner call target");
            assertEq(built[i + 1].value, calls[i].value, "owner call value");
            assertEq(built[i + 1].callData, calls[i].callData, "owner call data");
        }
    }

    function _call(address target, bytes memory data) private pure returns (Execution memory) {
        return Execution(target, 0, data);
    }

    function _ownerCalls(Execution memory only) private view returns (bytes memory) {
        Execution[] memory calls = new Execution[](1);
        calls[0] = only;
        return OwnerOps.callData(address(module), calls);
    }

    /// @dev A batch built without OwnerOps.
    function _unbracketed(Execution[] memory calls) private pure returns (bytes memory) {
        return abi.encodeCall(IERC7579Execution.execute, (OwnerOps.batchMode(), ERC7579Utils.encodeBatch(calls)));
    }

    function _count(Vm.Log[] memory logs, bytes32 topic0) private view returns (uint256 count) {
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(module) && logs[i].topics.length != 0 && logs[i].topics[0] == topic0) {
                ++count;
            }
        }
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
