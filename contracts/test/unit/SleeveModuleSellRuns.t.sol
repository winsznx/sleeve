// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Execution} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {Status} from "../../src/types/SleeveTypes.sol";
import {SleeveModuleSellUnitBase} from "../harness/SleeveModuleSellUnitBase.sol";
import {MockAccount} from "../mocks/MockAccount.sol";
import {MockTwoWayRouter} from "../mocks/MockTwoWayRouter.sol";
import {OwnerOps} from "../utils/OwnerOps.sol";

/// @notice docs/SPEC.md section 13 and D-027 for sell receipts, from review round 2: one transaction can hold several
/// sells of one ticker, each sell writes its own run of PART_SOLD and SOLD receipts with its own whole-sell fields, so
/// a reader sums tokensIn and usdgOut over a sell's run and never over the transaction, and a sale reads tokenUid and
/// uiMultiplier from the token when it runs. The mock pool writes no Swap log, so the grouping by the Swap log a run
/// follows is pinned on real logs in test/fork/SleeveModuleSellRuns.t.sol.
contract SleeveModuleSellRunsTest is SleeveModuleSellUnitBase {
    /// @dev The venue's sell price after the first sale, 10 bps under the feed: 499.5 USDG per token.
    uint256 private constant LOWER_SELL_PRICE = FAIR_SELL_PRICE * 9_990 / 10_000;
    /// @dev The first sell: 0.15 token at 500 USDG, 50 for the oldest lot's 0.1 and 25 for half the next.
    uint256 private constant FIRST_PROCEEDS = 75e6;
    /// @dev The second sell: the other 0.05 token of the second lot at 499.5 USDG.
    uint256 private constant SECOND_PROCEEDS = 24_975_000;

    MockAccount private account;
    uint256 private firstLot;

    function setUp() public {
        _setUpSell();
        (account, firstLot) = _lotAccount(_defaultRule());
    }

    /// One owner op sells by amount across the oldest lot and half the next, then sells the rest of that lot by id
    /// after the venue's price fell 10 bps, as the first sale would move a real pool. The three receipts have
    /// sequential ids, one account, one ticker and one pool, and the second lot shows in both sells. Each sell's
    /// receipts carry its own price, discount and minOut and sum to its own tokens and proceeds: 500 USDG per token
    /// with no discount, then 499.5 with 10 bps. Summed over the op they give 499.875 USDG per token and a 3 bps
    /// discount, which neither sell had, so a reader that grouped by transaction would flag all three receipts.
    function test_sell_twoSellsInOneOwnerOp_eachIsItsOwnRunOfReceipts() public {
        uint256 secondLot = _buyLot(account);
        OwnerOps.SellArgs memory byAmount = _args(SPY, LOT_TOKENS * 3 / 2, 0);
        OwnerOps.SellArgs memory byLot = _args(SPY, LOT_TOKENS / 2, secondLot);
        uint256 nextId = module.nextReceiptId();
        uint256 usdgBefore = usdg.balanceOf(address(account));

        ISleeveModule.Receipt[] memory receipts = _sellTwiceInOneOp(byAmount, byLot);

        assertEq(receipts.length, 3, "two lots in the first sell, one in the second");
        assertEq(usdg.balanceOf(address(account)) - usdgBefore, FIRST_PROCEEDS + SECOND_PROCEEDS, "both sales paid");
        _assertSoldReceipt(
            receipts[0],
            address(account),
            byAmount,
            Sold({id: nextId, lotId: firstLot, status: Status.SOLD, tokensIn: LOT_TOKENS, share: 50e6}),
            FIRST_PROCEEDS
        );
        _assertSoldReceipt(
            receipts[1],
            address(account),
            byAmount,
            Sold({id: nextId + 1, lotId: secondLot, status: Status.PART_SOLD, tokensIn: LOT_TOKENS / 2, share: 25e6}),
            FIRST_PROCEEDS
        );
        _assertSoldReceipt(
            receipts[2],
            address(account),
            byLot,
            Sold({
                id: nextId + 2, lotId: secondLot, status: Status.SOLD, tokensIn: LOT_TOKENS / 2, share: SECOND_PROCEEDS
            }),
            SECOND_PROCEEDS
        );
        assertEq(receipts[0].execPrice, FAIR_SELL_PRICE, "the first sell's price");
        assertEq(receipts[0].premiumBps, 0, "the first sell's discount");
        assertEq(receipts[2].execPrice, LOWER_SELL_PRICE, "the second sell's price");
        assertEq(receipts[2].premiumBps, 10, "the second sell's discount");

        uint256 tokensIn = receipts[0].tokensIn + receipts[1].tokensIn + receipts[2].tokensIn;
        uint256 usdgOut = receipts[0].usdgOut + receipts[1].usdgOut + receipts[2].usdgOut;
        assertEq(usdgOut * 1e18 / tokensIn, 499_875_000, "summed over the op, a price neither sell had");
        assertEq(_discount(usdgOut, tokensIn, FEED_ANSWER), 3, "and a discount neither sell had");
    }

    /// A sale reads tokenUid and uiMultiplier from the token when it runs, not from the lot's buy: a multiplier
    /// change that took effect after the buy, and a different uid, show on the sale's receipt.
    function test_sell_receiptReadsTokenUidAndMultiplierAtTheSale() public {
        vm.recordLogs();
        uint256 lotId = _buyLot(account);
        ISleeveModule.Receipt memory filled = _onlyReceipt(vm.getRecordedLogs());
        bytes32 laterUid = keccak256("uid at the sale");
        tokens[SPY].setUid(laterUid);
        tokens[SPY].scheduleMultiplier(1.002e18, block.timestamp + 10 minutes);
        vm.warp(block.timestamp + 10 minutes);
        _setMarket();

        vm.recordLogs();
        _sell(account, _args(SPY, LOT_TOKENS, lotId));
        ISleeveModule.Receipt memory sold = _onlyReceipt(vm.getRecordedLogs());

        assertEq(uint8(sold.status), uint8(Status.SOLD));
        assertEq(sold.lotId, filled.id, "the lot the buy created");
        assertEq(sold.tokenUid, laterUid, "the token's uid at the sale");
        assertEq(sold.uiMultiplier, 1.002e18, "the multiplier in force at the sale");
        assertEq(filled.tokenUid, keccak256(abi.encode("uid", uint256(SPY))), "the buy read the earlier uid");
        assertEq(filled.uiMultiplier, 1e18, "and the earlier multiplier");
    }

    /// @dev One bracketed owner op: the first sell, the venue's price down to LOWER_SELL_PRICE, the second sell.
    /// @return The receipts the op wrote, in order.
    function _sellTwiceInOneOp(OwnerOps.SellArgs memory firstSell, OwnerOps.SellArgs memory secondSell)
        private
        returns (ISleeveModule.Receipt[] memory)
    {
        Execution[] memory calls = new Execution[](3);
        calls[0] = _sellCall(firstSell);
        calls[1] = Execution(address(venue), 0, abi.encodeCall(MockTwoWayRouter.setSellPrice, (LOWER_SELL_PRICE)));
        calls[2] = _sellCall(secondSell);
        vm.recordLogs();
        _ownerOp(account, OwnerOps.callData(address(module), calls));
        return _receipts(vm.getRecordedLogs());
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
