// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {ISwapRouter02} from "../../src/interfaces/ISwapRouter02.sol";
import {IUniswapV3Factory} from "../../src/interfaces/IUniswapV3Factory.sol";
import {IInvSwapCallback, InvPool} from "./InvPool.sol";

/// @notice SwapRouter02's exactInputSingle for the invariant suite, as the real router runs it, in either direction:
/// the pool comes from the factory by (tokenIn, tokenOut, fee), the pool's callback pulls the input from the caller
/// straight to the pool, so the router never holds funds, and the output is checked against amountOutMinimum with the
/// real router's "Too little received".
contract InvRouter is ISwapRouter02, IInvSwapCallback {
    address public immutable factory;

    /// @dev The swap in flight, for the pool's callback.
    address private _payer;
    address private _tokenIn;
    address private _pool;

    error NoPool(address tokenIn, address tokenOut, uint24 fee);
    error UnexpectedCallback(address caller);

    constructor(address factory_) {
        factory = factory_;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut) {
        address pool = IUniswapV3Factory(factory).getPool(params.tokenIn, params.tokenOut, params.fee);
        if (pool == address(0)) revert NoPool(params.tokenIn, params.tokenOut, params.fee);
        (_payer, _tokenIn, _pool) = (msg.sender, params.tokenIn, pool);
        (, amountOut) = InvPool(pool).swap(params.recipient, params.tokenIn, params.amountIn);
        (_payer, _tokenIn, _pool) = (address(0), address(0), address(0));
        require(amountOut >= params.amountOutMinimum, "Too little received");
    }

    function invSwapCallback(uint256 owed) external {
        if (msg.sender != _pool || msg.sender == address(0)) revert UnexpectedCallback(msg.sender);
        require(IERC20(_tokenIn).transferFrom(_payer, msg.sender, owed), "pay");
    }
}
