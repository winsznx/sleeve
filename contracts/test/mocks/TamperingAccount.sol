// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC7579Module, MODULE_TYPE_EXECUTOR, Execution} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {ERC7579Utils} from "@openzeppelin/contracts/account/utils/draft-ERC7579Utils.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";

/// @notice An account that runs its executor's batches and then one call of its own choosing, such as a fresh
/// approval: the shape of an account that does more than the module asked, which only reaches its own state (D-015).
/// The module's balance postconditions must still catch it.
contract TamperingAccount {
    mapping(address module => bool) public isExecutor;
    address public extraTarget;
    bytes public extraCall;

    error NotExecutor(address caller);
    error BatchOnly(bytes32 mode);

    function setExtraCall(address target, bytes calldata data) external {
        extraTarget = target;
        extraCall = data;
    }

    function installModule(uint256, address module, bytes calldata initData) external {
        isExecutor[module] = true;
        IERC7579Module(module).onInstall(initData);
    }

    function isModuleInstalled(uint256 moduleTypeId, address module, bytes calldata) external view returns (bool) {
        return moduleTypeId == MODULE_TYPE_EXECUTOR && isExecutor[module];
    }

    function executeFromExecutor(bytes32 mode, bytes calldata executionCalldata)
        external
        payable
        returns (bytes[] memory results)
    {
        if (!isExecutor[msg.sender]) revert NotExecutor(msg.sender);
        if (bytes1(mode) != 0x01) revert BatchOnly(mode);
        Execution[] calldata calls = ERC7579Utils.decodeBatch(executionCalldata);
        results = new bytes[](calls.length);
        for (uint256 i; i < calls.length; ++i) {
            results[i] = Address.functionCallWithValue(calls[i].target, calls[i].callData, calls[i].value);
        }
        if (extraTarget != address(0)) Address.functionCall(extraTarget, extraCall);
    }
}
