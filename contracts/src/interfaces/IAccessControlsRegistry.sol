// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IAccessControlsRegistry
/// @notice The stock token beacon at 0xe10b6f6B275de231345c20D14Ab812db62151b00, which also holds the one blocklist
/// every stock token behind it checks on transfer. docs/research/chain-constants.md section 3.
interface IAccessControlsRegistry {
    /// @notice Whether an address is on the stock token blocklist. Selector 0xfbac3951.
    function isBlocked(address account) external view returns (bool);
}
