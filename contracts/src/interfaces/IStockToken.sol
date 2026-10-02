// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IStockToken
/// @notice The views Sleeve reads from a Robinhood Stock Token: a BeaconProxy whose beacon is the
/// AccessControlsRegistry. Selectors and behavior are from the verified Stock implementation, recorded in
/// docs/research/chain-constants.md section 3. Transfers and balances go through IERC20.
interface IStockToken {
    /// @notice True when the token flag or the registry's global pause is set. Selector 0x5c975abb.
    function paused() external view returns (bool);

    /// @notice The issuer's advisory oracle pause. Nothing onchain enforces it. Selector 0x7706ba52.
    function oraclePaused() external view returns (bool);

    /// @notice The corporate-action multiplier in force, 1e18 = 1.0. It switches to newUIMultiplier() at
    /// effectiveAt() with no transaction. Selector 0xa60bf13d.
    function uiMultiplier() external view returns (uint256);

    /// @notice The scheduled multiplier, or the current one when none is scheduled. Selector 0xdc767007.
    function newUIMultiplier() external view returns (uint256);

    /// @notice When the scheduled multiplier takes effect, in unix seconds, or 0 if none was ever set. Selector
    /// 0x97a4064f.
    function effectiveAt() external view returns (uint256);

    /// @notice The issuer's asset id, equal to the id in the issuer's assets API. Selector 0xf514ce36.
    function uid() external view returns (bytes32);

    /// @notice The registry the token consults for roles, the blocklist and the global pause. Selector 0x50c09be3.
    function ACCESS_CONTROLLED_REGISTRY() external view returns (address);

    /// @notice 18 on every launch token. Selector 0x313ce567.
    function decimals() external view returns (uint8);
}
