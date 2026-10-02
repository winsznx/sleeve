// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/// @title SleeveTimelock
/// @notice The timelock that administers TokenSource and SessionCalendarExtension: OpenZeppelin v5.4's
/// TimelockController with a minimum delay that never goes below 172,800 seconds, so every admin write is public for at
/// least 48 hours before it can run (D-009 Q33, D-018). The stock contract lets a scheduled self-operation set any
/// delay, zero included. Here the constructor and updateDelay refuse a delay below the floor. Raising the delay, and
/// lowering it to any value at or above the floor, work as before, and so does everything else.
/// @dev TimelockController keeps its delay in a private variable that only its external updateDelay writes, and an
/// external function cannot be reached through super. So this contract holds the delay itself, returns it from
/// getMinDelay, which schedule and scheduleBatch read, and replaces updateDelay with the same caller check and event
/// plus the floor. The parent's variable keeps the constructor value and is never read again.
contract SleeveTimelock is TimelockController {
    /// @notice The lowest minimum delay this timelock accepts: 48 hours, in seconds.
    uint256 public constant MIN_DELAY_FLOOR = 172_800;

    /// @dev The minimum delay in force, in seconds. Never below MIN_DELAY_FLOOR.
    uint256 private _delay;

    /// @notice A minimum delay below the floor was given to the constructor or to updateDelay.
    /// @param delay The delay given, in seconds.
    /// @param floor MIN_DELAY_FLOOR.
    error DelayBelowFloor(uint256 delay, uint256 floor);

    /// @param minDelay The first minimum delay in seconds, at least MIN_DELAY_FLOOR.
    /// @param proposers Accounts given the proposer and canceller roles. Sleeve passes DEPLOYER alone.
    /// @param executors Accounts given the executor role. Sleeve passes DEPLOYER alone. Including address(0) would let
    /// anyone execute a ready operation.
    /// @param admin An optional extra admin that can grant and revoke roles without waiting. Sleeve passes address(0),
    /// so only the timelock administers itself and every role change waits out the delay.
    constructor(uint256 minDelay, address[] memory proposers, address[] memory executors, address admin)
        TimelockController(minDelay, proposers, executors, admin)
    {
        _requireFloor(minDelay);
        _delay = minDelay;
    }

    /// @notice Changes the minimum delay for operations scheduled from now on. Operations already scheduled keep their
    /// ready time. Only the timelock itself can call this, so a change is an operation that waits out the delay in
    /// force, and it reverts below MIN_DELAY_FLOOR however it was scheduled.
    /// @param newDelay The new minimum delay in seconds, at least MIN_DELAY_FLOOR.
    function updateDelay(uint256 newDelay) external override {
        address sender = _msgSender();
        if (sender != address(this)) revert TimelockUnauthorizedCaller(sender);
        _requireFloor(newDelay);
        emit MinDelayChange(_delay, newDelay);
        _delay = newDelay;
    }

    /// @notice The minimum delay an operation must be scheduled with.
    /// @return The delay in seconds, never below MIN_DELAY_FLOOR.
    function getMinDelay() public view override returns (uint256) {
        return _delay;
    }

    function _requireFloor(uint256 delay) private pure {
        if (delay < MIN_DELAY_FLOOR) revert DelayBelowFloor(delay, MIN_DELAY_FLOOR);
    }
}
