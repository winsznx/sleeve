// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IUniswapV3Pool
/// @notice The immutable pool views Sleeve reads.
interface IUniswapV3Pool {
    /// @notice The lower-sorted token of the pair. Selector 0x0dfe1681.
    function token0() external view returns (address);

    /// @notice The higher-sorted token of the pair. Selector 0xd21220a7.
    function token1() external view returns (address);

    /// @notice The pool fee in hundredths of a basis point: 100, 500, 3000 or 10000 on this chain's factory.
    /// Selector 0xddca3f43.
    function fee() external view returns (uint24);
}
