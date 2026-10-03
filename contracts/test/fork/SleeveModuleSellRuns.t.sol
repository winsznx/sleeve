// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {Execution} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {IUniswapV3Pool} from "../../src/interfaces/IUniswapV3Pool.sol";
import {Status} from "../../src/types/SleeveTypes.sol";
import {SleeveModuleForkSellBase} from "../harness/SleeveModuleForkSellBase.sol";
import {OwnerOps} from "../utils/OwnerOps.sol";

/// @notice docs/SPEC.md section 13's grouping of sell receipts, from review round 2, on chain 4663 forked at block
/// 78,312,136 with the real SPY token, feed and D-010 fee-500 pool, SwapRouter02, and an account on the deployed Kernel
/// v3.1 driven through EntryPoint handleOps with a real signature. One transaction can hold several sells of one
/// ticker, so a sell's receipts are the run that follows its own Swap log, never the whole transaction. _sellRuns is
/// that grouping as the verifier applies it to one transaction's logs.
contract SleeveModuleSellRunsForkTest is SleeveModuleForkSellBase {
    using SafeCast for uint256;

    /// @dev Uniswap v3's Swap event, which the pool writes once per swap.
    bytes32 private constant SWAP = keccak256("Swap(address,address,int256,int256,uint160,uint128,int24)");

    /// @dev One sell's run: receipts[first] to receipts[first + count - 1] of the transaction's PART_SOLD and SOLD
    /// receipts, the index of the Swap log they follow, and their sums.
    struct Run {
        uint256 first;
        uint256 count;
        uint256 swapLog;
        uint256 tokensIn;
        uint256 usdgOut;
    }

    address private account;
    uint256[2] private lotIds;
    uint256[2] private lotTokens;
    /// @dev By amount across the first lot and half the second, then the rest of the second lot by id.
    OwnerOps.SellArgs[2] private sells;

    /// @dev An account on the product default rule with two SPY lots from keeper splits of 1,000 USDG, and the two
    /// sells quoted on the fee-500 pool before either runs.
    function setUp() public {
        _setUpTrade();
        address pool = _legs()[0].pool;
        account = _account(0, _defaultRule());
        for (uint256 i; i < lotIds.length; ++i) {
            if (i != 0) _pay(account, PAYMENT);
            ISleeveModule.Receipt memory fill = _onlyReceipt(_keeperSplit(account, pool, _quote(SPY, pool, EQUITY)));
            (lotIds[i], lotTokens[i]) = (fill.id, fill.tokensOut);
        }
        uint256 half = lotTokens[1] / 2;
        sells[0] = _sellArgs(SPY, pool, lotTokens[0] + half, 0);
        sells[1] = _sellArgs(SPY, pool, lotTokens[1] - half, lotIds[1]);
    }

    /// One bracketed owner UserOp sells SPY by amount across the oldest lot and half the next, then sells the rest of
    /// that lot by id, as an owner batch of lots sold by id or a sell split at the 100-lot bound would. The three
    /// receipts have sequential ids, one account, one ticker and one pool, and the second lot shows in both sells.
    /// Grouped as SPEC 13 says, each run follows its own Swap log and sums to exactly what that swap took and paid,
    /// its execPrice and premiumBps recompute from its sums, and each receipt equals the one rebuilt from chain state
    /// and its run, tokenUid and uiMultiplier read at the sale included. The first sale moves the pool, so summed over
    /// the whole transaction the receipts give a price neither sell had, and a reader that grouped by transaction
    /// would flag genuine receipts.
    function test_fork_twoSellsOfOneTickerInOneUserOp_groupByRunNotByTransaction() public {
        uint256 nextId = module.nextReceiptId();
        uint256 usdgBefore = USDG.balanceOf(account);

        OpResult memory result = _ownerOp(account, OwnerOps.callData(address(module), _sellCalls()));

        assertTrue(result.success, "two sells in one UserOp");
        assertEq(_receiptsIn(result.logs, address(module)).length, 3, "the UserOp wrote only sell receipts");
        (ISleeveModule.Receipt[] memory receipts, Run[] memory runs) = _sellRuns(result.logs);
        assertEq(receipts.length, 3, "two lots in the first sell, one in the second");
        uint256 half = sells[0].tokenAmount - lotTokens[0];
        _assertTook(receipts[0], nextId, lotIds[0], lotTokens[0], Status.SOLD);
        _assertTook(receipts[1], nextId + 1, lotIds[1], half, Status.PART_SOLD);
        _assertTook(receipts[2], nextId + 2, lotIds[1], lotTokens[1] - half, Status.SOLD);
        assertEq(runs.length, 2, "one run per sell");
        assertEq(runs[0].count, 2, "the first sell took two lots");
        assertEq(runs[1].count, 1, "the second sell took one");
        assertLt(runs[0].swapLog, runs[1].swapLog, "each run follows its own swap");
        uint256 usdgOut;
        for (uint256 k; k < runs.length; ++k) {
            _assertRunIsItsSwap(result.logs[runs[k].swapLog], runs[k], receipts[runs[k].first], sells[k]);
            _assertRunReceipts(receipts, runs[k], sells[k]);
            usdgOut += runs[k].usdgOut;
        }
        assertEq(USDG.balanceOf(account) - usdgBefore, usdgOut, "the runs sum to the USDG the account received");
        _assertProceedsAreTheModulesDelta(result, usdgBefore, usdgOut);

        uint256 blended = usdgOut * 1e18 / (runs[0].tokensIn + runs[1].tokensIn);
        assertLt(receipts[2].execPrice, receipts[0].execPrice, "the first sale moved the pool's price down");
        assertNotEq(blended, receipts[0].execPrice, "summed over the transaction, not the first sell's price");
        assertNotEq(blended, receipts[2].execPrice, "nor the second sell's");
    }

    // SPEC 13's grouping

    /// @dev Groups one transaction's PART_SOLD and SOLD receipts as SPEC 13 says. A receipt continues the run before
    /// it when its id is the next one, its account and tickerId are the same, the latest Swap log of its pool before
    /// it is the same, and every whole-sell field is equal. Otherwise it starts a run of its own.
    function _sellRuns(Vm.Log[] memory logs)
        private
        view
        returns (ISleeveModule.Receipt[] memory receipts, Run[] memory runs)
    {
        uint256[] memory swapLogs;
        (receipts, swapLogs) = _sellReceipts(logs);
        uint256 count;
        for (uint256 i; i < receipts.length; ++i) {
            if (!_continuesRun(receipts, swapLogs, i)) ++count;
        }
        runs = new Run[](count);
        count = 0;
        for (uint256 i; i < receipts.length; ++i) {
            if (!_continuesRun(receipts, swapLogs, i)) runs[count++] = Run(i, 0, swapLogs[i], 0, 0);
            Run memory run = runs[count - 1];
            ++run.count;
            run.tokensIn += receipts[i].tokensIn;
            run.usdgOut += receipts[i].usdgOut;
        }
    }

    function _continuesRun(ISleeveModule.Receipt[] memory receipts, uint256[] memory swapLogs, uint256 i)
        private
        pure
        returns (bool)
    {
        if (i == 0) return false;
        ISleeveModule.Receipt memory previous = receipts[i - 1];
        ISleeveModule.Receipt memory receipt = receipts[i];
        return receipt.id == previous.id + 1 && receipt.account == previous.account
            && receipt.tickerId == previous.tickerId && swapLogs[i] == swapLogs[i - 1]
            && keccak256(_wholeSell(receipt)) == keccak256(_wholeSell(previous));
    }

    /// @dev The fields every receipt of one sell shares.
    function _wholeSell(ISleeveModule.Receipt memory receipt) private pure returns (bytes memory) {
        return abi.encode(
            receipt.execPrice,
            receipt.premiumBps,
            receipt.roundId,
            receipt.answer,
            receipt.updatedAt,
            receipt.usdgRoundId,
            receipt.usdgAnswer,
            receipt.quote,
            receipt.minOut,
            receipt.pool,
            receipt.overrideClosed,
            receipt.overrideCapBps
        );
    }

    /// @dev The module's PART_SOLD and SOLD receipts in log order, each with the index of the latest Swap log its pool
    /// wrote before it.
    function _sellReceipts(Vm.Log[] memory logs)
        private
        view
        returns (ISleeveModule.Receipt[] memory receipts, uint256[] memory swapLogs)
    {
        uint256 count;
        for (uint256 i; i < logs.length; ++i) {
            if (_isSellReceipt(logs[i])) ++count;
        }
        receipts = new ISleeveModule.Receipt[](count);
        swapLogs = new uint256[](count);
        count = 0;
        for (uint256 i; i < logs.length; ++i) {
            if (!_isSellReceipt(logs[i])) continue;
            receipts[count] = abi.decode(logs[i].data, (ISleeveModule.Receipt));
            swapLogs[count] = _latestSwapLog(logs, i, receipts[count].pool);
            ++count;
        }
    }

    function _isSellReceipt(Vm.Log memory log) private view returns (bool) {
        if (log.emitter != address(module) || log.topics.length != 4) return false;
        if (log.topics[0] != ISleeveModule.ReceiptWritten.selector) return false;
        return log.topics[3] == bytes32(uint256(uint8(Status.PART_SOLD)))
            || log.topics[3] == bytes32(uint256(uint8(Status.SOLD)));
    }

    /// @dev The index of the latest Swap log the pool wrote before log `before`.
    function _latestSwapLog(Vm.Log[] memory logs, uint256 before, address pool) private pure returns (uint256 index) {
        bool found;
        for (uint256 i; i < before; ++i) {
            if (logs[i].emitter == pool && logs[i].topics.length == 3 && logs[i].topics[0] == SWAP) {
                (index, found) = (i, true);
            }
        }
        assertTrue(found, "a sell receipt follows a Swap log of its pool");
    }

    // Checks

    /// @dev What one receipt took: its id, the lot, the lot's part and the status the lot moved to.
    function _assertTook(ISleeveModule.Receipt memory receipt, uint256 id, uint256 lotId, uint256 part, Status status)
        private
        pure
    {
        assertEq(receipt.id, id, "sequential ids across both sells");
        assertEq(receipt.lotId, lotId, "the lot");
        assertEq(receipt.tokensIn, part, "the lot's part");
        assertEq(uint8(receipt.status), uint8(status), "the lot's new status");
    }

    /// @dev The run's Swap log, on the sell's pool, paid the account and moved exactly the run's sums: the tokens the
    /// pool took and the USDG it paid. The run is the whole sell, and its execPrice and premiumBps recompute from its
    /// sums.
    function _assertRunIsItsSwap(
        Vm.Log memory swap,
        Run memory run,
        ISleeveModule.Receipt memory head,
        OwnerOps.SellArgs memory args
    ) private view {
        (int256 amount0, int256 amount1,,,) = abi.decode(swap.data, (int256, int256, uint160, uint128, int24));
        (int256 tokenDelta, int256 usdgDelta) =
            IUniswapV3Pool(swap.emitter).token0() == head.token ? (amount0, amount1) : (amount1, amount0);
        assertEq(swap.emitter, args.pool, "the sell's pool");
        assertEq(swap.topics[2], bytes32(uint256(uint160(account))), "the swap paid the account");
        assertEq(tokenDelta, run.tokensIn.toInt256(), "the pool took exactly the run's tokens");
        assertEq(usdgDelta, -run.usdgOut.toInt256(), "the pool paid exactly the run's USDG");
        assertEq(run.tokensIn, args.tokenAmount, "the run is the whole sell");
        assertEq(head.execPrice, run.usdgOut * 1e18 / run.tokensIn, "execPrice from the run's sums");
        assertEq(head.premiumBps, _discountOf(run.usdgOut, run.tokensIn, head.answer), "premiumBps from the run's sums");
    }

    /// @dev Each receipt of the run equals, field for field, the one rebuilt from chain state with the run's proceeds
    /// as the whole sell's, its own lot and part, and its pro rata share of those proceeds, the last lot taking the
    /// remainder. tokenUid and uiMultiplier are the token's, read at the sale.
    function _assertRunReceipts(ISleeveModule.Receipt[] memory receipts, Run memory run, OwnerOps.SellArgs memory args)
        private
        view
    {
        uint256 paid;
        for (uint256 j; j < run.count; ++j) {
            ISleeveModule.Receipt memory receipt = receipts[run.first + j];
            uint256 share = j + 1 == run.count ? run.usdgOut - paid : run.usdgOut * receipt.tokensIn / args.tokenAmount;
            paid += share;
            ISleeveModule.Receipt memory expected =
                _expectedSold(account, args, receipt.id, receipt.lotId, receipt.status, run.usdgOut);
            expected.tokensIn = receipt.tokensIn;
            expected.usdgOut = share;
            expected.usdgToSpend = share;
            assertEq(abi.encode(receipt), abi.encode(expected), "every receipt field");
            assertNotEq(receipt.tokenUid, bytes32(0), "a sell receipt carries the token's uid");
            assertGt(receipt.uiMultiplier, 0, "and its multiplier");
        }
    }

    /// @dev The two sells as one owner batch.
    function _sellCalls() private view returns (Execution[] memory calls) {
        calls = new Execution[](sells.length);
        for (uint256 i; i < sells.length; ++i) {
            calls[i] = _sellCall(sells[i]);
        }
    }

    /// @dev A sell as one call of an owner batch that holds more than one.
    function _sellCall(OwnerOps.SellArgs memory args) private view returns (Execution memory) {
        return Execution(
            address(module),
            0,
            abi.encodeCall(
                ISleeveModule.sell,
                (
                    args.tickerId,
                    args.tokenAmount,
                    args.lotId,
                    args.pool,
                    args.quote,
                    args.overrideClosed,
                    args.overrideCapBps
                )
            )
        );
    }
}
