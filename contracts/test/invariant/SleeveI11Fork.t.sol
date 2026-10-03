// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    Execution,
    IERC7579Execution,
    IERC7579ModuleConfig,
    MODULE_TYPE_EXECUTOR
} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {ERC7579Utils} from "@openzeppelin/contracts/account/utils/draft-ERC7579Utils.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {Vm} from "forge-std/Vm.sol";
import {Kernel} from "kernel/Kernel.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {Reason, Status, Trigger} from "../../src/types/SleeveTypes.sol";
import {SleeveModuleForkTradeBase} from "../harness/SleeveModuleForkTradeBase.sol";
import {LaunchConfig} from "../mocks/LaunchConfig.sol";
import {Chain4663} from "../utils/Chain4663.sol";

/// @notice I11 on chain 4663 forked at block 78,312,136: with the keeper set to zero and no app, the owner exits with
/// nothing but the root key and raw UserOps through EntryPoint v0.7 handleOps. No call here goes through OwnerOps or
/// any Sleeve helper: each UserOp's callData is Kernel's execute built inline. The account holds a SPY lot from an
/// owner-triggered fill and a SPY bucket from a clipped split. The exit runs a day and a half later, so every feed is
/// stale and the rule is paused, and still the owner releases the bucket, withdraws all of spend, sends the stock
/// tokens away and uninstalls, and the account ends with no USDG, no SPY and no module state.
contract SleeveI11ForkTest is SleeveModuleForkTradeBase {
    /// @dev ERC-7579 single call, default exec type.
    bytes32 private constant SINGLE = bytes32(0);
    /// @dev ERC-7579 batch call, default exec type.
    bytes32 private constant BATCH = bytes32(uint256(1) << 248);
    uint128 private constant HIGH_CLIP = 500e6;

    address private account;
    address private exit = makeAddr("owner's other wallet");

    function setUp() public {
        _setUpTrade();
        account = _account(keccak256("I11"), _defaultRule());
        _raw(_single(address(module), abi.encodeCall(ISleeveModule.setKeeper, (address(0)))), "keeper to zero");
        assertEq(module.keeperOf(account), address(0), "no keeper");

        uint256 quote = _quote(SPY, LaunchConfig.SPY_POOL_500, EQUITY);
        OpResult memory filled = _raw(
            _single(address(module), abi.encodeCall(ISleeveModule.split, (account, LaunchConfig.SPY_POOL_500, quote))),
            "owner split"
        );
        ISleeveModule.Receipt[] memory receipts = _receiptsIn(filled.logs, address(module));
        assertEq(receipts.length, 1);
        assertEq(uint8(receipts[0].status), uint8(Status.FILLED), "a lot to take away");
        assertEq(uint8(receipts[0].trigger), uint8(Trigger.OWNER));

        ISleeveModule.RuleInput memory clipped = _defaultRule();
        clipped.minClip = HIGH_CLIP;
        _raw(_single(address(module), abi.encodeCall(ISleeveModule.setRule, (clipped))), "clip above the equity part");
        _pay(account, PAYMENT);
        OpResult memory queued = _raw(
            _single(address(module), abi.encodeCall(ISleeveModule.split, (account, LaunchConfig.SPY_POOL_500, quote))),
            "owner split into the bucket"
        );
        receipts = _receiptsIn(queued.logs, address(module));
        assertEq(uint8(receipts[0].status), uint8(Status.QUEUED));
        assertEq(uint8(receipts[0].reason), uint8(Reason.CLIP));
        assertEq(module.bucketOf(account, SPY).amount, EQUITY, "a bucket to release");

        _raw(_single(address(module), abi.encodeCall(ISleeveModule.pauseRule, ())), "pause the rule");
        vm.warp(block.timestamp + 36 hours);
    }

    /// I11: release, a bracket the owner writes by hand around the withdrawal, the token transfer and the uninstall,
    /// one raw UserOp each, with stale feeds, a paused rule and no keeper.
    function test_I11_fork_ownerExitsWithRawUserOpsAndNoKeeper() public {
        uint256 lotTokens = IERC20(Chain4663.SPY).balanceOf(account);
        assertGt(lotTokens, 0);
        (uint256 balance, uint256 spendBefore,,) = module.ledger(account);
        assertEq(balance, 2 * PAYMENT - EQUITY, "two payments less the fill");
        assertEq(spendBefore, 2 * SPEND_PART, "both spend parts");

        OpResult memory released =
            _raw(_single(address(module), abi.encodeCall(ISleeveModule.release, (SPY))), "release");
        ISleeveModule.Receipt[] memory receipts = _receiptsIn(released.logs, address(module));
        assertEq(receipts.length, 1);
        assertEq(uint8(receipts[0].status), uint8(Status.RELEASED));
        assertEq(uint8(receipts[0].trigger), uint8(Trigger.OWNER));
        assertEq(receipts[0].usdgToSpend, EQUITY);
        (, uint256 spend, uint256 pendingTotal, uint256 unsorted) = module.ledger(account);
        assertEq(spend, balance, "all of the balance is spend");
        assertEq(pendingTotal + unsorted, 0);

        Execution[] memory calls = new Execution[](3);
        calls[0] = Execution(address(module), 0, abi.encodeCall(ISleeveModule.beginOwnerOp, ()));
        calls[1] = Execution(Chain4663.USDG, 0, abi.encodeCall(IERC20.transfer, (exit, spend)));
        calls[2] = Execution(address(module), 0, abi.encodeCall(ISleeveModule.endOwnerOp, ()));
        OpResult memory withdrawn = _raw(_batch(calls), "withdraw spend");
        Vm.Log[] memory ended = _logsOf(withdrawn, address(module), ISleeveModule.OwnerOpEnded.selector);
        assertEq(ended.length, 1);
        assertEq(
            ended[0].data,
            abi.encode(balance, int256(0), -SafeCast.toInt256(spend), spend, uint256(0), new uint256[](0)),
            "the withdrawal came out of spend"
        );
        (balance, spend, pendingTotal, unsorted) = module.ledger(account);
        assertEq(balance + spend + pendingTotal + unsorted, 0, "nothing left on any ledger");

        _raw(_single(Chain4663.SPY, abi.encodeCall(IERC20.transfer, (exit, lotTokens))), "tokens out");

        OpResult memory uninstalled = _raw(
            _single(
                account,
                abi.encodeCall(IERC7579ModuleConfig.uninstallModule, (MODULE_TYPE_EXECUTOR, address(module), ""))
            ),
            "uninstall"
        );
        (bool found, bool succeeded) = _uninstallResult(uninstalled, account, address(module));
        assertTrue(found && succeeded, "onUninstall succeeded");

        _assertExited(2 * PAYMENT - EQUITY, lotTokens);
    }

    /// I11 without even a bracket: a bare transfer of the whole balance, which the ledgers only see as a shortfall,
    /// then the tokens and a bare uninstall, which releases the bucket's entry with a RELEASED receipt and deletes the
    /// state. Nothing in the module stands between the owner and their own USDG.
    function test_I11_fork_ownerExitsWithoutKnowingAboutBrackets() public {
        uint256 lotTokens = IERC20(Chain4663.SPY).balanceOf(account);
        uint256 balance = USDG.balanceOf(account);

        _raw(_single(Chain4663.USDG, abi.encodeCall(IERC20.transfer, (exit, balance))), "bare withdrawal");
        _raw(_single(Chain4663.SPY, abi.encodeCall(IERC20.transfer, (exit, lotTokens))), "tokens out");
        OpResult memory uninstalled = _raw(
            _single(
                account,
                abi.encodeCall(IERC7579ModuleConfig.uninstallModule, (MODULE_TYPE_EXECUTOR, address(module), ""))
            ),
            "uninstall"
        );

        (bool found, bool succeeded) = _uninstallResult(uninstalled, account, address(module));
        assertTrue(found && succeeded, "onUninstall succeeded");
        ISleeveModule.Receipt[] memory receipts = _receiptsIn(uninstalled.logs, address(module));
        assertEq(receipts.length, 1, "the bucket's RELEASED receipt");
        assertEq(uint8(receipts[0].status), uint8(Status.RELEASED));
        assertEq(receipts[0].usdgToSpend, EQUITY);
        _assertExited(balance, lotTokens);
    }

    // Helpers

    function _assertExited(uint256 usdgOut, uint256 tokensOut) private view {
        assertEq(USDG.balanceOf(account), 0, "no USDG left in the account");
        assertEq(IERC20(Chain4663.SPY).balanceOf(account), 0, "no SPY left in the account");
        assertEq(USDG.balanceOf(exit), usdgOut, "every USDG reached the owner's wallet");
        assertEq(IERC20(Chain4663.SPY).balanceOf(exit), tokensOut, "every token reached the owner's wallet");
        assertFalse(module.isInitialized(account), "module state deleted");
        assertFalse(Kernel(payable(account)).isModuleInstalled(MODULE_TYPE_EXECUTOR, address(module), ""));
        (uint256 balance, uint256 spend, uint256 pendingTotal, uint256 unsorted) = module.ledger(account);
        assertEq(balance + spend + pendingTotal + unsorted, 0);
        assertEq(module.bucketOf(account, SPY).amount, 0);
        assertEq(module.keeperOf(account), address(0));
        _assertHoldsNothingAtAll(address(module));
    }

    /// @dev One root UserOp from the owner's key, which must succeed.
    function _raw(bytes memory callData, string memory what) private returns (OpResult memory result) {
        result = _ownerOp(account, callData);
        if (!result.success) emit log_named_bytes(what, result.revertReason);
        assertTrue(result.success, what);
    }

    function _single(address target, bytes memory data) private pure returns (bytes memory) {
        return abi.encodeCall(IERC7579Execution.execute, (SINGLE, abi.encodePacked(target, uint256(0), data)));
    }

    function _batch(Execution[] memory calls) private pure returns (bytes memory) {
        return abi.encodeCall(IERC7579Execution.execute, (BATCH, ERC7579Utils.encodeBatch(calls)));
    }
}
