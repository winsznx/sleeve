// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {
    MODULE_TYPE_EXECUTOR,
    MODULE_TYPE_FALLBACK,
    MODULE_TYPE_HOOK,
    MODULE_TYPE_VALIDATOR
} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {SessionCalendarExtension} from "../../src/SessionCalendarExtension.sol";
import {SleeveModule} from "../../src/SleeveModule.sol";
import {TokenSource} from "../../src/TokenSource.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {ISwapRouter02} from "../../src/interfaces/ISwapRouter02.sol";
import {SessionCalendar} from "../../src/libraries/SessionCalendar.sol";
import {GuardParams} from "../../src/types/SleeveTypes.sol";
import {SleeveModuleUnitBase} from "../harness/SleeveModuleUnitBase.sol";
import {MockAccount} from "../mocks/MockAccount.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockSwapRouter} from "../mocks/MockSwapRouter.sol";
import {MockTokenSource} from "../mocks/MockTokenSource.sol";
import {OwnerOps} from "../utils/OwnerOps.sol";

/// @notice MockTokenSource plus the factory view the module's constructor checks the router against.
contract FactoryTokenSource is MockTokenSource {
    address public immutable v3Factory;

    constructor(address usdg_, address factory_) MockTokenSource(usdg_) {
        v3Factory = factory_;
    }
}

/// @notice SleeveModule without a fork: the constructor checks, install and uninstall (I5), rules (I9), pause,
/// resume and keeper, and the views. Owner actions run as OwnerOps batches on a MockAccount.
contract SleeveModuleTest is SleeveModuleUnitBase {
    SleeveModule private module;

    function setUp() public {
        _setUpMocks();
        module = _deployModule();
    }

    // Constructor

    function test_constructor_storesTheConfig() public view {
        assertEq(address(module.usdg()), address(usdg));
        assertEq(address(module.tokenSource()), address(tokenSource));
        assertEq(address(module.calendar()), address(calendar));
        assertEq(address(module.swapRouter()), swapRouter);
        assertEq(address(module.usdgUsdFeed()), address(usdgUsdFeed));
        assertEq(module.defaultKeeper(), keeper);
        assertEq(module.disclosureHash(), DISCLOSURE_HASH);
        assertEq(module.grace(), 3_600);
        GuardParams memory params = module.guardParams();
        assertEq(params.stockFeedMaxAge, 90_000);
        assertEq(params.usdgFeedMaxAge, 90_000);
        assertEq(params.depegToleranceBps, 50);
        assertEq(params.multiplierWindow, 86_400);
        assertEq(module.MAX_PREMIUM_CAP_BPS(), 500);
        assertEq(module.MAX_SLIPPAGE_BPS(), 500);
        assertEq(module.MIN_CLIP_FLOOR(), 1e6);
        assertEq(module.nextReceiptId(), 1);
    }

    function test_constructor_rejectsContractAddressesWithoutCode() public {
        address empty = makeAddr("no code");
        for (uint256 field; field < 5; ++field) {
            ISleeveModule.ModuleConfig memory config = _config();
            if (field == 0) config.usdg = IERC20(empty);
            if (field == 1) config.tokenSource = TokenSource(empty);
            if (field == 2) config.calendar = SessionCalendarExtension(empty);
            if (field == 3) config.swapRouter = ISwapRouter02(empty);
            if (field == 4) config.usdgUsdFeed = IAggregatorV3(empty);
            vm.expectRevert(abi.encodeWithSelector(ISleeveModule.NotContract.selector, empty));
            new SleeveModule(config);
        }
    }

    function test_constructor_rejectsUsdgThatIsNotSixDecimals() public {
        usdg.setDecimals(18);
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.UnexpectedDecimals.selector, address(usdg), 18, 6));
        new SleeveModule(_config());
    }

    function test_constructor_rejectsAUsdgFeedThatIsNotEightDecimals() public {
        usdgUsdFeed.setDecimals(18);
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.UnexpectedDecimals.selector, address(usdgUsdFeed), 18, 8));
        new SleeveModule(_config());
    }

    function test_constructor_rejectsATokenSourceOnAnotherUsdg() public {
        MockERC20 otherUsdg = new MockERC20("Other", "USDG", 6);
        ISleeveModule.ModuleConfig memory config = _config();
        config.usdg = IERC20(address(otherUsdg));
        vm.expectRevert(
            abi.encodeWithSelector(ISleeveModule.TokenSourceUsdgMismatch.selector, address(usdg), address(otherUsdg))
        );
        new SleeveModule(config);
    }

    function test_constructor_rejectsZeroKeeperAndDisclosureHash() public {
        ISleeveModule.ModuleConfig memory config = _config();
        config.defaultKeeper = address(0);
        vm.expectRevert(ISleeveModule.ZeroDefaultKeeper.selector);
        new SleeveModule(config);

        config = _config();
        config.disclosureHash = bytes32(0);
        vm.expectRevert(ISleeveModule.ZeroDisclosureHash.selector);
        new SleeveModule(config);
    }

    /// D-019: the module is immutable, so the grace is exactly 3,600 seconds, longer or shorter alike refused.
    function test_constructor_rejectsAnyGraceButOneHour() public {
        uint256[4] memory graces = [uint256(0), 3_599, 3_601, 1 days];
        for (uint256 i; i < graces.length; ++i) {
            ISleeveModule.ModuleConfig memory config = _config();
            config.grace = graces[i];
            vm.expectRevert(abi.encodeWithSelector(ISleeveModule.GraceNotDefault.selector, graces[i]));
            new SleeveModule(config);
        }
    }

    /// D-019: the guard limits are exactly PriceGuard.defaultGuardParams(). A change in either direction is refused,
    /// including values that would once have passed, such as a 10,000 bps depeg tolerance.
    function test_constructor_rejectsGuardParamsOtherThanTheDefaults() public {
        for (uint256 field; field < 8; ++field) {
            ISleeveModule.ModuleConfig memory config = _config();
            if (field == 0) config.guardParams.stockFeedMaxAge = 0;
            if (field == 1) config.guardParams.stockFeedMaxAge = 25 hours + 1;
            if (field == 2) config.guardParams.usdgFeedMaxAge = 25 hours - 1;
            if (field == 3) config.guardParams.usdgFeedMaxAge = 30 days;
            if (field == 4) config.guardParams.multiplierWindow = 0;
            if (field == 5) config.guardParams.multiplierWindow = 24 hours + 1;
            if (field == 6) config.guardParams.depegToleranceBps = 49;
            if (field == 7) config.guardParams.depegToleranceBps = 10_000;
            vm.expectRevert(ISleeveModule.GuardParamsNotDefault.selector);
            new SleeveModule(config);
        }
    }

    /// D-019: the router must derive pools from the factory TokenSource checks the allowlist against.
    function test_constructor_rejectsARouterOnAnotherFactory() public {
        MockSwapRouter elsewhere = new MockSwapRouter(makeAddr("other factory"), FAIR_PRICE);
        ISleeveModule.ModuleConfig memory config = _config();
        config.swapRouter = ISwapRouter02(address(elsewhere));
        vm.expectRevert(
            abi.encodeWithSelector(
                ISleeveModule.RouterFactoryMismatch.selector, makeAddr("other factory"), address(factory)
            )
        );
        new SleeveModule(config);
    }

    /// D-019: the calendar must answer version(), which every receipt records.
    function test_constructor_rejectsACalendarThatDoesNotAnswerVersion() public {
        ISleeveModule.ModuleConfig memory config = _config();
        config.calendar = SessionCalendarExtension(address(usdg));
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.CalendarProbeFailed.selector, address(usdg)));
        new SleeveModule(config);
    }

    function test_isModuleType_isAnExecutorOnly() public view {
        assertTrue(module.isModuleType(MODULE_TYPE_EXECUTOR));
        assertFalse(module.isModuleType(MODULE_TYPE_VALIDATOR));
        assertFalse(module.isModuleType(MODULE_TYPE_FALLBACK));
        assertFalse(module.isModuleType(MODULE_TYPE_HOOK));
        assertFalse(module.isModuleType(0));
    }

    // Install: I5

    function test_I5_usdgHeldAtInstallIsSpendAndALaterPaymentIsExactlyUnsorted() public {
        MockAccount account = _accountWith(address(module), 500e6, "");
        _assertLedger(address(account), 500e6, 500e6, 0, 0);

        _pay(address(account), 70e6);

        _assertLedger(address(account), 570e6, 500e6, 0, 70e6);
    }

    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_I5_installSnapshotNeverLeavesUnsortedAndInflowIsExact(uint128 balance, uint128 inflow) public {
        MockAccount account = _accountWith(address(module), balance, "");
        _assertLedger(address(account), balance, balance, 0, 0);

        usdg.mint(address(account), inflow);

        _assertLedger(address(account), uint256(balance) + inflow, balance, 0, inflow);
    }

    function test_onInstall_withoutDataTakesTheDefaultKeeperAndNoRule() public {
        MockAccount account = new MockAccount();
        usdg.mint(address(account), 40e6);
        vm.expectEmit(address(module));
        emit ISleeveModule.Installed(address(account), keeper, 40e6);
        account.installModule(MODULE_TYPE_EXECUTOR, address(module), "");

        assertTrue(module.isInitialized(address(account)));
        assertEq(module.keeperOf(address(account)), keeper);
        ISleeveModule.Rule memory rule = module.ruleOf(address(account));
        assertEq(rule.version, 0);
        assertEq(uint8(rule.status), uint8(ISleeveModule.RuleStatus.NONE));
    }

    function test_onInstall_withAKeeperAndARuleSetsBoth() public {
        address ownKeeper = makeAddr("own keeper");
        ISleeveModule.RuleInput memory input = _defaultRule();
        MockAccount account = new MockAccount();
        vm.expectEmit(address(module));
        emit ISleeveModule.Installed(address(account), ownKeeper, 0);
        vm.expectEmit(address(module));
        emit ISleeveModule.RuleSet(address(account), 1, _stored(input, 1, ISleeveModule.RuleStatus.ACTIVE));
        account.installModule(MODULE_TYPE_EXECUTOR, address(module), _installData(ownKeeper, input));

        assertEq(module.keeperOf(address(account)), ownKeeper);
        _assertRule(address(account), input, 1, ISleeveModule.RuleStatus.ACTIVE);
    }

    function test_onInstall_zeroKeeperMeansTheDefaultKeeper() public {
        MockAccount account = _accountWith(address(module), 0, _installData(address(0), _defaultRule()));
        assertEq(module.keeperOf(address(account)), keeper);
        _assertRule(address(account), _defaultRule(), 1, ISleeveModule.RuleStatus.ACTIVE);
    }

    function test_onInstall_anAllZeroRuleMeansNoRule() public {
        ISleeveModule.RuleInput memory empty;
        address ownKeeper = makeAddr("own keeper");
        MockAccount account = _accountWith(address(module), 0, _installData(ownKeeper, empty));
        assertEq(module.keeperOf(address(account)), ownKeeper);
        assertEq(uint8(module.ruleOf(address(account)).status), uint8(ISleeveModule.RuleStatus.NONE));
    }

    function test_onInstall_anInvalidRuleRevertsTheInstall() public {
        ISleeveModule.RuleInput memory input = _defaultRule();
        input.spendBps = 8_000;
        MockAccount account = new MockAccount();
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.SharesSumNotTotal.selector, 8_000, 1_000));
        account.installModule(MODULE_TYPE_EXECUTOR, address(module), _installData(address(0), input));
        assertFalse(module.isInitialized(address(account)));
    }

    function test_onInstall_rejectsDataOfAnyOtherLength() public {
        uint256[4] memory lengths = [uint256(1), 32, 223, 225];
        MockAccount account = new MockAccount();
        for (uint256 i; i < lengths.length; ++i) {
            vm.expectRevert(abi.encodeWithSelector(ISleeveModule.InvalidInstallData.selector, lengths[i]));
            account.installModule(MODULE_TYPE_EXECUTOR, address(module), new bytes(lengths[i]));
        }
    }

    /// Kernel v3.1 calls onInstall again for an executor that is already installed, and after an onUninstall it
    /// ignored. Either way the state starts over from a fresh snapshot (D-009 Q20).
    function test_onInstall_againOverwritesEveryPartOfTheState() public {
        MockAccount account = _accountWith(address(module), 100e6, _installData(makeAddr("k"), _defaultRule()));
        _ownerOp(account, OwnerOps.pauseRule(address(module)));
        _pay(address(account), 30e6);
        _assertLedger(address(account), 130e6, 100e6, 0, 30e6);

        account.installModule(MODULE_TYPE_EXECUTOR, address(module), "");

        _assertLedger(address(account), 130e6, 130e6, 0, 0);
        assertEq(module.keeperOf(address(account)), keeper);
        ISleeveModule.Rule memory rule = module.ruleOf(address(account));
        assertEq(rule.version, 0);
        assertEq(uint8(rule.status), uint8(ISleeveModule.RuleStatus.NONE));
    }

    /// D-015: any caller can register itself, and it reaches only its own state.
    function test_D015_aCallerThatInstallsForItselfOnlyReachesItsOwnState() public {
        MockAccount account = _accountWith(address(module), 100e6, "");
        address impostor = makeAddr("impostor");
        usdg.mint(impostor, 5e6);

        vm.startPrank(impostor);
        module.onInstall(_installData(impostor, _defaultRule()));
        module.setKeeper(address(0));
        module.pauseRule();
        vm.stopPrank();

        _assertLedger(impostor, 5e6, 5e6, 0, 0);
        _assertLedger(address(account), 100e6, 100e6, 0, 0);
        assertEq(module.keeperOf(address(account)), keeper);
        assertEq(uint8(module.ruleOf(address(account)).status), uint8(ISleeveModule.RuleStatus.NONE));
    }

    // Uninstall

    function test_onUninstall_deletesLedgersRuleKeeperAndKeepsTheAccountsUsdg() public {
        MockAccount account = _accountWith(address(module), 100e6, _installData(address(0), _defaultRule()));
        _pay(address(account), 10e6);

        vm.expectEmit(address(module));
        emit ISleeveModule.Uninstalled(address(account), 0);
        _ownerOp(account, OwnerOps.uninstall(address(module), address(account)));

        assertFalse(module.isInitialized(address(account)));
        _assertLedger(address(account), 110e6, 0, 0, 0);
        assertEq(module.keeperOf(address(account)), address(0));
        ISleeveModule.Rule memory rule = module.ruleOf(address(account));
        assertEq(rule.version, 0);
        assertEq(uint8(rule.status), uint8(ISleeveModule.RuleStatus.NONE));
        assertEq(rule.minClip, 0);
        assertEq(usdg.balanceOf(address(account)), 110e6, "uninstall moves no funds");
    }

    function test_onUninstall_revertsForACallerThatNeverInstalled() public {
        address stranger = makeAddr("stranger");
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.NotInstalled.selector, stranger));
        vm.prank(stranger);
        module.onUninstall("");
    }

    /// D-019: rule versions only go up per account, across uninstall and reinstall, so (account, version) names one
    /// rule for good.
    function test_reinstall_takesAFreshSnapshotAndRuleVersionsKeepCounting() public {
        MockAccount account = _accountWith(address(module), 100e6, _installData(address(0), _defaultRule()));
        _ownerOp(account, OwnerOps.setRule(address(module), _defaultRule()));
        assertEq(module.ruleOf(address(account)).version, 2);
        _ownerOp(account, OwnerOps.uninstall(address(module), address(account)));
        assertEq(module.ruleOf(address(account)).version, 0, "no rule while uninstalled");
        _pay(address(account), 45e6);

        account.installModule(MODULE_TYPE_EXECUTOR, address(module), _installData(address(0), _defaultRule()));

        _assertLedger(address(account), 145e6, 145e6, 0, 0);
        assertEq(module.ruleOf(address(account)).version, 3, "the version after the last one before the uninstall");
        _ownerOp(account, OwnerOps.setRule(address(module), _defaultRule()));
        assertEq(module.ruleOf(address(account)).version, 4);
    }

    /// D-019: an install without a rule, then a rule, also continues the count.
    function test_reinstall_withoutARuleKeepsTheCountForTheNextRule() public {
        MockAccount account = _accountWith(address(module), 0, _installData(address(0), _defaultRule()));
        account.installModule(MODULE_TYPE_EXECUTOR, address(module), "");
        assertEq(module.ruleOf(address(account)).version, 0, "the overwrite dropped the rule");

        _ownerOp(account, OwnerOps.setRule(address(module), _defaultRule()));

        assertEq(module.ruleOf(address(account)).version, 2);
    }

    // Rules: I9

    function test_I9_setRule_writesTheNextVersionAndActivates() public {
        MockAccount account = _accountWith(address(module), 0, "");
        ISleeveModule.RuleInput memory input = _defaultRule();

        vm.expectEmit(address(module));
        emit ISleeveModule.RuleSet(address(account), 1, _stored(input, 1, ISleeveModule.RuleStatus.ACTIVE));
        _ownerOp(account, OwnerOps.setRule(address(module), input));
        _assertRule(address(account), input, 1, ISleeveModule.RuleStatus.ACTIVE);

        input = ISleeveModule.RuleInput({
            spendBps: 5_000, equityBps: 5_000, tickerId: NVDA, premiumCapBps: 500, slippageBps: 0, minClip: 1e6
        });
        _ownerOp(account, OwnerOps.setRule(address(module), input));
        _assertRule(address(account), input, 2, ISleeveModule.RuleStatus.ACTIVE);
    }

    function test_I9_setRule_rejectsSharesThatDoNotSumToTenThousand() public {
        MockAccount account = _accountWith(address(module), 0, "");
        uint16[2][4] memory pairs = [[uint16(9_000), 999], [uint16(9_000), 1_001], [uint16(10_000), 1], [uint16(0), 0]];
        for (uint256 i; i < pairs.length; ++i) {
            ISleeveModule.RuleInput memory input = _defaultRule();
            (input.spendBps, input.equityBps) = (pairs[i][0], pairs[i][1]);
            vm.expectRevert(abi.encodeWithSelector(ISleeveModule.SharesSumNotTotal.selector, pairs[i][0], pairs[i][1]));
            _ownerOp(account, OwnerOps.setRule(address(module), input));
        }
        ISleeveModule.RuleInput memory allSpend = _defaultRule();
        (allSpend.spendBps, allSpend.equityBps) = (10_000, 0);
        _ownerOp(account, OwnerOps.setRule(address(module), allSpend));
        ISleeveModule.RuleInput memory allEquity = _defaultRule();
        (allEquity.spendBps, allEquity.equityBps) = (0, 10_000);
        _ownerOp(account, OwnerOps.setRule(address(module), allEquity));
        assertEq(module.ruleOf(address(account)).equityBps, 10_000);
    }

    function test_setRule_rejectsATickerTokenSourceNeverListed() public {
        MockAccount account = _accountWith(address(module), 0, "");
        uint8[2] memory ids = [uint8(TICKER_COUNT), type(uint8).max];
        for (uint256 i; i < ids.length; ++i) {
            ISleeveModule.RuleInput memory input = _defaultRule();
            input.tickerId = ids[i];
            vm.expectRevert(abi.encodeWithSelector(ISleeveModule.TickerNotListed.selector, ids[i]));
            _ownerOp(account, OwnerOps.setRule(address(module), input));
        }
    }

    function test_setRule_rejectsARemovedTicker() public {
        MockAccount account = _accountWith(address(module), 0, "");
        tokenSource.removeTicker(QQQ);
        ISleeveModule.RuleInput memory input = _defaultRule();
        input.tickerId = QQQ;
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.TickerNotActive.selector, QQQ));
        _ownerOp(account, OwnerOps.setRule(address(module), input));
    }

    function test_setRule_rejectsATickerWithoutAFeed() public {
        MockAccount account = _accountWith(address(module), 0, "");
        ISleeveModule.RuleInput memory input = _defaultRule();
        input.tickerId = NO_FEED;
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.TickerHasNoFeed.selector, NO_FEED));
        _ownerOp(account, OwnerOps.setRule(address(module), input));
    }

    /// TokenSource never lists a feed without a session, so this check needs a source that does.
    function test_setRule_rejectsATickerWithoutASession() public {
        MockTokenSource source = new FactoryTokenSource(address(usdg), address(factory));
        source.list(address(tokens[SPY]), address(usdgUsdFeed), SessionCalendar.SessionType.NONE, true);
        ISleeveModule.ModuleConfig memory config = _config();
        config.tokenSource = TokenSource(address(source));
        SleeveModule other = new SleeveModule(config);
        MockAccount account = _accountWith(address(other), 0, "");

        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.TickerHasNoSession.selector, SPY));
        _ownerOp(account, OwnerOps.setRule(address(other), _defaultRule()));
    }

    function test_setRule_capsAndClipAtTheirEdges() public {
        MockAccount account = _accountWith(address(module), 0, "");
        ISleeveModule.RuleInput memory input = _defaultRule();
        (input.premiumCapBps, input.slippageBps, input.minClip) = (500, 500, 1e6);
        _ownerOp(account, OwnerOps.setRule(address(module), input));
        _assertRule(address(account), input, 1, ISleeveModule.RuleStatus.ACTIVE);
        (input.premiumCapBps, input.slippageBps) = (0, 0);
        _ownerOp(account, OwnerOps.setRule(address(module), input));
        _assertRule(address(account), input, 2, ISleeveModule.RuleStatus.ACTIVE);

        input = _defaultRule();
        input.premiumCapBps = 501;
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.PremiumCapAboveMax.selector, 501, 500));
        _ownerOp(account, OwnerOps.setRule(address(module), input));

        input = _defaultRule();
        input.slippageBps = 501;
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.SlippageAboveMax.selector, 501, 500));
        _ownerOp(account, OwnerOps.setRule(address(module), input));

        input = _defaultRule();
        input.minClip = 1e6 - 1;
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.MinClipBelowFloor.selector, 1e6 - 1, 1e6));
        _ownerOp(account, OwnerOps.setRule(address(module), input));

        assertEq(module.ruleOf(address(account)).version, 2, "failed edits leave the rule");
    }

    function test_setRule_onAPausedRuleWritesANewActiveVersion() public {
        MockAccount account = _accountWith(address(module), 0, _installData(address(0), _defaultRule()));
        _ownerOp(account, OwnerOps.pauseRule(address(module)));
        _ownerOp(account, OwnerOps.setRule(address(module), _defaultRule()));
        _assertRule(address(account), _defaultRule(), 2, ISleeveModule.RuleStatus.ACTIVE);
    }

    function test_ownerFunctions_revertForACallerWithoutTheModule() public {
        address stranger = makeAddr("stranger");
        bytes memory notInstalled = abi.encodeWithSelector(ISleeveModule.NotInstalled.selector, stranger);
        vm.startPrank(stranger);
        vm.expectRevert(notInstalled);
        module.setRule(_defaultRule());
        vm.expectRevert(notInstalled);
        module.pauseRule();
        vm.expectRevert(notInstalled);
        module.resumeRule();
        vm.expectRevert(notInstalled);
        module.setKeeper(stranger);
        vm.stopPrank();
    }

    /// I9 against a reference model: each low bit of `shape` pulls one field into its valid range, so every check is
    /// reached from both sides, and bit 5 removes QQQ first.
    /// forge-config: default.fuzz.runs = 10000
    function testFuzz_I9_setRuleAcceptsExactlyTheValidRules(
        uint16 spendBps,
        uint16 equityBps,
        uint8 tickerId,
        uint16 premiumCapBps,
        uint16 slippageBps,
        uint128 minClip,
        uint8 shape
    ) public {
        if (shape & 1 != 0) {
            equityBps = uint16(_bound(equityBps, 0, 10_000));
            spendBps = 10_000 - equityBps;
        }
        if (shape & 2 != 0) tickerId = uint8(_bound(tickerId, 0, TICKER_COUNT));
        if (shape & 4 != 0) premiumCapBps = uint16(_bound(premiumCapBps, 0, 501));
        if (shape & 8 != 0) slippageBps = uint16(_bound(slippageBps, 0, 501));
        if (shape & 16 != 0) minClip = uint128(_bound(minClip, 1e6 - 1, 1e12));
        bool qqqRemoved = shape & 32 != 0;
        if (qqqRemoved) tokenSource.removeTicker(QQQ);
        MockAccount account = _accountWith(address(module), 0, "");
        ISleeveModule.RuleInput memory input = ISleeveModule.RuleInput({
            spendBps: spendBps,
            equityBps: equityBps,
            tickerId: tickerId,
            premiumCapBps: premiumCapBps,
            slippageBps: slippageBps,
            minClip: minClip
        });

        bytes memory expected = _expectedRuleError(input, qqqRemoved);
        if (expected.length != 0) vm.expectRevert(expected);
        _ownerOp(account, OwnerOps.setRule(address(module), input));

        if (expected.length == 0) {
            _assertRule(address(account), input, 1, ISleeveModule.RuleStatus.ACTIVE);
            assertEq(uint256(10_000) - module.ruleOf(address(account)).equityBps, spendBps, "I9: shares sum");
        } else {
            assertEq(module.ruleOf(address(account)).version, 0, "a rejected rule writes nothing");
        }
    }

    // Pause, resume and keeper

    function test_pauseAndResume_keepTheVersionAndFlipTheStatus() public {
        MockAccount account = _accountWith(address(module), 0, _installData(address(0), _defaultRule()));

        vm.expectEmit(address(module));
        emit ISleeveModule.RulePaused(address(account), 1);
        _ownerOp(account, OwnerOps.pauseRule(address(module)));
        _assertRule(address(account), _defaultRule(), 1, ISleeveModule.RuleStatus.PAUSED);

        vm.expectEmit(address(module));
        emit ISleeveModule.RuleResumed(address(account), 1);
        _ownerOp(account, OwnerOps.resumeRule(address(module)));
        _assertRule(address(account), _defaultRule(), 1, ISleeveModule.RuleStatus.ACTIVE);
    }

    function test_pauseAndResume_revertWhenThereIsNothingToChange() public {
        MockAccount account = _accountWith(address(module), 0, "");
        bytes memory noRule = abi.encodeWithSelector(ISleeveModule.NoRule.selector, address(account));
        vm.expectRevert(noRule);
        _ownerOp(account, OwnerOps.pauseRule(address(module)));
        vm.expectRevert(noRule);
        _ownerOp(account, OwnerOps.resumeRule(address(module)));

        _ownerOp(account, OwnerOps.setRule(address(module), _defaultRule()));
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.RuleNotPaused.selector, address(account)));
        _ownerOp(account, OwnerOps.resumeRule(address(module)));

        _ownerOp(account, OwnerOps.pauseRule(address(module)));
        vm.expectRevert(abi.encodeWithSelector(ISleeveModule.RuleNotActive.selector, address(account)));
        _ownerOp(account, OwnerOps.pauseRule(address(module)));
    }

    function test_setKeeper_replacesTheKeeperAndZeroLeavesNone() public {
        MockAccount account = _accountWith(address(module), 0, "");
        address next = makeAddr("next keeper");

        vm.expectEmit(address(module));
        emit ISleeveModule.KeeperSet(address(account), next);
        _ownerOp(account, OwnerOps.setKeeper(address(module), next));
        assertEq(module.keeperOf(address(account)), next);

        _ownerOp(account, OwnerOps.setKeeper(address(module), address(0)));
        assertEq(module.keeperOf(address(account)), address(0));
    }

    // Views

    function test_views_forAnAccountWithoutTheModule() public {
        address nobody = makeAddr("nobody");
        usdg.mint(nobody, 9e6);
        _assertLedger(nobody, 9e6, 0, 0, 0);
        assertFalse(module.isInitialized(nobody));
        assertEq(module.keeperOf(nobody), address(0));
        assertEq(module.bucketOf(nobody, SPY).amount, 0);
        assertFalse(module.ownerOpOpen(nobody));
        assertEq(module.receiptHash(1), bytes32(0));
    }

    // Helpers

    function _expectedRuleError(ISleeveModule.RuleInput memory input, bool qqqRemoved)
        private
        pure
        returns (bytes memory)
    {
        if (uint256(input.spendBps) + input.equityBps != 10_000) {
            return abi.encodeWithSelector(ISleeveModule.SharesSumNotTotal.selector, input.spendBps, input.equityBps);
        }
        if (input.tickerId >= TICKER_COUNT) {
            return abi.encodeWithSelector(ISleeveModule.TickerNotListed.selector, input.tickerId);
        }
        if (qqqRemoved && input.tickerId == QQQ) {
            return abi.encodeWithSelector(ISleeveModule.TickerNotActive.selector, input.tickerId);
        }
        if (input.tickerId == NO_FEED) {
            return abi.encodeWithSelector(ISleeveModule.TickerHasNoFeed.selector, input.tickerId);
        }
        if (input.premiumCapBps > 500) {
            return abi.encodeWithSelector(ISleeveModule.PremiumCapAboveMax.selector, input.premiumCapBps, 500);
        }
        if (input.slippageBps > 500) {
            return abi.encodeWithSelector(ISleeveModule.SlippageAboveMax.selector, input.slippageBps, 500);
        }
        if (input.minClip < 1e6) {
            return abi.encodeWithSelector(ISleeveModule.MinClipBelowFloor.selector, input.minClip, 1e6);
        }
        return "";
    }

    function _stored(ISleeveModule.RuleInput memory input, uint32 version, ISleeveModule.RuleStatus status)
        private
        pure
        returns (ISleeveModule.Rule memory)
    {
        return ISleeveModule.Rule({
            version: version,
            status: status,
            equityBps: input.equityBps,
            tickerId: input.tickerId,
            premiumCapBps: input.premiumCapBps,
            slippageBps: input.slippageBps,
            minClip: input.minClip
        });
    }

    function _assertRule(
        address account,
        ISleeveModule.RuleInput memory input,
        uint32 version,
        ISleeveModule.RuleStatus status
    ) private view {
        ISleeveModule.Rule memory rule = module.ruleOf(account);
        assertEq(rule.version, version, "rule version");
        assertEq(uint8(rule.status), uint8(status), "rule status");
        assertEq(rule.equityBps, input.equityBps, "equityBps");
        assertEq(rule.tickerId, input.tickerId, "tickerId");
        assertEq(rule.premiumCapBps, input.premiumCapBps, "premiumCapBps");
        assertEq(rule.slippageBps, input.slippageBps, "slippageBps");
        assertEq(rule.minClip, input.minClip, "minClip");
    }

    function _assertLedger(address account, uint256 balance, uint256 spend, uint256 pendingTotal, uint256 unsorted)
        private
        view
    {
        (uint256 actualBalance, uint256 actualSpend, uint256 actualPending, uint256 actualUnsorted) =
            module.ledger(account);
        assertEq(actualBalance, balance, "balance");
        assertEq(actualSpend, spend, "spend");
        assertEq(actualPending, pendingTotal, "pendingTotal");
        assertEq(actualUnsorted, unsorted, "unsorted");
    }
}
