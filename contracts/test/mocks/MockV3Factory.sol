// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IUniswapV3Factory} from "../../src/interfaces/IUniswapV3Factory.sol";
import {MockERC20} from "./MockERC20.sol";
import {MockV3Pool} from "./MockV3Pool.sol";

/// @notice A Uniswap v3 factory's pool registry. Like the real factory, getPool answers in either token order. Any
/// fee is accepted, so tests can create pools in tiers TokenSource refuses. Each new pool gets inventory of both tokens,
/// which the mock routers pay swaps out of.
contract MockV3Factory is IUniswapV3Factory {
    /// @dev Inventory per token per pool: more than any test swaps.
    uint256 private constant INVENTORY = 1e36;

    mapping(address tokenA => mapping(address tokenB => mapping(uint24 fee => address pool))) public getPool;

    function createPool(address tokenA, address tokenB, uint24 fee) external returns (address pool) {
        pool = address(new MockV3Pool(tokenA, tokenB, fee));
        getPool[tokenA][tokenB][fee] = pool;
        getPool[tokenB][tokenA][fee] = pool;
        _stock(tokenA, pool);
        _stock(tokenB, pool);
    }

    /// @dev Mints the pool its inventory. A token without an open mint, such as a decimals-only stand-in, gets none
    /// and is never swapped.
    function _stock(address token, address pool) private {
        if (token.code.length == 0) return;
        (bool minted,) = token.call(abi.encodeCall(MockERC20.mint, (pool, INVENTORY)));
        minted;
    }
}
