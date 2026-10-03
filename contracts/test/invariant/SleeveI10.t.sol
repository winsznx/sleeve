// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {SessionCalendarExtension} from "../../src/SessionCalendarExtension.sol";
import {SleeveTimelock} from "../../src/SleeveTimelock.sol";
import {TokenSource} from "../../src/TokenSource.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {SessionCalendar} from "../../src/libraries/SessionCalendar.sol";
import {InvPool} from "../mocks/InvPool.sol";
import {SleeveInvariantBase} from "./SleeveInvariants.t.sol";
import {SleeveHandler} from "./handlers/SleeveHandler.sol";

/// @notice I10 through the real SleeveTimelock: every write the timelock can make, scheduled, delayed 48 hours and
/// executed, leaves every account's ledgers, buckets, rule, keeper, observation and lots, the receipt log and every
/// tracked USDG and stock token balance exactly as they were. The state comes from a seeded run of the invariant
/// suite's handler, so it holds spend, buckets, lots and receipts on several accounts. Calls the timelock might try
/// against the module, USDG and the stock tokens revert, because the module has no admin and the timelock holds no
/// approval.
contract SleeveI10Test is SleeveInvariantBase {
    uint256 private constant DELAY = 172_800;
    uint32 private constant EDT = 4 hours;
    uint32 private constant EST = 5 hours;
    uint256 private constant ACCOUNTS = 3;
    uint256 private constant TICKERS = 4;
    uint256 private constant ASSETS = 5;
    string private constant EXTENSION_FIXTURE = "test/fixtures/calendar_extension_vectors.json";

    SleeveTimelock private timelock;
    TokenSource private tokenSource;
    SessionCalendarExtension private calendar;
    address private proposer = makeAddr("deployer");
    uint256 private salt;

    function setUp() public {
        address[] memory roles = new address[](1);
        roles[0] = proposer;
        timelock = new SleeveTimelock(DELAY, roles, roles, address(0));
        _deploy(address(timelock));
        tokenSource = module.tokenSource();
        calendar = module.calendar();
        _driveUntilEveryLedgerIsInUse();
    }

    /// I10: TokenSource's two writes, ticker removal and the pool allowlist both ways, move nothing and change no
    /// account's state.
    function test_I10_tokenSourceWritesChangeNoLedgerBucketRuleOrBalance() public {
        bytes32 before = _fingerprint();

        _execute(address(tokenSource), abi.encodeCall(TokenSource.removeTicker, (1)));
        (,,, bool active) = tokenSource.ticker(1);
        assertFalse(active, "ticker 1 removed");
        assertEq(_fingerprint(), before, "I10: removeTicker");

        address spy500 = handler.poolAt(0);
        _execute(address(tokenSource), abi.encodeCall(TokenSource.setPool, (0, spy500, false)));
        assertFalse(tokenSource.isPoolAllowed(0, spy500), "pool removed");
        assertEq(_fingerprint(), before, "I10: setPool remove");

        address spy100 = handler.poolAt(2);
        _execute(address(tokenSource), abi.encodeCall(TokenSource.setPool, (0, spy100, true)));
        assertTrue(tokenSource.isPoolAllowed(0, spy100), "pool added");
        assertEq(_fingerprint(), before, "I10: setPool add");

        _execute(address(tokenSource), abi.encodeCall(TokenSource.removeTicker, (2)));
        assertEq(_fingerprint(), before, "I10: removing a ticker an account's rule names");
        assertEq(tokenSource.tickerCount(), TICKERS, "I10: no write adds a ticker");
    }

    /// I10: the timelock can install the module on itself like any contract, and then it holds an account of its own
    /// and nothing more: its rule, keeper and pause reach only that state (D-015), so no owner's ledgers, buckets,
    /// rule or balances change.
    function test_I10_theTimelockAsItsOwnAccountReachesNoOneElse() public {
        bytes32 before = _fingerprint();
        address self = address(timelock);
        ISleeveModule.RuleInput memory rule = ISleeveModule.RuleInput(5_000, 5_000, 0, 500, 500, 1e6);

        _execute(address(module), abi.encodeCall(ISleeveModule.onInstall, (abi.encode(address(0), rule))));
        rule.tickerId = 2;
        _execute(address(module), abi.encodeCall(ISleeveModule.setRule, (rule)));
        _execute(address(module), abi.encodeCall(ISleeveModule.setKeeper, (self)));
        _execute(address(module), abi.encodeCall(ISleeveModule.pauseRule, ()));

        assertTrue(module.isInitialized(self), "the timelock installed the module on itself");
        assertEq(module.ruleOf(self).version, 2, "its own rule versions");
        assertEq(module.keeperOf(self), self, "its own keeper");
        for (uint256 i; i < ACCOUNTS; ++i) {
            assertTrue(module.keeperOf(handler.accountAt(i)) != self, "no owner's keeper became the timelock");
        }
        assertEq(_fingerprint(), before, "I10: the timelock's own account");
    }

    /// I10: the calendar's writes, a closure, an early close, a daylight-saving replacement and a new year, move
    /// nothing and change no account's state.
    function test_I10_calendarWritesChangeNoLedgerBucketRuleOrBalance() public {
        bytes32 before = _fingerprint();
        uint32 version = calendar.version();

        SessionCalendar.OffsetSwitch memory next = _switchAhead();
        uint32 other = next.offset == EDT ? EST : EDT;
        _execute(
            address(calendar), abi.encodeCall(SessionCalendarExtension.replaceFutureSwitch, (next.at, next.at, other))
        );
        assertEq(_fingerprint(), before, "I10: replaceFutureSwitch");

        _execute(address(calendar), abi.encodeCall(SessionCalendarExtension.addClosure, (_tradingDayAhead(0))));
        assertEq(_fingerprint(), before, "I10: addClosure");

        _execute(address(calendar), abi.encodeCall(SessionCalendarExtension.addEarlyClose, (_tradingDayAhead(1))));
        assertEq(_fingerprint(), before, "I10: addEarlyClose");

        _execute(address(calendar), _append2028());
        assertEq(calendar.lastYear(), 2028, "2028 appended");
        assertEq(_fingerprint(), before, "I10: appendYear");
        assertEq(calendar.version(), version + 4, "every write ran");
    }

    /// I10: the timelock administering itself, a new delay and a new proposer, moves nothing.
    function test_I10_timelockSelfAdministrationChangesNoLedgerBucketRuleOrBalance() public {
        bytes32 before = _fingerprint();

        _execute(address(timelock), abi.encodeCall(SleeveTimelock.updateDelay, (3 days)));
        assertEq(timelock.getMinDelay(), 3 days);
        assertEq(_fingerprint(), before, "I10: updateDelay");

        bytes32 proposerRole = timelock.PROPOSER_ROLE();
        _execute(address(timelock), abi.encodeCall(IAccessControl.grantRole, (proposerRole, makeAddr("second"))));
        assertEq(_fingerprint(), before, "I10: grantRole");
    }

    /// I10: what the timelock might try against the module, USDG and the stock tokens reverts. The module keys every
    /// owner function by its caller and executeBuy by itself, so the timelock reaches only its own empty state, and
    /// the timelock holds no approval from any account.
    function test_I10_theTimelockCannotReachAnAccountsFundsOrState() public {
        bytes32 before = _fingerprint();
        address victim = handler.accountAt(0);
        address self = address(timelock);
        bytes memory notInstalled = abi.encodeWithSelector(ISleeveModule.NotInstalled.selector, self);

        _executeReverts(address(module), abi.encodeCall(ISleeveModule.release, (0)), notInstalled);
        _executeReverts(address(module), abi.encodeCall(ISleeveModule.pauseRule, ()), notInstalled);
        _executeReverts(address(module), abi.encodeCall(ISleeveModule.setKeeper, (self)), notInstalled);
        _executeReverts(address(module), abi.encodeCall(ISleeveModule.onUninstall, ("")), notInstalled);
        _executeReverts(address(module), abi.encodeCall(ISleeveModule.beginOwnerOp, ()), notInstalled);
        ISleeveModule.BuyOrder memory order;
        order.account = victim;
        order.token = address(tokens[0]);
        order.pool = handler.poolAt(0);
        order.amountIn = 1;
        _executeReverts(
            address(module),
            abi.encodeCall(ISleeveModule.executeBuy, (order)),
            abi.encodeWithSelector(ISleeveModule.NotSelf.selector, self)
        );
        uint256 balance = usdg.balanceOf(victim);
        _executeReverts(
            address(usdg),
            abi.encodeCall(IERC20.transferFrom, (victim, self, balance)),
            abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, self, 0, balance)
        );
        address lookalike = address(new InvPool(IERC20(address(usdg)), IERC20(address(tokens[0])), 500, 500e8));
        _executeReverts(
            address(tokenSource),
            abi.encodeCall(TokenSource.setPool, (0, lookalike, true)),
            abi.encodeWithSelector(TokenSource.PoolNotCanonical.selector, address(tokens[0]), lookalike)
        );

        assertEq(_fingerprint(), before, "I10: nothing the timelock tried changed anything");
    }

    // Setup

    /// @dev Runs seeded handler sequences without the handler's own admin writes until every account has spend and
    /// at least one account has a bucket and a lot, so the fingerprint covers live ledgers. Uninstalls, pauses and
    /// drains through an old approval are left out: they take ledgers out of use, and the drain is the invariant
    /// suite's I6 probe, not part of this setup.
    function _driveUntilEveryLedgerIsInUse() private {
        bytes4[] memory list = _weightedSelectors();
        uint256 rng = uint256(keccak256("I10"));
        for (uint256 i; i < 1_024 && !_inUse(); ++i) {
            rng = uint256(keccak256(abi.encode(rng)));
            bytes4 selector = list[rng % list.length];
            if (_isAdminAction(selector) || _takesAnAccountOut(selector)) continue;
            _step(selector, uint256(keccak256(abi.encode(rng, 1))), uint256(keccak256(abi.encode(rng, 2))));
        }
        assertTrue(_inUse(), "the seeded run left a ledger unused");
        for (uint8 kind; kind < V_KINDS; ++kind) {
            _assertNoViolation(kind);
        }
    }

    function _inUse() private view returns (bool) {
        bool bucket;
        bool lot;
        for (uint256 i; i < ACCOUNTS; ++i) {
            address account = handler.accountAt(i);
            (, uint256 spend, uint256 pendingTotal,) = module.ledger(account);
            if (spend == 0) return false;
            if (pendingTotal != 0) bucket = true;
        }
        lot = handler.lotIds().length != 0;
        return bucket && lot;
    }

    function _isAdminAction(bytes4 selector) private pure returns (bool) {
        return selector == SleeveHandler.adminRemoveTicker.selector || selector == SleeveHandler.adminSetPool.selector
            || selector == SleeveHandler.adminCalendarWrite.selector;
    }

    function _takesAnAccountOut(bytes4 selector) private pure returns (bool) {
        return selector == SleeveHandler.uninstall.selector || selector == SleeveHandler.pauseOrResumeRule.selector
            || selector == SleeveHandler.drainThenTopUp.selector;
    }

    // The timelock

    function _execute(address target, bytes memory data) private {
        bytes32 id = _schedule(target, data);
        vm.prank(proposer);
        timelock.execute(target, 0, data, bytes32(0), bytes32(salt));
        assertTrue(timelock.isOperationDone(id), "executed");
    }

    /// @dev Schedules and waits out the delay, then expects the execution to revert with `reason`, or with anything
    /// when `reason` is empty.
    function _executeReverts(address target, bytes memory data, bytes memory reason) private {
        _schedule(target, data);
        if (reason.length == 0) vm.expectRevert();
        else vm.expectRevert(reason);
        vm.prank(proposer);
        timelock.execute(target, 0, data, bytes32(0), bytes32(salt));
    }

    function _schedule(address target, bytes memory data) private returns (bytes32 id) {
        ++salt;
        uint256 delay = timelock.getMinDelay();
        vm.prank(proposer);
        timelock.schedule(target, 0, data, bytes32(0), bytes32(salt), delay);
        id = timelock.hashOperation(target, 0, data, bytes32(0), bytes32(salt));
        vm.warp(block.timestamp + delay - 1);
        vm.expectRevert();
        vm.prank(proposer);
        timelock.execute(target, 0, data, bytes32(0), bytes32(salt));
        vm.warp(block.timestamp + 1);
    }

    // Calendar inputs

    /// @dev The `skip`-th full trading day at least a delay plus a day ahead, so a closure scheduled now is still
    /// before its deadline when it executes.
    function _tradingDayAhead(uint256 skip) private view returns (uint256 day) {
        day = (block.timestamp + DELAY) / 1 days + 2;
        while (true) {
            if (calendar.dayKind(day) == SessionCalendar.DayKind.TRADING) {
                if (skip == 0) return day;
                --skip;
            }
            ++day;
        }
    }

    /// @dev The first offset switch still in the future once the delay has passed.
    function _switchAhead() private view returns (SessionCalendar.OffsetSwitch memory) {
        SessionCalendar.OffsetSwitch[] memory switches = calendar.offsetSwitches();
        for (uint256 i; i < switches.length; ++i) {
            if (switches[i].at > block.timestamp + DELAY) return switches[i];
        }
        revert("no future switch");
    }

    function _append2028() private view returns (bytes memory) {
        string memory json = vm.readFile(EXTENSION_FIXTURE);
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

    // What must not change

    /// @dev Every account's installed flag, ledgers, buckets, rule, keeper, observation and lot queues, every lot and
    /// receipt hash, the next receipt id, and every tracked holder's USDG and stock token balances. The unsorted
    /// figure from ledger() is a function of the balance, so it is covered too.
    function _fingerprint() private view returns (bytes32) {
        bytes memory state = abi.encode(module.nextReceiptId());
        for (uint256 i; i < ACCOUNTS; ++i) {
            state = bytes.concat(state, _accountState(handler.accountAt(i)));
        }
        uint256[] memory lotIds = handler.lotIds();
        for (uint256 i; i < lotIds.length; ++i) {
            state = bytes.concat(state, abi.encode(module.lot(lotIds[i])));
        }
        for (uint256 id = 1; id < module.nextReceiptId(); ++id) {
            state = bytes.concat(state, module.receiptHash(id));
        }
        address[] memory holders = handler.trackedHolders();
        for (uint256 h; h < holders.length; ++h) {
            state = bytes.concat(state, abi.encode(usdg.balanceOf(holders[h])));
            for (uint256 t; t < ASSETS - 1; ++t) {
                state = bytes.concat(state, abi.encode(tokens[t].balanceOf(holders[h])));
            }
        }
        return keccak256(state);
    }

    function _accountState(address account) private view returns (bytes memory state) {
        (uint256 balance, uint256 spend, uint256 pendingTotal, uint256 unsorted) = module.ledger(account);
        (uint64 observedAt, uint128 observedUnsorted) = module.observationOf(account);
        state = abi.encode(
            module.isInitialized(account),
            balance,
            spend,
            pendingTotal,
            unsorted,
            module.ruleOf(account),
            module.keeperOf(account),
            observedAt,
            observedUnsorted
        );
        for (uint8 t; t < TICKERS; ++t) {
            (uint256[] memory ids, uint256 head) = module.lotsOf(account, t);
            state = bytes.concat(state, abi.encode(module.bucketOf(account, t), ids, head));
        }
    }
}
