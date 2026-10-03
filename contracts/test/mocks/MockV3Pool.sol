// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniswapV3Pool} from "../../src/interfaces/IUniswapV3Pool.sol";

/// @notice A Uniswap v3 pool's immutable views, with the pair sorted as the real factory sorts it, and an open payout
/// the mock routers swap through, so a fill moves the pool's balances as a real swap does (audit A1-23).
contract MockV3Pool is IUniswapV3Pool {
    address public immutable token0;
    address public immutable token1;
    uint24 public immutable fee;

    constructor(address tokenA, address tokenB, uint24 fee_) {
        (token0, token1) = tokenA < tokenB ? (tokenA, tokenB) : (tokenB, tokenA);
        fee = fee_;
    }

    /// @notice Pays out of the pool's own balance, as a swap does. Open, for the mock routers.
    function pay(address token, address to, uint256 amount) external {
        require(IERC20(token).transfer(to, amount), "pay");
    }
}
