// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";

/// @title SleeveTimelock
/// @notice The timelock that administers TokenSource and SessionCalendarExtension: OpenZeppelin v5.4's
/// TimelockController with a minimum delay that stays between 172,800 seconds and 30 days, so every admin write is
/// public for at least 48 hours before it can run (D-009 Q33, D-018), and a mistaken raise cannot freeze admin writes
/// (D-019). The stock contract lets a scheduled self-operation set any delay, zero included. Here the constructor and
/// updateDelay refuse a delay outside the bounds, and the constructor refuses an extra admin, so every role change is
/// itself a timelocked operation. Everything else works as before.
/// @dev TimelockController keeps its delay in a private variable that only its external updateDelay writes, and an
/// external function cannot be reached through super. So this contract holds the delay itself, returns it from
/// getMinDelay, which schedule and scheduleBatch read, and replaces updateDelay with the same caller check and event
/// plus the bounds. The parent's variable keeps the constructor value and is never read again.
contract SleeveTimelock is TimelockController {
    /// @notice The lowest minimum delay this timelock accepts: 48 hours, in seconds.
    uint256 public constant MIN_DELAY_FLOOR = 172_800;

    /// @notice The highest minimum delay this timelock accepts: 30 days, in seconds.
    uint256 public constant MIN_DELAY_CEILING = 2_592_000;

    /// @dev The minimum delay in force, in seconds. Always between MIN_DELAY_FLOOR and MIN_DELAY_CEILING.
    uint256 private _delay;

    /// @notice A minimum delay below the floor was given to the constructor or to updateDelay.
    /// @param delay The delay given, in seconds.
    /// @param floor MIN_DELAY_FLOOR.
    error DelayBelowFloor(uint256 delay, uint256 floor);

    /// @notice A minimum delay above the ceiling was given to the constructor or to updateDelay.
    /// @param delay The delay given, in seconds.
    /// @param ceiling MIN_DELAY_CEILING.
    error DelayAboveCeiling(uint256 delay, uint256 ceiling);

    /// @notice The constructor was given an extra admin. Sleeve's timelock administers only itself.
    /// @param admin The address given.
    error AdminNotZero(address admin);

    /// @dev Caller: the deploy script.
    /// @param minDelay The first minimum delay in seconds, from MIN_DELAY_FLOOR to MIN_DELAY_CEILING.
    /// @param proposers Accounts given the proposer and canceller roles. Sleeve passes DEPLOYER alone.
    /// @param executors Accounts given the executor role. Sleeve passes DEPLOYER alone. Including address(0) would let
    /// anyone execute a ready operation.
    /// @param admin Must be address(0), so only the timelock administers itself and every role change waits out the
    /// delay. Kept for the parent's constructor shape.
    constructor(uint256 minDelay, address[] memory proposers, address[] memory executors, address admin)
        TimelockController(minDelay, proposers, executors, admin)
    {
        if (admin != address(0)) revert AdminNotZero(admin);
        _requireBounds(minDelay);
        _delay = minDelay;
    }

    /// @notice Changes the minimum delay for operations scheduled from now on. Operations already scheduled keep their
    /// ready time. A change is an operation that waits out the delay in force, and it reverts outside the bounds however
    /// it was scheduled.
    /// @dev Caller: the timelock itself, through an executed operation.
    /// @param newDelay The new minimum delay in seconds, from MIN_DELAY_FLOOR to MIN_DELAY_CEILING.
    function updateDelay(uint256 newDelay) external override {
        address sender = _msgSender();
        if (sender != address(this)) revert TimelockUnauthorizedCaller(sender);
        _requireBounds(newDelay);
        emit MinDelayChange(_delay, newDelay);
        _delay = newDelay;
    }

    /// @notice The minimum delay an operation must be scheduled with.
    /// @dev Caller: anyone.
    /// @return The delay in seconds, from MIN_DELAY_FLOOR to MIN_DELAY_CEILING.
    function getMinDelay() public view override returns (uint256) {
        return _delay;
    }

    /// @dev The floor and the ceiling, checked by the constructor and updateDelay.
    function _requireBounds(uint256 delay) private pure {
        if (delay < MIN_DELAY_FLOOR) revert DelayBelowFloor(delay, MIN_DELAY_FLOOR);
        if (delay > MIN_DELAY_CEILING) revert DelayAboveCeiling(delay, MIN_DELAY_CEILING);
    }
}
