// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Execution} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {TokenSource} from "../../src/TokenSource.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {IStockToken} from "../../src/interfaces/IStockToken.sol";
import {Reason, Status, Trigger} from "../../src/types/SleeveTypes.sol";
import {SleeveModuleForkTradeBase} from "../harness/SleeveModuleForkTradeBase.sol";
import {LaunchConfig} from "../mocks/LaunchConfig.sol";
import {Chain4663} from "../utils/Chain4663.sol";
import {OwnerOps} from "../utils/OwnerOps.sol";

/// @notice settle, release and reconcile on chain 4663 forked at block 78,312,136, with real USDG, tokens, feeds, pools,
/// registry and role holders, and accounts on the deployed Kernel v3.1 driven through handleOps: a minimum-clip bucket
/// filled by two payments and settled on every allowlisted pool, GuardNotClear on every timing reason this block can
/// show with nothing changed, the clip, a timelocked ticker removal, the public grace, the owner's bracket, release
/// with the rule paused, and a third-party pull reconciled by the next split.
contract SleeveModuleSettleForkTest is SleeveModuleForkTradeBase {
    /// @dev Two splits of PAYMENT under this clip leave two equity parts waiting, CLIP, as one bucket.
    uint128 private constant CLIP = 150e6;
    uint256 private constant BUCKET = 2 * EQUITY;

    function setUp() public {
        _setUpTrade();
    }

    // SETTLED

    /// D-009 Q22: an equity part under the clip joins the bucket, and the keeper settles the bucket once it reaches
    /// the clip.
    function test_fork_SETTLED_aClipBucketOnEveryAllowlistedPool() public {
        Leg[5] memory legs = _legs();
        for (uint256 i; i < legs.length; ++i) {
            (address account, uint64 since) = _clipBucket(bytes32(i), legs[i]);
            uint256 quote = _quote(legs[i].tickerId, legs[i].pool, BUCKET);
            Measured memory m = _measure(account, legs[i].tickerId, legs[i].pool);

            ISleeveModule.Receipt memory receipt =
                _onlyReceipt(_keeperSettle(account, legs[i].tickerId, legs[i].pool, quote));

            _assertFill(receipt, account, legs[i], m, Status.SETTLED, Trigger.KEEPER, 0, BUCKET, quote);
            assertEq(uint8(receipt.reason), uint8(Reason.CLIP));
            assertEq(receipt.queuedSince, since);
            assertEq(module.bucketOf(account, legs[i].tickerId).amount, 0, "bucket emptied");
            (uint256 balance, uint256 spend, uint256 pendingTotal, uint256 unsorted) = module.ledger(account);
            assertEq(balance, 2 * SPEND_PART);
            assertEq(spend, 2 * SPEND_PART);
            assertEq(pendingTotal + unsorted, 0);
        }
    }

    /// The owner's settle inside its bracket: the buy is the module's delta.
    function test_fork_SETTLED_byOwnerInsideABracket() public {
        Leg memory leg = _legs()[2];
        (address account,) = _clipBucket(0, leg);
        uint256 quote = _quote(leg.tickerId, leg.pool, BUCKET);
        Measured memory m = _measure(account, leg.tickerId, leg.pool);

        OpResult memory result = _ownerOp(
            account,
            OwnerOps.single(
                address(module),
                address(module),
                abi.encodeCall(ISleeveModule.settle, (account, leg.tickerId, leg.pool, quote))
            )
        );

        assertTrue(result.success);
        ISleeveModule.Receipt[] memory receipts = _receiptsIn(result.logs, address(module));
        assertEq(receipts.length, 1);
        _assertFill(receipts[0], account, leg, m, Status.SETTLED, Trigger.OWNER, 0, BUCKET, quote);
        Vm.Log[] memory ended = _logsOf(result, address(module), ISleeveModule.OwnerOpEnded.selector);
        assertEq(ended.length, 1);
        assertEq(
            ended[0].data,
            abi.encode(2 * PAYMENT, -int256(BUCKET), int256(0), uint256(0), uint256(0), new uint256[](0)),
            "the buy is the module's delta"
        );
    }

    /// D-009 Q16: a public settle waits for the grace after the latest of the bucket's since, the session's opening
    /// and the observation.
    function test_fork_SETTLED_byPublicAfterTheGrace() public {
        Leg memory leg = _legs()[0];
        (address account, uint64 since) = _clipBucket(0, leg);
        vm.prank(stranger);
        uint64 observedAt = module.observe(account);
        assertEq(observedAt, since, "observed when the bucket filled");
        uint256 quote = _quote(SPY, leg.pool, BUCKET);
        vm.warp(block.timestamp + GRACE - 1);
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.GracePeriodActive.selector, since + GRACE));
        vm.prank(stranger);
        module.settle(account, SPY, leg.pool, quote);

        vm.warp(block.timestamp + 1);
        Measured memory m = _measure(account, SPY, leg.pool);
        vm.recordLogs();
        vm.prank(stranger);
        module.settle(account, SPY, leg.pool, quote);
        ISleeveModule.Receipt memory receipt = _onlyReceipt(vm.getRecordedLogs());

        _assertFill(receipt, account, leg, m, Status.SETTLED, Trigger.PUBLIC, 0, BUCKET, quote);
    }

    // GuardNotClear, with nothing changed

    function test_fork_settle_guardNotClear_PAUSED() public {
        (address account,) = _clipBucket(0, _legs()[0]);
        uint256 quote = _quote(SPY, LaunchConfig.SPY_POOL_500, BUCKET);
        _pauseToken(Chain4663.SPY);
        _assertNotClear(account, SPY, LaunchConfig.SPY_POOL_500, quote, Reason.PAUSED);
    }

    function test_fork_settle_guardNotClear_ORACLE_PAUSED() public {
        (address account,) = _clipBucket(0, _legs()[1]);
        uint256 quote = _quote(QQQ, LaunchConfig.QQQ_POOL_500, BUCKET);
        _pauseOracle(Chain4663.QQQ);
        _assertNotClear(account, QQQ, LaunchConfig.QQQ_POOL_500, quote, Reason.ORACLE_PAUSED);
    }

    function test_fork_settle_guardNotClear_MULTIPLIER() public {
        (address account,) = _clipBucket(0, _legs()[2]);
        uint256 quote = _quote(NVDA, LaunchConfig.NVDA_POOL_500, BUCKET);
        _scheduleMultiplier(Chain4663.NVDA, IStockToken(Chain4663.NVDA).uiMultiplier() + 1e15);
        _assertNotClear(account, NVDA, LaunchConfig.NVDA_POOL_500, quote, Reason.MULTIPLIER);
    }

    /// The next session: Monday 5 October 2026 21:00 EDT, with Friday's rounds held, so the round predates the
    /// Sunday reopen and is past 25 hours.
    function test_fork_settle_guardNotClear_STALE() public {
        (address account,) = _clipBucket(0, _legs()[3]);
        uint256 quote = _quote(AAPL, LaunchConfig.AAPL_POOL_500, BUCKET);
        vm.warp(block.timestamp + 3 days + 10 hours + 15 minutes);
        assertGt(module.sessionOpenedAt(AAPL), 0, "open");
        _assertNotClear(account, AAPL, LaunchConfig.AAPL_POOL_500, quote, Reason.STALE);
    }

    /// The real USDG/USD round passes 25 hours two hours after this block.
    function test_fork_settle_guardNotClear_DEPEG() public {
        (address account,) = _clipBucket(0, _legs()[4]);
        uint256 quote = _quote(AAPL, LaunchConfig.AAPL_POOL_3000, BUCKET);
        vm.warp(block.timestamp + 2 hours);
        _assertNotClear(account, AAPL, LaunchConfig.AAPL_POOL_3000, quote, Reason.DEPEG);
    }

    /// The real SPY premium is above zero, so under a zero cap the settle reverts PREMIUM and the swap is undone.
    function test_fork_settle_guardNotClear_PREMIUM() public {
        (address account,) = _clipBucket(0, _legs()[0]);
        ISleeveModule.RuleInput memory rule = _clipRule(SPY);
        rule.premiumCapBps = 0;
        assertTrue(_ownerOp(account, OwnerOps.setRule(address(module), rule)).success);
        uint256 quote = _quote(SPY, LaunchConfig.SPY_POOL_500, BUCKET);
        _assertNotClear(account, SPY, LaunchConfig.SPY_POOL_500, quote, Reason.PREMIUM);
    }

    function test_fork_settle_belowTheCurrentRulesClip_reverts() public {
        (address account,) = _clipBucket(0, _legs()[0]);
        ISleeveModule.RuleInput memory rule = _clipRule(SPY);
        rule.minClip = uint128(BUCKET + 1);
        assertTrue(_ownerOp(account, OwnerOps.setRule(address(module), rule)).success);
        bytes memory before = _state(account, LaunchConfig.SPY_POOL_500);
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.BelowClip.selector, BUCKET, BUCKET + 1));
        vm.prank(keeper);
        module.settle(account, SPY, LaunchConfig.SPY_POOL_500, 1);
        assertEq(_state(account, LaunchConfig.SPY_POOL_500), before, "nothing changed");
    }

    // REFUSED

    /// A ticker removed through SleeveTimelock: its bucket goes to spend with REFUSED_TICKER (D-009 Q24).
    function test_fork_settle_REFUSED_TICKER_afterATimelockedRemoval() public {
        (address account, uint64 since) = _clipBucket(0, _legs()[1]);
        _throughTimelock(address(tokenSource), abi.encodeCall(TokenSource.removeTicker, (QQQ)), "remove QQQ");

        ISleeveModule.Receipt memory receipt = _onlyReceipt(_keeperSettle(account, QQQ, LaunchConfig.QQQ_POOL_500, 1));

        assertEq(uint8(receipt.status), uint8(Status.REFUSED_TICKER));
        assertEq(uint8(receipt.reason), uint8(Reason.NONE));
        assertEq(receipt.usdgIn, 0);
        assertEq(receipt.usdgToSpend, BUCKET, "the bucket went to spend");
        assertEq(receipt.usdgToEquity, BUCKET);
        assertEq(receipt.queuedSince, since);
        assertEq(receipt.venueId, 0, "no swap");
        (uint256 balance, uint256 spend, uint256 pendingTotal, uint256 unsorted) = module.ledger(account);
        assertEq(balance, 2 * PAYMENT, "no USDG moved");
        assertEq(spend, 2 * PAYMENT);
        assertEq(pendingTotal + unsorted, 0);
        _assertHoldsNothingAtAll(address(module));
    }

    // Release

    /// I11: the owner releases the bucket to spend through a bracketed UserOp with the rule paused and the token
    /// paused, and the bracket books nothing because no USDG moved.
    function test_fork_release_RELEASED_withTheRuleAndTokenPaused() public {
        (address account, uint64 since) = _clipBucket(0, _legs()[0]);
        assertTrue(_ownerOp(account, OwnerOps.pauseRule(address(module))).success, "pause");
        _pauseToken(Chain4663.SPY);

        OpResult memory result = _ownerOp(
            account, OwnerOps.single(address(module), address(module), abi.encodeCall(ISleeveModule.release, (SPY)))
        );

        assertTrue(result.success, "release UserOp");
        ISleeveModule.Receipt[] memory receipts = _receiptsIn(result.logs, address(module));
        assertEq(receipts.length, 1);
        assertEq(uint8(receipts[0].status), uint8(Status.RELEASED));
        assertEq(uint8(receipts[0].trigger), uint8(Trigger.OWNER));
        assertEq(uint8(receipts[0].reason), uint8(Reason.CLIP));
        assertEq(receipts[0].usdgToSpend, BUCKET);
        assertEq(receipts[0].queuedSince, since);
        assertEq(receipts[0].token, Chain4663.SPY);
        Vm.Log[] memory ended = _logsOf(result, address(module), ISleeveModule.OwnerOpEnded.selector);
        assertEq(
            ended[0].data,
            abi.encode(2 * PAYMENT, int256(0), int256(0), uint256(0), uint256(0), new uint256[](0)),
            "nothing moved"
        );
        (uint256 balance, uint256 spend, uint256 pendingTotal, uint256 unsorted) = module.ledger(account);
        assertEq(balance, 2 * PAYMENT);
        assertEq(spend, 2 * PAYMENT, "the bucket is spend");
        assertEq(pendingTotal + unsorted, 0);
        _assertHoldsNothingAtAll(address(module));
    }

    // Reconcile

    /// PRD 7.2: the account approves a third party in a bracketless op and the third party pulls USDG. The next split
    /// takes the shortfall off spend first, then the bucket, with RECONCILED and the companion Reconciled event.
    function test_fork_reconcile_afterAThirdPartyPull() public {
        (address account,) = _clipBucket(0, _legs()[0]);
        address puller = makeAddr("old approval");
        Execution[] memory calls = new Execution[](1);
        calls[0] = Execution(Chain4663.USDG, 0, abi.encodeCall(IERC20.approve, (puller, 1_950e6)));
        assertTrue(_ownerOp(account, _unbracketedBatch(calls)).success, "bracketless approve");
        vm.prank(puller);
        assertTrue(USDG.transferFrom(account, puller, 1_950e6), "pulled");
        (uint256 balance, uint256 spend, uint256 pendingTotal,) = module.ledger(account);
        assertEq(balance, 50e6);
        assertEq(spend + pendingTotal, 2 * PAYMENT, "the ledgers have not seen the pull");

        Vm.Log[] memory logs = _keeperSplit(account, LaunchConfig.SPY_POOL_500, 1);

        ISleeveModule.Receipt memory receipt = _onlyReceipt(logs);
        assertEq(uint8(receipt.status), uint8(Status.RECONCILED));
        assertEq(uint8(receipt.trigger), uint8(Trigger.KEEPER));
        assertEq(receipt.usdgIn, 1_950e6, "the shortfall");
        assertEq(receipt.usdgSpent, 2 * SPEND_PART, "spend first");
        assertEq(receipt.usdgQueued, 150e6, "then the bucket");
        uint256[] memory fromBuckets = new uint256[](4);
        fromBuckets[SPY] = 150e6;
        Vm.Log[] memory reconciled = new Vm.Log[](1);
        uint256 seen;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(module) && logs[i].topics[0] == ISleeveModule.Reconciled.selector) {
                reconciled[0] = logs[i];
                ++seen;
            }
        }
        assertEq(seen, 1, "one Reconciled");
        assertEq(reconciled[0].topics[1], bytes32(uint256(uint160(account))));
        assertEq(reconciled[0].topics[2], bytes32(receipt.id));
        assertEq(reconciled[0].data, abi.encode(50e6, 2 * SPEND_PART, fromBuckets), "per-bucket cut");
        (balance, spend, pendingTotal,) = module.ledger(account);
        assertEq(spend, 0);
        assertEq(pendingTotal, 50e6);
        assertEq(module.bucketOf(account, SPY).amount, 50e6);
    }

    // Helpers

    function _clipRule(uint8 tickerId) private pure returns (ISleeveModule.RuleInput memory rule) {
        rule = _ruleOn(tickerId);
        rule.minClip = CLIP;
    }

    /// @dev Two payments split under a 150 USDG clip: two 100 USDG equity parts wait as one 200 USDG bucket.
    function _clipBucket(bytes32 salt, Leg memory leg) private returns (address account, uint64 since) {
        account = _account(salt, _clipRule(leg.tickerId));
        _keeperSplit(account, leg.pool, 1);
        since = module.bucketOf(account, leg.tickerId).since;
        _pay(account, PAYMENT);
        ISleeveModule.Receipt memory second = _onlyReceipt(_keeperSplit(account, leg.pool, 1));
        assertEq(uint8(second.reason), uint8(Reason.CLIP));
        ISleeveModule.Bucket memory bucket = module.bucketOf(account, leg.tickerId);
        assertEq(bucket.amount, BUCKET, "one bucket");
        assertEq(bucket.since, since, "since kept from the first part");
    }

    function _assertNotClear(address account, uint8 tickerId, address pool, uint256 quote, Reason reason) private {
        bytes memory before = _state(account, pool);
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, reason));
        vm.prank(keeper);
        module.settle(account, tickerId, pool, quote);
        assertEq(_state(account, pool), before, "nothing changed");
        _assertHoldsNothingAtAll(address(module));
    }

    function _state(address account, address pool) private view returns (bytes memory) {
        (uint256 balance, uint256 spend, uint256 pendingTotal, uint256 unsorted) = module.ledger(account);
        uint256[4] memory buckets;
        for (uint8 t; t < 4; ++t) {
            buckets[t] = module.bucketOf(account, t).amount;
        }
        return abi.encode(balance, spend, pendingTotal, unsorted, buckets, module.nextReceiptId(), USDG.balanceOf(pool));
    }
}
