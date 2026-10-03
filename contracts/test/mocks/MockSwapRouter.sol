// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {ISwapRouter02} from "../../src/interfaces/ISwapRouter02.sol";
import {MockERC20} from "./MockERC20.sol";
import {MockV3Factory} from "./MockV3Factory.sol";
import {MockV3Pool} from "./MockV3Pool.sol";

/// @notice SwapRouter02's exactInputSingle against a fixed price, standing in for the router. Like a real swap, the
/// factory's pool for (tokenIn, tokenOut, fee) takes the input, pulled from the caller with transferFrom, and pays the
/// output to the recipient out of its inventory, and like the real router it reverts "Too little received" below
/// amountOutMinimum. Settable faults let unit tests break each postcondition the module checks by balance: a partial
/// fill, fewer tokens than reported, tokens minted to another address, and a revert of its own.
contract MockSwapRouter is ISwapRouter02 {
    using SafeERC20 for IERC20;

    uint16 private constant BPS = 10_000;

    address public immutable factory;

    /// @notice Output token base units per 1e6 input base units, the module's quote unit.
    uint256 public price;
    /// @notice Share of amountIn the swap takes, in basis points. Below 10,000 is a partial fill.
    uint16 public fillBps = BPS;
    /// @notice Tokens withheld from the recipient after the minimum-out check passed.
    uint256 public withheld;
    /// @notice Where extra tokens go, and how many.
    address public leakTo;
    uint256 public leakAmount;
    /// @notice Revert data for every swap, empty for none.
    bytes public failure;

    /// @notice How many swaps ran.
    uint256 public swaps;

    constructor(address factory_, uint256 price_) {
        factory = factory_;
        price = price_;
    }

    function setPrice(uint256 price_) external {
        price = price_;
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

    /// @notice What a swap of amountIn would return now, as QuoterV2 answers.
    function quote(uint256 amountIn) public view returns (uint256) {
        return amountIn * fillBps / BPS * price / 1e6;
    }

    function exactInputSingle(ExactInputSingleParams calldata params) external payable returns (uint256 amountOut) {
        bytes memory reason = failure;
        if (reason.length != 0) {
            assembly ("memory-safe") {
                revert(add(reason, 0x20), mload(reason))
            }
        }
        uint256 taken = params.amountIn * fillBps / BPS;
        amountOut = taken * price / 1e6;
        require(amountOut >= params.amountOutMinimum, "Too little received");
        ++swaps;
        address pool = MockV3Factory(factory).getPool(params.tokenIn, params.tokenOut, params.fee);
        IERC20(params.tokenIn).safeTransferFrom(msg.sender, pool, taken);
        MockV3Pool(pool).pay(params.tokenOut, params.recipient, amountOut - withheld);
        if (leakAmount != 0) MockERC20(params.tokenOut).mint(leakTo, leakAmount);
    }
}
