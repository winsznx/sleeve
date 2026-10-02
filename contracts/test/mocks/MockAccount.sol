// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC7579Module, MODULE_TYPE_EXECUTOR} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {CallType, ERC7579Utils, ExecType, Mode} from "@openzeppelin/contracts/account/utils/draft-ERC7579Utils.sol";

/// @notice The smallest ERC-7579 account the module's unit tests need, behaving like Kernel v3.1 where it matters:
/// installModule lists the executor before it calls onInstall, uninstallModule ignores a failing onUninstall, and
/// execute runs single or batch calls in the default or try exec type. Its owner, the deploying test, stands in for
/// the root validator; the account may also call itself, as a batch does.
contract MockAccount {
    address public immutable owner;

    mapping(address module => bool) public isExecutor;

    /// @notice As Kernel's ModuleUninstallResult: whether onUninstall succeeded. The uninstall happens either way.
    event ModuleUninstallResult(address module, bool result);

    error NotOwnerOrSelf(address caller);
    error NotExecutor(address caller);
    error UnsupportedModuleType(uint256 moduleTypeId);

    modifier onlyOwnerOrSelf() {
        if (msg.sender != owner && msg.sender != address(this)) revert NotOwnerOrSelf(msg.sender);
        _;
    }

    constructor() {
        owner = msg.sender;
    }

    function installModule(uint256 moduleTypeId, address module, bytes calldata initData) external onlyOwnerOrSelf {
        if (moduleTypeId != MODULE_TYPE_EXECUTOR) revert UnsupportedModuleType(moduleTypeId);
        isExecutor[module] = true;
        IERC7579Module(module).onInstall(initData);
    }

    function uninstallModule(uint256 moduleTypeId, address module, bytes calldata deInitData) external onlyOwnerOrSelf {
        if (moduleTypeId != MODULE_TYPE_EXECUTOR) revert UnsupportedModuleType(moduleTypeId);
        isExecutor[module] = false;
        (bool result,) = module.call(abi.encodeCall(IERC7579Module.onUninstall, (deInitData)));
        emit ModuleUninstallResult(module, result);
    }

    function isModuleInstalled(uint256 moduleTypeId, address module, bytes calldata) external view returns (bool) {
        return moduleTypeId == MODULE_TYPE_EXECUTOR && isExecutor[module];
    }

    /// @notice ERC-7579 execute, as the owner's UserOps call it.
    function execute(bytes32 mode, bytes calldata executionCalldata) external payable onlyOwnerOrSelf {
        _execute(mode, executionCalldata);
    }

    /// @notice ERC-7579 executeFromExecutor, for an installed executor.
    function executeFromExecutor(bytes32 mode, bytes calldata executionCalldata)
        external
        payable
        returns (bytes[] memory)
    {
        if (!isExecutor[msg.sender]) revert NotExecutor(msg.sender);
        return _execute(mode, executionCalldata);
    }

    function _execute(bytes32 mode, bytes calldata executionCalldata) private returns (bytes[] memory) {
        (CallType callType, ExecType execType,,) = ERC7579Utils.decodeMode(Mode.wrap(mode));
        if (callType == ERC7579Utils.CALLTYPE_SINGLE) return ERC7579Utils.execSingle(executionCalldata, execType);
        if (callType == ERC7579Utils.CALLTYPE_BATCH) return ERC7579Utils.execBatch(executionCalldata, execType);
        revert ERC7579Utils.ERC7579UnsupportedCallType(callType);
    }
}
