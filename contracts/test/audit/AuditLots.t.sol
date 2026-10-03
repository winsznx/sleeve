// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    Execution,
    IERC7579Execution,
    MODULE_TYPE_EXECUTOR
} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {ERC7579Utils} from "@openzeppelin/contracts/account/utils/draft-ERC7579Utils.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {Reason, Status} from "../../src/types/SleeveTypes.sol";
import {SleeveModuleForkSellBase} from "../harness/SleeveModuleForkSellBase.sol";
import {SleeveModuleHarness} from "../harness/SleeveModuleHarness.sol";
import {SleeveModuleSellUnitBase} from "../harness/SleeveModuleSellUnitBase.sol";
import {MockAccount} from "../mocks/MockAccount.sol";
import {Chain4663} from "../utils/Chain4663.sol";
import {OwnerOps} from "../utils/OwnerOps.sol";

/// @notice Audit round 1, lots and sell-back, on component 6: A1-03 after the fix (reconcileLots trims oldest first, the
/// order sells take lots in, so it never trims a lot bought after the outflow), A1-13 after the fix (a sell takes from
/// and a lot reconcile trims at most 100 lots per call), I-03 after the fix (a sell reconciles an outside pull before
/// its proceeds land), and pins for what stays open: tokens from outside Sleeve can refill a phantom lot (A1-03 c, the
/// WRAPPED limit for tokens) and lots stay with the module instance (A1-28). A1-04, A1-08, A1-34 and A1-35 are covered
/// by component 6's own tests, listed in docs/audit/AUDIT_R1.md.
contract AuditLotsTest is SleeveModuleSellUnitBase {
    /// @dev SleeveSell.MAX_LOTS_PER_CALL.
    uint256 private constant MAX_LOTS = 100;
    /// @dev Seeded lot ids start here, clear of the receipt ids the tests write.
    uint256 private constant SEEDED_LOT_IDS = 10_000;

    address private puller = makeAddr("old approval");

    function setUp() public {
        _setUpSell();
    }

    // A1-03

    /// The uninstall form: a lot, an uninstall, its tokens sent away outside Sleeve, a reinstall and a lot half its
    /// size. reconcileLots trims the pre-uninstall lot, whose tokens left, and keeps the lot that holds every token;
    /// trimming newest first used to zero the new lot and keep the phantom.
    function test_A1_03_reconcileTrimsTheLotWhoseTokensLeft() public {
        (MockAccount account, uint256 oldLot, uint256 newLot) = _uninstallForm();

        vm.recordLogs();
        vm.prank(address(account));
        module.reconcileLots(SPY);
        ISleeveModule.Receipt[] memory receipts = _receipts(vm.getRecordedLogs());

        assertEq(receipts.length, 1);
        assertEq(uint8(receipts[0].status), uint8(Status.RECONCILED));
        assertEq(receipts[0].lotId, oldLot);
        assertEq(receipts[0].tokensIn, LOT_TOKENS);
        assertEq(module.lot(oldLot).tokensRemaining, 0, "the phantom lot is trimmed");
        assertEq(module.lot(newLot).tokensRemaining, LOT_TOKENS / 2, "the lot that holds the tokens keeps them");
        (uint256[] memory ids, uint256 head) = module.lotsOf(address(account), SPY);
        assertEq(ids[head], newLot, "the head moved past the trimmed lot");
    }

    /// After the reconcile a sell by amount is booked on the lot that holds the tokens.
    function test_A1_03_aSellAfterTheReconcileIsBookedOnTheRightLot() public {
        (MockAccount account,, uint256 newLot) = _uninstallForm();
        vm.prank(address(account));
        module.reconcileLots(SPY);

        vm.recordLogs();
        _sell(account, _args(SPY, LOT_TOKENS / 2, 0));
        ISleeveModule.Receipt memory sold = _onlyReceipt(vm.getRecordedLogs());
        assertEq(sold.lotId, newLot);
        assertEq(uint8(sold.status), uint8(Status.SOLD));
    }

    /// Pinned limit (A1-03 c), recorded next to the WRAPPED limit: lots are an upper bound until reconciled, and
    /// tokens that arrive from outside Sleeve after a bracketed transfer of the same amount refill the lot, so
    /// reconcileLots finds nothing to trim and a sale of them is booked on the lot. The app appends reconcileLots to
    /// every owner batch that moves a stock token.
    function test_A1_03_open_outsideTokensRefillAPhantomLot() public {
        (MockAccount account, uint256 lotId) = _lotAccount(_defaultRule());
        _ownerOp(account, OwnerOps.transferToken(address(module), address(tokens[SPY]), sink, LOT_TOKENS));
        tokens[SPY].mint(address(account), LOT_TOKENS);

        vm.prank(address(account));
        assertEq(module.reconcileLots(SPY), 0, "nothing to trim");
        vm.recordLogs();
        _sell(account, _args(SPY, LOT_TOKENS, 0));
        ISleeveModule.Receipt memory sold = _onlyReceipt(vm.getRecordedLogs());
        assertEq(sold.lotId, lotId, "tokens from outside Sleeve sold as the lot");
    }

    // A1-13

    /// A sell by amount that needs a 101st lot reverts TooManyLots with what the oldest 100 lots cover, and nothing
    /// moves. Selling that much writes exactly 100 receipts, oldest lot first, and moves the head past them; the last
    /// lot sells in the next call. Before the bound one sell wrote a receipt for every lot it touched, about 56,000
    /// gas each, with no limit.
    function test_A1_13_aSellByAmountTakesFromAtMostOneHundredLots() public {
        (MockAccount account, uint256 firstLot) = _lotAccount(_defaultRule());
        uint256[] memory seeded = _seedLots(account, MAX_LOTS);
        uint256 coveredByTheBound = MAX_LOTS * LOT_TOKENS;

        _assertSellReverts(
            account,
            _args(SPY, coveredByTheBound + 1, 0),
            abi.encodeWithSelector(ISleeveModule.TooManyLots.selector, coveredByTheBound, MAX_LOTS)
        );

        vm.recordLogs();
        _sell(account, _args(SPY, coveredByTheBound, 0));
        ISleeveModule.Receipt[] memory receipts = _receipts(vm.getRecordedLogs());
        assertEq(receipts.length, MAX_LOTS, "one receipt per lot, at most 100");
        assertEq(receipts[0].lotId, firstLot, "oldest first");
        assertEq(receipts[MAX_LOTS - 1].lotId, seeded[MAX_LOTS - 2]);
        for (uint256 i; i < MAX_LOTS; ++i) {
            assertEq(uint8(receipts[i].status), uint8(Status.SOLD));
        }
        (, uint256 head) = module.lotsOf(address(account), SPY);
        assertEq(head, MAX_LOTS, "the head moved past the sold lots");

        vm.recordLogs();
        _sell(account, _args(SPY, LOT_TOKENS, 0));
        ISleeveModule.Receipt memory last = _onlyReceipt(vm.getRecordedLogs());
        assertEq(last.lotId, seeded[MAX_LOTS - 1], "the last lot sells next");
        assertEq(tokens[SPY].balanceOf(address(account)), 0);
    }

    /// The 100-lot bound counts lots that give tokens, not lots read: empty lots after the head are skipped for free,
    /// so a sell by amount over exactly 100 lots that hold tokens still goes through.
    function test_A1_13_emptyLotsDoNotCountTowardTheBound() public {
        (MockAccount account, uint256 firstLot) = _lotAccount(_defaultRule());
        uint256[] memory seeded = _seedLots(account, MAX_LOTS);
        _sell(account, _args(SPY, LOT_TOKENS, seeded[0]));
        assertEq(module.lot(seeded[0]).tokensRemaining, 0, "an empty lot behind the head's first lot");

        vm.recordLogs();
        _sell(account, _args(SPY, MAX_LOTS * LOT_TOKENS, 0));
        ISleeveModule.Receipt[] memory receipts = _receipts(vm.getRecordedLogs());
        assertEq(receipts.length, MAX_LOTS);
        assertEq(receipts[0].lotId, firstLot);
        assertEq(receipts[1].lotId, seeded[1], "the empty lot is skipped");
    }

    /// reconcileLots trims at most 100 lots per call: after every token left, the first call trims the oldest 100
    /// lots and reports what it trimmed, the second trims the last lot, and a third finds nothing to trim.
    function test_A1_13_reconcileLotsTrimsAtMostOneHundredLotsPerCall() public {
        (MockAccount account, uint256 firstLot) = _lotAccount(_defaultRule());
        uint256[] memory seeded = _seedLots(account, MAX_LOTS);
        uint256 held = (MAX_LOTS + 1) * LOT_TOKENS;
        _ownerOp(account, OwnerOps.transferToken(address(module), address(tokens[SPY]), sink, held));

        vm.recordLogs();
        vm.prank(address(account));
        uint256 firstReceipt = module.reconcileLots(SPY);
        Vm.Log[] memory logs = vm.getRecordedLogs();
        ISleeveModule.Receipt[] memory receipts = _receipts(logs);
        assertEq(receipts.length, MAX_LOTS, "100 lots trimmed");
        assertEq(firstReceipt, receipts[0].id);
        assertEq(receipts[0].lotId, firstLot, "oldest first");
        assertEq(
            _lotsReconciled(logs), abi.encode(uint256(0), MAX_LOTS * LOT_TOKENS), "LotsReconciled: what was trimmed"
        );
        assertEq(module.lot(seeded[MAX_LOTS - 1]).tokensRemaining, LOT_TOKENS, "the 101st lot waits for the next call");
        (, uint256 head) = module.lotsOf(address(account), SPY);
        assertEq(head, MAX_LOTS);

        vm.recordLogs();
        vm.prank(address(account));
        module.reconcileLots(SPY);
        ISleeveModule.Receipt memory last = _onlyReceipt(vm.getRecordedLogs());
        assertEq(last.lotId, seeded[MAX_LOTS - 1]);
        assertEq(last.tokensIn, LOT_TOKENS);

        vm.prank(address(account));
        assertEq(module.reconcileLots(SPY), 0, "the lots fit the balance");
    }

    // I-03

    /// A third party drains the account through an old approval: spend and half the NVDA bucket in PRD 7.2's order.
    /// The owner's sell reconciles that first, with a RECONCILED receipt, so the proceeds land whole in spend and never
    /// refill the bucket; crediting them first used to let the next reconcile take the pull out of the proceeds.
    function test_I03_aSellReconcilesAnOutsidePullBeforeItsProceedsLand() public {
        ISleeveModule.RuleInput memory rule = _defaultRule();
        (rule.spendBps, rule.equityBps, rule.tickerId) = (5_000, 5_000, NVDA);
        (MockAccount account, uint256 lotId) = _lotAccount(_defaultRule());
        _ownerOp(account, OwnerOps.setRule(address(module), rule));
        _pay(address(account), 200e6);
        tokens[NVDA].setPaused(true);
        _keeperSplit(address(account));
        tokens[NVDA].setPaused(false);
        assertEq(module.bucketOf(address(account), NVDA).amount, 100e6, "the NVDA bucket");
        (uint256 balance, uint256 spend,,) = module.ledger(address(account));
        uint256 drain = spend + 50e6;
        vm.prank(address(account));
        assertTrue(IERC20(address(usdg)).approve(puller, drain));
        vm.prank(puller);
        assertTrue(IERC20(address(usdg)).transferFrom(address(account), puller, drain));

        uint256 usdgOut = venue.quoteSell(LOT_TOKENS);
        vm.recordLogs();
        _ownerSell(account, _args(SPY, LOT_TOKENS, lotId));
        ISleeveModule.Receipt[] memory receipts = _receipts(vm.getRecordedLogs());

        assertEq(receipts.length, 2, "the reconcile, then the sale");
        assertEq(uint8(receipts[0].status), uint8(Status.RECONCILED));
        assertEq(receipts[0].usdgIn, drain, "the whole pull");
        assertEq(receipts[0].usdgSpent, spend, "spend first");
        assertEq(receipts[0].usdgQueued, 50e6, "then the bucket");
        assertEq(uint8(receipts[1].status), uint8(Status.SOLD));
        assertEq(module.bucketOf(address(account), NVDA).amount, 50e6, "the pull came out of the bucket");
        _assertLedger(address(account), balance - drain + usdgOut, usdgOut, 50e6, 0);
    }

    // A1-28: open owner decision

    /// Pinned until the owner chooses how a later version takes over lots: a new module version is a new install with
    /// its own storage, so tokens bought under v1 have no lot in v2 and are not sellable through v2 (D-009 Q30), while
    /// v1 keeps its public lot views for an import.
    function test_A1_28_open_lotsStayWithTheModuleInstanceTheyWereBoughtIn() public {
        ISleeveModule.RuleInput memory rule = _defaultRule();
        (MockAccount account, uint256 lotId) = _lotAccount(rule);
        ISleeveModule.ModuleConfig memory config = _config();
        config.disclosureHash = keccak256("issuer disclosure, edited");
        SleeveModuleHarness v2 = new SleeveModuleHarness(config);
        _ownerOp(account, OwnerOps.uninstall(address(module), address(account)));
        account.installModule(MODULE_TYPE_EXECUTOR, address(v2), _installData(address(0), rule));

        assertEq(tokens[SPY].balanceOf(address(account)), LOT_TOKENS, "the tokens stay in the account");
        (uint256[] memory v2Ids,) = v2.lotsOf(address(account), SPY);
        assertEq(v2Ids.length, 0, "v2 has no lot for them");
        assertEq(module.lot(lotId).tokensRemaining, LOT_TOKENS, "the lot is v1's, readable for an import");
        assertEq(module.lot(lotId).account, address(account));
    }

    /// @dev `count` more SPY lots of LOT_TOKENS each for the account, seeded with the harness and backed by tokens
    /// minted to the account, so the lots match the balance.
    function _seedLots(MockAccount account, uint256 count) private returns (uint256[] memory ids) {
        ids = new uint256[](count);
        for (uint256 i; i < count; ++i) {
            ids[i] = SEEDED_LOT_IDS + i;
            module.seedLot(ids[i], address(account), SPY, Status.FILLED, LOT_TOKENS);
            tokens[SPY].mint(address(account), LOT_TOKENS);
        }
    }

    /// @dev The data of the only LotsReconciled event in the logs.
    function _lotsReconciled(Vm.Log[] memory logs) private view returns (bytes memory data) {
        uint256 found;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter == address(module) && logs[i].topics[0] == ISleeveModule.LotsReconciled.selector) {
                data = logs[i].data;
                ++found;
            }
        }
        assertEq(found, 1, "one LotsReconciled");
    }

    /// @dev A lot, an uninstall, its tokens sent away outside Sleeve, a reinstall, and a new lot half its size.
    function _uninstallForm() private returns (MockAccount account, uint256 oldLot, uint256 newLot) {
        (account, oldLot) = _lotAccount(_defaultRule());
        _ownerOp(account, OwnerOps.uninstall(address(module), address(account)));
        Execution[] memory calls = new Execution[](1);
        calls[0] = Execution(address(tokens[SPY]), 0, abi.encodeCall(IERC20.transfer, (sink, LOT_TOKENS)));
        account.execute(OwnerOps.batchMode(), ERC7579Utils.encodeBatch(calls));
        account.installModule(MODULE_TYPE_EXECUTOR, address(module), _installData(address(0), _defaultRule()));
        _pay(address(account), PAYMENT / 2);
        newLot = _keeperSplit(address(account));
        assertEq(tokens[SPY].balanceOf(address(account)), LOT_TOKENS / 2, "every token is the new lot's");
        (uint256[] memory ids, uint256 head) = module.lotsOf(address(account), SPY);
        assertEq(ids[head], oldLot, "the old lot heads the queue");
    }
}

/// @notice A1-03 on chain 4663 forked at block 78,312,136, with the deployed Kernel v3.1, real SPY and the D-010 pool:
/// the uninstall form of a phantom lot, from real keeper splits, with every owner step a UserOp through handleOps.
contract AuditLotsForkTest is SleeveModuleForkSellBase {
    function setUp() public {
        _setUpTrade();
    }

    /// A lot, an uninstall, the lot's tokens sent away by a plain root UserOp outside Sleeve, a reinstall and a second
    /// lot: the first lot still heads the queue though every token is the second's. reconcileLots trims the first lot,
    /// and the owner's sell by amount is then booked on the second, the lot that holds the tokens. Trimming newest first
    /// used to zero the second lot and leave the sale booked on the phantom.
    function test_fork_A1_03_acrossAnUninstallTheSellIsBookedOnTheLotThatHoldsTheTokens() public {
        Leg memory leg = _legs()[0];
        address account = _account(0, _defaultRule());
        ISleeveModule.Receipt memory first =
            _onlyReceipt(_keeperSplit(account, leg.pool, _quote(SPY, leg.pool, EQUITY)));
        assertTrue(_ownerOp(account, OwnerOps.uninstall(address(module), account)).success, "uninstall");
        Execution[] memory calls = new Execution[](1);
        calls[0] = Execution(Chain4663.SPY, 0, abi.encodeCall(IERC20.transfer, (recipient, first.tokensOut)));
        bytes memory sendAway =
            abi.encodeCall(IERC7579Execution.execute, (OwnerOps.batchMode(), ERC7579Utils.encodeBatch(calls)));
        assertTrue(_ownerOp(account, sendAway).success, "tokens sent away outside Sleeve");
        assertTrue(
            _installThroughOp(account, ownerKey, address(module), _installData(address(0), _defaultRule())).success,
            "reinstall"
        );
        _pay(account, PAYMENT);
        ISleeveModule.Receipt memory second =
            _onlyReceipt(_keeperSplit(account, leg.pool, _quote(SPY, leg.pool, EQUITY)));
        (uint256[] memory ids, uint256 head) = module.lotsOf(account, SPY);
        assertEq(ids.length, 2);
        assertEq(ids[head], first.id, "the phantom lot heads the queue");
        assertEq(IERC20(Chain4663.SPY).balanceOf(account), second.tokensOut, "every token is the second lot's");

        OpResult memory reconciled = _ownerOp(account, OwnerOps.reconcileLots(address(module), SPY));
        assertTrue(reconciled.success, "reconcile UserOp");
        ISleeveModule.Receipt[] memory trims = _receiptsIn(reconciled.logs, address(module));
        assertEq(trims.length, 1);
        assertEq(uint8(trims[0].status), uint8(Status.RECONCILED));
        assertEq(trims[0].lotId, first.id, "the lot whose tokens left");
        assertEq(trims[0].tokensIn, first.tokensOut);
        assertEq(module.lot(second.id).tokensRemaining, second.tokensOut, "the lot that holds the tokens keeps them");

        OpResult memory sold = _ownerSell(account, _sellArgs(SPY, leg.pool, second.tokensOut, 0));
        assertTrue(sold.success, "sell UserOp");
        ISleeveModule.Receipt[] memory sales = _receiptsIn(sold.logs, address(module));
        assertEq(sales.length, 1);
        assertEq(sales[0].lotId, second.id, "booked on the lot that holds the tokens");
        assertEq(uint8(sales[0].status), uint8(Status.SOLD));
        assertEq(IERC20(Chain4663.SPY).balanceOf(account), 0);
    }
}
