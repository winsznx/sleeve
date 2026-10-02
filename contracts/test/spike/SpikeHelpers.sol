// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeERC20} from "@openzeppelin/contracts/token/ERC20/utils/SafeERC20.sol";
import {Address} from "@openzeppelin/contracts/utils/Address.sol";
import {
    IERC7579Module,
    IERC7579ModuleConfig,
    MODULE_TYPE_EXECUTOR
} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {SpikeModule} from "./SpikeModule.sol";

/// @notice Pays USDG to whoever calls it. Stands in for a payer whose transfer lands inside an owner batch.
contract InflowHelper {
    using SafeERC20 for IERC20;

    IERC20 public immutable usdg;

    constructor(IERC20 usdg_) {
        usdg = usdg_;
    }

    function payCaller(uint256 amount) external {
        usdg.safeTransfer(msg.sender, amount);
    }
}

/// @notice A contract that is not the account. Forwards a call and bubbles any revert.
contract ForeignCaller {
    function forward(address target, bytes calldata data) external returns (bytes memory) {
        return Address.functionCall(target, data);
    }
}

/// @notice Raw TSTORE and TLOAD, for G6 item h.
contract TransientProbe {
    function roundTrip(bytes32 slot, uint256 value) external returns (uint256 loaded) {
        assembly ("memory-safe") {
            tstore(slot, value)
            loaded := tload(slot)
        }
    }

    /// Stores in one call frame and loads in another, inside a single transaction.
    function storeThenLoadAcrossCalls(bytes32 slot, uint256 value) external returns (uint256) {
        this.store(slot, value);
        return this.load(slot);
    }

    function store(bytes32 slot, uint256 value) external {
        assembly ("memory-safe") {
            tstore(slot, value)
        }
    }

    function load(bytes32 slot) external view returns (uint256 value) {
        assembly ("memory-safe") {
            value := tload(slot)
        }
    }
}

/// @notice Executor whose onUninstall always reverts, to show that Kernel v3.1 uninstalls it anyway.
contract StubbornExecutor is IERC7579Module {
    mapping(address account => bool) public installed;

    error UninstallRefused();

    function onInstall(bytes calldata) external {
        installed[msg.sender] = true;
    }

    function onUninstall(bytes calldata) external pure {
        revert UninstallRefused();
    }

    function isModuleType(uint256 moduleTypeId) external pure returns (bool) {
        return moduleTypeId == MODULE_TYPE_EXECUTOR;
    }
}

/// @notice Executor whose onUninstall loops until it runs out of gas, standing in for release work that does not fit
/// in the gas it is given.
contract GasBurningExecutor is IERC7579Module {
    mapping(address account => uint256) public work;

    function onInstall(bytes calldata) external {
        work[msg.sender] = 1;
    }

    function onUninstall(bytes calldata) external {
        while (true) {
            ++work[msg.sender];
        }
    }

    function isModuleType(uint256 moduleTypeId) external pure returns (bool) {
        return moduleTypeId == MODULE_TYPE_EXECUTOR;
    }
}

/// @notice Records whether the account already lists this executor as installed while onInstall runs.
contract InstallOrderProbe is IERC7579Module {
    mapping(address account => bool) public listedDuringOnInstall;

    function onInstall(bytes calldata) external {
        listedDuringOnInstall[msg.sender] =
            IERC7579ModuleConfig(msg.sender).isModuleInstalled(MODULE_TYPE_EXECUTOR, address(this), "");
    }

    function onUninstall(bytes calldata) external pure {}

    function isModuleType(uint256 moduleTypeId) external pure returns (bool) {
        return moduleTypeId == MODULE_TYPE_EXECUTOR;
    }
}

/// @notice Not an account. Calls SpikeModule.onInstall for itself, then brackets an inflow of its own.
contract SelfRegisteredCaller {
    /// One call, so the bracket also holds under forge test --isolate.
    function registerAndBracketInflow(SpikeModule module, InflowHelper payer, uint256 amount) external {
        module.onInstall(abi.encode(address(this)));
        module.beginOwnerOp();
        payer.payCaller(amount);
        module.endOwnerOp();
    }
}
