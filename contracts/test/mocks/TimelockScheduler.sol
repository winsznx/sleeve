// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {SleeveTimelock} from "../../src/SleeveTimelock.sol";

/// @notice Deploys the timelock of the SPEC, SleeveTimelock (172,800-second delay, one address as proposer, executor and
/// canceller, no admin), and runs operations through it the way DEPLOYER will.
abstract contract TimelockScheduler is Test {
    uint256 internal constant TIMELOCK_DELAY = 172_800;

    TimelockController internal timelock;
    /// @dev Stands in for DEPLOYER: proposer, executor and canceller.
    address internal proposer;

    function _deployTimelock() internal {
        proposer = makeAddr("deployer");
        address[] memory roles = new address[](1);
        roles[0] = proposer;
        timelock = new SleeveTimelock(TIMELOCK_DELAY, roles, roles, address(0));
    }

    function _schedule(address target, bytes memory data, bytes32 salt) internal returns (bytes32 id) {
        vm.prank(proposer);
        timelock.schedule(target, 0, data, bytes32(0), salt, TIMELOCK_DELAY);
        return timelock.hashOperation(target, 0, data, bytes32(0), salt);
    }

    function _execute(address target, bytes memory data, bytes32 salt) internal {
        vm.prank(proposer);
        timelock.execute(target, 0, data, bytes32(0), salt);
    }

    /// @dev Schedules, waits out the delay and executes.
    function _throughTimelock(address target, bytes memory data, bytes32 salt) internal {
        _schedule(target, data, salt);
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        _execute(target, data, salt);
    }

    /// @dev The revert data the timelock gives when an operation is executed before it is ready.
    function _notReady(bytes32 id) internal pure returns (bytes memory) {
        bytes32 readyState = bytes32(uint256(1) << uint8(TimelockController.OperationState.Ready));
        return abi.encodeWithSelector(TimelockController.TimelockUnexpectedOperationState.selector, id, readyState);
    }
}
