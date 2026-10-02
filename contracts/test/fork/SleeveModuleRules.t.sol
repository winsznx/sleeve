// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {SleeveModule} from "../../src/SleeveModule.sol";
import {TokenSource} from "../../src/TokenSource.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {SleeveModuleForkBase} from "../harness/SleeveModuleForkBase.sol";
import {OwnerOps} from "../utils/OwnerOps.sol";

/// @notice Rules (I9), pause, resume and keeper on a forked Kernel v3.1 account at block 78,312,136, against the
/// launch TokenSource on the real tokens and feeds, every owner op bracketed by OwnerOps and sent through handleOps.
contract SleeveModuleRulesForkTest is SleeveModuleForkBase {
    uint256 private constant LAUNCH_TICKERS = 4;

    SleeveModule private module;
    address private account;

    function setUp() public {
        _setUpFork();
        module = _deployModule();
        account = _installedAccount(address(module), bytes32(0), 50e6, "");
    }

    function test_I9_fork_setRuleAcceptsEveryLaunchTicker() public {
        for (uint8 id; id < LAUNCH_TICKERS; ++id) {
            ISleeveModule.RuleInput memory input = _defaultRule();
            input.tickerId = id;
            input.equityBps = 2_500 + id;
            input.spendBps = 7_500 - id;

            OpResult memory result = _ownerOp(account, OwnerOps.setRule(address(module), input));

            assertTrue(result.success, "setRule");
            ISleeveModule.Rule memory rule = module.ruleOf(account);
            assertEq(rule.version, id + 1, "version");
            assertEq(uint8(rule.status), uint8(ISleeveModule.RuleStatus.ACTIVE));
            assertEq(rule.tickerId, id);
            assertEq(rule.equityBps, 2_500 + id);
            assertEq(_logsOf(result, address(module), ISleeveModule.RuleSet.selector).length, 1, "RuleSet");
        }
    }

    function test_I9_fork_setRuleRejectsSharesOffTenThousand() public {
        ISleeveModule.RuleInput memory input = _defaultRule();
        input.spendBps = 9_001;

        OpResult memory result = _ownerOp(account, OwnerOps.setRule(address(module), input));

        assertFalse(result.success);
        assertEq(result.revertReason, abi.encodeWithSelector(ISleeveModule.SharesSumNotTotal.selector, 9_001, 1_000));
        assertEq(module.ruleOf(account).version, 0);
    }

    function test_fork_setRuleRejectsATickerTheTimelockRemoved() public {
        bytes memory removal = abi.encodeCall(TokenSource.removeTicker, (NVDA));
        vm.prank(deployer);
        timelock.schedule(address(tokenSource), 0, removal, bytes32(0), "remove NVDA", TIMELOCK_DELAY);
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        vm.prank(deployer);
        timelock.execute(address(tokenSource), 0, removal, bytes32(0), "remove NVDA");
        ISleeveModule.RuleInput memory input = _defaultRule();
        input.tickerId = NVDA;

        OpResult memory result = _ownerOp(account, OwnerOps.setRule(address(module), input));

        assertFalse(result.success);
        assertEq(result.revertReason, abi.encodeWithSelector(ISleeveModule.TickerNotActive.selector, NVDA));
        assertTrue(_ownerOp(account, OwnerOps.setRule(address(module), _defaultRule())).success, "SPY still listed");
    }

    function test_fork_setRuleRejectsATickerTokenSourceNeverListed() public {
        ISleeveModule.RuleInput memory input = _defaultRule();
        input.tickerId = uint8(LAUNCH_TICKERS);

        OpResult memory result = _ownerOp(account, OwnerOps.setRule(address(module), input));

        assertFalse(result.success);
        assertEq(result.revertReason, abi.encodeWithSelector(ISleeveModule.TickerNotListed.selector, LAUNCH_TICKERS));
    }

    function test_fork_pauseResumeAndKeeperThroughHandleOps() public {
        assertTrue(_ownerOp(account, OwnerOps.setRule(address(module), _defaultRule())).success);

        assertTrue(_ownerOp(account, OwnerOps.pauseRule(address(module))).success, "pause");
        assertEq(uint8(module.ruleOf(account).status), uint8(ISleeveModule.RuleStatus.PAUSED));
        OpResult memory again = _ownerOp(account, OwnerOps.pauseRule(address(module)));
        assertEq(again.revertReason, abi.encodeWithSelector(ISleeveModule.RuleNotActive.selector, account));

        assertTrue(_ownerOp(account, OwnerOps.resumeRule(address(module))).success, "resume");
        ISleeveModule.Rule memory rule = module.ruleOf(account);
        assertEq(uint8(rule.status), uint8(ISleeveModule.RuleStatus.ACTIVE));
        assertEq(rule.version, 1, "pause and resume keep the version");

        assertEq(module.keeperOf(account), keeper, "default keeper from the install");
        assertTrue(_ownerOp(account, OwnerOps.setKeeper(address(module), stranger)).success);
        assertEq(module.keeperOf(account), stranger);
        assertTrue(_ownerOp(account, OwnerOps.setKeeper(address(module), address(0))).success);
        assertEq(module.keeperOf(account), address(0));
        (uint256 balance, uint256 spend,,) = module.ledger(account);
        assertEq(spend, balance, "owner ops that move no USDG book nothing");
    }

    /// I9 through handleOps against a reference model. Each low bit of `shape` pulls one field into its valid
    /// range, so every check is reached from both sides; a rejected rule fails the UserOp with the named error.
    /// forge-config: default.fuzz.runs = 256
    function testFuzz_I9_fork_setRuleThroughHandleOps(
        uint16 spendBps,
        uint16 equityBps,
        uint8 tickerId,
        uint16 premiumCapBps,
        uint16 slippageBps,
        uint128 minClip,
        uint8 shape
    ) public {
        if (shape & 1 != 0) {
            equityBps = uint16(_bound(equityBps, 0, 10_000));
            spendBps = 10_000 - equityBps;
        }
        if (shape & 2 != 0) tickerId = uint8(_bound(tickerId, 0, LAUNCH_TICKERS));
        if (shape & 4 != 0) premiumCapBps = uint16(_bound(premiumCapBps, 0, 501));
        if (shape & 8 != 0) slippageBps = uint16(_bound(slippageBps, 0, 501));
        if (shape & 16 != 0) minClip = uint128(_bound(minClip, 1e6 - 1, 1e12));
        ISleeveModule.RuleInput memory input = ISleeveModule.RuleInput({
            spendBps: spendBps,
            equityBps: equityBps,
            tickerId: tickerId,
            premiumCapBps: premiumCapBps,
            slippageBps: slippageBps,
            minClip: minClip
        });
        bytes memory expected = _expectedRuleError(input);

        OpResult memory result = _ownerOp(account, OwnerOps.setRule(address(module), input));

        assertEq(result.success, expected.length == 0, "accepted exactly the valid rules");
        if (expected.length == 0) {
            ISleeveModule.Rule memory rule = module.ruleOf(account);
            assertEq(rule.version, 1);
            assertEq(uint256(10_000) - rule.equityBps, spendBps, "I9: shares sum");
            assertEq(rule.tickerId, tickerId);
            assertEq(rule.premiumCapBps, premiumCapBps);
            assertEq(rule.slippageBps, slippageBps);
            assertEq(rule.minClip, minClip);
        } else {
            assertEq(result.revertReason, expected, "named error");
            assertEq(module.ruleOf(account).version, 0);
        }
    }

    function _expectedRuleError(ISleeveModule.RuleInput memory input) private pure returns (bytes memory) {
        if (uint256(input.spendBps) + input.equityBps != 10_000) {
            return abi.encodeWithSelector(ISleeveModule.SharesSumNotTotal.selector, input.spendBps, input.equityBps);
        }
        if (input.tickerId >= LAUNCH_TICKERS) {
            return abi.encodeWithSelector(ISleeveModule.TickerNotListed.selector, input.tickerId);
        }
        if (input.premiumCapBps > 500) {
            return abi.encodeWithSelector(ISleeveModule.PremiumCapAboveMax.selector, input.premiumCapBps, 500);
        }
        if (input.slippageBps > 500) {
            return abi.encodeWithSelector(ISleeveModule.SlippageAboveMax.selector, input.slippageBps, 500);
        }
        if (input.minClip < 1e6) {
            return abi.encodeWithSelector(ISleeveModule.MinClipBelowFloor.selector, input.minClip, 1e6);
        }
        return "";
    }
}
