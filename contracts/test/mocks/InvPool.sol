// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IUniswapV3Pool} from "../../src/interfaces/IUniswapV3Pool.sol";

/// @notice The router side of an InvPool swap: pays the pool what the swap used.
interface IInvSwapCallback {
    function invSwapCallback(uint256 owed) external;
}

/// @notice A USDG and stock token pool for the invariant suite, the shape of a v3 pool swap in either direction: it
/// sends the output first from its own inventory, then calls the router back for the input and checks it arrived. The
/// price is a setting, so the suite decides the premium a buy pays, or the discount a sale takes, against the feed.
/// Settings break the swap the ways the module must catch: a pool that reverts, one that uses only part of the input,
/// and one that delivers less than it reports, as a token with a transfer fee would. Sells (component 6) use the same
/// price and the same faults.
contract InvPool is IUniswapV3Pool {
    uint16 private constant BPS = 10_000;

    /// @notice 10^(18 + 8 - 6): USDG base units times this, over a price with 8 decimals, gives token base units.
    uint256 private constant SCALE = 1e20;

    address public immutable token0;
    address public immutable token1;
    uint24 public immutable fee;
    IERC20 public immutable usdg;
    IERC20 public immutable token;

    /// @notice The all-in price, USDG per whole token with 8 decimals, as a feed answer is.
    uint256 public priceE8;
    /// @notice Share of the input a swap uses, in basis points. Below 10,000 is a partial fill.
    uint16 public fillBps = BPS;
    /// @notice Share of the reported output kept back from the recipient, in basis points.
    uint16 public withheldBps;
    /// @notice Every swap reverts while set.
    bool public unavailable;

    error PoolUnavailable();
    error NotPoolToken(address tokenIn);
    error UnpaidSwap(uint256 owed, uint256 received);

    constructor(IERC20 usdg_, IERC20 token_, uint24 fee_, uint256 priceE8_) {
        (token0, token1) =
            address(usdg_) < address(token_) ? (address(usdg_), address(token_)) : (address(token_), address(usdg_));
        usdg = usdg_;
        token = token_;
        fee = fee_;
        priceE8 = priceE8_;
    }

    function setPrice(uint256 priceE8_) external {
        priceE8 = priceE8_;
    }

    function setFillBps(uint16 fillBps_) external {
        fillBps = fillBps_;
    }

    function setWithheldBps(uint16 withheldBps_) external {
        withheldBps = withheldBps_;
    }

    function setUnavailable(bool unavailable_) external {
        unavailable = unavailable_;
    }

    /// @notice What a swap of amountIn of tokenIn would do now.
    /// @param tokenIn USDG for a buy, the stock token for a sale.
    /// @return used Input the swap takes.
    /// @return out Output the swap reports to the router.
    /// @return delivered Output that reaches the recipient.
    function quote(address tokenIn, uint256 amountIn)
        public
        view
        returns (uint256 used, uint256 out, uint256 delivered)
    {
        used = amountIn * fillBps / BPS;
        out = tokenIn == address(usdg) ? used * SCALE / priceE8 : used * priceE8 / SCALE;
        delivered = out - out * withheldBps / BPS;
    }

    /// @notice Swaps amountIn of tokenIn for the other token: sends the delivered output to the recipient, then asks
    /// the caller for the input the swap used.
    /// @return used Input taken.
    /// @return out Output reported.
    function swap(address recipient, address tokenIn, uint256 amountIn) external returns (uint256 used, uint256 out) {
        if (unavailable) revert PoolUnavailable();
        if (tokenIn != address(usdg) && tokenIn != address(token)) revert NotPoolToken(tokenIn);
        (IERC20 input, IERC20 output) = tokenIn == address(usdg) ? (usdg, token) : (token, usdg);
        uint256 delivered;
        (used, out, delivered) = quote(tokenIn, amountIn);
        if (delivered != 0) require(output.transfer(recipient, delivered), "transfer out");
        uint256 before = input.balanceOf(address(this));
        IInvSwapCallback(msg.sender).invSwapCallback(used);
        uint256 received = input.balanceOf(address(this)) - before;
        if (received < used) revert UnpaidSwap(used, received);
    }
}
