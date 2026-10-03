// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {CommonBase} from "forge-std/Base.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SessionCalendarExtension} from "../../../src/SessionCalendarExtension.sol";
import {SleeveModule} from "../../../src/SleeveModule.sol";
import {TokenSource} from "../../../src/TokenSource.sol";
import {SessionCalendar} from "../../../src/libraries/SessionCalendar.sol";
import {InvPool} from "../../mocks/InvPool.sol";
import {InvRelay} from "../../mocks/InvRelay.sol";
import {InvRouter} from "../../mocks/InvRouter.sol";
import {MockAccount} from "../../mocks/MockAccount.sol";
import {MockERC20} from "../../mocks/MockERC20.sol";
import {MockFeed} from "../../mocks/MockFeed.sol";
import {MockRegistry} from "../../mocks/MockRegistry.sol";
import {MockStockToken} from "../../mocks/MockStockToken.sol";
import {UsdgPayer} from "../../mocks/UsdgPayer.sol";

/// @notice Everything the invariant suite deploys, handed to the handler.
/// @param pools Every venue, allowlisted or not. poolTicker gives each one's ticker id.
/// @param admin The timelock address of TokenSource and the calendar. The suite calls as it directly, without the
/// 48-hour wait, which the I10 fork tests cover.
struct InvDeployment {
    SleeveModule module;
    MockERC20 usdg;
    MockStockToken[4] tokens;
    MockFeed[3] feeds;
    MockFeed usdgFeed;
    MockRegistry registry;
    TokenSource tokenSource;
    SessionCalendarExtension calendar;
    InvRouter router;
    InvPool[] pools;
    uint8[] poolTicker;
    address admin;
    address defaultKeeper;
}

/// @notice The deployed system, the actors and the reads the model and the handler share.
/// @dev Tickers: 0 SPY on ALL_DAY, 1 QQQ on REGULAR, 2 NVDA on ALL_DAY, all with feeds, and 3 with no feed and no
/// session, which no rule can name. Accounts are MockAccount, owned by the handler, which stands in for the owner's
/// root key: Kernel-like executor install and uninstall, owner batches through execute, and executeFromExecutor for
/// the module.
abstract contract SleeveWorld is CommonBase {
    uint256 internal constant ACCOUNTS = 3;
    uint256 internal constant TICKERS = 4;
    uint8 internal constant NO_FEED = 3;
    uint256 internal constant ASSETS = 5;
    uint256 internal constant GRACE = 3_600;
    /// @dev SleeveTrade.OBSERVE_RESTART_GROWTH: unsorted growth below 1 USDG neither restarts the public clock nor
    /// leaves the amount uncovered (audit A1 MEDIUM).
    uint256 internal constant OBSERVE_RESTART_GROWTH = 1e6;
    uint256 internal constant MAX_AGE = 25 hours;
    uint256 internal constant MULTIPLIER_WINDOW = 24 hours;
    uint256 internal constant DEPEG_BPS = 50;
    uint256 internal constant BPS = 10_000;
    uint256 internal constant QUOTE_UNIT = 1e6;
    /// @dev A sell's quote unit: USDG base units per this many token base units (D-009 Q21).
    uint256 internal constant SELL_QUOTE_UNIT = 1e18;
    /// @dev 10^(18 + 8 - 6) * 10,000: USDG base units on the scale of token base units times a feed answer, in bps.
    uint256 internal constant PREMIUM_SCALE = 1e24;
    uint16 internal constant MAX_CAP_BPS = 500;
    /// @dev SleeveSell.MAX_LOTS_PER_CALL: the most lots one sell takes from or one lot reconcile trims (audit A1-13).
    uint256 internal constant MAX_LOTS_PER_CALL = 100;
    uint128 internal constant MIN_CLIP_FLOOR = 1e6;
    /// @dev D-014 disclosure candidate 3.
    bytes32 internal constant DISCLOSURE_HASH = 0x8408c7a59df30d1b5dbec102c388048f2bf8bba21a2e91ac0806df7d68068e89;

    SleeveModule internal module;
    MockERC20 internal usdg;
    MockStockToken[4] internal tokens;
    MockFeed[3] internal feeds;
    MockFeed internal usdgFeed;
    MockRegistry internal registry;
    TokenSource internal tokenSource;
    SessionCalendarExtension internal calendar;
    InvRouter internal router;
    InvPool[] internal pools;
    mapping(address pool => uint8 tickerId) internal poolTicker;
    address internal admin;
    address internal defaultKeeper;

    MockAccount[3] internal accounts;
    address internal keeper2;
    address internal stranger;
    address internal payer;
    address internal puller;
    address internal sink;
    address internal tokenSink;
    UsdgPayer internal wallet;
    InvRelay internal relay;

    /// @dev Every address whose balances the suite tracks around a call, and its index plus one.
    address[] internal holders;
    mapping(address holder => uint256 indexPlusOne) internal holderIndex;

    constructor(InvDeployment memory d) {
        module = d.module;
        usdg = d.usdg;
        tokens = d.tokens;
        feeds = d.feeds;
        usdgFeed = d.usdgFeed;
        registry = d.registry;
        tokenSource = d.tokenSource;
        calendar = d.calendar;
        router = d.router;
        admin = d.admin;
        defaultKeeper = d.defaultKeeper;
        for (uint256 i; i < d.pools.length; ++i) {
            pools.push(d.pools[i]);
            poolTicker[address(d.pools[i])] = d.poolTicker[i];
        }
        keeper2 = vm.addr(0xBEEF02);
        stranger = vm.addr(0xBEEF03);
        payer = vm.addr(0xBEEF04);
        puller = vm.addr(0xBEEF05);
        sink = vm.addr(0xBEEF06);
        tokenSink = vm.addr(0xBEEF07);
        wallet = new UsdgPayer(IERC20(address(usdg)));
        relay = new InvRelay();
        for (uint256 i; i < ACCOUNTS; ++i) {
            accounts[i] = new MockAccount();
            _track(address(accounts[i]));
        }
        _track(address(module));
        _track(address(router));
        for (uint256 i; i < pools.length; ++i) {
            _track(address(pools[i]));
        }
        _track(address(wallet));
        _track(sink);
        _track(puller);
        _track(tokenSink);
        _track(payer);
    }

    // Picks

    function _account(uint256 seed) internal view returns (address) {
        return address(accounts[seed % ACCOUNTS]);
    }

    function _accountIndex(address account) internal view returns (uint256) {
        for (uint256 i; i < ACCOUNTS; ++i) {
            if (address(accounts[i]) == account) return i;
        }
        return type(uint256).max;
    }

    /// @dev seed mod (hi - lo + 1), from lo. No logging, unlike StdUtils.bound.
    function _pick(uint256 seed, uint256 lo, uint256 hi) internal pure returns (uint256) {
        if (hi <= lo) return lo;
        return lo + seed % (hi - lo + 1);
    }

    /// @dev A second independent value from one fuzzed seed.
    function _mix(uint256 seed, uint256 salt) internal pure returns (uint256) {
        return uint256(keccak256(abi.encode(seed, salt)));
    }

    // Reads

    function _ticker(uint8 tickerId)
        internal
        view
        returns (address token, address feed, SessionCalendar.SessionType sessionType, bool active)
    {
        return tokenSource.ticker(tickerId);
    }

    function _tokenOf(uint8 tickerId) internal view returns (address token) {
        (token,,,) = tokenSource.ticker(tickerId);
    }

    /// @dev The pools of a ticker that the suite deployed, allowlisted or not.
    function _poolsOfTicker(uint8 tickerId) internal view returns (address[] memory found) {
        uint256 count;
        for (uint256 i; i < pools.length; ++i) {
            if (poolTicker[address(pools[i])] == tickerId) ++count;
        }
        found = new address[](count);
        count = 0;
        for (uint256 i; i < pools.length; ++i) {
            if (poolTicker[address(pools[i])] == tickerId) found[count++] = address(pools[i]);
        }
    }

    function _isPool(address candidate) internal view returns (bool) {
        for (uint256 i; i < pools.length; ++i) {
            if (address(pools[i]) == candidate) return true;
        }
        return false;
    }

    // Balance sheets

    function _track(address holder) private {
        holders.push(holder);
        holderIndex[holder] = holders.length;
    }

    function _asset(uint256 index) internal view returns (IERC20) {
        return index == 0 ? IERC20(address(usdg)) : IERC20(address(tokens[index - 1]));
    }

    /// @dev Asset index of a stock token: 1 to 4.
    function _assetOf(address token) internal view returns (uint256) {
        for (uint256 i; i < TICKERS; ++i) {
            if (address(tokens[i]) == token) return i + 1;
        }
        return type(uint256).max;
    }

    /// @dev Every tracked holder's balance of USDG and each stock token, holder-major.
    function _balances() internal view returns (uint256[] memory sheet) {
        sheet = new uint256[](holders.length * ASSETS);
        for (uint256 h; h < holders.length; ++h) {
            for (uint256 a; a < ASSETS; ++a) {
                sheet[h * ASSETS + a] = _asset(a).balanceOf(holders[h]);
            }
        }
    }

    function _slot(address holder, uint256 asset) internal view returns (uint256) {
        uint256 indexPlusOne = holderIndex[holder];
        require(indexPlusOne != 0, "untracked holder");
        return (indexPlusOne - 1) * ASSETS + asset;
    }
}
