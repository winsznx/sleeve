// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {Execution} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";
import {IQuoterV2} from "../../src/interfaces/IQuoterV2.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {IStockToken} from "../../src/interfaces/IStockToken.sol";
import {ISwapRouter02} from "../../src/interfaces/ISwapRouter02.sol";
import {IUniswapV3Pool} from "../../src/interfaces/IUniswapV3Pool.sol";
import {AccountingMode, Reason, Status, Trigger} from "../../src/types/SleeveTypes.sol";
import {Chain4663} from "../utils/Chain4663.sol";
import {OwnerOps} from "../utils/OwnerOps.sol";
import {SleeveModuleForkTradeBase} from "./SleeveModuleForkTradeBase.sol";

/// @notice Shared setup for the sell fork tests: QuoterV2 sell quotes, the owner's sells through handleOps, the
/// balances a sell must move, and every SPEC 13 field of a sell receipt rebuilt from chain state.
abstract contract SleeveModuleForkSellBase is SleeveModuleForkTradeBase {
    /// @notice The balances around a sell.
    struct SellMeasured {
        uint256 accountUsdg;
        uint256 accountTokens;
        uint256 poolUsdg;
        uint256 poolTokens;
        uint256 spend;
        uint256 nextId;
    }

    /// @notice QuoterV2's output for tokenAmount of the ticker's token sold into the pool, as the module's sell quote:
    /// USDG base units per 1e18 token base units, rounded down as the app computes it.
    function _sellQuote(uint8 tickerId, address pool, uint256 tokenAmount) internal returns (uint256) {
        return _quoteSellOut(tickerId, pool, tokenAmount) * 1e18 / tokenAmount;
    }

    /// @notice QuoterV2's USDG output for tokenAmount sold into the pool.
    function _quoteSellOut(uint8 tickerId, address pool, uint256 tokenAmount) internal returns (uint256 amountOut) {
        (address token,) = _tokenOf(tickerId);
        (amountOut,,,) = IQuoterV2(Chain4663.QUOTER_V2)
            .quoteExactInputSingle(
                IQuoterV2.QuoteExactInputSingleParams({
                tokenIn: token,
                tokenOut: Chain4663.USDG,
                amountIn: tokenAmount,
                fee: IUniswapV3Pool(pool).fee(),
                sqrtPriceLimitX96: 0
            })
            );
    }

    /// @notice A sell with the pool's own quote and no override.
    function _sellArgs(uint8 tickerId, address pool, uint256 tokenAmount, uint256 lotId)
        internal
        returns (OwnerOps.SellArgs memory)
    {
        return OwnerOps.SellArgs({
            tickerId: tickerId,
            tokenAmount: tokenAmount,
            lotId: lotId,
            pool: pool,
            quote: _sellQuote(tickerId, pool, tokenAmount),
            overrideClosed: false,
            overrideCapBps: 0
        });
    }

    /// @notice The owner's sell in a bracketed owner op through handleOps.
    function _ownerSell(address account, OwnerOps.SellArgs memory args) internal returns (OpResult memory) {
        return _ownerOp(account, OwnerOps.sell(address(module), args));
    }

    function _measureSell(address account, uint8 tickerId, address pool) internal view returns (SellMeasured memory m) {
        (address token,) = _tokenOf(tickerId);
        m.accountUsdg = USDG.balanceOf(account);
        m.accountTokens = IERC20(token).balanceOf(account);
        m.poolUsdg = USDG.balanceOf(pool);
        m.poolTokens = IERC20(token).balanceOf(pool);
        (, m.spend,,) = module.ledger(account);
        m.nextId = module.nextReceiptId();
    }

    /// @notice A one-lot sell on a real pool: exactly tokenAmount went from the account to the pool, the pool's USDG
    /// reached the account and spend, the allowance is zero, the module holds nothing, and the receipt equals the one
    /// rebuilt from chain state field for field.
    /// @return usdgOut USDG that arrived.
    function _assertSold(
        ISleeveModule.Receipt memory receipt,
        address account,
        OwnerOps.SellArgs memory args,
        SellMeasured memory m,
        uint256 lotId,
        Status status
    ) internal view returns (uint256 usdgOut) {
        (address token,) = _tokenOf(args.tickerId);
        usdgOut = USDG.balanceOf(account) - m.accountUsdg;
        assertGt(usdgOut, 0, "I3: USDG in the account");
        assertEq(m.accountTokens - IERC20(token).balanceOf(account), args.tokenAmount, "I4: exactly the amount");
        assertEq(IERC20(token).balanceOf(args.pool) - m.poolTokens, args.tokenAmount, "I4: only to the pool");
        assertEq(m.poolUsdg - USDG.balanceOf(args.pool), usdgOut, "the pool paid it");
        assertEq(IERC20(token).allowance(account, Chain4663.SWAP_ROUTER_02), 0, "I4: allowance zero");
        (, uint256 spend,, uint256 unsorted) = module.ledger(account);
        assertEq(spend, m.spend + usdgOut, "I6: the proceeds are spend");
        assertEq(unsorted, 0, "I6: nothing unsorted");
        _assertHoldsNothingAtAll(address(module));

        ISleeveModule.Receipt memory expected = _expectedSold(account, args, m.nextId, lotId, status, usdgOut);
        assertEq(abi.encode(receipt), abi.encode(expected), "every receipt field");
        assertEq(module.receiptHash(receipt.id), keccak256(abi.encode(expected)), "stored hash");
        assertLe(receipt.premiumBps, int256(uint256(_capOf(account, args))), "the discount inside its cap");
    }

    /// @notice A one-lot sell receipt rebuilt from chain state: token views, the feeds' latest rounds, the rule, the
    /// calendar and the measured proceeds.
    function _expectedSold(
        address account,
        OwnerOps.SellArgs memory args,
        uint256 id,
        uint256 lotId,
        Status status,
        uint256 usdgOut
    ) internal view returns (ISleeveModule.Receipt memory expected) {
        (address token, address feed) = _tokenOf(args.tickerId);
        expected.id = id;
        expected.account = account;
        expected.ruleVersion = module.ruleOf(account).version;
        expected.trigger = Trigger.OWNER;
        expected.status = status;
        expected.reason = Reason.NONE;
        expected.mode = AccountingMode.WRAPPED;
        expected.tickerId = args.tickerId;
        expected.token = token;
        expected.tokenUid = IStockToken(token).uid();
        expected.usdgToSpend = usdgOut;
        expected.tokensIn = args.tokenAmount;
        expected.usdgOut = usdgOut;
        expected.uiMultiplier = IStockToken(token).uiMultiplier();
        expected.execPrice = usdgOut * 1e18 / args.tokenAmount;
        (expected.roundId, expected.answer,, expected.updatedAt,) = IAggregatorV3(feed).latestRoundData();
        (expected.usdgRoundId, expected.usdgAnswer,,,) = IAggregatorV3(Chain4663.USDG_USD_FEED).latestRoundData();
        expected.premiumBps = _discountOf(usdgOut, args.tokenAmount, expected.answer);
        expected.quote = args.quote;
        expected.minOut = args.tokenAmount * args.quote / 1e18 * (10_000 - module.ruleOf(account).slippageBps) / 10_000;
        expected.venueId = 1;
        expected.pool = args.pool;
        expected.calendarVersion = calendar.version();
        expected.disclosureHash = DISCLOSURE_HASH;
        expected.l2Block = block.number;
        expected.timestamp = block.timestamp;
        expected.lotId = lotId;
        expected.overrideClosed = args.overrideClosed;
        expected.overrideCapBps = args.overrideCapBps;
    }

    /// @notice A sale's discount below the feed price in basis points, rounded up against the owner, computed here
    /// without PriceGuard: 10,000 - floor(10,000 * usdgOut * 1e20 / (tokensIn * answer)).
    function _discountOf(uint256 usdgOut, uint256 tokensIn, int256 answer) internal pure returns (int256) {
        return 10_000 - int256(Math.mulDiv(usdgOut * 1e20, 10_000, tokensIn * uint256(answer)));
    }

    /// @notice The discount cap a sell is held to: the widened cap, or the rule's premium cap.
    function _capOf(address account, OwnerOps.SellArgs memory args) internal view returns (uint16) {
        return args.overrideCapBps == 0 ? module.ruleOf(account).premiumCapBps : args.overrideCapBps;
    }

    /// @notice The one OwnerOpEnded in an op's logs books the sell's proceeds as the module's delta and nothing as the
    /// owner's.
    function _assertProceedsAreTheModulesDelta(OpResult memory result, uint256 balanceAtBegin, uint256 usdgOut)
        internal
        view
    {
        Vm.Log[] memory ended = _logsOf(result, address(module), ISleeveModule.OwnerOpEnded.selector);
        assertEq(ended.length, 1, "OwnerOpEnded");
        assertEq(
            ended[0].data,
            abi.encode(balanceAtBegin, int256(usdgOut), int256(0), uint256(0), uint256(0), new uint256[](0)),
            "I6: the proceeds are the module's delta, nothing is the owner's"
        );
    }

    /// @notice The owner buys the token from the pool through SwapRouter02 in a bracketed batch of its own, outside
    /// Sleeve's split: exact approval, swap, approval reset.
    function _ownerBuysDirectly(address account, uint8 tickerId, address pool, uint256 usdgIn)
        internal
        returns (uint256 tokensOut)
    {
        (address token,) = _tokenOf(tickerId);
        _pay(account, usdgIn);
        uint256 before = IERC20(token).balanceOf(account);
        bytes memory swap = abi.encodeCall(
            ISwapRouter02.exactInputSingle,
            (ISwapRouter02.ExactInputSingleParams({
                    tokenIn: Chain4663.USDG,
                    tokenOut: token,
                    fee: IUniswapV3Pool(pool).fee(),
                    recipient: account,
                    amountIn: usdgIn,
                    amountOutMinimum: 0,
                    sqrtPriceLimitX96: 0
                }))
        );
        Execution[] memory calls = new Execution[](3);
        calls[0] = Execution(Chain4663.USDG, 0, abi.encodeCall(IERC20.approve, (Chain4663.SWAP_ROUTER_02, usdgIn)));
        calls[1] = Execution(Chain4663.SWAP_ROUTER_02, 0, swap);
        calls[2] = Execution(Chain4663.USDG, 0, abi.encodeCall(IERC20.approve, (Chain4663.SWAP_ROUTER_02, 0)));
        assertTrue(_ownerOp(account, OwnerOps.callData(address(module), calls)).success, "the owner's own buy");
        tokensOut = IERC20(token).balanceOf(account) - before;
    }

    /// @notice A sell UserOp that fails with `revertData` and leaves the ledgers, balances, lots and receipts as they
    /// were.
    function _assertSellOpReverts(address account, OwnerOps.SellArgs memory args, bytes memory revertData) internal {
        bytes memory before = _sellSnapshot(account, args);
        OpResult memory result = _ownerSell(account, args);
        assertFalse(result.success, "the sell op failed");
        assertEq(result.revertReason, revertData, "revert reason");
        assertEq(_sellSnapshot(account, args), before, "nothing moved");
    }

    function _sellSnapshot(address account, OwnerOps.SellArgs memory args) internal view returns (bytes memory) {
        (address token,) = _tokenOf(args.tickerId);
        return abi.encode(
            _ledgerSnapshot(account),
            _lotsSnapshot(account, args.tickerId),
            IERC20(token).balanceOf(account),
            IERC20(token).balanceOf(args.pool),
            USDG.balanceOf(args.pool),
            IERC20(token).allowance(account, address(module.swapRouter())),
            module.nextReceiptId()
        );
    }

    function _ledgerSnapshot(address account) private view returns (bytes memory) {
        (uint256 balance, uint256 spend, uint256 pendingTotal, uint256 unsorted) = module.ledger(account);
        return abi.encode(balance, spend, pendingTotal, unsorted);
    }

    function _lotsSnapshot(address account, uint8 tickerId) private view returns (bytes memory) {
        (uint256[] memory lotIds, uint256 head) = module.lotsOf(account, tickerId);
        ISleeveModule.Lot[] memory lots = new ISleeveModule.Lot[](lotIds.length);
        for (uint256 i; i < lotIds.length; ++i) {
            lots[i] = module.lot(lotIds[i]);
        }
        return abi.encode(lots, head);
    }
}
