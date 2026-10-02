// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IUniswapV3Factory} from "../../src/interfaces/IUniswapV3Factory.sol";
import {MockV3Pool} from "./MockV3Pool.sol";

/// @notice A Uniswap v3 factory's pool registry. Like the real factory, getPool answers in either token order. Any
/// fee is accepted, so tests can create pools in tiers TokenSource refuses.
contract MockV3Factory is IUniswapV3Factory {
    mapping(address tokenA => mapping(address tokenB => mapping(uint24 fee => address pool))) public getPool;

    function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool) {
        pool = address(new MockV3Pool(tokenA, tokenB, fee));
        getPool[tokenA][tokenB][fee] = pool;
        getPool[tokenB][tokenA][fee] = pool;
    }
}
