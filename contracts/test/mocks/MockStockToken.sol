// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAccessControlsRegistry} from "../../src/interfaces/IAccessControlsRegistry.sol";
import {IStockToken} from "../../src/interfaces/IStockToken.sol";
import {MockERC20} from "./MockERC20.sol";

/// @notice A Robinhood Stock Token with open setters. The multiplier views follow the verified Stock implementation
/// (docs/research/chain-constants.md section 3): uiMultiplier() switches to the scheduled value at effectiveAt with no
/// transaction, and both multipliers read 1e18 until one is set. Transfers revert like the real token's while it is
/// paused or when the sender, the recipient or the caller is on the registry's blocklist.
contract MockStockToken is MockERC20, IStockToken {
    uint256 private constant ONE = 1e18;

    bool private _paused;
    bool private _oraclePaused;
    bytes32 private _uid;
    address private _registry;
    uint256 private _multiplier;
    uint256 private _newMultiplier;
    uint256 private _effectiveAt;

    /// @notice The real token's error for a transfer while paused, selector 0x1309a563.
    error IsPaused();

    /// @notice The real token's error for a transfer that touches a blocked address, selector 0x75e91ce7.
    error Blocked(address account);

    constructor(string memory name_, string memory symbol_, address registry_) MockERC20(name_, symbol_, 18) {
        _registry = registry_;
    }

    /// @notice Stands for the token flag or the registry's global pause, which the real paused() ORs.
    function setPaused(bool paused_) external {
        _paused = paused_;
    }

    function setOraclePaused(bool oraclePaused_) external {
        _oraclePaused = oraclePaused_;
    }

    function setRegistry(address registry_) external {
        _registry = registry_;
    }

    function setUid(bytes32 uid_) external {
        _uid = uid_;
    }

    /// @notice As the issuer's updateMultiplier(uint256,uint256): the multiplier in force now becomes the old one,
    /// and newMultiplier takes over at effectiveAt_.
    function scheduleMultiplier(uint256 newMultiplier, uint256 effectiveAt_) external {
        _multiplier = uiMultiplier();
        _newMultiplier = newMultiplier;
        _effectiveAt = effectiveAt_;
    }

    function paused() external view returns (bool) {
        return _paused;
    }

    function oraclePaused() external view returns (bool) {
        return _oraclePaused;
    }

    function uiMultiplier() public view returns (uint256) {
        if (_newMultiplier != 0 && block.timestamp >= _effectiveAt) return _newMultiplier;
        return _multiplier == 0 ? ONE : _multiplier;
    }

    function newUIMultiplier() external view returns (uint256) {
        return _newMultiplier == 0 ? ONE : _newMultiplier;
    }

    function effectiveAt() external view returns (uint256) {
        return _effectiveAt;
    }

    function uid() external view returns (bytes32) {
        return _uid;
    }

    function ACCESS_CONTROLLED_REGISTRY() external view returns (address) {
        return _registry;
    }

    function decimals() public view override(MockERC20, IStockToken) returns (uint8) {
        return super.decimals();
    }

    function _update(address from, address to, uint256 value) internal override {
        if (_paused) revert IsPaused();
        _requireNotBlocked(from);
        _requireNotBlocked(to);
        _requireNotBlocked(msg.sender);
        super._update(from, to, value);
    }

    function _requireNotBlocked(address account) private view {
        if (account == address(0) || _registry.code.length == 0) return;
        if (IAccessControlsRegistry(_registry).isBlocked(account)) revert Blocked(account);
    }
}
