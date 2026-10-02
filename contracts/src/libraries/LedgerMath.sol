// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";

/// @title LedgerMath
/// @notice Ledger arithmetic for SleeveModule: unsorted USDG, the share split, basket legs, rule validation, outflow
/// order, spend credit, reconcile and the install snapshot. Every amount is in USDG base units.
/// @dev Internal pure functions only: no external calls, no storage, no events. No input makes a function panic. A
/// result too large for a uint256, which no real ledger state produces, reverts with a named error.
library LedgerMath {
    /// @notice Basis points in a whole. Spend and equity shares sum to this, and so do basket weights.
    uint256 internal constant TOTAL_BPS = 10_000;

    /// @notice The equity share given to a split is above TOTAL_BPS.
    /// @param equityBps The equity share given.
    error EquityBpsAboveTotal(uint16 equityBps);

    /// @notice A rule's spend and equity shares do not sum to TOTAL_BPS.
    /// @param spendBps The spend share given.
    /// @param equityBps The equity share given.
    error SharesSumNotTotal(uint16 spendBps, uint16 equityBps);

    /// @notice A basket has no legs.
    error EmptyBasket();

    /// @notice A basket leg has zero weight.
    /// @param leg Index of the first leg with zero weight.
    error ZeroWeight(uint256 leg);

    /// @notice A basket's weights do not sum to TOTAL_BPS.
    /// @param weightSum The sum of the weights given.
    error WeightsSumNotTotal(uint256 weightSum);

    /// @notice An outflow is larger than spend, unsorted and pending equity together.
    /// @param outflow USDG that left the account.
    /// @param available Spend plus unsorted plus pending equity.
    error OutflowExceedsLedgers(uint256 outflow, uint256 available);

    /// @notice The amount by which the ledgers exceed the balance does not fit in a uint256.
    /// @param balance The balance given.
    /// @param spend The spend ledger given.
    /// @param pendingTotal The pending equity total given.
    error ShortfallOverflow(uint256 balance, uint256 spend, uint256 pendingTotal);

    /// @notice The credited spend ledger does not fit in a uint256.
    /// @param spend The spend ledger given.
    /// @param inflow The inflow given.
    error SpendOverflow(uint256 spend, uint256 inflow);

    /// @notice USDG in the account that no ledger accounts for yet. The next split sorts it.
    /// @param balance The account's USDG balance.
    /// @param spend The spend ledger.
    /// @param pendingTotal Pending equity summed over every ticker.
    /// @return The balance minus spend minus pending equity, or zero when the ledgers already cover the balance.
    function unsorted(uint256 balance, uint256 spend, uint256 pendingTotal) internal pure returns (uint256) {
        return Math.saturatingSub(Math.saturatingSub(balance, spend), pendingTotal);
    }

    /// @notice How far the ledgers exceed the balance, which happens when USDG left the account outside Sleeve.
    /// @param balance The account's USDG balance.
    /// @param spend The spend ledger.
    /// @param pendingTotal Pending equity summed over every ticker.
    /// @return Spend plus pending equity minus the balance, or zero when the balance covers the ledgers.
    function shortfall(uint256 balance, uint256 spend, uint256 pendingTotal) internal pure returns (uint256) {
        if (balance >= pendingTotal) return Math.saturatingSub(spend, balance - pendingTotal);
        (bool fits, uint256 excess) = Math.tryAdd(spend, pendingTotal - balance);
        if (!fits) revert ShortfallOverflow(balance, spend, pendingTotal);
        return excess;
    }

    /// @notice Splits an amount into a rule's spend part and equity part.
    /// @dev The equity part rounds down, so the dust, always under one base unit, goes to spend. The full-precision
    /// mulDiv keeps every amount up to type(uint256).max exact.
    /// @param amount USDG to split.
    /// @param equityBps The rule's equity share, at most TOTAL_BPS.
    /// @return spendPart The amount minus the equity part.
    /// @return equityPart floor(amount * equityBps / TOTAL_BPS).
    function splitShares(uint256 amount, uint16 equityBps)
        internal
        pure
        returns (uint256 spendPart, uint256 equityPart)
    {
        if (equityBps > TOTAL_BPS) {
            revert EquityBpsAboveTotal(equityBps);
        }
        equityPart = Math.mulDiv(amount, equityBps, TOTAL_BPS);
        spendPart = amount - equityPart;
    }

    /// @notice Splits an equity part across basket legs by weight.
    /// @dev Cumulative rounding: leg i gets floor(E * cumW_i / TOTAL_BPS) - floor(E * cumW_(i-1) / TOTAL_BPS), where
    /// cumW_i is the sum of the weights up to and including leg i. The legs sum to the equity part exactly and each is
    /// within one base unit of its exact share. Reverts with the validateWeights errors on an invalid basket.
    /// @param equityPart USDG to spread over the legs.
    /// @param weights Leg weights in basis points: at least one, none zero, summing to TOTAL_BPS.
    /// @return legs USDG per leg, index for index with weights.
    function splitLegs(uint256 equityPart, uint16[] memory weights) internal pure returns (uint256[] memory legs) {
        validateWeights(weights);
        legs = new uint256[](weights.length);
        uint256 weightThrough = 0;
        uint256 amountBefore = 0;
        for (uint256 i; i < weights.length; ++i) {
            weightThrough += weights[i];
            uint256 amountThrough = Math.mulDiv(equityPart, weightThrough, TOTAL_BPS);
            legs[i] = amountThrough - amountBefore;
            amountBefore = amountThrough;
        }
    }

    /// @notice Checks that a rule's spend and equity shares sum to exactly TOTAL_BPS.
    /// @param spendBps The spend share.
    /// @param equityBps The equity share.
    function validateShares(uint16 spendBps, uint16 equityBps) internal pure {
        if (uint256(spendBps) + equityBps != TOTAL_BPS) revert SharesSumNotTotal(spendBps, equityBps);
    }

    /// @notice Checks that a basket has at least one leg, no zero weight, and weights that sum to exactly TOTAL_BPS.
    /// @dev The checks run in that order and the zero-weight check names the first zero leg, so a basket with several
    /// faults always fails with the same error.
    /// @param weights Leg weights in basis points.
    function validateWeights(uint16[] memory weights) internal pure {
        if (weights.length == 0) revert EmptyBasket();
        uint256 weightSum = 0;
        for (uint256 i; i < weights.length; ++i) {
            if (weights[i] == 0) revert ZeroWeight(i);
            weightSum += weights[i];
        }
        if (weightSum != TOTAL_BPS) revert WeightsSumNotTotal(weightSum);
    }

    /// @notice Attributes an owner batch's net outflow to the buckets it came from: spend first, then unsorted, then
    /// pending equity per ticker in ascending index order.
    /// @dev Reverts rather than truncate when the outflow is larger than all buckets together, which consistent
    /// inputs never produce because the outflow is at most the balance the batch started with.
    /// @param outflow USDG the batch removed from the account.
    /// @param spend The spend ledger.
    /// @param unsortedUsdg Unsorted USDG, from unsorted() at the batch's virtual balance: the balance at begin plus the
    /// module's own USDG delta inside the batch.
    /// @param pending Pending equity per ticker.
    /// @return fromSpend USDG to take off the spend ledger.
    /// @return fromUnsorted USDG that came out of unsorted, which needs no ledger change.
    /// @return fromPending USDG to take off each ticker's pending equity, index for index with pending.
    function allocateOutflow(uint256 outflow, uint256 spend, uint256 unsortedUsdg, uint256[] memory pending)
        internal
        pure
        returns (uint256 fromSpend, uint256 fromUnsorted, uint256[] memory fromPending)
    {
        uint256 remaining = outflow;
        fromSpend = Math.min(remaining, spend);
        remaining -= fromSpend;
        fromUnsorted = Math.min(remaining, unsortedUsdg);
        remaining -= fromUnsorted;
        fromPending = new uint256[](pending.length);
        for (uint256 i; i < pending.length && remaining != 0; ++i) {
            fromPending[i] = Math.min(remaining, pending[i]);
            remaining -= fromPending[i];
        }
        if (remaining != 0) revert OutflowExceedsLedgers(outflow, outflow - remaining);
    }

    /// @notice Credits USDG to the spend ledger in full, as for an owner batch that ended with more USDG than it
    /// started, so the inflow is never split.
    /// @param spend The spend ledger.
    /// @param inflow USDG to credit.
    /// @return The spend ledger plus the inflow.
    function creditSpend(uint256 spend, uint256 inflow) internal pure returns (uint256) {
        (bool fits, uint256 credited) = Math.tryAdd(spend, inflow);
        if (!fits) revert SpendOverflow(spend, inflow);
        return credited;
    }

    /// @notice Brings the ledgers down to the balance after USDG left the account outside Sleeve, such as a pull
    /// through an old approval. Cuts spend first, then pending equity per ticker in ascending index order, and never
    /// below zero. Returns zeros when the balance already covers the ledgers.
    /// @dev Cutting in that order is the same as letting the balance back pending from the last index down and spend
    /// last. The loop walks that way so it never has to sum the ledgers, which keeps every input free of overflow.
    /// @param balance The account's USDG balance.
    /// @param spend The spend ledger.
    /// @param pending Pending equity per ticker.
    /// @return fromSpend USDG to take off the spend ledger.
    /// @return fromPending USDG to take off each ticker's pending equity, index for index with pending.
    function reconcile(uint256 balance, uint256 spend, uint256[] memory pending)
        internal
        pure
        returns (uint256 fromSpend, uint256[] memory fromPending)
    {
        fromPending = new uint256[](pending.length);
        uint256 balanceLeft = balance;
        for (uint256 i = pending.length; i > 0; --i) {
            uint256 leg = i - 1;
            uint256 kept = Math.min(pending[leg], balanceLeft);
            fromPending[leg] = pending[leg] - kept;
            balanceLeft -= kept;
        }
        fromSpend = spend - Math.min(spend, balanceLeft);
    }

    /// @notice The spend ledger at install: the whole USDG balance, so USDG already in the account is never split.
    /// @dev Pending equity starts at zero, so unsorted starts at zero and later equals exactly the USDG that arrives.
    /// @param balance The account's USDG balance at install.
    /// @return spend The spend ledger to store.
    function installSnapshot(uint256 balance) internal pure returns (uint256 spend) {
        return balance;
    }
}
