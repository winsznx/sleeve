// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {SessionCalendarExtension} from "../src/SessionCalendarExtension.sol";
import {TokenSource} from "../src/TokenSource.sol";
import {IAggregatorV3} from "../src/interfaces/IAggregatorV3.sol";
import {ISleeveModule} from "../src/interfaces/ISleeveModule.sol";
import {ISwapRouter02} from "../src/interfaces/ISwapRouter02.sol";
import {SessionCalendar} from "../src/libraries/SessionCalendar.sol";
import {GuardParams} from "../src/types/SleeveTypes.sol";

/// @title DeployConfig
/// @notice Every value the M0 deploy writes to chain 4663, and every outside address the deploy and the read-back
/// check. Sources: the constants table in internal/CLAUDE.md, checked in docs/research/chain-constants.md; the pool
/// allowlist of D-010 (docs/research/pools.md); the timelock of D-009 Q33 and D-018; the module values of SPEC 5 and
/// D-014; the Kernel v3.1 stack of docs/research/g6-notes.md. Public addresses only: no key is read anywhere.
library DeployConfig {
    /// @notice One launch ticker as TokenSource lists it, with what the read-back expects of its token and feed.
    /// @param symbol The token's symbol().
    /// @param token The canonical Stock Token.
    /// @param feed Its Chainlink feed proxy.
    /// @param feedDescription The feed proxy's description(), which tells a swapped feed apart.
    /// @param pools The D-010 allowlist, in the order TokenSource lists it.
    /// @param fees Each pool's fee tier.
    /// @param excluded The ticker's other canonical USDG pools, which must stay off the allowlist.
    struct TickerSpec {
        string symbol;
        address token;
        address feed;
        string feedDescription;
        address[] pools;
        uint24[] fees;
        address[] excluded;
    }

    uint256 internal constant CHAIN_ID = 4663;

    /// @notice Where the mainnet deploy record lives, relative to contracts/.
    string internal constant RECORD_FILE = "deployments/4663.json";

    // Sleeve keys, public addresses only (docs/PROGRESS.md step A).

    /// @notice The timelock's only proposer, canceller and executor on mainnet (D-004, D-009 Q33).
    address internal constant DEPLOYER = 0xe23e8C58371468A98206f07b571cF7E6194abBc1;
    /// @notice The module's default keeper (SPEC 5, B2-7). It has no authority beyond public functions.
    address internal constant KEEPER = 0x8649275ca7ce63d2F9E6487570ec0DCe14b6Bf46;
    /// @notice The payer of the HP1 campaign. The deploy never uses it; the smoke test pays from it on a fork.
    address internal constant TEST_PAYER = 0xC595204eb8c03f3a42EFbf91cd2C7A64C571E2AC;

    // SleeveTimelock (D-009 Q33, D-018, D-019).

    uint256 internal constant TIMELOCK_MIN_DELAY = 172_800;
    uint256 internal constant TIMELOCK_MIN_DELAY_CEILING = 2_592_000;

    // SleeveModule (SPEC 5, D-014).

    /// @notice keccak256 of disclosure candidate 3 (D-014, docs/disclosure/candidate-3.txt).
    bytes32 internal constant DISCLOSURE_HASH = 0x8408c7a59df30d1b5dbec102c388048f2bf8bba21a2e91ac0806df7d68068e89;
    uint256 internal constant GRACE = 3_600;
    uint256 internal constant STOCK_FEED_MAX_AGE = 90_000;
    uint256 internal constant USDG_FEED_MAX_AGE = 90_000;
    uint16 internal constant DEPEG_TOLERANCE_BPS = 50;
    uint256 internal constant MULTIPLIER_WINDOW = 86_400;
    uint16 internal constant MAX_PREMIUM_CAP_BPS = 500;
    uint16 internal constant MAX_SLIPPAGE_BPS = 500;
    uint128 internal constant MIN_CLIP_FLOOR = 1e6;
    uint256 internal constant MODULE_TYPE_EXECUTOR = 2;

    // SessionCalendarExtension as deployed: the library's 2026 and 2027 and no writes.

    uint32 internal constant CALENDAR_VERSION = 0x0001_0000;
    uint256 internal constant CALENDAR_SWITCHES = 4;

    // The constants table (internal/CLAUDE.md), with the code each address holds (chain-constants.md section 1).

    address internal constant USDG = 0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168;
    address internal constant ENTRY_POINT_V07 = 0x0000000071727De22E5E9d8BAf0edAc6f37da032;
    address internal constant PERMIT2 = 0x000000000022D473030F116dDEE9F6B43aC78BA3;
    address internal constant ARB_SYS = 0x0000000000000000000000000000000000000064;
    address internal constant SWAP_ROUTER_02 = 0xCaf681a66D020601342297493863E78C959E5cb2;
    address internal constant V3_FACTORY = 0x1f7d7550B1b028f7571E69A784071F0205FD2EfA;
    address internal constant QUOTER_V2 = 0x33e885eD0Ec9bF04EcfB19341582aADCb4c8A9E7;
    address internal constant UNIVERSAL_ROUTER = 0x204FAca1764B154221e35c0d20aBb3c525710498;
    address internal constant MORPHO_BLUE = 0x9D53d5E3bd5E8d4Cbfa6DB1ca238AEA02E651010;
    address internal constant SPY = 0x117cc2133c37B721F49dE2A7a74833232B3B4C0C;
    address internal constant SPY_FEED = 0x319724394D3A0e3669269846abE664Cd621f9f6A;
    address internal constant QQQ = 0xD5f3879160bc7c32ebb4dC785F8a4F505888de68;
    address internal constant QQQ_FEED = 0x80901d846d5D7B030F26B480776EE3b29374C2ae;
    address internal constant NVDA = 0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC;
    address internal constant NVDA_FEED = 0x379EC4f7C378F34a1B47E4F3cbeBCbAC3E8E9F15;
    address internal constant AAPL = 0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9;
    address internal constant AAPL_FEED = 0x6B22A786bAa607d76728168703a39Ea9C99f2cD0;
    address internal constant USDG_USD_FEED = 0x61B7e5650328764B076A108EFF5fa7282a1B9aD2;

    /// @notice The Stock Token beacon and access-controls registry every launch token reports (D-011).
    address internal constant REGISTRY = 0xe10b6f6B275de231345c20D14Ab812db62151b00;
    /// @notice SwapRouter02's WETH9().
    address internal constant WETH = 0x0Bd7D308f8E1639FAb988df18A8011f41EAcAD73;
    /// @notice The deterministic CREATE2 deployer forge deploys linked libraries through when the chain has it.
    address internal constant CREATE2_DEPLOYER = 0x4e59b44847b379578588920cA78FbF26c0B4956C;

    // Kernel v3.1 as ZeroDev deploys it on 4663 (g6-notes.md sections 1 and 2).

    address internal constant KERNEL_IMPLEMENTATION = 0xBAC849bB641841b44E965fB01A4Bf5F074f84b4D;
    address internal constant KERNEL_FACTORY = 0xaac5D4240AF87249B3f71BC8E4A2cae074A3E419;
    address internal constant KERNEL_META_FACTORY = 0xd703aaE79538628d27099B8c4f621bE4CCd142d5;
    address internal constant ECDSA_VALIDATOR = 0x845ADb2C711129d4f3966735eD98a9F09fC4cE57;
    address internal constant PASSKEY_VALIDATOR = 0x7ab16Ff354AcB328452F1D445b3Ddee9a91e9e69;

    // D-010 allowlist.

    address internal constant SPY_POOL_500 = 0xa7Bb1AC63BBaB0C44316E6c8C455213441689167;
    address internal constant QQQ_POOL_500 = 0xD60A5d14dB690B7Afad71F76B108071D7175597d;
    address internal constant NVDA_POOL_500 = 0xd4EB21209C4D6093f80B5b84f5C45cc093EA14a3;
    address internal constant AAPL_POOL_500 = 0xAae0d815EE56e4092a5E5C2911E676Fea50B2d6D;
    address internal constant AAPL_POOL_3000 = 0x783C9bbB765047CFdD2b84b92b2Ca9F11D34b7Ed;

    // The other canonical USDG pools of the launch tokens (chain-constants.md section 2), kept off the allowlist.

    address internal constant SPY_POOL_100 = 0x62FDE201C424d6d07730B77450Dd73928EBAc5f5;
    address internal constant SPY_POOL_3000 = 0xA43b424Bc609495AED4BCD88d654934b510B0aD9;
    address internal constant QQQ_POOL_100 = 0x4539019B527211998642fEC342C85dcB44c7e5E4;
    address internal constant QQQ_POOL_3000 = 0xEbD78dcfc8a6b3A696f1E191aD1ff321f9579f79;
    address internal constant NVDA_POOL_100 = 0xb75d2D02B0Ec3DE50d32e40A4F1A8DAE8acC4333;
    address internal constant NVDA_POOL_3000 = 0xB944cec30Bd4175855215D767ADC81F39e5f7E2B;
    address internal constant NVDA_POOL_10000 = 0xc277560DF3689A401bA7deDd7626168b234Ceb5e;
    address internal constant AAPL_POOL_10000 = 0x3714aa8105DE1f384481B425788Af413748C1837;

    /// @notice The four launch tickers in id order: SPY 0, QQQ 1, NVDA 2, AAPL 3 (SPEC 3).
    /// @dev Caller: Deploy.deploy, the read-back and the deploy tests.
    function tickers() internal pure returns (TickerSpec[] memory specs) {
        specs = new TickerSpec[](4);
        specs[0] = _spec(
            "SPY", SPY, SPY_FEED, "RHSPY / USD", _one(SPY_POOL_500), _fee(500), _two(SPY_POOL_100, SPY_POOL_3000)
        );
        specs[1] = _spec(
            "QQQ",
            QQQ,
            QQQ_FEED,
            "Robinhood QQQ / USD",
            _one(QQQ_POOL_500),
            _fee(500),
            _two(QQQ_POOL_100, QQQ_POOL_3000)
        );
        address[] memory nvdaExcluded = new address[](3);
        nvdaExcluded[0] = NVDA_POOL_100;
        nvdaExcluded[1] = NVDA_POOL_3000;
        nvdaExcluded[2] = NVDA_POOL_10000;
        specs[2] = _spec("NVDA", NVDA, NVDA_FEED, "RHNVDA / USD", _one(NVDA_POOL_500), _fee(500), nvdaExcluded);
        uint24[] memory aaplFees = new uint24[](2);
        aaplFees[0] = 500;
        aaplFees[1] = 3000;
        specs[3] = _spec(
            "AAPL",
            AAPL,
            AAPL_FEED,
            "Robinhood AAPL / USD",
            _two(AAPL_POOL_500, AAPL_POOL_3000),
            aaplFees,
            _one(AAPL_POOL_10000)
        );
    }

    /// @notice TokenSource's constructor list: every launch ticker with session type ALL_DAY (B2-1) and its pools.
    /// @dev Caller: Deploy.deploy and the deploy tests.
    function tickerInits() internal pure returns (TokenSource.TickerInit[] memory inits) {
        TickerSpec[] memory specs = tickers();
        inits = new TokenSource.TickerInit[](specs.length);
        for (uint256 i; i < specs.length; ++i) {
            inits[i] = TokenSource.TickerInit({
                token: specs[i].token,
                feed: specs[i].feed,
                sessionType: SessionCalendar.SessionType.ALL_DAY,
                pools: specs[i].pools
            });
        }
    }

    /// @notice The D-014 guard limits, written out so a change to PriceGuard's defaults fails the deploy instead of
    /// moving the module's limits: the module's constructor requires these to equal PriceGuard.defaultGuardParams().
    /// @dev Caller: Deploy.deploy and the read-back.
    function guardParams() internal pure returns (GuardParams memory) {
        return GuardParams({
            stockFeedMaxAge: STOCK_FEED_MAX_AGE,
            usdgFeedMaxAge: USDG_FEED_MAX_AGE,
            depegToleranceBps: DEPEG_TOLERANCE_BPS,
            multiplierWindow: MULTIPLIER_WINDOW
        });
    }

    /// @notice SleeveModule's constructor argument for a deployed TokenSource and calendar.
    /// @dev Caller: Deploy.deploy and the deploy tests.
    function moduleConfig(TokenSource tokenSource, SessionCalendarExtension calendar)
        internal
        pure
        returns (ISleeveModule.ModuleConfig memory)
    {
        return ISleeveModule.ModuleConfig({
            usdg: IERC20(USDG),
            tokenSource: tokenSource,
            calendar: calendar,
            swapRouter: ISwapRouter02(SWAP_ROUTER_02),
            usdgUsdFeed: IAggregatorV3(USDG_USD_FEED),
            defaultKeeper: KEEPER,
            disclosureHash: DISCLOSURE_HASH,
            guardParams: guardParams(),
            grace: GRACE
        });
    }

    function _spec(
        string memory symbol,
        address token,
        address feed,
        string memory feedDescription,
        address[] memory pools,
        uint24[] memory fees,
        address[] memory excluded
    ) private pure returns (TickerSpec memory) {
        return TickerSpec({
            symbol: symbol,
            token: token,
            feed: feed,
            feedDescription: feedDescription,
            pools: pools,
            fees: fees,
            excluded: excluded
        });
    }

    function _one(address a) private pure returns (address[] memory list) {
        list = new address[](1);
        list[0] = a;
    }

    function _two(address a, address b) private pure returns (address[] memory list) {
        list = new address[](2);
        list[0] = a;
        list[1] = b;
    }

    function _fee(uint24 fee) private pure returns (uint24[] memory fees) {
        fees = new uint24[](1);
        fees[0] = fee;
    }
}
