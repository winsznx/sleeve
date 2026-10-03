// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {AccountingMode, Reason, Status, Trigger} from "../../src/types/SleeveTypes.sol";
import {MockAccount} from "../mocks/MockAccount.sol";
import {OwnerOps} from "../utils/OwnerOps.sol";
import {SleeveModuleHarness} from "./SleeveModuleHarness.sol";
import {SleeveModuleUnitBase} from "./SleeveModuleUnitBase.sol";

/// @notice Shared setup for the split, settle, release and observe unit tests: a clear market at NOW, the harness
/// module on the mock router, accounts with a rule, every trigger, receipt capture, and the state snapshots the
/// nothing-moved assertions compare.
abstract contract SleeveModuleTradeUnitBase is SleeveModuleUnitBase {
    /// @dev Fork block 78,312,136, which the ArbSys mock returns as the L2 block.
    uint256 internal constant L2_BLOCK = 78_312_136;
    uint32 internal constant CALENDAR_VERSION = 0x00010000;
    uint256 internal constant INSTALLED = 100e6;
    uint256 internal constant PAYMENT = 500e6;

    SleeveModuleHarness internal module;
    address internal stranger = makeAddr("stranger");

    /// @notice Everything a reverted trigger must leave as it was.
    struct State {
        uint256 balance;
        uint256 spend;
        uint256 pendingTotal;
        uint256 unsorted;
        uint256[4] buckets;
        uint256[4] tokenBalances;
        uint256 nextReceiptId;
        uint256 venueUsdg;
        uint256 allowance;
        uint64 observedAt;
    }

    function _setUpTrade() internal {
        _setUpMocks();
        vm.roll(L2_BLOCK);
        _setMarket();
        module = _deployHarness();
        for (uint256 i; i < tokens.length; ++i) {
            tokens[i].setUid(keccak256(abi.encode("uid", i)));
        }
    }

    // Accounts

    /// @notice An account holding INSTALLED USDG with the module and `rule` installed, then paid `payment`.
    function _account(ISleeveModule.RuleInput memory rule, uint256 payment) internal returns (MockAccount account) {
        account = _accountWith(address(module), INSTALLED, _installData(address(0), rule));
        if (payment != 0) _pay(address(account), payment);
    }

    function _ruleOn(uint8 tickerId) internal pure returns (ISleeveModule.RuleInput memory rule) {
        rule = _defaultRule();
        rule.tickerId = tickerId;
    }

    // Triggers

    /// @notice The keeper's split with the rule ticker's pool and the router's own quote for the equity part.
    function _keeperSplit(address account) internal returns (uint256) {
        (address pool, uint256 quote) = _splitInputs(account);
        vm.prank(keeper);
        return module.split(account, pool, quote);
    }

    function _keeperSettle(address account, uint8 tickerId) internal returns (uint256) {
        uint256 amount = module.bucketOf(account, tickerId).amount;
        address pool = _pool(tickerId);
        uint256 quote = _quote(amount == 0 ? 1e6 : amount);
        vm.prank(keeper);
        return module.settle(account, tickerId, pool, quote);
    }

    /// @notice The pool and quote a keeper would pass for the account's next split.
    function _splitInputs(address account) internal view returns (address pool, uint256 quote) {
        ISleeveModule.Rule memory rule = module.ruleOf(account);
        (,,, uint256 unsorted) = module.ledger(account);
        uint256 equity = Math.mulDiv(unsorted, rule.equityBps, 10_000);
        return (_pool(rule.tickerId), _quote(equity == 0 ? 1e6 : equity));
    }

    /// @notice The owner's split from a bracketed owner op, as the app builds it.
    function _ownerSplit(MockAccount account) internal {
        (address pool, uint256 quote) = _splitInputs(address(account));
        _ownerOp(
            account,
            OwnerOps.single(
                address(module), address(module), abi.encodeCall(ISleeveModule.split, (address(account), pool, quote))
            )
        );
    }

    // Receipts

    /// @notice Every ReceiptWritten from the module in `logs`, in order, each checked against its topics and hash.
    function _receipts(Vm.Log[] memory logs) internal view returns (ISleeveModule.Receipt[] memory receipts) {
        uint256 count;
        for (uint256 i; i < logs.length; ++i) {
            if (_isReceipt(logs[i])) ++count;
        }
        receipts = new ISleeveModule.Receipt[](count);
        count = 0;
        for (uint256 i; i < logs.length; ++i) {
            if (!_isReceipt(logs[i])) continue;
            ISleeveModule.Receipt memory receipt = abi.decode(logs[i].data, (ISleeveModule.Receipt));
            assertEq(logs[i].topics[1], bytes32(receipt.id), "indexed id");
            assertEq(logs[i].topics[2], bytes32(uint256(uint160(receipt.account))), "indexed account");
            assertEq(logs[i].topics[3], bytes32(uint256(uint8(receipt.status))), "indexed status");
            assertEq(module.receiptHash(receipt.id), keccak256(logs[i].data), "stored hash");
            receipts[count++] = receipt;
        }
    }

    /// @notice The single receipt in `logs`.
    function _onlyReceipt(Vm.Log[] memory logs) internal view returns (ISleeveModule.Receipt memory) {
        ISleeveModule.Receipt[] memory receipts = _receipts(logs);
        assertEq(receipts.length, 1, "one receipt");
        return receipts[0];
    }

    function _isReceipt(Vm.Log memory log) private view returns (bool) {
        return log.emitter == address(module) && log.topics.length == 4
            && log.topics[0] == ISleeveModule.ReceiptWritten.selector;
    }

    /// @notice The fields SleeveReceipts fills on every receipt.
    function _assertModuleFields(ISleeveModule.Receipt memory receipt, address account) internal view {
        assertEq(receipt.account, account, "account");
        assertEq(uint8(receipt.mode), uint8(AccountingMode.WRAPPED), "mode");
        assertEq(receipt.calendarVersion, CALENDAR_VERSION, "calendar version");
        assertEq(receipt.disclosureHash, DISCLOSURE_HASH, "disclosure hash");
        assertEq(receipt.l2Block, L2_BLOCK, "L2 block");
        assertEq(receipt.timestamp, block.timestamp, "timestamp");
        assertEq(receipt.payer, address(0), "payer");
    }

    // Invariants

    /// @notice I2 on a split receipt.
    function _assertI2(ISleeveModule.Receipt memory receipt) internal pure {
        assertEq(receipt.usdgIn, receipt.usdgToSpend + receipt.usdgSpent + receipt.usdgQueued, "I2: conservation");
    }

    /// @notice I1: the module holds no USDG and no stock token.
    function _assertI1() internal view {
        assertEq(usdg.balanceOf(address(module)), 0, "I1: module holds USDG");
        for (uint256 i; i < tokens.length; ++i) {
            assertEq(tokens[i].balanceOf(address(module)), 0, "I1: module holds a stock token");
        }
    }

    /// @notice The ledgers account for the whole balance and pendingTotal is the sum of the buckets.
    function _assertLedgersWhole(address account) internal view {
        (uint256 balance, uint256 spend, uint256 pendingTotal, uint256 unsorted) = module.ledger(account);
        uint256 buckets;
        for (uint8 t; t < TICKER_COUNT; ++t) {
            buckets += module.bucketOf(account, t).amount;
        }
        assertEq(pendingTotal, buckets, "pendingTotal is the sum of the buckets");
        assertEq(spend + pendingTotal + unsorted, balance, "the ledgers account for the balance");
    }

    // Snapshots

    function _state(address account) internal view returns (State memory state) {
        (state.balance, state.spend, state.pendingTotal, state.unsorted) = module.ledger(account);
        for (uint8 t; t < TICKER_COUNT; ++t) {
            state.buckets[t] = module.bucketOf(account, t).amount;
            state.tokenBalances[t] = tokens[t].balanceOf(account);
        }
        state.nextReceiptId = module.nextReceiptId();
        state.venueUsdg = _venueUsdg();
        state.allowance = IERC20(address(usdg)).allowance(account, address(router));
        (state.observedAt,) = module.observationOf(account);
    }

    /// @notice USDG the router and every ticker's fee-500 pool hold: where a buy's USDG goes.
    function _venueUsdg() internal view returns (uint256 held) {
        held = usdg.balanceOf(address(router));
        for (uint256 i; i < tokens.length; ++i) {
            held += usdg.balanceOf(factory.getPool(address(usdg), address(tokens[i]), 500));
        }
    }

    /// @notice Balances, ledgers, buckets, receipts, allowance and observation are all as they were.
    function _assertUnchanged(State memory before, State memory afterwards) internal pure {
        assertEq(abi.encode(afterwards), abi.encode(before), "nothing moved");
    }
}
