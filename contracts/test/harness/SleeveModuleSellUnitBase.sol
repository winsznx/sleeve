// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {AccountingMode, Reason, Status, Trigger} from "../../src/types/SleeveTypes.sol";
import {MockAccount} from "../mocks/MockAccount.sol";
import {MockTwoWayRouter} from "../mocks/MockTwoWayRouter.sol";
import {OwnerOps} from "../utils/OwnerOps.sol";
import {SleeveModuleTradeUnitBase} from "./SleeveModuleTradeUnitBase.sol";

/// @notice Shared setup for the sell and lot reconcile unit tests: the harness module on MockTwoWayRouter, which buys
/// at the router's fair price and sells at the feed price, accounts holding lots bought through keeper splits, the
/// owner's sells direct and bracketed, every SPEC 13 field of a sell receipt rebuilt here, and the snapshot a reverted
/// sell must leave unchanged.
/// @dev The inherited router stays at FAIR_PRICE, which is also the venue's buy price, so the inherited split helpers
/// quote buys correctly. The module's router is the venue.
abstract contract SleeveModuleSellUnitBase is SleeveModuleTradeUnitBase {
    /// @dev 500 USDG per token, the feed price: USDG base units per 1e18 token base units. A sale at it has a zero
    /// discount.
    uint256 internal constant FAIR_SELL_PRICE = 500e6;
    /// @dev One lot: the equity part of PAYMENT under the default rule, 50 USDG, buys 0.1 token at FAIR_PRICE.
    uint256 internal constant LOT_TOKENS = 1e17;
    uint256 internal constant LOT_USDG = 50e6;
    /// @dev What a keeper split of PAYMENT under the default rule leaves in spend, with the install snapshot.
    uint256 internal constant SPEND_AFTER_LOT = INSTALLED + PAYMENT - LOT_USDG;

    MockTwoWayRouter internal venue;

    /// @notice Everything a reverted sell must leave as it was.
    struct SellState {
        uint256 balance;
        uint256 spend;
        uint256 pendingTotal;
        uint256 unsorted;
        uint256[4] tokenBalances;
        uint256 venueTokens;
        uint256 venueUsdg;
        uint256 moduleUsdg;
        uint256 moduleTokens;
        uint256 allowance;
        uint256 nextReceiptId;
        uint256 head;
        bytes lots;
    }

    /// @notice One lot a sell took from, for the receipt rebuilt here.
    struct Sold {
        uint256 id;
        uint256 lotId;
        Status status;
        uint256 tokensIn;
        uint256 share;
    }

    function _setUpSell() internal {
        _setUpTrade();
        venue = new MockTwoWayRouter(address(factory), address(usdg), FAIR_PRICE, FAIR_SELL_PRICE);
        swapRouter = address(venue);
        module = _deployHarness();
    }

    // Lots

    /// @notice An account with `rule` and one lot of the rule's ticker, bought by a keeper split of PAYMENT.
    function _lotAccount(ISleeveModule.RuleInput memory rule) internal returns (MockAccount account, uint256 lotId) {
        account = _account(rule, PAYMENT);
        lotId = _keeperSplit(address(account));
        assertEq(uint8(module.lot(lotId).status), uint8(Status.FILLED), "the split filled");
    }

    /// @notice One more lot for the account: a payment and a keeper split.
    function _buyLot(MockAccount account) internal returns (uint256 lotId) {
        _pay(address(account), PAYMENT);
        lotId = _keeperSplit(address(account));
        assertEq(uint8(module.lot(lotId).status), uint8(Status.FILLED), "the split filled");
    }

    // Sells

    /// @notice The venue's output for tokenAmount as a sell quote, USDG base units per 1e18 token base units, and 1
    /// where that rounds to zero, so a sell meant to revert later never stops at ZeroQuote.
    function _sellQuote(uint256 tokenAmount) internal view returns (uint256) {
        uint256 quote = tokenAmount == 0 ? 0 : venue.quoteSell(tokenAmount) * 1e18 / tokenAmount;
        return quote == 0 ? 1 : quote;
    }

    /// @notice A sell of `tokenAmount` with the ticker's pool and the venue's own quote, no override.
    function _args(uint8 tickerId, uint256 tokenAmount, uint256 lotId)
        internal
        view
        returns (OwnerOps.SellArgs memory)
    {
        return OwnerOps.SellArgs({
            tickerId: tickerId,
            tokenAmount: tokenAmount,
            lotId: lotId,
            pool: _pool(tickerId),
            quote: _sellQuote(tokenAmount),
            overrideClosed: false,
            overrideCapBps: 0
        });
    }

    /// @notice The owner's sell called by the account itself, outside a bracket.
    function _sell(MockAccount account, OwnerOps.SellArgs memory args) internal returns (uint256) {
        return _sellAs(address(account), args);
    }

    /// @notice A sell called by `caller`, which need not be a MockAccount.
    function _sellAs(address caller, OwnerOps.SellArgs memory args) internal returns (uint256) {
        vm.prank(caller);
        return module.sell(
            args.tickerId, args.tokenAmount, args.lotId, args.pool, args.quote, args.overrideClosed, args.overrideCapBps
        );
    }

    /// @notice The owner's sell inside a bracketed owner op, as the app builds it.
    function _ownerSell(MockAccount account, OwnerOps.SellArgs memory args) internal {
        _ownerOp(account, OwnerOps.sell(address(module), args));
    }

    /// @notice A direct sell that must revert with `revertData` and leave everything as it was.
    function _assertSellReverts(MockAccount account, OwnerOps.SellArgs memory args, bytes memory revertData) internal {
        _assertSellRevertsAs(address(account), args, revertData);
    }

    function _assertSellRevertsAs(address caller, OwnerOps.SellArgs memory args, bytes memory revertData) internal {
        SellState memory before = _sellState(caller, args.tickerId);
        vm.expectRevert(revertData);
        _sellAs(caller, args);
        _assertSellUnchanged(before, _sellState(caller, args.tickerId));
    }

    // Receipts

    /// @notice A PART_SOLD or SOLD receipt equals, field for field, the one rebuilt here from the sell's inputs, the
    /// mock market and the measured proceeds, and its stored hash is the hash of that encoding.
    /// @param usdgOut The whole sell's proceeds.
    function _assertSoldReceipt(
        ISleeveModule.Receipt memory receipt,
        address account,
        OwnerOps.SellArgs memory args,
        Sold memory sold,
        uint256 usdgOut
    ) internal view {
        ISleeveModule.Receipt memory expected = _expectedSold(account, args, sold, usdgOut);
        assertEq(abi.encode(receipt), abi.encode(expected), "every receipt field");
        assertEq(module.receiptHash(sold.id), keccak256(abi.encode(expected)), "stored hash");
    }

    function _expectedSold(address account, OwnerOps.SellArgs memory args, Sold memory sold, uint256 usdgOut)
        internal
        view
        returns (ISleeveModule.Receipt memory expected)
    {
        ISleeveModule.Rule memory rule = module.ruleOf(account);
        (uint80 roundId, int256 answer,, uint256 updatedAt,) = feeds[args.tickerId].latestRoundData();
        (uint80 usdgRoundId, int256 usdgAnswer,,,) = usdgUsdFeed.latestRoundData();
        expected.id = sold.id;
        expected.account = account;
        expected.ruleVersion = rule.version;
        expected.trigger = Trigger.OWNER;
        expected.status = sold.status;
        expected.reason = Reason.NONE;
        expected.mode = AccountingMode.WRAPPED;
        expected.tickerId = args.tickerId;
        expected.token = address(tokens[args.tickerId]);
        expected.tokenUid = keccak256(abi.encode("uid", uint256(args.tickerId)));
        expected.usdgToSpend = sold.share;
        expected.tokensIn = sold.tokensIn;
        expected.usdgOut = sold.share;
        expected.uiMultiplier = tokens[args.tickerId].uiMultiplier();
        expected.execPrice = usdgOut * 1e18 / args.tokenAmount;
        expected.premiumBps = _discount(usdgOut, args.tokenAmount, answer);
        expected.roundId = roundId;
        expected.answer = answer;
        expected.updatedAt = updatedAt;
        expected.usdgRoundId = usdgRoundId;
        expected.usdgAnswer = usdgAnswer;
        expected.quote = args.quote;
        expected.minOut = args.tokenAmount * args.quote / 1e18 * (10_000 - rule.slippageBps) / 10_000;
        expected.venueId = 1;
        expected.pool = args.pool;
        expected.calendarVersion = CALENDAR_VERSION;
        expected.disclosureHash = DISCLOSURE_HASH;
        expected.l2Block = L2_BLOCK;
        expected.timestamp = block.timestamp;
        expected.lotId = sold.lotId;
        expected.overrideClosed = args.overrideClosed;
        expected.overrideCapBps = args.overrideCapBps;
    }

    /// @notice A sale's discount below the feed in basis points, rounded up against the owner, computed here without
    /// PriceGuard: 10,000 - floor(10,000 * usdgOut * 1e20 / (tokensIn * answer)).
    function _discount(uint256 usdgOut, uint256 tokensIn, int256 answer) internal pure returns (int256) {
        uint256 ratio = Math.mulDiv(usdgOut * 1e20, 10_000, tokensIn * uint256(answer));
        return 10_000 - int256(ratio);
    }

    // Snapshots

    function _assertLedger(address account, uint256 balance, uint256 spend, uint256 pendingTotal, uint256 unsorted)
        internal
        view
    {
        (uint256 b, uint256 s, uint256 p, uint256 u) = module.ledger(account);
        assertEq(b, balance, "balance");
        assertEq(s, spend, "spend");
        assertEq(p, pendingTotal, "pendingTotal");
        assertEq(u, unsorted, "unsorted");
    }

    function _sellState(address account, uint8 tickerId) internal view returns (SellState memory state) {
        (state.balance, state.spend, state.pendingTotal, state.unsorted) = module.ledger(account);
        for (uint8 t; t < TICKER_COUNT; ++t) {
            state.tokenBalances[t] = tokens[t].balanceOf(account);
        }
        state.venueTokens = tokens[tickerId].balanceOf(address(venue));
        state.venueUsdg = usdg.balanceOf(address(venue));
        state.moduleUsdg = usdg.balanceOf(address(module));
        state.moduleTokens = tokens[tickerId].balanceOf(address(module));
        state.allowance = IERC20(address(tokens[tickerId])).allowance(account, address(venue));
        state.nextReceiptId = module.nextReceiptId();
        uint256[] memory lotIds;
        (lotIds, state.head) = module.lotsOf(account, tickerId);
        ISleeveModule.Lot[] memory lots = new ISleeveModule.Lot[](lotIds.length);
        for (uint256 i; i < lotIds.length; ++i) {
            lots[i] = module.lot(lotIds[i]);
        }
        state.lots = abi.encode(lots);
    }

    /// @notice Ledgers, balances, lots, the queue's head, receipts and the allowance are all as they were.
    function _assertSellUnchanged(SellState memory before, SellState memory afterwards) internal pure {
        assertEq(abi.encode(afterwards), abi.encode(before), "nothing moved");
    }
}
