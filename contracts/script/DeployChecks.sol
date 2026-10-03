// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Script} from "forge-std/Script.sol";
import {Vm, VmSafe} from "forge-std/Vm.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";
import {SessionCalendarExtension} from "../src/SessionCalendarExtension.sol";
import {SleeveModule} from "../src/SleeveModule.sol";
import {SleeveTimelock} from "../src/SleeveTimelock.sol";
import {TokenSource} from "../src/TokenSource.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {IStockToken} from "../src/interfaces/IStockToken.sol";
import {ISwapRouter02} from "../src/interfaces/ISwapRouter02.sol";
import {IUniswapV3Factory} from "../src/interfaces/IUniswapV3Factory.sol";
import {IUniswapV3Pool} from "../src/interfaces/IUniswapV3Pool.sol";
import {SessionCalendar} from "../src/libraries/SessionCalendar.sol";
import {GuardParams} from "../src/types/SleeveTypes.sol";
import {DeployConfig} from "./DeployConfig.sol";

/// @notice Every contract the deploy creates, and the account that created them and holds the timelock's roles.
struct Deployment {
    address deployer;
    SleeveTimelock timelock;
    SessionCalendarExtension calendar;
    TokenSource tokenSource;
    address sleeveTrade;
    address sleeveBuy;
    address sleeveSell;
    SleeveModule module;
}

/// @dev Views the checks read that Sleeve's own interfaces leave out.
interface IPoolViews {
    function factory() external view returns (address);
    function liquidity() external view returns (uint128);
}

/// @dev SwapRouter02's and QuoterV2's wiring.
interface IPeripheryViews {
    function factory() external view returns (address);
    function WETH9() external view returns (address);
}

/// @title DeployChecks
/// @notice The read-back shared by Deploy.s.sol, which runs it on the simulated deployment before anything is
/// broadcast, ReadBack.s.sol, which runs it on chain state after the broadcast, and the deploy tests. Each check reads
/// chain state and reverts with a named error on the first mismatch: the outside addresses of the constants table, the
/// code at every Sleeve address against this checkout's build, the timelock's delay and roles, the calendar,
/// TokenSource's tickers and pools, and the module's immutables and library links.
/// @dev Code hashes of the outside contracts were read at block 79,232,659 on 3 October 2026 (docs/DEPLOY_PLAN.md).
/// None of them can change: every one is either immutable code or a proxy whose own code is fixed.
abstract contract DeployChecks is Script {
    /// @notice A library a Sleeve artifact links to, as the build's linkReferences name it.
    struct Link {
        string file;
        string name;
        address at;
    }

    /// @notice One timelock event that grants, revokes or re-administers a role.
    struct RoleEvent {
        bytes32 topic0;
        bytes32 role;
        address account;
    }

    /// @dev One entry of an artifact's linkReferences or immutableReferences. Fields in alphabetical order, the order
    /// vm.parseJson decodes object keys in.
    struct CodeRange {
        uint256 length;
        uint256 start;
    }

    bytes32 internal constant USDG_CODEHASH = 0x864cc9ad53b338b82da1f7cab85ab0b3d5c8861acb422b6fec63cf36234f36a6;
    bytes32 internal constant ENTRY_POINT_CODEHASH = 0x8db5ff695839d655407cc8490bb7a5d82337a86a6b39c3f0258aa6c3b582fc58;
    bytes32 internal constant PERMIT2_CODEHASH = 0x5208783f52488f7d3493e5e38311ab707c1d75457fe472a19b0b4d57d66a7fca;
    /// @dev keccak256(0xfe): the placeholder eth_getCode returns for the ArbSys precompile.
    bytes32 internal constant ARB_SYS_CODEHASH = 0xbcc90f2d6dada5b18e155c17a1c0a55920aae94f39857d39d0d8ed07ae8f228b;
    bytes32 internal constant SWAP_ROUTER_02_CODEHASH =
        0x6f36c378e272c6324c48f045182bcb54bd8ad654cf9ebd42e8893d52c4cb25dc;
    bytes32 internal constant V3_FACTORY_CODEHASH = 0xec72b1abd1f2faee020cfea9c646bd8994f9fb389054f6e574f103a895091739;
    bytes32 internal constant QUOTER_V2_CODEHASH = 0x3db0868d945e9304c9bc6a8b2181948109ea617647142f3c4083e14393496a28;
    bytes32 internal constant UNIVERSAL_ROUTER_CODEHASH =
        0x76b92a5bba2dd32019a64eb421f1750e78c6ba044dbfa6840b722eb5ac63d296;
    bytes32 internal constant MORPHO_BLUE_CODEHASH = 0x753b54fdb48c87c9c1ba1dcc3a330faac1a401a3bd23b43104b7b92409ecb424;
    /// @dev The BeaconProxy every launch Stock Token runs.
    bytes32 internal constant STOCK_TOKEN_CODEHASH = 0x6c1fdd40002dcb440c7fff6a84171404d279ccb057803b65826f7546acd65630;
    /// @dev The EACAggregatorProxy every feed Sleeve reads runs.
    bytes32 internal constant FEED_PROXY_CODEHASH = 0xbd6f524cdc4268b6bd1bb6f77a8821faeea9c52ee9e0afa0b6d948ce82c966c2;
    bytes32 internal constant REGISTRY_CODEHASH = 0x8b465c0b53a2ba499566e9b4ca67d8c90ed6131743df806a570d156956a7e90e;
    bytes32 internal constant WETH_CODEHASH = 0x5706be52f64875fee65a2cec0d80e47a23d8793cbe85d214b48445e2d05f5353;
    bytes32 internal constant CREATE2_DEPLOYER_CODEHASH =
        0x2fa86add0aed31f33a762c9d88e807c475bd51d0f52bd0955754b2608f7e4989;
    bytes32 internal constant KERNEL_IMPLEMENTATION_CODEHASH =
        0xfd03686efa083658d7a92506fbec14ea6cdc314eb84737adbd2779874db24ca3;
    bytes32 internal constant KERNEL_FACTORY_CODEHASH =
        0xeecde6f459d0ecadbd5b76e89de74d8187b52d5c71651fdfc007c45d4f2f3ca0;
    bytes32 internal constant KERNEL_META_FACTORY_CODEHASH =
        0x4527f3642a53f1f4ce76beb05f955a8859b7245a1ff20da5be9a518d2fcd64aa;
    bytes32 internal constant ECDSA_VALIDATOR_CODEHASH =
        0x2f8b585e669feb673b21af5666d38b5a9ef3c361cf29a48299240fa97c890708;
    bytes32 internal constant PASSKEY_VALIDATOR_CODEHASH =
        0x726d987ac55574f77f5184326631c5c51142f94c16c9b9281b751f97519c9eea;

    /// @dev OpenZeppelin TimelockController's MinDelayChange(uint256,uint256).
    bytes32 private constant MIN_DELAY_CHANGE = keccak256("MinDelayChange(uint256,uint256)");
    /// @dev PUSH20, the first opcode of a library's call guard, which carries the library's own address.
    bytes1 private constant PUSH20 = 0x73;
    /// @dev Blocks per eth_getLogs request. The public RPC allows 10,000,000 for one address and one topic, and blocks
    /// arrive about ten a second, so a read-back weeks after the deploy still fits in a few requests.
    uint256 private constant LOG_WINDOW = 1_000_000;

    /// @notice An address holds no code, or other code than the contract the deploy relies on.
    error WrongCode(string name, address target, bytes32 codehash, bytes32 expected);
    /// @notice A view returned another address than the deploy configuration.
    error UnexpectedAddress(string what, address value, address expected);
    /// @notice A view returned another number than the deploy configuration.
    error UnexpectedUint(string what, uint256 value, uint256 expected);
    /// @notice A view returned another word than the deploy configuration.
    error UnexpectedBytes32(string what, bytes32 value, bytes32 expected);
    /// @notice A view returned another string than the deploy configuration.
    error UnexpectedString(string what, string value, string expected);
    /// @notice A yes-or-no view gave the wrong answer: a role held that must not be, a pool listed that must not be.
    error UnexpectedFlag(string what, bool value);
    /// @notice A pool on the allowlist holds no liquidity in range.
    error EmptyPool(string what, address pool);
    /// @notice A feed's latest answer is not positive.
    error NoAnswer(string what, address feed, int256 answer);
    /// @notice The build artifact the code check compares against is not in the output folder.
    error ArtifactMissing(string path);
    /// @notice An artifact links a library the deployment does not list.
    error UnknownLink(string artifact, string file, string libraryName);
    /// @notice A library the check expects an artifact to link is not among its link references.
    error LinkNotReferenced(string artifact, string libraryName);
    /// @notice A library placeholder in an artifact was left unfilled, or the artifact holds a character that is not
    /// hex.
    error NotHex(string artifact, uint256 offset);
    /// @notice The code at a Sleeve address has another length than the build's runtime code.
    error BytecodeLengthMismatch(string name, address target, uint256 length, uint256 expected);
    /// @notice The code at a Sleeve address differs from the build's runtime code outside its immutables.
    error BytecodeMismatch(string name, address target, uint256 firstDifference);
    /// @notice A link reference in deployed code holds another address than the deployed library.
    error LinkMismatch(string name, string libraryName, uint256 offset, address found, address expected);
    /// @notice The timelock's role events are not exactly the constructor's grants.
    error RoleHistoryMismatch(uint256 index, bytes32 topic0, bytes32 role, address account);
    /// @notice The timelock's role events hold another count of grants than the constructor's four.
    error RoleEventCount(uint256 count, uint256 expected);
    /// @notice The timelock changed its delay after the constructor, or the constructor's change is missing.
    error DelayHistoryMismatch(uint256 count, uint256 oldDelay, uint256 newDelay);

    // The constants table

    /// @notice Checks every outside address the deploy relies on: the constants table of internal/CLAUDE.md, the
    /// Stock Token registry, WETH, the CREATE2 deployer and the Kernel v3.1 stack. Code by hash; USDG at 6 decimals,
    /// every feed at 8 with its own description and a positive answer, every Stock Token at 18 with its symbol and the
    /// registry; SwapRouter02 and QuoterV2 on the v3 factory; every D-010 pool canonical, at its fee, on its pair and
    /// holding liquidity.
    /// @dev Caller: Deploy.run before it broadcasts, ReadBack.run and ReadBack.constants, and the deploy tests.
    function checkConstants() public view {
        _code("USDG", DeployConfig.USDG, USDG_CODEHASH);
        _uint("USDG decimals", IERC20Metadata(DeployConfig.USDG).decimals(), 6);
        _string("USDG symbol", IERC20Metadata(DeployConfig.USDG).symbol(), "USDG");
        _code("EntryPoint v0.7", DeployConfig.ENTRY_POINT_V07, ENTRY_POINT_CODEHASH);
        _code("Permit2", DeployConfig.PERMIT2, PERMIT2_CODEHASH);
        _code("ArbSys", DeployConfig.ARB_SYS, ARB_SYS_CODEHASH);
        _code("SwapRouter02", DeployConfig.SWAP_ROUTER_02, SWAP_ROUTER_02_CODEHASH);
        _address("SwapRouter02 factory", ISwapRouter02(DeployConfig.SWAP_ROUTER_02).factory(), DeployConfig.V3_FACTORY);
        _address("SwapRouter02 WETH9", IPeripheryViews(DeployConfig.SWAP_ROUTER_02).WETH9(), DeployConfig.WETH);
        _code("Uniswap v3 factory", DeployConfig.V3_FACTORY, V3_FACTORY_CODEHASH);
        _code("QuoterV2", DeployConfig.QUOTER_V2, QUOTER_V2_CODEHASH);
        _address("QuoterV2 factory", IPeripheryViews(DeployConfig.QUOTER_V2).factory(), DeployConfig.V3_FACTORY);
        _code("Universal Router v2.1.2", DeployConfig.UNIVERSAL_ROUTER, UNIVERSAL_ROUTER_CODEHASH);
        _code("Morpho Blue", DeployConfig.MORPHO_BLUE, MORPHO_BLUE_CODEHASH);
        _code("Stock Token registry", DeployConfig.REGISTRY, REGISTRY_CODEHASH);
        _code("WETH", DeployConfig.WETH, WETH_CODEHASH);
        _code("CREATE2 deployer", DeployConfig.CREATE2_DEPLOYER, CREATE2_DEPLOYER_CODEHASH);
        _code("Kernel v3.1 implementation", DeployConfig.KERNEL_IMPLEMENTATION, KERNEL_IMPLEMENTATION_CODEHASH);
        _code("Kernel v3.1 factory", DeployConfig.KERNEL_FACTORY, KERNEL_FACTORY_CODEHASH);
        _code("Kernel meta factory", DeployConfig.KERNEL_META_FACTORY, KERNEL_META_FACTORY_CODEHASH);
        _code("ECDSA validator", DeployConfig.ECDSA_VALIDATOR, ECDSA_VALIDATOR_CODEHASH);
        _code("Passkey validator 0.0.3", DeployConfig.PASSKEY_VALIDATOR, PASSKEY_VALIDATOR_CODEHASH);
        _feed("USDG/USD feed", DeployConfig.USDG_USD_FEED, "USDG / USD");
        DeployConfig.TickerSpec[] memory specs = DeployConfig.tickers();
        for (uint256 i; i < specs.length; ++i) {
            _checkTicker(specs[i]);
        }
    }

    // The deployment

    /// @notice Checks a deployment against the deploy configuration from chain state: the code at every address
    /// against this checkout's build (immutables masked, library links filled in), the timelock, the calendar,
    /// TokenSource and the module.
    /// @dev Caller: Deploy.run on the simulated deployment, ReadBack.run on chain, and the deploy tests. Reads the
    /// build artifacts from FOUNDRY_OUT (default out), so run it with the FOUNDRY_OUT the build used.
    /// @param d The deployment; d.deployer is the account that must hold the timelock's roles.
    function checkDeployment(Deployment memory d) public view {
        _checkCode(d);
        _checkTimelock(d);
        _checkCalendar(d);
        _checkTokenSource(d);
        _checkModule(d);
    }

    /// @notice Checks that the timelock's role events are exactly its constructor's: DEFAULT_ADMIN_ROLE to the
    /// timelock itself, then PROPOSER_ROLE, CANCELLER_ROLE and EXECUTOR_ROLE to the deployer, no revocation, no change
    /// of a role's admin, and one MinDelayChange from 0 to 172,800. With no other grant there is no admin role holder
    /// outside the timelock (D-009 Q33, audit A1-26).
    /// @dev Caller: Deploy.run and the deploy tests with the deploy's recorded logs, ReadBack.run with the logs read
    /// from chain.
    /// @param d The deployment.
    /// @param events The timelock's RoleGranted, RoleRevoked and RoleAdminChanged events, oldest first.
    /// @param delayChanges The data of each of the timelock's MinDelayChange events, oldest first.
    function checkRoleEvents(Deployment memory d, RoleEvent[] memory events, bytes[] memory delayChanges) public pure {
        if (events.length != 4) revert RoleEventCount(events.length, 4);
        _roleEvent(0, events[0], IAccessControl.RoleGranted.selector, bytes32(0), address(d.timelock));
        _roleEvent(1, events[1], IAccessControl.RoleGranted.selector, keccak256("PROPOSER_ROLE"), d.deployer);
        _roleEvent(2, events[2], IAccessControl.RoleGranted.selector, keccak256("CANCELLER_ROLE"), d.deployer);
        _roleEvent(3, events[3], IAccessControl.RoleGranted.selector, keccak256("EXECUTOR_ROLE"), d.deployer);
        if (delayChanges.length != 1) revert DelayHistoryMismatch(delayChanges.length, 0, 0);
        (uint256 oldDelay, uint256 newDelay) = abi.decode(delayChanges[0], (uint256, uint256));
        if (oldDelay != 0 || newDelay != DeployConfig.TIMELOCK_MIN_DELAY) {
            revert DelayHistoryMismatch(1, oldDelay, newDelay);
        }
    }

    /// @notice The timelock's role and delay events among logs recorded by vm.recordLogs, in order.
    /// @dev Caller: Deploy.run and the deploy tests.
    function roleEventsIn(Vm.Log[] memory logs, address timelock)
        public
        pure
        returns (RoleEvent[] memory events, bytes[] memory delayChanges)
    {
        events = new RoleEvent[](logs.length);
        delayChanges = new bytes[](logs.length);
        uint256 roleCount;
        uint256 delayCount;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != timelock || logs[i].topics.length == 0) continue;
            bytes32 topic0 = logs[i].topics[0];
            if (topic0 == MIN_DELAY_CHANGE) {
                delayChanges[delayCount++] = logs[i].data;
            } else if (_isRoleTopic(topic0)) {
                events[roleCount++] = RoleEvent(topic0, logs[i].topics[1], address(uint160(uint256(logs[i].topics[2]))));
            }
        }
        assembly ("memory-safe") {
            mstore(events, roleCount)
            mstore(delayChanges, delayCount)
        }
    }

    /// @notice The timelock's role and delay events read from the chain through eth_getLogs, from the block it was
    /// deployed in to the current block, each kind in log order. One address and one topic per request, in windows of
    /// LOG_WINDOW blocks, which the public RPC requires.
    /// @dev Caller: ReadBack.run.
    function roleEventsOnChain(address timelock, uint256 fromBlock)
        public
        view
        returns (RoleEvent[] memory events, bytes[] memory delayChanges)
    {
        VmSafe.EthGetLogs[] memory granted = _logs(timelock, fromBlock, IAccessControl.RoleGranted.selector);
        VmSafe.EthGetLogs[] memory revoked = _logs(timelock, fromBlock, IAccessControl.RoleRevoked.selector);
        VmSafe.EthGetLogs[] memory adminChanged = _logs(timelock, fromBlock, IAccessControl.RoleAdminChanged.selector);
        VmSafe.EthGetLogs[] memory delays = _logs(timelock, fromBlock, MIN_DELAY_CHANGE);
        events = new RoleEvent[](granted.length + revoked.length + adminChanged.length);
        uint256 count;
        for (uint256 i; i < granted.length; ++i) {
            events[count++] = _fromChain(granted[i]);
        }
        for (uint256 i; i < revoked.length; ++i) {
            events[count++] = _fromChain(revoked[i]);
        }
        for (uint256 i; i < adminChanged.length; ++i) {
            events[count++] = _fromChain(adminChanged[i]);
        }
        delayChanges = new bytes[](delays.length);
        for (uint256 i; i < delays.length; ++i) {
            delayChanges[i] = delays[i].data;
        }
    }

    // The deployment, part by part

    /// @dev Every Sleeve address holds this checkout's runtime code: libraries with their own address in the call
    /// guard, SleeveSell linked to SleeveTrade, the module linked to all three, immutables masked and read through their
    /// getters below.
    function _checkCode(Deployment memory d) private view {
        Link[] memory none = new Link[](0);
        _matchArtifact("SleeveTimelock", address(d.timelock), none, false);
        _matchArtifact("SessionCalendarExtension", address(d.calendar), none, false);
        _matchArtifact("TokenSource", address(d.tokenSource), none, false);
        _matchArtifact("SleeveTrade", d.sleeveTrade, none, true);
        _matchArtifact("SleeveBuy", d.sleeveBuy, none, true);
        Link[] memory sellLinks = new Link[](1);
        sellLinks[0] = Link("src/libraries/SleeveTrade.sol", "SleeveTrade", d.sleeveTrade);
        _matchArtifact("SleeveSell", d.sleeveSell, sellLinks, true);
        Link[] memory moduleLinks = new Link[](3);
        moduleLinks[0] = sellLinks[0];
        moduleLinks[1] = Link("src/libraries/SleeveBuy.sol", "SleeveBuy", d.sleeveBuy);
        moduleLinks[2] = Link("src/libraries/SleeveSell.sol", "SleeveSell", d.sleeveSell);
        _matchArtifact("SleeveModule", address(d.module), moduleLinks, false);
    }

    /// @dev SleeveTimelock: the 48-hour delay inside its bounds, and the deployer as the only proposer, canceller and
    /// executor with no admin role, which only the timelock holds (D-009 Q33, D-018, audit A1-26).
    function _checkTimelock(Deployment memory d) private view {
        SleeveTimelock t = d.timelock;
        _uint("timelock getMinDelay", t.getMinDelay(), DeployConfig.TIMELOCK_MIN_DELAY);
        _uint("timelock MIN_DELAY_FLOOR", t.MIN_DELAY_FLOOR(), DeployConfig.TIMELOCK_MIN_DELAY);
        _uint("timelock MIN_DELAY_CEILING", t.MIN_DELAY_CEILING(), DeployConfig.TIMELOCK_MIN_DELAY_CEILING);
        bytes32[4] memory roles = [t.DEFAULT_ADMIN_ROLE(), t.PROPOSER_ROLE(), t.CANCELLER_ROLE(), t.EXECUTOR_ROLE()];
        _bytes32("DEFAULT_ADMIN_ROLE", roles[0], bytes32(0));
        _bytes32("PROPOSER_ROLE", roles[1], keccak256("PROPOSER_ROLE"));
        _bytes32("CANCELLER_ROLE", roles[2], keccak256("CANCELLER_ROLE"));
        _bytes32("EXECUTOR_ROLE", roles[3], keccak256("EXECUTOR_ROLE"));
        _flag("timelock administers itself", t.hasRole(roles[0], address(t)), true);
        _flag("deployer holds DEFAULT_ADMIN_ROLE", t.hasRole(roles[0], d.deployer), false);
        _flag("deployer holds PROPOSER_ROLE", t.hasRole(roles[1], d.deployer), true);
        _flag("deployer holds CANCELLER_ROLE", t.hasRole(roles[2], d.deployer), true);
        _flag("deployer holds EXECUTOR_ROLE", t.hasRole(roles[3], d.deployer), true);
        address[5] memory outsiders =
            [address(0), DeployConfig.KEEPER, address(d.module), address(d.tokenSource), address(d.calendar)];
        for (uint256 i; i < outsiders.length; ++i) {
            for (uint256 r; r < roles.length; ++r) {
                _flag("an outsider holds a timelock role", t.hasRole(roles[r], outsiders[i]), false);
            }
        }
        for (uint256 r; r < roles.length; ++r) {
            _bytes32("timelock role admin", t.getRoleAdmin(roles[r]), roles[0]);
        }
    }

    /// @dev SessionCalendarExtension: under the timelock, with the library's 2026 and 2027 and no write yet.
    function _checkCalendar(Deployment memory d) private view {
        SessionCalendarExtension c = d.calendar;
        _address("calendar timelock", c.timelock(), address(d.timelock));
        _uint("calendar version", c.version(), DeployConfig.CALENDAR_VERSION);
        _uint("calendar writeCount", c.writeCount(), 0);
        _uint("calendar lastYear", c.lastYear(), SessionCalendar.LAST_YEAR);
        _uint("calendar endDay", c.endDay(), SessionCalendar.END_DAY);
        _uint("calendar coverageStart", c.coverageStart(), SessionCalendar.COVERAGE_START);
        _uint("calendar coverageEnd", c.coverageEnd(), SessionCalendar.COVERAGE_END);
        SessionCalendar.OffsetSwitch[] memory switches = c.offsetSwitches();
        SessionCalendar.OffsetSwitch[4] memory builtIn = SessionCalendar.builtInSwitches();
        _uint("calendar switches", switches.length, DeployConfig.CALENDAR_SWITCHES);
        for (uint256 i; i < builtIn.length; ++i) {
            _uint("calendar switch instant", switches[i].at, builtIn[i].at);
            _uint("calendar switch offset", switches[i].offset, builtIn[i].offset);
        }
    }

    /// @dev TokenSource: under the timelock, on USDG and the v3 factory, the four launch tickers in id order with
    /// their feeds, ALL_DAY and active, and exactly the D-010 pools, in order, with no other canonical pool and no pool
    /// of another ticker on any allowlist.
    function _checkTokenSource(Deployment memory d) private view {
        TokenSource s = d.tokenSource;
        _address("TokenSource timelock", s.timelock(), address(d.timelock));
        _address("TokenSource usdg", s.usdg(), DeployConfig.USDG);
        _address("TokenSource v3Factory", s.v3Factory(), DeployConfig.V3_FACTORY);
        DeployConfig.TickerSpec[] memory specs = DeployConfig.tickers();
        _uint("TokenSource tickerCount", s.tickerCount(), specs.length);
        for (uint256 i; i < specs.length; ++i) {
            // forge-lint: disable-next-line(unsafe-typecast)
            uint8 id = uint8(i);
            DeployConfig.TickerSpec memory spec = specs[i];
            (address token, address feed, SessionCalendar.SessionType sessionType, bool active) = s.ticker(id);
            _address(string.concat(spec.symbol, " token"), token, spec.token);
            _address(string.concat(spec.symbol, " feed"), feed, spec.feed);
            _uint(
                string.concat(spec.symbol, " session type"),
                uint8(sessionType),
                uint8(SessionCalendar.SessionType.ALL_DAY)
            );
            _flag(string.concat(spec.symbol, " active"), active, true);
            _uint(string.concat(spec.symbol, " id"), s.idOf(spec.token), id);
            address[] memory pools = s.poolsOf(id);
            _uint(string.concat(spec.symbol, " pool count"), pools.length, spec.pools.length);
            for (uint256 p; p < pools.length; ++p) {
                _address(string.concat(spec.symbol, " pool"), pools[p], spec.pools[p]);
                _flag(string.concat(spec.symbol, " pool allowed"), s.isPoolAllowed(id, spec.pools[p]), true);
            }
            for (uint256 p; p < spec.excluded.length; ++p) {
                _flag(
                    string.concat(spec.symbol, " unlisted pool allowed"), s.isPoolAllowed(id, spec.excluded[p]), false
                );
            }
            for (uint256 j; j < specs.length; ++j) {
                if (j == i) continue;
                for (uint256 p; p < specs[j].pools.length; ++p) {
                    _flag(
                        string.concat(spec.symbol, " lists another ticker's pool"),
                        s.isPoolAllowed(id, specs[j].pools[p]),
                        false
                    );
                }
            }
        }
    }

    /// @dev SleeveModule: every immutable, the D-014 guard limits, the owner ranges and the module type.
    function _checkModule(Deployment memory d) private view {
        SleeveModule m = d.module;
        _address("module usdg", address(m.usdg()), DeployConfig.USDG);
        _address("module tokenSource", address(m.tokenSource()), address(d.tokenSource));
        _address("module calendar", address(m.calendar()), address(d.calendar));
        _address("module swapRouter", address(m.swapRouter()), DeployConfig.SWAP_ROUTER_02);
        _address("module usdgUsdFeed", address(m.usdgUsdFeed()), DeployConfig.USDG_USD_FEED);
        _address("module defaultKeeper", m.defaultKeeper(), DeployConfig.KEEPER);
        _bytes32("module disclosureHash", m.disclosureHash(), DeployConfig.DISCLOSURE_HASH);
        _uint("module grace", m.grace(), DeployConfig.GRACE);
        GuardParams memory params = m.guardParams();
        _uint("module stockFeedMaxAge", params.stockFeedMaxAge, DeployConfig.STOCK_FEED_MAX_AGE);
        _uint("module usdgFeedMaxAge", params.usdgFeedMaxAge, DeployConfig.USDG_FEED_MAX_AGE);
        _uint("module depegToleranceBps", params.depegToleranceBps, DeployConfig.DEPEG_TOLERANCE_BPS);
        _uint("module multiplierWindow", params.multiplierWindow, DeployConfig.MULTIPLIER_WINDOW);
        _uint("module MAX_PREMIUM_CAP_BPS", m.MAX_PREMIUM_CAP_BPS(), DeployConfig.MAX_PREMIUM_CAP_BPS);
        _uint("module MAX_SLIPPAGE_BPS", m.MAX_SLIPPAGE_BPS(), DeployConfig.MAX_SLIPPAGE_BPS);
        _uint("module MIN_CLIP_FLOOR", m.MIN_CLIP_FLOOR(), DeployConfig.MIN_CLIP_FLOOR);
        _flag("module is an executor", m.isModuleType(DeployConfig.MODULE_TYPE_EXECUTOR), true);
        _flag("module is a validator", m.isModuleType(1), false);
    }

    // The constants table, part by part

    function _checkTicker(DeployConfig.TickerSpec memory spec) private view {
        _code(spec.symbol, spec.token, STOCK_TOKEN_CODEHASH);
        _uint(string.concat(spec.symbol, " decimals"), IStockToken(spec.token).decimals(), 18);
        _string(string.concat(spec.symbol, " symbol"), IERC20Metadata(spec.token).symbol(), spec.symbol);
        _address(
            string.concat(spec.symbol, " registry"),
            IStockToken(spec.token).ACCESS_CONTROLLED_REGISTRY(),
            DeployConfig.REGISTRY
        );
        _feed(string.concat(spec.symbol, " feed"), spec.feed, spec.feedDescription);
        _uint(string.concat(spec.symbol, " fee count"), spec.fees.length, spec.pools.length);
        for (uint256 p; p < spec.pools.length; ++p) {
            _checkPool(spec.symbol, spec.token, spec.pools[p], spec.fees[p]);
        }
    }

    function _checkPool(string memory symbol, address token, address pool, uint24 fee) private view {
        string memory what = string.concat(symbol, " pool");
        if (pool.code.length == 0) revert WrongCode(what, pool, pool.codehash, bytes32(0));
        _uint(string.concat(what, " fee"), IUniswapV3Pool(pool).fee(), fee);
        _address(string.concat(what, " factory"), IPoolViews(pool).factory(), DeployConfig.V3_FACTORY);
        _address(
            string.concat(what, " canonical"),
            IUniswapV3Factory(DeployConfig.V3_FACTORY).getPool(DeployConfig.USDG, token, fee),
            pool
        );
        (address low, address high) =
            token < DeployConfig.USDG ? (token, DeployConfig.USDG) : (DeployConfig.USDG, token);
        _address(string.concat(what, " token0"), IUniswapV3Pool(pool).token0(), low);
        _address(string.concat(what, " token1"), IUniswapV3Pool(pool).token1(), high);
        if (IPoolViews(pool).liquidity() == 0) revert EmptyPool(what, pool);
    }

    function _feed(string memory what, address feed, string memory description) private view {
        _code(what, feed, FEED_PROXY_CODEHASH);
        _uint(string.concat(what, " decimals"), IAggregatorV3(feed).decimals(), 8);
        _string(string.concat(what, " description"), IAggregatorV3(feed).description(), description);
        (, int256 answer,,,) = IAggregatorV3(feed).latestRoundData();
        if (answer <= 0) revert NoAnswer(what, feed, answer);
    }

    // Code against the build

    /// @dev The code at `target` equals the artifact's runtime code with every link reference filled from `links`,
    /// a library's call guard holding its own address, and every immutable masked on both sides.
    function _matchArtifact(string memory name, address target, Link[] memory links, bool isLibrary) private view {
        string memory json = _artifact(name);
        bytes memory hexCode = bytes(vm.parseJsonString(json, ".deployedBytecode.object"));
        CodeRange[][] memory linkRanges = _fillLinks(name, json, hexCode, links);
        bytes memory expected = _decodeHex(name, hexCode);
        bytes memory actual = target.code;
        if (actual.length != expected.length) {
            revert BytecodeLengthMismatch(name, target, actual.length, expected.length);
        }
        for (uint256 l; l < links.length; ++l) {
            for (uint256 r; r < linkRanges[l].length; ++r) {
                address found = _readAddress(actual, linkRanges[l][r].start);
                if (found != links[l].at) {
                    revert LinkMismatch(name, links[l].name, linkRanges[l][r].start, found, links[l].at);
                }
            }
        }
        if (isLibrary) {
            if (expected[0] != PUSH20) revert BytecodeMismatch(name, target, 0);
            _writeAddress(expected, 1, target);
        }
        _maskImmutables(json, expected, actual);
        if (keccak256(expected) != keccak256(actual)) {
            revert BytecodeMismatch(name, target, _firstDifference(expected, actual));
        }
    }

    /// @dev Writes each linked library's address into its placeholders in the artifact's hex string, and returns the
    /// byte ranges per entry of `links`. A placeholder for a library `links` does not name reverts.
    function _fillLinks(string memory name, string memory json, bytes memory hexCode, Link[] memory links)
        private
        view
        returns (CodeRange[][] memory ranges)
    {
        ranges = new CodeRange[][](links.length);
        string memory root = ".deployedBytecode.linkReferences";
        string[] memory files = vm.keyExistsJson(json, root) ? vm.parseJsonKeys(json, root) : new string[](0);
        for (uint256 f; f < files.length; ++f) {
            string memory fileKey = string.concat(root, "['", files[f], "']");
            string[] memory libraries = vm.parseJsonKeys(json, fileKey);
            for (uint256 l; l < libraries.length; ++l) {
                uint256 index = _linkIndex(name, links, files[f], libraries[l]);
                CodeRange[] memory refs =
                    abi.decode(vm.parseJson(json, string.concat(fileKey, ".", libraries[l])), (CodeRange[]));
                bytes memory hexAddress = bytes(vm.toString(links[index].at));
                for (uint256 r; r < refs.length; ++r) {
                    uint256 at = 2 + refs[r].start * 2;
                    for (uint256 c; c < 40; ++c) {
                        hexCode[at + c] = hexAddress[2 + c];
                    }
                }
                ranges[index] = refs;
            }
        }
        for (uint256 i; i < links.length; ++i) {
            if (ranges[i].length == 0) revert LinkNotReferenced(name, links[i].name);
        }
    }

    function _linkIndex(string memory name, Link[] memory links, string memory file, string memory libraryName)
        private
        pure
        returns (uint256)
    {
        for (uint256 i; i < links.length; ++i) {
            if (keccak256(bytes(links[i].file)) == keccak256(bytes(file)) && _same(links[i].name, libraryName)) {
                return i;
            }
        }
        revert UnknownLink(name, file, libraryName);
    }

    /// @dev Zeroes every immutable range of the artifact in both codes, since an immutable is written at deploy. An
    /// artifact without immutables has no immutableReferences key.
    function _maskImmutables(string memory json, bytes memory expected, bytes memory actual) private view {
        string memory root = ".deployedBytecode.immutableReferences";
        if (!vm.keyExistsJson(json, root)) return;
        string[] memory ids = vm.parseJsonKeys(json, root);
        for (uint256 i; i < ids.length; ++i) {
            CodeRange[] memory refs = abi.decode(vm.parseJson(json, string.concat(root, ".", ids[i])), (CodeRange[]));
            for (uint256 r; r < refs.length; ++r) {
                for (uint256 b = refs[r].start; b < refs[r].start + refs[r].length; ++b) {
                    expected[b] = 0;
                    actual[b] = 0;
                }
            }
        }
    }

    /// @dev The artifact this checkout's build wrote for a contract whose file shares its name.
    function _artifact(string memory name) private view returns (string memory) {
        string memory out = vm.envOr("FOUNDRY_OUT", string("out"));
        if (bytes(out).length == 0 || bytes(out)[0] != "/") out = string.concat(vm.projectRoot(), "/", out);
        string memory path = string.concat(out, "/", name, ".sol/", name, ".json");
        if (!vm.exists(path)) revert ArtifactMissing(path);
        return vm.readFile(path);
    }

    /// @dev Strict hex decoding of an artifact's bytecode string after its links are filled.
    function _decodeHex(string memory name, bytes memory hexCode) private pure returns (bytes memory code) {
        if (hexCode.length < 2 || hexCode[0] != "0" || hexCode[1] != "x" || hexCode.length % 2 != 0) {
            revert NotHex(name, 0);
        }
        code = new bytes((hexCode.length - 2) / 2);
        for (uint256 i; i < code.length; ++i) {
            code[i] = bytes1((_nibble(name, hexCode[2 + 2 * i], i) << 4) | _nibble(name, hexCode[3 + 2 * i], i));
        }
    }

    function _nibble(string memory name, bytes1 c, uint256 offset) private pure returns (uint8) {
        uint8 v = uint8(c);
        if (v >= 0x30 && v <= 0x39) return v - 0x30;
        if (v >= 0x61 && v <= 0x66) return v - 0x57;
        if (v >= 0x41 && v <= 0x46) return v - 0x37;
        revert NotHex(name, offset);
    }

    function _readAddress(bytes memory code, uint256 offset) private pure returns (address found) {
        uint256 word;
        assembly ("memory-safe") {
            word := mload(add(add(code, 0x20), offset))
        }
        found = address(uint160(word >> 96));
    }

    function _writeAddress(bytes memory code, uint256 offset, address value) private pure {
        bytes20 raw = bytes20(value);
        for (uint256 i; i < 20; ++i) {
            code[offset + i] = raw[i];
        }
    }

    function _firstDifference(bytes memory a, bytes memory b) private pure returns (uint256) {
        for (uint256 i; i < a.length; ++i) {
            if (a[i] != b[i]) return i;
        }
        return a.length;
    }

    // Role events

    function _roleEvent(uint256 index, RoleEvent memory e, bytes32 topic0, bytes32 role, address account) private pure {
        if (e.topic0 != topic0 || e.role != role || e.account != account) {
            revert RoleHistoryMismatch(index, e.topic0, e.role, e.account);
        }
    }

    function _isRoleTopic(bytes32 topic0) private pure returns (bool) {
        return topic0 == IAccessControl.RoleGranted.selector || topic0 == IAccessControl.RoleRevoked.selector
            || topic0 == IAccessControl.RoleAdminChanged.selector;
    }

    function _logs(address emitter, uint256 fromBlock, bytes32 topic0)
        private
        view
        returns (VmSafe.EthGetLogs[] memory found)
    {
        bytes32[] memory topics = new bytes32[](1);
        topics[0] = topic0;
        found = new VmSafe.EthGetLogs[](0);
        for (uint256 start = fromBlock; start <= block.number; start += LOG_WINDOW) {
            uint256 end = start + LOG_WINDOW - 1;
            if (end > block.number) end = block.number;
            VmSafe.EthGetLogs[] memory window = vm.eth_getLogs(start, end, emitter, topics);
            VmSafe.EthGetLogs[] memory joined = new VmSafe.EthGetLogs[](found.length + window.length);
            for (uint256 i; i < found.length; ++i) {
                joined[i] = found[i];
            }
            for (uint256 i; i < window.length; ++i) {
                joined[found.length + i] = window[i];
            }
            found = joined;
        }
    }

    function _fromChain(VmSafe.EthGetLogs memory log) private pure returns (RoleEvent memory) {
        return RoleEvent(log.topics[0], log.topics[1], address(uint160(uint256(log.topics[2]))));
    }

    // Comparisons

    function _code(string memory name, address target, bytes32 expected) private view {
        bytes32 codehash = target.code.length == 0 ? bytes32(0) : keccak256(target.code);
        if (codehash != expected) revert WrongCode(name, target, codehash, expected);
    }

    function _address(string memory what, address value, address expected) private pure {
        if (value != expected) revert UnexpectedAddress(what, value, expected);
    }

    function _uint(string memory what, uint256 value, uint256 expected) private pure {
        if (value != expected) revert UnexpectedUint(what, value, expected);
    }

    function _bytes32(string memory what, bytes32 value, bytes32 expected) private pure {
        if (value != expected) revert UnexpectedBytes32(what, value, expected);
    }

    function _string(string memory what, string memory value, string memory expected) private pure {
        if (!_same(value, expected)) revert UnexpectedString(what, value, expected);
    }

    function _flag(string memory what, bool value, bool expected) private pure {
        if (value != expected) revert UnexpectedFlag(what, value);
    }

    function _same(string memory a, string memory b) private pure returns (bool) {
        return keccak256(bytes(a)) == keccak256(bytes(b));
    }
}
