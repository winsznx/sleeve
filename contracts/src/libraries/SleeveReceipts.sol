// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ISleeveModule} from "../interfaces/ISleeveModule.sol";
import {AccountingMode} from "../types/SleeveTypes.sol";

/// @notice Arbitrum's system precompile. block.number on this chain is an L1 estimate, so receipts take the L2 block
/// from arbBlockNumber().
interface IArbSys {
    function arbBlockNumber() external view returns (uint256);
}

/// @title SleeveReceipts
/// @notice The receipt log: global ids from 1, keccak256(abi.encode(receipt)) stored once per id, and ReceiptWritten
/// with every field (docs/SPEC.md section 13, D-009 Q25). The verifier and the app recompute the hash from the event.
/// @dev Internal functions only. They compile into SleeveModule and into any library that later writes receipts for
/// it, so every writer shares one counter, one hash rule and one event.
library SleeveReceipts {
    /// @notice The ArbSys precompile address.
    address internal constant ARB_SYS = 0x0000000000000000000000000000000000000064;

    /// @notice The module's receipt storage.
    /// @param count Receipts written so far, which is also the latest id.
    /// @param hashes keccak256(abi.encode(receipt)) per id. Written once, never changed (I7).
    struct Log {
        uint256 count;
        mapping(uint256 id => bytes32) hashes;
    }

    /// @notice Writes a receipt: assigns the next id, fills account, mode, calendar version, disclosure hash, L2
    /// block and timestamp over whatever the caller put there, stores the hash and emits ReceiptWritten.
    /// @param log The module's receipt log.
    /// @param account The account the receipt is about.
    /// @param receipt Every other field, set by the caller. Modified in place.
    /// @param calendarVersion The calendar extension's version() now.
    /// @param disclosureHash The module's disclosure hash.
    /// @return id The receipt id.
    function write(
        Log storage log,
        address account,
        ISleeveModule.Receipt memory receipt,
        uint32 calendarVersion,
        bytes32 disclosureHash
    ) internal returns (uint256 id) {
        id = ++log.count;
        receipt.id = id;
        receipt.account = account;
        receipt.mode = AccountingMode.WRAPPED;
        receipt.calendarVersion = calendarVersion;
        receipt.disclosureHash = disclosureHash;
        receipt.l2Block = IArbSys(ARB_SYS).arbBlockNumber();
        receipt.timestamp = block.timestamp;
        log.hashes[id] = keccak256(abi.encode(receipt));
        emit ISleeveModule.ReceiptWritten(id, account, receipt.status, receipt);
    }
}
