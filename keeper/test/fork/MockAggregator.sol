// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice Stands in for a Chainlink feed proxy on the anvil fork, so a test can post a fresh round. The test puts this
/// runtime code at the feed's address with anvil_setCode and writes the round into slots 0 to 3 with
/// anvil_setStorageAt. Regenerate the hex in mock-aggregator.ts with:
///   solc --optimize --metadata-hash none --bin-runtime keeper/test/fork/MockAggregator.sol
contract MockAggregator {
    uint80 internal roundId;
    int256 internal answer;
    uint256 internal startedAt;
    uint256 internal updatedAt;

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, startedAt, updatedAt, roundId);
    }

    function getRoundData(uint80) external view returns (uint80, int256, uint256, uint256, uint80) {
        return (roundId, answer, startedAt, updatedAt, roundId);
    }
}
