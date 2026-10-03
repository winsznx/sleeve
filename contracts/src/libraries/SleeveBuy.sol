// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Execution, IERC7579Execution} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";
import {ISleeveModule} from "../interfaces/ISleeveModule.sol";
import {ISwapRouter02} from "../interfaces/ISwapRouter02.sol";
import {IUniswapV3Pool} from "../interfaces/IUniswapV3Pool.sol";
import {PriceGuard} from "./PriceGuard.sol";

/// @title SleeveBuy
/// @notice The body of SleeveModule.executeBuy: one guarded buy on the account through executeFromExecutor, checked by
/// balance (SPEC section 11). External library, reached by DELEGATECALL from the module, so it runs as the module:
/// the account sees the module as the executor and address(this) is the module.
library SleeveBuy {
    /// @dev ERC-7579 mode: batch call type, default exec type (revert on failure), no selector or payload.
    bytes32 private constant BATCH_MODE = bytes32(uint256(1) << 248);

    uint8 private constant USDG_DECIMALS = 6;

    /// @notice Runs the three calls on the account and checks the postconditions: USDG spent equals amountIn
    /// (PartialFill), tokens arrived and are at least minOut (TooFewTokens, I3), the router's allowance is back to
    /// zero (AllowanceNotReset, I4), and the module holds neither asset (ModuleHoldsFunds, I1). Then it reads the
    /// three decimals from their contracts, asserts 6, 18 and 8, and reverts PremiumAboveCap when the fill paid more
    /// than the cap above the feed price. Any failing call bubbles its own revert, so a minimum-out failure is the
    /// router's.
    /// @dev Caller: SleeveModule.executeBuy, which only the module itself may call.
    /// @param usdg USDG.
    /// @param router SwapRouter02.
    /// @param order The buy.
    /// @return fill What the buy did.
    function execute(IERC20 usdg, ISwapRouter02 router, ISleeveModule.BuyOrder calldata order)
        external
        returns (ISleeveModule.BuyFill memory fill)
    {
        IERC20 token = IERC20(order.token);
        uint256 usdgHeld = usdg.balanceOf(address(this));
        uint256 tokensHeld = token.balanceOf(address(this));
        (fill.usdgSpent, fill.tokensOut) = _swap(usdg, router, order);
        _requireNothingKept(usdg, usdgHeld);
        _requireNothingKept(token, tokensHeld);
        (uint8 usdgDecimals, uint8 tokenDecimals, uint8 feedDecimals) = _decimalsOf(usdg, order);
        fill.premiumBps = PriceGuard.premiumBps(
            fill.usdgSpent, fill.tokensOut, order.answer, usdgDecimals, tokenDecimals, feedDecimals
        );
        if (PriceGuard.exceedsPremium(
                fill.usdgSpent,
                fill.tokensOut,
                order.answer,
                order.premiumCapBps,
                usdgDecimals,
                tokenDecimals,
                feedDecimals
            )) revert ISleeveModule.PremiumAboveCap(fill.premiumBps);
        fill.execPrice = PriceGuard.execPriceBuy(fill.usdgSpent, fill.tokensOut);
    }

    /// @dev Runs the batch and measures it on the account: USDG spent must equal amountIn, tokens must arrive and be
    /// at least minOut, and the allowance must be zero again.
    function _swap(IERC20 usdg, ISwapRouter02 router, ISleeveModule.BuyOrder calldata order)
        private
        returns (uint256 usdgSpent, uint256 tokensOut)
    {
        address account = order.account;
        IERC20 token = IERC20(order.token);
        uint256 usdgBefore = usdg.balanceOf(account);
        uint256 tokensBefore = token.balanceOf(account);

        IERC7579Execution(account).executeFromExecutor(BATCH_MODE, abi.encode(_calls(usdg, router, order)));

        uint256 usdgAfter = usdg.balanceOf(account);
        usdgSpent = usdgBefore > usdgAfter ? usdgBefore - usdgAfter : 0;
        if (usdgSpent != order.amountIn) revert ISleeveModule.PartialFill(order.amountIn, usdgSpent);
        uint256 tokensAfter = token.balanceOf(account);
        tokensOut = tokensAfter > tokensBefore ? tokensAfter - tokensBefore : 0;
        if (tokensOut == 0 || tokensOut < order.minOut) revert ISleeveModule.TooFewTokens(tokensOut, order.minOut);
        uint256 allowance = usdg.allowance(account, address(router));
        if (allowance != 0) revert ISleeveModule.AllowanceNotReset(allowance);
    }

    /// @dev USDG, token and feed decimals, each read from its own contract and asserted, because swapped arguments
    /// would silently loosen the premium cap.
    function _decimalsOf(IERC20 usdg, ISleeveModule.BuyOrder calldata order)
        private
        view
        returns (uint8 usdgDecimals, uint8 tokenDecimals, uint8 feedDecimals)
    {
        usdgDecimals = _decimals(address(usdg), IERC20Metadata(address(usdg)).decimals(), USDG_DECIMALS);
        tokenDecimals = _decimals(order.token, IERC20Metadata(order.token).decimals(), PriceGuard.TOKEN_DECIMALS);
        feedDecimals = _decimals(order.feed, IAggregatorV3(order.feed).decimals(), PriceGuard.FEED_DECIMALS);
    }

    /// @dev The only batch the module ever has an account run (D-019): exact approval, the swap to the account, and
    /// the approval back to zero.
    function _calls(IERC20 usdg, ISwapRouter02 router, ISleeveModule.BuyOrder calldata order)
        private
        view
        returns (Execution[] memory calls)
    {
        ISwapRouter02.ExactInputSingleParams memory params = ISwapRouter02.ExactInputSingleParams({
            tokenIn: address(usdg),
            tokenOut: order.token,
            fee: IUniswapV3Pool(order.pool).fee(),
            recipient: order.account,
            amountIn: order.amountIn,
            amountOutMinimum: order.minOut,
            sqrtPriceLimitX96: 0
        });
        calls = new Execution[](3);
        calls[0] = Execution(address(usdg), 0, abi.encodeCall(IERC20.approve, (address(router), order.amountIn)));
        calls[1] = Execution(address(router), 0, abi.encodeCall(ISwapRouter02.exactInputSingle, (params)));
        calls[2] = Execution(address(usdg), 0, abi.encodeCall(IERC20.approve, (address(router), 0)));
    }

    /// @dev I1: the buy left none of the asset with the module. Measured as a delta, because anyone can send the
    /// module a stray balance and an absolute check would then block every buy for good (audit A1, HIGH).
    function _requireNothingKept(IERC20 asset, uint256 heldBefore) private view {
        uint256 held = asset.balanceOf(address(this));
        if (held != heldBefore) revert ISleeveModule.ModuleHoldsFunds(address(asset), held);
    }

    /// @dev Returns the decimals a contract reported once they equal what the arithmetic assumes.
    function _decimals(address source, uint8 decimals, uint8 expected) private pure returns (uint8) {
        if (decimals != expected) revert ISleeveModule.UnexpectedDecimals(source, decimals, expected);
        return decimals;
    }
}
