// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC7579ModuleConfig, MODULE_TYPE_EXECUTOR} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {SlotDerivation} from "@openzeppelin/contracts/utils/SlotDerivation.sol";
import {TransientSlot} from "@openzeppelin/contracts/utils/TransientSlot.sol";
import {SessionCalendarExtension} from "../SessionCalendarExtension.sol";
import {TokenSource} from "../TokenSource.sol";
import {IAggregatorV3} from "../interfaces/IAggregatorV3.sol";
import {ISleeveModule} from "../interfaces/ISleeveModule.sol";
import {ISwapRouter02} from "../interfaces/ISwapRouter02.sol";
import {GuardParams, Status} from "../types/SleeveTypes.sol";
import {SleeveReceipts} from "./SleeveReceipts.sol";

/// @title SleeveState
/// @notice SleeveModule's storage and the helpers every writer of it shares: the module and the delegatecalled
/// libraries SleeveTrade, SleeveBuy and SleeveSell, which run in the module's context and reach the same storage
/// through a Store pointer, so they share one receipt log and one set of ledgers (D-019).
/// @dev Internal functions only, compiled into each writer. Every bucket write keeps the account's pendingTotal equal
/// to the sum of its buckets, and an emptied bucket is deleted.
library SleeveState {
    using SafeCast for uint256;
    using SafeCast for int256;
    using SlotDerivation for bytes32;
    using TransientSlot for bytes32;
    using TransientSlot for TransientSlot.Uint256Slot;
    using TransientSlot for TransientSlot.Int256Slot;

    /// @notice One account's ledgers, keeper, observation and rule. SPEC section 5, field order as specified.
    /// @param installed Whether the account installed the module.
    /// @param spend The spend ledger.
    /// @param pendingTotal The sum of the account's buckets.
    /// @param keeper The account's keeper, zero for none.
    /// @param observedAt Start of the public-trigger clock, zero when none runs (D-009 Q15).
    /// @param observedUnsorted Unsorted USDG when the clock started.
    /// @param rule The rule.
    struct Account {
        bool installed;
        uint128 spend;
        uint128 pendingTotal;
        address keeper;
        uint64 observedAt;
        uint128 observedUnsorted;
        ISleeveModule.Rule rule;
    }

    /// @notice An account's lots for one ticker in creation order, and the index sells start from (SPEC section 5).
    struct LotQueue {
        uint256[] ids;
        uint256 head;
    }

    /// @notice All of the module's storage, one state variable.
    /// @param accounts Per-account state, deleted at uninstall.
    /// @param buckets Pending equity per account and ticker.
    /// @param ruleVersions The last rule version per account. Kept across uninstall, so versions only go up (D-019).
    /// @param receipts The receipt log.
    /// @param lots Lots by id.
    /// @param lotQueues Lot ids per account and ticker.
    struct Store {
        mapping(address account => Account) accounts;
        mapping(address account => mapping(uint8 tickerId => ISleeveModule.Bucket)) buckets;
        mapping(address account => uint32 version) ruleVersions;
        SleeveReceipts.Log receipts;
        mapping(uint256 lotId => ISleeveModule.Lot) lots;
        mapping(address account => mapping(uint8 tickerId => LotQueue)) lotQueues;
    }

    /// @notice The module's immutables, which a delegatecalled library cannot read, passed with every library call.
    struct Env {
        IERC20 usdg;
        TokenSource tokenSource;
        SessionCalendarExtension calendar;
        ISwapRouter02 swapRouter;
        IAggregatorV3 usdgUsdFeed;
        bytes32 disclosureHash;
        uint256 grace;
        GuardParams params;
    }

    /// @dev Per-account transient slots: deriveMapping(base, account) holds the USDG balance at beginOwnerOp plus one,
    /// so zero means no bracket is open; the next slot holds the module delta. endOwnerOp zeroes both, and the delta
    /// is only written while the bracket is open.
    bytes32 private constant OWNER_OP_BASE = keccak256("sleeve.module.ownerOp");

    // Brackets

    /// @notice The transient slot holding the account's balance at beginOwnerOp plus one.
    function beginSlot(address account) internal pure returns (TransientSlot.Uint256Slot) {
        return OWNER_OP_BASE.deriveMapping(account).asUint256();
    }

    /// @notice The transient slot holding the net USDG the module's own actions moved inside the open bracket.
    function deltaSlot(address account) internal pure returns (TransientSlot.Int256Slot) {
        return OWNER_OP_BASE.deriveMapping(account).offset(1).asInt256();
    }

    /// @notice Whether the account's owner bracket is open in this transaction.
    function ownerOpOpen(address account) internal view returns (bool) {
        return beginSlot(account).tload() != 0;
    }

    /// @notice Adds a module action's net USDG change for the account to its open bracket, so endOwnerOp does not
    /// book it as the owner's (D-009 Q13). Does nothing when no bracket is open.
    /// @param account The account whose USDG the action moved.
    /// @param delta USDG that arrived, positive, or left, negative, measured by balance.
    function recordModuleDelta(address account, int256 delta) internal {
        if (beginSlot(account).tload() == 0) return;
        TransientSlot.Int256Slot slot = deltaSlot(account);
        slot.tstore(slot.tload() + delta);
    }

    /// @notice The balance a split or settle computes unsorted from: inside an open bracket the virtual balance,
    /// balance at begin plus the module delta, so the owner's moves in the same batch never look like income or an
    /// outside pull; otherwise the USDG balance.
    /// @return The balance, zero when the virtual balance is negative.
    function sortingBalance(IERC20 usdg, address account) internal view returns (uint256) {
        uint256 begun = beginSlot(account).tload();
        if (begun == 0) return usdg.balanceOf(account);
        return virtualBalance(begun - 1, deltaSlot(account).tload());
    }

    /// @notice balanceAtBegin + moduleDelta, floored at zero.
    function virtualBalance(uint256 balanceAtBegin, int256 moduleDelta) internal pure returns (uint256) {
        int256 balance = balanceAtBegin.toInt256() + moduleDelta;
        return balance > 0 ? balance.toUint256() : 0;
    }

    // Buckets

    /// @notice Bucket amounts indexed by ticker id, for every ticker TokenSource ever listed.
    function pendingByTicker(Store storage s, TokenSource tokenSource, address account)
        internal
        view
        returns (uint256[] memory pending)
    {
        uint256 count = tokenSource.tickerCount();
        pending = new uint256[](count);
        for (uint256 i; i < count; ++i) {
            pending[i] = s.buckets[account][i.toUint8()].amount;
        }
    }

    /// @notice Takes the given amounts off the account's buckets, indexed by ticker id, and deletes each bucket it
    /// empties. The caller takes the total off pendingTotal.
    /// @return taken The total taken.
    function takeFromBuckets(Store storage s, address account, uint256[] memory cuts) internal returns (uint256 taken) {
        for (uint256 i; i < cuts.length; ++i) {
            uint256 cut = cuts[i];
            if (cut == 0) continue;
            ISleeveModule.Bucket storage bucket = s.buckets[account][i.toUint8()];
            uint128 left = bucket.amount - cut.toUint128();
            if (left == 0) delete s.buckets[account][i.toUint8()];
            else bucket.amount = left;
            taken += cut;
        }
    }

    // Lots

    /// @notice Creates a lot for a FILLED or SETTLED receipt and appends it to the account's queue for the ticker.
    /// @param lotId The receipt id the lot takes.
    function createLot(Store storage s, uint256 lotId, address account, uint8 tickerId, Status status, uint256 tokens)
        internal
    {
        uint128 bought = tokens.toUint128();
        s.lots[lotId] = ISleeveModule.Lot({
            account: account, tickerId: tickerId, status: status, tokensBought: bought, tokensRemaining: bought
        });
        s.lotQueues[account][tickerId].ids.push(lotId);
    }

    /// @notice Moves a lot to PART_SOLD or SOLD. Allowed: FILLED, SETTLED or PART_SOLD to PART_SOLD or SOLD (SPEC
    /// section 14, I7). PART_SOLD to PART_SOLD is a second partial sell of the same lot (audit A1). Anything else
    /// reverts BadLotTransition, and an id with no lot reverts UnknownLot. SOLD is final.
    function transitionLot(Store storage s, uint256 lotId, Status to) internal {
        ISleeveModule.Lot storage entry = s.lots[lotId];
        if (entry.account == address(0)) revert ISleeveModule.UnknownLot(lotId);
        Status from = entry.status;
        bool fromOpen = from == Status.FILLED || from == Status.SETTLED || from == Status.PART_SOLD;
        if (!fromOpen || (to != Status.PART_SOLD && to != Status.SOLD)) {
            revert ISleeveModule.BadLotTransition(lotId, from, to);
        }
        entry.status = to;
    }

    // Account

    /// @notice Whether the account's ERC-7579 isModuleInstalled lists the module as an executor. A call that fails or
    /// answers anything but true counts as not listed. address(this) is the module, also inside a delegatecalled
    /// library.
    function listsModule(address account) internal view returns (bool) {
        (bool ok, bytes memory answer) = account.staticcall(
            abi.encodeCall(IERC7579ModuleConfig.isModuleInstalled, (MODULE_TYPE_EXECUTOR, address(this), ""))
        );
        return ok && answer.length == 32 && abi.decode(answer, (uint256)) == 1;
    }

    // Receipts

    /// @notice Writes a receipt through SleeveReceipts with the calendar version in force and the module's
    /// disclosure hash.
    /// @return id The receipt id.
    function writeReceipt(Store storage s, Env memory env, address account, ISleeveModule.Receipt memory receipt)
        internal
        returns (uint256 id)
    {
        return SleeveReceipts.write(s.receipts, account, receipt, env.calendar.version(), env.disclosureHash);
    }
}
