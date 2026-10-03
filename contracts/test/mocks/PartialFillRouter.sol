// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapRouter02} from "../../src/interfaces/ISwapRouter02.sol";

/// @notice A venue that fills only part of every order: it pulls fillBps of amountIn from the caller and swaps that
/// part through the real SwapRouter02 into the recipient, with the caller's minimum. It stands in for a pool that runs
/// out of liquidity, which no allowlisted pool on chain 4663 does: each holds full-range liquidity, and a 1e16 USDG
/// probe filled in full on every one at block 78,312,136.
contract PartialFillRouter is ISwapRouter02 {
    using SafeERC20 for IERC20;

    ISwapRouter02 public immutable router;
    uint16 public immutable fillBps;

    constructor(ISwapRouter02 router_, uint16 fillBps_) {
        router = router_;
        fillBps = fillBps_;
    }

    /// @notice The real router's factory, so the module's constructor check passes.
    function factory() external view returns (address) {
        return router.factory();
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut) {
        uint256 taken = params.amountIn * fillBps / 10_000;
        IERC20 tokenIn = IERC20(params.tokenIn);
        tokenIn.safeTransferFrom(msg.sender, address(this), taken);
        tokenIn.forceApprove(address(router), taken);
        ExactInputSingleParams memory part = params;
        part.amountIn = taken;
        amountOut = router.exactInputSingle(part);
        tokenIn.forceApprove(address(router), 0);
    }
}
