// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {SessionCalendarExtension} from "../../src/SessionCalendarExtension.sol";
import {SleeveModule} from "../../src/SleeveModule.sol";
import {SleeveTimelock} from "../../src/SleeveTimelock.sol";
import {TokenSource} from "../../src/TokenSource.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {SessionCalendar} from "../../src/libraries/SessionCalendar.sol";
import {Status} from "../../src/types/SleeveTypes.sol";
import {SleeveModuleTradeUnitBase} from "../harness/SleeveModuleTradeUnitBase.sol";
import {MockAccount} from "../mocks/MockAccount.sol";

/// @notice Audit round 1, admin powers, after the fixes: A1-18 (an active ticker's last pool cannot be removed, and a
/// launch ticker with a feed needs a pool) and A1-26 (the module binds to one SleeveTimelock at its 48-hour floor, and
/// SleeveTimelock refuses empty and zero role holders). A1-17 and A1-27 are pinned as built until the owner answers:
/// a trigger's pool off a non-empty allowlist reverts instead of refusing the ticker, and a ticker's session type is
/// fixed at construction.
contract AuditAdminTest is SleeveModuleTradeUnitBase {
    uint256 private constant FLOOR = 172_800;
    uint256 private constant EQUITY = 50e6;

    address private deployerEoa = makeAddr("DEPLOYER");

    function setUp() public {
        _setUpTrade();
    }

    // A1-18

    /// Removing the only pool of an active ticker reverts, so a rotation adds the new pool first and buys go on with a
    /// pool throughout. A remove-first rotation used to empty the list, and every split and settle on the ticker then
    /// refused its equity to spend for anyone who asked.
    function test_A1_18_activeTickersLastPoolCannotBeRemoved_rotationAddsFirst() public {
        address oldPool = _pool(SPY);
        vm.expectRevert(abi.encodeWithSelector(TokenSource.LastPoolOfActiveTicker.selector, SPY, oldPool));
        tokenSource.setPool(SPY, oldPool, false);

        address newPool = factory.createPool(address(usdg), address(tokens[SPY]), 3000);
        tokenSource.setPool(SPY, newPool, true);
        tokenSource.setPool(SPY, oldPool, false);
        assertEq(tokenSource.poolsOf(SPY).length, 1, "rotated with a pool throughout");

        MockAccount account = _account(_defaultRule(), PAYMENT);
        vm.recordLogs();
        _keeperSplit(address(account));
        assertEq(uint8(_onlyReceipt(vm.getRecordedLogs()).status), uint8(Status.FILLED), "buys continue");
    }

    /// A removed ticker may still empty its list, so a drained pool can be dropped while owners sell what they hold.
    function test_A1_18_removedTickerMayStillEmptyItsList() public {
        tokenSource.removeTicker(SPY);
        tokenSource.setPool(SPY, _pool(SPY), false);
        assertEq(tokenSource.poolsOf(SPY).length, 0);
    }

    function test_A1_18_constructorRefusesAFeedTickerWithoutPools() public {
        TokenSource.TickerInit[] memory tickers = new TokenSource.TickerInit[](1);
        tickers[0] = TokenSource.TickerInit({
            token: address(tokens[SPY]),
            feed: address(feeds[SPY]),
            sessionType: SessionCalendar.SessionType.ALL_DAY,
            pools: new address[](0)
        });
        vm.expectRevert(abi.encodeWithSelector(TokenSource.NoPools.selector, address(tokens[SPY])));
        new TokenSource(address(this), address(usdg), address(factory), tickers);
    }

    // A1-26

    /// An OpenZeppelin TimelockController with no delay used to pass every check and bind the immutable module to
    /// admin writes that run in the block they are scheduled.
    function test_A1_26_moduleRefusesAZeroDelayTimelock() public {
        TimelockController instant = new TimelockController(0, _one(deployerEoa), _one(deployerEoa), address(0));
        (TokenSource source, SessionCalendarExtension cal) = _wiredTo(address(instant), address(instant));
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.TimelockNotSleeve.selector, address(instant)));
        _moduleOn(source, cal);
    }

    function test_A1_26_moduleRefusesTwoTimelocks() public {
        SleeveTimelock a = new SleeveTimelock(FLOOR, _one(deployerEoa), _one(deployerEoa), address(0));
        SleeveTimelock b = new SleeveTimelock(FLOOR, _one(deployerEoa), _one(deployerEoa), address(0));
        (TokenSource source, SessionCalendarExtension cal) = _wiredTo(address(a), address(b));
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.TimelockMismatch.selector, address(a), address(b)));
        _moduleOn(source, cal);
    }

    /// An EOA with an EIP-7702 designator has 23 bytes of code and passed TokenSource's and the calendar's code
    /// checks; the module refuses it as admin.
    function test_A1_26_moduleRefusesADelegatedEoa() public {
        vm.etch(deployerEoa, abi.encodePacked(hex"ef0100", address(this)));
        (TokenSource source, SessionCalendarExtension cal) = _wiredTo(deployerEoa, deployerEoa);
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.TimelockNotSleeve.selector, deployerEoa));
        _moduleOn(source, cal);
    }

    function test_A1_26_moduleAcceptsOneSleeveTimelock() public {
        SleeveTimelock timelock = new SleeveTimelock(FLOOR, _one(deployerEoa), _one(deployerEoa), address(0));
        (TokenSource source, SessionCalendarExtension cal) = _wiredTo(address(timelock), address(timelock));
        SleeveModule bound = _moduleOn(source, cal);
        assertEq(address(bound.tokenSource()), address(source));
        assertEq(address(bound.calendar()), address(cal));
    }

    /// No proposer or no executor would freeze every admin write for good, and address(0) as an executor would let
    /// anyone execute a ready operation.
    function test_A1_26_sleeveTimelockRefusesEmptyAndZeroRoleHolders() public {
        vm.expectRevert(SleeveTimelock.NoRoleHolder.selector);
        new SleeveTimelock(FLOOR, new address[](0), _one(deployerEoa), address(0));
        vm.expectRevert(SleeveTimelock.NoRoleHolder.selector);
        new SleeveTimelock(FLOOR, _one(deployerEoa), new address[](0), address(0));
        vm.expectRevert(SleeveTimelock.ZeroRoleHolder.selector);
        new SleeveTimelock(FLOOR, _one(deployerEoa), new address[](1), address(0));
        vm.expectRevert(SleeveTimelock.ZeroRoleHolder.selector);
        new SleeveTimelock(FLOOR, new address[](1), _one(deployerEoa), address(0));
    }

    // A1-17: open owner question

    /// Pinned as built until the owner answers (PRD 7.4 step 1 reads REFUSED_TICKER): a trigger's pool off a non-empty
    /// allowlist reverts PoolNotAllowed with nothing moved, so a public caller after the grace cannot push the equity
    /// part into spend by passing a junk pool.
    function test_A1_17_open_poolOffANonEmptyAllowlistReverts() public {
        MockAccount account = _account(_defaultRule(), PAYMENT);
        vm.prank(stranger);
        module.observe(address(account));
        vm.warp(block.timestamp + GRACE);
        address junk = makeAddr("junk pool");
        State memory before = _state(address(account));
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.PoolNotAllowed.selector, SPY, junk));
        vm.prank(stranger);
        module.split(address(account), junk, 1);
        _assertUnchanged(before, _state(address(account)));
    }

    // A1-27: open owner question

    /// Pinned as built until the owner answers: no write changes a ticker's session type, so a ticker that loses
    /// overnight trading keeps ALL_DAY, and the only lever is the one-way removeTicker.
    function test_A1_27_open_sessionTypeIsFixedAndRemovalIsTheOnlyLever() public {
        address second = factory.createPool(address(usdg), address(tokens[SPY]), 3000);
        tokenSource.setPool(SPY, second, true);
        tokenSource.setPool(SPY, _pool(SPY), false);
        (,, SessionCalendar.SessionType sessionType,) = tokenSource.ticker(SPY);
        assertEq(uint8(sessionType), uint8(SessionCalendar.SessionType.ALL_DAY), "still ALL_DAY");
        tokenSource.removeTicker(SPY);
        vm.expectRevert(abi.encodeWithSelector(TokenSource.TickerAlreadyRemoved.selector, SPY));
        tokenSource.removeTicker(SPY);
    }

    // Helpers

    function _wiredTo(address sourceAdmin, address calendarAdmin)
        private
        returns (TokenSource source, SessionCalendarExtension cal)
    {
        address[] memory pools = new address[](1);
        pools[0] = _pool(SPY);
        TokenSource.TickerInit[] memory tickers = new TokenSource.TickerInit[](1);
        tickers[0] = TokenSource.TickerInit({
            token: address(tokens[SPY]),
            feed: address(feeds[SPY]),
            sessionType: SessionCalendar.SessionType.ALL_DAY,
            pools: pools
        });
        source = new TokenSource(sourceAdmin, address(usdg), address(factory), tickers);
        cal = new SessionCalendarExtension(calendarAdmin);
    }

    function _moduleOn(TokenSource source, SessionCalendarExtension cal) private returns (SleeveModule) {
        ISleeveModule.ModuleConfig memory config = _config();
        config.tokenSource = source;
        config.calendar = cal;
        return new SleeveModule(config);
    }

    function _one(address account) private pure returns (address[] memory list) {
        list = new address[](1);
        list[0] = account;
    }
}
