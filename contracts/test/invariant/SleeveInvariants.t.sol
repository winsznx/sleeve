// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Test} from "forge-std/Test.sol";
import {StdInvariant} from "forge-std/StdInvariant.sol";
import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {MODULE_TYPE_EXECUTOR} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {SessionCalendarExtension} from "../../src/SessionCalendarExtension.sol";
import {SleeveModule} from "../../src/SleeveModule.sol";
import {TokenSource} from "../../src/TokenSource.sol";
import {IAggregatorV3} from "../../src/interfaces/IAggregatorV3.sol";
import {ISleeveModule} from "../../src/interfaces/ISleeveModule.sol";
import {ISwapRouter02} from "../../src/interfaces/ISwapRouter02.sol";
import {PriceGuard} from "../../src/libraries/PriceGuard.sol";
import {SessionCalendar} from "../../src/libraries/SessionCalendar.sol";
import {InvFactory} from "../mocks/InvFactory.sol";
import {InvPool} from "../mocks/InvPool.sol";
import {InvRouter} from "../mocks/InvRouter.sol";
import {MockAccount} from "../mocks/MockAccount.sol";
import {MockERC20} from "../mocks/MockERC20.sol";
import {MockFeed} from "../mocks/MockFeed.sol";
import {MockRegistry} from "../mocks/MockRegistry.sol";
import {MockStockToken} from "../mocks/MockStockToken.sol";
import {Chain4663} from "../utils/Chain4663.sol";
import {ArbSysMock} from "../utils/ForkBase.sol";
import {SleeveHandler} from "./handlers/SleeveHandler.sol";
import {SleeveModel} from "./handlers/SleeveModel.sol";
import {InvDeployment} from "./handlers/SleeveWorld.sol";

/// @notice Deploys the real SleeveModule, TokenSource and SessionCalendarExtension over the invariant suite's mocks,
/// and the handler that drives them. Without a timelock the test contract is the admin of TokenSource and the calendar,
/// so it answers the two SleeveTimelock views the module's constructor reads from that admin (audit A1-26).
abstract contract SleeveInvariantBase is Test {
    /// @notice SleeveTimelock's floor, as the module's constructor reads it from the admin.
    uint256 public constant MIN_DELAY_FLOOR = 172_800;

    /// @dev Monday 5 October 2026 10:00 EDT, 14:00Z: inside both the ALL_DAY and the REGULAR session, with the rest
    /// of the trading week ahead.
    uint256 internal constant NOW = 1_791_208_800;
    /// @dev Returned by the ArbSys mock as the L2 block.
    uint256 internal constant L2_BLOCK = 78_312_136;
    bytes32 internal constant DISCLOSURE_HASH = 0x8408c7a59df30d1b5dbec102c388048f2bf8bba21a2e91ac0806df7d68068e89;
    uint8 internal constant V_I2 = 0;
    uint8 internal constant V_I3 = 1;
    uint8 internal constant V_I4 = 2;
    uint8 internal constant V_I6 = 3;
    uint8 internal constant V_I7 = 4;
    uint8 internal constant V_I8 = 5;
    uint8 internal constant V_MODEL = 6;
    uint8 internal constant V_I10 = 7;
    uint8 internal constant V_I1 = 8;
    uint8 internal constant V_KINDS = 9;
    uint256 internal constant ACTIONS = 39;

    SleeveHandler internal handler;
    SleeveModule internal module;
    MockERC20 internal usdg;
    MockStockToken[4] internal tokens;
    InvRouter internal router;
    address internal keeper = makeAddr("keeper");

    /// @notice SleeveTimelock's view: the delay in force, here the floor.
    function getMinDelay() external pure returns (uint256) {
        return MIN_DELAY_FLOOR;
    }

    function _deploy() internal {
        _deploy(address(0));
    }

    /// @param timelock The admin of TokenSource and the calendar. Zero makes the test contract the admin, so the
    /// handler can write as it without the 48-hour wait.
    function _deploy(address timelock) internal {
        vm.warp(NOW);
        vm.roll(L2_BLOCK);
        vm.etch(Chain4663.ARB_SYS, address(new ArbSysMock()).code);
        usdg = new MockERC20("Global Dollar", "USDG", 6);
        MockRegistry registry = new MockRegistry();
        InvFactory factory = new InvFactory();
        MockFeed[3] memory feeds;
        int256[3] memory answers = [int256(500e8), 400e8, 150e8];
        string[4] memory symbols = ["SPY", "QQQ", "NVDA", "NOFEED"];
        for (uint256 i; i < 4; ++i) {
            tokens[i] = new MockStockToken(symbols[i], symbols[i], address(registry));
            tokens[i].setUid(keccak256(abi.encode("uid", i)));
            if (i < 3) {
                feeds[i] = new MockFeed(8, symbols[i]);
                feeds[i].setRound(1, answers[i], NOW - 10 minutes);
            }
        }
        MockFeed usdgFeed = new MockFeed(8, "USDG / USD");
        usdgFeed.setRound(1, 1e8, NOW - 10 minutes);

        // Pools: SPY 500, SPY 3000, SPY 100 (not allowlisted), QQQ 500, NVDA 500, NVDA 3000 (not allowlisted),
        // NOFEED 500.
        uint8[7] memory poolTickers = [0, 0, 0, 1, 2, 2, 3];
        uint24[7] memory fees = [uint24(500), 3000, 100, 500, 500, 3000, 500];
        InvPool[] memory pools = new InvPool[](7);
        uint8[] memory poolTicker = new uint8[](7);
        for (uint256 i; i < 7; ++i) {
            MockStockToken token = tokens[poolTickers[i]];
            pools[i] = new InvPool(IERC20(address(usdg)), IERC20(address(token)), fees[i], 100e8);
            factory.register(address(usdg), address(token), fees[i], address(pools[i]));
            token.mint(address(pools[i]), 1e40);
            poolTicker[i] = poolTickers[i];
        }
        address admin = timelock == address(0) ? address(this) : timelock;
        TokenSource tokenSource = new TokenSource(admin, address(usdg), address(factory), _tickers(feeds, pools));
        SessionCalendarExtension calendar = new SessionCalendarExtension(admin);
        router = new InvRouter(address(factory));
        module = new SleeveModule(
            ISleeveModule.ModuleConfig({
                usdg: IERC20(address(usdg)),
                tokenSource: tokenSource,
                calendar: calendar,
                swapRouter: ISwapRouter02(address(router)),
                usdgUsdFeed: IAggregatorV3(address(usdgFeed)),
                defaultKeeper: keeper,
                disclosureHash: DISCLOSURE_HASH,
                guardParams: PriceGuard.defaultGuardParams(),
                grace: 3_600
            })
        );
        handler = new SleeveHandler(
            InvDeployment({
                module: module,
                usdg: usdg,
                tokens: tokens,
                feeds: feeds,
                usdgFeed: usdgFeed,
                registry: registry,
                tokenSource: tokenSource,
                calendar: calendar,
                router: router,
                pools: pools,
                poolTicker: poolTicker,
                admin: admin,
                defaultKeeper: keeper
            })
        );
        handler.bootstrap();
    }

    function _tickers(MockFeed[3] memory feeds, InvPool[] memory pools)
        private
        view
        returns (TokenSource.TickerInit[] memory tickers)
    {
        tickers = new TokenSource.TickerInit[](4);
        tickers[0] = _ticker(0, address(feeds[0]), SessionCalendar.SessionType.ALL_DAY, _two(pools[0], pools[1]));
        tickers[1] = _ticker(1, address(feeds[1]), SessionCalendar.SessionType.REGULAR, _one(pools[3]));
        tickers[2] = _ticker(2, address(feeds[2]), SessionCalendar.SessionType.ALL_DAY, _one(pools[4]));
        tickers[3] = _ticker(3, address(0), SessionCalendar.SessionType.NONE, _one(pools[6]));
    }

    function _ticker(uint256 index, address feed, SessionCalendar.SessionType sessionType, address[] memory pools)
        private
        view
        returns (TokenSource.TickerInit memory)
    {
        return
            TokenSource.TickerInit({token: address(tokens[index]), feed: feed, sessionType: sessionType, pools: pools});
    }

    function _one(InvPool pool) private pure returns (address[] memory list) {
        list = new address[](1);
        list[0] = address(pool);
    }

    function _two(InvPool a, InvPool b) private pure returns (address[] memory list) {
        list = new address[](2);
        list[0] = address(a);
        list[1] = address(b);
    }

    /// @dev Every handler action with its weight: how many times it appears in the fuzzer's selector list, which is
    /// how often the fuzzer picks it. Payments and the keeper's triggers lead, market moves follow, and the actions
    /// that take an account out of service are rare, so most of a run trades.
    function _actions() internal pure returns (bytes4[] memory selectors, uint256[] memory weights) {
        selectors = new bytes4[](ACTIONS);
        weights = new uint256[](ACTIONS);
        (selectors[0], weights[0]) = (SleeveHandler.pay.selector, 3);
        (selectors[1], weights[1]) = (SleeveHandler.payThenKeeperSplit.selector, 6);
        (selectors[2], weights[2]) = (SleeveHandler.payThenOwnerSplit.selector, 3);
        (selectors[3], weights[3]) = (SleeveHandler.thirdPartyPull.selector, 2);
        (selectors[4], weights[4]) = (SleeveHandler.keeperSplit.selector, 3);
        (selectors[5], weights[5]) = (SleeveHandler.publicSplit.selector, 3);
        (selectors[6], weights[6]) = (SleeveHandler.ownerSplit.selector, 2);
        (selectors[7], weights[7]) = (SleeveHandler.observe.selector, 1);
        (selectors[8], weights[8]) = (SleeveHandler.keeperSettle.selector, 6);
        (selectors[9], weights[9]) = (SleeveHandler.publicSettle.selector, 3);
        (selectors[10], weights[10]) = (SleeveHandler.ownerBatch.selector, 4);
        (selectors[11], weights[11]) = (SleeveHandler.release.selector, 1);
        (selectors[12], weights[12]) = (SleeveHandler.setRule.selector, 2);
        (selectors[13], weights[13]) = (SleeveHandler.pauseOrResumeRule.selector, 1);
        (selectors[14], weights[14]) = (SleeveHandler.setKeeper.selector, 1);
        (selectors[15], weights[15]) = (SleeveHandler.approvePuller.selector, 1);
        (selectors[16], weights[16]) = (SleeveHandler.moveTokensOut.selector, 1);
        (selectors[17], weights[17]) = (SleeveHandler.uninstall.selector, 1);
        (selectors[18], weights[18]) = (SleeveHandler.reinstall.selector, 1);
        (selectors[19], weights[19]) = (SleeveHandler.hostileCall.selector, 1);
        (selectors[20], weights[20]) = (SleeveHandler.marketTick.selector, 5);
        (selectors[21], weights[21]) = (SleeveHandler.moveFeed.selector, 2);
        (selectors[22], weights[22]) = (SleeveHandler.moveUsdgFeed.selector, 2);
        (selectors[23], weights[23]) = (SleeveHandler.pauseToken.selector, 2);
        (selectors[24], weights[24]) = (SleeveHandler.blockAddress.selector, 2);
        (selectors[25], weights[25]) = (SleeveHandler.scheduleMultiplier.selector, 1);
        (selectors[26], weights[26]) = (SleeveHandler.setPoolBehavior.selector, 3);
        (selectors[27], weights[27]) = (SleeveHandler.warp.selector, 2);
        (selectors[28], weights[28]) = (SleeveHandler.warpToSessionEdge.selector, 2);
        (selectors[29], weights[29]) = (SleeveHandler.adminRemoveTicker.selector, 1);
        (selectors[30], weights[30]) = (SleeveHandler.adminSetPool.selector, 1);
        (selectors[31], weights[31]) = (SleeveHandler.adminCalendarWrite.selector, 1);
        (selectors[32], weights[32]) = (SleeveHandler.payThenSplitOnFaultyPool.selector, 1);
        (selectors[33], weights[33]) = (SleeveHandler.ownerSellsTokens.selector, 1);
        (selectors[34], weights[34]) = (SleeveHandler.donateToModule.selector, 1);
        (selectors[35], weights[35]) = (SleeveHandler.postRoundAroundOpen.selector, 2);
        (selectors[36], weights[36]) = (SleeveHandler.drainThenTopUp.selector, 1);
        (selectors[37], weights[37]) = (SleeveHandler.sell.selector, 4);
        (selectors[38], weights[38]) = (SleeveHandler.reconcileLots.selector, 1);
    }

    /// @dev The selector list for targetSelector, each action repeated by its weight.
    function _weightedSelectors() internal pure returns (bytes4[] memory list) {
        (bytes4[] memory selectors, uint256[] memory weights) = _actions();
        uint256 total;
        for (uint256 i; i < weights.length; ++i) {
            total += weights[i];
        }
        list = new bytes4[](total);
        uint256 next;
        for (uint256 i; i < selectors.length; ++i) {
            for (uint256 w; w < weights[i]; ++w) {
                list[next++] = selectors[i];
            }
        }
    }

    /// @dev One handler action from two seeds, as the fuzzer would call it.
    function _step(bytes4 selector, uint256 a, uint256 b) internal {
        uint256 c = uint256(keccak256(abi.encode(a, b)));
        uint256 d = uint256(keccak256(abi.encode(c)));
        if (selector == SleeveHandler.pay.selector) handler.pay(a, b);
        else if (selector == SleeveHandler.payThenKeeperSplit.selector) handler.payThenKeeperSplit(a, b, c, d);
        else if (selector == SleeveHandler.payThenOwnerSplit.selector) handler.payThenOwnerSplit(a, b, c, d);
        else if (selector == SleeveHandler.thirdPartyPull.selector) handler.thirdPartyPull(a, b);
        else if (selector == SleeveHandler.keeperSplit.selector) handler.keeperSplit(a, b, c, d);
        else if (selector == SleeveHandler.publicSplit.selector) handler.publicSplit(a, b, c, d);
        else if (selector == SleeveHandler.ownerSplit.selector) handler.ownerSplit(a, b, c, d % 2 == 0);
        else if (selector == SleeveHandler.observe.selector) handler.observe(a);
        else if (selector == SleeveHandler.keeperSettle.selector) handler.keeperSettle(a, b, c, d);
        else if (selector == SleeveHandler.publicSettle.selector) handler.publicSettle(a, b, c, d, a ^ b);
        else if (selector == SleeveHandler.ownerBatch.selector) handler.ownerBatch(a, b, c);
        else if (selector == SleeveHandler.release.selector) handler.release(a, b, c % 2 == 0);
        else if (selector == SleeveHandler.setRule.selector) handler.setRule(a, b, c % 2 == 0);
        else if (selector == SleeveHandler.pauseOrResumeRule.selector) handler.pauseOrResumeRule(a, b);
        else if (selector == SleeveHandler.setKeeper.selector) handler.setKeeper(a, b);
        else if (selector == SleeveHandler.approvePuller.selector) handler.approvePuller(a, b);
        else if (selector == SleeveHandler.moveTokensOut.selector) handler.moveTokensOut(a, b, c);
        else if (selector == SleeveHandler.uninstall.selector) handler.uninstall(a, b);
        else if (selector == SleeveHandler.reinstall.selector) handler.reinstall(a, b, c);
        else if (selector == SleeveHandler.hostileCall.selector) handler.hostileCall(a);
        else if (selector == SleeveHandler.marketTick.selector) handler.marketTick(a, b);
        else if (selector == SleeveHandler.moveFeed.selector) handler.moveFeed(a, b, c);
        else if (selector == SleeveHandler.moveUsdgFeed.selector) handler.moveUsdgFeed(a, b);
        else if (selector == SleeveHandler.pauseToken.selector) handler.pauseToken(a, b);
        else if (selector == SleeveHandler.blockAddress.selector) handler.blockAddress(a, b);
        else if (selector == SleeveHandler.scheduleMultiplier.selector) handler.scheduleMultiplier(a, b, c);
        else if (selector == SleeveHandler.setPoolBehavior.selector) handler.setPoolBehavior(a, b, c);
        else if (selector == SleeveHandler.warp.selector) handler.warp(a);
        else if (selector == SleeveHandler.warpToSessionEdge.selector) handler.warpToSessionEdge(a);
        else if (selector == SleeveHandler.adminRemoveTicker.selector) handler.adminRemoveTicker(a);
        else if (selector == SleeveHandler.adminSetPool.selector) handler.adminSetPool(a);
        else if (selector == SleeveHandler.adminCalendarWrite.selector) handler.adminCalendarWrite(a, b);
        else if (selector == SleeveHandler.payThenSplitOnFaultyPool.selector) handler.payThenSplitOnFaultyPool(a, b, c);
        else if (selector == SleeveHandler.ownerSellsTokens.selector) handler.ownerSellsTokens(a, b);
        else if (selector == SleeveHandler.donateToModule.selector) handler.donateToModule(a, b);
        else if (selector == SleeveHandler.postRoundAroundOpen.selector) handler.postRoundAroundOpen(a, b);
        else if (selector == SleeveHandler.sell.selector) handler.sell(a, b, c % 2 == 0);
        else if (selector == SleeveHandler.reconcileLots.selector) handler.reconcileLots(a, b, c % 2 == 0);
        else handler.drainThenTopUp(a, b, c);
    }

    function _assertNoViolation(uint8 kind) internal view {
        assertEq(handler.violations(kind), 0, handler.firstViolation(kind));
    }

    // The checks. Each invariant function runs one; the reach test runs all of them after every action.

    /// @notice Every check, as an external call so a long loop of them does not grow one call frame's memory.
    function checkEverything() external view {
        _checkEverything();
    }

    function _checkEverything() internal view {
        _checkI1();
        _assertNoViolation(V_I2);
        _assertNoViolation(V_I3);
        _checkI4();
        _checkI6();
        _checkI7();
        _assertNoViolation(V_I8);
        _assertNoViolation(V_I10);
        _checkPendingTotal();
        _checkLedgersWithinBalance();
        _checkModel();
    }

    function _checkI1() internal view {
        assertEq(usdg.balanceOf(address(module)), handler.donated(0), "I1: module USDG is not the donations");
        assertEq(usdg.balanceOf(address(router)), 0, "router holds USDG");
        for (uint256 i; i < tokens.length; ++i) {
            assertEq(tokens[i].balanceOf(address(module)), handler.donated(i + 1), "I1: module stock token");
            assertEq(tokens[i].balanceOf(address(router)), 0, "router holds a stock token");
        }
        assertEq(address(module).balance, handler.donatedEther(), "I1: module ether is not the donations");
        _assertNoViolation(V_I1);
    }

    function _checkI4() internal view {
        for (uint256 i; i < 3; ++i) {
            address account = handler.accountAt(i);
            assertEq(usdg.allowance(account, address(router)), 0, "I4: USDG allowance to the router");
            for (uint256 t; t < tokens.length; ++t) {
                assertEq(tokens[t].allowance(account, address(router)), 0, "I4: token allowance to the router");
            }
        }
        _assertNoViolation(V_I4);
    }

    function _checkI6() internal view {
        for (uint256 i; i < 3; ++i) {
            address account = handler.accountAt(i);
            if (!module.isInitialized(account)) continue;
            (uint256 balance, uint256 spend, uint256 pendingTotal, uint256 unsorted) = module.ledger(account);
            assertEq(unsorted, handler.ghostIncomeWaiting(account), "I6: unsorted is not the income waiting");
            uint256 shortfall = spend + pendingTotal > balance ? spend + pendingTotal - balance : 0;
            assertEq(shortfall, handler.ghostDeficit(account), "I6: the shortfall is not the unreconciled pulls");
        }
        _assertNoViolation(V_I6);
    }

    function _checkI7() internal view {
        uint256 last = handler.lastReceiptId();
        assertEq(module.nextReceiptId(), last + 1, "I7: next receipt id");
        assertEq(module.receiptHash(last + 1), bytes32(0), "I7: hash past the last id");
        for (uint256 id = 1; id <= last; ++id) {
            bytes32 recorded = handler.receiptHashAt(id);
            assertTrue(recorded != bytes32(0), "I7: receipt id never seen");
            assertEq(module.receiptHash(id), recorded, "I7: stored hash changed");
        }
        uint256[] memory lotIds = handler.lotIds();
        for (uint256 i; i < lotIds.length; ++i) {
            assertEq(abi.encode(module.lot(lotIds[i])), abi.encode(handler.ghostLot(lotIds[i])), "I7: a lot changed");
        }
        for (uint256 i; i < 3; ++i) {
            address account = handler.accountAt(i);
            for (uint8 t; t < 4; ++t) {
                (uint256[] memory ids, uint256 head) = module.lotsOf(account, t);
                assertEq(abi.encode(ids), abi.encode(handler.ghostLotQueue(account, t)), "I7: lot list");
                assertEq(head, handler.ghostLotHead(account, t), "I7: lot head");
            }
        }
        _assertNoViolation(V_I7);
    }

    function _checkPendingTotal() internal view {
        for (uint256 i; i < 3; ++i) {
            address account = handler.accountAt(i);
            (,, uint256 pendingTotal,) = module.ledger(account);
            uint256 buckets;
            for (uint8 t; t < 4; ++t) {
                buckets += module.bucketOf(account, t).amount;
            }
            assertEq(pendingTotal, buckets, "pendingTotal is not the sum of the buckets");
        }
    }

    function _checkLedgersWithinBalance() internal view {
        for (uint256 i; i < 3; ++i) {
            address account = handler.accountAt(i);
            if (!module.isInitialized(account) || handler.ghostDeficit(account) != 0) continue;
            (uint256 balance, uint256 spend, uint256 pendingTotal,) = module.ledger(account);
            assertLe(spend + pendingTotal, balance, "spend plus pending above the balance");
        }
    }

    function _checkModel() internal view {
        _assertNoViolation(V_MODEL);
        for (uint256 i; i < 3; ++i) {
            address account = handler.accountAt(i);
            SleeveModel.Acct memory g = handler.ghostOf(account);
            assertEq(module.isInitialized(account), g.installed, "installed");
            assertEq(
                MockAccount(account).isModuleInstalled(MODULE_TYPE_EXECUTOR, address(module), ""), g.listed, "listed"
            );
            (, uint256 spend, uint256 pendingTotal,) = module.ledger(account);
            assertEq(spend, g.spend, "spend");
            uint256 pending;
            for (uint8 t; t < 4; ++t) {
                ISleeveModule.Bucket memory bucket = module.bucketOf(account, t);
                assertEq(bucket.amount, g.amount[t], "bucket amount");
                assertEq(bucket.since, g.since[t], "bucket since");
                assertEq(uint8(bucket.reason), uint8(g.reason[t]), "bucket reason");
                pending += g.amount[t];
            }
            assertEq(pendingTotal, pending, "pendingTotal");
            assertEq(abi.encode(module.ruleOf(account)), abi.encode(g.rule), "rule");
            assertEq(module.keeperOf(account), g.keeper, "keeper");
            (uint64 observedAt, uint128 observedUnsorted) = module.observationOf(account);
            assertEq(observedAt, g.observedAt, "observedAt");
            assertEq(observedUnsorted, g.observedUnsorted, "observedUnsorted");
        }
    }
}

/// @notice Stateful invariants of SleeveModule (components 5 and 6) over random sequences of payments, splits and
/// settles by every trigger, releases, sells and lot reconciles, bracketed owner batches with inflows, outflows, owner
/// sales outside Sleeve and module actions, outside pulls, donations to the module, rule and keeper edits, uninstall and
/// reinstall, market changes and the timelock's writes. Every call is also checked against SleeveModel, which predicts
/// its revert or each event it emits, receipts field by field, and every balance it moves.
/// forge-config: default.invariant.runs = 256
/// forge-config: default.invariant.depth = 64
/// forge-config: default.invariant.fail-on-revert = false
contract SleeveInvariantsTest is SleeveInvariantBase {
    function setUp() public {
        _deploy();
        targetContract(address(handler));
        targetSelector(StdInvariant.FuzzSelector({addr: address(handler), selectors: _weightedSelectors()}));
    }

    /// I1: no module action changes the module's own balances, buys and sells alike. Strangers can send it USDG, stock
    /// tokens and ether, which it can neither refuse nor return, so it holds exactly what was donated, and every call
    /// that reached the module left its USDG and stock token balances as they were, measured around the call (audit
    /// A1-01). The router never holds either asset.
    function invariant_I1_moduleBalancesMoveOnlyByDonation() public view {
        _checkI1();
    }

    /// I2: every split receipt has usdgIn == usdgToSpend + usdgSpent + usdgQueued, with the equity part the floor of
    /// the rule's share, so the dust, under one base unit, goes to spend.
    function invariant_I2_everySplitReceiptConservesUsdg() public view {
        _assertNoViolation(V_I2);
    }

    /// I3: the tokens a fill reports reached the account, by balance.
    function invariant_I3_boughtTokensLandInTheAccount() public view {
        _assertNoViolation(V_I3);
    }

    /// I4: the router's USDG and stock token allowances are zero for every account after every call, and every USDG
    /// and token movement a call made is one it was allowed: USDG left an account only as the input of a buy of the
    /// equity part or the bucket, never more than the split sorted or the bucket held, and only to that buy's pool;
    /// tokens left only as a sell's input, exactly the amount sold, and only to that sell's pool. A pool that asks for
    /// more than the order offered is stopped by the exact approval.
    function invariant_I4_onlyTheVenueWithExactApprovalReset() public view {
        _checkI4();
    }

    /// I6: USDG that entered through a bracket or a module action, a sell's proceeds among them, is never split.
    /// Unsorted USDG equals the income waiting, which only payments from outsiders feed, the ledgers exceed the balance
    /// by exactly the outside pulls not yet reconciled, no split sorted more than was waiting, and neither an owner
    /// inflow nor a sale's proceeds land while a pull still owes part of a bucket (audit I-01, I-03).
    function invariant_I6_onlyIncomeIsEverSplit() public view {
        _checkI6();
    }

    /// I7: receipt ids run from 1 without gaps, every stored hash is the hash written with it and never changes, and
    /// every lot, with its queue and head, is exactly what its fill, the sells that took from it (FILLED or SETTLED to
    /// PART_SOLD or SOLD, PART_SOLD to PART_SOLD or SOLD, never past SOLD) and the lot reconciles left.
    function invariant_I7_receiptIdsIncreaseAndHashesNeverChange() public view {
        _checkI7();
    }

    /// I8: every FILLED or SETTLED receipt paid at most its rule's cap above the round it recorded, and that round was
    /// the feed's latest, positive, at most 25 hours old and from the open session, with the token and its oracle
    /// unpaused, no multiplier change due, the account and pool unblocked and USDG within its band.
    function invariant_I8_everyFillWithinItsCapOnAFreshUnpausedRound() public view {
        _assertNoViolation(V_I8);
    }

    /// I10: the timelock's writes, ticker removal, pool changes and calendar closures, move no balance; the ledgers,
    /// buckets, rules and keepers they leave are checked against the model after every call.
    function invariant_I10_timelockWritesMoveNoFunds() public view {
        _assertNoViolation(V_I10);
    }

    /// pendingTotal is the sum of the account's buckets, for every account.
    function invariant_pendingTotalIsTheSumOfBuckets() public view {
        _checkPendingTotal();
    }

    /// Spend plus pendingTotal never exceeds the balance once a split has reconciled the ledgers: only a pull from
    /// outside Sleeve can push them above it, and the next split brings them back down.
    function invariant_spendPlusPendingWithinTheBalanceAfterAReconcile() public view {
        _checkLedgersWithinBalance();
    }

    /// The module's state for every account equals the model's ghost, and every call reverted or emitted exactly as
    /// the model predicted.
    function invariant_moduleMatchesTheModel() public view {
        _checkModel();
    }
}
