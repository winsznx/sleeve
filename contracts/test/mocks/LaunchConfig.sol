// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TokenSource} from "../../src/TokenSource.sol";
import {SessionCalendar} from "../../src/libraries/SessionCalendar.sol";
import {Chain4663} from "../utils/Chain4663.sol";

/// @notice The launch configuration the fork tests deploy: the four tickers with ALL_DAY sessions (B2-1) and the
/// D-010 pool allowlist, plus the other canonical USDG pools of docs/research/chain-constants.md section 2 that the
/// allowlist leaves out.
library LaunchConfig {
    /// @notice The stock token beacon and registry, read from every launch token's ACCESS_CONTROLLED_REGISTRY().
    address internal constant REGISTRY = 0xe10b6f6B275de231345c20D14Ab812db62151b00;

    // D-010 allowlist.
    address internal constant SPY_POOL_500 = 0xa7Bb1AC63BBaB0C44316E6c8C455213441689167;
    address internal constant QQQ_POOL_500 = 0xD60A5d14dB690B7Afad71F76B108071D7175597d;
    address internal constant NVDA_POOL_500 = 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3;
    address internal constant AAPL_POOL_500 = 0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D;
    address internal constant AAPL_POOL_3000 = 0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed;

    // Canonical USDG pools outside the allowlist.
    address internal constant SPY_POOL_100 = 0x62FDE201C424d6d07730B77450Dd73928EBAc5f5;
    address internal constant SPY_POOL_3000 = 0xA43b424Bc609495AED4BCD88d654934b510B0aD9;
    address internal constant QQQ_POOL_100 = 0x4539019B527211998642fEC342C85dcB44c7e5E4;
    address internal constant QQQ_POOL_3000 = 0xEbD78dcfc8a6b3A696f1E191aD1ff321f9579f79;
    address internal constant NVDA_POOL_100 = 0xb75d2D02B0Ec3DE50d32e40A4F1A8DAE8acC4333;
    address internal constant NVDA_POOL_3000 = 0xB944cec30Bd4175855215D767ADC81F39e5f7E2B;
    address internal constant NVDA_POOL_10000 = 0xc277560DF3689A401bA7deDd7626168b234Ceb5e;
    address internal constant AAPL_POOL_10000 = 0x3714aa8105DE1f384481B425788Af413748C1837;

    /// @notice The pool PRD source S24 calls the NVDA pool. It pairs USDG with a memecoin (D-010).
    address internal constant MEMECOIN_POOL = 0xAe1685599288831eB0844Cb59058116eE3184b9A;

    function tickerInits() internal pure returns (TokenSource.TickerInit[] memory tickers) {
        tickers = new TokenSource.TickerInit[](4);
        tickers[0] = _ticker(Chain4663.SPY, Chain4663.SPY_FEED, _one(SPY_POOL_500));
        tickers[1] = _ticker(Chain4663.QQQ, Chain4663.QQQ_FEED, _one(QQQ_POOL_500));
        tickers[2] = _ticker(Chain4663.NVDA, Chain4663.NVDA_FEED, _one(NVDA_POOL_500));
        address[] memory aaplPools = new address[](2);
        aaplPools[0] = AAPL_POOL_500;
        aaplPools[1] = AAPL_POOL_3000;
        tickers[3] = _ticker(Chain4663.AAPL, Chain4663.AAPL_FEED, aaplPools);
    }

    function _ticker(address token, address feed, address[] memory pools)
        private
        pure
        returns (TokenSource.TickerInit memory)
    {
        return TokenSource.TickerInit({
            token: token, feed: feed, sessionType: SessionCalendar.SessionType.ALL_DAY, pools: pools
        });
    }

    function _one(address pool) private pure returns (address[] memory pools) {
        pools = new address[](1);
        pools[0] = pool;
    }
}
