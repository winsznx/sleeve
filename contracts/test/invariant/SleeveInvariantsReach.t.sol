// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/Test.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {Status} from "../../src/types/SleeveTypes.sol";
import {MockStockToken} from "../mocks/MockStockToken.sol";
import {SleeveInvariantBase} from "./SleeveInvariants.t.sol";
import {SleeveHandler} from "./handlers/SleeveHandler.sol";

/// @notice What the invariant suite's handler reaches: 100 seeded sequences of 64 weighted actions, with the receipt
/// statuses, sells and lot reconciles among them, QUEUED reasons and reverts they produced, per action. A run with -vv
/// prints the table, so a change to the handler that stops reaching a branch shows up here before it hides behind a
/// passing invariant. Every check of the invariant suite runs after every action, so this is also a deterministic
/// replay of it.
contract SleeveInvariantsReachTest is SleeveInvariantBase {
    uint256 internal constant SEQUENCES = 100;
    uint256 internal constant DEPTH = 64;
    uint256 internal constant ERRORS = 37;
    uint256 internal constant OUTCOMES = ERRORS + 3;

    function setUp() public {
        _deploy();
    }

    function test_reach() public {
        vm.pauseGasMetering();
        uint256 snapshot = vm.snapshotState();
        bytes4[] memory list = _weightedSelectors();
        (bytes4[] memory actions,) = _actions();
        bytes4[ERRORS] memory errors = _errors();
        uint256[9] memory statuses;
        uint256[9] memory reasons;
        uint256[OUTCOMES][ACTIONS] memory tally;
        uint256[ACTIONS] memory calls;
        uint256[ACTIONS] memory receiptCalls;
        uint256[ERRORS] memory errorCounts;
        uint256[7] memory paths;
        for (uint256 s; s < SEQUENCES; ++s) {
            vm.revertToState(snapshot);
            uint256 rng = uint256(keccak256(abi.encode("sequence", s)));
            for (uint256 i; i < DEPTH; ++i) {
                rng = uint256(keccak256(abi.encode(rng)));
                bytes4 selector = list[rng % list.length];
                uint256 which;
                while (actions[which] != selector) {
                    ++which;
                }
                ++calls[which];
                _step(selector, uint256(keccak256(abi.encode(rng, 1))), uint256(keccak256(abi.encode(rng, 2))));
                this.checkEverything();
                bytes4 outcome = handler.lastOutcome();
                uint256 column = OUTCOMES - 1;
                if (outcome == bytes4(0)) column = 0;
                else if (outcome == bytes4(0xffffffff)) column = 1;
                for (uint256 e; e < errors.length; ++e) {
                    if (outcome == errors[e]) column = e + 2;
                }
                ++tally[which][column];
                if (handler.lastReceipts() != 0) ++receiptCalls[which];
            }
            for (uint8 t; t < 9; ++t) {
                statuses[t] += handler.statusSeen(t);
                reasons[t] += handler.queuedSeen(t);
            }
            for (uint256 e; e < errors.length; ++e) {
                errorCounts[e] += handler.revertSeen(errors[e]);
            }
            paths[0] += handler.outflowsIntoBuckets();
            paths[1] += handler.ownerSales();
            paths[2] += handler.fillsBesideDonations();
            paths[3] += handler.pullsIntoBuckets();
            paths[4] += handler.moduleSells();
            paths[5] += handler.sellsAfterAPull();
            paths[6] += handler.lotTrims();
        }
        _print(statuses, reasons, errorCounts);
        console.log("owner outflows that reached the buckets", paths[0]);
        console.log("owner sales of stock tokens through the router", paths[1]);
        console.log("fills while the module held a donation", paths[2]);
        console.log("outside pulls that reached the buckets", paths[3]);
        console.log("sells through the module", paths[4]);
        console.log("sells that reconciled an outside pull first", paths[5]);
        console.log("lot reconciles that trimmed a lot", paths[6]);
        assertGt(paths[0], 0, "no owner outflow reached the buckets");
        assertGt(paths[1], 0, "no owner sale ran");
        assertGt(paths[2], 0, "no fill ran beside a donation");
        assertGt(paths[3], 0, "no outside pull reached the buckets");
        assertGt(paths[4], 0, "no sell ran through the module");
        assertGt(paths[5], 0, "no sell reconciled an outside pull first");
        assertGt(paths[6], 0, "no lot reconcile trimmed a lot");
        assertEq(errorCounts[ERRORS - 1], 0, "ModuleHoldsFunds: a donation blocked a buy or a sell");
        for (uint8 t; t < 9; ++t) {
            assertGt(statuses[t], 0, "a receipt status was never reached");
            if (t != 0) assertGt(reasons[t], 0, "a QUEUED reason was never reached");
        }
        for (uint256 w; w < ACTIONS; ++w) {
            string memory line = string.concat(
                "action ",
                vm.toString(w),
                " calls ",
                vm.toString(calls[w]),
                " withReceipts ",
                vm.toString(receiptCalls[w])
            );
            line = string.concat(line, " ok=", vm.toString(tally[w][0]), " none=", vm.toString(tally[w][1]));
            for (uint256 e; e < ERRORS; ++e) {
                if (tally[w][e + 2] != 0) {
                    line = string.concat(line, " e", vm.toString(e), "=", vm.toString(tally[w][e + 2]));
                }
            }
            if (tally[w][OUTCOMES - 1] != 0) {
                line = string.concat(line, " other=", vm.toString(tally[w][OUTCOMES - 1]));
            }
            console.log(line);
        }
    }

    function _errors() internal pure returns (bytes4[ERRORS] memory) {
        return [
            ISleeveModule.GracePeriodActive.selector,
            ISleeveModule.PoolNotAllowed.selector,
            ISleeveModule.PoolBlocked.selector,
            ISleeveModule.ZeroQuote.selector,
            ISleeveModule.RuleNotActive.selector,
            ISleeveModule.BelowClip.selector,
            ISleeveModule.GuardNotClear.selector,
            ISleeveModule.PartialFill.selector,
            ISleeveModule.TooFewTokens.selector,
            ISleeveModule.EmptyBucket.selector,
            ISleeveModule.NothingWaiting.selector,
            bytes4(keccak256("Error(string)")),
            ISleeveModule.NotInstalled.selector,
            ISleeveModule.ModuleNotListed.selector,
            ISleeveModule.OwnerOpOpen.selector,
            bytes4(keccak256("ERC20InsufficientBalance(address,uint256,uint256)")),
            bytes4(keccak256("PoolUnavailable()")),
            ISleeveModule.NoRule.selector,
            ISleeveModule.RuleNotPaused.selector,
            ISleeveModule.TickerNotActive.selector,
            bytes4(keccak256("ERC20InsufficientAllowance(address,uint256,uint256)")),
            MockStockToken.IsPaused.selector,
            MockStockToken.Blocked.selector,
            ISleeveModule.ZeroAmount.selector,
            ISleeveModule.ExceedsLots.selector,
            ISleeveModule.ExceedsBalance.selector,
            ISleeveModule.LotMismatch.selector,
            ISleeveModule.UnknownLot.selector,
            ISleeveModule.OverrideCapOutOfRange.selector,
            ISleeveModule.AccountBlocked.selector,
            ISleeveModule.SellWaits.selector,
            ISleeveModule.DiscountAboveCap.selector,
            ISleeveModule.TooLittleUsdg.selector,
            ISleeveModule.TickerHasNoFeed.selector,
            ISleeveModule.ModuleStillListed.selector,
            ISleeveModule.LedgersAboveBalance.selector,
            ISleeveModule.ModuleHoldsFunds.selector
        ];
    }

    function _print(uint256[9] memory statuses, uint256[9] memory reasons, uint256[ERRORS] memory errorCounts)
        internal
        pure
    {
        string[9] memory statusNames = [
            "FILLED",
            "QUEUED",
            "SETTLED",
            "REFUSED_TICKER",
            "REFUSED_ACCOUNT",
            "RELEASED",
            "PART_SOLD",
            "SOLD",
            "RECONCILED"
        ];
        string[9] memory reasonNames =
            ["NONE", "PAUSED", "ORACLE_PAUSED", "SESSION", "MULTIPLIER", "STALE", "DEPEG", "CLIP", "PREMIUM"];
        string[ERRORS] memory errorNames = [
            "GracePeriodActive",
            "PoolNotAllowed",
            "PoolBlocked",
            "ZeroQuote",
            "RuleNotActive",
            "BelowClip",
            "GuardNotClear",
            "PartialFill",
            "TooFewTokens",
            "EmptyBucket",
            "NothingWaiting",
            "Error(string)",
            "NotInstalled",
            "ModuleNotListed",
            "OwnerOpOpen",
            "ERC20InsufficientBalance",
            "PoolUnavailable",
            "NoRule",
            "RuleNotPaused",
            "TickerNotActive",
            "ERC20InsufficientAllowance",
            "IsPaused",
            "Blocked",
            "ZeroAmount",
            "ExceedsLots",
            "ExceedsBalance",
            "LotMismatch",
            "UnknownLot",
            "OverrideCapOutOfRange",
            "AccountBlocked",
            "SellWaits",
            "DiscountAboveCap",
            "TooLittleUsdg",
            "TickerHasNoFeed",
            "ModuleStillListed",
            "LedgersAboveBalance",
            "ModuleHoldsFunds"
        ];
        for (uint256 t; t < 9; ++t) {
            console.log(statusNames[t], statuses[t]);
        }
        for (uint256 t; t < 9; ++t) {
            console.log(string.concat("QUEUED ", reasonNames[t]), reasons[t]);
        }
        for (uint256 e; e < ERRORS; ++e) {
            console.log(errorNames[e], errorCounts[e]);
        }
    }
}
