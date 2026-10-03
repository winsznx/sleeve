// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {Reason, Status, Trigger} from "../../src/types/SleeveTypes.sol";
import {SleeveModuleForkTradeBase} from "../harness/SleeveModuleForkTradeBase.sol";
import {LaunchConfig} from "../mocks/LaunchConfig.sol";
import {Chain4663} from "../utils/Chain4663.sol";

/// @notice The closed market and the reopen on chain 4663, with the real feeds, pools and calendar: SESSION at block
/// 73,280,794 (Saturday 26 September 2026 14:00 EDT), STALE at the Sunday 20:00 EDT reopen while the feeds still hold
/// Friday's rounds, STALE by age inside the session from block 74,351,992 (a minute after the reopen's first rounds),
/// a fill on the real first round after the reopen, and a weekend queue settled after the reopen.
/// @dev Fallbacks, listed: a fork cannot hold one block's state at a later block, and no round lands in a fork, so
/// the weekend settle feeds the real first rounds after the reopen through vm.mockCall on latestRoundData, with the
/// values getRoundData returns for those round ids at block 78,312,136. The isolated fresh-round-after-reopen case
/// mocks a round one second before the opening, which no past closure on this chain produced inside 25 hours.
contract SleeveModuleWeekendForkTest is SleeveModuleForkTradeBase {
    /// @dev Sunday 27 September 2026 20:00 EDT, the reopen.
    uint256 private constant REOPEN = 1_790_553_600;
    /// @dev The timestamp of REOPEN_BLOCK.
    uint256 private constant REOPEN_BLOCK_TIME = 1_790_553_700;
    /// @dev Saturday 26 September 2026 14:00 EDT, the timestamp of WEEKEND_BLOCK.
    uint256 private constant WEEKEND_TIME = 1_790_445_600;

    /// @dev The first SPY round after the reopen, (phase 1, round 147), and the USDG/USD round in force then.
    uint80 private constant SPY_ROUND_147 = 18_446_744_073_709_551_763;
    int256 private constant SPY_ANSWER_147 = 77_121_266_423;
    uint256 private constant SPY_STARTED_147 = 1_790_553_628;
    uint256 private constant SPY_UPDATED_147 = 1_790_553_640;
    uint80 private constant USDG_ROUND_115 = 18_446_744_073_709_551_731;
    int256 private constant USDG_ANSWER_115 = 99_994_000;
    uint256 private constant USDG_STARTED_115 = 1_790_523_484;
    uint256 private constant USDG_UPDATED_115 = 1_790_523_496;

    // SESSION

    function test_fork_QUEUED_SESSION_onEveryAllowlistedPool() public {
        _setUpTradeAt(WEEKEND_BLOCK);
        assertEq(block.timestamp, WEEKEND_TIME);
        assertEq(module.sessionOpenedAt(SPY), 0, "closed");
        Leg[5] memory legs = _legs();
        for (uint256 i; i < legs.length; ++i) {
            address account = _account(bytes32(i), _ruleOn(legs[i].tickerId));
            uint256 quote = _quote(legs[i].tickerId, legs[i].pool, EQUITY);
            ISleeveModule.Receipt memory receipt = _onlyReceipt(_keeperSplit(account, legs[i].pool, quote));
            _assertQueued(receipt, account, legs[i].tickerId, Reason.SESSION);
            assertEq(receipt.roundId, 0, "the guard stopped at the session");
        }
    }

    function test_fork_settle_guardNotClear_SESSION() public {
        _setUpTradeAt(WEEKEND_BLOCK);
        address account = _account(0, _defaultRule());
        uint256 quote = _quote(SPY, LaunchConfig.SPY_POOL_500, EQUITY);
        _keeperSplit(account, LaunchConfig.SPY_POOL_500, quote);
        bytes memory before = _bucketState(account);
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, Reason.SESSION));
        vm.prank(keeper);
        module.settle(account, SPY, LaunchConfig.SPY_POOL_500, quote);
        assertEq(_bucketState(account), before, "nothing changed");
    }

    // STALE

    /// B2-2 at the real reopen: 30 seconds after Sunday 20:00 EDT the feeds still hold Friday's rounds, older than the
    /// opening, so the split queues STALE until the first round of the week lands.
    function test_fork_QUEUED_STALE_atTheReopenBeforeTheFirstRound() public {
        _setUpTradeAt(WEEKEND_BLOCK);
        address account = _account(0, _defaultRule());
        uint256 quote = _quote(SPY, LaunchConfig.SPY_POOL_500, EQUITY);
        vm.warp(REOPEN + 30);
        assertEq(module.sessionOpenedAt(SPY), REOPEN, "open since 20:00");

        ISleeveModule.Receipt memory receipt = _onlyReceipt(_keeperSplit(account, LaunchConfig.SPY_POOL_500, quote));

        _assertQueued(receipt, account, SPY, Reason.STALE);
        assertEq(receipt.updatedAt, 1_790_352_180, "Friday's held round");
        assertLt(receipt.updatedAt, REOPEN, "from before the opening");
    }

    /// The real first SPY round after the reopen lands 40 seconds in. A minute later the split fills on it: the
    /// fresh-round check passes on a round from the opening on.
    function test_fork_FILLED_onTheFirstRealRoundAfterTheReopen() public {
        _setUpTradeAt(REOPEN_BLOCK);
        assertEq(block.timestamp, REOPEN_BLOCK_TIME);
        address account = _account(0, _defaultRule());
        uint256 quote = _quote(SPY, LaunchConfig.SPY_POOL_500, EQUITY);
        Leg memory leg = _legs()[0];
        Measured memory m = _measure(account, SPY, leg.pool);

        ISleeveModule.Receipt memory receipt = _onlyReceipt(_keeperSplit(account, leg.pool, quote));

        _assertFill(receipt, account, leg, m, Status.FILLED, Trigger.KEEPER, PAYMENT, EQUITY, quote);
        assertEq(receipt.roundId, SPY_ROUND_147);
        assertEq(receipt.updatedAt, SPY_UPDATED_147);
        assertGe(receipt.updatedAt, REOPEN);
    }

    /// The age limit alone: the first round of the week is from after the opening, and 25 hours and one second later,
    /// with no round since, the session is still open and the split queues STALE.
    function test_fork_QUEUED_STALE_byAgeInsideTheSession() public {
        _setUpTradeAt(REOPEN_BLOCK);
        address account = _account(0, _defaultRule());
        uint256 quote = _quote(SPY, LaunchConfig.SPY_POOL_500, EQUITY);
        vm.warp(SPY_UPDATED_147 + 25 hours + 1);
        assertEq(module.sessionOpenedAt(SPY), REOPEN, "the same session");

        ISleeveModule.Receipt memory receipt = _onlyReceipt(_keeperSplit(account, LaunchConfig.SPY_POOL_500, quote));

        _assertQueued(receipt, account, SPY, Reason.STALE);
        assertEq(receipt.updatedAt, SPY_UPDATED_147);
        assertGe(receipt.updatedAt, REOPEN, "a round from this session");
        assertEq(block.timestamp - receipt.updatedAt, 25 hours + 1, "one second past the limit");
    }

    /// Fallback, listed: the fresh-round rule alone. A round one second before the opening is only 101 seconds old,
    /// inside the age limit, and still refused.
    function test_fork_QUEUED_STALE_freshRoundAfterReopen_isolated() public {
        _setUpTradeAt(REOPEN_BLOCK);
        address account = _account(0, _defaultRule());
        uint256 quote = _quote(SPY, LaunchConfig.SPY_POOL_500, EQUITY);
        _mockRound(Chain4663.SPY_FEED, SPY_ROUND_147, SPY_ANSWER_147, REOPEN - 13, REOPEN - 1);

        ISleeveModule.Receipt memory receipt = _onlyReceipt(_keeperSplit(account, LaunchConfig.SPY_POOL_500, quote));

        _assertQueued(receipt, account, SPY, Reason.STALE);
        assertEq(receipt.updatedAt, REOPEN - 1);
        assertLt(block.timestamp - receipt.updatedAt, 25 hours, "inside the age limit");
    }

    // A weekend queue settled after the reopen

    /// Saturday: the split queues SESSION. Sunday 20:01:40 EDT: the settle waits on Friday's held round (STALE), then,
    /// with the real first round fed in, on the USDG/USD round this fork holds from Saturday (DEPEG); with the real
    /// USDG/USD round fed in too, it settles on the real SPY pool, and a public trigger still waits out the first
    /// hour of the session.
    function test_fork_SETTLED_afterAWeekendQueue() public {
        _setUpTradeAt(WEEKEND_BLOCK);
        address account = _account(0, _defaultRule());
        uint256 quote = _quote(SPY, LaunchConfig.SPY_POOL_500, EQUITY);
        ISleeveModule.Receipt memory queued = _onlyReceipt(_keeperSplit(account, LaunchConfig.SPY_POOL_500, quote));
        assertEq(uint8(queued.reason), uint8(Reason.SESSION));
        vm.prank(stranger);
        module.observe(account);

        vm.warp(REOPEN_BLOCK_TIME);
        quote = _quote(SPY, LaunchConfig.SPY_POOL_500, EQUITY);
        bytes memory before = _bucketState(account);
        _assertSettleWaits(account, quote, Reason.STALE);
        _mockRound(Chain4663.SPY_FEED, SPY_ROUND_147, SPY_ANSWER_147, SPY_STARTED_147, SPY_UPDATED_147);
        _assertSettleWaits(account, quote, Reason.DEPEG);
        _mockRound(Chain4663.USDG_USD_FEED, USDG_ROUND_115, USDG_ANSWER_115, USDG_STARTED_115, USDG_UPDATED_115);
        assertEq(_bucketState(account), before, "the waits changed nothing");

        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.GracePeriodActive.selector, REOPEN + GRACE));
        vm.prank(stranger);
        module.settle(account, SPY, LaunchConfig.SPY_POOL_500, quote);

        Leg memory leg = _legs()[0];
        Measured memory m = _measure(account, SPY, leg.pool);
        ISleeveModule.Receipt memory receipt = _onlyReceipt(_keeperSettle(account, SPY, leg.pool, quote));

        _assertFill(receipt, account, leg, m, Status.SETTLED, Trigger.KEEPER, 0, EQUITY, quote);
        assertEq(uint8(receipt.reason), uint8(Reason.SESSION), "the bucket's reason");
        assertEq(receipt.queuedSince, WEEKEND_TIME, "queued on Saturday");
        assertEq(receipt.roundId, SPY_ROUND_147);
        assertEq(receipt.usdgRoundId, USDG_ROUND_115);
        (uint256 balance, uint256 spend, uint256 pendingTotal, uint256 unsorted) = module.ledger(account);
        assertEq(balance, SPEND_PART);
        assertEq(spend, SPEND_PART);
        assertEq(pendingTotal + unsorted, 0);
        (uint64 observedAt,) = module.observationOf(account);
        assertEq(observedAt, 0, "the settle cleared the observation");
    }

    // Helpers

    function _assertSettleWaits(address account, uint256 quote, Reason reason) private {
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, reason));
        vm.prank(keeper);
        module.settle(account, SPY, LaunchConfig.SPY_POOL_500, quote);
    }

    function _mockRound(address feed, uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt) private {
        vm.mockCall(
            feed,
            abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector),
            abi.encode(roundId, answer, startedAt, updatedAt, roundId)
        );
    }

    function _bucketState(address account) private view returns (bytes memory) {
        (uint256 balance, uint256 spend, uint256 pendingTotal, uint256 unsorted) = module.ledger(account);
        return abi.encode(module.bucketOf(account, SPY), balance, spend, pendingTotal, unsorted, module.nextReceiptId());
    }
}
