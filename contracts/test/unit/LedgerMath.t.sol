// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {LedgerMath} from "../../src/libraries/LedgerMath.sol";

/// @dev Calls LedgerMath through external functions so tests can expect its reverts.
contract LedgerMathHarness {
    function unsorted(uint256 balance, uint256 spend, uint256 pendingTotal) external pure returns (uint256) {
        return LedgerMath.unsorted(balance, spend, pendingTotal);
    }

    function shortfall(uint256 balance, uint256 spend, uint256 pendingTotal) external pure returns (uint256) {
        return LedgerMath.shortfall(balance, spend, pendingTotal);
    }

    function splitShares(uint256 amount, uint16 equityBps) external pure returns (uint256, uint256) {
        return LedgerMath.splitShares(amount, equityBps);
    }

    function splitLegs(uint256 equityPart, uint16[] memory weights) external pure returns (uint256[] memory) {
        return LedgerMath.splitLegs(equityPart, weights);
    }

    function validateShares(uint16 spendBps, uint16 equityBps) external pure {
        LedgerMath.validateShares(spendBps, equityBps);
    }

    function validateWeights(uint16[] memory weights) external pure {
        LedgerMath.validateWeights(weights);
    }

    function allocateOutflow(uint256 outflow, uint256 spend, uint256 unsortedUsdg, uint256[] memory pending)
        external
        pure
        returns (uint256, uint256, uint256[] memory)
    {
        return LedgerMath.allocateOutflow(outflow, spend, unsortedUsdg, pending);
    }

    function creditSpend(uint256 spend, uint256 inflow) external pure returns (uint256) {
        return LedgerMath.creditSpend(spend, inflow);
    }

    function reconcile(uint256 balance, uint256 spend, uint256[] memory pending)
        external
        pure
        returns (uint256, uint256[] memory)
    {
        return LedgerMath.reconcile(balance, spend, pending);
    }

    function installSnapshot(uint256 balance) external pure returns (uint256) {
        return LedgerMath.installSnapshot(balance);
    }
}

/// @notice Unit and fuzz tests for LedgerMath. Invariants I2, I5 and I9 come from PRD section 11, and the outflow
/// order and reconcile from section 7.2. Every fuzz test runs 10,000 times.
contract LedgerMathTest is Test {
    uint256 private constant TOTAL = 10_000;
    uint256 private constant MAX = type(uint256).max;
    /// @dev Cap for fuzzed amounts in tests that need exact totals, so ten of them still sum inside a uint256.
    uint256 private constant AMOUNT_CAP = type(uint128).max;
    uint256 private constant MAX_FUZZ_LEGS = 8;
    uint256 private constant MAX_FUZZ_WEIGHTS = 32;

    LedgerMathHarness private harness;

    function setUp() public {
        harness = new LedgerMathHarness();
    }

    function test_totalBpsIsTenThousand() public pure {
        assertEq(LedgerMath.TOTAL_BPS, 10_000);
    }

    // Unsorted and shortfall

    function test_unsorted_isBalanceMinusLedgers() public view {
        assertEq(harness.unsorted(1_000, 600, 300), 100);
        assertEq(harness.unsorted(1_000, 0, 0), 1_000);
    }

    function test_unsorted_isZeroWhenLedgersCoverBalance() public view {
        assertEq(harness.unsorted(900, 600, 300), 0, "exactly covered");
        assertEq(harness.unsorted(700, 600, 300), 0, "balance between spend and the ledgers");
        assertEq(harness.unsorted(500, 600, 300), 0, "balance below spend");
        assertEq(harness.unsorted(0, 0, 0), 0, "empty account");
    }

    function test_unsorted_atMaxValues() public view {
        assertEq(harness.unsorted(MAX, 0, 0), MAX);
        assertEq(harness.unsorted(MAX, 1, 1), MAX - 2);
        assertEq(harness.unsorted(MAX, 1, MAX - 1), 0);
        assertEq(harness.unsorted(MAX, MAX, MAX), 0);
    }

    function test_shortfall_isLedgersMinusBalance() public view {
        assertEq(harness.shortfall(800, 600, 300), 100, "balance between spend and the ledgers");
        assertEq(harness.shortfall(500, 600, 300), 400, "balance below spend");
        assertEq(harness.shortfall(100, 600, 300), 800, "balance below pending");
        assertEq(harness.shortfall(0, 600, 300), 900, "balance zero");
    }

    function test_shortfall_isZeroWhenBalanceCoversLedgers() public view {
        assertEq(harness.shortfall(900, 600, 300), 0);
        assertEq(harness.shortfall(1_000, 600, 300), 0);
        assertEq(harness.shortfall(0, 0, 0), 0);
    }

    function test_shortfall_atMaxValues() public view {
        assertEq(harness.shortfall(0, MAX, 0), MAX);
        assertEq(harness.shortfall(1, MAX, 1), MAX);
        assertEq(harness.shortfall(0, MAX - 5, 5), MAX);
        assertEq(harness.shortfall(MAX, MAX, MAX), MAX);
    }

    function test_shortfall_revertsWhenItCannotFit() public {
        vm.expectRevert(abi.encodeWithSelector(LedgerMath.ShortfallOverflow.selector, 0, MAX, 1));
        harness.shortfall(0, MAX, 1);
    }

    // Share split

    function test_splitShares_zeroAmount() public view {
        _assertSplit(0, 1_000, 0, 0);
        _assertSplit(0, 10_000, 0, 0);
    }

    function test_splitShares_zeroEquityKeepsAllInSpend() public view {
        _assertSplit(500e6, 0, 500e6, 0);
        _assertSplit(MAX, 0, MAX, 0);
    }

    function test_splitShares_fullEquityLeavesNothingInSpend() public view {
        _assertSplit(500e6, 10_000, 0, 500e6);
        _assertSplit(MAX, 10_000, 0, MAX);
    }

    function test_splitShares_paydayTenPercent() public view {
        _assertSplit(500e6, 1_000, 450e6, 50e6);
    }

    function test_splitShares_dustGoesToSpend() public view {
        _assertSplit(1, 5_000, 1, 0);
        _assertSplit(7, 1_000, 7, 0);
        _assertSplit(19_999, 5_000, 10_000, 9_999);
        _assertSplit(10_001, 3_333, 6_668, 3_333);
    }

    function test_splitShares_maxAmountDoesNotOverflow() public view {
        // MAX is odd, so it is not a multiple of 10,000 and the spend part rounds up.
        uint256 spendAtOneBps = MAX / TOTAL + 1;
        _assertSplit(MAX, 9_999, spendAtOneBps, MAX - spendAtOneBps);
        _assertSplit(MAX, 1, MAX - MAX / TOTAL, MAX / TOTAL);
    }

    function test_splitShares_revertsAboveTotal() public {
        vm.expectRevert(abi.encodeWithSelector(LedgerMath.EquityBpsAboveTotal.selector, 10_001));
        harness.splitShares(1, 10_001);
        vm.expectRevert(abi.encodeWithSelector(LedgerMath.EquityBpsAboveTotal.selector, type(uint16).max));
        harness.splitShares(MAX, type(uint16).max);
    }

    // Basket legs

    function test_splitLegs_oneLegTakesAll() public view {
        assertEq(harness.splitLegs(777, _weights(10_000)), _amounts(777));
        assertEq(harness.splitLegs(MAX, _weights(10_000)), _amounts(MAX));
    }

    function test_splitLegs_zeroEquityGivesZeroLegs() public view {
        assertEq(harness.splitLegs(0, _weights(2_500, 7_500)), _amounts(0, 0));
    }

    function test_splitLegs_unevenWeightsRoundCumulatively() public view {
        // Rounding each leg down on its own would give 33, 33 and 33 and lose a unit.
        assertEq(harness.splitLegs(100, _weights(3_333, 3_333, 3_334)), _amounts(33, 33, 34));
        assertEq(harness.splitLegs(2, _weights(3_333, 3_334, 3_333)), _amounts(0, 1, 1));
        assertEq(harness.splitLegs(1, _weights(5_000, 5_000)), _amounts(0, 1));
        assertEq(harness.splitLegs(10, _weights(1, 9_999)), _amounts(0, 10));
    }

    function test_splitLegs_manyUnevenLegs() public view {
        uint16[] memory weights = new uint16[](100);
        for (uint256 i; i < 99; ++i) {
            weights[i] = uint16(i + 1);
        }
        weights[99] = 5_050; // 1 + 2 + ... + 99 = 4,950

        uint256 equityPart = 123_456_789;
        uint256[] memory legs = harness.splitLegs(equityPart, weights);
        uint256 weightThrough;
        uint256 legsThrough;
        for (uint256 i; i < legs.length; ++i) {
            weightThrough += weights[i];
            legsThrough += legs[i];
            assertEq(legsThrough, equityPart * weightThrough / TOTAL, "prefix is not the floor of its share");
        }
        assertEq(legsThrough, equityPart);
    }

    function test_splitLegs_tenThousandLegsOfOneBps() public view {
        uint16[] memory weights = _onesBasket(10_000);

        uint256[] memory legs = harness.splitLegs(20_000, weights);
        for (uint256 i; i < legs.length; ++i) {
            assertEq(legs[i], 2);
        }

        legs = harness.splitLegs(9_999, weights);
        assertEq(legs[0], 0, "first leg rounds down to zero");
        for (uint256 i = 1; i < legs.length; ++i) {
            assertEq(legs[i], 1);
        }

        assertEq(_sum(harness.splitLegs(MAX, weights)), MAX);
    }

    function test_splitLegs_revertsOnInvalidBasket() public {
        vm.expectRevert(LedgerMath.EmptyBasket.selector);
        harness.splitLegs(1, new uint16[](0));
        vm.expectRevert(abi.encodeWithSelector(LedgerMath.ZeroWeight.selector, 0));
        harness.splitLegs(1, _weights(0, 10_000));
        vm.expectRevert(abi.encodeWithSelector(LedgerMath.WeightsSumNotTotal.selector, 9_000));
        harness.splitLegs(1, _weights(5_000, 4_000));
    }

    // Validation

    function test_validateShares_acceptsPairsAtTotal() public view {
        harness.validateShares(9_000, 1_000);
        harness.validateShares(5_000, 5_000);
        harness.validateShares(10_000, 0);
        harness.validateShares(0, 10_000);
    }

    function test_validateShares_rejectsOtherSums() public {
        _expectSharesRevert(9_000, 999);
        _expectSharesRevert(9_000, 1_001);
        _expectSharesRevert(0, 0);
        _expectSharesRevert(10_000, 10_000);
        _expectSharesRevert(type(uint16).max, type(uint16).max);
    }

    function test_validateWeights_acceptsBasketsAtTotal() public view {
        harness.validateWeights(_weights(10_000));
        harness.validateWeights(_weights(1, 9_999));
        harness.validateWeights(_weights(2_500, 2_500, 5_000));
        harness.validateWeights(_onesBasket(10_000));
    }

    function test_validateWeights_rejectsEmptyBasket() public {
        _expectWeightsRevert(new uint16[](0), abi.encodeWithSelector(LedgerMath.EmptyBasket.selector));
    }

    function test_validateWeights_rejectsZeroWeight() public {
        _expectWeightsRevert(_weights(0), abi.encodeWithSelector(LedgerMath.ZeroWeight.selector, 0));
        _expectWeightsRevert(_weights(0, 10_000), abi.encodeWithSelector(LedgerMath.ZeroWeight.selector, 0));
        _expectWeightsRevert(_weights(10_000, 0), abi.encodeWithSelector(LedgerMath.ZeroWeight.selector, 1));
        _expectWeightsRevert(_weights(5_000, 0, 5_000), abi.encodeWithSelector(LedgerMath.ZeroWeight.selector, 1));
    }

    function test_validateWeights_rejectsSumOffTotal() public {
        _expectWeightsRevert(_weights(9_999), abi.encodeWithSelector(LedgerMath.WeightsSumNotTotal.selector, 9_999));
        _expectWeightsRevert(
            _weights(5_000, 5_001), abi.encodeWithSelector(LedgerMath.WeightsSumNotTotal.selector, 10_001)
        );
        _expectWeightsRevert(
            _weights(type(uint16).max, type(uint16).max),
            abi.encodeWithSelector(LedgerMath.WeightsSumNotTotal.selector, 131_070)
        );
        _expectWeightsRevert(
            _onesBasket(10_001), abi.encodeWithSelector(LedgerMath.WeightsSumNotTotal.selector, 10_001)
        );
    }

    function test_validateWeights_reportsZeroWeightBeforeSum() public {
        _expectWeightsRevert(_weights(6_000, 6_000, 0), abi.encodeWithSelector(LedgerMath.ZeroWeight.selector, 2));
    }

    // Outflow order, against spend 100, unsorted 50 and pending [30, 0, 20]

    function test_allocateOutflow_zeroTakesNothing() public view {
        _assertOutflow(0, 0, 0, _amounts(0, 0, 0));
    }

    function test_allocateOutflow_insideSpend() public view {
        _assertOutflow(60, 60, 0, _amounts(0, 0, 0));
    }

    function test_allocateOutflow_atSpendBoundary() public view {
        _assertOutflow(99, 99, 0, _amounts(0, 0, 0));
        _assertOutflow(100, 100, 0, _amounts(0, 0, 0));
        _assertOutflow(101, 100, 1, _amounts(0, 0, 0));
    }

    function test_allocateOutflow_atUnsortedBoundary() public view {
        _assertOutflow(149, 100, 49, _amounts(0, 0, 0));
        _assertOutflow(150, 100, 50, _amounts(0, 0, 0));
        _assertOutflow(151, 100, 50, _amounts(1, 0, 0));
    }

    function test_allocateOutflow_atPendingBoundaries() public view {
        _assertOutflow(179, 100, 50, _amounts(29, 0, 0));
        _assertOutflow(180, 100, 50, _amounts(30, 0, 0));
        _assertOutflow(181, 100, 50, _amounts(30, 0, 1));
        _assertOutflow(199, 100, 50, _amounts(30, 0, 19));
        _assertOutflow(200, 100, 50, _amounts(30, 0, 20));
    }

    function test_allocateOutflow_revertsAboveEveryBucket() public {
        vm.expectRevert(abi.encodeWithSelector(LedgerMath.OutflowExceedsLedgers.selector, 201, 200));
        harness.allocateOutflow(201, 100, 50, _amounts(30, 0, 20));
    }

    function test_allocateOutflow_withNoPendingLegs() public {
        (uint256 fromSpend, uint256 fromUnsorted, uint256[] memory fromPending) =
            harness.allocateOutflow(150, 100, 50, new uint256[](0));
        assertEq(fromSpend, 100);
        assertEq(fromUnsorted, 50);
        assertEq(fromPending.length, 0);

        vm.expectRevert(abi.encodeWithSelector(LedgerMath.OutflowExceedsLedgers.selector, 151, 150));
        harness.allocateOutflow(151, 100, 50, new uint256[](0));
    }

    function test_allocateOutflow_atMaxValues() public view {
        (uint256 fromSpend, uint256 fromUnsorted, uint256[] memory fromPending) =
            harness.allocateOutflow(MAX, MAX, MAX, _amounts(MAX));
        assertEq(fromSpend, MAX);
        assertEq(fromUnsorted, 0);
        assertEq(fromPending, _amounts(0));

        (fromSpend, fromUnsorted, fromPending) = harness.allocateOutflow(MAX, 1, 1, _amounts(MAX, MAX));
        assertEq(fromSpend, 1);
        assertEq(fromUnsorted, 1);
        assertEq(fromPending, _amounts(MAX - 2, 0));
    }

    // Spend credit

    function test_creditSpend_addsInflowInFull() public view {
        assertEq(harness.creditSpend(100, 0), 100);
        assertEq(harness.creditSpend(100, 50), 150);
        assertEq(harness.creditSpend(0, MAX), MAX);
        assertEq(harness.creditSpend(MAX - 1, 1), MAX);
    }

    function test_creditSpend_revertsPastMax() public {
        vm.expectRevert(abi.encodeWithSelector(LedgerMath.SpendOverflow.selector, MAX, 1));
        harness.creditSpend(MAX, 1);
    }

    // Reconcile, against spend 100 and pending [30, 0, 20], which total 150

    function test_reconcile_removesNothingWhenBalanceCoversLedgers() public view {
        _assertReconcile(200, 0, _amounts(0, 0, 0));
        _assertReconcile(150, 0, _amounts(0, 0, 0));
    }

    function test_reconcile_cutsSpendFirst() public view {
        _assertReconcile(149, 1, _amounts(0, 0, 0));
        _assertReconcile(140, 10, _amounts(0, 0, 0));
        _assertReconcile(50, 100, _amounts(0, 0, 0));
    }

    function test_reconcile_thenPendingInAscendingOrder() public view {
        _assertReconcile(49, 100, _amounts(1, 0, 0));
        _assertReconcile(20, 100, _amounts(30, 0, 0));
        _assertReconcile(19, 100, _amounts(30, 0, 1));
    }

    function test_reconcile_balanceZeroRemovesEverything() public view {
        _assertReconcile(0, 100, _amounts(30, 0, 20));
    }

    function test_reconcile_withNoPendingLegs() public view {
        (uint256 fromSpend, uint256[] memory fromPending) = harness.reconcile(40, 100, new uint256[](0));
        assertEq(fromSpend, 60);
        assertEq(fromPending.length, 0);
    }

    function test_reconcile_atMaxValues() public view {
        (uint256 fromSpend, uint256[] memory fromPending) = harness.reconcile(0, MAX, _amounts(MAX, MAX));
        assertEq(fromSpend, MAX);
        assertEq(fromPending, _amounts(MAX, MAX));

        (fromSpend, fromPending) = harness.reconcile(MAX, MAX, _amounts(MAX, MAX));
        assertEq(fromSpend, MAX);
        assertEq(fromPending, _amounts(MAX, 0));
    }

    // Install snapshot

    function test_installSnapshot_spendTakesWholeBalance() public view {
        uint256 spend = harness.installSnapshot(1_234e6);
        assertEq(spend, 1_234e6);
        assertEq(harness.unsorted(1_234e6, spend, 0), 0, "USDG present at install is unsorted");
        assertEq(harness.unsorted(1_234e6 + 500e6, spend, 0), 500e6, "a later payment is not all unsorted");
    }

    function test_installSnapshot_emptyAccount() public view {
        uint256 spend = harness.installSnapshot(0);
        assertEq(spend, 0);
        assertEq(harness.unsorted(0, spend, 0), 0);
        assertEq(harness.unsorted(75e6, spend, 0), 75e6);
    }

    // I2: for every split, USDG in equals spend plus equity, with dust under one base unit sent to spend.

    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_I2_splitConserves(uint256 amount, uint16 equityBps, uint256 basketSeed, uint8 legCount)
        public
        view
    {
        equityBps = uint16(bound(equityBps, 0, TOTAL));
        uint16[] memory weights = _basketFromSeed(basketSeed, bound(legCount, 1, MAX_FUZZ_WEIGHTS));

        (uint256 spendPart, uint256 equityPart) = harness.splitShares(amount, equityBps);
        uint256[] memory legs = harness.splitLegs(equityPart, weights);

        assertEq(spendPart + _sum(legs), amount, "split does not conserve USDG");
        (uint256 paidHigh, uint256 paidLow) = _mul512(spendPart, TOTAL);
        (uint256 owedHigh, uint256 owedLow) = _mul512(amount, TOTAL - equityBps);
        _assertGapUnderOneUnit(paidHigh, paidLow, owedHigh, owedLow, "dust given to spend");
    }

    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_I2_legsRoundCumulatively(uint256 equityPart, uint256 basketSeed, uint8 legCount) public view {
        uint16[] memory weights = _basketFromSeed(basketSeed, bound(legCount, 1, MAX_FUZZ_WEIGHTS));
        uint256[] memory legs = harness.splitLegs(equityPart, weights);
        assertEq(legs.length, weights.length, "leg count");

        uint256 weightThrough;
        uint256 legsThrough;
        for (uint256 i; i < legs.length; ++i) {
            weightThrough += weights[i];
            legsThrough += legs[i];
            (uint256 exactHigh, uint256 exactLow) = _mul512(equityPart, weightThrough);
            (uint256 givenHigh, uint256 givenLow) = _mul512(legsThrough, TOTAL);
            _assertGapUnderOneUnit(exactHigh, exactLow, givenHigh, givenLow, "rounding kept back from the legs");
            _assertWithinOneUnit(legs[i], equityPart, weights[i]);
        }
        assertEq(legsThrough, equityPart, "legs do not sum to the equity part");
    }

    // I5: USDG present at install is never split.

    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_I5_installSnapshotLeavesNothingUnsorted(uint256 balance, uint256 inflow) public view {
        uint256 spend = harness.installSnapshot(balance);
        assertEq(spend, balance, "spend ledger is not the balance at install");
        assertEq(harness.unsorted(balance, spend, 0), 0, "USDG present at install is unsorted");
        assertEq(harness.shortfall(balance, spend, 0), 0, "install starts with a shortfall");

        inflow = bound(inflow, 0, MAX - balance);
        assertEq(harness.unsorted(balance + inflow, spend, 0), inflow, "unsorted is not exactly the later inflow");
    }

    // I9: spend and equity shares sum to 10,000, and basket weights sum to 10,000.

    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_I9_sharesAcceptEveryPairAtTotal(uint16 spendBps) public {
        uint16 spendShare = uint16(bound(spendBps, 0, TOTAL));
        uint16 equityShare = uint16(TOTAL - spendShare);
        harness.validateShares(spendShare, equityShare);

        _expectSharesRevert(spendShare + 1, equityShare);
        _expectSharesRevert(spendShare, equityShare + 1);
        if (spendShare > 0) _expectSharesRevert(spendShare - 1, equityShare);
        if (equityShare > 0) _expectSharesRevert(spendShare, equityShare - 1);
    }

    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_I9_sharesRejectEveryPairOffTotal(uint16 spendBps, uint16 equityBps) public {
        if (uint256(spendBps) + equityBps == TOTAL) {
            harness.validateShares(spendBps, equityBps);
        } else {
            _expectSharesRevert(spendBps, equityBps);
        }
    }

    /// @dev A uint16 sum would wrap 65,535 + 10,001 around to exactly 10,000.
    function test_I9_sharesRejectWrappingPair() public {
        _expectSharesRevert(type(uint16).max, 10_001);
        _expectSharesRevert(10_001, type(uint16).max);
    }

    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_I9_weightsAcceptEveryBasketAtTotal(uint256 basketSeed, uint8 legCount, uint256 nudgedLeg) public {
        uint16[] memory weights = _basketFromSeed(basketSeed, bound(legCount, 1, MAX_FUZZ_WEIGHTS));
        harness.validateWeights(weights);

        uint256 leg = bound(nudgedLeg, 0, weights.length - 1);
        uint16 weight = weights[leg];
        weights[leg] = weight + 1;
        _expectWeightsRevert(weights, abi.encodeWithSelector(LedgerMath.WeightsSumNotTotal.selector, TOTAL + 1));
        weights[leg] = weight - 1;
        _expectWeightsRevert(
            weights,
            weight == 1
                ? abi.encodeWithSelector(LedgerMath.ZeroWeight.selector, leg)
                : abi.encodeWithSelector(LedgerMath.WeightsSumNotTotal.selector, TOTAL - 1)
        );
    }

    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_I9_weightsRejectEveryBasketOffRule(uint16[] memory weights) public {
        bytes memory expectedRevert = _basketRule(weights);
        if (expectedRevert.length == 0) {
            harness.validateWeights(weights);
        } else {
            _expectWeightsRevert(weights, expectedRevert);
        }
    }

    // Unsorted, shortfall and spend credit over the whole uint256 range

    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_unsortedAndShortfallSplitTheGap(uint256 balance, uint256 spend, uint256 pendingTotal) public {
        uint256 unsortedUsdg = harness.unsorted(balance, spend, pendingTotal);
        (uint256 ledgersHigh, uint256 ledgersLow) = _add512(0, spend, pendingTotal);
        (bool ledgersAbove, uint256 gapHigh,) = _sub512(ledgersHigh, ledgersLow, 0, balance);
        if (ledgersAbove && gapHigh != 0) {
            assertEq(unsortedUsdg, 0, "unsorted while the ledgers exceed the balance");
            vm.expectRevert(abi.encodeWithSelector(LedgerMath.ShortfallOverflow.selector, balance, spend, pendingTotal));
            harness.shortfall(balance, spend, pendingTotal);
            return;
        }

        uint256 gap = harness.shortfall(balance, spend, pendingTotal);
        assertTrue(unsortedUsdg == 0 || gap == 0, "unsorted and shortfall both nonzero");
        (uint256 leftHigh, uint256 leftLow) = _add512(0, balance, gap);
        (uint256 rightHigh, uint256 rightLow) = _add512(ledgersHigh, ledgersLow, unsortedUsdg);
        assertEq(leftHigh, rightHigh, "balance plus shortfall is not the ledgers plus unsorted");
        assertEq(leftLow, rightLow, "balance plus shortfall is not the ledgers plus unsorted");
    }

    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_creditSpendAddsInflowInFull(uint256 spend, uint256 inflow) public {
        if (inflow > MAX - spend) {
            vm.expectRevert(abi.encodeWithSelector(LedgerMath.SpendOverflow.selector, spend, inflow));
            harness.creditSpend(spend, inflow);
        } else {
            assertEq(harness.creditSpend(spend, inflow), spend + inflow);
        }
    }

    // Outflow order: spend, then unsorted, then pending in ascending index order

    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_outflowDrainsSpendThenUnsortedThenPending(
        uint256 outflow,
        uint256 spend,
        uint256 unsortedUsdg,
        uint256[] memory pending
    ) public {
        _checkOutflow(outflow, spend, unsortedUsdg, _firstLegs(pending, MAX));
    }

    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_outflowAtBucketEdges(
        uint256 spend,
        uint256 unsortedUsdg,
        uint256[] memory pending,
        uint256 edgeSeed
    ) public {
        spend = bound(spend, 0, AMOUNT_CAP);
        unsortedUsdg = bound(unsortedUsdg, 0, AMOUNT_CAP);
        pending = _firstLegs(pending, AMOUNT_CAP);
        uint256 outflow = _nearEdge(_outflowBuckets(spend, unsortedUsdg, pending), edgeSeed);
        _checkOutflow(outflow, spend, unsortedUsdg, pending);
    }

    // Reconcile: spend first, then pending in ascending index order, down to the balance and never below zero

    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_reconcileCutsLedgersDownToBalance(uint256 balance, uint256 spend, uint256[] memory pending)
        public
        view
    {
        pending = _firstLegs(pending, MAX);
        (uint256 fromSpend, uint256[] memory fromPending) = harness.reconcile(balance, spend, pending);
        uint256[] memory ledgers = _ledgerBuckets(spend, pending);
        uint256[] memory cuts = _ledgerBuckets(fromSpend, fromPending);
        _assertDrainedInOrder(ledgers, cuts);

        uint256 kept;
        bool anyCut;
        for (uint256 k; k < ledgers.length; ++k) {
            kept += ledgers[k] - cuts[k];
            anyCut = anyCut || cuts[k] != 0;
        }
        assertLe(kept, balance, "ledgers left above the balance");
        if (anyCut) assertEq(kept, balance, "cut below the balance");
    }

    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_reconcileIsOutflowOfShortfall(
        uint256 spend,
        uint256[] memory pending,
        uint256 edgeSeed,
        uint256 surplus
    ) public view {
        spend = bound(spend, 0, AMOUNT_CAP);
        pending = _firstLegs(pending, AMOUNT_CAP);
        _assertReconcileFollowsOutflow(_balanceNearEdge(spend, pending, edgeSeed, surplus), spend, pending);
    }

    // Helpers

    function _assertSplit(uint256 amount, uint16 equityBps, uint256 expectedSpend, uint256 expectedEquity)
        private
        view
    {
        (uint256 spendPart, uint256 equityPart) = harness.splitShares(amount, equityBps);
        assertEq(spendPart, expectedSpend, "spend part");
        assertEq(equityPart, expectedEquity, "equity part");
    }

    function _assertOutflow(
        uint256 outflow,
        uint256 expectedFromSpend,
        uint256 expectedFromUnsorted,
        uint256[] memory expectedFromPending
    ) private view {
        (uint256 fromSpend, uint256 fromUnsorted, uint256[] memory fromPending) =
            harness.allocateOutflow(outflow, 100, 50, _amounts(30, 0, 20));
        assertEq(fromSpend, expectedFromSpend, "from spend");
        assertEq(fromUnsorted, expectedFromUnsorted, "from unsorted");
        assertEq(fromPending, expectedFromPending, "from pending");
    }

    function _assertReconcile(uint256 balance, uint256 expectedFromSpend, uint256[] memory expectedFromPending)
        private
        view
    {
        (uint256 fromSpend, uint256[] memory fromPending) = harness.reconcile(balance, 100, _amounts(30, 0, 20));
        assertEq(fromSpend, expectedFromSpend, "from spend");
        assertEq(fromPending, expectedFromPending, "from pending");
    }

    function _expectSharesRevert(uint16 spendBps, uint16 equityBps) private {
        vm.expectRevert(abi.encodeWithSelector(LedgerMath.SharesSumNotTotal.selector, spendBps, equityBps));
        harness.validateShares(spendBps, equityBps);
    }

    function _expectWeightsRevert(uint16[] memory weights, bytes memory revertData) private {
        vm.expectRevert(revertData);
        harness.validateWeights(weights);
    }

    /// @dev Expects success with the parts summing to the outflow in drain order when the buckets cover it, and the
    /// named revert otherwise. Saturating at MAX is safe: an outflow is at most MAX, so a larger total always covers it.
    function _checkOutflow(uint256 outflow, uint256 spend, uint256 unsortedUsdg, uint256[] memory pending) private {
        uint256[] memory buckets = _outflowBuckets(spend, unsortedUsdg, pending);
        uint256 available = _saturatingSum(buckets);
        if (outflow > available) {
            vm.expectRevert(abi.encodeWithSelector(LedgerMath.OutflowExceedsLedgers.selector, outflow, available));
            harness.allocateOutflow(outflow, spend, unsortedUsdg, pending);
            return;
        }

        (uint256 fromSpend, uint256 fromUnsorted, uint256[] memory fromPending) =
            harness.allocateOutflow(outflow, spend, unsortedUsdg, pending);
        uint256[] memory taken = _outflowBuckets(fromSpend, fromUnsorted, fromPending);
        assertEq(_sum(taken), outflow, "parts do not sum to the outflow");
        _assertDrainedInOrder(buckets, taken);
    }

    /// @dev Reconcile must cut exactly what an outflow of the shortfall would take, with nothing unsorted to take from.
    function _assertReconcileFollowsOutflow(uint256 balance, uint256 spend, uint256[] memory pending) private view {
        uint256 gap = harness.shortfall(balance, spend, _sum(pending));
        (uint256 fromSpend, uint256[] memory fromPending) = harness.reconcile(balance, spend, pending);
        (uint256 outSpend, uint256 outUnsorted, uint256[] memory outPending) =
            harness.allocateOutflow(gap, spend, 0, pending);

        assertEq(fromSpend, outSpend, "spend cut differs from the outflow order");
        assertEq(fromPending, outPending, "pending cuts differ from the outflow order");
        assertEq(outUnsorted, 0);
        assertEq(fromSpend + _sum(fromPending), gap, "cuts do not sum to the shortfall");
    }

    /// @dev A balance whose shortfall against the ledgers lands near a bucket boundary, or a balance that covers them.
    function _balanceNearEdge(uint256 spend, uint256[] memory pending, uint256 edgeSeed, uint256 surplus)
        private
        pure
        returns (uint256)
    {
        uint256[] memory ledgers = _ledgerBuckets(spend, pending);
        uint256 ledgerTotal = _sum(ledgers);
        uint256 target = _nearEdge(ledgers, edgeSeed);
        return target <= ledgerTotal ? ledgerTotal - target : ledgerTotal + bound(surplus, 0, AMOUNT_CAP);
    }

    /// @dev Each part is at most its bucket, so no ledger goes below zero, and a bucket is touched only once every
    /// earlier bucket is empty.
    function _assertDrainedInOrder(uint256[] memory buckets, uint256[] memory taken) private pure {
        assertEq(taken.length, buckets.length, "bucket count");
        bool laterUntouched;
        for (uint256 k; k < buckets.length; ++k) {
            assertLe(taken[k], buckets[k], "part above its bucket");
            if (laterUntouched) {
                assertEq(taken[k], 0, "bucket touched before an earlier one was empty");
            } else if (taken[k] < buckets[k]) {
                laterUntouched = true;
            }
        }
    }

    /// @dev Asserts 0 <= a - b < TOTAL, with a and b as 512-bit numbers.
    function _assertGapUnderOneUnit(uint256 aHigh, uint256 aLow, uint256 bHigh, uint256 bLow, string memory gap)
        private
        pure
    {
        (bool nonNegative, uint256 gapHigh, uint256 gapLow) = _sub512(aHigh, aLow, bHigh, bLow);
        assertTrue(nonNegative, string.concat(gap, " is below zero"));
        assertTrue(gapHigh == 0 && gapLow < TOTAL, string.concat(gap, " is a unit or more"));
    }

    /// @dev Asserts |leg * TOTAL - equityPart * weight| < TOTAL, so the leg is within one unit of its exact share.
    function _assertWithinOneUnit(uint256 leg, uint256 equityPart, uint256 weight) private pure {
        (uint256 givenHigh, uint256 givenLow) = _mul512(leg, TOTAL);
        (uint256 exactHigh, uint256 exactLow) = _mul512(equityPart, weight);
        (bool above, uint256 gapHigh, uint256 gapLow) = _sub512(givenHigh, givenLow, exactHigh, exactLow);
        if (!above) (, gapHigh, gapLow) = _sub512(exactHigh, exactLow, givenHigh, givenLow);
        assertTrue(gapHigh == 0 && gapLow < TOTAL, "leg is a unit or more off its exact share");
    }

    /// @dev The basket rule written out on its own: the revert validateWeights must raise, or empty when valid.
    function _basketRule(uint16[] memory weights) private pure returns (bytes memory) {
        if (weights.length == 0) return abi.encodeWithSelector(LedgerMath.EmptyBasket.selector);
        uint256 weightSum;
        for (uint256 i; i < weights.length; ++i) {
            if (weights[i] == 0) return abi.encodeWithSelector(LedgerMath.ZeroWeight.selector, i);
            weightSum += weights[i];
        }
        if (weightSum != TOTAL) return abi.encodeWithSelector(LedgerMath.WeightsSumNotTotal.selector, weightSum);
        return "";
    }

    /// @dev A valid basket of legCount positive weights drawn from seed. Early legs tend to be heavier.
    function _basketFromSeed(uint256 seed, uint256 legCount) private pure returns (uint16[] memory weights) {
        weights = new uint16[](legCount);
        uint256 weightLeft = TOTAL;
        for (uint256 i; i + 1 < legCount; ++i) {
            uint256 legsAfter = legCount - 1 - i;
            seed = uint256(keccak256(abi.encode(seed)));
            uint256 weight = 1 + seed % (weightLeft - legsAfter);
            weights[i] = uint16(weight);
            weightLeft -= weight;
        }
        weights[legCount - 1] = uint16(weightLeft);
    }

    /// @dev Picks a point on a boundary between drain-order buckets or one unit either side of it, or else any point
    /// up to one past the last boundary. Boundaries are where an off-by-one in the drain order would show.
    function _nearEdge(uint256[] memory buckets, uint256 seed) private pure returns (uint256) {
        uint256 total = _sum(buckets);
        if (seed % 4 == 0) return bound(seed, 0, total + 1);
        uint256 edge;
        uint256 edgeIndex = (seed >> 2) % (buckets.length + 1);
        for (uint256 k; k < edgeIndex; ++k) {
            edge += buckets[k];
        }
        uint256 side = (seed >> 128) % 3;
        if (side == 0) return edge == 0 ? 0 : edge - 1;
        return edge + side - 1;
    }

    function _firstLegs(uint256[] memory raw, uint256 cap) private pure returns (uint256[] memory legs) {
        legs = new uint256[](raw.length < MAX_FUZZ_LEGS ? raw.length : MAX_FUZZ_LEGS);
        for (uint256 i; i < legs.length; ++i) {
            legs[i] = bound(raw[i], 0, cap);
        }
    }

    function _outflowBuckets(uint256 spend, uint256 unsortedUsdg, uint256[] memory pending)
        private
        pure
        returns (uint256[] memory buckets)
    {
        buckets = new uint256[](pending.length + 2);
        buckets[0] = spend;
        buckets[1] = unsortedUsdg;
        for (uint256 i; i < pending.length; ++i) {
            buckets[i + 2] = pending[i];
        }
    }

    function _ledgerBuckets(uint256 spend, uint256[] memory pending) private pure returns (uint256[] memory buckets) {
        buckets = new uint256[](pending.length + 1);
        buckets[0] = spend;
        for (uint256 i; i < pending.length; ++i) {
            buckets[i + 1] = pending[i];
        }
    }

    function _onesBasket(uint256 legCount) private pure returns (uint16[] memory weights) {
        weights = new uint16[](legCount);
        for (uint256 i; i < legCount; ++i) {
            weights[i] = 1;
        }
    }

    function _sum(uint256[] memory amounts) private pure returns (uint256 total) {
        for (uint256 i; i < amounts.length; ++i) {
            total += amounts[i];
        }
    }

    function _saturatingSum(uint256[] memory amounts) private pure returns (uint256 total) {
        for (uint256 i; i < amounts.length; ++i) {
            if (amounts[i] > MAX - total) return MAX;
            total += amounts[i];
        }
    }

    /// @dev Full 512-bit product, computed apart from the library's own math.
    function _mul512(uint256 a, uint256 b) private pure returns (uint256 high, uint256 low) {
        unchecked {
            low = a * b;
            uint256 productModMax = mulmod(a, b, MAX);
            high = productModMax - low - (productModMax < low ? 1 : 0);
        }
    }

    function _add512(uint256 aHigh, uint256 aLow, uint256 b) private pure returns (uint256 high, uint256 low) {
        unchecked {
            low = aLow + b;
            high = aHigh + (low < aLow ? 1 : 0);
        }
    }

    /// @dev a - b for 512-bit a and b. nonNegative is false when b > a, and the words are then meaningless.
    function _sub512(uint256 aHigh, uint256 aLow, uint256 bHigh, uint256 bLow)
        private
        pure
        returns (bool nonNegative, uint256 high, uint256 low)
    {
        nonNegative = aHigh > bHigh || (aHigh == bHigh && aLow >= bLow);
        unchecked {
            low = aLow - bLow;
            high = aHigh - bHigh - (aLow < bLow ? 1 : 0);
        }
    }

    function _weights(uint16 a) private pure returns (uint16[] memory weights) {
        weights = new uint16[](1);
        weights[0] = a;
    }

    function _weights(uint16 a, uint16 b) private pure returns (uint16[] memory weights) {
        weights = new uint16[](2);
        weights[0] = a;
        weights[1] = b;
    }

    function _weights(uint16 a, uint16 b, uint16 c) private pure returns (uint16[] memory weights) {
        weights = new uint16[](3);
        weights[0] = a;
        weights[1] = b;
        weights[2] = c;
    }

    function _amounts(uint256 a) private pure returns (uint256[] memory amounts) {
        amounts = new uint256[](1);
        amounts[0] = a;
    }

    function _amounts(uint256 a, uint256 b) private pure returns (uint256[] memory amounts) {
        amounts = new uint256[](2);
        amounts[0] = a;
        amounts[1] = b;
    }

    function _amounts(uint256 a, uint256 b, uint256 c) private pure returns (uint256[] memory amounts) {
        amounts = new uint256[](3);
        amounts[0] = a;
        amounts[1] = b;
        amounts[2] = c;
    }
}
