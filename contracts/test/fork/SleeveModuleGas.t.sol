// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/console.sol";
import {Vm} from "forge-std/Vm.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {Reason, Status} from "../../src/types/SleeveTypes.sol";
import {SleeveModuleForkTradeBase} from "../harness/SleeveModuleForkTradeBase.sol";
import {LaunchConfig} from "../mocks/LaunchConfig.sol";
import {OwnerOps} from "../utils/OwnerOps.sol";

/// @notice Gas of observe, split, settle and release on chain 4663 with real pools and the deployed Kernel, for
/// docs/GAS.md. Run with --isolate so each call is its own transaction with cold storage, as on chain:
///
///   FOUNDRY_OUT=out-c5 FOUNDRY_CACHE_PATH=cache-c5 forge test --match-path test/fork/SleeveModuleGas.t.sol \
///     --isolate -vv
///
/// Each test logs the measured call's execution gas from vm.lastCallGas(); a keeper's transaction adds the 21,000
/// intrinsic gas and its calldata. Owner calls also log the UserOp's actualGasUsed. Without --isolate the numbers come
/// out low, because the test's setup has already warmed the storage the call reads.
contract SleeveModuleGasForkTest is SleeveModuleForkTradeBase {
    /// @dev Generous ceilings so a regression shows up as a failure in the normal run as well.
    uint256 private constant SPLIT_CEILING = 600_000;
    uint256 private constant LIGHT_CEILING = 150_000;

    function test_gas_observe() public {
        _setUpTrade();
        address account = _account(0, _defaultRule());
        vm.prank(stranger);
        module.observe(account);
        _log("observe, public", LIGHT_CEILING);
    }

    function test_gas_split_FILLED_byKeeper_onEveryAllowlistedPool() public {
        _setUpTrade();
        Leg[5] memory legs = _legs();
        for (uint256 i; i < legs.length; ++i) {
            address account = _account(bytes32(i), _ruleOn(legs[i].tickerId));
            uint256 quote = _quote(legs[i].tickerId, legs[i].pool, EQUITY);
            vm.prank(keeper);
            module.split(account, legs[i].pool, quote);
            _log(string.concat("split FILLED, keeper, ", legs[i].name), SPLIT_CEILING);
        }
    }

    /// The full guard reads every contract and the equity part queues under the clip: the costliest queue without a
    /// swap.
    function test_gas_split_QUEUED_CLIP_byKeeper() public {
        _setUpTrade();
        ISleeveModule.RuleInput memory rule = _defaultRule();
        rule.minClip = uint128(EQUITY + 1);
        address account = _account(0, rule);
        vm.prank(keeper);
        module.split(account, LaunchConfig.SPY_POOL_500, 1);
        _log("split QUEUED CLIP, keeper", SPLIT_CEILING);
        assertEq(uint8(module.bucketOf(account, SPY).reason), uint8(Reason.CLIP));
    }

    /// The weekend case: the guard stops at the calendar.
    function test_gas_split_QUEUED_SESSION_byKeeper() public {
        _setUpTradeAt(WEEKEND_BLOCK);
        address account = _account(0, _defaultRule());
        vm.prank(keeper);
        module.split(account, LaunchConfig.SPY_POOL_500, 1);
        _log("split QUEUED SESSION, keeper, weekend block", SPLIT_CEILING);
        assertEq(uint8(module.bucketOf(account, SPY).reason), uint8(Reason.SESSION));
    }

    /// The swap runs and is undone: the costliest queue.
    function test_gas_split_QUEUED_PREMIUM_byKeeper() public {
        _setUpTrade();
        ISleeveModule.RuleInput memory rule = _defaultRule();
        rule.premiumCapBps = 0;
        address account = _account(0, rule);
        uint256 quote = _quote(SPY, LaunchConfig.SPY_POOL_500, EQUITY);
        vm.prank(keeper);
        module.split(account, LaunchConfig.SPY_POOL_500, quote);
        _log("split QUEUED PREMIUM, keeper", SPLIT_CEILING);
        assertEq(uint8(module.bucketOf(account, SPY).reason), uint8(Reason.PREMIUM));
    }

    function test_gas_settle_SETTLED_byKeeper() public {
        _setUpTrade();
        ISleeveModule.RuleInput memory rule = _defaultRule();
        rule.minClip = 150e6;
        address account = _account(0, rule);
        vm.prank(keeper);
        module.split(account, LaunchConfig.SPY_POOL_500, 1);
        _pay(account, PAYMENT);
        vm.prank(keeper);
        module.split(account, LaunchConfig.SPY_POOL_500, 1);
        uint256 quote = _quote(SPY, LaunchConfig.SPY_POOL_500, 2 * EQUITY);
        vm.prank(keeper);
        module.settle(account, SPY, LaunchConfig.SPY_POOL_500, quote);
        _log("settle SETTLED, keeper", SPLIT_CEILING);
        assertEq(module.bucketOf(account, SPY).amount, 0);
    }

    /// The owner's release as the module call, and as the whole bracketed UserOp through handleOps.
    function test_gas_release_byOwner() public {
        _setUpTrade();
        ISleeveModule.RuleInput memory rule = _defaultRule();
        rule.minClip = uint128(EQUITY + 1);
        address account = _account(0, rule);
        vm.prank(keeper);
        module.split(account, LaunchConfig.SPY_POOL_500, 1);
        uint256 snapshot = vm.snapshotState();
        vm.prank(account);
        module.release(SPY);
        _log("release, the module call", LIGHT_CEILING);
        vm.revertToState(snapshot);

        OpResult memory result = _ownerOp(
            account, OwnerOps.single(address(module), address(module), abi.encodeCall(ISleeveModule.release, (SPY)))
        );
        assertTrue(result.success);
        console.log("release, bracketed owner UserOp, actualGasUsed", result.actualGasUsed);
    }

    /// The owner's split from a bracketed UserOp through handleOps.
    function test_gas_split_FILLED_byOwnerUserOp() public {
        _setUpTrade();
        address account = _account(0, _defaultRule());
        uint256 quote = _quote(SPY, LaunchConfig.SPY_POOL_500, EQUITY);
        OpResult memory result = _ownerSplit(account, LaunchConfig.SPY_POOL_500, quote);
        assertEq(uint8(_receiptsIn(result.logs, address(module))[0].status), uint8(Status.FILLED));
        console.log("split FILLED, bracketed owner UserOp, actualGasUsed", result.actualGasUsed);
    }

    function _log(string memory label, uint256 ceiling) private view {
        Vm.Gas memory gas = vm.lastCallGas();
        console.log(label, gas.gasTotalUsed);
        assertLt(gas.gasTotalUsed, ceiling, "gas ceiling");
    }
}
