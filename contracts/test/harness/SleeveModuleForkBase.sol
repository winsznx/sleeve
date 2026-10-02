// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {TimelockController} from "@openzeppelin/contracts/governance/TimelockController.sol";
import {SessionCalendarExtension} from "../../src/SessionCalendarExtension.sol";
import {SleeveModule} from "../../src/SleeveModule.sol";
import {TokenSource} from "../../src/TokenSource.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {ISwapRouter02} from "../../src/interfaces/ISwapRouter02.sol";
import {PriceGuard} from "../../src/libraries/PriceGuard.sol";
import {LaunchConfig} from "../mocks/LaunchConfig.sol";
import {UsdgPayer} from "../mocks/UsdgPayer.sol";
import {Chain4663} from "../utils/Chain4663.sol";
import {KernelHelpers} from "../utils/KernelHelpers.sol";
import {SleeveModuleHarness} from "./SleeveModuleHarness.sol";

/// @notice The module on chain 4663 forked at IN_SESSION_BLOCK: real USDG, the launch TokenSource on the real tokens,
/// feeds and pools behind a TimelockController with the SPEC configuration, a fresh SessionCalendarExtension, and
/// accounts on the deployed Kernel v3.1 stack. Owner ops go through handleOps and are never pranked.
abstract contract SleeveModuleForkBase is KernelHelpers {
    IERC20 internal constant USDG = IERC20(Chain4663.USDG);
    /// @dev D-014 disclosure candidate 3.
    bytes32 internal constant DISCLOSURE_HASH = 0x8408c7a59df30d1b5dbec102c388048f2bf8bba21a2e91ac0806df7d68068e89;
    uint256 internal constant GRACE = 3_600;
    uint256 internal constant TIMELOCK_DELAY = 172_800;
    uint8 internal constant SPY = 0;
    uint8 internal constant QQQ = 1;
    uint8 internal constant NVDA = 2;
    uint8 internal constant AAPL = 3;

    TimelockController internal timelock;
    TokenSource internal tokenSource;
    SessionCalendarExtension internal calendar;
    /// @dev Stands in for DEPLOYER: the timelock's proposer, executor and canceller.
    address internal deployer = makeAddr("deployer");
    address internal keeper = makeAddr("keeper");
    address internal stranger = makeAddr("stranger");
    address internal recipient = makeAddr("recipient");
    address internal owner;
    uint256 internal ownerKey;

    function _setUpFork() internal {
        _fork(IN_SESSION_BLOCK);
        (owner, ownerKey) = makeAddrAndKey("owner");
        address[] memory roles = new address[](1);
        roles[0] = deployer;
        timelock = new TimelockController(TIMELOCK_DELAY, roles, roles, address(0));
        tokenSource =
            new TokenSource(address(timelock), Chain4663.USDG, Chain4663.V3_FACTORY, LaunchConfig.tickerInits());
        calendar = new SessionCalendarExtension(address(timelock));
        vm.label(address(ENTRY_POINT), "EntryPointV07");
        vm.label(address(KERNEL_FACTORY), "KernelFactoryV31");
        vm.label(address(META_FACTORY), "FactoryStaker");
        vm.label(Chain4663.USDG, "USDG");
    }

    function _config() internal view returns (ISleeveModule.ModuleConfig memory) {
        return ISleeveModule.ModuleConfig({
            usdg: USDG,
            tokenSource: tokenSource,
            calendar: calendar,
            swapRouter: ISwapRouter02(Chain4663.SWAP_ROUTER_02),
            usdgUsdFeed: IAggregatorV3(Chain4663.USDG_USD_FEED),
            defaultKeeper: keeper,
            disclosureHash: DISCLOSURE_HASH,
            guardParams: PriceGuard.defaultGuardParams(),
            grace: GRACE
        });
    }

    function _deployModule() internal returns (SleeveModule module) {
        module = new SleeveModule(_config());
        vm.label(address(module), "SleeveModule");
    }

    function _deployHarness() internal returns (SleeveModuleHarness harness) {
        harness = new SleeveModuleHarness(_config());
        vm.label(address(harness), "SleeveModuleHarness");
    }

    /// @notice The product default: 10 percent to SPY, 100 bps premium cap, 50 bps slippage, 25 USDG clip.
    function _defaultRule() internal pure returns (ISleeveModule.RuleInput memory) {
        return ISleeveModule.RuleInput({
            spendBps: 9_000, equityBps: 1_000, tickerId: SPY, premiumCapBps: 100, slippageBps: 50, minClip: 25e6
        });
    }

    function _installData(address accountKeeper, ISleeveModule.RuleInput memory rule)
        internal
        pure
        returns (bytes memory)
    {
        return abi.encode(accountKeeper, rule);
    }

    /// @notice An account deployed through the factory with the module installed by a root UserOp, holding
    /// `balance` USDG before the install.
    function _installedAccount(address module, bytes32 salt, uint256 balance, bytes memory data)
        internal
        returns (address account)
    {
        account = _createAccount(owner, salt);
        if (balance != 0) _pay(account, balance);
        OpResult memory installed = _installThroughOp(account, ownerKey, module, data);
        assertTrue(installed.success, "install UserOp failed");
    }

    /// @notice An owner op through handleOps, signed by the owner's root key.
    function _ownerOp(address account, bytes memory callData) internal returns (OpResult memory) {
        return _sendOp(account, ownerKey, callData);
    }

    /// @notice A third-party USDG transfer to the account, as a payer's wallet sends it.
    function _pay(address account, uint256 amount) internal {
        address payerWallet = makeAddr("payer");
        deal(address(USDG), payerWallet, amount);
        vm.prank(payerWallet);
        assertTrue(USDG.transfer(account, amount), "payment failed");
    }

    /// @notice A payer contract holding `amount` USDG, for inflows the owner pulls inside a bracket.
    function _payerHolding(uint256 amount) internal returns (UsdgPayer payer) {
        payer = new UsdgPayer(USDG);
        deal(address(USDG), address(payer), amount);
    }

    /// @notice I1: the module holds no USDG after the action.
    function _assertHoldsNothing(address module) internal view {
        assertEq(USDG.balanceOf(module), 0, "I1: module holds USDG");
    }
}
