// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";
import {IStockToken} from "../../src/interfaces/IStockToken.sol";
import {PriceGuard} from "../../src/libraries/PriceGuard.sol";
import {GuardParams, Reason} from "../../src/types/SleeveTypes.sol";

/// @notice Calls PriceGuard through external functions, so tests can expect its reverts and fork tests can run it
/// against the live chain.
contract PriceGuardHarness {
    function defaultGuardParams() external pure returns (GuardParams memory) {
        return PriceGuard.defaultGuardParams();
    }

    function checkBuy(
        IStockToken token,
        IAggregatorV3 feed,
        IAggregatorV3 usdgUsdFeed,
        address account,
        address pool,
        bool sessionOpen,
        uint256 sessionOpenedAt,
        GuardParams memory params
    ) external view returns (PriceGuard.BuyCheck memory) {
        return PriceGuard.checkBuy(token, feed, usdgUsdFeed, account, pool, sessionOpen, sessionOpenedAt, params);
    }

    function checkToken(IStockToken token, address account, address pool) external view returns (bool, Reason) {
        return PriceGuard.checkToken(token, account, pool);
    }

    function checkMultiplier(IStockToken token, uint256 window) external view returns (Reason) {
        return PriceGuard.checkMultiplier(token, window);
    }

    function readStockFeed(IAggregatorV3 feed, uint256 maxAge, uint256 sessionOpenedAt)
        external
        view
        returns (Reason, uint80, int256, uint256)
    {
        return PriceGuard.readStockFeed(feed, maxAge, sessionOpenedAt);
    }

    function checkUsdg(IAggregatorV3 usdgUsdFeed, uint16 toleranceBps, uint256 maxAge)
        external
        view
        returns (Reason, uint80, int256)
    {
        return PriceGuard.checkUsdg(usdgUsdFeed, toleranceBps, maxAge);
    }

    function exceedsPremium(
        uint256 usdgSpent,
        uint256 tokensOut,
        int256 answer,
        uint16 capBps,
        uint8 usdgDecimals,
        uint8 tokenDecimals,
        uint8 feedDecimals
    ) external pure returns (bool) {
        return PriceGuard.exceedsPremium(
            usdgSpent, tokensOut, answer, capBps, usdgDecimals, tokenDecimals, feedDecimals
        );
    }

    function exceedsDiscount(
        uint256 usdgOut,
        uint256 tokensIn,
        int256 answer,
        uint16 capBps,
        uint8 usdgDecimals,
        uint8 tokenDecimals,
        uint8 feedDecimals
    ) external pure returns (bool) {
        return PriceGuard.exceedsDiscount(usdgOut, tokensIn, answer, capBps, usdgDecimals, tokenDecimals, feedDecimals);
    }

    function execPriceBuy(uint256 usdgSpent, uint256 tokensOut) external pure returns (uint256) {
        return PriceGuard.execPriceBuy(usdgSpent, tokensOut);
    }

    function execPriceSell(uint256 usdgOut, uint256 tokensIn) external pure returns (uint256) {
        return PriceGuard.execPriceSell(usdgOut, tokensIn);
    }

    function premiumBps(
        uint256 usdgSpent,
        uint256 tokensOut,
        int256 answer,
        uint8 usdgDecimals,
        uint8 tokenDecimals,
        uint8 feedDecimals
    ) external pure returns (int256) {
        return PriceGuard.premiumBps(usdgSpent, tokensOut, answer, usdgDecimals, tokenDecimals, feedDecimals);
    }

    function discountBps(
        uint256 usdgOut,
        uint256 tokensIn,
        int256 answer,
        uint8 usdgDecimals,
        uint8 tokenDecimals,
        uint8 feedDecimals
    ) external pure returns (int256) {
        return PriceGuard.discountBps(usdgOut, tokensIn, answer, usdgDecimals, tokenDecimals, feedDecimals);
    }
}
