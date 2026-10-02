// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {Chain4663} from "./Chain4663.sol";

/// @dev Returns the fork's block number, standing in for the ArbSys precompile, which forge's EVM does not run.
contract ArbSysMock {
    function arbBlockNumber() external view returns (uint256) {
        return block.number;
    }
}

abstract contract ForkBase is Test {
    /// Friday 2 October 2026 10:44 EDT, regular US session.
    uint256 internal constant IN_SESSION_BLOCK = 78_312_136;
    /// Saturday 26 September 2026 14:00 EDT, weekend closure.
    uint256 internal constant WEEKEND_BLOCK = 73_280_794;

    /// The public RPC keeps only minutes of state, so pinned forks need an archive endpoint.
    string internal constant DEFAULT_FORK_RPC = "https://robinhood.drpc.org";

    function _fork(uint256 blockNumber) internal returns (uint256 forkId) {
        forkId = vm.createSelectFork(vm.envOr("FORK_RPC", string(DEFAULT_FORK_RPC)), blockNumber);
        assertEq(block.chainid, 4663, "not chain 4663");
        vm.etch(Chain4663.ARB_SYS, address(new ArbSysMock()).code);
    }
}
