// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {PriceGuard} from "../../src/libraries/PriceGuard.sol";
import {PriceGuardHarness} from "../mocks/PriceGuardHarness.sol";

/// @notice PriceGuard's premium arithmetic: the exact pass or fail tests at equality and one unit either side, the
/// receipt figures and their rounding, every revert, and fuzzed agreement with the formulas written out with plain
/// uint256 arithmetic on inputs small enough not to overflow.
contract PriceGuardPremiumTest is Test {
    uint256 private constant MAX = type(uint256).max;
    uint8 private constant USDG = 6;
    uint8 private constant TOKEN = 18;
    uint8 private constant FEED = 8;
    /// @dev 10^(18 + 8 - 6) * 10,000 with the production decimals.
    uint256 private constant SCALE = 1e24;
    /// @dev 100.00000000 USD per token.
    int256 private constant HUNDRED = 100e8;
    uint16 private constant CAP = 100;

    PriceGuardHarness private guard;

    function setUp() public {
        guard = new PriceGuardHarness();
    }

    // exceedsPremium: buy fails when usdgSpent * 10^20 * 10,000 > tokensOut * answer * (10,000 + capBps)

    function test_exceedsPremium_atEquality_passes() public view {
        // 1 token at 100 USD with a 100 bps cap may cost up to exactly 101 USDG.
        assertFalse(_premium(101e6, 1e18, HUNDRED, CAP));
    }

    function test_exceedsPremium_oneUsdgUnitAboveEquality_fails() public view {
        assertTrue(_premium(101e6 + 1, 1e18, HUNDRED, CAP));
    }

    function test_exceedsPremium_oneUsdgUnitBelowEquality_passes() public view {
        assertFalse(_premium(101e6 - 1, 1e18, HUNDRED, CAP));
    }

    function test_exceedsPremium_oneTokenUnitEitherSideOfEquality() public view {
        assertTrue(_premium(101e6, 1e18 - 1, HUNDRED, CAP), "one token unit fewer fails");
        assertFalse(_premium(101e6, 1e18 + 1, HUNDRED, CAP), "one token unit more passes");
    }

    function test_exceedsPremium_oneAnswerUnitEitherSideOfEquality() public view {
        assertTrue(_premium(101e6, 1e18, HUNDRED - 1, CAP), "a lower feed price fails");
        assertFalse(_premium(101e6, 1e18, HUNDRED + 1, CAP), "a higher feed price passes");
    }

    function test_exceedsPremium_liveSpyNumbersAtEquality() public view {
        // SPY at 770.71210575: 400 tokens with a 100 bps cap may cost exactly 311,367.690723 USDG.
        int256 spy = 77_071_210_575;
        assertFalse(_premium(311_367_690_723, 400e18, spy, CAP));
        assertTrue(_premium(311_367_690_724, 400e18, spy, CAP));
    }

    function test_exceedsPremium_zeroCap_allowsOnlyTheFeedPrice() public view {
        assertFalse(_premium(100e6, 1e18, HUNDRED, 0));
        assertTrue(_premium(100e6 + 1, 1e18, HUNDRED, 0));
    }

    function test_exceedsPremium_zeroTokensOut_failsUnlessNothingWasSpent() public view {
        assertTrue(_premium(1, 0, HUNDRED, CAP));
        assertFalse(_premium(0, 0, HUNDRED, CAP));
    }

    function test_exceedsPremium_extremeInputs_neverOverflow() public view {
        assertFalse(_premium(MAX, MAX, type(int256).max, 10_000), "right side above 512 bits passes");
        assertTrue(_premium(MAX, 1, 1, 0), "512-bit left side against a tiny right side fails");
        assertFalse(_premium(0, MAX, type(int256).max, type(uint16).max), "nothing spent passes");
    }

    /// @dev tokens * answer * (10,000 + 6,384) is exactly 2^523, whose low 512 bits are zero: a wrapped product would
    /// make any spend look above the cap.
    function test_exceedsPremium_productAbove512Bits_doesNotWrap() public view {
        assertFalse(_premium(1, 2 ** 255, int256(2 ** 254), 6384));
        assertFalse(_premium(MAX, 2 ** 255, int256(2 ** 254), 6384));
    }

    /// @dev The high word of tokens * answer times 10,100 stays below 2^256, and only the carry out of the low word
    /// takes the whole product past 2^512. Dropping that carry would read a 256-bit product and fail the buy.
    function test_exceedsPremium_carryIntoTheTopWord_isCounted() public view {
        uint256 tokens =
            93_917_702_478_425_175_535_633_020_711_997_162_488_513_635_087_220_544_614_973_913_682_457_857_228_749;
        assertFalse(_premium(2 ** 200, tokens, int256(2 ** 243), CAP));
    }

    function test_exceedsPremium_nonPositiveAnswer_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(PriceGuard.AnswerNotPositive.selector, int256(0)));
        guard.exceedsPremium(1e6, 1e18, 0, CAP, USDG, TOKEN, FEED);
        vm.expectRevert(abi.encodeWithSelector(PriceGuard.AnswerNotPositive.selector, int256(-1)));
        guard.exceedsPremium(1e6, 1e18, -1, CAP, USDG, TOKEN, FEED);
    }

    // exceedsDiscount: sell fails when usdgOut * 10^20 * 10,000 < tokensIn * answer * (10,000 - capBps)

    function test_exceedsDiscount_atEquality_passes() public view {
        // 1 token at 100 USD with a 100 bps cap must bring at least exactly 99 USDG.
        assertFalse(_discount(99e6, 1e18, HUNDRED, CAP));
    }

    function test_exceedsDiscount_oneUsdgUnitBelowEquality_fails() public view {
        assertTrue(_discount(99e6 - 1, 1e18, HUNDRED, CAP));
    }

    function test_exceedsDiscount_oneUsdgUnitAboveEquality_passes() public view {
        assertFalse(_discount(99e6 + 1, 1e18, HUNDRED, CAP));
    }

    function test_exceedsDiscount_oneTokenUnitEitherSideOfEquality() public view {
        assertTrue(_discount(99e6, 1e18 + 1, HUNDRED, CAP), "one token unit more sold fails");
        assertFalse(_discount(99e6, 1e18 - 1, HUNDRED, CAP), "one token unit fewer sold passes");
    }

    function test_exceedsDiscount_fullCap_acceptsAnyProceeds() public view {
        assertFalse(_discount(0, MAX, type(int256).max, 10_000));
    }

    function test_exceedsDiscount_extremeInputs_neverOverflow() public view {
        assertTrue(_discount(MAX, MAX, type(int256).max, 0), "right side above 512 bits fails");
        assertFalse(_discount(MAX, 1, 1, 0), "512-bit proceeds pass");
        assertFalse(_discount(0, 0, 1, 0), "nothing sold passes");
    }

    /// @dev tokens * answer * (10,000 - 1,808) is exactly 2^522: a wrapped product would read zero and pass any sale.
    function test_exceedsDiscount_productAbove512Bits_doesNotWrap() public view {
        assertTrue(_discount(MAX, 2 ** 255, int256(2 ** 254), 1808));
        assertTrue(_discount(0, 2 ** 255, int256(2 ** 254), 1808));
    }

    /// @dev As test_exceedsPremium_carryIntoTheTopWord_isCounted, with the factor 9,900 of a 100 bps discount cap.
    function test_exceedsDiscount_carryIntoTheTopWord_isCounted() public view {
        uint256 tokens =
            95_815_029_801_221_643_728_272_071_635_471_852_639_796_738_826_356_313_193_054_194_766_951_955_354_582;
        assertTrue(_discount(2 ** 200, tokens, int256(2 ** 243), CAP));
    }

    function test_exceedsDiscount_capAboveTotal_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(PriceGuard.DiscountCapAboveTotal.selector, uint16(10_001)));
        guard.exceedsDiscount(99e6, 1e18, HUNDRED, 10_001, USDG, TOKEN, FEED);
    }

    function test_exceedsDiscount_nonPositiveAnswer_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(PriceGuard.AnswerNotPositive.selector, int256(-5)));
        guard.exceedsDiscount(99e6, 1e18, -5, CAP, USDG, TOKEN, FEED);
    }

    // Decimals

    function test_decimals_usdgAboveTokenPlusFeed_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(PriceGuard.UnsupportedDecimals.selector, uint8(9), uint8(0), uint8(8)));
        guard.exceedsPremium(1, 1, 1, CAP, 9, 0, 8);
    }

    function test_decimals_scaleExponentAboveMaximum_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(PriceGuard.UnsupportedDecimals.selector, uint8(0), uint8(37), uint8(37)));
        guard.exceedsDiscount(1, 1, 1, CAP, 0, 37, 37);
    }

    function test_decimals_largestScaleExponent_isExact() public view {
        // Exponent 73: usdg * 10^77 against tokens * answer * (10,000 + cap).
        assertFalse(guard.exceedsPremium(1, 10 ** 73, 1, 0, 0, 37, 36));
        assertTrue(guard.exceedsPremium(1, 10 ** 73 - 1, 1, 0, 0, 37, 36));
    }

    function test_decimals_otherScales_followTheSameFormula() public view {
        // A 6-decimal token: exponent 6 + 8 - 6 = 8, and one whole token at 100 USD with a 100 bps cap costs 101 USDG.
        assertFalse(guard.exceedsPremium(101e6, 1e6, HUNDRED, CAP, 6, 6, 8));
        assertTrue(guard.exceedsPremium(101e6 + 1, 1e6, HUNDRED, CAP, 6, 6, 8));
    }

    // Execution price: USDG base units per 1e18 token units

    function test_execPrice_exactDivision_isTheSameBothWays() public view {
        assertEq(guard.execPriceBuy(100e6, 1e18), 100e6);
        assertEq(guard.execPriceSell(100e6, 1e18), 100e6);
    }

    function test_execPrice_remainder_roundsUpForBuysAndDownForSells() public view {
        assertEq(guard.execPriceBuy(100e6, 3e17), 333_333_334);
        assertEq(guard.execPriceSell(100e6, 3e17), 333_333_333);
    }

    function test_execPrice_largestResults() public view {
        assertEq(guard.execPriceBuy(MAX, 1e18), MAX);
        assertEq(guard.execPriceSell(MAX, 1e18), MAX);
    }

    function test_execPrice_aboveUint256_reverts() public {
        vm.expectRevert(PriceGuard.PriceOutOfRange.selector);
        guard.execPriceBuy(MAX, 1e18 - 1);
        vm.expectRevert(PriceGuard.PriceOutOfRange.selector);
        guard.execPriceSell(MAX, 1e18 - 1);
    }

    function test_execPrice_roundingUpPastUint256_reverts() public {
        // floor(usdg * 1e18 / tokens) is type(uint256).max with a remainder, so only the buy price overflows.
        uint256 usdg =
            115_792_089_237_316_195_307_778_895_771_371_712_429_698_999_656_952_656_186_187_599_342_272_565_600_478;
        uint256 tokens = 1e18 - 1;
        assertEq(guard.execPriceSell(usdg, tokens), MAX);
        vm.expectRevert(PriceGuard.PriceOutOfRange.selector);
        guard.execPriceBuy(usdg, tokens);
    }

    function test_execPrice_zeroTokens_reverts() public {
        vm.expectRevert(PriceGuard.ZeroTokenAmount.selector);
        guard.execPriceBuy(1, 0);
        vm.expectRevert(PriceGuard.ZeroTokenAmount.selector);
        guard.execPriceSell(1, 0);
    }

    // Premium and discount in signed basis points, rounded up against the owner

    function test_premiumBps_wholeValues() public view {
        assertEq(guard.premiumBps(101e6, 1e18, HUNDRED, USDG, TOKEN, FEED), 100);
        assertEq(guard.premiumBps(100e6, 1e18, HUNDRED, USDG, TOKEN, FEED), 0);
        assertEq(guard.premiumBps(99e6, 1e18, HUNDRED, USDG, TOKEN, FEED), -100);
        assertEq(guard.premiumBps(0, 1e18, HUNDRED, USDG, TOKEN, FEED), -10_000);
    }

    function test_premiumBps_positiveFraction_roundsUp() public view {
        // Exact premium 100.0001 bps.
        assertEq(guard.premiumBps(101e6 + 1, 1e18, HUNDRED, USDG, TOKEN, FEED), 101);
        // Exact premium 0.0001 bps.
        assertEq(guard.premiumBps(100e6 + 1, 1e18, HUNDRED, USDG, TOKEN, FEED), 1);
    }

    function test_premiumBps_negativeFraction_roundsTowardZero() public view {
        // Exact premium -170.4 bps, then -0.0001 bps.
        assertEq(guard.premiumBps(98_296_000, 1e18, HUNDRED, USDG, TOKEN, FEED), -170);
        assertEq(guard.premiumBps(100e6 - 1, 1e18, HUNDRED, USDG, TOKEN, FEED), 0);
    }

    function test_discountBps_wholeValues() public view {
        assertEq(guard.discountBps(99e6, 1e18, HUNDRED, USDG, TOKEN, FEED), 100);
        assertEq(guard.discountBps(100e6, 1e18, HUNDRED, USDG, TOKEN, FEED), 0);
        assertEq(guard.discountBps(101e6, 1e18, HUNDRED, USDG, TOKEN, FEED), -100);
        assertEq(guard.discountBps(0, 1e18, HUNDRED, USDG, TOKEN, FEED), 10_000);
    }

    function test_discountBps_positiveFraction_roundsUp() public view {
        // Exact discount 100.0001 bps, then 0.0001 bps.
        assertEq(guard.discountBps(99e6 - 1, 1e18, HUNDRED, USDG, TOKEN, FEED), 101);
        assertEq(guard.discountBps(100e6 - 1, 1e18, HUNDRED, USDG, TOKEN, FEED), 1);
    }

    function test_discountBps_negativeFraction_roundsTowardZero() public view {
        // Exact discount -0.0001 bps.
        assertEq(guard.discountBps(100e6 + 1, 1e18, HUNDRED, USDG, TOKEN, FEED), 0);
    }

    function test_premiumAndDiscount_zeroTokens_revert() public {
        vm.expectRevert(PriceGuard.ZeroTokenAmount.selector);
        guard.premiumBps(1, 0, HUNDRED, USDG, TOKEN, FEED);
        vm.expectRevert(PriceGuard.ZeroTokenAmount.selector);
        guard.discountBps(1, 0, HUNDRED, USDG, TOKEN, FEED);
    }

    function test_premiumAndDiscount_nonPositiveAnswer_revert() public {
        vm.expectRevert(abi.encodeWithSelector(PriceGuard.AnswerNotPositive.selector, int256(0)));
        guard.premiumBps(1, 1, 0, USDG, TOKEN, FEED);
        vm.expectRevert(abi.encodeWithSelector(PriceGuard.AnswerNotPositive.selector, int256(-1)));
        guard.discountBps(1, 1, -1, USDG, TOKEN, FEED);
    }

    function test_premiumAndDiscount_tokensTimesAnswerAboveUint256_revert() public {
        vm.expectRevert(PriceGuard.PriceOutOfRange.selector);
        guard.premiumBps(1, 2 ** 128, int256(2 ** 128), USDG, TOKEN, FEED);
        vm.expectRevert(PriceGuard.PriceOutOfRange.selector);
        guard.discountBps(1, 2 ** 128, int256(2 ** 128), USDG, TOKEN, FEED);
    }

    function test_premiumAndDiscount_ratioAtInt256Max() public view {
        // Decimals 0, 0 and 0: the ratio is usdg * 10,000 / (tokens * answer).
        uint256 usdg = uint256(type(int256).max) / 10_000;
        assertEq(guard.premiumBps(usdg, 1, 1, 0, 0, 0), int256(usdg * 10_000) - 10_000);
        assertEq(guard.discountBps(usdg, 1, 1, 0, 0, 0), 10_000 - int256(usdg * 10_000));
    }

    function test_premiumAndDiscount_ratioAboveInt256Max_revert() public {
        uint256 usdg = uint256(type(int256).max) / 10_000 + 1;
        vm.expectRevert(PriceGuard.PriceOutOfRange.selector);
        guard.premiumBps(usdg, 1, 1, 0, 0, 0);
        vm.expectRevert(PriceGuard.PriceOutOfRange.selector);
        guard.discountBps(usdg, 1, 1, 0, 0, 0);
    }

    function test_premiumBps_roundingUpPastInt256Max_reverts() public {
        // floor(usdg * 10,000 / 304) is type(int256).max with a remainder: the discount rounds down and fits, the
        // premium rounds up past it.
        uint256 usdg =
            1_760_039_756_407_206_170_438_278_972_132_056_199_369_703_766_917_736_573_399_755_276_920_279_570_527;
        assertEq(guard.discountBps(usdg, 304, 1, 0, 0, 0), 10_000 - type(int256).max);
        vm.expectRevert(PriceGuard.PriceOutOfRange.selector);
        guard.premiumBps(usdg, 304, 1, 0, 0, 0);
    }

    // Fuzzed agreement with the formulas in plain uint256 arithmetic

    function testFuzz_exceedsPremium_matchesTheFormula(uint64 usdgSpent, uint64 tokensOut, uint64 answer, uint16 cap)
        public
        view
    {
        answer = uint64(bound(answer, 1, 2 ** 60));
        cap = uint16(bound(cap, 0, 10_000));
        bool expected = uint256(usdgSpent) * SCALE > uint256(tokensOut) * answer * (10_000 + uint256(cap));
        assertEq(_premium(usdgSpent, tokensOut, int256(uint256(answer)), cap), expected);
    }

    function testFuzz_exceedsDiscount_matchesTheFormula(uint64 usdgOut, uint64 tokensIn, uint64 answer, uint16 cap)
        public
        view
    {
        answer = uint64(bound(answer, 1, 2 ** 60));
        cap = uint16(bound(cap, 0, 10_000));
        bool expected = uint256(usdgOut) * SCALE < uint256(tokensIn) * answer * (10_000 - uint256(cap));
        assertEq(_discount(usdgOut, tokensIn, int256(uint256(answer)), cap), expected);
    }

    function testFuzz_receiptFigures_matchTheFormulas(uint64 usdgAmount, uint64 tokenAmount, uint64 answer)
        public
        view
    {
        tokenAmount = uint64(bound(tokenAmount, 1, type(uint64).max));
        answer = uint64(bound(answer, 1, 2 ** 60));
        uint256 numerator = uint256(usdgAmount) * SCALE;
        uint256 denominator = uint256(tokenAmount) * answer;
        int256 ratioUp = int256((numerator + denominator - 1) / denominator);
        int256 ratioDown = int256(numerator / denominator);
        int256 signedAnswer = int256(uint256(answer));
        assertEq(guard.premiumBps(usdgAmount, tokenAmount, signedAnswer, USDG, TOKEN, FEED), ratioUp - 10_000);
        assertEq(guard.discountBps(usdgAmount, tokenAmount, signedAnswer, USDG, TOKEN, FEED), 10_000 - ratioDown);
        uint256 priced = uint256(usdgAmount) * 1e18;
        assertEq(guard.execPriceBuy(usdgAmount, tokenAmount), (priced + tokenAmount - 1) / tokenAmount);
        assertEq(guard.execPriceSell(usdgAmount, tokenAmount), priced / tokenAmount);
    }

    /// @dev The receipt never shows a passing fill above its cap: premiumBps > cap exactly when exceedsPremium, and
    /// discountBps > cap exactly when exceedsDiscount.
    function testFuzz_roundedFigures_agreeWithTheExactTests(
        uint128 usdgAmount,
        uint128 tokenAmount,
        uint64 answer,
        uint16 cap
    ) public view {
        tokenAmount = uint128(bound(tokenAmount, 1, type(uint128).max));
        answer = uint64(bound(answer, 1, type(uint64).max));
        cap = uint16(bound(cap, 0, 10_000));
        int256 signedAnswer = int256(uint256(answer));
        int256 premium = guard.premiumBps(usdgAmount, tokenAmount, signedAnswer, USDG, TOKEN, FEED);
        int256 discount = guard.discountBps(usdgAmount, tokenAmount, signedAnswer, USDG, TOKEN, FEED);
        assertEq(premium > int256(uint256(cap)), _premium(usdgAmount, tokenAmount, signedAnswer, cap));
        assertEq(discount > int256(uint256(cap)), _discount(usdgAmount, tokenAmount, signedAnswer, cap));
    }

    function _premium(uint256 usdgSpent, uint256 tokensOut, int256 answer, uint16 cap) private view returns (bool) {
        return guard.exceedsPremium(usdgSpent, tokensOut, answer, cap, USDG, TOKEN, FEED);
    }

    function _discount(uint256 usdgOut, uint256 tokensIn, int256 answer, uint16 cap) private view returns (bool) {
        return guard.exceedsDiscount(usdgOut, tokensIn, answer, cap, USDG, TOKEN, FEED);
    }
}
