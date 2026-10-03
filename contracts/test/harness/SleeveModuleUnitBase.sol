// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {MODULE_TYPE_EXECUTOR} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {SessionCalendarExtension} from "../../src/SessionCalendarExtension.sol";
import {SleeveModule} from "../../src/SleeveModule.sol";
import {TokenSource} from "../../src/TokenSource.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {ISwapRouter02} from "../../src/interfaces/ISwapRouter02.sol";
import {PriceGuard} from "../../src/libraries/PriceGuard.sol";
import {SessionCalendar} from "../../src/libraries/SessionCalendar.sol";
import {MockAccount} from "../mocks/MockAccount.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockFeed} from "../mocks/MockFeed.sol";
import {MockRegistry} from "../mocks/MockRegistry.sol";
import {MockStockToken} from "../mocks/MockStockToken.sol";
import {MockSwapRouter} from "../mocks/MockSwapRouter.sol";
import {MockV3Factory} from "../mocks/MockV3Factory.sol";
import {UsdgPayer} from "../mocks/UsdgPayer.sol";
import {Chain4663} from "../utils/Chain4663.sol";
import {ArbSysMock} from "../utils/ForkBase.sol";
import {SleeveModuleHarness} from "./SleeveModuleHarness.sol";

/// @notice Mock deployment for the module's unit tests, with no fork: a 6-decimal USDG, the real TokenSource and
/// SessionCalendarExtension over mock tokens, feeds and pools, a MockSwapRouter on the mock factory, the ArbSys mock at
/// 0x64, and MockAccount accounts. TokenSource lists SPY, QQQ and NVDA with feeds and ALL_DAY, REGULAR and ALL_DAY
/// sessions, and a fourth token with no feed. The test contract is the timelock of both, so it can remove a ticker
/// directly, and it answers the two SleeveTimelock views the module's constructor reads from that admin (audit A1-26).
abstract contract SleeveModuleUnitBase is Test {
    /// @notice SleeveTimelock's floor, as the module's constructor reads it from the admin.
    uint256 public constant MIN_DELAY_FLOOR = 172_800;

    /// @dev Friday 2 October 2026 10:44:26 EDT, the time of fork block 78,312,136.
    uint256 internal constant NOW = 1_790_952_266;
    /// @dev D-014 disclosure candidate 3.
    bytes32 internal constant DISCLOSURE_HASH = 0x8408c7a59df30d1b5dbec102c388048f2bf8bba21a2e91ac0806df7d68068e89;
    uint256 internal constant GRACE = 3_600;
    uint8 internal constant SPY = 0;
    uint8 internal constant QQQ = 1;
    uint8 internal constant NVDA = 2;
    uint8 internal constant NO_FEED = 3;
    uint256 internal constant TICKER_COUNT = 4;
    /// @dev What the payer holds: enough for any fuzzed inflow.
    uint256 internal constant PAYER_FUNDS = 1 << 120;
    /// @dev Sunday 27 September 2026 20:00 EDT, when the ALL_DAY session open at NOW began.
    uint256 internal constant WEEK_OPENED_AT = 1_790_553_600;
    /// @dev Feed answers set by _setMarket: 500 USD per token, and USDG at 1.
    int256 internal constant FEED_ANSWER = 500e8;
    int256 internal constant USDG_ANSWER = 1e8;
    /// @dev The router's price at _setMarket, 2,000,000,000,000,000 token base units per USDG: exactly the feed
    /// price, so a fill's premium is zero.
    uint256 internal constant FAIR_PRICE = 2e15;

    MockERC20 internal usdg;
    MockFeed internal usdgUsdFeed;
    MockRegistry internal registry;
    MockV3Factory internal factory;
    MockStockToken[4] internal tokens;
    MockFeed[3] internal feeds;
    TokenSource internal tokenSource;
    SessionCalendarExtension internal calendar;
    MockSwapRouter internal router;
    address internal swapRouter;
    address internal keeper = makeAddr("keeper");
    address internal sink = makeAddr("sink");
    UsdgPayer internal payer;

    /// @notice SleeveTimelock's view: the delay in force, here the floor.
    function getMinDelay() external pure returns (uint256) {
        return MIN_DELAY_FLOOR;
    }

    function _setUpMocks() internal {
        vm.warp(NOW);
        vm.etch(Chain4663.ARB_SYS, address(new ArbSysMock()).code);
        usdg = new MockERC20("Global Dollar", "USDG", 6);
        usdgUsdFeed = new MockFeed(8, "USDG / USD");
        registry = new MockRegistry();
        factory = new MockV3Factory();
        string[4] memory symbols = ["SPY", "QQQ", "NVDA", "NOFEED"];
        SessionCalendar.SessionType[4] memory sessions = [
            SessionCalendar.SessionType.ALL_DAY,
            SessionCalendar.SessionType.REGULAR,
            SessionCalendar.SessionType.ALL_DAY,
            SessionCalendar.SessionType.NONE
        ];
        TokenSource.TickerInit[] memory tickers = new TokenSource.TickerInit[](TICKER_COUNT);
        for (uint256 i; i < TICKER_COUNT; ++i) {
            tokens[i] = new MockStockToken(symbols[i], symbols[i], address(registry));
            address[] memory pools = new address[](1);
            pools[0] = factory.createPool(address(usdg), address(tokens[i]), 500);
            address feed;
            if (i != NO_FEED) {
                feeds[i] = new MockFeed(8, symbols[i]);
                feed = address(feeds[i]);
            }
            tickers[i] =
                TokenSource.TickerInit({token: address(tokens[i]), feed: feed, sessionType: sessions[i], pools: pools});
        }
        tokenSource = new TokenSource(address(this), address(usdg), address(factory), tickers);
        calendar = new SessionCalendarExtension(address(this));
        router = new MockSwapRouter(address(factory), FAIR_PRICE);
        swapRouter = address(router);
        payer = new UsdgPayer(usdg);
        usdg.mint(address(payer), PAYER_FUNDS);
    }

    function _config() internal view returns (ISleeveModule.ModuleConfig memory) {
        return ISleeveModule.ModuleConfig({
            usdg: IERC20(address(usdg)),
            tokenSource: tokenSource,
            calendar: calendar,
            swapRouter: ISwapRouter02(swapRouter),
            usdgUsdFeed: IAggregatorV3(address(usdgUsdFeed)),
            defaultKeeper: keeper,
            disclosureHash: DISCLOSURE_HASH,
            guardParams: PriceGuard.defaultGuardParams(),
            grace: GRACE
        });
    }

    function _deployModule() internal returns (SleeveModule) {
        return new SleeveModule(_config());
    }

    function _deployHarness() internal returns (SleeveModuleHarness) {
        return new SleeveModuleHarness(_config());
    }

    /// @notice The product default: 10 percent to SPY, 100 bps premium cap, 50 bps slippage, 25 USDG clip.
    function _defaultRule() internal pure returns (ISleeveModule.RuleInput memory) {
        return ISleeveModule.RuleInput({
            spendBps: 9_000, equityBps: 1_000, tickerId: SPY, premiumCapBps: 100, slippageBps: 50, minClip: 25e6
        });
    }

    function _installData(address accountKeeper, ISleeveModule.RuleInput memory rule)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(accountKeeper, rule);
    }

    /// @notice A fresh account holding `balance` USDG, with the module installed from `data`.
    function _accountWith(address module, uint256 balance, bytes memory data) internal returns (MockAccount account) {
        account = new MockAccount();
        if (balance != 0) usdg.mint(address(account), balance);
        account.installModule(MODULE_TYPE_EXECUTOR, module, data);
    }

    /// @notice Runs an owner op the way a UserOp's callData reaches the account, bubbling any revert.
    function _ownerOp(MockAccount account, bytes memory callData) internal {
        Address.functionCall(address(account), callData);
    }

    /// @notice A third-party payment: income the next split would sort.
    function _pay(address account, uint256 amount) internal {
        payer.pay(account, amount);
    }

    /// @notice A clear market at NOW: a fresh round on every stock feed and on the USDG/USD feed, ten minutes old,
    /// after both the ALL_DAY and the REGULAR session opened.
    function _setMarket() internal {
        for (uint256 i; i < feeds.length; ++i) {
            feeds[i].setRound(1, FEED_ANSWER, block.timestamp - 10 minutes);
        }
        usdgUsdFeed.setRound(1, USDG_ANSWER, block.timestamp - 10 minutes);
    }

    /// @notice The router's output for amountIn as a quote in token base units per 1e6 USDG base units.
    function _quote(uint256 amountIn) internal view returns (uint256) {
        return router.quote(amountIn) * 1e6 / amountIn;
    }

    /// @notice The pool TokenSource allowlists for a ticker.
    function _pool(uint8 tickerId) internal view returns (address) {
        return tokenSource.poolsOf(tickerId)[0];
    }
}
