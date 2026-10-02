// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAccessControlsRegistry} from "../../src/interfaces/IAccessControlsRegistry.sol";

/// @notice The stock token registry's blocklist with an open setter.
contract MockRegistry is IAccessControlsRegistry {
    mapping(address account => bool) public isBlocked;

    function setBlocked(address account, bool blocked) external {
        isBlocked[account] = blocked;
    }
}
