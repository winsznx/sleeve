// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IUniswapV3Factory} from "../../src/interfaces/IUniswapV3Factory.sol";

/// @notice A Uniswap v3 factory's pool registry for the invariant suite. Like the real factory, getPool answers in
/// either token order. The suite registers InvPool venues, which MockV3Factory cannot create.
contract InvFactory is IUniswapV3Factory {
    mapping(address tokenA => mapping(address tokenB => mapping(uint24 fee => address pool))) public getPool;

    function register(address tokenA, address tokenB, uint24 fee, address pool) external {
        getPool[tokenA][tokenB][fee] = pool;
        getPool[tokenB][tokenA][fee] = pool;
    }
}
