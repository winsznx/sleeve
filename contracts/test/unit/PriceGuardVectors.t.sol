// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {PriceGuard} from "../../src/libraries/PriceGuard.sol";

/// @notice Replays contracts/test/fixtures/premium_vectors.json, written by scripts/premium_vectors.py from Python
/// integers and fractions, against PriceGuard. The verifier and the HP2 replay check the same file, so a vector that
/// passes here means all three compute the same bit for every fill and the same figure for every receipt.
contract PriceGuardVectorsTest is Test {
    string private constant FIXTURE = "/test/fixtures/premium_vectors.json";
    uint256 private constant MIN_VECTORS = 300;

    struct Decisions {
        string[] label;
        uint256[] usdg;
        uint256[] tokens;
        int256[] answer;
        uint256[] capBps;
        uint256[] usdgDecimals;
        uint256[] tokenDecimals;
        uint256[] feedDecimals;
        bool[] exceedsPremium;
        bool[] exceedsDiscount;
    }

    struct Receipts {
        string[] label;
        uint256[] usdg;
        uint256[] tokens;
        int256[] answer;
        uint256[] usdgDecimals;
        uint256[] tokenDecimals;
        uint256[] feedDecimals;
        uint256[] execPriceBuy;
        uint256[] execPriceSell;
        int256[] premiumBps;
        int256[] discountBps;
    }

    function test_vectors_fixtureComesFromTheScript() public view {
        string memory json = _fixture();
        assertEq(vm.parseJsonString(json, ".generator"), "scripts/premium_vectors.py");
    }

    function test_vectors_decisionsMatchTheOracle() public view {
        string memory json = _fixture();
        Decisions memory d = _loadDecisions(json);
        uint256 count = d.label.length;
        assertGe(count, MIN_VECTORS, "decision vectors");
        assertEq(count, vm.parseJsonUint(json, ".counts.decisions"), "count");
        for (uint256 i; i < count; ++i) {
            _checkDecision(d, i);
        }
    }

    function test_vectors_receiptFiguresMatchTheOracle() public view {
        string memory json = _fixture();
        Receipts memory r = _loadReceipts(json);
        uint256 count = r.label.length;
        assertGe(count, MIN_VECTORS, "receipt vectors");
        assertEq(count, vm.parseJsonUint(json, ".counts.receipts"), "count");
        for (uint256 i; i < count; ++i) {
            _checkReceipt(r, i);
        }
    }

    function _checkDecision(Decisions memory d, uint256 i) private pure {
        uint16 cap = SafeCast.toUint16(d.capBps[i]);
        uint8 usdgDecimals = SafeCast.toUint8(d.usdgDecimals[i]);
        uint8 tokenDecimals = SafeCast.toUint8(d.tokenDecimals[i]);
        uint8 feedDecimals = SafeCast.toUint8(d.feedDecimals[i]);
        assertEq(
            PriceGuard.exceedsPremium(
                d.usdg[i], d.tokens[i], d.answer[i], cap, usdgDecimals, tokenDecimals, feedDecimals
            ),
            d.exceedsPremium[i],
            string.concat("exceedsPremium: ", d.label[i])
        );
        assertEq(
            PriceGuard.exceedsDiscount(
                d.usdg[i], d.tokens[i], d.answer[i], cap, usdgDecimals, tokenDecimals, feedDecimals
            ),
            d.exceedsDiscount[i],
            string.concat("exceedsDiscount: ", d.label[i])
        );
    }

    function _checkReceipt(Receipts memory r, uint256 i) private pure {
        uint8 usdgDecimals = SafeCast.toUint8(r.usdgDecimals[i]);
        uint8 tokenDecimals = SafeCast.toUint8(r.tokenDecimals[i]);
        uint8 feedDecimals = SafeCast.toUint8(r.feedDecimals[i]);
        assertEq(
            PriceGuard.execPriceBuy(r.usdg[i], r.tokens[i]),
            r.execPriceBuy[i],
            string.concat("execPriceBuy: ", r.label[i])
        );
        assertEq(
            PriceGuard.execPriceSell(r.usdg[i], r.tokens[i]),
            r.execPriceSell[i],
            string.concat("execPriceSell: ", r.label[i])
        );
        assertEq(
            PriceGuard.premiumBps(r.usdg[i], r.tokens[i], r.answer[i], usdgDecimals, tokenDecimals, feedDecimals),
            r.premiumBps[i],
            string.concat("premiumBps: ", r.label[i])
        );
        assertEq(
            PriceGuard.discountBps(r.usdg[i], r.tokens[i], r.answer[i], usdgDecimals, tokenDecimals, feedDecimals),
            r.discountBps[i],
            string.concat("discountBps: ", r.label[i])
        );
    }

    function _fixture() private view returns (string memory) {
        return vm.readFile(string.concat(vm.projectRoot(), FIXTURE));
    }

    function _loadDecisions(string memory json) private pure returns (Decisions memory d) {
        d.label = vm.parseJsonStringArray(json, ".decisions.label");
        d.usdg = vm.parseJsonUintArray(json, ".decisions.usdg");
        d.tokens = vm.parseJsonUintArray(json, ".decisions.tokens");
        d.answer = vm.parseJsonIntArray(json, ".decisions.answer");
        d.capBps = vm.parseJsonUintArray(json, ".decisions.capBps");
        d.usdgDecimals = vm.parseJsonUintArray(json, ".decisions.usdgDecimals");
        d.tokenDecimals = vm.parseJsonUintArray(json, ".decisions.tokenDecimals");
        d.feedDecimals = vm.parseJsonUintArray(json, ".decisions.feedDecimals");
        d.exceedsPremium = vm.parseJsonBoolArray(json, ".decisions.exceedsPremium");
        d.exceedsDiscount = vm.parseJsonBoolArray(json, ".decisions.exceedsDiscount");
        uint256 count = d.label.length;
        assertEq(d.usdg.length, count, "usdg length");
        assertEq(d.tokens.length, count, "tokens length");
        assertEq(d.answer.length, count, "answer length");
        assertEq(d.capBps.length, count, "capBps length");
        assertEq(d.usdgDecimals.length, count, "usdgDecimals length");
        assertEq(d.tokenDecimals.length, count, "tokenDecimals length");
        assertEq(d.feedDecimals.length, count, "feedDecimals length");
        assertEq(d.exceedsPremium.length, count, "exceedsPremium length");
        assertEq(d.exceedsDiscount.length, count, "exceedsDiscount length");
    }

    function _loadReceipts(string memory json) private pure returns (Receipts memory r) {
        r.label = vm.parseJsonStringArray(json, ".receipts.label");
        r.usdg = vm.parseJsonUintArray(json, ".receipts.usdg");
        r.tokens = vm.parseJsonUintArray(json, ".receipts.tokens");
        r.answer = vm.parseJsonIntArray(json, ".receipts.answer");
        r.usdgDecimals = vm.parseJsonUintArray(json, ".receipts.usdgDecimals");
        r.tokenDecimals = vm.parseJsonUintArray(json, ".receipts.tokenDecimals");
        r.feedDecimals = vm.parseJsonUintArray(json, ".receipts.feedDecimals");
        r.execPriceBuy = vm.parseJsonUintArray(json, ".receipts.execPriceBuy");
        r.execPriceSell = vm.parseJsonUintArray(json, ".receipts.execPriceSell");
        r.premiumBps = vm.parseJsonIntArray(json, ".receipts.premiumBps");
        r.discountBps = vm.parseJsonIntArray(json, ".receipts.discountBps");
        uint256 count = r.label.length;
        assertEq(r.usdg.length, count, "usdg length");
        assertEq(r.tokens.length, count, "tokens length");
        assertEq(r.answer.length, count, "answer length");
        assertEq(r.usdgDecimals.length, count, "usdgDecimals length");
        assertEq(r.tokenDecimals.length, count, "tokenDecimals length");
        assertEq(r.feedDecimals.length, count, "feedDecimals length");
        assertEq(r.execPriceBuy.length, count, "execPriceBuy length");
        assertEq(r.execPriceSell.length, count, "execPriceSell length");
        assertEq(r.premiumBps.length, count, "premiumBps length");
        assertEq(r.discountBps.length, count, "discountBps length");
    }
}
