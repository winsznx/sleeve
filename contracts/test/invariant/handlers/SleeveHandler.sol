// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {Execution, MODULE_TYPE_EXECUTOR} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {ERC7579Utils} from "@openzeppelin/contracts/account/utils/draft-ERC7579Utils.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {SessionCalendarExtension} from "../../../src/SessionCalendarExtension.sol";
import {TokenSource} from "../../../src/TokenSource.sol";
import {ISleeveModule} from "../../../src/interfaces/ISleeveModule.sol";
import {ISwapRouter02} from "../../../src/interfaces/ISwapRouter02.sol";
import {SessionCalendar} from "../../../src/libraries/SessionCalendar.sol";
import {Status} from "../../../src/types/SleeveTypes.sol";
import {InvPool} from "../../mocks/InvPool.sol";
import {InvRelay} from "../../mocks/InvRelay.sol";
import {MockAccount} from "../../mocks/MockAccount.sol";
import {MockStockToken} from "../../mocks/MockStockToken.sol";
import {UsdgPayer} from "../../mocks/UsdgPayer.sol";
import {InvDeployment} from "./SleeveWorld.sol";
import {SleeveModel} from "./SleeveModel.sol";

/// @notice The invariant suite's fuzz target: payments, splits and settles by every trigger with grace warps,
/// releases, sells through the module and lot reconciles, owner batches with inflows, outflows, owner sales outside
/// Sleeve and module actions inside their brackets, outside pulls and drains through an old approval, donations to the
/// module, rule and keeper edits, uninstall and reinstall, and the market around them: feed rounds, their age and
/// rounds around a session's opening, the USDG/USD feed, token and oracle pauses, blocks, multiplier schedules, the
/// session clock, the venue's price and faults, and the timelock's writes. Every call that reaches the module runs
/// through the model in SleeveModel.
/// @dev Inputs are bounded here, so a call reverts only where the model predicts it. Pauses, blocks and venue faults
/// last one to eight handler calls and then lift, so a run sees both a disturbed and a healthy market, and buckets that
/// queued under a disturbance get settled once it lifts. Account 0 is the steady account: lifecycle actions pick it a
/// seventh of the time, so most runs keep one account with a live rule.
///
/// Sell-back (component 6): sell runs as a top-level owner call and as a SELL step inside a bracket, by amount from the
/// lot head or by lot id, at the pool's sell price, now and then with the off-hours override, a widened or out of range
/// discount cap, a quote the pool cannot meet, a foreign or unknown lot, or more than the lots or the balance hold. Its
/// proceeds come from the pools' sell side, the path SWAP_OUT also runs. reconcileLots runs the same two ways and trims
/// the lots that TOKENS_OUT and SWAP_OUT push above the balance. The I7 check compares every lot and each lot head with
/// the ghost, and the reach test expects PART_SOLD and SOLD.
contract SleeveHandler is SleeveModel {
    bytes32 private constant SINGLE = bytes32(0);
    bytes32 private constant BATCH = bytes32(uint256(1) << 248);

    /// @dev Price of the pool for the ticker with no feed.
    uint256 private constant NO_FEED_PRICE = 100e8;
    /// @dev Handler calls a disturbance lasts at most.
    uint256 private constant MAX_DISTURBANCE = 8;
    /// @dev Steps an owner batch draws at random: INFLOW to RECONCILE_LOTS.
    uint256 private constant RANDOM_STEPS = 10;
    /// @dev Calls a single step adds to a batch at most: SWAP_OUT's approval, swap and reset.
    uint256 private constant CALLS_PER_STEP = 3;
    /// @dev USDG each pool holds at the start, to pay for owner sales.
    uint256 private constant POOL_USDG = 1e18;

    /// @dev Steps of an owner batch, between beginOwnerOp and endOwnerOp.
    enum Step {
        INFLOW,
        OUTFLOW,
        SPLIT,
        SETTLE,
        RELEASE,
        APPROVE,
        TOKENS_OUT,
        SWAP_OUT,
        SELL,
        RECONCILE_LOTS,
        RELAY,
        UNINSTALL,
        REINSTALL
    }

    /// @dev An owner batch under construction. drain makes every outflow take the whole balance.
    struct Batch {
        Step[] steps;
        Execution[] calls;
        uint256 count;
        uint256 reserve;
        uint256 seed;
        bool drain;
    }

    /// @dev A market disturbance that lifts once `calls` reaches `until`.
    enum Kind {
        TOKEN_PAUSE,
        ORACLE_PAUSE,
        BLOCK,
        POOL_FAULT
    }

    struct Disturbance {
        Kind kind;
        address target;
        uint256 until;
    }

    /// @notice Premium each pool charges over its ticker's feed answer, in basis points.
    mapping(address pool => int256) public poolPremiumBps;

    /// @notice Handler calls made so far in the run.
    uint256 public calls;

    Disturbance[] private _disturbances;

    /// @dev Counts the call and lifts every disturbance that has run its course.
    modifier step() {
        ++calls;
        lastOutcome = bytes4(0xffffffff);
        lastReceipts = 0;
        _lift();
        _;
    }

    constructor(InvDeployment memory d) SleeveModel(d) {}

    /// @notice Pays and installs the three accounts with their first rules, through the model. Called once by setUp.
    function bootstrap() external {
        usdg.mint(address(wallet), 1e30);
        for (uint256 i; i < pools.length; ++i) {
            usdg.mint(address(pools[i]), POOL_USDG);
        }
        poolPremiumBps[address(pools[0])] = 20;
        poolPremiumBps[address(pools[1])] = 60;
        poolPremiumBps[address(pools[2])] = -10;
        poolPremiumBps[address(pools[3])] = 5;
        poolPremiumBps[address(pools[4])] = -30;
        poolPremiumBps[address(pools[5])] = 40;
        _reprice();
        ISleeveModule.RuleInput[3] memory rules = [
            ISleeveModule.RuleInput(9_000, 1_000, 0, 100, 50, 25e6),
            ISleeveModule.RuleInput(5_000, 5_000, 2, 300, 100, 1e6),
            ISleeveModule.RuleInput(7_000, 3_000, 1, 0, 0, 5e6)
        ];
        address[3] memory keepers = [address(0), keeper2, defaultKeeper];
        uint256[3] memory balances = [uint256(1_000e6), 0, 250e6];
        for (uint256 i; i < ACCOUNTS; ++i) {
            if (balances[i] != 0) usdg.mint(address(accounts[i]), balances[i]);
            _install("bootstrap", address(accounts[i]), keepers[i], rules[i], true);
        }
    }

    // Payments and outside pulls

    /// @notice A payment from an outsider: the only income.
    function pay(uint256 accountSeed, uint256 amountSeed) external step {
        _pay(_account(accountSeed), amountSeed);
    }

    function payThenKeeperSplit(uint256 accountSeed, uint256 amountSeed, uint256 poolSeed, uint256 quoteSeed)
        external
        step
    {
        address account = _account(accountSeed);
        _pay(account, amountSeed);
        _split("payThenKeeperSplit", account, _keeperOf(account), poolSeed, quoteSeed);
    }

    /// @notice A payment, then the owner sorts it from the app: a bracketed owner op, or a bare split call.
    function payThenOwnerSplit(uint256 accountSeed, uint256 amountSeed, uint256 poolSeed, uint256 quoteSeed)
        external
        step
    {
        address account = _account(accountSeed);
        _pay(account, amountSeed);
        _ownerSplit(account, poolSeed, quoteSeed, amountSeed % 2 == 0);
    }

    /// @notice A payment, then the keeper's split on a pool that breaks for this one call: it fills part of the order,
    /// reverts, or delivers less than it reports. The split must revert and move nothing.
    function payThenSplitOnFaultyPool(uint256 accountSeed, uint256 amountSeed, uint256 faultSeed) external step {
        address account = _splitTarget(accountSeed);
        _pay(account, amountSeed);
        Acct memory g = _ghost[account];
        address[] memory allowed = tokenSource.poolsOf(g.rule.tickerId);
        if (allowed.length == 0) return;
        InvPool pool = InvPool(allowed[faultSeed % allowed.length]);
        uint256 mode = (faultSeed >> 8) % 4;
        if (mode == 0) pool.setFillBps(_partialFillBps(faultSeed >> 16));
        else if (mode == 1) pool.setUnavailable(true);
        else if (mode == 2) pool.setFillBps(_overchargeBps(faultSeed >> 16));
        else pool.setWithheldBps(uint16(_pick(faultSeed >> 16, 1, 3_000)));
        _disturb(Kind.POOL_FAULT, address(pool), 0);
        uint256 quote = 1e26 / pool.priceE8() * (BPS - _pick(faultSeed >> 32, 0, 40)) / BPS;
        Ctx memory c = _begin("payThenSplitOnFaultyPool", account, _keeperOf(account));
        _modelSplit(c, g, address(pool), quote);
        _run(
            c,
            g,
            _keeperOf(account),
            address(module),
            abi.encodeCall(ISleeveModule.split, (account, address(pool), quote))
        );
    }

    /// @notice A third party pulls USDG through an approval the owner gave earlier, outside any bracket, a quarter of
    /// the time as much as it can. The pull comes out of the income waiting first, as the module sees it: as less
    /// income (D-013). The rest is a deficit the next split reconciles, unless income arrives first and pays it down.
    function thirdPartyPull(uint256 accountSeed, uint256 amountSeed) external step {
        _pull(_account(accountSeed), amountSeed);
    }

    /// @notice A third party drains the account through an old approval, which the owner gave first if there was
    /// none, and then the owner tops up from another wallet in a bracketed op, now and then settling a bucket in the
    /// same batch, or sells lot tokens through the module before the top-up. PRD 7.2 books the drain spend first, then
    /// the buckets; the top-up and the sale's proceeds are owner money, which must land whole in spend and never in
    /// pending equity (I6, audit I-01 and I-03), and a settle must wait for the reconcile (I4, audit I-02).
    function drainThenTopUp(uint256 accountSeed, uint256 amountSeed, uint256 shapeSeed) external step {
        address account = _account(accountSeed);
        if (!_ghost[account].installed || !_ghost[account].listed) return;
        if (usdg.allowance(account, puller) < usdg.balanceOf(account)) {
            Acct memory g = _ghost[account];
            Ctx memory c = _begin("approve the puller", account, account);
            _modelBegin(c, g);
            _modelEnd(c, g);
            bytes memory call = abi.encodeCall(IERC20.approve, (puller, type(uint256).max));
            _run(c, g, address(this), account, _bracketed(address(usdg), call));
        }
        _pull(account, amountSeed << 2);
        uint256 shape = shapeSeed % 3;
        Step[] memory steps = new Step[](shape == 2 ? 1 : 2);
        steps[0] = shape == 1 ? Step.SELL : Step.INFLOW;
        if (shape == 0) steps[1] = Step.SETTLE;
        else if (shape == 1) steps[1] = Step.INFLOW;
        _ownerBatch(
            account,
            Batch({steps: steps, calls: new Execution[](0), count: 0, reserve: 0, seed: shapeSeed, drain: false})
        );
    }

    /// @dev The pull, a quarter of the time as much as the approval and the balance allow.
    function _pull(address account, uint256 amountSeed) internal {
        uint256 balance = usdg.balanceOf(account);
        uint256 limit = usdg.allowance(account, puller);
        if (limit > balance) limit = balance;
        if (limit == 0) return;
        uint256 amount = amountSeed % 4 == 0 ? limit : _pick(amountSeed >> 2, 1, limit);
        if (_ghost[account].installed) {
            uint256 waiting = ghostIncomeWaiting[account];
            uint256 fromIncome = amount > waiting ? waiting : amount;
            ghostIncomeWaiting[account] = waiting - fromIncome;
            ghostDeficit[account] += amount - fromIncome;
            Acct memory g = _ghost[account];
            if (ghostDeficit[account] > g.spend && _pending(g) != 0) ++pullsIntoBuckets;
        }
        vm.prank(puller);
        require(IERC20(address(usdg)).transferFrom(account, puller, amount), "pull");
    }

    // Triggers

    function keeperSplit(uint256 accountSeed, uint256 poolSeed, uint256 quoteSeed, uint256 actorSeed) external step {
        address account = _splitTarget(accountSeed);
        address caller = _keeperOf(account);
        if (actorSeed % 4 == 0) caller = caller == keeper2 ? defaultKeeper : keeper2;
        _split("keeperSplit", account, caller, poolSeed, quoteSeed);
    }

    /// @notice A stranger's split: often an observe first, then a wait around the grace.
    function publicSplit(uint256 accountSeed, uint256 poolSeed, uint256 quoteSeed, uint256 waitSeed) external step {
        address account = _splitTarget(accountSeed);
        if (waitSeed % 3 != 0) _observe("publicSplit observe", account);
        _warpBy(_pick(waitSeed >> 8, 0, 2 * GRACE));
        _split("publicSplit", account, stranger, poolSeed, quoteSeed);
    }

    function ownerSplit(uint256 accountSeed, uint256 poolSeed, uint256 quoteSeed, bool bracketed) external step {
        _ownerSplit(_splitTarget(accountSeed), poolSeed, quoteSeed, bracketed);
    }

    function observe(uint256 accountSeed) external step {
        _observe("observe", _account(accountSeed));
    }

    function keeperSettle(uint256 accountSeed, uint256 tickerSeed, uint256 poolSeed, uint256 quoteSeed) external step {
        (address account, uint8 tickerId) = _settleTarget(accountSeed, tickerSeed);
        _settle("keeperSettle", account, _keeperOf(account), tickerId, poolSeed, quoteSeed);
    }

    function publicSettle(
        uint256 accountSeed,
        uint256 tickerSeed,
        uint256 poolSeed,
        uint256 quoteSeed,
        uint256 waitSeed
    ) external step {
        (address account, uint8 tickerId) = _settleTarget(accountSeed, tickerSeed);
        if (waitSeed % 3 != 0) _observe("publicSettle observe", account);
        _warpBy(_pick(waitSeed >> 8, 0, 2 * GRACE));
        _settle("publicSettle", account, stranger, tickerId, poolSeed, quoteSeed);
    }

    // Owner actions

    /// @notice An owner batch as the app builds it: beginOwnerOp, one to four steps, endOwnerOp, sometimes a third
    /// party's split from inside the bracket, sometimes ending in an uninstall, or an uninstall and a reinstall inside
    /// the same bracket. Now and then the owner sends out the whole balance and then splits income that arrived before
    /// the batch, which the split must still sort from the balance at begin.
    function ownerBatch(uint256 accountSeed, uint256 shapeSeed, uint256 amountSeed) external step {
        if ((shapeSeed >> 52) % 12 == 0) {
            Step[] memory drainThenSplit = new Step[](2);
            drainThenSplit[0] = Step.OUTFLOW;
            drainThenSplit[1] = Step.SPLIT;
            _ownerBatch(
                _splitTarget(accountSeed),
                Batch({
                    steps: drainThenSplit,
                    calls: new Execution[](0),
                    count: 0,
                    reserve: 0,
                    seed: amountSeed,
                    drain: true
                })
            );
            return;
        }
        uint256 count = 1 + shapeSeed % 4;
        Step[] memory steps = new Step[](count + 3);
        for (uint256 i; i < count; ++i) {
            steps[i] = Step((shapeSeed >> (8 + 4 * i)) % RANDOM_STEPS);
        }
        if ((shapeSeed >> 48) % 24 == 0) steps[0] = Step.RELAY;
        uint256 tail = (shapeSeed >> 40) % 16;
        if (tail == 0) {
            steps[count++] = Step.UNINSTALL;
        } else if (tail == 1) {
            steps[count++] = Step.UNINSTALL;
            steps[count++] = Step.REINSTALL;
            steps[count++] = Step.INFLOW;
        }
        assembly ("memory-safe") {
            mstore(steps, count)
        }
        _ownerBatch(
            _account(accountSeed),
            Batch({steps: steps, calls: new Execution[](0), count: 0, reserve: 0, seed: amountSeed, drain: false})
        );
    }

    function release(uint256 accountSeed, uint256 tickerSeed, bool bracketed) external step {
        address account = _account(accountSeed);
        for (uint256 i; i < ACCOUNTS && accountSeed % 5 != 0; ++i) {
            address candidate = address(accounts[(accountSeed % ACCOUNTS + i) % ACCOUNTS]);
            if (_pending(_ghost[candidate]) != 0) {
                account = candidate;
                break;
            }
        }
        if (bracketed) {
            _ownerBatch(account, _plan(Step.RELEASE, tickerSeed, 0));
            return;
        }
        Acct memory g = _ghost[account];
        uint8 tickerId = _bucketTicker(g, tickerSeed);
        Ctx memory c = _begin("release", account, account);
        _modelRelease(c, g, tickerId);
        _run(c, g, address(this), account, _single(address(module), abi.encodeCall(ISleeveModule.release, (tickerId))));
    }

    /// @notice Sets a rule. On an account that uninstalled, the owner installs again with the rule four times in
    /// five, as the app's setup flow would.
    function setRule(uint256 accountSeed, uint256 ruleSeed, bool bracketed) external step {
        address account = _account(accountSeed);
        ISleeveModule.RuleInput memory input = _ruleFor(ruleSeed);
        Acct memory g = _ghost[account];
        if ((!g.installed || !g.listed) && ruleSeed % 5 != 0) {
            _install("setRule install", account, address(0), input, true);
            return;
        }
        Ctx memory c = _begin("setRule", account, account);
        bytes memory call = abi.encodeCall(ISleeveModule.setRule, (input));
        if (bracketed) _modelBegin(c, g);
        _modelSetRule(c, g, input);
        if (bracketed) _modelEnd(c, g);
        _run(
            c, g, address(this), account, bracketed ? _bracketed(address(module), call) : _single(address(module), call)
        );
    }

    /// @notice Pauses an active rule, or resumes a paused one; now and then the call the module must refuse.
    function pauseOrResumeRule(uint256 accountSeed, uint256 choiceSeed) external step {
        address account = _unsteadyAccount(accountSeed);
        Acct memory g = _ghost[account];
        bool pause = g.rule.status == ISleeveModule.RuleStatus.ACTIVE ? choiceSeed % 5 != 0 : choiceSeed % 10 == 0;
        Ctx memory c = _begin(pause ? "pauseRule" : "resumeRule", account, account);
        _modelPause(c, g, pause);
        bytes memory call =
            pause ? abi.encodeCall(ISleeveModule.pauseRule, ()) : abi.encodeCall(ISleeveModule.resumeRule, ());
        _run(c, g, address(this), account, _single(address(module), call));
    }

    function setKeeper(uint256 accountSeed, uint256 keeperSeed) external step {
        address account = _unsteadyAccount(accountSeed);
        address[3] memory choices = [defaultKeeper, keeper2, address(0)];
        address keeper = choices[keeperSeed % 3];
        Acct memory g = _ghost[account];
        Ctx memory c = _begin("setKeeper", account, account);
        _modelSetKeeper(c, g, keeper);
        _run(c, g, address(this), account, _single(address(module), abi.encodeCall(ISleeveModule.setKeeper, (keeper))));
    }

    /// @notice The owner approves the third party, in a bracketed op. The approval itself moves no USDG.
    function approvePuller(uint256 accountSeed, uint256 amountSeed) external step {
        _ownerBatch(_account(accountSeed), _plan(Step.APPROVE, amountSeed, 0));
    }

    /// @notice The owner sends bought tokens away. No ledger counts stock tokens.
    function moveTokensOut(uint256 accountSeed, uint256 tickerSeed, uint256 amountSeed) external step {
        _ownerBatch(_account(accountSeed), _plan(Step.TOKENS_OUT, tickerSeed, amountSeed));
    }

    /// @notice The owner sells stock tokens for USDG through the router in a bracketed op. The proceeds go to spend.
    function ownerSellsTokens(uint256 accountSeed, uint256 seed) external step {
        _ownerBatch(_account(accountSeed), _plan(Step.SWAP_OUT, seed, 0));
    }

    /// @notice The owner sells lot tokens through the module (component 6): half the time inside a bracketed owner op
    /// as the app builds it, half the time as a bare call from the account. The proceeds go to spend and are never
    /// split (I6); an outside pull not booked yet is reconciled first (audit I-03).
    function sell(uint256 accountSeed, uint256 seed, bool bracketed) external step {
        address account = _sellTarget(accountSeed);
        if (bracketed) {
            _ownerBatch(account, _plan(Step.SELL, seed, 0));
            return;
        }
        Acct memory g = _ghost[account];
        Ctx memory c = _begin("sell", account, account);
        SellOrder memory o = _sellOrderFor(c, seed);
        _modelSell(c, g, o);
        _run(c, g, address(this), account, _single(address(module), _sellCall(o)));
    }

    /// @notice The owner trims its lots of a ticker down to its token balance, bracketed or bare.
    function reconcileLots(uint256 accountSeed, uint256 seed, bool bracketed) external step {
        address account = _sellTarget(accountSeed);
        if (bracketed) {
            _ownerBatch(account, _plan(Step.RECONCILE_LOTS, seed, 0));
            return;
        }
        Acct memory g = _ghost[account];
        Ctx memory c = _begin("reconcileLots", account, account);
        uint8 tickerId = _lotTicker(account, seed);
        _modelReconcileLots(c, g, tickerId);
        _run(
            c,
            g,
            address(this),
            account,
            _single(address(module), abi.encodeCall(ISleeveModule.reconcileLots, (tickerId)))
        );
    }

    /// @notice A stranger sends the module USDG, a stock token or ether, which it can neither refuse nor return.
    /// Buys measure the module's balances as a delta, so a donation must not block them (audit A1 HIGH), and no
    /// module action may move what was donated (I1).
    function donateToModule(uint256 assetSeed, uint256 amountSeed) external step {
        uint256 choice = assetSeed % (ASSETS + 1);
        uint256 amount = amountSeed % 4 == 0 ? 1 : _pick(amountSeed >> 2, 1, 1e24);
        if (choice == ASSETS) {
            vm.deal(address(module), address(module).balance + amount);
            donatedEther += amount;
            return;
        }
        if (choice != 0 && tokens[choice - 1].paused()) return;
        if (choice == 0) usdg.mint(address(module), amount);
        else tokens[choice - 1].mint(address(module), amount);
        donated[choice] += amount;
    }

    /// @notice Uninstall in a bracket, raw from any client, with an onUninstall that fails and that Kernel ignores,
    /// leaving the module's state behind, or the account calling onUninstall itself, which the module refuses while
    /// the account still lists it (audit A1-24).
    function uninstall(uint256 accountSeed, uint256 modeSeed) external step {
        if (modeSeed % 2 == 1) return;
        address account = _unsteadyAccount(accountSeed);
        uint256 mode = (modeSeed >> 1) % 4;
        if (mode == 0) {
            _ownerBatch(account, _plan(Step.UNINSTALL, modeSeed >> 1, 0));
            return;
        }
        Acct memory g = _ghost[account];
        if (mode == 3) {
            Ctx memory direct = _begin("onUninstall called directly", account, account);
            _modelOnUninstall(direct, g);
            bytes memory call = abi.encodeCall(ISleeveModule.onUninstall, (""));
            _run(direct, g, address(this), account, _single(address(module), call));
            return;
        }
        Ctx memory c = _begin(mode == 1 ? "uninstall" : "uninstall with a failing onUninstall", account, account);
        _modelUninstall(c, g, mode == 2);
        if (mode == 2) {
            vm.mockCallRevert(
                address(module), abi.encodeCall(ISleeveModule.onUninstall, ("")), abi.encode("out of gas")
            );
        }
        _run(
            c,
            g,
            address(this),
            account,
            abi.encodeCall(MockAccount.uninstallModule, (MODULE_TYPE_EXECUTOR, address(module), ""))
        );
        if (mode == 2) vm.clearMockedCalls();
    }

    /// @notice Installs again, mostly on an account that uninstalled; otherwise a second install over live state.
    function reinstall(uint256 accountSeed, uint256 ruleSeed, uint256 keeperSeed) external step {
        address account = _account(accountSeed);
        if (_ghost[account].installed && _ghost[account].listed && accountSeed % 4 != 0) {
            for (uint256 i; i < ACCOUNTS; ++i) {
                Acct memory other = _ghost[address(accounts[i])];
                if (!other.installed || !other.listed) {
                    account = address(accounts[i]);
                    break;
                }
            }
        }
        address[3] memory choices = [address(0), keeper2, defaultKeeper];
        bool hasRule = ruleSeed % 4 != 0;
        ISleeveModule.RuleInput memory input;
        if (hasRule) input = _ruleFor(ruleSeed >> 2);
        _install("reinstall", account, choices[keeperSeed % 3], input, hasRule);
    }

    /// @notice Calls a stranger makes on the module directly. Each must revert without reaching any account.
    function hostileCall(uint256 seed) external step {
        address account = address(accounts[0]);
        Ctx memory c = _begin("hostileCall", account, stranger);
        uint256 choice = seed % 5;
        bytes memory call;
        if (choice == 0) {
            ISleeveModule.BuyOrder memory order;
            order.account = account;
            order.token = address(tokens[0]);
            order.amountIn = 1;
            call = abi.encodeCall(ISleeveModule.executeBuy, (order));
            _revert(c, abi.encodeWithSelector(ISleeveModule.NotSelf.selector, stranger));
        } else {
            if (choice == 1) call = abi.encodeCall(ISleeveModule.beginOwnerOp, ());
            else if (choice == 2) call = abi.encodeCall(ISleeveModule.endOwnerOp, ());
            else if (choice == 3) call = abi.encodeCall(ISleeveModule.onUninstall, (""));
            else call = abi.encodeCall(ISleeveModule.release, (0));
            _revert(c, abi.encodeWithSelector(ISleeveModule.NotInstalled.selector, stranger));
        }
        _run(c, _ghost[account], stranger, address(module), call);
    }

    // Market

    /// @notice A few minutes, now and then hours, pass on a live market: rounds land on every feed whose session is
    /// open, the USDG/USD feed posts once its round is 20 hours old, and pool premiums drift back toward the feed.
    function marketTick(uint256 secondsSeed, uint256 moveSeed) external step {
        _warpBy(
            secondsSeed % 5 == 0 ? _pick(secondsSeed >> 8, 30 minutes, 3 hours) : _pick(secondsSeed >> 8, 1, 30 minutes)
        );
        for (uint256 t; t < 3; ++t) {
            (,, SessionCalendar.SessionType sessionType,) = _ticker(uint8(t));
            (bool open,,) = calendar.sessionState(block.timestamp, sessionType);
            if (!open) continue;
            (uint80 roundId, int256 answer,, uint256 updatedAt,) = feeds[t].latestRoundData();
            int256 move = int256(_pick(_mix(moveSeed, t), 0, 160)) - 80;
            if (answer <= 0) answer = 500e8;
            uint256 stamp = block.timestamp - _pick(moveSeed >> 16, 0, 60);
            if (stamp < updatedAt) stamp = updatedAt;
            feeds[t].setRound(roundId + 1, answer * (10_000 + move) / 10_000, stamp);
        }
        (uint80 usdgRound,,, uint256 usdgUpdatedAt,) = usdgFeed.latestRoundData();
        if (usdgUpdatedAt > block.timestamp || block.timestamp - usdgUpdatedAt > 20 hours) {
            usdgFeed.setRound(usdgRound + 1, int256(1e8 + _pick(moveSeed >> 32, 0, 40)) - 20, block.timestamp - 30);
        }
        for (uint256 i; i < pools.length; ++i) {
            if (_mix(moveSeed, 100 + i) % 10 < 3) {
                poolPremiumBps[address(pools[i])] = int256(_pick(_mix(moveSeed, 200 + i), 0, 50)) - 20;
            }
        }
        _reprice();
    }

    /// @notice A new round on a stock feed: mostly fresh with a move of up to 3 percent, sometimes old enough or
    /// early enough to be stale, from the future, or not positive.
    function moveFeed(uint256 tickerSeed, uint256 moveSeed, uint256 ageSeed) external step {
        uint256 t = tickerSeed % 3;
        (uint80 roundId, int256 answer,, uint256 updatedAt,) = feeds[t].latestRoundData();
        int256 next;
        if (moveSeed % 25 == 0) {
            next = -int256(_pick(moveSeed >> 8, 0, 1));
        } else {
            if (answer <= 0) answer = 500e8;
            next = answer * (10_000 + int256(_pick(moveSeed >> 8, 0, 600)) - 300) / 10_000;
        }
        uint256 band = ageSeed % 50;
        uint256 stamp;
        if (band == 0) {
            stamp = block.timestamp + _pick(ageSeed >> 8, 1, 600);
        } else {
            uint256 age = band < 38 ? _pick(ageSeed >> 8, 0, 10 minutes) : _pick(ageSeed >> 8, 0, 27 hours);
            stamp = block.timestamp > age ? block.timestamp - age : 0;
            if (stamp < updatedAt && updatedAt <= block.timestamp) stamp = updatedAt;
        }
        feeds[t].setRound(roundId + 1, next, stamp);
        _reprice();
    }

    /// @notice A round stamped right around the instant the ticker's open session began: an hour, a minute or a
    /// second before it, which the fresh-round step must refuse (B2-2), or on it or a second after, which passes. QQQ's
    /// REGULAR session opens every trading morning, so its rounds stay young enough for the age step to pass.
    function postRoundAroundOpen(uint256 tickerSeed, uint256 offsetSeed) external step {
        uint256 t = tickerSeed % 3;
        (,, SessionCalendar.SessionType sessionType,) = _ticker(uint8(t));
        (bool open,, uint256 openedAt) = calendar.sessionState(block.timestamp, sessionType);
        if (!open) return;
        int256[5] memory offsets = [int256(-1 hours), -1 minutes, -1, 0, 1];
        int256 stamp = int256(openedAt) + offsets[offsetSeed % 5];
        if (stamp > int256(block.timestamp)) stamp = int256(block.timestamp);
        (uint80 roundId, int256 answer,,,) = feeds[t].latestRoundData();
        if (answer <= 0) answer = 500e8;
        feeds[t].setRound(roundId + 1, answer, uint256(stamp));
        _reprice();
    }

    /// @notice A new USDG/USD round: mostly inside the 50 bps band, sometimes on its edges, outside it, old, from the
    /// future, or zero.
    function moveUsdgFeed(uint256 answerSeed, uint256 ageSeed) external step {
        (uint80 roundId,,,,) = usdgFeed.latestRoundData();
        uint256 band = answerSeed % 20;
        int256 offset;
        if (band < 14) {
            offset = int256(_pick(answerSeed >> 8, 0, 98)) - 49;
        } else if (band < 16) {
            offset = answerSeed % 2 == 0 ? int256(50) : -50;
        } else if (band < 19) {
            offset = (answerSeed >> 8) % 2 == 0
                ? int256(_pick(answerSeed >> 16, 51, 150))
                : -int256(_pick(answerSeed >> 16, 51, 150));
        }
        int256 answer = band == 19 ? int256(0) : int256(1e8) + offset * 1e4;
        uint256 ageBand = ageSeed % 40;
        uint256 stamp;
        if (ageBand == 0) {
            stamp = block.timestamp + _pick(ageSeed >> 8, 1, 600);
        } else {
            uint256 age = ageBand < 34 ? _pick(ageSeed >> 8, 0, 1 hours) : _pick(ageSeed >> 8, 0, 27 hours);
            stamp = block.timestamp > age ? block.timestamp - age : 0;
        }
        usdgFeed.setRound(roundId + 1, answer, stamp);
    }

    /// @notice The issuer pauses a token, or its oracle, for one to eight handler calls.
    function pauseToken(uint256 tickerSeed, uint256 kindSeed) external step {
        address token = address(tokens[tickerSeed % TICKERS]);
        bool oracle = kindSeed % 2 == 1;
        if (oracle) MockStockToken(token).setOraclePaused(true);
        else MockStockToken(token).setPaused(true);
        _disturb(oracle ? Kind.ORACLE_PAUSE : Kind.TOKEN_PAUSE, token, kindSeed >> 8);
    }

    /// @notice The issuer blocks an account or a pool on the stock token registry for one to eight handler calls.
    function blockAddress(uint256 targetSeed, uint256 durationSeed) external step {
        address target = targetSeed % 2 == 0
            ? address(accounts[(targetSeed >> 1) % ACCOUNTS])
            : address(pools[_busyPool(targetSeed >> 1)]);
        registry.setBlocked(target, true);
        _disturb(Kind.BLOCK, target, durationSeed);
    }

    function scheduleMultiplier(uint256 tickerSeed, uint256 leadSeed, uint256 changeSeed) external step {
        MockStockToken token = tokens[tickerSeed % 3];
        uint256 current = token.uiMultiplier();
        uint256 next = changeSeed % 5 == 0 ? current : current * (10_000 + _pick(changeSeed >> 8, 1, 30)) / 10_000;
        token.scheduleMultiplier(next, block.timestamp + _pick(leadSeed, 0, 48 hours));
    }

    /// @notice Sets a pool's premium against the feed and, now and then, a fault for one to eight handler calls: a
    /// partial fill, a revert, or a delivery short of what the pool reports.
    function setPoolBehavior(uint256 poolSeed, uint256 premiumSeed, uint256 modeSeed) external step {
        InvPool pool = pools[_busyPool(poolSeed)];
        uint256 band = premiumSeed % 10;
        int256 premium;
        if (band < 5) premium = int256(_pick(premiumSeed >> 8, 0, 100)) - 50;
        else if (band < 8) premium = int256(_pick(premiumSeed >> 8, 50, 300));
        else premium = int256(_pick(premiumSeed >> 8, 0, 1_200)) - 300;
        poolPremiumBps[address(pool)] = premium;
        uint256 mode = modeSeed % 8;
        if (mode < 4) {
            if (mode == 0) pool.setFillBps(_partialFillBps(modeSeed >> 8));
            else if (mode == 1) pool.setUnavailable(true);
            else if (mode == 2) pool.setFillBps(_overchargeBps(modeSeed >> 8));
            else pool.setWithheldBps(uint16(_pick(modeSeed >> 8, 1, 3_000)));
            _disturb(Kind.POOL_FAULT, address(pool), modeSeed >> 24);
        }
        _reprice();
    }

    function warp(uint256 secondsSeed) external step {
        uint256 band = secondsSeed % 100;
        uint256 dt;
        if (band < 70) dt = _pick(secondsSeed >> 8, 1, 30 minutes);
        else if (band < 90) dt = _pick(secondsSeed >> 8, 30 minutes, 6 hours);
        else if (band < 97) dt = _pick(secondsSeed >> 8, 6 hours, 30 hours);
        else dt = _pick(secondsSeed >> 8, 30 hours, 4 days);
        _warpBy(dt);
    }

    /// @notice Lands next to the next session opening or closing for ALL_DAY or REGULAR: a second before, on it, a
    /// second after, or a few minutes after.
    function warpToSessionEdge(uint256 seed) external step {
        SessionCalendar.SessionType sessionType =
            seed % 2 == 0 ? SessionCalendar.SessionType.ALL_DAY : SessionCalendar.SessionType.REGULAR;
        (bool openNow,,) = calendar.sessionState(block.timestamp, sessionType);
        uint256 low = block.timestamp;
        uint256 high;
        for (uint256 i = 1; i <= 200; ++i) {
            uint256 probe = block.timestamp + i * 30 minutes;
            (bool open,,) = calendar.sessionState(probe, sessionType);
            if (open != openNow) {
                high = probe;
                break;
            }
            low = probe;
        }
        if (high == 0) return;
        while (high - low > 1) {
            uint256 mid = (low + high) / 2;
            (bool open,,) = calendar.sessionState(mid, sessionType);
            if (open == openNow) low = mid;
            else high = mid;
        }
        uint256[4] memory offsets = [uint256(0), 1, 2, 300];
        uint256 target = high - 1 + offsets[(seed >> 8) % 4];
        if (target > block.timestamp) _warpBy(target - block.timestamp);
    }

    // The timelock's writes, made as the timelock without the wait. Each must leave every balance as it was (I10);
    // the model's comparison after the call covers ledgers, buckets, rules and keepers.

    function adminRemoveTicker(uint256 seed) external step {
        if (seed % 4 != 0) return;
        uint8 tickerId = uint8(1 + (seed >> 8) % 2);
        (,,, bool active) = _ticker(tickerId);
        if (!active) return;
        _asAdmin(address(tokenSource), abi.encodeCall(TokenSource.removeTicker, (tickerId)));
    }

    /// @notice Adds or removes a canonical pool: SPY's fee 100 or 3000 pool, QQQ's only pool, NVDA's fee 3000 pool.
    function adminSetPool(uint256 seed) external step {
        uint256[4] memory choices = [uint256(2), 1, 3, 5];
        address pool = address(pools[choices[seed % 4]]);
        uint8 tickerId = poolTicker[pool];
        bool allowed = tokenSource.isPoolAllowed(tickerId, pool);
        _asAdmin(address(tokenSource), abi.encodeCall(TokenSource.setPool, (tickerId, pool, !allowed)));
    }

    /// @notice Adds a closure or an early close on a coming trading day, when the extension still accepts it.
    function adminCalendarWrite(uint256 daySeed, uint256 kindSeed) external step {
        uint256 day = block.timestamp / 1 days + _pick(daySeed, 1, 20);
        bytes memory call = kindSeed % 2 == 0
            ? abi.encodeCall(SessionCalendarExtension.addClosure, (day))
            : abi.encodeCall(SessionCalendarExtension.addEarlyClose, (day));
        _asAdmin(address(calendar), call);
    }

    // Shared runners

    function _pay(address account, uint256 amountSeed) internal {
        uint256 band = amountSeed % 8;
        uint256 amount;
        if (band == 0) amount = _pick(amountSeed >> 8, 1, 999);
        else if (band == 1) amount = _pick(amountSeed >> 8, 1e6, 30e6);
        else amount = _pick(amountSeed >> 8, 30e6, 2e10);
        usdg.mint(payer, amount);
        vm.prank(payer);
        require(IERC20(address(usdg)).transfer(account, amount), "payment");
        if (_ghost[account].installed) {
            uint256 deficit = ghostDeficit[account];
            uint256 absorbed = amount > deficit ? deficit : amount;
            ghostDeficit[account] = deficit - absorbed;
            ghostIncomeWaiting[account] += amount - absorbed;
        }
    }

    function _ownerSplit(address account, uint256 poolSeed, uint256 quoteSeed, bool bracketed) internal {
        if (bracketed) {
            _ownerBatch(account, _plan(Step.SPLIT, poolSeed, quoteSeed));
            return;
        }
        Acct memory g = _ghost[account];
        (address pool, uint256 quote) = _venueFor(g.rule.tickerId, poolSeed, quoteSeed);
        Ctx memory c = _begin("ownerSplit", account, account);
        _modelSplit(c, g, pool, quote);
        _run(
            c,
            g,
            address(this),
            account,
            _single(address(module), abi.encodeCall(ISleeveModule.split, (account, pool, quote)))
        );
    }

    function _split(string memory action, address account, address caller, uint256 poolSeed, uint256 quoteSeed)
        internal
    {
        Acct memory g = _ghost[account];
        (address pool, uint256 quote) = _venueFor(g.rule.tickerId, poolSeed, quoteSeed);
        Ctx memory c = _begin(action, account, caller);
        _modelSplit(c, g, pool, quote);
        _run(c, g, caller, address(module), abi.encodeCall(ISleeveModule.split, (account, pool, quote)));
    }

    function _settle(
        string memory action,
        address account,
        address caller,
        uint8 tickerId,
        uint256 poolSeed,
        uint256 quoteSeed
    ) internal {
        Acct memory g = _ghost[account];
        (address pool, uint256 quote) = _venueFor(tickerId, poolSeed, quoteSeed);
        Ctx memory c = _begin(action, account, caller);
        _modelSettle(c, g, tickerId, pool, quote);
        _run(c, g, caller, address(module), abi.encodeCall(ISleeveModule.settle, (account, tickerId, pool, quote)));
    }

    function _observe(string memory action, address account) internal {
        Acct memory g = _ghost[account];
        Ctx memory c = _begin(action, account, stranger);
        _modelObserve(c, g);
        _run(c, g, stranger, address(module), abi.encodeCall(ISleeveModule.observe, (account)));
    }

    function _install(
        string memory action,
        address account,
        address keeper,
        ISleeveModule.RuleInput memory input,
        bool hasRule
    ) internal {
        Acct memory g = _ghost[account];
        Ctx memory c = _begin(action, account, account);
        _modelInstall(c, g, keeper, input, hasRule);
        bytes memory data = _installData(keeper, input, hasRule);
        _run(
            c,
            g,
            address(this),
            account,
            abi.encodeCall(MockAccount.installModule, (MODULE_TYPE_EXECUTOR, address(module), data))
        );
    }

    /// @dev Empty data when there is no rule and no keeper, as an app install with every default would send.
    function _installData(address keeper, ISleeveModule.RuleInput memory input, bool hasRule)
        internal
        pure
        returns (bytes memory)
    {
        if (!hasRule && keeper == address(0)) return "";
        return abi.encode(keeper, input);
    }

    /// @dev A one-step batch.
    function _plan(Step only, uint256 seed, uint256 salt) internal pure returns (Batch memory) {
        Step[] memory steps = new Step[](1);
        steps[0] = only;
        return
            Batch({steps: steps, calls: new Execution[](0), count: 0, reserve: 0, seed: _mix(seed, salt), drain: false});
    }

    /// @dev Builds the batch step by step through the model, then runs it as one execute call from the owner.
    function _ownerBatch(address account, Batch memory batch) internal {
        Acct memory g = _ghost[account];
        Ctx memory c = _begin("ownerBatch", account, account);
        batch.calls = new Execution[](batch.steps.length * CALLS_PER_STEP + 2);
        batch.calls[batch.count++] = Execution(address(module), 0, abi.encodeCall(ISleeveModule.beginOwnerOp, ()));
        _modelBegin(c, g);
        uint256 ledgers = g.spend + _pending(g);
        for (uint256 i; i < batch.steps.length; ++i) {
            Step kind = batch.steps[i];
            if (kind == Step.SPLIT || kind == Step.SETTLE) {
                batch.reserve = (c.actual > ledgers ? c.actual - ledgers : 0) + _pending(g);
            }
        }
        for (uint256 i; i < batch.steps.length; ++i) {
            c.action = string.concat("ownerBatch step ", vm.toString(i), " ", _stepName(batch.steps[i]));
            _batchStep(c, g, batch, batch.steps[i], _mix(batch.seed, i));
        }
        batch.calls[batch.count++] = Execution(address(module), 0, abi.encodeCall(ISleeveModule.endOwnerOp, ()));
        c.action = "ownerBatch end";
        _modelEnd(c, g);
        Execution[] memory batchCalls = batch.calls;
        uint256 count = batch.count;
        assembly ("memory-safe") {
            mstore(batchCalls, count)
        }
        _run(
            c,
            g,
            address(this),
            account,
            abi.encodeCall(MockAccount.execute, (BATCH, ERC7579Utils.encodeBatch(batchCalls)))
        );
    }

    function _batchStep(Ctx memory c, Acct memory g, Batch memory batch, Step kind, uint256 seed) internal {
        if (kind == Step.INFLOW) {
            uint256 amount = _pick(seed, 0, 1e11);
            batch.calls[batch.count++] = Execution(address(wallet), 0, abi.encodeCall(UsdgPayer.payCaller, (amount)));
            if (!c.reverted) {
                c.actual += amount;
                _move(c, address(wallet), 0, -int256(amount));
                _move(c, c.account, 0, int256(amount));
            }
        } else if (kind == Step.OUTFLOW) {
            uint256 spentSoFar = c.md < 0 ? uint256(-c.md) : 0;
            uint256 reserveLeft = batch.reserve > spentSoFar ? batch.reserve - spentSoFar : 0;
            uint256 budget = c.actual > reserveLeft ? c.actual - reserveLeft : 0;
            if (batch.drain || seed % 16 == 0) budget = c.actual;
            uint256 amount = batch.drain || seed % 4 == 0 ? budget : _pick(seed, 0, budget);
            batch.calls[batch.count++] = Execution(address(usdg), 0, abi.encodeCall(IERC20.transfer, (sink, amount)));
            if (!c.reverted) {
                c.actual -= amount;
                _move(c, c.account, 0, -int256(amount));
                _move(c, sink, 0, int256(amount));
            }
        } else if (kind == Step.SPLIT) {
            (address pool, uint256 quote) = _venueFor(g.rule.tickerId, seed, seed >> 64);
            batch.calls[batch.count++] =
                Execution(address(module), 0, abi.encodeCall(ISleeveModule.split, (c.account, pool, quote)));
            _modelSplit(c, g, pool, quote);
        } else if (kind == Step.SETTLE) {
            uint8 tickerId = _bucketTicker(g, seed);
            (address pool, uint256 quote) = _venueFor(tickerId, seed >> 8, seed >> 64);
            batch.calls[batch.count++] =
                Execution(address(module), 0, abi.encodeCall(ISleeveModule.settle, (c.account, tickerId, pool, quote)));
            _modelSettle(c, g, tickerId, pool, quote);
        } else if (kind == Step.RELEASE) {
            uint8 tickerId = _bucketTicker(g, seed);
            batch.calls[batch.count++] =
                Execution(address(module), 0, abi.encodeCall(ISleeveModule.release, (tickerId)));
            _modelRelease(c, g, tickerId);
        } else if (kind == Step.APPROVE) {
            uint256 amount = seed % 8 == 0 ? type(uint256).max : _pick(seed, 0, 5e11);
            batch.calls[batch.count++] = Execution(address(usdg), 0, abi.encodeCall(IERC20.approve, (puller, amount)));
        } else if (kind == Step.TOKENS_OUT) {
            _tokensOut(c, batch, seed);
        } else if (kind == Step.SWAP_OUT) {
            _swapOut(c, batch, seed);
        } else if (kind == Step.SELL) {
            SellOrder memory o = _sellOrderFor(c, seed);
            batch.calls[batch.count++] = Execution(address(module), 0, _sellCall(o));
            _modelSell(c, g, o);
        } else if (kind == Step.RECONCILE_LOTS) {
            uint8 tickerId = _lotTicker(c.account, seed);
            batch.calls[batch.count++] =
                Execution(address(module), 0, abi.encodeCall(ISleeveModule.reconcileLots, (tickerId)));
            _modelReconcileLots(c, g, tickerId);
        } else if (kind == Step.RELAY) {
            (address pool, uint256 quote) = _venueFor(g.rule.tickerId, seed, seed >> 64);
            batch.calls[batch.count++] = Execution(
                address(relay),
                0,
                abi.encodeCall(InvRelay.split, (ISleeveModule(address(module)), c.account, pool, quote))
            );
            address owner = c.caller;
            c.caller = address(relay);
            _modelSplit(c, g, pool, quote);
            c.caller = owner;
        } else if (kind == Step.UNINSTALL) {
            batch.calls[batch.count++] = Execution(
                c.account, 0, abi.encodeCall(MockAccount.uninstallModule, (MODULE_TYPE_EXECUTOR, address(module), ""))
            );
            _modelUninstall(c, g, false);
        } else {
            ISleeveModule.RuleInput memory input = _ruleFor(seed);
            address keeper = seed % 3 == 0 ? keeper2 : address(0);
            bytes memory data = _installData(keeper, input, true);
            batch.calls[batch.count++] = Execution(
                c.account, 0, abi.encodeCall(MockAccount.installModule, (MODULE_TYPE_EXECUTOR, address(module), data))
            );
            _modelInstall(c, g, keeper, input, true);
        }
    }

    /// @dev The owner sends some of a stock token to tokenSink. The token refuses while paused or when the account
    /// is blocked, and then the whole batch reverts with its error.
    function _tokensOut(Ctx memory c, Batch memory batch, uint256 seed) internal view {
        MockStockToken token = tokens[_heldTicker(c, seed)];
        uint256 asset = _assetOf(address(token));
        int256 held = _heldNow(c, asset);
        uint256 amount = held > 0 ? _pick(seed >> 8, 0, uint256(held)) : 0;
        batch.calls[batch.count++] = Execution(address(token), 0, abi.encodeCall(IERC20.transfer, (tokenSink, amount)));
        if (c.reverted) return;
        if (token.paused()) return _revert(c, abi.encodeWithSelector(MockStockToken.IsPaused.selector));
        if (registry.isBlocked(c.account)) {
            return _revert(c, abi.encodeWithSelector(MockStockToken.Blocked.selector, c.account));
        }
        _move(c, c.account, asset, -int256(amount));
        _move(c, tokenSink, asset, int256(amount));
    }

    /// @dev The owner sells some of a stock token for USDG through the router inside the bracket, as the app's swap
    /// screen would: exact approval, the swap back to the account, the approval reset. The USDG it brings is the
    /// owner's, so the bracket credits it to spend and no split may sort it (I6). The sale runs on the pools' sell
    /// side, which component 6's sells use. The token refuses while paused or when the account or the pool is
    /// blocked, and then the whole batch reverts with its error.
    function _swapOut(Ctx memory c, Batch memory batch, uint256 seed) internal view {
        uint8 tickerId = _heldTicker(c, seed);
        MockStockToken token = tokens[tickerId];
        address[] memory venues = _poolsOfTicker(tickerId);
        InvPool pool = InvPool(venues[(seed >> 8) % venues.length]);
        uint256 asset = _assetOf(address(token));
        int256 held = _heldNow(c, asset);
        uint256 amount = held > 0 ? _pick(seed >> 16, 1, uint256(held)) : 0;
        ISwapRouter02.ExactInputSingleParams memory params = ISwapRouter02.ExactInputSingleParams({
            tokenIn: address(token),
            tokenOut: address(usdg),
            fee: pool.fee(),
            recipient: c.account,
            amountIn: amount,
            amountOutMinimum: 0,
            sqrtPriceLimitX96: 0
        });
        batch.calls[batch.count++] =
            Execution(address(token), 0, abi.encodeCall(IERC20.approve, (address(router), amount)));
        batch.calls[batch.count++] =
            Execution(address(router), 0, abi.encodeCall(ISwapRouter02.exactInputSingle, (params)));
        batch.calls[batch.count++] = Execution(address(token), 0, abi.encodeCall(IERC20.approve, (address(router), 0)));
        if (c.reverted) return;
        if (pool.unavailable()) return _revert(c, abi.encodeWithSelector(InvPool.PoolUnavailable.selector));
        (uint256 used,, uint256 delivered) = pool.quote(address(token), amount);
        if (used > amount) {
            return _revert(
                c,
                abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(router), amount, used)
            );
        }
        if (token.paused()) return _revert(c, abi.encodeWithSelector(MockStockToken.IsPaused.selector));
        if (registry.isBlocked(c.account)) {
            return _revert(c, abi.encodeWithSelector(MockStockToken.Blocked.selector, c.account));
        }
        if (registry.isBlocked(address(pool))) {
            return _revert(c, abi.encodeWithSelector(MockStockToken.Blocked.selector, address(pool)));
        }
        c.sold = c.sold || used != 0;
        c.actual += delivered;
        _move(c, c.account, asset, -int256(used));
        _move(c, address(pool), asset, int256(used));
        _move(c, address(pool), 0, -int256(delivered));
        _move(c, c.account, 0, int256(delivered));
    }

    /// @dev Mostly a ticker whose token the account holds at this point of the batch, so sales have something to sell.
    function _heldTicker(Ctx memory c, uint256 seed) internal view returns (uint8) {
        if (seed % 5 != 0) {
            for (uint256 i; i < TICKERS; ++i) {
                uint8 t = uint8((seed % TICKERS + i) % TICKERS);
                if (_heldNow(c, _assetOf(address(tokens[t]))) > 0) return t;
            }
        }
        return uint8(seed % TICKERS);
    }

    /// @dev A write as the timelock. Records an I10 violation when it moved any tracked balance.
    function _asAdmin(address target, bytes memory data) internal {
        uint256[] memory before = _balances();
        vm.prank(admin);
        (bool ok,) = target.call(data);
        ok;
        if (keccak256(abi.encode(_balances())) != keccak256(abi.encode(before))) {
            _violate(V_I10, "a timelock write moved a balance");
        }
    }

    // Inputs

    function _keeperOf(address account) internal view returns (address) {
        address keeper = _ghost[account].keeper;
        return keeper == address(0) ? defaultKeeper : keeper;
    }

    /// @dev The account a keeper would split: four times in five the first, from the seed's account on, with an
    /// active rule and a balance away from its ledgers, unsorted USDG to sort or a shortfall to reconcile; otherwise
    /// the seed's account.
    function _splitTarget(uint256 seed) internal view returns (address) {
        if (seed % 5 != 0) {
            for (uint256 i; i < ACCOUNTS; ++i) {
                address candidate = address(accounts[(seed % ACCOUNTS + i) % ACCOUNTS]);
                Acct memory g = _ghost[candidate];
                if (!g.installed || !g.listed || g.rule.status != ISleeveModule.RuleStatus.ACTIVE) continue;
                if (usdg.balanceOf(candidate) != g.spend + _pending(g)) return candidate;
            }
        }
        return _account(seed);
    }

    /// @dev The bucket a keeper would settle: four times in five the first, from the seed's account and ticker on,
    /// that previewSettle says would buy or go to spend, else the first at or above its rule's clip; otherwise the
    /// seed's account and one of its tickers.
    function _settleTarget(uint256 accountSeed, uint256 tickerSeed)
        internal
        view
        returns (address account, uint8 tickerId)
    {
        account = _account(accountSeed);
        tickerId = _bucketTicker(_ghost[account], tickerSeed);
        if (accountSeed % 5 == 0) return (account, tickerId);
        bool found;
        for (uint256 i; i < ACCOUNTS; ++i) {
            address candidate = address(accounts[(accountSeed % ACCOUNTS + i) % ACCOUNTS]);
            Acct memory g = _ghost[candidate];
            if (!g.installed || g.rule.status != ISleeveModule.RuleStatus.ACTIVE) continue;
            for (uint256 j; j < TICKERS; ++j) {
                uint8 t = uint8((tickerSeed % TICKERS + j) % TICKERS);
                if (g.amount[t] == 0 || g.amount[t] < g.rule.minClip) continue;
                ISleeveModule.SettlePreview memory preview = module.previewSettle(candidate, t);
                if (preview.status != Status.QUEUED) return (candidate, t);
                if (!found) (found, account, tickerId) = (true, candidate, t);
            }
        }
    }

    /// @dev One of the pools triggers use most: SPY's two, QQQ's and NVDA's fee 500, and now and then any pool.
    function _busyPool(uint256 seed) internal view returns (uint256) {
        uint256[4] memory busy = [uint256(0), 1, 3, 4];
        return seed % 5 == 0 ? (seed >> 8) % pools.length : busy[(seed >> 8) % 4];
    }

    /// @dev Account 0 a seventh of the time, so lifecycle actions rarely disturb it.
    function _unsteadyAccount(uint256 seed) internal view returns (address) {
        uint256 choice = seed % 7;
        return address(accounts[choice == 0 ? 0 : 1 + choice % 2]);
    }

    /// @dev The trigger's pool: usually one on the ticker's allowlist, sometimes another pool or an address that is
    /// not a pool. The quote: usually the pool's own price less a little, sometimes inflated past the slippage cap,
    /// one base unit, or zero.
    function _venueFor(uint8 tickerId, uint256 poolSeed, uint256 quoteSeed)
        internal
        view
        returns (address pool, uint256 quote)
    {
        uint256 mode = poolSeed % 20;
        address[] memory allowed = tokenSource.poolsOf(tickerId);
        if (mode == 0) pool = address(uint160(_mix(poolSeed, 7)));
        else if (mode == 1 || allowed.length == 0) pool = address(pools[(poolSeed >> 8) % pools.length]);
        else pool = allowed[(poolSeed >> 8) % allowed.length];
        uint256 fair = _isPool(pool) ? 1e26 / InvPool(pool).priceE8() : 2e15;
        uint256 quoteMode = quoteSeed % 20;
        if (quoteMode == 0) quote = 0;
        else if (quoteMode == 1) quote = 1;
        else if (quoteMode <= 3) quote = fair * (BPS + _pick(quoteSeed >> 8, 100, 3_000)) / BPS;
        else quote = fair * (BPS - _pick(quoteSeed >> 8, 0, 40)) / BPS;
    }

    /// @dev Mostly a ticker with a bucket, so settles and releases have something to act on.
    function _bucketTicker(Acct memory g, uint256 seed) internal pure returns (uint8) {
        if (seed % 5 != 0) {
            for (uint256 i; i < TICKERS; ++i) {
                uint256 t = (seed % TICKERS + i) % TICKERS;
                if (g.amount[t] != 0) return uint8(t);
            }
        }
        return uint8(seed % TICKERS);
    }

    /// @dev Four times in five the first account, from the seed's on, that holds lot tokens; otherwise the seed's.
    function _sellTarget(uint256 seed) internal view returns (address) {
        if (seed % 5 != 0) {
            for (uint256 i; i < ACCOUNTS; ++i) {
                address candidate = address(accounts[(seed % ACCOUNTS + i) % ACCOUNTS]);
                for (uint8 t; t < 3; ++t) {
                    if (_lotTokens(candidate, t) != 0) return candidate;
                }
            }
        }
        return _account(seed);
    }

    /// @dev Tokens the account's lots of a ticker still hold, from the head, as the ghost has them.
    function _lotTokens(address account, uint8 tickerId) internal view returns (uint256 total) {
        uint256[] memory ids = _queueView(account, tickerId);
        for (uint256 i = _headView(account, tickerId); i < ids.length; ++i) {
            total += _lotView(ids[i]).tokensRemaining;
        }
    }

    /// @dev Mostly a ticker whose lots hold tokens; otherwise any of the four.
    function _lotTicker(address account, uint256 seed) internal view returns (uint8) {
        if (seed % 5 != 0) {
            for (uint256 i; i < TICKERS; ++i) {
                uint8 t = uint8((seed % TICKERS + i) % TICKERS);
                if (_lotTokens(account, t) != 0) return t;
            }
        }
        return uint8(seed % TICKERS);
    }

    /// @dev A sell the owner's app would send, and the ways it can go wrong: mostly by amount, within what the lots and
    /// the balance hold at this point of the batch, on an allowlisted pool at the pool's own sell price less a little;
    /// sometimes one lot by id, a foreign or unknown lot, more than the lots or the balance hold, zero, another pool, a
    /// quote the pool cannot meet or zero, the off-hours override, or a widened or out of range discount cap.
    function _sellOrderFor(Ctx memory c, uint256 seed) internal view returns (SellOrder memory o) {
        o.tickerId = _lotTicker(c.account, seed);
        uint256 lots = _lotTokens(c.account, o.tickerId);
        int256 held = _heldNow(c, _assetOf(_tokenOf(o.tickerId)));
        uint256 sellable = Math.min(lots, held > 0 ? uint256(held) : 0);
        uint256 amountMode = (seed >> 8) % 20;
        if (amountMode == 0) o.tokenAmount = 0;
        else if (amountMode == 1 || sellable == 0) o.tokenAmount = lots + 1 + (seed >> 16) % 1e17;
        else if (amountMode == 2) o.tokenAmount = sellable + 1;
        else if (amountMode < 6) o.tokenAmount = sellable;
        else o.tokenAmount = _pick(seed >> 16, 1, sellable);
        uint256 lotMode = (seed >> 32) % 10;
        if (lotMode == 0) o.lotId = _lotFor(c.account, o.tickerId, seed);
        else if (lotMode == 1) o.lotId = _lotFor(address(accounts[(_accountIndex(c.account) + 1) % ACCOUNTS]), 0, seed);
        else if (lotMode == 2) o.lotId = 1e9 + seed % 1e6;
        if (lotMode == 0 && o.lotId != 0 && amountMode >= 3) {
            o.tokenAmount = Math.min(o.tokenAmount, _lotView(o.lotId).tokensRemaining);
        }
        address[] memory allowed = tokenSource.poolsOf(o.tickerId);
        if ((seed >> 40) % 20 == 0 || allowed.length == 0) o.pool = address(pools[(seed >> 48) % pools.length]);
        else o.pool = allowed[(seed >> 48) % allowed.length];
        uint256 fair = _isPool(o.pool) ? InvPool(o.pool).priceE8() / 100 : 500e6;
        uint256 quoteMode = (seed >> 56) % 20;
        if (quoteMode == 0) o.quote = 0;
        else if (quoteMode <= 2) o.quote = fair * (BPS + _pick(seed >> 64, 100, 3_000)) / BPS;
        else o.quote = fair * (BPS - _pick(seed >> 64, 0, 40)) / BPS;
        o.overrideClosed = (seed >> 80) % 5 == 0;
        uint256 capMode = (seed >> 88) % 10;
        uint16 ruleCap = _ghost[c.account].rule.premiumCapBps;
        if (capMode == 0) o.overrideCapBps = MAX_CAP_BPS;
        else if (capMode == 1) o.overrideCapBps = uint16(_pick(seed >> 96, ruleCap, MAX_CAP_BPS));
        else if (capMode == 2) o.overrideCapBps = MAX_CAP_BPS + 1;
    }

    /// @dev One of the account's lots of the ticker, from the head when it can, zero when there is none.
    function _lotFor(address account, uint8 tickerId, uint256 seed) internal view returns (uint256) {
        uint256[] memory ids = _queueView(account, tickerId);
        if (ids.length == 0) return 0;
        uint256 head = _headView(account, tickerId);
        uint256 from = head < ids.length ? head : 0;
        return ids[from + seed % (ids.length - from)];
    }

    function _sellCall(SellOrder memory o) internal pure returns (bytes memory) {
        return abi.encodeCall(
            ISleeveModule.sell,
            (o.tickerId, o.tokenAmount, o.lotId, o.pool, o.quote, o.overrideClosed, o.overrideCapBps)
        );
    }

    /// @dev Mostly valid rules on tickers 0 to 2, with the edges of every range, and now and then one the module must
    /// refuse.
    function _ruleFor(uint256 seed) internal pure returns (ISleeveModule.RuleInput memory input) {
        uint16[7] memory shares = [0, 1, 1_000, 5_000, 9_999, 10_000, uint16(_pick(seed >> 8, 0, 10_000))];
        input.equityBps = shares[seed % 7];
        input.spendBps = uint16(BPS - input.equityBps);
        input.tickerId = uint8((seed >> 24) % 3);
        uint16[5] memory caps = [0, 50, 100, 500, uint16(_pick(seed >> 32, 0, 500))];
        input.premiumCapBps = caps[(seed >> 48) % 5];
        input.slippageBps = caps[(seed >> 56) % 5];
        uint128[4] memory clips = [uint128(1e6), 25e6, 5e6, uint128(_pick(seed >> 64, 1e6, 500e6))];
        input.minClip = clips[(seed >> 96) % 4];
        uint256 fault = (seed >> 104) % 40;
        if (fault == 0) input.spendBps += 1;
        else if (fault == 1) input.tickerId = NO_FEED;
        else if (fault == 2) input.tickerId = 4;
        else if (fault == 3) input.premiumCapBps = 501;
        else if (fault == 4) input.slippageBps = 501;
        else if (fault == 5) input.minClip = 999_999;
    }

    // Encoding

    function _single(address target, bytes memory data) internal pure returns (bytes memory) {
        return abi.encodeCall(MockAccount.execute, (SINGLE, abi.encodePacked(target, uint256(0), data)));
    }

    function _bracketed(address target, bytes memory data) internal view returns (bytes memory) {
        Execution[] memory batchCalls = new Execution[](3);
        batchCalls[0] = Execution(address(module), 0, abi.encodeCall(ISleeveModule.beginOwnerOp, ()));
        batchCalls[1] = Execution(target, 0, data);
        batchCalls[2] = Execution(address(module), 0, abi.encodeCall(ISleeveModule.endOwnerOp, ()));
        return abi.encodeCall(MockAccount.execute, (BATCH, ERC7579Utils.encodeBatch(batchCalls)));
    }

    function _stepName(Step kind) internal pure returns (string memory) {
        string[13] memory names = [
            "inflow",
            "outflow",
            "split",
            "settle",
            "release",
            "approve",
            "tokens out",
            "swap out",
            "sell",
            "reconcile lots",
            "relay split",
            "uninstall",
            "reinstall"
        ];
        return names[uint256(kind)];
    }

    // Market helpers

    function _warpBy(uint256 dt) internal {
        if (dt != 0) vm.warp(block.timestamp + dt);
    }

    /// @dev A partial fill's share of the input: half the time within 10 bps of the whole, which passes the router's
    /// minimum and leaves the module's own PartialFill check to catch it; otherwise anything short of the whole.
    function _partialFillBps(uint256 seed) internal pure returns (uint16) {
        return uint16(seed % 2 == 0 ? _pick(seed >> 1, 9_990, 9_999) : _pick(seed >> 1, 0, 9_999));
    }

    /// @dev A pool that asks for more input than the order offered, up to a fifth more. The exact approval must stop
    /// it in the token's transferFrom (I4).
    function _overchargeBps(uint256 seed) internal pure returns (uint16) {
        return uint16(_pick(seed, 10_001, 12_000));
    }

    /// @dev Records a disturbance lasting one to eight more handler calls, or extends the one already on the target.
    function _disturb(Kind kind, address target, uint256 durationSeed) internal {
        uint256 until = calls + _pick(durationSeed, 1, MAX_DISTURBANCE);
        for (uint256 i; i < _disturbances.length; ++i) {
            Disturbance storage active = _disturbances[i];
            if (active.kind == kind && active.target == target) {
                if (until > active.until) active.until = until;
                return;
            }
        }
        _disturbances.push(Disturbance({kind: kind, target: target, until: until}));
    }

    /// @dev Lifts every disturbance whose time is up.
    function _lift() internal {
        uint256 i;
        while (i < _disturbances.length) {
            Disturbance memory active = _disturbances[i];
            if (active.until > calls) {
                ++i;
                continue;
            }
            if (active.kind == Kind.TOKEN_PAUSE) {
                MockStockToken(active.target).setPaused(false);
            } else if (active.kind == Kind.ORACLE_PAUSE) {
                MockStockToken(active.target).setOraclePaused(false);
            } else if (active.kind == Kind.BLOCK) {
                registry.setBlocked(active.target, false);
            } else {
                InvPool(active.target).setFillBps(10_000);
                InvPool(active.target).setUnavailable(false);
                InvPool(active.target).setWithheldBps(0);
            }
            _disturbances[i] = _disturbances[_disturbances.length - 1];
            _disturbances.pop();
        }
    }

    /// @dev Every pool's price from its ticker's latest positive answer and its premium.
    function _reprice() internal {
        for (uint256 i; i < pools.length; ++i) {
            InvPool pool = pools[i];
            uint8 tickerId = poolTicker[address(pool)];
            uint256 base = NO_FEED_PRICE;
            if (tickerId < 3) {
                (, int256 answer,,,) = feeds[tickerId].latestRoundData();
                if (answer <= 0) continue;
                base = uint256(answer);
            }
            uint256 price = base * uint256(int256(BPS) + poolPremiumBps[address(pool)]) / BPS;
            pool.setPrice(price == 0 ? 1 : price);
        }
    }
}
