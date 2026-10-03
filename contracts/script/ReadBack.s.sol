// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {console} from "forge-std/console.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {SessionCalendarExtension} from "../src/SessionCalendarExtension.sol";
import {SleeveModule} from "../src/SleeveModule.sol";
import {SleeveTimelock} from "../src/SleeveTimelock.sol";
import {TokenSource} from "../src/TokenSource.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {IStockToken} from "../src/interfaces/IStockToken.sol";
import {IUniswapV3Pool} from "../src/interfaces/IUniswapV3Pool.sol";
import {DeployChecks, Deployment, IPeripheryViews, IPoolViews} from "./DeployChecks.sol";
import {DeployConfig} from "./DeployConfig.sol";

/// @title ReadBack
/// @notice Reads a recorded Sleeve deployment back from chain state and reverts on the first mismatch: the outside
/// addresses of the constants table, the code at every Sleeve address against this checkout's build with the library
/// links, the timelock's delay, roles and full role history, the calendar, every TokenSource ticker, feed, session type
/// and pool, and the module's immutables and guard limits (D-009 Q33, audit A1-26). Sends nothing.
/// @dev Run with the FOUNDRY_OUT the deploy's build used: the code check reads the artifacts there.
contract ReadBack is DeployChecks {
    /// @notice The record is for another chain than the one the script reads.
    error RecordChainMismatch(uint256 recordChainId, uint256 chainId);
    /// @notice The record's deployer is not the account the read-back expects to hold the timelock's roles.
    error RecordDeployerMismatch(address recordDeployer, address expected);

    /// @notice Reads everything back. Environment: SLEEVE_DEPLOYMENT_FILE, the record (default
    /// deployments/4663.json), and SLEEVE_DEPLOYER, the account that must hold the timelock's roles (default
    /// DeployConfig.DEPLOYER).
    /// @dev Caller: forge script against the chain or fork that holds the deployment.
    function run() external view {
        string memory path = vm.envOr("SLEEVE_DEPLOYMENT_FILE", string(DeployConfig.RECORD_FILE));
        string memory json = vm.readFile(path);
        uint256 recordChainId = vm.parseJsonUint(json, ".chainId");
        if (recordChainId != block.chainid) revert RecordChainMismatch(recordChainId, block.chainid);
        Deployment memory d = load(json);
        address expected = vm.envOr("SLEEVE_DEPLOYER", DeployConfig.DEPLOYER);
        if (d.deployer != expected) revert RecordDeployerMismatch(d.deployer, expected);

        checkConstants();
        checkDeployment(d);
        uint256 fromBlock = vm.parseJsonUint(json, ".contracts.SleeveTimelock.blockNumber");
        (RoleEvent[] memory events, bytes[] memory delayChanges) = roleEventsOnChain(address(d.timelock), fromBlock);
        checkRoleEvents(d, events, delayChanges);

        console.log("ReadBack: every check passed. Record:", path);
        console.log("Chain id and block:", block.chainid, block.number);
        console.log("Timelock role events read from block", fromBlock);
        _logSleeve("SleeveTrade", d.sleeveTrade);
        _logSleeve("SleeveBuy", d.sleeveBuy);
        _logSleeve("SleeveSell", d.sleeveSell);
        _logSleeve("SleeveTimelock", address(d.timelock));
        _logSleeve("SessionCalendarExtension", address(d.calendar));
        _logSleeve("TokenSource", address(d.tokenSource));
        _logSleeve("SleeveModule", address(d.module));
    }

    /// @notice Checks only the outside addresses of the constants table, as a pre-deploy check, then prints what the
    /// checks read: code size and hash, decimals, symbols, feed descriptions and latest rounds, the router's wiring,
    /// and each D-010 pool's fee, pair, liquidity and USDG balance. docs/DEPLOY_PLAN.md quotes this output.
    /// @dev Caller: forge script --sig "constants()" against the chain or a fork, before the deploy.
    function constants() external view {
        checkConstants();
        console.log("Constants: every check passed at block %s, timestamp %s", block.number, block.timestamp);
        address usdg = DeployConfig.USDG;
        _logCode("USDG", usdg);
        console.log("  decimals %s, symbol %s", IERC20Metadata(usdg).decimals(), IERC20Metadata(usdg).symbol());
        _logCode("EntryPoint v0.7", DeployConfig.ENTRY_POINT_V07);
        _logCode("Permit2", DeployConfig.PERMIT2);
        _logCode("ArbSys", DeployConfig.ARB_SYS);
        _logCode("SwapRouter02", DeployConfig.SWAP_ROUTER_02);
        console.log(
            "  factory %s, WETH9 %s",
            IPeripheryViews(DeployConfig.SWAP_ROUTER_02).factory(),
            IPeripheryViews(DeployConfig.SWAP_ROUTER_02).WETH9()
        );
        _logCode("Uniswap v3 factory", DeployConfig.V3_FACTORY);
        _logCode("QuoterV2", DeployConfig.QUOTER_V2);
        console.log("  factory %s", IPeripheryViews(DeployConfig.QUOTER_V2).factory());
        _logCode("Universal Router v2.1.2", DeployConfig.UNIVERSAL_ROUTER);
        _logCode("Morpho Blue", DeployConfig.MORPHO_BLUE);
        _logFeed("USDG/USD feed", DeployConfig.USDG_USD_FEED);
        DeployConfig.TickerSpec[] memory specs = DeployConfig.tickers();
        for (uint256 i; i < specs.length; ++i) {
            _logTicker(specs[i]);
        }
        _logCode("Stock Token registry", DeployConfig.REGISTRY);
        _logCode("WETH", DeployConfig.WETH);
        _logCode("CREATE2 deployer", DeployConfig.CREATE2_DEPLOYER);
        _logCode("Kernel v3.1 implementation", DeployConfig.KERNEL_IMPLEMENTATION);
        _logCode("Kernel v3.1 factory", DeployConfig.KERNEL_FACTORY);
        _logCode("Kernel meta factory", DeployConfig.KERNEL_META_FACTORY);
        _logCode("ECDSA validator", DeployConfig.ECDSA_VALIDATOR);
        _logCode("Passkey validator 0.0.3", DeployConfig.PASSKEY_VALIDATOR);
    }

    /// @notice The deployment a record names: the deployer and every contract address.
    /// @dev Caller: run, and the smoke test, which reads the record the dry run wrote.
    /// @param json The record's text, as script/record_deployment.py writes it.
    function load(string memory json) public pure returns (Deployment memory d) {
        d.deployer = vm.parseJsonAddress(json, ".deployer");
        d.timelock = SleeveTimelock(payable(vm.parseJsonAddress(json, ".contracts.SleeveTimelock.address")));
        d.calendar = SessionCalendarExtension(vm.parseJsonAddress(json, ".contracts.SessionCalendarExtension.address"));
        d.tokenSource = TokenSource(vm.parseJsonAddress(json, ".contracts.TokenSource.address"));
        d.sleeveTrade = vm.parseJsonAddress(json, ".contracts.SleeveTrade.address");
        d.sleeveBuy = vm.parseJsonAddress(json, ".contracts.SleeveBuy.address");
        d.sleeveSell = vm.parseJsonAddress(json, ".contracts.SleeveSell.address");
        d.module = SleeveModule(vm.parseJsonAddress(json, ".contracts.SleeveModule.address"));
    }

    function _logSleeve(string memory name, address target) private view {
        console.log("%s %s: %s bytes of runtime code", name, target, target.code.length);
    }

    function _logCode(string memory name, address target) private view {
        console.log("%s %s: %s bytes", name, target, target.code.length);
        console.log("  codehash %s", vm.toString(keccak256(target.code)));
    }

    function _logFeed(string memory name, address feed) private view {
        _logCode(name, feed);
        (uint80 roundId, int256 answer,, uint256 updatedAt,) = IAggregatorV3(feed).latestRoundData();
        console.log("  decimals %s, description %s", IAggregatorV3(feed).decimals(), IAggregatorV3(feed).description());
        console.log("  latest round %s, answer %s, updatedAt %s", roundId, vm.toString(answer), updatedAt);
    }

    function _logTicker(DeployConfig.TickerSpec memory spec) private view {
        IStockToken token = IStockToken(spec.token);
        _logCode(spec.symbol, spec.token);
        console.log(
            "  decimals %s, symbol %s, registry %s",
            token.decimals(),
            IERC20Metadata(spec.token).symbol(),
            token.ACCESS_CONTROLLED_REGISTRY()
        );
        console.log("  paused %s, oraclePaused %s", token.paused(), token.oraclePaused());
        _logFeed(string.concat(spec.symbol, " feed"), spec.feed);
        for (uint256 p; p < spec.pools.length; ++p) {
            IUniswapV3Pool pool = IUniswapV3Pool(spec.pools[p]);
            console.log("  pool %s: fee %s, factory %s", address(pool), pool.fee(), IPoolViews(address(pool)).factory());
            console.log(
                "    token0 %s, token1 %s, liquidity %s",
                pool.token0(),
                pool.token1(),
                IPoolViews(address(pool)).liquidity()
            );
            console.log("    USDG held %s", IERC20Metadata(DeployConfig.USDG).balanceOf(address(pool)));
        }
    }
}
