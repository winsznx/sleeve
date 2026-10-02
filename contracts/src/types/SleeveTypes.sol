// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

// Types shared by PriceGuard, SleeveModule, the keeper, the verifier and the app. Receipts carry these enums as their
// uint8 values, so the order of every enum is fixed: new values may only be appended, and only in a new module
// version. The numbering is pinned by test_sleeveTypes_enumNumberingIsFixed.

/// @notice Why an equity part waits as USDG instead of buying, as a QUEUED or SETTLED receipt records it.
/// @dev NONE: every guard step passed. PAUSED: the token's paused() is true, which covers the token flag and the
/// registry's global pause. ORACLE_PAUSED: the token's oraclePaused() is true. SESSION: the calendar says the ticker's
/// session is closed, or the timestamp is outside its coverage. MULTIPLIER: a multiplier change takes effect inside
/// the guard window. STALE: the stock feed's answer is not positive, its round is from the future, older than the
/// maximum age, or from before the current session opened. DEPEG: the USDG/USD answer is outside 1 plus or minus the
/// tolerance, not positive, from the future or older than its maximum age. CLIP: the equity part is below the rule's
/// minimum clip. PREMIUM: the measured fill paid more than the premium cap above the feed price.
enum Reason {
    NONE,
    PAUSED,
    ORACLE_PAUSED,
    SESSION,
    MULTIPLIER,
    STALE,
    DEPEG,
    CLIP,
    PREMIUM
}

/// @notice What a receipt records. PRD sections 7.6 and 10.
/// @dev POSTED, POSTED_PART and borrow statuses are M1 and are not encoded.
enum Status {
    FILLED,
    QUEUED,
    SETTLED,
    REFUSED_TICKER,
    REFUSED_ACCOUNT,
    RELEASED,
    PART_SOLD,
    SOLD,
    RECONCILED
}

/// @notice Who started the action: the account's keeper, the account itself, the pay link (M1), or anyone after the
/// grace period.
enum Trigger {
    KEEPER,
    OWNER,
    PAYLINK,
    PUBLIC
}

/// @notice How the module tells owner money from income. WRAPPED: owner batches are bracketed by beginOwnerOp and
/// endOwnerOp, and actions signed outside Sleeve can make owner money look like income (PRD 7.2).
enum AccountingMode {
    WRAPPED
}

/// @notice The market-condition limits PriceGuard applies. SleeveModule holds them as immutables and passes them on
/// every check. PriceGuard.defaultGuardParams() returns the D-014 values.
/// @param stockFeedMaxAge Oldest stock feed round accepted, in seconds since its updatedAt. D-014: 25 hours.
/// @param usdgFeedMaxAge Oldest USDG/USD round accepted, in seconds since its updatedAt. D-014: 25 hours.
/// @param depegToleranceBps How far the USDG/USD answer may sit from 1, in basis points, at most 10,000. D-014: 50.
/// @param multiplierWindow How far ahead a scheduled multiplier change queues buys, in seconds. D-014: 24 hours.
struct GuardParams {
    uint256 stockFeedMaxAge;
    uint256 usdgFeedMaxAge;
    uint16 depegToleranceBps;
    uint256 multiplierWindow;
}
