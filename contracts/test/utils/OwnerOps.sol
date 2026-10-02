// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    Execution,
    IERC7579Execution,
    IERC7579ModuleConfig,
    MODULE_TYPE_EXECUTOR
} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {
    ERC7579Utils,
    Mode,
    ModePayload,
    ModeSelector
} from "@openzeppelin/contracts/account/utils/draft-ERC7579Utils.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";

/// @title OwnerOps
/// @notice The owner-op builder. Every owner batch in the tests goes through it, as every owner UserOp the app sends
/// goes through the app's builder (PRD I14). It puts beginOwnerOp first and endOwnerOp last around the owner's calls,
/// in one ERC-7579 batch for execute(bytes32,bytes) with the default exec type, so any failing call reverts the whole
/// batch and no bracket is left open.
/// @dev The one owner op it does not build is the install: beginOwnerOp needs the module installed, and the install
/// snapshot books the balance instead (I5). A call list that already holds beginOwnerOp or endOwnerOp for the module
/// is refused, so a built op has exactly one bracket. The uninstall is bracketed like any other op: endOwnerOp
/// tolerates an account that uninstalled inside its bracket.
library OwnerOps {
    /// @notice The owner's call list already holds a bracket call for the module.
    /// @param index Position of that call in the list.
    error NestedBracketCall(uint256 index);

    /// @notice The owner's calls with beginOwnerOp prepended and endOwnerOp appended.
    function bracket(address module, Execution[] memory calls) internal pure returns (Execution[] memory bracketed) {
        bracketed = new Execution[](calls.length + 2);
        bracketed[0] = Execution(module, 0, abi.encodeCall(ISleeveModule.beginOwnerOp, ()));
        for (uint256 i; i < calls.length; ++i) {
            if (isBracketCall(module, calls[i])) revert NestedBracketCall(i);
            bracketed[i + 1] = calls[i];
        }
        bracketed[calls.length + 1] = Execution(module, 0, abi.encodeCall(ISleeveModule.endOwnerOp, ()));
    }

    /// @notice The account's execute calldata for the bracketed batch, the callData of an owner UserOp.
    function callData(address module, Execution[] memory calls) internal pure returns (bytes memory) {
        return
            abi.encodeCall(IERC7579Execution.execute, (batchMode(), ERC7579Utils.encodeBatch(bracket(module, calls))));
    }

    /// @notice One owner call, bracketed.
    function single(address module, address target, bytes memory data) internal pure returns (bytes memory) {
        Execution[] memory calls = new Execution[](1);
        calls[0] = Execution(target, 0, data);
        return callData(module, calls);
    }

    function setRule(address module, ISleeveModule.RuleInput memory rule) internal pure returns (bytes memory) {
        return single(module, module, abi.encodeCall(ISleeveModule.setRule, (rule)));
    }

    function pauseRule(address module) internal pure returns (bytes memory) {
        return single(module, module, abi.encodeCall(ISleeveModule.pauseRule, ()));
    }

    function resumeRule(address module) internal pure returns (bytes memory) {
        return single(module, module, abi.encodeCall(ISleeveModule.resumeRule, ()));
    }

    function setKeeper(address module, address keeper) internal pure returns (bytes memory) {
        return single(module, module, abi.encodeCall(ISleeveModule.setKeeper, (keeper)));
    }

    function transferUsdg(address module, IERC20 usdg, address to, uint256 amount)
        internal
        pure
        returns (bytes memory)
    {
        return single(module, address(usdg), abi.encodeCall(IERC20.transfer, (to, amount)));
    }

    /// @notice The account uninstalls the module from itself inside the bracket.
    function uninstall(address module, address account) internal pure returns (bytes memory) {
        return single(
            module, account, abi.encodeCall(IERC7579ModuleConfig.uninstallModule, (MODULE_TYPE_EXECUTOR, module, ""))
        );
    }

    /// @notice Batch call type, default exec type: the mode every built op uses.
    function batchMode() internal pure returns (bytes32) {
        return Mode.unwrap(
            ERC7579Utils.encodeMode(
                ERC7579Utils.CALLTYPE_BATCH, ERC7579Utils.EXECTYPE_DEFAULT, ModeSelector.wrap(0), ModePayload.wrap(0)
            )
        );
    }

    /// @notice Whether a call is beginOwnerOp or endOwnerOp on the module.
    function isBracketCall(address module, Execution memory call) internal pure returns (bool) {
        if (call.target != module || call.callData.length < 4) return false;
        bytes4 selector = bytes4(call.callData);
        return selector == ISleeveModule.beginOwnerOp.selector || selector == ISleeveModule.endOwnerOp.selector;
    }
}
