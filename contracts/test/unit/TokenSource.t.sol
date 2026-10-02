// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {StdInvariant} from "forge-std/StdInvariant.sol";
import {Test} from "forge-std/Test.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {SleeveTimelock} from "../../src/SleeveTimelock.sol";
import {TokenSource} from "../../src/TokenSource.sol";
import {SessionCalendar} from "../../src/libraries/SessionCalendar.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockFeed} from "../mocks/MockFeed.sol";
import {MockRegistry} from "../mocks/MockRegistry.sol";
import {MockStockToken} from "../mocks/MockStockToken.sol";
import {MockV3Factory} from "../mocks/MockV3Factory.sol";
import {MockV3Pool} from "../mocks/MockV3Pool.sol";
import {TimelockScheduler} from "../mocks/TimelockScheduler.sol";

/// @notice A contract whose fee() returns a value no v3 pool can have.
contract OversizedFeePool {
    function fee() external pure returns (uint256) {
        return 2 ** 24;
    }
}

/// @notice All the constructor asks of a ticker without a feed or pools: code that reports 18 decimals.
contract DecimalsOnlyToken {
    function decimals() external pure returns (uint8) {
        return 18;
    }
}

/// @notice Shared mock deployment: USDG, two stock tokens with feeds, a v3 factory with canonical pools, the timelock.
abstract contract TokenSourceFixture is TimelockScheduler {
    SessionCalendar.SessionType internal constant ALL_DAY = SessionCalendar.SessionType.ALL_DAY;
    SessionCalendar.SessionType internal constant REGULAR = SessionCalendar.SessionType.REGULAR;
    SessionCalendar.SessionType internal constant NONE = SessionCalendar.SessionType.NONE;

    MockERC20 internal usdg;
    MockRegistry internal registry;
    MockStockToken internal spy;
    MockStockToken internal qqq;
    MockFeed internal spyFeed;
    MockFeed internal qqqFeed;
    MockV3Factory internal factory;
    address internal spyPool500;
    address internal spyPool3000;
    address internal spyPool100;
    address internal spyPool10000;
    address internal qqqPool500;
    TokenSource internal source;

    function _deployMocks() internal {
        _deployTimelock();
        _deployMockTokens();
    }

    function _deployMockTokens() internal {
        usdg = new MockERC20("Global Dollar", "USDG", 6);
        registry = new MockRegistry();
        spy = new MockStockToken("SPDR S&P 500 ETF Trust", "SPY", address(registry));
        qqq = new MockStockToken("Invesco QQQ", "QQQ", address(registry));
        spyFeed = new MockFeed(8, "RHSPY / USD");
        qqqFeed = new MockFeed(8, "Robinhood QQQ / USD");
        factory = new MockV3Factory();
        spyPool500 = factory.createPool(address(usdg), address(spy), 500);
        spyPool3000 = factory.createPool(address(spy), address(usdg), 3000);
        spyPool100 = factory.createPool(address(usdg), address(spy), 100);
        spyPool10000 = factory.createPool(address(usdg), address(spy), 10_000);
        qqqPool500 = factory.createPool(address(usdg), address(qqq), 500);
    }

    function _launchTickers() internal view returns (TokenSource.TickerInit[] memory tickers) {
        tickers = new TokenSource.TickerInit[](2);
        tickers[0] = _init(address(spy), address(spyFeed), ALL_DAY, _pools(spyPool500));
        tickers[1] = _init(address(qqq), address(qqqFeed), ALL_DAY, _pools(qqqPool500));
    }

    function _deploy(TokenSource.TickerInit[] memory tickers) internal returns (TokenSource) {
        return new TokenSource(address(timelock), address(usdg), address(factory), tickers);
    }

    function _init(address token, address feed, SessionCalendar.SessionType sessionType, address[] memory pools)
        internal
        pure
        returns (TokenSource.TickerInit memory)
    {
        return TokenSource.TickerInit({token: token, feed: feed, sessionType: sessionType, pools: pools});
    }

    function _pools(address pool) internal pure returns (address[] memory pools) {
        pools = new address[](1);
        pools[0] = pool;
    }

    function _pools(address first, address second) internal pure returns (address[] memory pools) {
        pools = new address[](2);
        pools[0] = first;
        pools[1] = second;
    }
}

/// @notice TokenSource against mocks: every constructor check, the two timelocked writes, the views, and I10.
contract TokenSourceTest is TokenSourceFixture {
    uint8 private constant PUSH1 = 0x60;
    uint8 private constant PUSH32 = 0x7f;
    uint8 private constant CREATE = 0xf0;
    uint8 private constant CALL = 0xf1;
    uint8 private constant CALLCODE = 0xf2;
    uint8 private constant DELEGATECALL = 0xf4;
    uint8 private constant CREATE2 = 0xf5;
    uint8 private constant STATICCALL = 0xfa;
    uint8 private constant SELFDESTRUCT = 0xff;

    function setUp() public {
        _deployMocks();
        source = _deploy(_launchTickers());
    }

    // Constructor

    function test_constructor_listsTheLaunchTickers() public view {
        assertEq(source.timelock(), address(timelock));
        assertEq(source.usdg(), address(usdg));
        assertEq(source.v3Factory(), address(factory));
        assertEq(source.tickerCount(), 2);
        (address token, address feed, SessionCalendar.SessionType sessionType, bool active) = source.ticker(0);
        assertEq(token, address(spy));
        assertEq(feed, address(spyFeed));
        assertEq(uint8(sessionType), uint8(ALL_DAY));
        assertTrue(active);
        (token, feed, sessionType, active) = source.ticker(1);
        assertEq(token, address(qqq));
        assertEq(feed, address(qqqFeed));
        assertTrue(active);
        assertTrue(source.isPoolAllowed(0, spyPool500));
        assertTrue(source.isPoolAllowed(1, qqqPool500));
        assertFalse(source.isPoolAllowed(0, qqqPool500), "a pool is allowed per ticker");
        assertEq(source.poolsOf(0), _pools(spyPool500));
        assertEq(source.idOf(address(spy)), 0);
        assertEq(source.idOf(address(qqq)), 1);
    }

    function test_constructor_emitsAnEventPerTickerAndPool() public {
        vm.expectEmit(true, true, false, true);
        emit TokenSource.TickerListed(0, address(spy), address(spyFeed), ALL_DAY);
        vm.expectEmit(true, true, false, true);
        emit TokenSource.PoolSet(0, spyPool500, 500, true);
        vm.expectEmit(true, true, false, true);
        emit TokenSource.TickerListed(1, address(qqq), address(qqqFeed), ALL_DAY);
        vm.expectEmit(true, true, false, true);
        emit TokenSource.PoolSet(1, qqqPool500, 500, true);
        _deploy(_launchTickers());
    }

    function test_constructor_acceptsFeeTiers100_500_3000() public {
        TokenSource.TickerInit[] memory tickers = new TokenSource.TickerInit[](1);
        address[] memory pools = new address[](3);
        pools[0] = spyPool100;
        pools[1] = spyPool500;
        pools[2] = spyPool3000;
        tickers[0] = _init(address(spy), address(spyFeed), REGULAR, pools);
        TokenSource deployed = _deploy(tickers);
        assertEq(deployed.poolsOf(0), pools);
    }

    function test_constructor_tickerWithoutAFeed_hasNoSession() public {
        TokenSource.TickerInit[] memory tickers = new TokenSource.TickerInit[](1);
        tickers[0] = _init(address(spy), address(0), NONE, new address[](0));
        TokenSource deployed = _deploy(tickers);
        (, address feed, SessionCalendar.SessionType sessionType, bool active) = deployed.ticker(0);
        assertEq(feed, address(0));
        assertEq(uint8(sessionType), uint8(NONE));
        assertTrue(active);
    }

    function test_constructor_timelockWithoutCode_reverts() public {
        address eoa = makeAddr("eoa");
        vm.expectRevert(abi.encodeWithSelector(TokenSource.TimelockNotContract.selector, eoa));
        new TokenSource(eoa, address(usdg), address(factory), _launchTickers());
    }

    function test_constructor_usdgWithoutCode_reverts() public {
        address[2] memory noCode = [makeAddr("eoa"), address(0)];
        for (uint256 i; i < noCode.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(TokenSource.UsdgNotContract.selector, noCode[i]));
            new TokenSource(address(timelock), noCode[i], address(factory), _launchTickers());
        }
    }

    function test_constructor_usdgWithOtherDecimals_reverts() public {
        usdg.setDecimals(18);
        vm.expectRevert(abi.encodeWithSelector(TokenSource.UnexpectedDecimals.selector, address(usdg), 18, 6));
        _deploy(_launchTickers());
    }

    function test_constructor_factoryWithoutCode_reverts() public {
        address[2] memory noCode = [makeAddr("eoa"), address(0)];
        for (uint256 i; i < noCode.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(TokenSource.FactoryNotContract.selector, noCode[i]));
            new TokenSource(address(timelock), address(usdg), noCode[i], _launchTickers());
        }
    }

    /// @dev The code checks run before USDG's decimals are read, so a factory without code is named as such even
    /// when USDG would also fail.
    function test_constructor_codeChecksComeFirst() public {
        usdg.setDecimals(18);
        address eoa = makeAddr("eoa");
        vm.expectRevert(abi.encodeWithSelector(TokenSource.FactoryNotContract.selector, eoa));
        new TokenSource(address(timelock), address(usdg), eoa, _launchTickers());
    }

    function test_constructor_noTickers_reverts() public {
        vm.expectRevert(TokenSource.NoTickers.selector);
        _deploy(new TokenSource.TickerInit[](0));
    }

    /// @dev The count is checked before any entry, so 257 empty entries revert TooManyTickers and not NotContract.
    /// With the test below it pins the bound at exactly 256.
    function test_constructor_moreTickersThanUint8Ids_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(TokenSource.TooManyTickers.selector, 257));
        _deploy(new TokenSource.TickerInit[](257));
    }

    /// @dev A uint8 id names 256 tickers, so 256 is the most the constructor accepts. Ids 0 to 255 all list and
    /// resolve, the last one with a feed and a canonical pool, and the timelock can still remove id 255.
    function test_constructor_exactly256Tickers_listsEveryId() public {
        TokenSource.TickerInit[] memory tickers = new TokenSource.TickerInit[](256);
        for (uint256 i; i < tickers.length; ++i) {
            tickers[i] = _init(address(new DecimalsOnlyToken()), address(0), NONE, new address[](0));
        }
        address lastToken = tickers[255].token;
        address lastFeed = address(new MockFeed(8, "last"));
        address lastPool = factory.createPool(address(usdg), lastToken, 500);
        tickers[255] = _init(lastToken, lastFeed, ALL_DAY, _pools(lastPool));
        TokenSource deployed = _deploy(tickers);

        assertEq(deployed.tickerCount(), 256, "every ticker listed");
        for (uint256 i; i < tickers.length; ++i) {
            // forge-lint: disable-next-line(unsafe-typecast)
            uint8 id = uint8(i);
            (address token,,, bool active) = deployed.ticker(id);
            assertEq(token, tickers[i].token, "token in launch order");
            assertTrue(active, "active");
            assertEq(deployed.idOf(token), id, "id of the token");
        }
        (, address feed, SessionCalendar.SessionType sessionType,) = deployed.ticker(255);
        assertEq(feed, lastFeed, "feed of id 255");
        assertEq(uint8(sessionType), uint8(ALL_DAY), "session type of id 255");
        assertEq(deployed.poolsOf(255), _pools(lastPool), "pools of id 255");

        _throughTimelock(address(deployed), abi.encodeCall(TokenSource.removeTicker, (255)), "remove id 255");
        (,,, bool lastActive) = deployed.ticker(255);
        assertFalse(lastActive, "id 255 removed");
    }

    function test_constructor_tokenWithoutCode_reverts() public {
        TokenSource.TickerInit[] memory tickers = _launchTickers();
        tickers[1].token = makeAddr("eoa");
        vm.expectRevert(abi.encodeWithSelector(TokenSource.NotContract.selector, tickers[1].token));
        _deploy(tickers);
    }

    function test_constructor_tokenWithOtherDecimals_reverts() public {
        qqq.setDecimals(6);
        vm.expectRevert(abi.encodeWithSelector(TokenSource.UnexpectedDecimals.selector, address(qqq), 6, 18));
        _deploy(_launchTickers());
    }

    function test_constructor_duplicateToken_reverts() public {
        TokenSource.TickerInit[] memory tickers = _launchTickers();
        tickers[1] = _init(address(spy), address(spyFeed), ALL_DAY, new address[](0));
        vm.expectRevert(abi.encodeWithSelector(TokenSource.DuplicateToken.selector, address(spy)));
        _deploy(tickers);
    }

    function test_constructor_feedWithoutCode_reverts() public {
        TokenSource.TickerInit[] memory tickers = _launchTickers();
        tickers[0].feed = makeAddr("eoa");
        vm.expectRevert(abi.encodeWithSelector(TokenSource.NotContract.selector, tickers[0].feed));
        _deploy(tickers);
    }

    function test_constructor_feedWithOtherDecimals_reverts() public {
        spyFeed.setDecimals(18);
        vm.expectRevert(abi.encodeWithSelector(TokenSource.UnexpectedDecimals.selector, address(spyFeed), 18, 8));
        _deploy(_launchTickers());
    }

    function test_constructor_feedWithSessionNone_reverts() public {
        TokenSource.TickerInit[] memory tickers = _launchTickers();
        tickers[0].sessionType = NONE;
        vm.expectRevert(
            abi.encodeWithSelector(TokenSource.SessionTypeMismatch.selector, address(spy), address(spyFeed), NONE)
        );
        _deploy(tickers);
    }

    function test_constructor_sessionWithoutAFeed_reverts() public {
        TokenSource.TickerInit[] memory tickers = _launchTickers();
        tickers[0].feed = address(0);
        vm.expectRevert(
            abi.encodeWithSelector(TokenSource.SessionTypeMismatch.selector, address(spy), address(0), ALL_DAY)
        );
        _deploy(tickers);
    }

    function test_constructor_poolOfAnotherToken_reverts() public {
        TokenSource.TickerInit[] memory tickers = _launchTickers();
        tickers[0].pools = _pools(qqqPool500);
        vm.expectRevert(abi.encodeWithSelector(TokenSource.PoolNotCanonical.selector, address(spy), qqqPool500));
        _deploy(tickers);
    }

    function test_constructor_addressesThatAreNotPools_revert() public {
        address[3] memory notPools = [makeAddr("eoa"), address(usdg), address(new OversizedFeePool())];
        for (uint256 i; i < notPools.length; ++i) {
            TokenSource.TickerInit[] memory tickers = _launchTickers();
            tickers[0].pools = _pools(notPools[i]);
            vm.expectRevert(abi.encodeWithSelector(TokenSource.PoolNotCanonical.selector, address(spy), notPools[i]));
            _deploy(tickers);
        }
    }

    function test_constructor_fee10000Pool_reverts() public {
        TokenSource.TickerInit[] memory tickers = _launchTickers();
        tickers[0].pools = _pools(spyPool500, spyPool10000);
        vm.expectRevert(abi.encodeWithSelector(TokenSource.FeeNotAllowed.selector, spyPool10000, 10_000));
        _deploy(tickers);
    }

    function test_constructor_samePoolTwice_reverts() public {
        TokenSource.TickerInit[] memory tickers = _launchTickers();
        tickers[0].pools = _pools(spyPool500, spyPool500);
        vm.expectRevert(abi.encodeWithSelector(TokenSource.PoolAlreadyAllowed.selector, 0, spyPool500));
        _deploy(tickers);
    }

    // Timelocked writes

    function test_I10_directWritesRevert_forEveryCaller() public {
        address[3] memory callers = [proposer, makeAddr("stranger"), address(this)];
        for (uint256 i; i < callers.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(TokenSource.CallerNotTimelock.selector, callers[i]));
            vm.prank(callers[i]);
            source.removeTicker(0);
            vm.expectRevert(abi.encodeWithSelector(TokenSource.CallerNotTimelock.selector, callers[i]));
            vm.prank(callers[i]);
            source.setPool(0, spyPool3000, true);
        }
    }

    function test_I10_removeTicker_runsOnlyAfterTheDelay() public {
        bytes memory call = abi.encodeCall(TokenSource.removeTicker, (1));
        bytes32 id = _schedule(address(source), call, "remove QQQ");
        vm.expectRevert(_notReady(id));
        _execute(address(source), call, "remove QQQ");
        vm.warp(block.timestamp + TIMELOCK_DELAY - 1);
        vm.expectRevert(_notReady(id));
        _execute(address(source), call, "remove QQQ");

        vm.warp(block.timestamp + 1);
        vm.expectEmit(true, true, false, true, address(source));
        emit TokenSource.TickerRemoved(1, address(qqq));
        _execute(address(source), call, "remove QQQ");
        (,,, bool active) = source.ticker(1);
        assertFalse(active);
        assertEq(source.tickerCount(), 2, "the count keeps removed tickers");
        assertEq(source.poolsOf(1), _pools(qqqPool500), "pools stay for sells");
        assertEq(source.idOf(address(qqq)), 1);
    }

    function test_I10_removeTicker_isOneWay() public {
        _throughTimelock(address(source), abi.encodeCall(TokenSource.removeTicker, (0)), "first");
        bytes memory again = abi.encodeCall(TokenSource.removeTicker, (0));
        _schedule(address(source), again, "second");
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        vm.expectRevert(abi.encodeWithSelector(TokenSource.TickerAlreadyRemoved.selector, 0));
        _execute(address(source), again, "second");
    }

    function test_removeTicker_unknownId_reverts() public {
        bytes memory call = abi.encodeCall(TokenSource.removeTicker, (2));
        _schedule(address(source), call, "");
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        vm.expectRevert(abi.encodeWithSelector(TokenSource.UnknownTicker.selector, 2));
        _execute(address(source), call, "");
    }

    function test_setPool_addsAndRemovesThroughTheTimelock() public {
        bytes memory add = abi.encodeCall(TokenSource.setPool, (0, spyPool3000, true));
        bytes32 id = _schedule(address(source), add, "add");
        vm.expectRevert(_notReady(id));
        _execute(address(source), add, "add");
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        vm.expectEmit(true, true, false, true, address(source));
        emit TokenSource.PoolSet(0, spyPool3000, 3000, true);
        _execute(address(source), add, "add");
        assertTrue(source.isPoolAllowed(0, spyPool3000));
        assertEq(source.poolsOf(0), _pools(spyPool500, spyPool3000));

        bytes memory remove = abi.encodeCall(TokenSource.setPool, (0, spyPool500, false));
        _schedule(address(source), remove, "remove");
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        vm.expectEmit(true, true, false, true, address(source));
        emit TokenSource.PoolSet(0, spyPool500, 500, false);
        _execute(address(source), remove, "remove");
        assertFalse(source.isPoolAllowed(0, spyPool500));
        assertEq(source.poolsOf(0), _pools(spyPool3000));
    }

    function test_setPool_removalKeepsTheOrderOfTheRest() public {
        _throughTimelock(address(source), abi.encodeCall(TokenSource.setPool, (0, spyPool100, true)), "a");
        _throughTimelock(address(source), abi.encodeCall(TokenSource.setPool, (0, spyPool3000, true)), "b");
        _throughTimelock(address(source), abi.encodeCall(TokenSource.setPool, (0, spyPool500, false)), "c");
        assertEq(source.poolsOf(0), _pools(spyPool100, spyPool3000), "first removed");
        _throughTimelock(address(source), abi.encodeCall(TokenSource.setPool, (0, spyPool500, true)), "d");
        _throughTimelock(address(source), abi.encodeCall(TokenSource.setPool, (0, spyPool3000, false)), "e");
        assertEq(source.poolsOf(0), _pools(spyPool100, spyPool500), "middle removed");
        _throughTimelock(address(source), abi.encodeCall(TokenSource.setPool, (0, spyPool500, false)), "f");
        _throughTimelock(address(source), abi.encodeCall(TokenSource.setPool, (0, spyPool100, false)), "g");
        assertEq(source.poolsOf(0).length, 0, "all removed");
    }

    function test_setPool_rejectsWhatTheConstructorRejects() public {
        _expectPoolRevert(
            0, qqqPool500, abi.encodeWithSelector(TokenSource.PoolNotCanonical.selector, address(spy), qqqPool500)
        );
        _expectPoolRevert(
            0, spyPool10000, abi.encodeWithSelector(TokenSource.FeeNotAllowed.selector, spyPool10000, 10_000)
        );
        _expectPoolRevert(0, spyPool500, abi.encodeWithSelector(TokenSource.PoolAlreadyAllowed.selector, 0, spyPool500));
    }

    /// @dev The lookalike has the canonical pool's pair and fee but was deployed outside the factory. A check on the
    /// pool's own token0() and token1() would accept it; only the factory's record refuses it.
    function test_constructorAndSetPool_lookalikePoolOutsideTheFactory_reverts() public {
        address lookalike = address(new MockV3Pool(address(usdg), address(spy), 500));
        _assertSameViews(lookalike, spyPool500);
        bytes memory notCanonical =
            abi.encodeWithSelector(TokenSource.PoolNotCanonical.selector, address(spy), lookalike);
        TokenSource.TickerInit[] memory tickers = _launchTickers();
        tickers[0].pools = _pools(lookalike);
        vm.expectRevert(notCanonical);
        _deploy(tickers);
        _expectPoolRevert(0, lookalike, notCanonical);
    }

    /// @dev The factory has no QQQ pool at fee 3,000, so getPool returns zero. A check that trusted the pool's own
    /// views whenever the factory knows no pool would accept this lookalike.
    function test_constructorAndSetPool_lookalikePoolInATierTheFactoryLacks_reverts() public {
        assertEq(factory.getPool(address(usdg), address(qqq), 3000), address(0), "no QQQ fee-3000 pool");
        address lookalike = address(new MockV3Pool(address(usdg), address(qqq), 3000));
        bytes memory notCanonical =
            abi.encodeWithSelector(TokenSource.PoolNotCanonical.selector, address(qqq), lookalike);
        TokenSource.TickerInit[] memory tickers = _launchTickers();
        tickers[1].pools = _pools(lookalike);
        vm.expectRevert(notCanonical);
        _deploy(tickers);
        _expectPoolRevert(1, lookalike, notCanonical);
    }

    function test_setPool_removingAPoolNotAllowed_reverts() public {
        bytes memory call = abi.encodeCall(TokenSource.setPool, (0, spyPool3000, false));
        _schedule(address(source), call, "");
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        vm.expectRevert(abi.encodeWithSelector(TokenSource.PoolNotAllowed.selector, 0, spyPool3000));
        _execute(address(source), call, "");
    }

    function test_setPool_worksOnARemovedTicker() public {
        _throughTimelock(address(source), abi.encodeCall(TokenSource.removeTicker, (0)), "remove");
        _throughTimelock(address(source), abi.encodeCall(TokenSource.setPool, (0, spyPool3000, true)), "add");
        assertTrue(source.isPoolAllowed(0, spyPool3000));
        (,,, bool active) = source.ticker(0);
        assertFalse(active, "adding a pool does not bring a ticker back");
    }

    // Views

    function test_views_unknownIds() public {
        vm.expectRevert(abi.encodeWithSelector(TokenSource.UnknownTicker.selector, 2));
        source.ticker(2);
        vm.expectRevert(abi.encodeWithSelector(TokenSource.UnknownTicker.selector, 2));
        source.poolsOf(2);
        assertFalse(source.isPoolAllowed(2, spyPool500));
        vm.expectRevert(abi.encodeWithSelector(TokenSource.UnknownToken.selector, address(usdg)));
        source.idOf(address(usdg));
    }

    // I10: the ABI itself

    /// @dev Reads the compiled ABI: the only writes are removeTicker and setPool, so no function can add a ticker or
    /// move funds, and there is no receive or fallback.
    function test_I10_abiHasOnlyTheTwoTimelockedWrites() public view {
        string memory artifact = string.concat(
            vm.projectRoot(), "/", vm.envOr("FOUNDRY_OUT", string("out")), "/TokenSource.sol/TokenSource.json"
        );
        string memory json = vm.readFile(artifact);
        string[] memory functions = vm.parseJsonKeys(json, ".methodIdentifiers");
        string[10] memory expected = [
            "idOf(address)",
            "isPoolAllowed(uint8,address)",
            "poolsOf(uint8)",
            "removeTicker(uint8)",
            "setPool(uint8,address,bool)",
            "ticker(uint8)",
            "tickerCount()",
            "timelock()",
            "usdg()",
            "v3Factory()"
        ];
        assertEq(functions.length, expected.length, "function count");
        for (uint256 i; i < expected.length; ++i) {
            bool found;
            for (uint256 j; j < functions.length; ++j) {
                found = found || keccak256(bytes(functions[j])) == keccak256(bytes(expected[i]));
            }
            assertTrue(found, expected[i]);
        }
        assertFalse(vm.contains(json, '"type":"receive"'), "no receive");
        assertFalse(vm.contains(json, '"type":"fallback"'), "no fallback");
    }

    function test_I10_rejectsEtherAndUnknownSelectors() public {
        vm.deal(address(this), 1 ether);
        (bool sent,) = address(source).call{value: 1}("");
        assertFalse(sent, "no receive");
        (bool called,) = address(source)
            .call(abi.encodeWithSignature("addTicker(address,address,uint8)", address(spy), address(spyFeed), uint8(1)));
        assertFalse(called, "no add function");
        assertEq(address(source).balance, 0);
    }

    // I10: the deployed code itself

    /// @dev The strongest form of I10: whatever calldata reaches TokenSource, through the timelock or not, its
    /// deployed code has no instruction that can move a token or ether. There is no CALL, CALLCODE or DELEGATECALL, no
    /// CREATE or CREATE2 that could deploy a contract to make such a call, and no SELFDESTRUCT. Its only outbound calls
    /// are the STATICCALLs that read a pool's fee() and the factory's getPool, and a STATICCALL cannot change state.
    function test_I10_runtimeCodeHasNoCallCreateOrSelfdestruct() public view {
        uint256[256] memory counts = _opcodeCounts(address(source).code);
        assertEq(counts[CREATE], 0, "CREATE");
        assertEq(counts[CALL], 0, "CALL");
        assertEq(counts[CALLCODE], 0, "CALLCODE");
        assertEq(counts[DELEGATECALL], 0, "DELEGATECALL");
        assertEq(counts[CREATE2], 0, "CREATE2");
        assertEq(counts[SELFDESTRUCT], 0, "SELFDESTRUCT");
        assertGt(counts[STATICCALL], 0, "the scan reaches the call sites");
    }

    /// @dev Checks the scan the test above relies on. On hand-built code it counts a byte only where the EVM would run
    /// it as an instruction, never inside PUSH data or the metadata. On compiled code it finds the CALL in
    /// TimelockController's execute path.
    function test_opcodeScan_countsOnlyBytesTheEvmRuns() public view {
        bytes memory code = bytes.concat(
            hex"60f1", // PUSH1 0xf1: the 0xf1 is data
            hex"f1", // CALL
            hex"7f",
            bytes32(type(uint256).max), // PUSH32 of 32 0xff bytes, all data
            hex"f0f2f4f5ff", // CREATE, CALLCODE, DELEGATECALL, CREATE2, SELFDESTRUCT
            hex"a1f1f1", // metadata: a CBOR map header and two bytes that are not code
            hex"0003" // metadata length
        );
        uint256[256] memory counts = _opcodeCounts(code);
        assertEq(counts[PUSH1] + counts[PUSH32], 2, "two PUSH instructions");
        assertEq(counts[CALL], 1, "one CALL, not the PUSH1 data or the metadata");
        assertEq(counts[SELFDESTRUCT], 1, "one SELFDESTRUCT, not the PUSH32 data");
        assertEq(counts[CREATE], 1, "CREATE");
        assertEq(counts[CALLCODE], 1, "CALLCODE");
        assertEq(counts[DELEGATECALL], 1, "DELEGATECALL");
        assertEq(counts[CREATE2], 1, "CREATE2");
        assertGt(_opcodeCounts(address(timelock).code)[CALL], 0, "TimelockController's execute makes a CALL");
    }

    /// @dev Counts each opcode of runtime code the way the EVM reads it: from byte 0, one instruction at a time,
    /// stepping over the data of PUSH1 to PUSH32, and stopping at the CBOR metadata solc appends, whose length is the
    /// code's last two bytes. The walk must land exactly where the metadata starts, or it fell out of step with the
    /// code.
    function _opcodeCounts(bytes memory code) private pure returns (uint256[256] memory counts) {
        uint256 length = code.length;
        assertGe(length, 2, "room for the metadata length");
        uint256 metadataLength = (uint256(uint8(code[length - 2])) << 8) | uint8(code[length - 1]);
        assertLe(metadataLength + 2, length, "the metadata fits in the code");
        uint256 codeEnd = length - 2 - metadataLength;
        uint8 header = uint8(code[codeEnd]);
        assertTrue(header >= 0xa0 && header <= 0xb7, "the metadata starts with a CBOR map");
        uint256 i;
        while (i < codeEnd) {
            uint8 op = uint8(code[i]);
            ++counts[op];
            i += op >= PUSH1 && op <= PUSH32 ? op - PUSH1 + 2 : 1;
        }
        assertEq(i, codeEnd, "the last instruction ends where the metadata starts");
    }

    function _assertSameViews(address lookalike, address canonical) private view {
        assertEq(MockV3Pool(lookalike).token0(), MockV3Pool(canonical).token0(), "token0");
        assertEq(MockV3Pool(lookalike).token1(), MockV3Pool(canonical).token1(), "token1");
        assertEq(MockV3Pool(lookalike).fee(), MockV3Pool(canonical).fee(), "fee");
        assertTrue(lookalike != canonical, "a different contract");
    }

    function _expectPoolRevert(uint8 id, address pool, bytes memory revertData) private {
        bytes memory call = abi.encodeCall(TokenSource.setPool, (id, pool, true));
        bytes32 salt = keccak256(revertData);
        _schedule(address(source), call, salt);
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        vm.expectRevert(revertData);
        _execute(address(source), call, salt);
    }
}

/// @notice Drives every admin path, through the timelock and around it, with fuzzed inputs.
contract TokenSourceAdminHandler is Test {
    uint256 private constant DELAY_CAP = 30 days;

    TimelockController public timelock;
    TokenSource public source;
    address[] public candidatePools;
    uint256 public operations;
    uint256 public executed;
    uint256 public rejected;
    /// @notice Direct writes from a caller other than the timelock that did not revert with CallerNotTimelock. The
    /// invariant suite requires zero.
    uint256 public unguardedDirectWrites;
    mapping(uint8 id => bool) public removedSeen;

    error AlreadyInitialized();

    function init(TimelockController timelock_, TokenSource source_, address[] memory pools) external {
        if (address(timelock) != address(0)) revert AlreadyInitialized();
        timelock = timelock_;
        source = source_;
        candidatePools = pools;
    }

    function removeTicker(uint8 id) external {
        _run(address(source), abi.encodeCall(TokenSource.removeTicker, (id % 3)));
    }

    function setPool(uint8 id, uint256 poolSeed, bool allowed) external {
        address pool = candidatePools[poolSeed % candidatePools.length];
        _run(address(source), abi.encodeCall(TokenSource.setPool, (id % 3, pool, allowed)));
    }

    function updateDelay(uint256 newDelay) external {
        _run(address(timelock), abi.encodeCall(TimelockController.updateDelay, (newDelay % DELAY_CAP)));
    }

    function grantProposer(address account) external {
        _run(address(timelock), abi.encodeCall(IAccessControl.grantRole, (timelock.PROPOSER_ROLE(), account)));
    }

    /// @dev A write that skips the timelock. From any caller but the timelock it must revert with CallerNotTimelock,
    /// which onlyTimelock checks before anything else. A revert inside the handler would be discarded under
    /// fail_on_revert = false, so a miss is counted here and asserted by the invariant suite.
    function directWrite(address caller, uint8 id, uint256 poolSeed, bool remove) external {
        bytes memory data = remove
            ? abi.encodeCall(TokenSource.removeTicker, (id))
            : abi.encodeCall(TokenSource.setPool, (id, candidatePools[poolSeed % candidatePools.length], true));
        vm.prank(caller);
        (bool ok, bytes memory returned) = address(source).call(data);
        bytes memory refused = abi.encodeWithSelector(TokenSource.CallerNotTimelock.selector, caller);
        if (caller != address(timelock) && (ok || keccak256(returned) != keccak256(refused))) {
            ++unguardedDirectWrites;
        }
        _record(ok);
    }

    function arbitraryCall(bytes calldata data) external {
        _run(address(source), data);
    }

    function _run(address target, bytes memory data) private {
        bytes32 salt = bytes32(++operations);
        uint256 delay = timelock.getMinDelay();
        timelock.schedule(target, 0, data, bytes32(0), salt, delay);
        vm.warp(block.timestamp + delay);
        (bool ok,) =
            address(timelock).call(abi.encodeCall(TimelockController.execute, (target, 0, data, bytes32(0), salt)));
        _record(ok);
    }

    function _record(bool ok) private {
        if (ok) ++executed;
        else ++rejected;
        for (uint8 id; id < 2; ++id) {
            (,,, bool active) = source.ticker(id);
            if (!active) removedSeen[id] = true;
        }
    }
}

/// @notice I10 as invariants, with SleeveTimelock as the admin, as deployed: whatever sequence of admin actions runs,
/// no ticker is added or changed, a removed ticker never returns, every allowlisted pool stays canonical, no token or
/// ether moves, no write gets past onlyTimelock, and the delay never drops below 48 hours.
contract TokenSourceInvariantTest is StdInvariant, TokenSourceFixture {
    TokenSourceAdminHandler private handler;
    address private holder = makeAddr("holder");
    uint256 private constant HELD = 1_000e18;

    function setUp() public {
        handler = new TokenSourceAdminHandler();
        _deployMockTokens();
        address[] memory roles = new address[](1);
        roles[0] = address(handler);
        timelock = new SleeveTimelock(TIMELOCK_DELAY, roles, roles, address(0));
        source = _deploy(_launchTickers());

        address[] memory candidates = new address[](7);
        candidates[0] = spyPool500;
        candidates[1] = spyPool3000;
        candidates[2] = spyPool100;
        candidates[3] = spyPool10000;
        candidates[4] = qqqPool500;
        candidates[5] = address(usdg);
        candidates[6] = makeAddr("not a pool");
        handler.init(timelock, source, candidates);

        usdg.mint(address(source), 1_000e6);
        usdg.mint(holder, 1_000e6);
        spy.mint(address(source), HELD);
        spy.mint(holder, HELD);
        qqq.mint(holder, HELD);
        bytes4[] memory actions = new bytes4[](6);
        actions[0] = TokenSourceAdminHandler.removeTicker.selector;
        actions[1] = TokenSourceAdminHandler.setPool.selector;
        actions[2] = TokenSourceAdminHandler.updateDelay.selector;
        actions[3] = TokenSourceAdminHandler.grantProposer.selector;
        actions[4] = TokenSourceAdminHandler.directWrite.selector;
        actions[5] = TokenSourceAdminHandler.arbitraryCall.selector;
        targetContract(address(handler));
        targetSelector(FuzzSelector({addr: address(handler), selectors: actions}));
    }

    /// @dev Every run must have driven admin actions, or the invariants prove nothing.
    function afterInvariant() public view {
        assertGt(handler.executed() + handler.rejected(), 0, "no admin action ran");
    }

    function invariant_I10_tickerCountNeverGrows() public view {
        assertEq(source.tickerCount(), 2);
    }

    function invariant_I10_tickersNeverChangeAndRemovalsStick() public view {
        _assertTicker(0, address(spy), address(spyFeed));
        _assertTicker(1, address(qqq), address(qqqFeed));
    }

    function invariant_I10_noTokenOrEtherMoves() public view {
        assertEq(usdg.balanceOf(address(source)), 1_000e6);
        assertEq(usdg.balanceOf(holder), 1_000e6);
        assertEq(spy.balanceOf(address(source)), HELD);
        assertEq(spy.balanceOf(holder), HELD);
        assertEq(qqq.balanceOf(holder), HELD);
        assertEq(address(source).balance, 0);
        assertEq(address(timelock).balance, 0);
    }

    function invariant_I10_directWritesNeverGetPastOnlyTimelock() public view {
        assertEq(handler.unguardedDirectWrites(), 0, "a direct write got past onlyTimelock");
    }

    /// @dev D-018: the handler runs updateDelay through the timelock with fuzzed values, and none takes the delay below
    /// 48 hours.
    function invariant_I10_delayNeverDropsBelow48Hours() public view {
        assertGe(timelock.getMinDelay(), TIMELOCK_DELAY);
    }

    function invariant_allowlistedPoolsStayCanonical() public view {
        for (uint8 id; id < 2; ++id) {
            (address token,,,) = source.ticker(id);
            address[] memory pools = source.poolsOf(id);
            for (uint256 i; i < pools.length; ++i) {
                assertTrue(source.isPoolAllowed(id, pools[i]));
                uint24 fee = MockV3Pool(pools[i]).fee();
                assertTrue(fee == 100 || fee == 500 || fee == 3000, "fee tier");
                assertEq(factory.getPool(address(usdg), token, fee), pools[i], "canonical");
                for (uint256 j; j < i; ++j) {
                    assertTrue(pools[j] != pools[i], "no duplicate");
                }
            }
        }
    }

    function _assertTicker(uint8 id, address expectedToken, address expectedFeed) private view {
        (address token, address feed, SessionCalendar.SessionType sessionType, bool active) = source.ticker(id);
        assertEq(token, expectedToken);
        assertEq(feed, expectedFeed);
        assertEq(uint8(sessionType), uint8(ALL_DAY));
        if (handler.removedSeen(id)) assertFalse(active, "a removed ticker came back");
    }
}
