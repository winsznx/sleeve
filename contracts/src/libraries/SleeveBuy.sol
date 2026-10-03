// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {Execution, IERC7579Execution} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
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
    using SafeCast for uint256;

    /// @dev ERC-7579 mode: batch call type, default exec type (revert on failure), no selector or payload.
    bytes32 private constant BATCH_MODE = bytes32(uint256(1) << 248);

    uint8 private constant USDG_DECIMALS = 6;

    /// @dev USDG and token balances of the account and the pool, read around the batch.
    struct Balances {
        uint256 accountUsdg;
        uint256 accountTokens;
        uint256 poolUsdg;
        uint256 poolTokens;
    }

    /// @notice Runs the three calls on the account and checks the postconditions: USDG spent equals amountIn
    /// (PartialFill), tokens arrived (TooFewTokens, I3), the pool moved by the same amounts (FillNotFromPool), the
    /// router's allowance is back to zero (AllowanceNotReset, I4), and the module's own balances did not change
    /// (ModuleHoldsFunds, I1). Then it reads the three decimals from their contracts, asserts 6, 18 and 8, reverts
    /// PremiumAboveCap when the fill paid more than the cap above the feed price, and only then TooFewTokens below
    /// minOut: PRD 7.4 queues step 8 before step 9 reverts (audit A1-12).
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
        if (fill.tokensOut < order.minOut) revert ISleeveModule.TooFewTokens(fill.tokensOut, order.minOut);
        fill.execPrice = PriceGuard.execPriceBuy(fill.usdgSpent, fill.tokensOut);
    }

    /// @dev Runs the batch and measures it: USDG spent must equal amountIn, tokens must arrive, the pool must show the
    /// same fill from its side, gaining exactly the USDG the account spent and losing exactly the tokens it gained, so
    /// the fill is a swap in the allowlisted pool and not transfers the account arranged (audit A1-23), and the
    /// allowance must be zero again. A batch revert carrying the PremiumAboveCap selector becomes BatchReverted, so
    /// only the module's own premium check can make split queue PREMIUM (audit A1-19); any other bubbles unchanged.
    function _swap(IERC20 usdg, ISwapRouter02 router, ISleeveModule.BuyOrder calldata order)
        private
        returns (uint256 usdgSpent, uint256 tokensOut)
    {
        IERC20 token = IERC20(order.token);
        Balances memory before = _balances(usdg, token, order);

        try IERC7579Execution(order.account).executeFromExecutor(BATCH_MODE, abi.encode(_calls(usdg, router, order))) {}
        catch (bytes memory reason) {
            // forge-lint: disable-next-line(unsafe-typecast)
            if (reason.length >= 4 && bytes4(reason) == ISleeveModule.PremiumAboveCap.selector) {
                revert ISleeveModule.BatchReverted(reason);
            }
            assembly ("memory-safe") {
                revert(add(reason, 0x20), mload(reason))
            }
        }

        Balances memory afterwards = _balances(usdg, token, order);
        usdgSpent = before.accountUsdg > afterwards.accountUsdg ? before.accountUsdg - afterwards.accountUsdg : 0;
        if (usdgSpent != order.amountIn) revert ISleeveModule.PartialFill(order.amountIn, usdgSpent);
        tokensOut =
            afterwards.accountTokens > before.accountTokens ? afterwards.accountTokens - before.accountTokens : 0;
        if (tokensOut == 0) revert ISleeveModule.TooFewTokens(0, order.minOut);
        int256 poolUsdgDelta = afterwards.poolUsdg.toInt256() - before.poolUsdg.toInt256();
        int256 poolTokenDelta = afterwards.poolTokens.toInt256() - before.poolTokens.toInt256();
        if (poolUsdgDelta != usdgSpent.toInt256() || poolTokenDelta != -tokensOut.toInt256()) {
            revert ISleeveModule.FillNotFromPool(order.pool, poolUsdgDelta, poolTokenDelta);
        }
        uint256 allowance = usdg.allowance(order.account, address(router));
        if (allowance != 0) revert ISleeveModule.AllowanceNotReset(allowance);
    }

    /// @dev The account's and the pool's USDG and token balances.
    function _balances(IERC20 usdg, IERC20 token, ISleeveModule.BuyOrder calldata order)
        private
        view
        returns (Balances memory b)
    {
        b.accountUsdg = usdg.balanceOf(order.account);
        b.accountTokens = token.balanceOf(order.account);
        b.poolUsdg = usdg.balanceOf(order.pool);
        b.poolTokens = token.balanceOf(order.pool);
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

    /// @dev The only batch the module ever has an account run (D-019): exact approval, the swap to the account with no
    /// router minimum, since execute checks minOut after the premium cap, and the approval back to zero.
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
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0
        });
        calls = new Execution[](3);
        calls[0] = Execution(address(usdg), 0, abi.encodeCall(IERC20.approve, (address(router), order.amountIn)));
        calls[1] = Execution(address(router), 0, abi.encodeCall(ISwapRouter02.exactInputSingle, (params)));
        calls[2] = Execution(address(usdg), 0, abi.encodeCall(IERC20.approve, (address(router), 0)));
    }

    /// @dev I1: the buy left the module's balance of the asset as it was. Measured as a delta, because anyone can send
    /// the module a stray balance and an absolute check would then block every buy for good (audit A1-01, HIGH).
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
