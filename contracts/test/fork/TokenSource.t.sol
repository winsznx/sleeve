// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {TokenSource} from "../../src/TokenSource.sol";
import {IUniswapV3Factory} from "../../src/interfaces/IUniswapV3Factory.sol";
import {IUniswapV3Pool} from "../../src/interfaces/IUniswapV3Pool.sol";
import {SessionCalendar} from "../../src/libraries/SessionCalendar.sol";
import {LaunchConfig} from "../mocks/LaunchConfig.sol";
import {MockV3Pool} from "../mocks/MockV3Pool.sol";
import {TimelockScheduler} from "../mocks/TimelockScheduler.sol";
import {Chain4663} from "../utils/Chain4663.sol";
import {ForkBase} from "../utils/ForkBase.sol";

/// @notice TokenSource on the real v3 factory and pools at block 78,312,136, owned by an OpenZeppelin v5.4
/// TimelockController with the SPEC configuration. The I10 tests show the admin can only remove a ticker or change a
/// pool, only after 172,800 seconds, with an event, and can never add a ticker or move a token.
contract TokenSourceForkTest is ForkBase, TimelockScheduler {
    SessionCalendar.SessionType private constant ALL_DAY = SessionCalendar.SessionType.ALL_DAY;
    uint256 private constant HELD_USDG = 1_000e6;
    uint256 private constant HELD_TOKENS = 3e18;
    uint256 private constant FUZZ_STEPS = 12;

    TokenSource private source;
    address private holder = makeAddr("holder");

    function setUp() public {
        _fork(IN_SESSION_BLOCK);
        _deployTimelock();
        source = new TokenSource(address(timelock), Chain4663.USDG, Chain4663.V3_FACTORY, LaunchConfig.tickerInits());
    }

    // Constructor on the real factory

    function test_fork_constructor_listsTheLaunchTickersAndD010Pools() public view {
        assertEq(source.timelock(), address(timelock));
        assertEq(source.usdg(), Chain4663.USDG);
        assertEq(source.v3Factory(), Chain4663.V3_FACTORY);
        assertEq(source.tickerCount(), 4);
        _assertTicker(0, Chain4663.SPY, Chain4663.SPY_FEED, true);
        _assertTicker(1, Chain4663.QQQ, Chain4663.QQQ_FEED, true);
        _assertTicker(2, Chain4663.NVDA, Chain4663.NVDA_FEED, true);
        _assertTicker(3, Chain4663.AAPL, Chain4663.AAPL_FEED, true);
        assertEq(source.poolsOf(0), _one(LaunchConfig.SPY_POOL_500));
        assertEq(source.poolsOf(1), _one(LaunchConfig.QQQ_POOL_500));
        assertEq(source.poolsOf(2), _one(LaunchConfig.NVDA_POOL_500));
        assertEq(source.poolsOf(3), _two(LaunchConfig.AAPL_POOL_500, LaunchConfig.AAPL_POOL_3000));
        for (uint8 id; id < 4; ++id) {
            (address token,,,) = source.ticker(id);
            assertEq(source.idOf(token), id);
            address[] memory pools = source.poolsOf(id);
            for (uint256 i; i < pools.length; ++i) {
                assertTrue(source.isPoolAllowed(id, pools[i]));
                uint24 fee = IUniswapV3Pool(pools[i]).fee();
                assertEq(IUniswapV3Factory(Chain4663.V3_FACTORY).getPool(Chain4663.USDG, token, fee), pools[i]);
            }
        }
        assertFalse(source.isPoolAllowed(0, LaunchConfig.QQQ_POOL_500), "allowlists are per ticker");
    }

    function test_fork_constructor_rejectsTheMemecoinPool() public {
        TokenSource.TickerInit[] memory tickers = LaunchConfig.tickerInits();
        tickers[2].pools = _one(LaunchConfig.MEMECOIN_POOL);
        vm.expectRevert(
            abi.encodeWithSelector(TokenSource.PoolNotCanonical.selector, Chain4663.NVDA, LaunchConfig.MEMECOIN_POOL)
        );
        _deploy(tickers);
    }

    function test_fork_constructor_rejectsAUsdgPoolOfAnotherToken() public {
        TokenSource.TickerInit[] memory tickers = LaunchConfig.tickerInits();
        tickers[1].pools = _one(LaunchConfig.SPY_POOL_500);
        vm.expectRevert(
            abi.encodeWithSelector(TokenSource.PoolNotCanonical.selector, Chain4663.QQQ, LaunchConfig.SPY_POOL_500)
        );
        _deploy(tickers);
    }

    function test_fork_constructor_rejectsFee10000Pools() public {
        TokenSource.TickerInit[] memory tickers = LaunchConfig.tickerInits();
        tickers[2].pools = _one(LaunchConfig.NVDA_POOL_10000);
        vm.expectRevert(
            abi.encodeWithSelector(TokenSource.FeeNotAllowed.selector, LaunchConfig.NVDA_POOL_10000, 10_000)
        );
        _deploy(tickers);

        tickers = LaunchConfig.tickerInits();
        tickers[3].pools = _two(LaunchConfig.AAPL_POOL_500, LaunchConfig.AAPL_POOL_10000);
        vm.expectRevert(
            abi.encodeWithSelector(TokenSource.FeeNotAllowed.selector, LaunchConfig.AAPL_POOL_10000, 10_000)
        );
        _deploy(tickers);
    }

    function test_fork_constructor_rejectsAnAddressThatIsNotAPool() public {
        TokenSource.TickerInit[] memory tickers = LaunchConfig.tickerInits();
        tickers[0].pools = _one(Chain4663.SWAP_ROUTER_02);
        vm.expectRevert(
            abi.encodeWithSelector(TokenSource.PoolNotCanonical.selector, Chain4663.SPY, Chain4663.SWAP_ROUTER_02)
        );
        _deploy(tickers);
    }

    // The timelock

    function test_I10_fork_timelockHasTheSpecConfiguration() public view {
        assertEq(timelock.getMinDelay(), 172_800);
        assertTrue(timelock.hasRole(timelock.PROPOSER_ROLE(), proposer));
        assertTrue(timelock.hasRole(timelock.EXECUTOR_ROLE(), proposer));
        assertTrue(timelock.hasRole(timelock.CANCELLER_ROLE(), proposer));
        bytes32 admin = timelock.DEFAULT_ADMIN_ROLE();
        assertFalse(timelock.hasRole(admin, proposer), "DEPLOYER is not an admin");
        assertFalse(timelock.hasRole(admin, address(this)), "the deploying contract is not an admin");
        assertTrue(timelock.hasRole(admin, address(timelock)), "only the timelock administers itself");
        assertFalse(timelock.hasRole(timelock.EXECUTOR_ROLE(), address(0)), "execution is not open to anyone");
    }

    function test_I10_fork_directCallsRevertForEveryone() public {
        address[4] memory callers = [proposer, makeAddr("stranger"), Chain4663.SWAP_ROUTER_02, address(this)];
        for (uint256 i; i < callers.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(TokenSource.CallerNotTimelock.selector, callers[i]));
            vm.prank(callers[i]);
            source.removeTicker(0);
            vm.expectRevert(abi.encodeWithSelector(TokenSource.CallerNotTimelock.selector, callers[i]));
            vm.prank(callers[i]);
            source.setPool(0, LaunchConfig.SPY_POOL_3000, true);
        }
    }

    function test_I10_fork_removeTickerExecutesOnlyAfterTheDelay() public {
        bytes memory call = abi.encodeCall(TokenSource.removeTicker, (2));
        bytes32 id = _schedule(address(source), call, "remove NVDA");
        vm.expectRevert(_notReady(id));
        _execute(address(source), call, "remove NVDA");
        vm.warp(block.timestamp + TIMELOCK_DELAY - 1);
        vm.expectRevert(_notReady(id));
        _execute(address(source), call, "remove NVDA");

        vm.warp(block.timestamp + 1);
        vm.expectEmit(true, true, false, true, address(source));
        emit TokenSource.TickerRemoved(2, Chain4663.NVDA);
        _execute(address(source), call, "remove NVDA");
        _assertTicker(2, Chain4663.NVDA, Chain4663.NVDA_FEED, false);
        assertEq(source.tickerCount(), 4);
        assertEq(source.poolsOf(2), _one(LaunchConfig.NVDA_POOL_500), "the pool stays for sells");
    }

    function test_I10_fork_setPoolExecutesOnlyAfterTheDelay() public {
        bytes memory add = abi.encodeCall(TokenSource.setPool, (0, LaunchConfig.SPY_POOL_3000, true));
        bytes32 id = _schedule(address(source), add, "add SPY 3000");
        vm.expectRevert(_notReady(id));
        _execute(address(source), add, "add SPY 3000");
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        vm.expectEmit(true, true, false, true, address(source));
        emit TokenSource.PoolSet(0, LaunchConfig.SPY_POOL_3000, 3000, true);
        _execute(address(source), add, "add SPY 3000");
        assertEq(source.poolsOf(0), _two(LaunchConfig.SPY_POOL_500, LaunchConfig.SPY_POOL_3000));

        bytes memory remove = abi.encodeCall(TokenSource.setPool, (3, LaunchConfig.AAPL_POOL_3000, false));
        id = _schedule(address(source), remove, "remove AAPL 3000");
        vm.expectRevert(_notReady(id));
        _execute(address(source), remove, "remove AAPL 3000");
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        vm.expectEmit(true, true, false, true, address(source));
        emit TokenSource.PoolSet(3, LaunchConfig.AAPL_POOL_3000, 3000, false);
        _execute(address(source), remove, "remove AAPL 3000");
        assertEq(source.poolsOf(3), _one(LaunchConfig.AAPL_POOL_500));
    }

    function test_I10_fork_setPoolRejectsNonCanonicalAndFee10000Pools() public {
        _expectSetPoolRevert(
            2,
            LaunchConfig.MEMECOIN_POOL,
            abi.encodeWithSelector(TokenSource.PoolNotCanonical.selector, Chain4663.NVDA, LaunchConfig.MEMECOIN_POOL)
        );
        _expectSetPoolRevert(
            1,
            LaunchConfig.NVDA_POOL_500,
            abi.encodeWithSelector(TokenSource.PoolNotCanonical.selector, Chain4663.QQQ, LaunchConfig.NVDA_POOL_500)
        );
        _expectSetPoolRevert(
            3,
            LaunchConfig.AAPL_POOL_10000,
            abi.encodeWithSelector(TokenSource.FeeNotAllowed.selector, LaunchConfig.AAPL_POOL_10000, 10_000)
        );
    }

    /// @dev Contracts deployed outside the factory with a real pair and fee. The NVDA one shows the same views as the
    /// canonical fee-500 pool. The AAPL one sits in the fee-100 tier, where the factory has no pool and getPool returns
    /// zero. Only the factory's record makes a pool canonical, so both are refused.
    function test_I10_fork_setPoolRejectsLookalikePools() public {
        IUniswapV3Pool canonical = IUniswapV3Pool(LaunchConfig.NVDA_POOL_500);
        IUniswapV3Pool nvdaLookalike = IUniswapV3Pool(address(new MockV3Pool(Chain4663.USDG, Chain4663.NVDA, 500)));
        assertEq(nvdaLookalike.token0(), canonical.token0(), "token0");
        assertEq(nvdaLookalike.token1(), canonical.token1(), "token1");
        assertEq(nvdaLookalike.fee(), canonical.fee(), "fee");
        _expectSetPoolRevert(
            2,
            address(nvdaLookalike),
            abi.encodeWithSelector(TokenSource.PoolNotCanonical.selector, Chain4663.NVDA, address(nvdaLookalike))
        );

        assertEq(
            IUniswapV3Factory(Chain4663.V3_FACTORY).getPool(Chain4663.USDG, Chain4663.AAPL, 100),
            address(0),
            "no AAPL fee-100 pool"
        );
        address aaplLookalike = address(new MockV3Pool(Chain4663.USDG, Chain4663.AAPL, 100));
        _expectSetPoolRevert(
            3,
            aaplLookalike,
            abi.encodeWithSelector(TokenSource.PoolNotCanonical.selector, Chain4663.AAPL, aaplLookalike)
        );
    }

    function test_I10_fork_scheduleBelowTheMinimumDelay_reverts() public {
        bytes memory call = abi.encodeCall(TokenSource.removeTicker, (0));
        vm.expectRevert(
            abi.encodeWithSelector(
                TimelockController.TimelockInsufficientDelay.selector, TIMELOCK_DELAY - 1, TIMELOCK_DELAY
            )
        );
        vm.prank(proposer);
        timelock.schedule(address(source), 0, call, bytes32(0), bytes32(0), TIMELOCK_DELAY - 1);
    }

    function test_I10_fork_onlyTheProposerSchedulesAndOnlyTheExecutorExecutes() public {
        address stranger = makeAddr("stranger");
        bytes memory call = abi.encodeCall(TokenSource.removeTicker, (0));
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, timelock.PROPOSER_ROLE()
            )
        );
        vm.prank(stranger);
        timelock.schedule(address(source), 0, call, bytes32(0), bytes32(0), TIMELOCK_DELAY);

        _schedule(address(source), call, bytes32(0));
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        vm.expectRevert(
            abi.encodeWithSelector(
                IAccessControl.AccessControlUnauthorizedAccount.selector, stranger, timelock.EXECUTOR_ROLE()
            )
        );
        vm.prank(stranger);
        timelock.execute(address(source), 0, call, bytes32(0), bytes32(0));
    }

    function test_I10_fork_cancelledOperationNeverRuns() public {
        bytes memory call = abi.encodeCall(TokenSource.removeTicker, (0));
        bytes32 id = _schedule(address(source), call, "cancel me");
        vm.prank(proposer);
        timelock.cancel(id);
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        vm.expectRevert(_notReady(id));
        _execute(address(source), call, "cancel me");
        _assertTicker(0, Chain4663.SPY, Chain4663.SPY_FEED, true);
    }

    /// @dev Every admin path in a fuzzed order: removals, pool adds and removals with real pools and non-pools,
    /// arbitrary calldata through the timelock, timelock delay and role changes, and direct calls. After each step no
    /// ticker was added or changed, a removed ticker stayed removed, and no USDG or stock token moved.
    /// forge-config: default.fuzz.runs = 24
    function test_I10_fork_fuzz_adminPathsNeverAddATickerOrMoveFunds(uint256 seed) public {
        IERC20[5] memory assets = [
            IERC20(Chain4663.USDG),
            IERC20(Chain4663.SPY),
            IERC20(Chain4663.QQQ),
            IERC20(Chain4663.NVDA),
            IERC20(Chain4663.AAPL)
        ];
        deal(Chain4663.USDG, address(source), HELD_USDG);
        deal(Chain4663.USDG, holder, HELD_USDG);
        for (uint256 i = 1; i < assets.length; ++i) {
            deal(address(assets[i]), address(source), HELD_TOKENS);
            deal(address(assets[i]), holder, HELD_TOKENS);
        }
        bool[4] memory removed;
        for (uint256 step; step < FUZZ_STEPS; ++step) {
            _fuzzStep(uint256(keccak256(abi.encode(seed, step))), step);
            assertEq(source.tickerCount(), 4, "a ticker was added");
            removed = _assertLaunchTickersUnchanged(removed);
            for (uint256 i; i < assets.length; ++i) {
                uint256 held = i == 0 ? HELD_USDG : HELD_TOKENS;
                assertEq(assets[i].balanceOf(address(source)), held, "TokenSource balance moved");
                assertEq(assets[i].balanceOf(holder), held, "holder balance moved");
            }
            assertEq(address(source).balance, 0, "TokenSource holds ether");
        }
    }

    // Helpers

    function _fuzzStep(uint256 entropy, uint256 step) private {
        uint8 id = uint8(entropy >> 8) % 5;
        address pool = _candidatePool(entropy >> 16);
        bytes32 salt = keccak256(abi.encode(entropy, step));
        uint256 action = entropy % 6;
        if (action == 0) {
            _tryThroughTimelock(address(source), abi.encodeCall(TokenSource.removeTicker, (id)), salt);
        } else if (action == 1) {
            _tryThroughTimelock(address(source), abi.encodeCall(TokenSource.setPool, (id, pool, true)), salt);
        } else if (action == 2) {
            _tryThroughTimelock(address(source), abi.encodeCall(TokenSource.setPool, (id, pool, false)), salt);
        } else if (action == 3) {
            bytes memory data = abi.encodePacked(bytes4(uint32(entropy >> 32)), entropy, pool);
            _tryThroughTimelock(address(source), data, salt);
        } else if (action == 4) {
            uint256 newDelay = (entropy >> 40) % (3 * TIMELOCK_DELAY);
            _tryThroughTimelock(address(timelock), abi.encodeCall(TimelockController.updateDelay, (newDelay)), salt);
        } else {
            address caller = address(uint160(entropy >> 48));
            vm.prank(caller);
            (bool ok,) = address(source).call(abi.encodeCall(TokenSource.setPool, (id, pool, true)));
            assertFalse(ok, "a direct write succeeded");
        }
    }

    function _tryThroughTimelock(address target, bytes memory data, bytes32 salt) private {
        uint256 delay = timelock.getMinDelay();
        vm.prank(proposer);
        timelock.schedule(target, 0, data, bytes32(0), salt, delay);
        vm.warp(block.timestamp + delay);
        vm.prank(proposer);
        (bool executed,) =
            address(timelock).call(abi.encodeCall(TimelockController.execute, (target, 0, data, bytes32(0), salt)));
        bytes32 id = timelock.hashOperation(target, 0, data, bytes32(0), salt);
        assertEq(timelock.isOperationDone(id), executed, "an operation is done exactly when it executed");
    }

    function _candidatePool(uint256 entropy) private view returns (address) {
        address[12] memory candidates = [
            LaunchConfig.SPY_POOL_500,
            LaunchConfig.SPY_POOL_100,
            LaunchConfig.SPY_POOL_3000,
            LaunchConfig.QQQ_POOL_3000,
            LaunchConfig.NVDA_POOL_3000,
            LaunchConfig.NVDA_POOL_10000,
            LaunchConfig.AAPL_POOL_3000,
            LaunchConfig.AAPL_POOL_10000,
            LaunchConfig.MEMECOIN_POOL,
            Chain4663.USDG,
            Chain4663.SWAP_ROUTER_02,
            holder
        ];
        return candidates[entropy % candidates.length];
    }

    function _assertLaunchTickersUnchanged(bool[4] memory removedBefore) private view returns (bool[4] memory removed) {
        address[4] memory tokens = [Chain4663.SPY, Chain4663.QQQ, Chain4663.NVDA, Chain4663.AAPL];
        address[4] memory feeds = [Chain4663.SPY_FEED, Chain4663.QQQ_FEED, Chain4663.NVDA_FEED, Chain4663.AAPL_FEED];
        for (uint8 id; id < 4; ++id) {
            (address token, address feed, SessionCalendar.SessionType sessionType, bool active) = source.ticker(id);
            assertEq(token, tokens[id], "token changed");
            assertEq(feed, feeds[id], "feed changed");
            assertEq(uint8(sessionType), uint8(ALL_DAY), "session type changed");
            if (removedBefore[id]) assertFalse(active, "a removed ticker came back");
            removed[id] = !active;
        }
    }

    function _expectSetPoolRevert(uint8 id, address pool, bytes memory revertData) private {
        bytes memory call = abi.encodeCall(TokenSource.setPool, (id, pool, true));
        bytes32 salt = keccak256(revertData);
        _schedule(address(source), call, salt);
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        vm.expectRevert(revertData);
        _execute(address(source), call, salt);
    }

    function _assertTicker(uint8 id, address token, address feed, bool active) private view {
        (address listedToken, address listedFeed, SessionCalendar.SessionType sessionType, bool listedActive) =
            source.ticker(id);
        assertEq(listedToken, token);
        assertEq(listedFeed, feed);
        assertEq(uint8(sessionType), uint8(ALL_DAY));
        assertEq(listedActive, active);
    }

    function _deploy(TokenSource.TickerInit[] memory tickers) private returns (TokenSource) {
        return new TokenSource(address(timelock), Chain4663.USDG, Chain4663.V3_FACTORY, tickers);
    }

    function _one(address pool) private pure returns (address[] memory pools) {
        pools = new address[](1);
        pools[0] = pool;
    }

    function _two(address first, address second) private pure returns (address[] memory pools) {
        pools = new address[](2);
        pools[0] = first;
        pools[1] = second;
    }
}
