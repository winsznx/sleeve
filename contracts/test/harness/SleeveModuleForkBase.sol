// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SessionCalendarExtension} from "../../src/SessionCalendarExtension.sol";
import {SleeveModule} from "../../src/SleeveModule.sol";
import {SleeveTimelock} from "../../src/SleeveTimelock.sol";
import {TokenSource} from "../../src/TokenSource.sol";
import {IAccessControlsRegistry} from "../../src/interfaces/IAccessControlsRegistry.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";
import {IQuoterV2} from "../../src/interfaces/IQuoterV2.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {ISwapRouter02} from "../../src/interfaces/ISwapRouter02.sol";
import {IUniswapV3Pool} from "../../src/interfaces/IUniswapV3Pool.sol";
import {PriceGuard} from "../../src/libraries/PriceGuard.sol";
import {LaunchConfig} from "../mocks/LaunchConfig.sol";
import {UsdgPayer} from "../mocks/UsdgPayer.sol";
import {Chain4663} from "../utils/Chain4663.sol";
import {KernelHelpers} from "../utils/KernelHelpers.sol";
import {SleeveModuleHarness} from "./SleeveModuleHarness.sol";

/// @notice The issuer's role-gated writes the fork tests call as the real role holders. Sleeve never calls them, so they
/// live here and not in src/interfaces. Selectors from docs/research/chain-constants.md section 3.
interface IIssuerWrites {
    /// @notice Registry, BLOCKER_ROLE. 0x6abf7081.
    function blockAccounts(address[] calldata accounts) external;
    /// @notice Registry under PAUSER_ROLE, or token under TOKEN_PAUSER_ROLE. 0x8456cb59.
    function pause() external;
    /// @notice Token, ORACLE_PAUSER_ROLE. 0x253ea980.
    function pauseOracle() external;
    /// @notice Token, MULTIPLIER_UPDATER_ROLE: schedules newMultiplier for effectiveAt. 0xbad60f18.
    function updateMultiplier(uint256 newMultiplier, uint256 effectiveAt) external;
}

/// @notice The module on chain 4663 forked at IN_SESSION_BLOCK: real USDG, the launch TokenSource on the real tokens,
/// feeds and pools behind SleeveTimelock with the SPEC configuration, a fresh SessionCalendarExtension, and accounts on
/// the deployed Kernel v3.1 stack. Owner ops go through handleOps and are never pranked. Also the issuer's role holders,
/// read from the registry's RoleGranted logs and checked with hasRole at every pinned block before use.
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

    /// @dev Monday 28 September 2026 00:01:40Z, Sunday 20:01:40 EDT: a minute after the first rounds of the week landed.
    /// Every stock feed's latest round is from after the Sunday 20:00 reopen.
    uint256 internal constant REOPEN_BLOCK = 74_351_992;

    /// @dev Role holders of the stock token registry 0xe10b...1b00, from its RoleGranted logs (granted at blocks 7,833
    /// to 8,687 by the registry's deployer, none revoked).
    address internal constant REGISTRY_BLOCKER = 0x913cA87347391218e5De2C17c5A0AEba8B0b28fD;
    address internal constant REGISTRY_PAUSER = 0xe7BCB188254Bc6eBBfF63014DfED4cD4A024F22A;
    address internal constant TOKEN_PAUSER = 0xFCcF56B674113d9C4eb0F9B3370930ceD9E6Ab23;
    address internal constant ORACLE_PAUSER = 0x7369d100c00F28E45D779ac9d4b1c7afa61e4aBC;
    /// @dev Also the sender of every multiplier update so far (chain-constants.md appendix A.6).
    address internal constant MULTIPLIER_UPDATER = 0x92905e8d0e2301BA143215B8D86D63fFD4188143;

    SleeveTimelock internal timelock;
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
        _setUpForkAt(IN_SESSION_BLOCK);
    }

    function _setUpForkAt(uint256 blockNumber) internal {
        _fork(blockNumber);
        (owner, ownerKey) = makeAddrAndKey("owner");
        address[] memory roles = new address[](1);
        roles[0] = deployer;
        timelock = new SleeveTimelock(TIMELOCK_DELAY, roles, roles, address(0));
        tokenSource =
            new TokenSource(address(timelock), Chain4663.USDG, Chain4663.V3_FACTORY, LaunchConfig.tickerInits());
        calendar = new SessionCalendarExtension(address(timelock));
        vm.label(address(ENTRY_POINT), "EntryPointV07");
        vm.label(address(KERNEL_FACTORY), "KernelFactoryV31");
        vm.label(address(META_FACTORY), "FactoryStaker");
        vm.label(Chain4663.USDG, "USDG");
        vm.label(Chain4663.SWAP_ROUTER_02, "SwapRouter02");
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

    /// @notice The default rule on another ticker.
    function _ruleOn(uint8 tickerId) internal pure returns (ISleeveModule.RuleInput memory rule) {
        rule = _defaultRule();
        rule.tickerId = tickerId;
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

    /// @notice I1 for USDG and every launch token.
    function _assertHoldsNothingAtAll(address module) internal view {
        _assertHoldsNothing(module);
        address[4] memory tokens = [Chain4663.SPY, Chain4663.QQQ, Chain4663.NVDA, Chain4663.AAPL];
        for (uint256 i; i < tokens.length; ++i) {
            assertEq(IERC20(tokens[i]).balanceOf(module), 0, "I1: module holds a stock token");
        }
    }

    // Market and venue

    /// @notice A launch ticker's token and feed.
    function _tokenOf(uint8 tickerId) internal view returns (address token, address feed) {
        (token, feed,,) = tokenSource.ticker(tickerId);
    }

    /// @notice QuoterV2's output for amountIn of USDG through the pool, as the module's quote: token base units per 1e6
    /// USDG base units, rounded down as the keeper computes it.
    function _quote(uint8 tickerId, address pool, uint256 amountIn) internal returns (uint256) {
        (address token,) = _tokenOf(tickerId);
        (uint256 amountOut,,,) = IQuoterV2(Chain4663.QUOTER_V2)
            .quoteExactInputSingle(
                IQuoterV2.QuoteExactInputSingleParams({
                tokenIn: Chain4663.USDG,
                tokenOut: token,
                amountIn: amountIn,
                fee: IUniswapV3Pool(pool).fee(),
                sqrtPriceLimitX96: 0
            })
            );
        return amountOut * 1e6 / amountIn;
    }

    /// @notice A whale buy of `amountIn` USDG of the pool's token straight through SwapRouter02, moving the pool's
    /// price up before a trigger.
    function _pushPool(uint8 tickerId, address pool, uint256 amountIn) internal {
        (address token,) = _tokenOf(tickerId);
        address whale = makeAddr("whale");
        deal(address(USDG), whale, amountIn);
        vm.startPrank(whale);
        USDG.approve(Chain4663.SWAP_ROUTER_02, amountIn);
        ISwapRouter02(Chain4663.SWAP_ROUTER_02)
            .exactInputSingle(
                ISwapRouter02.ExactInputSingleParams({
                tokenIn: Chain4663.USDG,
                tokenOut: token,
                fee: IUniswapV3Pool(pool).fee(),
                recipient: whale,
                amountIn: amountIn,
                amountOutMinimum: 0,
                sqrtPriceLimitX96: 0
            })
            );
        vm.stopPrank();
    }

    // The issuer's role holders

    function _asRoleHolder(bytes32 role, address holder) internal view {
        assertTrue(IAccessControl(LaunchConfig.REGISTRY).hasRole(role, holder), "role holder at this block");
    }

    /// @notice Blocks an address through the real registry, as its BLOCKER_ROLE holder.
    function _blockInRegistry(address target) internal {
        _asRoleHolder(keccak256("BLOCKER_ROLE"), REGISTRY_BLOCKER);
        address[] memory targets = new address[](1);
        targets[0] = target;
        vm.prank(REGISTRY_BLOCKER);
        IIssuerWrites(LaunchConfig.REGISTRY).blockAccounts(targets);
        assertTrue(IAccessControlsRegistry(LaunchConfig.REGISTRY).isBlocked(target), "blocked");
    }

    /// @notice Pauses one token as its TOKEN_PAUSER_ROLE holder.
    function _pauseToken(address token) internal {
        _asRoleHolder(keccak256("TOKEN_PAUSER_ROLE"), TOKEN_PAUSER);
        vm.prank(TOKEN_PAUSER);
        IIssuerWrites(token).pause();
    }

    /// @notice Pauses every stock token at once through the registry, as its PAUSER_ROLE holder.
    function _pauseRegistry() internal {
        _asRoleHolder(keccak256("PAUSER_ROLE"), REGISTRY_PAUSER);
        vm.prank(REGISTRY_PAUSER);
        IIssuerWrites(LaunchConfig.REGISTRY).pause();
    }

    /// @notice Sets a token's advisory oracle pause as its ORACLE_PAUSER_ROLE holder.
    function _pauseOracle(address token) internal {
        _asRoleHolder(keccak256("ORACLE_PAUSER_ROLE"), ORACLE_PAUSER);
        vm.prank(ORACLE_PAUSER);
        IIssuerWrites(token).pauseOracle();
    }

    /// @notice Schedules a multiplier change ten minutes ahead, as every real change was, by the
    /// MULTIPLIER_UPDATER_ROLE holder.
    function _scheduleMultiplier(address token, uint256 newMultiplier) internal {
        _asRoleHolder(keccak256("MULTIPLIER_UPDATER_ROLE"), MULTIPLIER_UPDATER);
        vm.prank(MULTIPLIER_UPDATER);
        IIssuerWrites(token).updateMultiplier(newMultiplier, block.timestamp + 600);
    }

    // The timelock

    /// @notice Schedules a TokenSource write through SleeveTimelock, waits out the 48 hours and executes it.
    function _throughTimelock(address target, bytes memory data, bytes32 salt) internal {
        vm.prank(deployer);
        timelock.schedule(target, 0, data, bytes32(0), salt, TIMELOCK_DELAY);
        vm.warp(block.timestamp + TIMELOCK_DELAY);
        vm.prank(deployer);
        timelock.execute(target, 0, data, bytes32(0), salt);
    }

    // Receipts

    /// @notice Every ReceiptWritten from the module in `logs`, in order, each checked against its topics and against
    /// the stored hash.
    function _receiptsIn(Vm.Log[] memory logs, address module)
        internal
        view
        returns (ISleeveModule.Receipt[] memory receipts)
    {
        uint256 count;
        for (uint256 i; i < logs.length; ++i) {
            if (_isReceipt(logs[i], module)) ++count;
        }
        receipts = new ISleeveModule.Receipt[](count);
        count = 0;
        for (uint256 i; i < logs.length; ++i) {
            if (!_isReceipt(logs[i], module)) continue;
            ISleeveModule.Receipt memory receipt = abi.decode(logs[i].data, (ISleeveModule.Receipt));
            assertEq(logs[i].topics[1], bytes32(receipt.id), "indexed id");
            assertEq(logs[i].topics[2], bytes32(uint256(uint160(receipt.account))), "indexed account");
            assertEq(logs[i].topics[3], bytes32(uint256(uint8(receipt.status))), "indexed status");
            assertEq(ISleeveModule(module).receiptHash(receipt.id), keccak256(logs[i].data), "stored hash");
            receipts[count++] = receipt;
        }
    }

    function _isReceipt(Vm.Log memory log, address module) private pure returns (bool) {
        return log.emitter == module && log.topics.length == 4 && log.topics[0] == ISleeveModule.ReceiptWritten.selector;
    }
}
