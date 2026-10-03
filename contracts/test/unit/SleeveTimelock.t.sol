// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {SessionCalendarExtension} from "../../src/SessionCalendarExtension.sol";
import {SleeveTimelock} from "../../src/SleeveTimelock.sol";
import {TokenSource} from "../../src/TokenSource.sol";
import {SessionCalendar} from "../../src/libraries/SessionCalendar.sol";
import {TokenSourceFixture} from "./TokenSource.t.sol";

/// @notice SleeveTimelock as Sleeve deploys it (D-009 Q33, D-018, D-019): a delay that no constructor argument and no
/// scheduled operation can take below 172,800 seconds or above 30 days, one address that proposes, executes and
/// cancels, no admin, and TokenSource and SessionCalendarExtension writes that run only once 48 hours have passed.
contract SleeveTimelockTest is TokenSourceFixture {
    uint256 private constant FLOOR = 172_800;
    uint256 private constant CEILING = 30 days;
    uint256 private constant NOW = 1_790_953_062; // Fri 2026-10-02 14:57:42Z
    uint256 private constant WED_2026_12_09 = 20_796; // a full trading day
    uint256 private constant THU_2026_12_10 = 20_797; // a full trading day
    uint64 private constant DAYLIGHT_END_2026 = 1_793_512_800; // Sun 2026-11-01 02:00 EDT, 06:00Z
    uint32 private constant EDT = 4 hours;
    string private constant EXTENSION_FIXTURE = "/test/fixtures/calendar_extension_vectors.json";

    function setUp() public {
        vm.warp(NOW);
        proposer = makeAddr("deployer");
        timelock = new SleeveTimelock(TIMELOCK_DELAY, _one(proposer), _one(proposer), address(0));
        _deployMockTokens();
        source = _deploy(_launchTickers());
    }

    // The floor

    function test_floorIs48Hours() public view {
        assertEq(SleeveTimelock(payable(address(timelock))).MIN_DELAY_FLOOR(), FLOOR, "floor");
        assertEq(timelock.getMinDelay(), FLOOR, "deployed at the floor");
    }

    function test_constructor_delayBelowTheFloor_reverts() public {
        uint256[3] memory belowFloor = [uint256(0), 1, FLOOR - 1];
        for (uint256 i; i < belowFloor.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(SleeveTimelock.DelayBelowFloor.selector, belowFloor[i], FLOOR));
            new SleeveTimelock(belowFloor[i], _one(proposer), _one(proposer), address(0));
        }
    }

    function test_ceilingIs30Days() public view {
        assertEq(SleeveTimelock(payable(address(timelock))).MIN_DELAY_CEILING(), CEILING, "ceiling");
        assertEq(CEILING, 2_592_000);
    }

    function test_constructor_delayAboveTheCeiling_reverts() public {
        uint256[3] memory aboveCeiling = [CEILING + 1, 365 days, type(uint256).max];
        for (uint256 i; i < aboveCeiling.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(SleeveTimelock.DelayAboveCeiling.selector, aboveCeiling[i], CEILING));
            new SleeveTimelock(aboveCeiling[i], _one(proposer), _one(proposer), address(0));
        }
    }

    /// @dev D-019: the constructor takes no extra admin, so no address can grant or revoke a role without the delay.
    function test_constructor_adminOtherThanZero_reverts() public {
        address[3] memory admins = [proposer, makeAddr("admin"), address(this)];
        for (uint256 i; i < admins.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(SleeveTimelock.AdminNotZero.selector, admins[i]));
            new SleeveTimelock(FLOOR, _one(proposer), _one(proposer), admins[i]);
        }
    }

    function test_constructor_acceptsTheFloorAndLonger() public {
        uint256[2] memory delays = [FLOOR, CEILING];
        for (uint256 i; i < delays.length; ++i) {
            vm.expectEmit(false, false, false, true);
            emit TimelockController.MinDelayChange(0, delays[i]);
            SleeveTimelock deployed = new SleeveTimelock(delays[i], _one(proposer), _one(proposer), address(0));
            assertEq(deployed.getMinDelay(), delays[i], "delay");
        }
    }

    /// @dev The case D-018 is about: an operation that lowers the delay, scheduled by the proposer with the full delay
    /// and executed once ready, still reverts.
    function test_I10_floorHoldsThroughAScheduledSelfOperation() public {
        uint256[3] memory belowFloor = [uint256(0), 1, FLOOR - 1];
        for (uint256 i; i < belowFloor.length; ++i) {
            bytes memory lower = abi.encodeCall(TimelockController.updateDelay, (belowFloor[i]));
            bytes32 salt = bytes32(i + 1);
            bytes32 id = _scheduleAndWait(address(timelock), lower, salt);
            assertTrue(timelock.isOperationReady(id), "scheduled, waited out and ready");
            vm.expectRevert(abi.encodeWithSelector(SleeveTimelock.DelayBelowFloor.selector, belowFloor[i], FLOOR));
            _execute(address(timelock), lower, salt);
            assertEq(timelock.getMinDelay(), FLOOR, "the delay stays at the floor");
            assertTrue(timelock.isOperationReady(id), "the operation never ran");
        }
    }

    /// @dev A batch that raises the delay and then lowers it below the floor reverts as a whole, raise included.
    function test_I10_floorHoldsThroughAScheduledBatch() public {
        address[] memory targets = new address[](2);
        targets[0] = address(timelock);
        targets[1] = address(timelock);
        uint256[] memory values = new uint256[](2);
        bytes[] memory payloads = new bytes[](2);
        payloads[0] = abi.encodeCall(TimelockController.updateDelay, (2 * FLOOR));
        payloads[1] = abi.encodeCall(TimelockController.updateDelay, (FLOOR - 1));
        vm.prank(proposer);
        timelock.scheduleBatch(targets, values, payloads, bytes32(0), bytes32(0), FLOOR);
        vm.warp(block.timestamp + FLOOR);
        vm.expectRevert(abi.encodeWithSelector(SleeveTimelock.DelayBelowFloor.selector, FLOOR - 1, FLOOR));
        vm.prank(proposer);
        timelock.executeBatch(targets, values, payloads, bytes32(0), bytes32(0));
        assertEq(timelock.getMinDelay(), FLOOR, "neither change landed");
    }

    function testFuzz_I10_updateDelay_belowTheFloorAlwaysReverts(uint256 newDelay) public {
        newDelay = bound(newDelay, 0, FLOOR - 1);
        bytes memory lower = abi.encodeCall(TimelockController.updateDelay, (newDelay));
        bytes32 id = _scheduleAndWait(address(timelock), lower, "lower");
        vm.expectRevert(abi.encodeWithSelector(SleeveTimelock.DelayBelowFloor.selector, newDelay, FLOOR));
        _execute(address(timelock), lower, "lower");
        assertEq(timelock.getMinDelay(), FLOOR, "unchanged");
        assertFalse(timelock.isOperationDone(id), "never ran");
    }

    function testFuzz_updateDelay_aboveTheCeilingAlwaysReverts(uint256 newDelay) public {
        newDelay = bound(newDelay, CEILING + 1, type(uint256).max);
        bytes memory raise = abi.encodeCall(TimelockController.updateDelay, (newDelay));
        bytes32 id = _scheduleAndWait(address(timelock), raise, "raise");
        vm.expectRevert(abi.encodeWithSelector(SleeveTimelock.DelayAboveCeiling.selector, newDelay, CEILING));
        _execute(address(timelock), raise, "raise");
        assertEq(timelock.getMinDelay(), FLOOR, "unchanged");
        assertFalse(timelock.isOperationDone(id), "never ran");
    }

    /// @dev Why the ceiling exists (D-019): a mistaken raise to years would freeze every admin write for that long.
    function test_updateDelay_aRaiseToAYearCannotFreezeAdminWrites() public {
        bytes memory freeze = abi.encodeCall(TimelockController.updateDelay, (365 days));
        _scheduleAndWait(address(timelock), freeze, "freeze");
        vm.expectRevert(abi.encodeWithSelector(SleeveTimelock.DelayAboveCeiling.selector, 365 days, CEILING));
        _execute(address(timelock), freeze, "freeze");

        bytes memory toCeiling = abi.encodeCall(TimelockController.updateDelay, (CEILING));
        _scheduleAndWait(address(timelock), toCeiling, "to the ceiling");
        _execute(address(timelock), toCeiling, "to the ceiling");
        assertEq(timelock.getMinDelay(), CEILING, "the ceiling itself is allowed");
    }

    function testFuzz_updateDelay_betweenTheFloorAndTheCeilingRuns(uint256 newDelay) public {
        newDelay = bound(newDelay, FLOOR, CEILING);
        bytes memory update = abi.encodeCall(TimelockController.updateDelay, (newDelay));
        bytes32 id = _scheduleAndWait(address(timelock), update, "update");
        vm.expectEmit(false, false, false, true, address(timelock));
        emit TimelockController.MinDelayChange(FLOOR, newDelay);
        _execute(address(timelock), update, "update");
        assertEq(timelock.getMinDelay(), newDelay, "new delay");
        assertTrue(timelock.isOperationDone(id), "ran");
    }

    /// @dev Raising works, every write then waits the longer delay, and the delay can come back down to the floor but
    /// not below it.
    function test_updateDelay_raisesThenLowersBackToTheFloor() public {
        uint256 raised = 3 days;
        bytes memory raise = abi.encodeCall(TimelockController.updateDelay, (raised));
        _scheduleAndWait(address(timelock), raise, "raise");
        vm.expectEmit(false, false, false, true, address(timelock));
        emit TimelockController.MinDelayChange(FLOOR, raised);
        _execute(address(timelock), raise, "raise");
        assertEq(timelock.getMinDelay(), raised, "raised");

        bytes memory remove = abi.encodeCall(TokenSource.removeTicker, (0));
        vm.expectRevert(abi.encodeWithSelector(TimelockController.TimelockInsufficientDelay.selector, FLOOR, raised));
        vm.prank(proposer);
        timelock.schedule(address(source), 0, remove, bytes32(0), "remove", FLOOR);
        _scheduleAndWait(address(source), remove, "remove");
        _execute(address(source), remove, "remove");
        (,,, bool active) = source.ticker(0);
        assertFalse(active, "removed after 72 hours");

        bytes memory backToFloor = abi.encodeCall(TimelockController.updateDelay, (FLOOR));
        _scheduleAndWait(address(timelock), backToFloor, "back to the floor");
        _execute(address(timelock), backToFloor, "back to the floor");
        assertEq(timelock.getMinDelay(), FLOOR, "back at the floor");

        bytes memory belowFloor = abi.encodeCall(TimelockController.updateDelay, (FLOOR - 1));
        _scheduleAndWait(address(timelock), belowFloor, "below the floor");
        vm.expectRevert(abi.encodeWithSelector(SleeveTimelock.DelayBelowFloor.selector, FLOOR - 1, FLOOR));
        _execute(address(timelock), belowFloor, "below the floor");
    }

    /// @dev The caller check comes first and is the stock one, so a direct call reverts the same way for a raise and
    /// for a value below the floor.
    function test_updateDelay_onlyTheTimelockItselfCanCallIt() public {
        address[3] memory callers = [proposer, makeAddr("stranger"), address(this)];
        uint256[2] memory delays = [2 * FLOOR, 0];
        for (uint256 i; i < callers.length; ++i) {
            for (uint256 j; j < delays.length; ++j) {
                vm.expectRevert(
                    abi.encodeWithSelector(TimelockController.TimelockUnauthorizedCaller.selector, callers[i])
                );
                vm.prank(callers[i]);
                timelock.updateDelay(delays[j]);
            }
        }
        assertEq(timelock.getMinDelay(), FLOOR, "unchanged");
    }

    /// @dev Why SleeveTimelock exists (D-018). With OpenZeppelin's own TimelockController as TokenSource's admin, one
    /// scheduled self-operation sets the delay to zero, and from then on a ticker removal runs in the block it is
    /// scheduled. The same operation on SleeveTimelock reverts.
    function test_stockTimelockCanDropItsDelayAndSleeveTimelockCannot() public {
        TimelockController stock = new TimelockController(TIMELOCK_DELAY, _one(proposer), _one(proposer), address(0));
        TokenSource exposed = new TokenSource(address(stock), address(usdg), address(factory), _launchTickers());
        bytes memory toZero = abi.encodeCall(TimelockController.updateDelay, (0));
        bytes memory remove = abi.encodeCall(TokenSource.removeTicker, (0));
        vm.startPrank(proposer);
        stock.schedule(address(stock), 0, toZero, bytes32(0), bytes32(0), TIMELOCK_DELAY);
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        stock.execute(address(stock), 0, toZero, bytes32(0), bytes32(0));
        assertEq(stock.getMinDelay(), 0, "the stock timelock has no delay left");
        stock.schedule(address(exposed), 0, remove, bytes32(0), bytes32(0), 0);
        stock.execute(address(exposed), 0, remove, bytes32(0), bytes32(0));
        vm.stopPrank();
        (,,, bool active) = exposed.ticker(0);
        assertFalse(active, "a removal ran in the block it was scheduled");

        bytes32 id = _scheduleAndWait(address(timelock), toZero, bytes32(0));
        vm.expectRevert(abi.encodeWithSelector(SleeveTimelock.DelayBelowFloor.selector, 0, FLOOR));
        _execute(address(timelock), toZero, bytes32(0));
        assertEq(timelock.getMinDelay(), FLOOR, "SleeveTimelock keeps its delay");
        assertFalse(timelock.isOperationDone(id), "the operation never ran");
    }

    // Roles, D-009 Q33

    /// @dev AccessControl gives a role only through _grantRole, which emits RoleGranted, so the deploy logs list every
    /// role holder: the timelock administers itself, and DEPLOYER alone proposes, cancels and executes.
    function test_I10_rolesAreOneAddressAndNoAdmin() public {
        vm.recordLogs();
        SleeveTimelock deployed = new SleeveTimelock(TIMELOCK_DELAY, _one(proposer), _one(proposer), address(0));
        Vm.Log[] memory logs = vm.getRecordedLogs();
        bytes32 adminRole = deployed.DEFAULT_ADMIN_ROLE();
        bytes32[4] memory roles =
            [adminRole, deployed.PROPOSER_ROLE(), deployed.CANCELLER_ROLE(), deployed.EXECUTOR_ROLE()];
        address[4] memory holders = [address(deployed), proposer, proposer, proposer];
        uint256 grants;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(deployed) || logs[i].topics[0] != IAccessControl.RoleGranted.selector) {
                continue;
            }
            assertLt(grants, roles.length, "no other grant");
            assertEq(logs[i].topics[1], roles[grants], "role");
            assertEq(address(uint160(uint256(logs[i].topics[2]))), holders[grants], "holder");
            ++grants;
        }
        assertEq(grants, roles.length, "four grants");
        for (uint256 i; i < roles.length; ++i) {
            assertTrue(deployed.hasRole(roles[i], holders[i]), "granted");
            assertEq(deployed.getRoleAdmin(roles[i]), adminRole, "only the admin role grants or revokes it");
        }
        assertFalse(deployed.hasRole(adminRole, proposer), "DEPLOYER is not an admin");
        assertFalse(deployed.hasRole(adminRole, address(this)), "the deploying account is not an admin");
        assertFalse(deployed.hasRole(deployed.EXECUTOR_ROLE(), address(0)), "execution is not open to anyone");
    }

    function test_I10_onlyTheDeployerSchedulesExecutesAndCancels() public {
        address stranger = makeAddr("stranger");
        bytes32 proposerRole = timelock.PROPOSER_ROLE();
        bytes32 executorRole = timelock.EXECUTOR_ROLE();
        bytes32 cancellerRole = timelock.CANCELLER_ROLE();
        bytes memory remove = abi.encodeCall(TokenSource.removeTicker, (0));

        vm.expectRevert(_unauthorized(stranger, proposerRole));
        vm.prank(stranger);
        timelock.schedule(address(source), 0, remove, bytes32(0), "remove", TIMELOCK_DELAY);

        bytes32 id = _schedule(address(source), remove, "remove");
        vm.expectRevert(_unauthorized(stranger, cancellerRole));
        vm.prank(stranger);
        timelock.cancel(id);
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        vm.expectRevert(_unauthorized(stranger, executorRole));
        vm.prank(stranger);
        timelock.execute(address(source), 0, remove, bytes32(0), "remove");

        vm.prank(proposer);
        timelock.cancel(id);
        vm.expectRevert(_notReady(id));
        _execute(address(source), remove, "remove");
        (,,, bool active) = source.ticker(0);
        assertTrue(active, "a cancelled removal never runs");
    }

    /// @dev With no admin, a role change is itself an operation: DEPLOYER cannot grant a role directly, and a
    /// scheduled grant waits out the delay like any write.
    function test_I10_roleChangesWaitOutTheDelay() public {
        address newcomer = makeAddr("newcomer");
        bytes32 proposerRole = timelock.PROPOSER_ROLE();
        vm.expectRevert(_unauthorized(proposer, timelock.DEFAULT_ADMIN_ROLE()));
        vm.prank(proposer);
        timelock.grantRole(proposerRole, newcomer);

        bytes memory grant = abi.encodeCall(IAccessControl.grantRole, (proposerRole, newcomer));
        _scheduleAndWait(address(timelock), grant, "grant");
        assertFalse(timelock.hasRole(proposerRole, newcomer), "not during the 48 hours");
        _execute(address(timelock), grant, "grant");
        assertTrue(timelock.hasRole(proposerRole, newcomer), "once 48 hours passed");
    }

    // TokenSource through SleeveTimelock

    function test_I10_tokenSource_removeTickerRunsOnlyAfter48Hours() public {
        bytes memory remove = abi.encodeCall(TokenSource.removeTicker, (1));
        _scheduleAndWait(address(source), remove, "remove QQQ");
        (,,, bool active) = source.ticker(1);
        assertTrue(active, "QQQ stays listed for the 48 hours");
        vm.expectEmit(true, true, false, true, address(source));
        emit TokenSource.TickerRemoved(1, address(qqq));
        _execute(address(source), remove, "remove QQQ");
        (,,, active) = source.ticker(1);
        assertFalse(active, "removed once 48 hours passed");
    }

    function test_I10_tokenSource_setPoolRunsOnlyAfter48Hours() public {
        bytes memory add = abi.encodeCall(TokenSource.setPool, (0, spyPool3000, true));
        _scheduleAndWait(address(source), add, "add");
        assertFalse(source.isPoolAllowed(0, spyPool3000), "not allowed during the 48 hours");
        vm.expectEmit(true, true, false, true, address(source));
        emit TokenSource.PoolSet(0, spyPool3000, 3000, true);
        _execute(address(source), add, "add");
        assertTrue(source.isPoolAllowed(0, spyPool3000), "allowed once 48 hours passed");

        bytes memory remove = abi.encodeCall(TokenSource.setPool, (0, spyPool500, false));
        _scheduleAndWait(address(source), remove, "remove");
        assertTrue(source.isPoolAllowed(0, spyPool500), "still allowed during the 48 hours");
        vm.expectEmit(true, true, false, true, address(source));
        emit TokenSource.PoolSet(0, spyPool500, 500, false);
        _execute(address(source), remove, "remove");
        assertFalse(source.isPoolAllowed(0, spyPool500), "removed once 48 hours passed");
    }

    function test_I10_schedulingUnder48Hours_reverts() public {
        SessionCalendarExtension calendar = new SessionCalendarExtension(address(timelock));
        address[2] memory targets = [address(source), address(calendar)];
        bytes[2] memory calls = [
            abi.encodeCall(TokenSource.removeTicker, (0)),
            abi.encodeCall(SessionCalendarExtension.addClosure, (WED_2026_12_09))
        ];
        for (uint256 i; i < targets.length; ++i) {
            vm.expectRevert(
                abi.encodeWithSelector(TimelockController.TimelockInsufficientDelay.selector, FLOOR - 1, FLOOR)
            );
            vm.prank(proposer);
            timelock.schedule(targets[i], 0, calls[i], bytes32(0), bytes32(0), FLOOR - 1);
        }
    }

    // SessionCalendarExtension through SleeveTimelock

    /// @dev Each of the calendar's four writes changes nothing during the 48 hours and lands once they pass.
    function test_I10_calendar_everyWriteRunsOnlyAfter48Hours() public {
        SessionCalendarExtension calendar = new SessionCalendarExtension(address(timelock));
        bytes[4] memory writes = [
            _append2028(),
            abi.encodeCall(SessionCalendarExtension.addClosure, (WED_2026_12_09)),
            abi.encodeCall(SessionCalendarExtension.addEarlyClose, (THU_2026_12_10)),
            abi.encodeCall(SessionCalendarExtension.replaceFutureSwitch, (DAYLIGHT_END_2026, DAYLIGHT_END_2026, EDT))
        ];
        uint32 version = calendar.version();
        for (uint256 i; i < writes.length; ++i) {
            bytes32 salt = bytes32(i + 1);
            _scheduleAndWait(address(calendar), writes[i], salt);
            assertEq(calendar.version(), version, "nothing written during the 48 hours");
            _execute(address(calendar), writes[i], salt);
            assertEq(calendar.version(), ++version, "written once 48 hours passed");
        }
        assertEq(calendar.lastYear(), 2028, "2028 appended");
        assertEq(uint8(calendar.dayKind(WED_2026_12_09)), uint8(SessionCalendar.DayKind.HOLIDAY), "closure");
        assertEq(uint8(calendar.dayKind(THU_2026_12_10)), uint8(SessionCalendar.DayKind.EARLY_CLOSE), "early close");
        assertEq(calendar.offsetSwitches()[1].offset, EDT, "the November 2026 switch now keeps daylight time");
    }

    // Helpers

    /// @dev Schedules a call at the delay in force and shows it cannot run at once or one second before the delay
    /// ends. Leaves the clock at the first second it can run.
    function _scheduleAndWait(address target, bytes memory data, bytes32 salt) private returns (bytes32 id) {
        uint256 delay = timelock.getMinDelay();
        vm.prank(proposer);
        timelock.schedule(target, 0, data, bytes32(0), salt, delay);
        id = timelock.hashOperation(target, 0, data, bytes32(0), salt);
        vm.expectRevert(_notReady(id));
        _execute(target, data, salt);
        vm.warp(block.timestamp + delay - 1);
        vm.expectRevert(_notReady(id));
        _execute(target, data, salt);
        vm.warp(block.timestamp + 1);
    }

    /// @dev appendYear(2028) with the extension fixture's test input, as SessionCalendarExtension's own tests use it.
    function _append2028() private view returns (bytes memory) {
        string memory json = vm.readFile(string.concat(vm.projectRoot(), EXTENSION_FIXTURE));
        uint256[] memory at = vm.parseJsonUintArray(json, ".append2028.switchAt");
        uint256[] memory offset = vm.parseJsonUintArray(json, ".append2028.switchOffset");
        SessionCalendar.OffsetSwitch[] memory switches = new SessionCalendar.OffsetSwitch[](at.length);
        for (uint256 i; i < at.length; ++i) {
            switches[i] = SessionCalendar.OffsetSwitch(uint64(at[i]), uint32(offset[i]));
        }
        return abi.encodeCall(
            SessionCalendarExtension.appendYear,
            (
                vm.parseJsonUint(json, ".append2028.year"),
                switches,
                vm.parseJsonUintArray(json, ".append2028.holidays"),
                vm.parseJsonUintArray(json, ".append2028.earlyCloses")
            )
        );
    }

    function _unauthorized(address account, bytes32 role) private pure returns (bytes memory) {
        return abi.encodeWithSelector(IAccessControl.AccessControlUnauthorizedAccount.selector, account, role);
    }

    function _one(address account) private pure returns (address[] memory accounts) {
        accounts = new address[](1);
        accounts[0] = account;
    }
}
