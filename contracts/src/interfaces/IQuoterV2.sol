// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IQuoterV2
/// @notice Uniswap QuoterV2 at 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7. It simulates the swap and reverts
/// internally, so it is not a view, and keepers call it with eth_call. The Quoter V1 argument shape reverts on this
/// deployment.
interface IQuoterV2 {
    struct QuoteExactInputSingleParams {
        address tokenIn;
        address tokenOut;
        uint256 amountIn;
        uint24 fee;
        uint160 sqrtPriceLimitX96;
    }

    /// @notice What exactInputSingle would return at the current state. Selector 0xc6a5026a.
    function quoteExactInputSingle(QuoteExactInputSingleParams memory params)
        external
        returns (uint256 amountOut, uint160 sqrtPriceX96After, uint32 initializedTicksCrossed, uint256 gasEstimate);
}
