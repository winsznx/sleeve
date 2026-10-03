// SPDX-License-Identifier: MIT
pragma solidity 0.8.28;

/// @notice A stand-in for a Chainlink feed proxy, put over the real proxy's code with anvil_setCode in the verifier's
/// fork test, so a round can sit after a market reopen that the fork's frozen feeds never reach. Decimals live in
/// code, so the storage the real proxy leaves behind cannot change them. A round that was never set reverts, as a
/// proxy does for missing data.
/// @dev Rebuild with: solc --optimize --evm-version cancun --bin-runtime MockAggregator.sol, then paste the runtime
/// into mock-aggregator.ts. solc 0.8.28.
contract MockAggregator {
    struct Round {
        int256 answer;
        uint256 startedAt;
        uint256 updatedAt;
    }

    uint256 public latestRound;
    mapping(uint256 roundId => Round) private rounds;

    function decimals() external pure returns (uint8) {
        return 8;
    }

    function description() external pure returns (string memory) {
        return "Sleeve verifier fork test feed";
    }

    function version() external pure returns (uint256) {
        return 6;
    }

    /// @notice Records a round and makes it the latest.
    function setRound(uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt) external {
        rounds[roundId] = Round(answer, startedAt, updatedAt);
        latestRound = roundId;
    }

    /// @notice Rewrites a round without moving the latest one.
    function editRound(uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt) external {
        rounds[roundId] = Round(answer, startedAt, updatedAt);
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        uint80 roundId = uint80(latestRound);
        Round storage round = rounds[roundId];
        return (roundId, round.answer, round.startedAt, round.updatedAt, roundId);
    }

    function getRoundData(uint80 roundId) external view returns (uint80, int256, uint256, uint256, uint80) {
        Round storage round = rounds[roundId];
        require(round.updatedAt != 0, "No data present");
        return (roundId, round.answer, round.startedAt, round.updatedAt, roundId);
    }
}
