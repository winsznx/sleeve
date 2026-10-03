// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {Reason, Status} from "../../src/types/SleeveTypes.sol";
import {SleeveModuleForkSellBase} from "../harness/SleeveModuleForkSellBase.sol";
import {SleeveModuleHarness} from "../harness/SleeveModuleHarness.sol";
import {LaunchConfig} from "../mocks/LaunchConfig.sol";
import {Chain4663} from "../utils/Chain4663.sol";
import {OwnerOps} from "../utils/OwnerOps.sol";

/// @notice The sell when the market reference is not live, on chain 4663 forked at block 73,280,794 (Saturday 26
/// September 2026 14:00 EDT), with the real calendar, the SPY feed holding Friday's 12:03 EDT round, the real Saturday
/// USDG/USD round and the real Saturday SPY pool: SellWaits(SESSION) without the override (B2-13); with it, a fill
/// against the held round inside the rule's cap or a widened cap, and DiscountAboveCap beyond either (B2-14); the
/// override never skips a token pause; and at the Sunday reopen the sell waits STALE until the first round lands.
/// @dev Fallbacks, listed. No buy can fill on a Saturday, so the lot is seeded through SleeveModuleHarness.seedLot over
/// SPY the account bought from the real pool in its own bracketed swap; the sell path is the module's own. No round
/// lands in a fork, so the reopen case feeds the real rounds through vm.mockCall on latestRoundData, with the values
/// getRoundData returns for those round ids at block 78,312,136, as SleeveModuleWeekend.t.sol does.
contract SleeveModuleSellWeekendForkTest is SleeveModuleForkSellBase {
    /// @dev Saturday 26 September 2026 14:00 EDT, the timestamp of WEEKEND_BLOCK.
    uint256 private constant WEEKEND_TIME = 1_790_445_600;
    /// @dev Sunday 27 September 2026 20:00 EDT, the reopen, and the timestamp of REOPEN_BLOCK.
    uint256 private constant REOPEN = 1_790_553_600;
    uint256 private constant REOPEN_BLOCK_TIME = 1_790_553_700;
    /// @dev Friday's last SPY round before the weekend, which the feed holds at WEEKEND_BLOCK: Friday 25 September
    /// 2026 12:03:00 EDT.
    uint256 private constant FRIDAY_SPY_UPDATED = 1_790_352_180;
    int256 private constant FRIDAY_SPY_ANSWER = 77_232_802_713;
    /// @dev The first SPY round after the reopen and the USDG/USD round in force then (SleeveModuleWeekend.t.sol).
    uint80 private constant SPY_ROUND_147 = 18_446_744_073_709_551_763;
    int256 private constant SPY_ANSWER_147 = 77_121_266_423;
    uint256 private constant SPY_STARTED_147 = 1_790_553_628;
    uint256 private constant SPY_UPDATED_147 = 1_790_553_640;
    uint80 private constant USDG_ROUND_115 = 18_446_744_073_709_551_731;
    int256 private constant USDG_ANSWER_115 = 99_994_000;
    uint256 private constant USDG_STARTED_115 = 1_790_523_484;
    uint256 private constant USDG_UPDATED_115 = 1_790_523_496;
    uint256 private constant LOT_ID = 77;

    address private account;
    uint256 private lotTokens;

    function setUp() public {
        _setUpForkAt(WEEKEND_BLOCK);
        assertEq(block.timestamp, WEEKEND_TIME);
        SleeveModuleHarness harness = _deployHarness();
        module = harness;
        account = _installedAccount(address(module), 0, 0, _installData(address(0), _defaultRule()));
        lotTokens = _ownerBuysDirectly(account, SPY, LaunchConfig.SPY_POOL_500, 100e6);
        harness.seedLot(LOT_ID, account, SPY, Status.FILLED, lotTokens);
    }

    /// B2-13: on a Saturday the sell waits and nothing moves.
    function test_fork_weekend_SellWaits_SESSION_withoutTheOverride() public {
        assertEq(module.sessionOpenedAt(SPY), 0, "closed");
        _assertSellOpReverts(
            account,
            _sellArgs(SPY, LaunchConfig.SPY_POOL_500, lotTokens, 0),
            abi.encodeWithSelector(ISleeveModule.SellWaits.selector, Reason.SESSION)
        );
    }

    /// B2-13 and B2-14: with the override the sell fills against Friday's held round, 26 hours old, inside the rule's
    /// 100 bps cap, and the receipt records the override and the held round.
    function test_fork_weekend_override_fillsAgainstTheHeldRound() public {
        OwnerOps.SellArgs memory args = _sellArgs(SPY, LaunchConfig.SPY_POOL_500, lotTokens / 2, 0);
        args.overrideClosed = true;
        SellMeasured memory m = _measureSell(account, SPY, LaunchConfig.SPY_POOL_500);

        OpResult memory result = _ownerSell(account, args);

        assertTrue(result.success, "sell UserOp");
        ISleeveModule.Receipt[] memory receipts = _receiptsIn(result.logs, address(module));
        assertEq(receipts.length, 1);
        uint256 usdgOut = _assertSold(receipts[0], account, args, m, LOT_ID, Status.PART_SOLD);
        _assertProceedsAreTheModulesDelta(result, m.accountUsdg, usdgOut);
        assertTrue(receipts[0].overrideClosed);
        assertEq(receipts[0].updatedAt, FRIDAY_SPY_UPDATED, "Friday's held round");
        assertEq(receipts[0].answer, FRIDAY_SPY_ANSWER);
        assertGt(block.timestamp - receipts[0].updatedAt, 25 hours, "older than any buy would take");
        assertGt(receipts[0].premiumBps, 0, "the Saturday pool sat below the held price");
        assertLe(receipts[0].premiumBps, 100, "inside the rule's cap");
    }

    /// B2-14: a rule cap below the Saturday discount refuses the sell, a widened cap still below it refuses it, and a
    /// widened cap above it fills, recorded on the receipt.
    function test_fork_weekend_override_DiscountAboveCap_thenAWidenedCapFills() public {
        int256 discount =
            _discountOf(_quoteSellOut(SPY, LaunchConfig.SPY_POOL_500, lotTokens), lotTokens, FRIDAY_SPY_ANSWER);
        assertGt(discount, 5, "the real Saturday discount");
        uint16 ruleCap = uint16(uint256(discount)) - 5;
        ISleeveModule.RuleInput memory rule = _defaultRule();
        rule.premiumCapBps = ruleCap;
        assertTrue(_ownerOp(account, OwnerOps.setRule(address(module), rule)).success);

        OwnerOps.SellArgs memory args = _sellArgs(SPY, LaunchConfig.SPY_POOL_500, lotTokens, 0);
        args.overrideClosed = true;
        _assertSellOpReverts(
            account, args, abi.encodeWithSelector(ISleeveModule.DiscountAboveCap.selector, discount, ruleCap)
        );
        args.overrideCapBps = uint16(uint256(discount)) - 1;
        _assertSellOpReverts(
            account,
            args,
            abi.encodeWithSelector(ISleeveModule.DiscountAboveCap.selector, discount, args.overrideCapBps)
        );

        args.overrideCapBps = uint16(uint256(discount)) + 35;
        SellMeasured memory m = _measureSell(account, SPY, LaunchConfig.SPY_POOL_500);
        OpResult memory result = _ownerSell(account, args);
        assertTrue(result.success, "sell UserOp");
        ISleeveModule.Receipt[] memory receipts = _receiptsIn(result.logs, address(module));
        _assertSold(receipts[0], account, args, m, LOT_ID, Status.SOLD);
        assertEq(receipts[0].premiumBps, discount);
        assertEq(receipts[0].overrideCapBps, args.overrideCapBps, "the widened cap on the receipt");
    }

    /// The override skips the session and the feed's age, never the token pause.
    function test_fork_weekend_override_stillRefusesAPausedToken() public {
        OwnerOps.SellArgs memory args = _sellArgs(SPY, LaunchConfig.SPY_POOL_500, lotTokens, 0);
        args.overrideClosed = true;
        _pauseToken(Chain4663.SPY);
        _assertSellOpReverts(account, args, abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, Reason.PAUSED));
    }

    /// At the Sunday 20:00 EDT reopen the session is open but the feed still holds Friday's round, from before the
    /// opening: the sell waits STALE. Once the first round of the week lands, the same sell fills without the
    /// override.
    function test_fork_reopen_SellWaits_STALE_untilTheFirstRound() public {
        vm.warp(REOPEN + 30);
        _mockRound(Chain4663.USDG_USD_FEED, USDG_ROUND_115, USDG_ANSWER_115, USDG_STARTED_115, USDG_UPDATED_115);
        assertEq(module.sessionOpenedAt(SPY), REOPEN, "open since 20:00");
        OwnerOps.SellArgs memory args = _sellArgs(SPY, LaunchConfig.SPY_POOL_500, lotTokens, 0);
        _assertSellOpReverts(account, args, abi.encodeWithSelector(ISleeveModule.SellWaits.selector, Reason.STALE));

        vm.warp(REOPEN_BLOCK_TIME);
        _mockRound(Chain4663.SPY_FEED, SPY_ROUND_147, SPY_ANSWER_147, SPY_STARTED_147, SPY_UPDATED_147);
        SellMeasured memory m = _measureSell(account, SPY, LaunchConfig.SPY_POOL_500);
        OpResult memory result = _ownerSell(account, args);
        assertTrue(result.success, "sell UserOp");
        ISleeveModule.Receipt[] memory receipts = _receiptsIn(result.logs, address(module));
        _assertSold(receipts[0], account, args, m, LOT_ID, Status.SOLD);
        assertEq(receipts[0].roundId, SPY_ROUND_147, "the first round after the reopen");
        assertFalse(receipts[0].overrideClosed);
    }

    function _mockRound(address feed, uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt) private {
        vm.mockCall(
            feed,
            abi.encodeWithSelector(IAggregatorV3.latestRoundData.selector),
            abi.encode(roundId, answer, startedAt, updatedAt, roundId)
        );
    }
}
