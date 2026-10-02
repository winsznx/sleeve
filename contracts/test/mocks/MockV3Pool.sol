// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IUniswapV3Pool} from "../../src/interfaces/IUniswapV3Pool.sol";

/// @notice A Uniswap v3 pool's immutable views, with the pair sorted as the real factory sorts it.
contract MockV3Pool is IUniswapV3Pool {
    address public immutable token0;
    address public immutable token1;
    uint24 public immutable fee;

    constructor(address tokenA, address tokenB, uint24 fee_) {
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        fee = fee_;
    }
}
