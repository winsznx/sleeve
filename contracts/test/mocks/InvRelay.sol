// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";

/// @notice A third-party contract an owner batch can call, which then triggers a split as itself. The module must
/// refuse it while the account's bracket is open (D-019), or the split could sort USDG the batch is still moving.
contract InvRelay {
    function split(ISleeveModule module, address account, address pool, uint256 quote) external returns (uint256) {
        return module.split(account, pool, quote);
    }
}
