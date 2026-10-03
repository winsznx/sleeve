// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {ISwapRouter02} from "../../src/interfaces/ISwapRouter02.sol";
import {MockERC20} from "./MockERC20.sol";
import {MockV3Factory} from "./MockV3Factory.sol";
import {MockV3Pool} from "./MockV3Pool.sol";

/// @notice SwapRouter02's exactInputSingle in both directions at fixed prices, standing in for the router: a buy pays
/// USDG for stock tokens, a sell pays stock tokens for USDG. Like a real swap, the factory's pool for (tokenIn,
/// tokenOut, fee) takes the input, pulled from the caller with transferFrom, and pays the output to the recipient out of
/// its inventory, and like the real router it reverts "Too little received" below amountOutMinimum. Settable faults
/// break each postcondition the module checks by balance: a partial fill, less output than reported, output minted to
/// another address, a revert of its own, and one call of its choice made in the middle of the swap, for a module
/// reentry or a donation to the module.
contract MockTwoWayRouter is ISwapRouter02 {
    using SafeERC20 for IERC20;

    uint16 private constant BPS = 10_000;

    address public immutable factory;
    address public immutable usdg;

    /// @notice A buy's output: token base units per 1e6 USDG base units, the buy quote unit.
    uint256 public buyPrice;
    /// @notice A sell's output: USDG base units per 1e18 token base units, the sell quote unit.
    uint256 public sellPrice;
    /// @notice Share of amountIn the swap takes, in basis points. Below 10,000 is a partial fill.
    uint16 public fillBps = BPS;
    /// @notice Output withheld from the recipient after the minimum-out check passed.
    uint256 public withheld;
    /// @notice Where extra output goes, and how much.
    address public leakTo;
    uint256 public leakAmount;
    /// @notice Revert data for every swap, empty for none.
    bytes public failure;
    /// @notice A call made during the swap, after the minimum-out check, zero target for none.
    address public hookTarget;
    bytes public hookCall;

    /// @notice How many swaps ran.
    uint256 public swaps;

    constructor(address factory_, address usdg_, uint256 buyPrice_, uint256 sellPrice_) {
        factory = factory_;
        usdg = usdg_;
        buyPrice = buyPrice_;
        sellPrice = sellPrice_;
    }

    function setBuyPrice(uint256 buyPrice_) external {
        buyPrice = buyPrice_;
    }

    function setSellPrice(uint256 sellPrice_) external {
        sellPrice = sellPrice_;
    }

    function setFillBps(uint16 fillBps_) external {
        fillBps = fillBps_;
    }

    function setWithheld(uint256 withheld_) external {
        withheld = withheld_;
    }

    function setLeak(address leakTo_, uint256 leakAmount_) external {
        leakTo = leakTo_;
        leakAmount = leakAmount_;
    }

    function setFailure(bytes calldata failure_) external {
        failure = failure_;
    }

    function setHook(address target, bytes calldata data) external {
        hookTarget = target;
        hookCall = data;
    }

    /// @notice What a buy of amountIn USDG would return now.
    function quoteBuy(uint256 amountIn) public view returns (uint256) {
        return amountIn * fillBps / BPS * buyPrice / 1e6;
    }

    /// @notice What a sell of amountIn tokens would return now.
    function quoteSell(uint256 amountIn) public view returns (uint256) {
        return amountIn * fillBps / BPS * sellPrice / 1e18;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut) {
        bytes memory reason = failure;
        if (reason.length != 0) {
            assembly ("memory-safe") {
                revert(add(reason, 0x20), mload(reason))
            }
        }
        uint256 taken = params.amountIn * fillBps / BPS;
        amountOut = params.tokenIn == usdg ? taken * buyPrice / 1e6 : taken * sellPrice / 1e18;
        require(amountOut >= params.amountOutMinimum, "Too little received");
        ++swaps;
        address pool = MockV3Factory(factory).getPool(params.tokenIn, params.tokenOut, params.fee);
        IERC20(params.tokenIn).safeTransferFrom(msg.sender, pool, taken);
        MockV3Pool(pool).pay(params.tokenOut, params.recipient, amountOut - withheld);
        if (leakAmount != 0) MockERC20(params.tokenOut).mint(leakTo, leakAmount);
        if (hookTarget != address(0)) Address.functionCall(hookTarget, hookCall);
    }
}
