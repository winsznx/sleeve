// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IAccessControlsRegistry} from "../../src/interfaces/IAccessControlsRegistry.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";
import {IQuoterV2} from "../../src/interfaces/IQuoterV2.sol";
import {IStockToken} from "../../src/interfaces/IStockToken.sol";
import {ISwapRouter02} from "../../src/interfaces/ISwapRouter02.sol";
import {IUniswapV3Pool} from "../../src/interfaces/IUniswapV3Pool.sol";
import {PriceGuard} from "../../src/libraries/PriceGuard.sol";
import {SessionCalendar} from "../../src/libraries/SessionCalendar.sol";
import {GuardParams, Reason} from "../../src/types/SleeveTypes.sol";
import {LaunchConfig} from "../mocks/LaunchConfig.sol";
import {MockStockToken} from "../mocks/MockStockToken.sol";
import {PriceGuardHarness} from "../mocks/PriceGuardHarness.sol";
import {Chain4663} from "../utils/Chain4663.sol";
import {ForkBase} from "../utils/ForkBase.sol";

/// @notice The registry's write that adds addresses to the blocklist, under BLOCKER_ROLE. Selector 0x6abf7081,
/// docs/research/chain-constants.md section 3. Sleeve never calls it, so it lives here and not in src/interfaces.
interface IRegistryBlocker {
    function blockAccounts(address[] calldata accounts) external;
}

/// @notice PriceGuard against the real SPY, QQQ, NVDA and AAPL tokens and feeds, the real registry and the real
/// USDG/USD feed, at the two pinned blocks of D-008. Expected values come from docs/research/chain-constants.md
/// appendix B.3 and B.4 and docs/research/pools.md, which read the same blocks independently.
contract PriceGuardForkTest is ForkBase {
    /// @dev Block 78,312,136 is Friday 2 October 2026 10:44:26 EDT.
    uint256 private constant IN_SESSION_TIMESTAMP = 1_790_952_266;
    /// @dev Sunday 27 September 2026 20:00 EDT: the reopen that started the session open at IN_SESSION_BLOCK.
    uint256 private constant WEEK_OPENED_AT = 1_790_553_600;
    /// @dev Block 73,280,794 is Saturday 26 September 2026 14:00 EDT.
    uint256 private constant WEEKEND_TIMESTAMP = 1_790_445_600;
    /// @dev Blocked in the registry at block 43,543 (tx 0x34ade022b651c60d33f167def1aaa7e3fe7fc27d3d2a13b447b89f182f953d8b)
    /// and never unblocked.
    address private constant BLOCKED_ACCOUNT = 0x19Aa5Fe80D33a56D56c78e82eA5E50E5d80b4Dff;
    /// @dev Holds the registry's BLOCKER_ROLE at IN_SESSION_BLOCK and sent the blockAccounts call that blocked
    /// BLOCKED_ACCOUNT.
    address private constant REGISTRY_BLOCKER = 0x913cA87347391218e5De2C17c5A0AEba8B0b28fD;
    uint256 private constant BUY = 100e6;
    uint16 private constant DEFAULT_CAP = 100;
    SessionCalendar.SessionType private constant ALL_DAY = SessionCalendar.SessionType.ALL_DAY;

    /// @param name Ticker and fee tier.
    /// @param premiumCeil docs/research/pools.md's premium of a 100 USDG buy at IN_SESSION_BLOCK, rounded up.
    /// @param price pools.md's execution price at IN_SESSION_BLOCK, USDG base units per whole token.
    struct Leg {
        string name;
        IStockToken token;
        IAggregatorV3 feed;
        address pool;
        int256 premiumCeil;
        uint256 price;
    }

    /// @notice A feed's latest round at the block, from chain-constants.md appendix B.
    struct Round {
        IAggregatorV3 feed;
        uint80 roundId;
        int256 answer;
        uint256 updatedAt;
    }

    PriceGuardHarness private guard;
    address private fresh = makeAddr("fresh account");

    // Block 78,312,136: a regular session

    function test_fork_inSession_decimalsRegistryRoundsAndCalendar() public {
        _forkAt(IN_SESSION_BLOCK);
        assertEq(block.timestamp, IN_SESSION_TIMESTAMP, "block time");
        assertEq(IERC20Metadata(Chain4663.USDG).decimals(), 6, "USDG decimals");
        Leg[5] memory legs = _legs();
        for (uint256 i; i < legs.length; ++i) {
            assertEq(legs[i].token.decimals(), 18, legs[i].name);
            assertEq(legs[i].feed.decimals(), 8, legs[i].name);
            assertEq(legs[i].token.ACCESS_CONTROLLED_REGISTRY(), LaunchConfig.REGISTRY, legs[i].name);
        }
        Round[5] memory rounds = _inSessionRounds();
        for (uint256 i; i < rounds.length; ++i) {
            assertEq(rounds[i].feed.decimals(), 8, "feed decimals");
            (uint80 roundId, int256 answer,, uint256 updatedAt,) = rounds[i].feed.latestRoundData();
            assertEq(roundId, rounds[i].roundId, "round id");
            assertEq(answer, rounds[i].answer, "answer");
            assertEq(updatedAt, rounds[i].updatedAt, "updatedAt");
        }
        (bool open, SessionCalendar.Reason reason) = SessionCalendar.isOpen(block.timestamp, ALL_DAY);
        assertTrue(open, "session open");
        assertEq(uint8(reason), uint8(SessionCalendar.Reason.OPEN));
        assertEq(SessionCalendar.sessionOpenedAt(block.timestamp, ALL_DAY), WEEK_OPENED_AT, "opened Sunday 20:00");
    }

    function test_fork_inSession_checkBuy_isClearForAFreshAccountOnEveryLaunchPool() public {
        _forkAt(IN_SESSION_BLOCK);
        (bool open,) = SessionCalendar.isOpen(block.timestamp, ALL_DAY);
        uint256 openedAt = SessionCalendar.sessionOpenedAt(block.timestamp, ALL_DAY);
        GuardParams memory params = guard.defaultGuardParams();
        (uint80 usdgRoundId, int256 usdgAnswer,,,) = IAggregatorV3(Chain4663.USDG_USD_FEED).latestRoundData();
        Leg[5] memory legs = _legs();
        for (uint256 i; i < legs.length; ++i) {
            PriceGuard.BuyCheck memory check = guard.checkBuy(
                legs[i].token,
                legs[i].feed,
                IAggregatorV3(Chain4663.USDG_USD_FEED),
                fresh,
                legs[i].pool,
                open,
                openedAt,
                params
            );
            assertFalse(check.accountBlocked, legs[i].name);
            assertEq(uint8(check.reason), uint8(Reason.NONE), legs[i].name);
            (uint80 roundId, int256 answer,, uint256 updatedAt,) = legs[i].feed.latestRoundData();
            assertEq(check.roundId, roundId, legs[i].name);
            assertEq(check.answer, answer, legs[i].name);
            assertEq(check.updatedAt, updatedAt, legs[i].name);
            assertGe(updatedAt, openedAt, "a round from this session");
            assertEq(check.usdgRoundId, usdgRoundId, legs[i].name);
            assertEq(check.usdgAnswer, usdgAnswer, legs[i].name);
        }
    }

    function test_fork_inSession_blockedAccount_signalsRefusedAccount() public {
        _forkAt(IN_SESSION_BLOCK);
        assertTrue(IAccessControlsRegistry(LaunchConfig.REGISTRY).isBlocked(BLOCKED_ACCOUNT), "blocked onchain");
        assertFalse(IAccessControlsRegistry(LaunchConfig.REGISTRY).isBlocked(fresh));
        Leg[5] memory legs = _legs();
        for (uint256 i; i < legs.length; ++i) {
            (bool accountBlocked, Reason reason) = guard.checkToken(legs[i].token, BLOCKED_ACCOUNT, legs[i].pool);
            assertTrue(accountBlocked, legs[i].name);
            assertEq(uint8(reason), uint8(Reason.NONE), legs[i].name);
        }
    }

    /// @dev The issuer's own blocker blocks the pool through the real registry, so the guard reads real state.
    function test_fork_inSession_blockedPool_reverts() public {
        _forkAt(IN_SESSION_BLOCK);
        _blockInTheRegistry(LaunchConfig.SPY_POOL_500);
        vm.expectRevert(abi.encodeWithSelector(PriceGuard.PoolBlocked.selector, LaunchConfig.SPY_POOL_500));
        guard.checkToken(IStockToken(Chain4663.SPY), fresh, LaunchConfig.SPY_POOL_500);
    }

    /// @dev Why a blocked pool reverts instead of queueing (D-011). The real token refuses any transfer that touches a
    /// blocked address with Blocked(address), the error MockStockToken copies, so the pool cannot pay out. The pool's
    /// TransferHelper reports that as "TF", the router passes it on, and nothing moves.
    function test_fork_inSession_blockedPool_realSwapReverts() public {
        _forkAt(IN_SESSION_BLOCK);
        _blockInTheRegistry(LaunchConfig.SPY_POOL_500);
        IERC20 usdg = IERC20(Chain4663.USDG);
        IERC20 spy = IERC20(Chain4663.SPY);
        address trader = makeAddr("trader");
        assertGt(spy.balanceOf(LaunchConfig.SPY_POOL_500), 0, "the pool holds SPY");
        vm.prank(LaunchConfig.SPY_POOL_500);
        (bool sent, bytes memory reverted) = address(spy).call(abi.encodeCall(IERC20.transfer, (trader, 1)));
        assertFalse(sent, "the token refuses a transfer out of the blocked pool");
        assertEq(reverted, abi.encodeWithSelector(MockStockToken.Blocked.selector, LaunchConfig.SPY_POOL_500));

        uint24 fee = IUniswapV3Pool(LaunchConfig.SPY_POOL_500).fee();
        deal(address(usdg), trader, BUY);
        vm.startPrank(trader);
        usdg.approve(Chain4663.SWAP_ROUTER_02, BUY);
        vm.expectRevert(bytes("TF"));
        ISwapRouter02(Chain4663.SWAP_ROUTER_02)
            .exactInputSingle(
                ISwapRouter02.ExactInputSingleParams({
                tokenIn: address(usdg),
                tokenOut: address(spy),
                fee: fee,
                recipient: trader,
                amountIn: BUY,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
            );
        usdg.approve(Chain4663.SWAP_ROUTER_02, 0);
        vm.stopPrank();
        assertEq(usdg.balanceOf(trader), BUY, "no USDG left the trader");
        assertEq(spy.balanceOf(trader), 0, "no SPY arrived");
    }

    /// @dev The USDG/USD feed is 23.09 hours old at this block, so a 23-hour limit would queue every buy (research
    /// note 7.6) while D-014's 25 hours does not.
    function test_fork_inSession_usdgRoundIs23HoursOld() public {
        _forkAt(IN_SESSION_BLOCK);
        IAggregatorV3 usdgFeed = IAggregatorV3(Chain4663.USDG_USD_FEED);
        (Reason reason, uint80 roundId, int256 answer) = guard.checkUsdg(usdgFeed, 50, 25 hours);
        assertEq(uint8(reason), uint8(Reason.NONE));
        assertEq(roundId, 18_446_744_073_709_551_735);
        assertEq(answer, 100_001_038);
        (reason,,) = guard.checkUsdg(usdgFeed, 50, 23 hours);
        assertEq(uint8(reason), uint8(Reason.DEPEG));
    }

    /// @dev A real 100 USDG buy through SwapRouter02 on each allowlisted pool, measured by balance, then the premium
    /// computed by PriceGuard and again here with plain uint256 arithmetic, and compared with pools.md.
    function test_fork_inSession_swap100Usdg_premiumMatchesIndependentMath() public {
        _forkAt(IN_SESSION_BLOCK);
        uint8 usdgDecimals = IERC20Metadata(Chain4663.USDG).decimals();
        assertEq(usdgDecimals, 6);
        Leg[5] memory legs = _legs();
        for (uint256 i; i < legs.length; ++i) {
            Leg memory leg = legs[i];
            (uint256 usdgSpent, uint256 tokensOut) = _buy(leg);
            (, int256 answer,,,) = leg.feed.latestRoundData();
            uint8 tokenDecimals = leg.token.decimals();
            uint8 feedDecimals = leg.feed.decimals();

            bool exceeds = guard.exceedsPremium(
                usdgSpent, tokensOut, answer, DEFAULT_CAP, usdgDecimals, tokenDecimals, feedDecimals
            );
            int256 premium = guard.premiumBps(usdgSpent, tokensOut, answer, usdgDecimals, tokenDecimals, feedDecimals);
            uint256 price = guard.execPriceBuy(usdgSpent, tokensOut);

            uint256 paid = usdgSpent * 10 ** (tokenDecimals + feedDecimals - usdgDecimals) * 10_000;
            uint256 value = tokensOut * uint256(answer);
            assertEq(exceeds, paid > value * (10_000 + DEFAULT_CAP), leg.name);
            assertEq(premium, int256((paid + value - 1) / value) - 10_000, leg.name);
            assertEq(price, (usdgSpent * 1e18 + tokensOut - 1) / tokensOut, leg.name);

            assertEq(premium, leg.premiumCeil, string.concat(leg.name, ": pools.md premium, rounded up"));
            assertApproxEqAbs(price, leg.price, 100, string.concat(leg.name, ": pools.md execution price"));
            assertFalse(exceeds, string.concat(leg.name, ": inside the 100 bps default cap"));
        }
    }

    // Block 73,280,794: the weekend closure

    function test_fork_weekend_calendarClosed_spyAndQqqFeedsStale() public {
        _forkAt(WEEKEND_BLOCK);
        assertEq(block.timestamp, WEEKEND_TIMESTAMP, "block time");
        (bool open, SessionCalendar.Reason reason) = SessionCalendar.isOpen(block.timestamp, ALL_DAY);
        assertFalse(open, "calendar closed");
        assertEq(uint8(reason), uint8(SessionCalendar.Reason.WEEKEND));
        _assertWeekendFeed(Chain4663.SPY_FEED, 1_790_352_180, Reason.STALE);
        _assertWeekendFeed(Chain4663.QQQ_FEED, 1_790_352_215, Reason.STALE);
    }

    /// @dev Why the calendar exists: two feeds are still inside the 25-hour limit on a Saturday afternoon, so feed age
    /// alone would let a buy through while the market is closed.
    function test_fork_weekend_nvdaAndAaplFeedsUnder25Hours_ageCannotDetectTheClosure() public {
        _forkAt(WEEKEND_BLOCK);
        _assertWeekendFeed(Chain4663.NVDA_FEED, 1_790_366_165, Reason.NONE);
        _assertWeekendFeed(Chain4663.AAPL_FEED, 1_790_365_765, Reason.NONE);
    }

    function test_fork_weekend_checkBuyQueuesForTheSession_onEveryLaunchPool() public {
        _forkAt(WEEKEND_BLOCK);
        (bool open,) = SessionCalendar.isOpen(block.timestamp, ALL_DAY);
        assertFalse(open);
        Leg[5] memory legs = _legs();
        for (uint256 i; i < legs.length; ++i) {
            PriceGuard.BuyCheck memory check = guard.checkBuy(
                legs[i].token,
                legs[i].feed,
                IAggregatorV3(Chain4663.USDG_USD_FEED),
                fresh,
                legs[i].pool,
                open,
                0,
                guard.defaultGuardParams()
            );
            assertFalse(check.accountBlocked, legs[i].name);
            assertEq(uint8(check.reason), uint8(Reason.SESSION), legs[i].name);
        }
    }

    // Helpers

    function _forkAt(uint256 blockNumber) private {
        _fork(blockNumber);
        guard = new PriceGuardHarness();
    }

    function _buy(Leg memory leg) private returns (uint256 usdgSpent, uint256 tokensOut) {
        IERC20 usdg = IERC20(Chain4663.USDG);
        IERC20 token = IERC20(address(leg.token));
        IUniswapV3Pool pool = IUniswapV3Pool(leg.pool);
        assertTrue(
            (pool.token0() == address(usdg) && pool.token1() == address(token))
                || (pool.token0() == address(token) && pool.token1() == address(usdg)),
            string.concat(leg.name, ": pool pairs USDG with the token")
        );
        uint24 fee = pool.fee();
        address trader = makeAddr(string.concat("trader ", leg.name));
        deal(address(usdg), trader, BUY);
        (uint256 quoted,,,) = IQuoterV2(Chain4663.QUOTER_V2)
            .quoteExactInputSingle(
                IQuoterV2.QuoteExactInputSingleParams({
                tokenIn: address(usdg), tokenOut: address(token), amountIn: BUY, fee: fee, sqrtPriceLimitX96: 0
            })
            );
        uint256 usdgBefore = usdg.balanceOf(trader);
        uint256 tokensBefore = token.balanceOf(trader);
        vm.startPrank(trader);
        usdg.approve(Chain4663.SWAP_ROUTER_02, BUY);
        uint256 returned = ISwapRouter02(Chain4663.SWAP_ROUTER_02)
            .exactInputSingle(
                ISwapRouter02.ExactInputSingleParams({
                tokenIn: address(usdg),
                tokenOut: address(token),
                fee: fee,
                recipient: trader,
                amountIn: BUY,
                amountOutMinimum: quoted,
                sqrtPriceLimitX96: 0
            })
            );
        usdg.approve(Chain4663.SWAP_ROUTER_02, 0);
        vm.stopPrank();
        usdgSpent = usdgBefore - usdg.balanceOf(trader);
        tokensOut = token.balanceOf(trader) - tokensBefore;
        assertEq(usdgSpent, BUY, string.concat(leg.name, ": the whole amount filled"));
        assertEq(tokensOut, quoted, string.concat(leg.name, ": QuoterV2 quoted the fill"));
        assertEq(tokensOut, returned, string.concat(leg.name, ": the router's return equals the balance delta"));
        assertEq(usdg.allowance(trader, Chain4663.SWAP_ROUTER_02), 0, "approval reset");
    }

    function _blockInTheRegistry(address account) private {
        IAccessControlsRegistry registry = IAccessControlsRegistry(LaunchConfig.REGISTRY);
        assertTrue(
            IAccessControl(LaunchConfig.REGISTRY).hasRole(keccak256("BLOCKER_ROLE"), REGISTRY_BLOCKER), "blocker role"
        );
        assertFalse(registry.isBlocked(account), "not blocked at the pinned block");
        address[] memory accounts = new address[](1);
        accounts[0] = account;
        vm.prank(REGISTRY_BLOCKER);
        IRegistryBlocker(LaunchConfig.REGISTRY).blockAccounts(accounts);
        assertTrue(registry.isBlocked(account), "blocked through the real registry");
    }

    function _assertWeekendFeed(address feed, uint256 expectedUpdatedAt, Reason expected) private view {
        (Reason reason,,, uint256 updatedAt) = guard.readStockFeed(IAggregatorV3(feed), 25 hours, 0);
        assertEq(updatedAt, expectedUpdatedAt, "chain-constants.md B.4 updatedAt");
        assertEq(uint8(reason), uint8(expected), "verdict on age alone");
        if (expected == Reason.STALE) assertGt(block.timestamp - updatedAt, 25 hours);
        else assertLe(block.timestamp - updatedAt, 25 hours);
    }

    function _legs() private pure returns (Leg[5] memory legs) {
        legs[0] = Leg(
            "SPY fee 500",
            IStockToken(Chain4663.SPY),
            IAggregatorV3(Chain4663.SPY_FEED),
            LaunchConfig.SPY_POOL_500,
            36,
            773_463_200
        );
        legs[1] = Leg(
            "QQQ fee 500",
            IStockToken(Chain4663.QQQ),
            IAggregatorV3(Chain4663.QQQ_FEED),
            LaunchConfig.QQQ_POOL_500,
            31,
            754_327_700
        );
        legs[2] = Leg(
            "NVDA fee 500",
            IStockToken(Chain4663.NVDA),
            IAggregatorV3(Chain4663.NVDA_FEED),
            LaunchConfig.NVDA_POOL_500,
            -17,
            237_149_300
        );
        legs[3] = Leg(
            "AAPL fee 500",
            IStockToken(Chain4663.AAPL),
            IAggregatorV3(Chain4663.AAPL_FEED),
            LaunchConfig.AAPL_POOL_500,
            14,
            334_331_000
        );
        legs[4] = Leg(
            "AAPL fee 3000",
            IStockToken(Chain4663.AAPL),
            IAggregatorV3(Chain4663.AAPL_FEED),
            LaunchConfig.AAPL_POOL_3000,
            20,
            334_523_200
        );
    }

    function _inSessionRounds() private pure returns (Round[5] memory rounds) {
        rounds[0] = Round(IAggregatorV3(Chain4663.SPY_FEED), 18_446_744_073_709_551_770, 77_071_210_575, 1_790_944_238);
        rounds[1] = Round(IAggregatorV3(Chain4663.QQQ_FEED), 18_446_744_073_709_552_017, 75_199_912_534, 1_790_945_832);
        rounds[2] = Round(IAggregatorV3(Chain4663.NVDA_FEED), 18_446_744_073_709_552_774, 23_755_399_953, 1_790_948_711);
        rounds[3] = Round(IAggregatorV3(Chain4663.AAPL_FEED), 18_446_744_073_709_552_314, 33_388_329_774, 1_790_950_147);
        rounds[4] =
            Round(IAggregatorV3(Chain4663.USDG_USD_FEED), 18_446_744_073_709_551_735, 100_001_038, 1_790_869_148);
    }
}
