// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IUniswapV3Factory
/// @notice The one factory view TokenSource needs, on the factory at 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA.
interface IUniswapV3Factory {
    /// @notice The pool the factory created for a pair and fee, in either token order, or zero. Selector 0x1698ee82.
    function getPool(address tokenA, address tokenB, uint24 fee) external view returns (address pool);
}
