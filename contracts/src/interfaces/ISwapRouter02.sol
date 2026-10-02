// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title ISwapRouter02
/// @notice Uniswap SwapRouter02's single-pool exact-input swap, on the router at
/// 0xCaf681a66D020601342297493863E78C959E5cb2. SwapRouter02's struct has no deadline, unlike the first SwapRouter's,
/// so the selector is 0x04e45aaf. The deployed bytecode carries that selector and not the deadline variant 0x414bf389.
interface ISwapRouter02 {
    /// @param tokenIn The token the router pulls from the caller.
    /// @param tokenOut The token sent to the recipient.
    /// @param fee Picks the pool: the router swaps through the factory's pool for (tokenIn, tokenOut, fee).
    /// @param recipient Who receives tokenOut.
    /// @param amountIn Exact amount of tokenIn offered. A pool that runs out of liquidity fills only part of it.
    /// @param amountOutMinimum The swap reverts below this output.
    /// @param sqrtPriceLimitX96 Zero means no price limit.
    struct ExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint24 fee;
        address recipient;
        uint256 amountIn;
        uint256 amountOutMinimum;
        uint160 sqrtPriceLimitX96;
    }

    /// @notice Swaps amountIn of tokenIn for as much tokenOut as the pool gives. Selector 0x04e45aaf.
    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut);
}
