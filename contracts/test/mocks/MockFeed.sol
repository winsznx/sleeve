// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";

/// @notice A Chainlink feed proxy with open setters. Each round's startedAt equals its updatedAt and answeredInRound
/// equals its id. Before any round is set the latest round is round 0 with a zero answer.
contract MockFeed is IAggregatorV3 {
    struct Round {
        int256 answer;
        uint256 updatedAt;
        bool exists;
    }

    uint8 public decimals;
    string public description;
    uint80 public latestRound;
    mapping(uint80 roundId => Round) private _rounds;

    /// @notice getRoundData was asked for a round that was never set.
    error NoDataPresent(uint80 roundId);

    constructor(uint8 decimals_, string memory description_) {
        decimals = decimals_;
        description = description_;
    }

    function setDecimals(uint8 decimals_) external {
        decimals = decimals_;
    }

    /// @notice Records a round and makes it the latest.
    function setRound(uint80 roundId, int256 answer, uint256 updatedAt) external {
        _rounds[roundId] = Round({answer: answer, updatedAt: updatedAt, exists: true});
        latestRound = roundId;
    }

    /// @notice Changes the latest round's answer.
    function setAnswer(int256 answer) external {
        _rounds[latestRound].answer = answer;
    }

    /// @notice Changes the latest round's updatedAt.
    function setUpdatedAt(uint256 updatedAt) external {
        _rounds[latestRound].updatedAt = updatedAt;
    }

    function latestRoundData() external view returns (uint80, int256, uint256, uint256, uint80) {
        Round storage round = _rounds[latestRound];
        return (latestRound, round.answer, round.updatedAt, round.updatedAt, latestRound);
    }

    function getRoundData(uint80 roundId) external view returns (uint80, int256, uint256, uint256, uint80) {
        Round storage round = _rounds[roundId];
        if (!round.exists) revert NoDataPresent(roundId);
        return (roundId, round.answer, round.updatedAt, round.updatedAt, roundId);
    }
}
