// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @title IAggregatorV3
/// @notice The Chainlink feed proxy views Sleeve reads. Read the proxy only: the aggregators behind it are access
/// controlled. updatedAt is the transmit time and is what the age checks use. docs/research/chain-constants.md
/// section 4.
interface IAggregatorV3 {
    /// @notice 8 on every feed Sleeve uses. Selector 0x313ce567.
    function decimals() external view returns (uint8);

    /// @notice For example "RHSPY / USD". The format differs between feeds, so code never parses it. Selector
    /// 0x7284e416.
    function description() external view returns (string memory);

    /// @notice A past round, as the verifier re-reads it. Selector 0x9a6fc8f5.
    function getRoundData(uint80 roundId)
        external
        view
        returns (uint80 roundId_, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);

    /// @notice The latest round. Selector 0xfeaf968c.
    function latestRoundData()
        external
        view
        returns (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt, uint80 answeredInRound);
}
