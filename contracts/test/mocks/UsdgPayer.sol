// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";

/// @notice Holds USDG and pays it out on request: a wallet the owner pulls from inside a bracket, or a venue paying a
/// module action's proceeds.
contract UsdgPayer {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdg;

    constructor(IERC20 usdg_) {
        usdg = usdg_;
    }

    function payCaller(uint256 amount) external {
        usdg.safeTransfer(msg.sender, amount);
    }

    function pay(address to, uint256 amount) external {
        usdg.safeTransfer(to, amount);
    }
}
