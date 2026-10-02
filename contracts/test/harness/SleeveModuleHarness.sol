// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC7579Execution} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {
    ERC7579Utils,
    Mode,
    ModePayload,
    ModeSelector
} from "@openzeppelin/contracts/account/utils/draft-ERC7579Utils.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {SleeveModule} from "../../src/SleeveModule.sol";
import {Reason, Trigger} from "../../src/types/SleeveTypes.sol";
import {UsdgPayer} from "../mocks/UsdgPayer.sol";

/// @notice SleeveModule with test-only entry points: it seeds buckets the way component 5's queue step will, calls
/// the internal hooks, and runs stand-ins for module actions that move USDG, so bucket outflows, the uninstall release
/// and receipts can be tested before split and settle exist. Never deployed outside tests.
contract SleeveModuleHarness is SleeveModule {
    using SafeCast for uint256;

    constructor(ModuleConfig memory config) SleeveModule(config) {}

    /// @notice Moves unsorted USDG into a bucket as a timing failure in split will: the bucket and pendingTotal grow,
    /// since is set when the bucket was empty, and reason is replaced.
    function seedBucket(address account, uint8 tickerId, uint128 amount, Reason reason) external {
        Bucket storage bucket = _buckets[account][tickerId];
        if (bucket.amount == 0) bucket.since = uint64(block.timestamp);
        bucket.amount += amount;
        bucket.reason = reason;
        _accounts[account].pendingTotal += amount;
    }

    function recordModuleDelta(address account, int256 delta) external {
        _recordModuleDelta(account, delta);
    }

    function sortingBalance(address account) external view returns (uint256) {
        return _sortingBalance(account);
    }

    function writeReceipt(address account, Receipt memory receipt) external returns (uint256) {
        return _writeReceipt(account, receipt);
    }

    function releaseBucket(address account, uint8 tickerId, Trigger trigger) external returns (uint256) {
        return _releaseBucket(account, tickerId, trigger);
    }

    /// @notice Stands in for a settle: takes `amount` off the bucket and sends it from the account to `to` through
    /// executeFromExecutor, then records the measured balance change as the module delta.
    function payFromBucket(address account, uint8 tickerId, address to, uint128 amount) external {
        Bucket storage bucket = _buckets[account][tickerId];
        bucket.amount -= amount;
        if (bucket.amount == 0) delete _buckets[account][tickerId];
        _accounts[account].pendingTotal -= amount;
        uint256 before = usdg.balanceOf(account);
        Mode single = ERC7579Utils.encodeMode(
            ERC7579Utils.CALLTYPE_SINGLE, ERC7579Utils.EXECTYPE_DEFAULT, ModeSelector.wrap(0), ModePayload.wrap(0)
        );
        IERC7579Execution(account)
            .executeFromExecutor(
                Mode.unwrap(single),
                abi.encodePacked(address(usdg), uint256(0), abi.encodeCall(IERC20.transfer, (to, amount)))
            );
        _recordModuleDelta(account, usdg.balanceOf(account).toInt256() - before.toInt256());
    }

    /// @notice Stands in for a sell's proceeds: the payer sends `amount` to the account, spend takes what arrived, and
    /// the module delta records it.
    function receiveToSpend(address account, UsdgPayer payer, uint128 amount) external {
        uint256 before = usdg.balanceOf(account);
        payer.pay(account, amount);
        uint256 received = usdg.balanceOf(account) - before;
        _accounts[account].spend += received.toUint128();
        _recordModuleDelta(account, received.toInt256());
    }
}
