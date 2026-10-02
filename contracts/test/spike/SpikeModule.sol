// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {SlotDerivation} from "@openzeppelin/contracts/utils/SlotDerivation.sol";
import {TransientSlot} from "@openzeppelin/contracts/utils/TransientSlot.sol";
import {
    IERC7579Module,
    IERC7579Execution,
    MODULE_TYPE_EXECUTOR
} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {
    ERC7579Utils,
    Mode,
    ModeSelector,
    ModePayload
} from "@openzeppelin/contracts/account/utils/draft-ERC7579Utils.sol";

/// @title SpikeModule
/// @notice G6 spike executor, ERC-7579 module type 2. Keeps a USDG spend ledger per account and moves it by the
/// balance change between beginOwnerOp and endOwnerOp, the owner-batch brackets of PRD section 7.2.
/// @dev Test code. It carries none of SleeveModule's rules, LedgerMath ordering or guards. Written against
/// OpenZeppelin's ERC-7579 types so the encoding is account-agnostic, then run on deployed Kernel v3.1.
contract SpikeModule is IERC7579Module {
    using SafeCast for uint256;
    using SlotDerivation for bytes32;
    using TransientSlot for bytes32;
    using TransientSlot for TransientSlot.Uint256Slot;

    /// Per-account transient slot = keccak256(abi.encode(account, _BRACKET_BASE)). It holds the USDG balance
    /// at beginOwnerOp plus one, so zero means no bracket is open.
    bytes32 private constant _BRACKET_BASE = keccak256("sleeve.spike.bracket");

    IERC20 public immutable usdg;

    /// Signed so the spike records any bracket delta exactly. Floors and outflow ordering belong to LedgerMath.
    mapping(address account => int256) public spendLedger;
    /// The only caller allowed to trigger pushUsdg for the account, chosen by the account at install.
    mapping(address account => address) public operatorOf;
    mapping(address account => bool) private _installed;

    event OwnerOpBegun(address indexed account, uint256 balance);
    event OwnerOpEnded(address indexed account, int256 delta, int256 spendLedger);

    error AlreadyInstalled(address account);
    error NotInstalled(address caller);
    error BracketAlreadyOpen(address account);
    error NoOpenBracket(address account);
    error NotOperator(address caller);

    /// @dev Keyed by msg.sender, so any contract that called onInstall for itself passes, account or not. What it
    /// guarantees is that a caller reaches only its own state (test_recipe_selfRegisteredCallerOnlyReachesItsOwnState).
    modifier onlyInstalledAccount() {
        if (!_installed[msg.sender]) revert NotInstalled(msg.sender);
        _;
    }

    constructor(IERC20 usdg_) {
        usdg = usdg_;
    }

    /// @notice Registers the caller, stores its operator and snapshots its USDG balance into its spend ledger.
    /// Reverts AlreadyInstalled if the caller is registered.
    /// @param data abi.encode(address operator)
    function onInstall(bytes calldata data) external {
        if (_installed[msg.sender]) revert AlreadyInstalled(msg.sender);
        _installed[msg.sender] = true;
        operatorOf[msg.sender] = abi.decode(data, (address));
        // Install snapshot, PRD section 7.1: USDG already in the account is spend and is never split.
        spendLedger[msg.sender] = usdg.balanceOf(msg.sender).toInt256();
    }

    /// @notice Deletes the caller's registration, operator and ledger.
    /// @dev Kernel v3.1 ignores a revert here and uninstalls anyway (g6-notes section 7).
    function onUninstall(bytes calldata) external onlyInstalledAccount {
        delete _installed[msg.sender];
        delete operatorOf[msg.sender];
        delete spendLedger[msg.sender];
    }

    /// @notice True for module type 2, executor, only.
    function isModuleType(uint256 moduleTypeId) external pure returns (bool) {
        return moduleTypeId == MODULE_TYPE_EXECUTOR;
    }

    /// @notice Whether `account` called onInstall and has not called onUninstall since.
    function isInitialized(address account) external view returns (bool) {
        return _installed[account];
    }

    /// @notice Opens the caller's bracket for the rest of the transaction by storing its USDG balance plus one.
    /// Reverts BracketAlreadyOpen if the caller already opened one in this transaction.
    function beginOwnerOp() external onlyInstalledAccount {
        TransientSlot.Uint256Slot slot = _bracketSlot(msg.sender);
        if (slot.tload() != 0) revert BracketAlreadyOpen(msg.sender);
        uint256 balance = usdg.balanceOf(msg.sender);
        slot.tstore(balance + 1);
        emit OwnerOpBegun(msg.sender, balance);
    }

    /// @notice Closes the caller's bracket and moves its spend ledger by the USDG balance change since beginOwnerOp,
    /// up or down. Reverts NoOpenBracket if no bracket is open in this transaction.
    function endOwnerOp() external onlyInstalledAccount {
        TransientSlot.Uint256Slot slot = _bracketSlot(msg.sender);
        uint256 stored = slot.tload();
        if (stored == 0) revert NoOpenBracket(msg.sender);
        slot.tstore(0);
        int256 delta = usdg.balanceOf(msg.sender).toInt256() - (stored - 1).toInt256();
        int256 ledger = spendLedger[msg.sender] + delta;
        spendLedger[msg.sender] = ledger;
        emit OwnerOpEnded(msg.sender, delta, ledger);
    }

    /// @notice Whether `account` has an open bracket in the current transaction.
    function bracketOpen(address account) external view returns (bool) {
        return _bracketSlot(account).tload() != 0;
    }

    /// @notice Moves USDG out of the account through executeFromExecutor with a single call and the default exec
    /// type. G6 item g only: it leaves the ledger alone.
    function pushUsdg(address account, address to, uint256 amount) external returns (bytes[] memory returnData) {
        if (msg.sender != operatorOf[account]) revert NotOperator(msg.sender);
        Mode mode = ERC7579Utils.encodeMode(
            ERC7579Utils.CALLTYPE_SINGLE, ERC7579Utils.EXECTYPE_DEFAULT, ModeSelector.wrap(0), ModePayload.wrap(0)
        );
        bytes memory execution =
            abi.encodePacked(address(usdg), uint256(0), abi.encodeCall(IERC20.transfer, (to, amount)));
        returnData = IERC7579Execution(account).executeFromExecutor(Mode.unwrap(mode), execution);
    }

    function _bracketSlot(address account) private pure returns (TransientSlot.Uint256Slot) {
        return _BRACKET_BASE.deriveMapping(account).asUint256();
    }
}
