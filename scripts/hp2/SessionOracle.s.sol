// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {SessionCalendar} from "src/libraries/SessionCalendar.sol";

/// @title SessionOracle
/// @notice Answers the HP2 replay's session test with the compiled SessionCalendar library, so the replay uses the
/// same code the module uses (docs/HP2_PROTOCOL.md). scripts/hp2/session.py calls it in batches and checks every
/// answer against the Python port in scripts/calendar_vectors.py.
/// @dev Run from contracts/ with FOUNDRY_OUT=out-hp2 FOUNDRY_CACHE_PATH=cache-hp2:
///   forge script ../scripts/hp2/SessionOracle.s.sol --sig "run(bytes)" <packed> --json
/// The input packs each timestamp as 5 big-endian bytes. The output packs, per timestamp in input order, 1 byte with
/// the isOpen reason in SessionCalendar.Reason numbering (OPEN is 1) and 5 big-endian bytes with sessionOpenedAt, or 0
/// when the session is closed. All four launch tickers are ALL_DAY (research R7, D-014).
contract SessionOracle is Script {
    uint256 private constant TIMESTAMP_BYTES = 5;
    uint256 private constant ANSWER_BYTES = 6;

    error InputNotWholeTimestamps(uint256 length);

    function run(bytes calldata packed) external pure returns (bytes memory answers) {
        if (packed.length % TIMESTAMP_BYTES != 0) revert InputNotWholeTimestamps(packed.length);
        uint256 count = packed.length / TIMESTAMP_BYTES;
        answers = new bytes(count * ANSWER_BYTES);
        for (uint256 i; i < count; ++i) {
            uint256 timestamp = uint40(bytes5(packed[i * TIMESTAMP_BYTES:(i + 1) * TIMESTAMP_BYTES]));
            (bool open, SessionCalendar.Reason reason) =
                SessionCalendar.isOpen(timestamp, SessionCalendar.SessionType.ALL_DAY);
            uint256 openedAt =
                open ? SessionCalendar.sessionOpenedAt(timestamp, SessionCalendar.SessionType.ALL_DAY) : 0;
            uint256 offset = i * ANSWER_BYTES;
            answers[offset] = bytes1(uint8(reason));
            for (uint256 j; j < TIMESTAMP_BYTES; ++j) {
                answers[offset + 1 + j] = bytes1(uint8(openedAt >> (8 * (TIMESTAMP_BYTES - 1 - j))));
            }
        }
    }
}
