// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {Vm} from "forge-std/Vm.sol";
import {IERC20Errors} from "@openzeppelin/contracts/interfaces/draft-IERC6093.sol";
import {Math} from "@openzeppelin/contracts/utils/math/Math.sol";
import {ISleeveModule} from "../../../src/interfaces/ISleeveModule.sol";
import {SessionCalendar} from "../../../src/libraries/SessionCalendar.sol";
import {AccountingMode, Reason, Status, Trigger} from "../../../src/types/SleeveTypes.sol";
import {InvPool} from "../../mocks/InvPool.sol";
import {MockFeed} from "../../mocks/MockFeed.sol";
import {MockStockToken} from "../../mocks/MockStockToken.sol";
import {InvDeployment, SleeveWorld} from "./SleeveWorld.sol";

/// @notice The invariant suite's model of SleeveModule: a ghost of every account's ledgers, rule, keeper and
/// observation, and of every lot, kept from the suite's own record of what each call did, and an independent
/// prediction of every call: the revert it must give, or the exact events it must emit, receipts field by field. Income
/// is tracked apart from the ledgers (I6): payments that arrive with no account action add to the income waiting, a
/// split may sort at most that, and only a split, an owner outflow taken out of unsorted, an outside pull or an install
/// takes it away. An outside pull larger than the income waiting leaves a deficit, which later income pays down first,
/// because the module sees only balances (D-013); a split, an owner inflow's bracket or a sell reconciles what is left
/// of it, spend first, then the buckets in PRD 7.2's order, so neither the owner's inflow nor a sale's proceeds ever
/// refill a bucket (I6, audit I-01 and I-03), and a settle waits for that reconcile (I4, audit I-02). Sells take their
/// lots oldest first or by id, mirror the buy guard with the off-hours override, and put their proceeds in spend; the
/// lot reconcile trims lots oldest first down to the token balance (component 6, audit A1-03).
/// @dev Each call is first predicted on memory copies (Ctx, Acct), then run, then compared. The ghost is committed
/// only when the call did what the model predicted, so a call that reverts leaves both sides as they were. Findings
/// are recorded as violations and asserted by the invariant functions, because a revert inside a handler would be
/// discarded with fail_on_revert off.
abstract contract SleeveModel is SleeveWorld {
    // Violation kinds, one invariant function each.
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

    /// @notice The ghost of one account, as the module should hold it.
    struct Acct {
        bool installed;
        bool listed;
        uint256 spend;
        uint256[4] amount;
        uint64[4] since;
        Reason[4] reason;
        ISleeveModule.Rule rule;
        uint32 versions;
        address keeper;
        uint64 observedAt;
        uint128 observedUnsorted;
    }

    /// @notice One call in flight: who, the next receipt id, the account's USDG as the model walks the call, the
    /// bracket, the predicted revert, the income waiting as the call uses it, and the balance changes the call may
    /// make.
    struct Ctx {
        string action;
        address account;
        address caller;
        uint256 nextId;
        uint256 actual;
        bool bracket;
        uint256 begin;
        int256 md;
        bool reverted;
        bytes revertData;
        uint256 income;
        uint256 deficit;
        string i4;
        string i6;
        uint256[] before;
        int256[] deltas;
        bool intoBuckets;
        bool sold;
        bool soldThroughModule;
        bool reconciledForSell;
        bool trimmed;
    }

    enum Outcome {
        BUY,
        QUEUE,
        REFUSE_TICKER,
        REFUSE_ACCOUNT,
        REVERT
    }

    /// @notice What the guard reads for a ticker and a pool, in PRD 7.4 order, with the rounds it read.
    struct GuardView {
        Outcome outcome;
        Reason reason;
        bytes revertData;
        address token;
        address feed;
        bool open;
        uint256 openedAt;
        uint80 roundId;
        int256 answer;
        uint256 updatedAt;
        uint80 usdgRoundId;
        int256 usdgAnswer;
    }

    /// @notice What a buy through the venue does.
    struct BuyView {
        bool reverts;
        bytes revertData;
        bool premiumFail;
        uint256 minOut;
        uint256 delivered;
        int256 premiumBps;
        uint256 execPrice;
    }

    /// @notice One event the module must emit, with what the receipt checks need to know about it.
    struct Expected {
        bytes32[] topics;
        bytes data;
        bool split;
        uint16 cap;
        uint16 equityBps;
    }

    struct NewLot {
        uint256 id;
        address account;
        uint8 tickerId;
        Status status;
        uint256 tokens;
    }

    /// @notice One sell, as ISleeveModule.sell takes it.
    struct SellOrder {
        uint8 tickerId;
        uint256 tokenAmount;
        uint256 lotId;
        address pool;
        uint256 quote;
        bool overrideClosed;
        uint16 overrideCapBps;
    }

    /// @notice What a sell's guard read and its swap delivers.
    struct SellView {
        address token;
        address feed;
        uint16 capBps;
        uint256 minOut;
        uint80 roundId;
        int256 answer;
        uint256 updatedAt;
        uint80 usdgRoundId;
        int256 usdgAnswer;
        uint256 delivered;
        int256 discountBps;
    }

    /// @notice The lots a sell takes from, how many tokens each gives, and the status each moves to.
    struct SellPlan {
        uint256[] ids;
        uint256[] takes;
        uint256 count;
        Status[] statuses;
    }

    /// @notice A lot queue head the call in flight moved.
    struct HeadChange {
        address account;
        uint8 tickerId;
    }

    mapping(address account => Acct) internal _ghost;
    /// @notice Income waiting: USDG outsiders paid in since the latest install that no split sorted, no owner outflow
    /// took out of unsorted, no outside pull took and no deficit absorbed. It must equal the module's unsorted USDG.
    mapping(address account => uint256) public ghostIncomeWaiting;
    /// @notice USDG outside pulls took beyond the income waiting, less income that arrived since, until a split
    /// reconciles it. It must equal the amount by which the module's ledgers exceed the balance.
    mapping(address account => uint256) public ghostDeficit;

    uint256 public lastReceiptId;
    mapping(uint256 id => bytes32) public receiptHashAt;
    uint256[] internal _lotIds;
    mapping(uint256 lotId => ISleeveModule.Lot) internal _lots;
    mapping(address account => mapping(uint8 tickerId => uint256[])) internal _lotQueue;
    /// @notice Index into the lot queue of the oldest lot a sell may still take from. Sells and the lot reconcile move
    /// it past the emptied lots at its front.
    mapping(address account => mapping(uint8 tickerId => uint256)) internal _lotHead;

    Expected[] internal _expected;
    NewLot[] internal _newLots;

    /// @dev The call in flight's changes to existing lots and heads, applied at commit: a call that reverts leaves the
    /// ghost as it was. A lot or head staged in the current epoch shadows the committed one.
    uint256 internal _epoch;
    mapping(uint256 lotId => uint256 epoch) internal _lotStagedAt;
    mapping(uint256 lotId => ISleeveModule.Lot) internal _lotStaged;
    uint256[] internal _lotsTouched;
    mapping(address account => mapping(uint8 tickerId => uint256 epoch)) internal _headStagedAt;
    mapping(address account => mapping(uint8 tickerId => uint256)) internal _headStaged;
    HeadChange[] internal _headsTouched;

    uint256[V_KINDS] public violations;
    string[V_KINDS] internal _firstViolation;

    /// @notice How often each receipt status, QUEUED reason and revert was seen, for the reach test and the run log.
    mapping(uint8 status => uint256) public statusSeen;
    mapping(uint8 reason => uint256) public queuedSeen;
    mapping(bytes4 selector => uint256) public revertSeen;
    uint256 public callsMatched;
    /// @notice Owner batches whose outflow reached the buckets.
    uint256 public outflowsIntoBuckets;
    /// @notice Owner batches that sold stock tokens through the router.
    uint256 public ownerSales;
    /// @notice Outside pulls that took more than spend while buckets held USDG, so PRD 7.2 owes part by the buckets.
    uint256 public pullsIntoBuckets;
    /// @notice Fills that ran while the module held a donation of USDG or of the token bought.
    uint256 public fillsBesideDonations;
    /// @notice Sells through the module that went through, and how many of them reconciled an outside pull first.
    uint256 public moduleSells;
    uint256 public sellsAfterAPull;
    /// @notice Lot reconciles that trimmed at least one lot.
    uint256 public lotTrims;

    /// @notice What strangers sent the module, per asset: USDG, then each stock token (I1).
    uint256[ASSETS] public donated;
    /// @notice Ether forced onto the module, as a selfdestruct can (I1).
    uint256 public donatedEther;
    /// @notice What the latest module call did, for the reach test: its revert selector, or zero after a success.
    bytes4 public lastOutcome;
    /// @notice Receipts the latest module call wrote.
    uint256 public lastReceipts;

    constructor(InvDeployment memory d) SleeveWorld(d) {}

    // Views for the invariant functions

    function firstViolation(uint8 kind) external view returns (string memory) {
        return _firstViolation[kind];
    }

    function ghostOf(address account) external view returns (Acct memory) {
        return _ghost[account];
    }

    function lotIds() external view returns (uint256[] memory) {
        return _lotIds;
    }

    function ghostLot(uint256 lotId) external view returns (ISleeveModule.Lot memory) {
        return _lots[lotId];
    }

    function ghostLotQueue(address account, uint8 tickerId) external view returns (uint256[] memory) {
        return _lotQueue[account][tickerId];
    }

    function ghostLotHead(address account, uint8 tickerId) external view returns (uint256) {
        return _lotHead[account][tickerId];
    }

    function accountAt(uint256 index) external view returns (address) {
        return address(accounts[index]);
    }

    function poolCount() external view returns (uint256) {
        return pools.length;
    }

    function poolAt(uint256 index) external view returns (address) {
        return address(pools[index]);
    }

    function trackedHolders() external view returns (address[] memory) {
        return holders;
    }

    // Recording

    function _violate(uint8 kind, string memory what) internal {
        if (violations[kind]++ == 0) _firstViolation[kind] = what;
    }

    function _say(Ctx memory c, string memory what) internal view returns (string memory) {
        return string.concat(c.action, " on account ", vm.toString(_accountIndex(c.account)), ": ", what);
    }

    // The call cycle

    /// @dev A fresh context: clears the expectations and snapshots the tracked balances.
    function _begin(string memory action, address account, address caller) internal returns (Ctx memory c) {
        delete _expected;
        delete _newLots;
        delete _lotsTouched;
        delete _headsTouched;
        ++_epoch;
        c.action = action;
        c.account = account;
        c.caller = caller;
        c.nextId = lastReceiptId + 1;
        c.actual = usdg.balanceOf(account);
        c.income = ghostIncomeWaiting[account];
        c.deficit = ghostDeficit[account];
        c.before = _balances();
        c.deltas = new int256[](c.before.length);
    }

    /// @dev Runs the call as `sender`, then compares it with the prediction.
    function _run(Ctx memory c, Acct memory g, address sender, address target, bytes memory data) internal {
        vm.recordLogs();
        vm.prank(sender);
        (bool ok, bytes memory ret) = target.call(data);
        _finish(c, g, ok, ret, vm.getRecordedLogs());
    }

    function _finish(Ctx memory c, Acct memory g, bool ok, bytes memory ret, Vm.Log[] memory logs) internal {
        lastOutcome = ok ? bytes4(0) : ret.length >= 4 ? bytes4(ret) : bytes4(0xdeadbeef);
        lastReceipts = ok ? c.nextId - 1 - lastReceiptId : 0;
        if (!ok) {
            if (ret.length >= 4) ++revertSeen[bytes4(ret)];
            if (!c.reverted) {
                _violate(V_MODEL, _say(c, string.concat("unexpected revert ", vm.toString(ret))));
            } else if (keccak256(ret) != keccak256(c.revertData)) {
                _violate(
                    V_MODEL,
                    _say(
                        c,
                        string.concat(
                            "revert ", vm.toString(ret), " where the model expects ", vm.toString(c.revertData)
                        )
                    )
                );
            } else {
                ++callsMatched;
            }
            return;
        }
        if (c.reverted) {
            _violate(V_MODEL, _say(c, string.concat("succeeded where the model expects ", vm.toString(c.revertData))));
            return;
        }
        _compareEvents(c, logs);
        _checkBalances(c);
        _commit(c, g);
        ++callsMatched;
    }

    function _commit(Ctx memory c, Acct memory g) internal {
        _ghost[c.account] = g;
        lastReceiptId = c.nextId - 1;
        ghostIncomeWaiting[c.account] = c.income;
        ghostDeficit[c.account] = c.deficit;
        if (bytes(c.i4).length != 0) _violate(V_I4, _say(c, c.i4));
        if (bytes(c.i6).length != 0) _violate(V_I6, _say(c, c.i6));
        if (c.intoBuckets) ++outflowsIntoBuckets;
        if (c.sold) ++ownerSales;
        if (c.soldThroughModule) ++moduleSells;
        if (c.reconciledForSell) ++sellsAfterAPull;
        if (c.trimmed) ++lotTrims;
        for (uint256 i; i < _newLots.length; ++i) {
            NewLot memory lot = _newLots[i];
            _lots[lot.id] = ISleeveModule.Lot({
                account: lot.account,
                tickerId: lot.tickerId,
                status: lot.status,
                tokensBought: uint128(lot.tokens),
                tokensRemaining: uint128(lot.tokens)
            });
            _lotQueue[lot.account][lot.tickerId].push(lot.id);
            _lotIds.push(lot.id);
        }
        for (uint256 i; i < _lotsTouched.length; ++i) {
            _lots[_lotsTouched[i]] = _lotStaged[_lotsTouched[i]];
        }
        for (uint256 i; i < _headsTouched.length; ++i) {
            HeadChange memory head = _headsTouched[i];
            _lotHead[head.account][head.tickerId] = _headStaged[head.account][head.tickerId];
        }
    }

    function _revert(Ctx memory c, bytes memory data) internal pure {
        c.reverted = true;
        c.revertData = data;
    }

    // Account-level model steps

    function _trigger(Ctx memory c, Acct memory g) internal pure returns (Trigger) {
        if (c.caller == c.account) return Trigger.OWNER;
        if (g.keeper != address(0) && c.caller == g.keeper) return Trigger.KEEPER;
        return Trigger.PUBLIC;
    }

    function _pending(Acct memory g) internal pure returns (uint256 total) {
        for (uint256 t; t < 4; ++t) {
            total += g.amount[t];
        }
    }

    /// @dev The balance a split computes unsorted from: inside a bracket, the balance at begin plus the module's own
    /// delta, floored at zero; otherwise the account's balance as the model walks the call.
    function _sortingBalance(Ctx memory c) internal pure returns (uint256) {
        if (!c.bracket) return c.actual;
        int256 virtualBalance = int256(c.begin) + c.md;
        return virtualBalance > 0 ? uint256(virtualBalance) : 0;
    }

    /// @dev split: _enter, the public grace, then reconcile, nothing, or the sort.
    function _modelSplit(Ctx memory c, Acct memory g, address pool, uint256 quote) internal {
        if (c.reverted) return;
        if (!_enter(c, g, quote)) return;
        uint256 balance = _sortingBalance(c);
        uint256 ledgers = g.spend + _pending(g);
        uint256 unsorted = balance > ledgers ? balance - ledgers : 0;
        if (_trigger(c, g) == Trigger.PUBLIC) {
            bool covered = g.observedAt != 0 && unsorted < uint256(g.observedUnsorted) + OBSERVE_RESTART_GROWTH;
            uint256 readyAt = (covered ? g.observedAt : block.timestamp) + GRACE;
            if (!covered || block.timestamp < readyAt) {
                return _revert(c, abi.encodeWithSelector(ISleeveModule.GracePeriodActive.selector, readyAt));
            }
        }
        uint256 shortfall = ledgers > balance ? ledgers - balance : 0;
        if (shortfall != c.deficit && bytes(c.i6).length == 0) {
            c.i6 = string.concat(
                "a split found a shortfall of ", vm.toString(shortfall), " but the deficit is ", vm.toString(c.deficit)
            );
        }
        if (unsorted == 0) {
            if (shortfall != 0) _modelReconcile(c, g, balance, shortfall);
        } else {
            _modelSort(c, g, pool, quote, unsorted);
            if (c.reverted) return;
            g.observedAt = 0;
            g.observedUnsorted = 0;
        }
        _useIncome(c, unsorted, "a split sorted");
        if (c.income != 0 && bytes(c.i6).length == 0) {
            c.i6 = string.concat("a split left income waiting: ", vm.toString(c.income));
        }
        c.income = 0;
        c.deficit = 0;
    }

    /// @dev Takes USDG out of the income waiting. More than is waiting means the module treated owner money or a
    /// module action's USDG as income (I6).
    function _useIncome(Ctx memory c, uint256 amount, string memory what) internal pure {
        if (amount > c.income && bytes(c.i6).length == 0) {
            c.i6 = string.concat(what, " ", vm.toString(amount), " but the income waiting is ", vm.toString(c.income));
        }
        c.income = amount > c.income ? 0 : c.income - amount;
    }

    /// @dev The checks split and settle share, in the module's order. False when the call reverts.
    function _enter(Ctx memory c, Acct memory g, uint256 quote) internal pure returns (bool) {
        if (!g.installed) {
            _revert(c, abi.encodeWithSelector(ISleeveModule.NotInstalled.selector, c.account));
            return false;
        }
        if (c.caller != c.account && c.bracket) {
            _revert(c, abi.encodeWithSelector(ISleeveModule.OwnerOpOpen.selector, c.account));
            return false;
        }
        if (g.rule.status != ISleeveModule.RuleStatus.ACTIVE) {
            _revert(c, abi.encodeWithSelector(ISleeveModule.RuleNotActive.selector, c.account));
            return false;
        }
        if (quote == 0) {
            _revert(c, abi.encodeWithSelector(ISleeveModule.ZeroQuote.selector));
            return false;
        }
        if (!g.listed) {
            _revert(c, abi.encodeWithSelector(ISleeveModule.ModuleNotListed.selector, c.account));
            return false;
        }
        return true;
    }

    /// @dev Spend first, then the buckets in ascending ticker id, down to the balance. Nothing is unsorted after it, so
    /// the observed level drops to zero (audit A1-25).
    function _modelReconcile(Ctx memory c, Acct memory g, uint256 balance, uint256 shortfall) internal {
        uint256 fromSpend = Math.min(g.spend, shortfall);
        uint256 rest = shortfall - fromSpend;
        uint256[] memory cuts = new uint256[](4);
        for (uint256 t; t < 4; ++t) {
            cuts[t] = Math.min(rest, g.amount[t]);
            rest -= cuts[t];
            _cutBucket(g, t, cuts[t]);
        }
        g.spend -= fromSpend;
        g.observedUnsorted = 0;
        ISleeveModule.Receipt memory r;
        r.ruleVersion = g.rule.version;
        r.trigger = _trigger(c, g);
        r.status = Status.RECONCILED;
        r.usdgIn = shortfall;
        r.usdgSpent = fromSpend;
        r.usdgQueued = shortfall - fromSpend;
        uint256 id = c.nextId;
        _expectReceipt(c, r, false, 0, 0);
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = ISleeveModule.Reconciled.selector;
        topics[1] = _word(c.account);
        topics[2] = bytes32(id);
        _expectEvent(topics, abi.encode(balance, fromSpend, cuts));
    }

    /// @dev The share split, the guard on the equity part, and its one receipt.
    function _modelSort(Ctx memory c, Acct memory g, address pool, uint256 quote, uint256 unsorted) internal {
        uint256 equity = Math.mulDiv(unsorted, g.rule.equityBps, BPS);
        uint256 spendPart = unsorted - equity;
        uint8 tickerId = g.rule.tickerId;
        ISleeveModule.Receipt memory r;
        r.ruleVersion = g.rule.version;
        r.trigger = _trigger(c, g);
        r.tickerId = tickerId;
        r.usdgIn = unsorted;
        r.usdgToSpend = spendPart;
        r.usdgToEquity = equity;
        if (equity == 0) {
            g.spend += spendPart;
            r.token = _tokenOf(tickerId);
            (r.status, r.reason) = (Status.QUEUED, Reason.CLIP);
            return _expectReceipt(c, r, true, g.rule.premiumCapBps, g.rule.equityBps);
        }
        GuardView memory v = _predictGuard(c.account, tickerId, pool);
        if (v.outcome == Outcome.REVERT) return _revert(c, v.revertData);
        g.spend += spendPart;
        _fillGuard(r, v);
        if (v.outcome == Outcome.REFUSE_TICKER || v.outcome == Outcome.REFUSE_ACCOUNT) {
            g.spend += equity;
            r.usdgToSpend = unsorted;
            r.status = v.outcome == Outcome.REFUSE_TICKER ? Status.REFUSED_TICKER : Status.REFUSED_ACCOUNT;
        } else if (v.outcome == Outcome.QUEUE || equity < g.rule.minClip) {
            _queue(g, tickerId, equity, v.outcome == Outcome.QUEUE ? v.reason : Reason.CLIP, r);
        } else {
            BuyView memory b = _predictBuy(c, pool, equity, quote, g.rule, v.answer);
            if (b.reverts) return _revert(c, b.revertData);
            _swapFields(r, quote, b.minOut, pool);
            if (b.premiumFail) {
                r.premiumBps = b.premiumBps;
                _queue(g, tickerId, equity, Reason.PREMIUM, r);
            } else {
                _fill(c, r, b, Status.FILLED, pool, equity);
            }
        }
        _expectReceipt(c, r, true, g.rule.premiumCapBps, g.rule.equityBps);
    }

    /// @dev settle: _enter, the ledgers within the balance (audit I-02), an empty bucket, the guard, the clip unless
    /// the guard refuses the bucket (audit A1-31), the public grace from the bucket and the session (audit A1-05),
    /// GuardNotClear, then the buy or the refusal.
    function _modelSettle(Ctx memory c, Acct memory g, uint8 tickerId, address pool, uint256 quote) internal {
        if (c.reverted) return;
        if (!_enter(c, g, quote)) return;
        uint256 amount = g.amount[tickerId];
        uint256 ledgers = g.spend + _pending(g);
        uint256 sorting = _sortingBalance(c);
        if (ledgers > sorting) {
            return _revert(
                c, abi.encodeWithSelector(ISleeveModule.LedgersAboveBalance.selector, c.account, ledgers - sorting)
            );
        }
        if (amount == 0) {
            return _revert(c, abi.encodeWithSelector(ISleeveModule.BelowClip.selector, 0, uint128(g.rule.minClip)));
        }
        GuardView memory v = _predictGuard(c.account, tickerId, pool);
        if (v.outcome == Outcome.REVERT) return _revert(c, v.revertData);
        bool refused = v.outcome == Outcome.REFUSE_TICKER || v.outcome == Outcome.REFUSE_ACCOUNT;
        if (!refused && amount < g.rule.minClip) {
            return _revert(c, abi.encodeWithSelector(ISleeveModule.BelowClip.selector, amount, uint128(g.rule.minClip)));
        }
        if (_trigger(c, g) == Trigger.PUBLIC) {
            uint256 since = g.since[tickerId];
            uint256 readyAt = (v.open ? Math.max(since, v.openedAt) : since) + GRACE;
            if (block.timestamp < readyAt) {
                return _revert(c, abi.encodeWithSelector(ISleeveModule.GracePeriodActive.selector, readyAt));
            }
        }
        if (v.outcome == Outcome.QUEUE) {
            return _revert(c, abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, v.reason));
        }
        ISleeveModule.Receipt memory r;
        r.ruleVersion = g.rule.version;
        r.trigger = _trigger(c, g);
        r.tickerId = tickerId;
        r.usdgToEquity = amount;
        r.queuedSince = g.since[tickerId];
        _fillGuard(r, v);
        if (v.outcome == Outcome.BUY) {
            r.reason = g.reason[tickerId];
            BuyView memory b = _predictBuy(c, pool, amount, quote, g.rule, v.answer);
            if (b.reverts) return _revert(c, b.revertData);
            if (b.premiumFail) {
                return _revert(c, abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, Reason.PREMIUM));
            }
            _swapFields(r, quote, b.minOut, pool);
            uint256 unbacked = _pullCut(c, g, tickerId);
            if (unbacked != 0 && bytes(c.i4).length == 0) {
                c.i4 = string.concat(
                    "settle bought the whole bucket of ",
                    vm.toString(amount),
                    " although an unreconciled outside pull took ",
                    vm.toString(unbacked),
                    " of it in PRD 7.2 order"
                );
            }
            _fill(c, r, b, Status.SETTLED, pool, amount);
        } else {
            g.spend += amount;
            r.usdgToSpend = amount;
            r.status = v.outcome == Outcome.REFUSE_TICKER ? Status.REFUSED_TICKER : Status.REFUSED_ACCOUNT;
        }
        _clearBucket(g, tickerId);
        _expectReceipt(c, r, false, g.rule.premiumCapBps, g.rule.equityBps);
    }

    /// @dev release by the account: the whole bucket to spend, no guard.
    function _modelRelease(Ctx memory c, Acct memory g, uint8 tickerId) internal {
        if (c.reverted) return;
        if (!g.installed) {
            return _revert(c, abi.encodeWithSelector(ISleeveModule.NotInstalled.selector, c.account));
        }
        if (g.amount[tickerId] == 0) {
            return _revert(c, abi.encodeWithSelector(ISleeveModule.EmptyBucket.selector, c.account, tickerId));
        }
        _releaseOne(c, g, tickerId);
    }

    /// @dev One RELEASED receipt, trigger OWNER, as release and the install and uninstall releases write it.
    function _releaseOne(Ctx memory c, Acct memory g, uint8 tickerId) internal returns (uint256 amount) {
        amount = g.amount[tickerId];
        ISleeveModule.Receipt memory r;
        r.ruleVersion = g.rule.version;
        r.trigger = Trigger.OWNER;
        r.status = Status.RELEASED;
        r.reason = g.reason[tickerId];
        r.tickerId = tickerId;
        r.token = _tokenOf(tickerId);
        r.usdgToSpend = amount;
        r.queuedSince = g.since[tickerId];
        g.spend += amount;
        _clearBucket(g, tickerId);
        _expectReceipt(c, r, false, 0, 0);
    }

    function _modelObserve(Ctx memory c, Acct memory g) internal {
        if (c.reverted) return;
        if (!g.installed) {
            return _revert(c, abi.encodeWithSelector(ISleeveModule.NotInstalled.selector, c.account));
        }
        uint256 balance = _sortingBalance(c);
        uint256 pending = _pending(g);
        uint256 ledgers = g.spend + pending;
        uint256 unsorted = balance > ledgers ? balance - ledgers : 0;
        if (unsorted == 0 && pending == 0) {
            return _revert(c, abi.encodeWithSelector(ISleeveModule.NothingWaiting.selector, c.account));
        }
        if (g.observedAt != 0 && unsorted < uint256(g.observedUnsorted) + OBSERVE_RESTART_GROWTH) {
            if (g.observedUnsorted > unsorted) g.observedUnsorted = uint128(unsorted);
            return;
        }
        g.observedAt = uint64(block.timestamp);
        g.observedUnsorted = uint128(unsorted);
        bytes32[] memory topics = new bytes32[](2);
        topics[0] = ISleeveModule.Observed.selector;
        topics[1] = _word(c.account);
        _expectEvent(topics, abi.encode(g.observedAt, g.observedUnsorted));
    }

    function _modelSetRule(Ctx memory c, Acct memory g, ISleeveModule.RuleInput memory input) internal {
        if (c.reverted) return;
        if (!g.installed) {
            return _revert(c, abi.encodeWithSelector(ISleeveModule.NotInstalled.selector, c.account));
        }
        _writeRule(c, g, input);
    }

    /// @dev setRule's checks in the module's order, then the next version, ACTIVE, and RuleSet.
    function _writeRule(Ctx memory c, Acct memory g, ISleeveModule.RuleInput memory input) internal {
        bytes memory refusal = _ruleRefusal(input);
        if (refusal.length != 0) return _revert(c, refusal);
        g.versions += 1;
        g.rule = ISleeveModule.Rule({
            version: g.versions,
            status: ISleeveModule.RuleStatus.ACTIVE,
            equityBps: input.equityBps,
            tickerId: input.tickerId,
            premiumCapBps: input.premiumCapBps,
            slippageBps: input.slippageBps,
            minClip: input.minClip
        });
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = ISleeveModule.RuleSet.selector;
        topics[1] = _word(c.account);
        topics[2] = bytes32(uint256(g.versions));
        _expectEvent(topics, abi.encode(g.rule));
    }

    function _ruleRefusal(ISleeveModule.RuleInput memory input) internal view returns (bytes memory) {
        if (uint256(input.spendBps) + input.equityBps != BPS) {
            return abi.encodeWithSelector(ISleeveModule.SharesSumNotTotal.selector, input.spendBps, input.equityBps);
        }
        if (input.tickerId >= tokenSource.tickerCount()) {
            return abi.encodeWithSelector(ISleeveModule.TickerNotListed.selector, input.tickerId);
        }
        (, address feed, SessionCalendar.SessionType sessionType, bool active) = _ticker(input.tickerId);
        if (!active) return abi.encodeWithSelector(ISleeveModule.TickerNotActive.selector, input.tickerId);
        if (feed == address(0)) return abi.encodeWithSelector(ISleeveModule.TickerHasNoFeed.selector, input.tickerId);
        if (sessionType == SessionCalendar.SessionType.NONE) {
            return abi.encodeWithSelector(ISleeveModule.TickerHasNoSession.selector, input.tickerId);
        }
        if (input.premiumCapBps > MAX_CAP_BPS) {
            return abi.encodeWithSelector(ISleeveModule.PremiumCapAboveMax.selector, input.premiumCapBps, MAX_CAP_BPS);
        }
        if (input.slippageBps > MAX_CAP_BPS) {
            return abi.encodeWithSelector(ISleeveModule.SlippageAboveMax.selector, input.slippageBps, MAX_CAP_BPS);
        }
        if (input.minClip < MIN_CLIP_FLOOR) {
            return abi.encodeWithSelector(ISleeveModule.MinClipBelowFloor.selector, input.minClip, MIN_CLIP_FLOOR);
        }
        return "";
    }

    function _modelPause(Ctx memory c, Acct memory g, bool pause) internal {
        if (c.reverted) return;
        if (!g.installed) {
            return _revert(c, abi.encodeWithSelector(ISleeveModule.NotInstalled.selector, c.account));
        }
        if (g.rule.status == ISleeveModule.RuleStatus.NONE) {
            return _revert(c, abi.encodeWithSelector(ISleeveModule.NoRule.selector, c.account));
        }
        ISleeveModule.RuleStatus from = pause ? ISleeveModule.RuleStatus.ACTIVE : ISleeveModule.RuleStatus.PAUSED;
        if (g.rule.status != from) {
            bytes4 selector = pause ? ISleeveModule.RuleNotActive.selector : ISleeveModule.RuleNotPaused.selector;
            return _revert(c, abi.encodeWithSelector(selector, c.account));
        }
        g.rule.status = pause ? ISleeveModule.RuleStatus.PAUSED : ISleeveModule.RuleStatus.ACTIVE;
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = pause ? ISleeveModule.RulePaused.selector : ISleeveModule.RuleResumed.selector;
        topics[1] = _word(c.account);
        topics[2] = bytes32(uint256(g.rule.version));
        _expectEvent(topics, "");
    }

    function _modelSetKeeper(Ctx memory c, Acct memory g, address keeper) internal {
        if (c.reverted) return;
        if (!g.installed) {
            return _revert(c, abi.encodeWithSelector(ISleeveModule.NotInstalled.selector, c.account));
        }
        g.keeper = keeper;
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = ISleeveModule.KeeperSet.selector;
        topics[1] = _word(c.account);
        topics[2] = _word(keeper);
        _expectEvent(topics, "");
    }

    /// @dev onInstall through the account's installModule: leftover buckets released, the snapshot, an open bracket
    /// restarted, Installed, then the rule. A rule that fails setRule's checks reverts the whole install.
    function _modelInstall(
        Ctx memory c,
        Acct memory g,
        address keeper,
        ISleeveModule.RuleInput memory input,
        bool hasRule
    ) internal {
        if (c.reverted) return;
        for (uint8 t; t < TICKERS && _pending(g) != 0; ++t) {
            if (g.amount[t] != 0) _releaseOne(c, g, t);
        }
        address accountKeeper = keeper == address(0) ? defaultKeeper : keeper;
        g.installed = true;
        g.listed = true;
        g.spend = c.actual;
        g.keeper = accountKeeper;
        g.observedAt = 0;
        g.observedUnsorted = 0;
        delete g.rule;
        if (c.bracket) {
            c.begin = c.actual;
            c.md = 0;
        }
        c.income = 0;
        c.deficit = 0;
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = ISleeveModule.Installed.selector;
        topics[1] = _word(c.account);
        topics[2] = _word(accountKeeper);
        _expectEvent(topics, abi.encode(c.actual));
        if (hasRule) _writeRule(c, g, input);
    }

    /// @dev uninstallModule: the account delists the module and calls onUninstall, ignoring a failure. `skipped`
    /// stands for an onUninstall that failed, which leaves the module's state behind.
    function _modelUninstall(Ctx memory c, Acct memory g, bool skipped) internal {
        if (c.reverted) return;
        g.listed = false;
        if (skipped || !g.installed) return;
        _wipe(c, g);
    }

    /// @dev onUninstall called by the account itself outside uninstallModule: NotInstalled without state, and
    /// ModuleStillListed while the account still lists the module, which keeps the state (audit A1-24). Only an
    /// account that already delisted the module, after an uninstall whose onUninstall failed, gets the state wiped.
    function _modelOnUninstall(Ctx memory c, Acct memory g) internal {
        if (c.reverted) return;
        if (!g.installed) {
            return _revert(c, abi.encodeWithSelector(ISleeveModule.NotInstalled.selector, c.account));
        }
        if (g.listed) {
            return _revert(c, abi.encodeWithSelector(ISleeveModule.ModuleStillListed.selector, c.account));
        }
        _wipe(c, g);
    }

    /// @dev onUninstall's effect: every bucket released with a RELEASED receipt, then the account's state deleted.
    function _wipe(Ctx memory c, Acct memory g) internal {
        uint256 released;
        for (uint8 t; t < TICKERS && _pending(g) != 0; ++t) {
            if (g.amount[t] != 0) released += _releaseOne(c, g, t);
        }
        g.installed = false;
        g.spend = 0;
        delete g.rule;
        g.keeper = address(0);
        g.observedAt = 0;
        g.observedUnsorted = 0;
        c.income = 0;
        c.deficit = 0;
        bytes32[] memory topics = new bytes32[](2);
        topics[0] = ISleeveModule.Uninstalled.selector;
        topics[1] = _word(c.account);
        _expectEvent(topics, abi.encode(released));
    }

    /// @dev beginOwnerOp. Needs the module installed.
    function _modelBegin(Ctx memory c, Acct memory g) internal pure {
        if (c.reverted) return;
        if (!g.installed) {
            return _revert(c, abi.encodeWithSelector(ISleeveModule.NotInstalled.selector, c.account));
        }
        c.bracket = true;
        c.begin = c.actual;
        c.md = 0;
    }

    /// @dev endOwnerOp: nothing when the account uninstalled inside the bracket; otherwise the owner delta to spend,
    /// or an outflow off spend, then unsorted at the virtual balance, then the buckets in ascending ticker id.
    function _modelEnd(Ctx memory c, Acct memory g) internal {
        if (c.reverted) return;
        c.bracket = false;
        if (!g.installed) return;
        int256 ownerDelta = int256(c.actual) - int256(c.begin) - c.md;
        uint256 fromSpend;
        uint256 fromUnsorted;
        uint256[] memory fromBuckets;
        if (ownerDelta >= 0) {
            int256 virtualSigned = int256(c.begin) + c.md;
            uint256 virtualBalance = virtualSigned > 0 ? uint256(virtualSigned) : 0;
            uint256 ledgers = g.spend + _pending(g);
            if (ownerDelta != 0 && ledgers > virtualBalance) {
                _modelReconcile(c, g, virtualBalance, ledgers - virtualBalance);
                c.deficit = 0;
            }
            _checkInflowAfterPull(c, g, uint256(ownerDelta));
            g.spend += uint256(ownerDelta);
        } else {
            uint256 outflow = uint256(-ownerDelta);
            int256 virtualSigned = int256(c.begin) + c.md;
            uint256 virtualBalance = virtualSigned > 0 ? uint256(virtualSigned) : 0;
            uint256 pending = _pending(g);
            uint256 unsortedV = virtualBalance > g.spend + pending ? virtualBalance - g.spend - pending : 0;
            fromSpend = Math.min(outflow, g.spend);
            uint256 rest = outflow - fromSpend;
            fromUnsorted = Math.min(rest, unsortedV);
            rest -= fromUnsorted;
            _useIncome(c, fromUnsorted, "an owner outflow took from unsorted");
            if (outflow > g.spend + unsortedV) {
                fromBuckets = new uint256[](4);
                for (uint256 t; t < 4; ++t) {
                    fromBuckets[t] = Math.min(rest, g.amount[t]);
                    rest -= fromBuckets[t];
                    _cutBucket(g, t, fromBuckets[t]);
                }
                c.intoBuckets = true;
            }
            if (rest != 0) _violate(V_MODEL, _say(c, "outflow larger than the ledgers"));
            g.spend -= fromSpend;
            uint256 unsortedLeft = unsortedV - fromUnsorted;
            if (g.observedUnsorted > unsortedLeft) g.observedUnsorted = uint128(unsortedLeft);
        }
        bytes32[] memory topics = new bytes32[](2);
        topics[0] = ISleeveModule.OwnerOpEnded.selector;
        topics[1] = _word(c.account);
        _expectEvent(topics, abi.encode(c.begin, c.md, ownerDelta, fromSpend, fromUnsorted, fromBuckets));
    }

    /// @dev I6 at an owner inflow: while an outside pull larger than spend is unreconciled, PRD 7.2's order owes the
    /// rest of it by the buckets. Crediting the inflow to spend first lets the next reconcile, spend first, take that
    /// rest out of the owner's inflow, so owner USDG stays in pending equity and a settle buys stock with it.
    function _checkInflowAfterPull(Ctx memory c, Acct memory g, uint256 inflow) internal pure {
        uint256 pending = _pending(g);
        if (inflow == 0 || pending == 0 || c.deficit <= g.spend || bytes(c.i6).length != 0) return;
        uint256 refill = Math.min(inflow, Math.min(c.deficit - g.spend, pending));
        c.i6 = string.concat(
            "an owner inflow of ",
            vm.toString(inflow),
            " went to spend while an unreconciled outside pull still owed ",
            vm.toString(c.deficit - g.spend),
            " by the buckets, so ",
            vm.toString(refill),
            " of the owner's USDG stays in pending equity after the next reconcile"
        );
    }

    /// @dev What an unreconciled outside pull takes from a bucket in PRD 7.2's order: spend first, then the buckets in
    /// ascending ticker id. Unsorted is zero while the ledgers exceed the balance.
    function _pullCut(Ctx memory c, Acct memory g, uint256 tickerId) internal pure returns (uint256) {
        if (c.deficit <= g.spend) return 0;
        uint256 rest = c.deficit - g.spend;
        for (uint256 t; t < tickerId; ++t) {
            rest = rest > g.amount[t] ? rest - g.amount[t] : 0;
        }
        return Math.min(rest, g.amount[tickerId]);
    }

    // Buckets

    function _queue(Acct memory g, uint8 tickerId, uint256 amount, Reason reason, ISleeveModule.Receipt memory r)
        internal
        view
    {
        if (g.amount[tickerId] == 0) g.since[tickerId] = uint64(block.timestamp);
        g.amount[tickerId] += amount;
        g.reason[tickerId] = reason;
        r.status = Status.QUEUED;
        r.reason = reason;
        r.usdgQueued = amount;
    }

    function _cutBucket(Acct memory g, uint256 tickerId, uint256 cut) internal pure {
        if (cut == 0) return;
        g.amount[tickerId] -= cut;
        if (g.amount[tickerId] == 0) _clearBucket(g, tickerId);
    }

    function _clearBucket(Acct memory g, uint256 tickerId) internal pure {
        g.amount[tickerId] = 0;
        g.since[tickerId] = 0;
        g.reason[tickerId] = Reason.NONE;
    }

    // Guard and venue

    /// @dev PRD 7.4 steps 1 to 7 from the mocks' state, in the module's order, and the rounds each step reads.
    function _predictGuard(address account, uint8 tickerId, address pool) internal view returns (GuardView memory v) {
        SessionCalendar.SessionType sessionType;
        bool active;
        (v.token, v.feed, sessionType, active) = _ticker(tickerId);
        (v.open,, v.openedAt) = calendar.sessionState(block.timestamp, sessionType);
        if (!active || v.feed == address(0)) {
            v.outcome = Outcome.REFUSE_TICKER;
            return v;
        }
        if (!tokenSource.isPoolAllowed(tickerId, pool)) {
            if (tokenSource.poolsOf(tickerId).length == 0) {
                v.outcome = Outcome.REFUSE_TICKER;
                return v;
            }
            v.outcome = Outcome.REVERT;
            v.revertData = abi.encodeWithSelector(ISleeveModule.PoolNotAllowed.selector, tickerId, pool);
            return v;
        }
        if (registry.isBlocked(account)) {
            v.outcome = Outcome.REFUSE_ACCOUNT;
            return v;
        }
        if (registry.isBlocked(pool)) {
            v.outcome = Outcome.REVERT;
            v.revertData = abi.encodeWithSelector(ISleeveModule.PoolBlocked.selector, pool);
            return v;
        }
        MockStockToken token = MockStockToken(v.token);
        if (token.paused()) return _queueView(v, Reason.PAUSED);
        if (token.oraclePaused()) return _queueView(v, Reason.ORACLE_PAUSED);
        if (!v.open) return _queueView(v, Reason.SESSION);
        if (_multiplierDue(token)) return _queueView(v, Reason.MULTIPLIER);
        uint256 startedAt;
        (v.roundId, v.answer, startedAt, v.updatedAt,) = MockFeed(v.feed).latestRoundData();
        if (_stale(v.answer, startedAt, v.updatedAt, v.openedAt)) return _queueView(v, Reason.STALE);
        uint256 usdgUpdatedAt;
        (v.usdgRoundId, v.usdgAnswer,, usdgUpdatedAt,) = usdgFeed.latestRoundData();
        if (_depegged(v.usdgAnswer, usdgUpdatedAt)) return _queueView(v, Reason.DEPEG);
        v.outcome = Outcome.BUY;
    }

    function _queueView(GuardView memory v, Reason reason) internal pure returns (GuardView memory) {
        v.outcome = Outcome.QUEUE;
        v.reason = reason;
        return v;
    }

    function _multiplierDue(MockStockToken token) internal view returns (bool) {
        uint256 effectiveAt = token.effectiveAt();
        if (effectiveAt <= block.timestamp || effectiveAt - block.timestamp > MULTIPLIER_WINDOW) return false;
        return token.newUIMultiplier() != token.uiMultiplier();
    }

    /// @dev STALE as readStockFeed judges a round: a round observed (startedAt) or transmitted (updatedAt) before the
    /// session opened is refused (audit A1-10).
    function _stale(int256 answer, uint256 startedAt, uint256 updatedAt, uint256 openedAt)
        internal
        view
        returns (bool)
    {
        return answer <= 0 || updatedAt > block.timestamp || block.timestamp - updatedAt > MAX_AGE
            || updatedAt < openedAt || startedAt < openedAt;
    }

    function _depegged(int256 answer, uint256 updatedAt) internal view returns (bool) {
        if (answer <= 0 || updatedAt > block.timestamp || block.timestamp - updatedAt > MAX_AGE) return true;
        uint256 price = uint256(answer);
        if (price > 2e8) return true;
        return price * BPS < 1e8 * (BPS - DEPEG_BPS) || price * BPS > 1e8 * (BPS + DEPEG_BPS);
    }

    /// @dev The buy through the router and pool: a quote too large for the minOut arithmetic (audit A1-37), the
    /// pool's delivery and the callback's pull with no router minimum, the module's balance checks, the exact premium
    /// test and only then the trigger's minimum (PRD 7.4 steps 8 and 9, audit A1-12). InvPool pays out of its own
    /// balance and is paid by the callback, so the pool always shows the same fill as the account (audit A1-23).
    function _predictBuy(
        Ctx memory c,
        address pool,
        uint256 amount,
        uint256 quote,
        ISleeveModule.Rule memory rule,
        int256 answer
    ) internal view returns (BuyView memory b) {
        b.reverts = true;
        (uint256 high,) = Math.mul512(amount, quote);
        if (high >= QUOTE_UNIT) {
            b.revertData = abi.encodeWithSelector(ISleeveModule.QuoteTooLarge.selector, quote);
            return b;
        }
        b.minOut = Math.mulDiv(Math.mulDiv(amount, quote, QUOTE_UNIT), BPS - rule.slippageBps, BPS);
        InvPool venue = InvPool(pool);
        if (venue.unavailable()) {
            b.revertData = abi.encodeWithSelector(InvPool.PoolUnavailable.selector);
            return b;
        }
        (uint256 used,, uint256 delivered) = venue.quote(address(usdg), amount);
        if (used > amount) {
            b.revertData =
                abi.encodeWithSelector(IERC20Errors.ERC20InsufficientAllowance.selector, address(router), amount, used);
        } else if (c.actual < used) {
            b.revertData =
                abi.encodeWithSelector(IERC20Errors.ERC20InsufficientBalance.selector, c.account, c.actual, used);
        } else if (used != amount) {
            b.revertData = abi.encodeWithSelector(ISleeveModule.PartialFill.selector, amount, used);
        } else if (delivered == 0) {
            b.revertData = abi.encodeWithSelector(ISleeveModule.TooFewTokens.selector, 0, b.minOut);
        } else {
            b.reverts = false;
        }
        if (b.reverts) return b;
        b.delivered = delivered;
        uint256 value = delivered * uint256(answer);
        b.premiumBps = int256(Math.mulDiv(amount, PREMIUM_SCALE, value, Math.Rounding.Ceil)) - int256(BPS);
        b.premiumFail = amount * PREMIUM_SCALE > value * (BPS + rule.premiumCapBps);
        if (!b.premiumFail && delivered < b.minOut) {
            b.reverts = true;
            b.revertData = abi.encodeWithSelector(ISleeveModule.TooFewTokens.selector, delivered, b.minOut);
            return b;
        }
        b.execPrice = Math.mulDiv(amount, 1e18, delivered, Math.Rounding.Ceil);
    }

    function _fillGuard(ISleeveModule.Receipt memory r, GuardView memory v) internal pure {
        r.token = v.token;
        r.roundId = v.roundId;
        r.answer = v.answer;
        r.updatedAt = v.updatedAt;
        r.usdgRoundId = v.usdgRoundId;
        r.usdgAnswer = v.usdgAnswer;
    }

    function _swapFields(ISleeveModule.Receipt memory r, uint256 quote, uint256 minOut, address pool) internal pure {
        r.quote = quote;
        r.minOut = minOut;
        r.venueId = 1;
        r.pool = pool;
    }

    /// @dev A FILLED or SETTLED buy: the receipt's fill fields, the USDG and tokens it moves, and its lot.
    function _fill(
        Ctx memory c,
        ISleeveModule.Receipt memory r,
        BuyView memory b,
        Status status,
        address pool,
        uint256 amount
    ) internal {
        MockStockToken token = MockStockToken(r.token);
        r.status = status;
        r.usdgSpent = amount;
        r.tokensOut = b.delivered;
        r.execPrice = b.execPrice;
        r.premiumBps = b.premiumBps;
        r.tokenUid = token.uid();
        r.uiMultiplier = token.uiMultiplier();
        r.lotId = c.nextId;
        c.actual -= amount;
        if (c.bracket) c.md -= int256(amount);
        _move(c, c.account, 0, -int256(amount));
        _move(c, pool, 0, int256(amount));
        uint256 asset = _assetOf(r.token);
        _move(c, c.account, asset, int256(b.delivered));
        _move(c, pool, asset, -int256(b.delivered));
        _newLots.push(
            NewLot({id: c.nextId, account: c.account, tickerId: r.tickerId, status: status, tokens: b.delivered})
        );
    }

    /// @dev A balance change the call is allowed to make.
    function _move(Ctx memory c, address holder, uint256 asset, int256 amount) internal view {
        c.deltas[_slot(holder, asset)] += amount;
    }

    // Lots

    /// @dev A lot as the call in flight sees it: staged by an earlier step of the call, created by one, or committed.
    function _lotView(uint256 lotId) internal view returns (ISleeveModule.Lot memory lot) {
        if (_lotStagedAt[lotId] == _epoch) return _lotStaged[lotId];
        for (uint256 i; i < _newLots.length; ++i) {
            NewLot storage created = _newLots[i];
            if (created.id != lotId) continue;
            return ISleeveModule.Lot({
                account: created.account,
                tickerId: created.tickerId,
                status: created.status,
                tokensBought: uint128(created.tokens),
                tokensRemaining: uint128(created.tokens)
            });
        }
        return _lots[lotId];
    }

    /// @dev An account's lot ids for a ticker as the call in flight sees them: the committed queue, then the lots the
    /// call created, in order.
    function _queueView(address account, uint8 tickerId) internal view returns (uint256[] memory ids) {
        uint256[] storage committed = _lotQueue[account][tickerId];
        uint256 created;
        for (uint256 i; i < _newLots.length; ++i) {
            if (_newLots[i].account == account && _newLots[i].tickerId == tickerId) ++created;
        }
        ids = new uint256[](committed.length + created);
        for (uint256 i; i < committed.length; ++i) {
            ids[i] = committed[i];
        }
        uint256 next = committed.length;
        for (uint256 i; i < _newLots.length; ++i) {
            if (_newLots[i].account == account && _newLots[i].tickerId == tickerId) ids[next++] = _newLots[i].id;
        }
    }

    function _headView(address account, uint8 tickerId) internal view returns (uint256) {
        if (_headStagedAt[account][tickerId] == _epoch) return _headStaged[account][tickerId];
        return _lotHead[account][tickerId];
    }

    function _stageLot(uint256 lotId, ISleeveModule.Lot memory lot) internal {
        if (_lotStagedAt[lotId] != _epoch) {
            _lotStagedAt[lotId] = _epoch;
            _lotsTouched.push(lotId);
        }
        _lotStaged[lotId] = lot;
    }

    /// @dev Moves the head past the lots at the queue's front that hold no tokens, as the module does after a sell
    /// and a lot reconcile.
    function _advanceHead(address account, uint8 tickerId) internal {
        uint256[] memory ids = _queueView(account, tickerId);
        uint256 head = _headView(account, tickerId);
        while (head < ids.length && _lotView(ids[head]).tokensRemaining == 0) {
            ++head;
        }
        if (_headStagedAt[account][tickerId] != _epoch) {
            _headStagedAt[account][tickerId] = _epoch;
            _headsTouched.push(HeadChange({account: account, tickerId: tickerId}));
        }
        _headStaged[account][tickerId] = head;
    }

    /// @dev The account's balance of an asset as the model walks the call.
    function _heldNow(Ctx memory c, uint256 asset) internal view returns (int256) {
        return int256(_asset(asset).balanceOf(c.account)) + c.deltas[_slot(c.account, asset)];
    }

    // Sell-back (component 6)

    /// @dev sell, in SleeveSell's order: the account's checks, the lots, the quote, the ticker and pool, the balance,
    /// the mirrored guard with the override, a reconcile of an outside pull before the proceeds land (audit I-03), the
    /// lots taken, the swap measured on the account and the pool, the discount cap, then the minimum, the proceeds to
    /// spend and the module delta, and one receipt per lot.
    function _modelSell(Ctx memory c, Acct memory g, SellOrder memory o) internal {
        if (c.reverted) return;
        bytes memory refusal = _sellEntry(c, g, o);
        if (refusal.length != 0) return _revert(c, refusal);
        SellPlan memory plan;
        bytes memory planError;
        (plan.ids, plan.takes, plan.count, planError) = _planSell(c.account, o);
        if (planError.length != 0) return _revert(c, planError);
        SellView memory v;
        v.capBps = o.overrideCapBps == 0 ? g.rule.premiumCapBps : o.overrideCapBps;
        (uint256 high,) = Math.mul512(o.tokenAmount, o.quote);
        if (high >= SELL_QUOTE_UNIT) {
            return _revert(c, abi.encodeWithSelector(ISleeveModule.QuoteTooLarge.selector, o.quote));
        }
        v.minOut = Math.mulDiv(Math.mulDiv(o.tokenAmount, o.quote, SELL_QUOTE_UNIT), BPS - g.rule.slippageBps, BPS);
        bytes memory guardError = _sellChecks(c, o, v);
        if (guardError.length != 0) return _revert(c, guardError);

        uint256 sorting = _sortingBalance(c);
        uint256 ledgers = g.spend + _pending(g);
        if (ledgers > sorting) {
            _modelReconcile(c, g, sorting, ledgers - sorting);
            c.deficit = 0;
            c.reconciledForSell = true;
        }
        plan.statuses = _takeLots(c.account, o.tickerId, plan.ids, plan.takes, plan.count);
        _modelSellFill(c, g, o, v, plan);
    }

    /// @dev The sell's swap and what follows it: the discount cap, then the minimum, then the proceeds and receipts.
    function _modelSellFill(Ctx memory c, Acct memory g, SellOrder memory o, SellView memory v, SellPlan memory plan)
        internal
    {
        bytes memory swapError = _predictSellSwap(c, o, v);
        if (swapError.length != 0) return _revert(c, swapError);
        uint256 value = o.tokenAmount * uint256(v.answer);
        v.discountBps = int256(BPS) - int256(v.delivered * PREMIUM_SCALE / value);
        if (v.delivered * PREMIUM_SCALE < value * (BPS - v.capBps)) {
            return _revert(c, abi.encodeWithSelector(ISleeveModule.DiscountAboveCap.selector, v.discountBps, v.capBps));
        }
        if (v.delivered < v.minOut) {
            return _revert(c, abi.encodeWithSelector(ISleeveModule.TooLittleUsdg.selector, v.delivered, v.minOut));
        }
        g.spend += v.delivered;
        c.actual += v.delivered;
        if (c.bracket) c.md += int256(v.delivered);
        uint256 asset = _assetOf(v.token);
        _move(c, c.account, asset, -int256(o.tokenAmount));
        _move(c, o.pool, asset, int256(o.tokenAmount));
        _move(c, o.pool, 0, -int256(v.delivered));
        _move(c, c.account, 0, int256(v.delivered));
        c.soldThroughModule = true;
        _expectSold(c, g, o, v, plan);
    }

    /// @dev The checks that need no lot: installed, a non-zero amount and quote, the override cap in range, listed.
    function _sellEntry(Ctx memory c, Acct memory g, SellOrder memory o) internal pure returns (bytes memory) {
        if (!g.installed) return abi.encodeWithSelector(ISleeveModule.NotInstalled.selector, c.account);
        if (o.tokenAmount == 0) return abi.encodeWithSelector(ISleeveModule.ZeroAmount.selector);
        if (o.quote == 0) return abi.encodeWithSelector(ISleeveModule.ZeroQuote.selector);
        uint16 ruleCap = g.rule.premiumCapBps;
        if (o.overrideCapBps != 0 && (o.overrideCapBps < ruleCap || o.overrideCapBps > MAX_CAP_BPS)) {
            return abi.encodeWithSelector(
                ISleeveModule.OverrideCapOutOfRange.selector, o.overrideCapBps, ruleCap, MAX_CAP_BPS
            );
        }
        if (!g.listed) return abi.encodeWithSelector(ISleeveModule.ModuleNotListed.selector, c.account);
        return "";
    }

    /// @dev The lots a sell takes from: the named lot, or the account's lots of the ticker from the head, oldest
    /// first, skipping empty ones, at most MAX_LOTS_PER_CALL of them.
    function _planSell(address account, SellOrder memory o)
        internal
        view
        returns (uint256[] memory ids, uint256[] memory takes, uint256 count, bytes memory planError)
    {
        if (o.lotId != 0) {
            ISleeveModule.Lot memory lot = _lotView(o.lotId);
            if (lot.account == address(0)) {
                return (ids, takes, 0, abi.encodeWithSelector(ISleeveModule.UnknownLot.selector, o.lotId));
            }
            if (lot.account != account || lot.tickerId != o.tickerId) {
                return (ids, takes, 0, abi.encodeWithSelector(ISleeveModule.LotMismatch.selector, o.lotId));
            }
            if (lot.tokensRemaining < o.tokenAmount) {
                return (
                    ids,
                    takes,
                    0,
                    abi.encodeWithSelector(ISleeveModule.ExceedsLots.selector, o.tokenAmount, lot.tokensRemaining)
                );
            }
            ids = new uint256[](1);
            takes = new uint256[](1);
            (ids[0], takes[0]) = (o.lotId, o.tokenAmount);
            return (ids, takes, 1, "");
        }
        uint256[] memory queue = _queueView(account, o.tickerId);
        uint256 head = _headView(account, o.tickerId);
        ids = new uint256[](queue.length - head);
        takes = new uint256[](queue.length - head);
        uint256 needed = o.tokenAmount;
        for (uint256 i = head; i < queue.length && needed != 0; ++i) {
            uint256 remaining = _lotView(queue[i]).tokensRemaining;
            if (remaining == 0) continue;
            if (count == MAX_LOTS_PER_CALL) {
                return (
                    ids,
                    takes,
                    0,
                    abi.encodeWithSelector(
                        ISleeveModule.TooManyLots.selector, o.tokenAmount - needed, MAX_LOTS_PER_CALL
                    )
                );
            }
            uint256 take = Math.min(remaining, needed);
            (ids[count], takes[count]) = (queue[i], take);
            ++count;
            needed -= take;
        }
        if (needed != 0) {
            planError =
                abi.encodeWithSelector(ISleeveModule.ExceedsLots.selector, o.tokenAmount, o.tokenAmount - needed);
        }
    }

    /// @dev The ticker's feed, the pool on the allowlist, the balance, then the guard mirrored from the buy: the
    /// account, the pool and the router off the blocklist, the steps the override cannot skip as GuardNotClear, then
    /// the session and the round as SellWaits unless overrideClosed skips them; under the override a round that is not
    /// positive or from the future is GuardNotClear(STALE).
    function _sellChecks(Ctx memory c, SellOrder memory o, SellView memory v) internal view returns (bytes memory) {
        SessionCalendar.SessionType sessionType;
        (v.token, v.feed, sessionType,) = _ticker(o.tickerId);
        if (v.feed == address(0)) return abi.encodeWithSelector(ISleeveModule.TickerHasNoFeed.selector, o.tickerId);
        if (!tokenSource.isPoolAllowed(o.tickerId, o.pool)) {
            return abi.encodeWithSelector(ISleeveModule.PoolNotAllowed.selector, o.tickerId, o.pool);
        }
        int256 held = _heldNow(c, _assetOf(v.token));
        uint256 balance = held > 0 ? uint256(held) : 0;
        if (balance < o.tokenAmount) {
            return abi.encodeWithSelector(ISleeveModule.ExceedsBalance.selector, o.tokenAmount, balance);
        }
        if (registry.isBlocked(c.account)) {
            return abi.encodeWithSelector(ISleeveModule.AccountBlocked.selector, c.account);
        }
        if (registry.isBlocked(o.pool)) return abi.encodeWithSelector(ISleeveModule.PoolBlocked.selector, o.pool);
        if (registry.isBlocked(address(router))) {
            return abi.encodeWithSelector(ISleeveModule.RouterBlocked.selector, address(router));
        }
        Reason reason = _sellMarketReason(v);
        if (reason != Reason.NONE) return abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, reason);
        uint256 openedAt;
        uint256 maxAge = type(uint256).max;
        if (!o.overrideClosed) {
            bool open;
            (open,, openedAt) = calendar.sessionState(block.timestamp, sessionType);
            if (!open) return abi.encodeWithSelector(ISleeveModule.SellWaits.selector, Reason.SESSION);
            maxAge = MAX_AGE;
        }
        uint256 startedAt;
        (v.roundId, v.answer, startedAt, v.updatedAt,) = MockFeed(v.feed).latestRoundData();
        bool stale = v.answer <= 0 || v.updatedAt > block.timestamp || block.timestamp - v.updatedAt > maxAge
            || v.updatedAt < openedAt || startedAt < openedAt;
        if (!stale) return "";
        if (o.overrideClosed) return abi.encodeWithSelector(ISleeveModule.GuardNotClear.selector, Reason.STALE);
        return abi.encodeWithSelector(ISleeveModule.SellWaits.selector, Reason.STALE);
    }

    /// @dev PAUSED, ORACLE_PAUSED, MULTIPLIER and DEPEG, in that order, with the USDG/USD round once it is read.
    function _sellMarketReason(SellView memory v) internal view returns (Reason) {
        MockStockToken token = MockStockToken(v.token);
        if (token.paused()) return Reason.PAUSED;
        if (token.oraclePaused()) return Reason.ORACLE_PAUSED;
        if (_multiplierDue(token)) return Reason.MULTIPLIER;
        uint256 usdgUpdatedAt;
        (v.usdgRoundId, v.usdgAnswer,, usdgUpdatedAt,) = usdgFeed.latestRoundData();
        if (_depegged(v.usdgAnswer, usdgUpdatedAt)) return Reason.DEPEG;
        return Reason.NONE;
    }

    /// @dev Takes the plan's tokens off its lots, each to PART_SOLD, or SOLD once empty (I7), and moves the head.
    function _takeLots(address account, uint8 tickerId, uint256[] memory ids, uint256[] memory takes, uint256 count)
        internal
        returns (Status[] memory statuses)
    {
        statuses = new Status[](count);
        for (uint256 i; i < count; ++i) {
            ISleeveModule.Lot memory lot = _lotView(ids[i]);
            bool open = lot.status == Status.FILLED || lot.status == Status.SETTLED || lot.status == Status.PART_SOLD;
            if (!open) _violate(V_I7, string.concat("a sell took from lot ", vm.toString(ids[i]), " after SOLD"));
            lot.tokensRemaining -= uint128(takes[i]);
            statuses[i] = lot.tokensRemaining == 0 ? Status.SOLD : Status.PART_SOLD;
            lot.status = statuses[i];
            _stageLot(ids[i], lot);
        }
        _advanceHead(account, tickerId);
    }

    /// @dev The sell side of InvPool through InvRouter, with no router minimum: the pool pays the USDG first out of
    /// its balance, then the callback pulls the tokens it used under the exact approval. Then the module's checks: the
    /// whole amount spent, USDG arrived, and the pool showing the same fill.
    function _predictSellSwap(Ctx memory c, SellOrder memory o, SellView memory v)
        internal
        view
        returns (bytes memory)
    {
        InvPool pool = InvPool(o.pool);
        if (pool.unavailable()) return abi.encodeWithSelector(InvPool.PoolUnavailable.selector);
        (uint256 used,, uint256 delivered) = pool.quote(v.token, o.tokenAmount);
        int256 poolUsdg = int256(usdg.balanceOf(o.pool)) + c.deltas[_slot(o.pool, 0)];
        if (poolUsdg < int256(delivered)) {
            return abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientBalance.selector, o.pool, uint256(poolUsdg), delivered
            );
        }
        if (used > o.tokenAmount) {
            return abi.encodeWithSelector(
                IERC20Errors.ERC20InsufficientAllowance.selector, address(router), o.tokenAmount, used
            );
        }
        if (used != o.tokenAmount) {
            return abi.encodeWithSelector(ISleeveModule.PartialFill.selector, o.tokenAmount, used);
        }
        if (delivered == 0) return abi.encodeWithSelector(ISleeveModule.TooLittleUsdg.selector, 0, v.minOut);
        v.delivered = delivered;
        return "";
    }

    /// @dev One PART_SOLD or SOLD receipt per lot, in the plan's order, with the lot's pro rata share; the last lot
    /// takes the rounding remainder. The rest of each receipt is the whole sell's.
    function _expectSold(Ctx memory c, Acct memory g, SellOrder memory o, SellView memory v, SellPlan memory plan)
        internal
    {
        ISleeveModule.Receipt memory r;
        r.ruleVersion = g.rule.version;
        r.trigger = Trigger.OWNER;
        r.tickerId = o.tickerId;
        r.token = v.token;
        r.tokenUid = MockStockToken(v.token).uid();
        r.uiMultiplier = MockStockToken(v.token).uiMultiplier();
        r.execPrice = v.delivered * 1e18 / o.tokenAmount;
        r.premiumBps = v.discountBps;
        r.roundId = v.roundId;
        r.answer = v.answer;
        r.updatedAt = v.updatedAt;
        r.usdgRoundId = v.usdgRoundId;
        r.usdgAnswer = v.usdgAnswer;
        r.quote = o.quote;
        r.minOut = v.minOut;
        r.venueId = 1;
        r.pool = o.pool;
        r.overrideClosed = o.overrideClosed;
        r.overrideCapBps = o.overrideCapBps;
        uint256 paid;
        for (uint256 i; i < plan.count; ++i) {
            uint256 share = i + 1 == plan.count ? v.delivered - paid : v.delivered * plan.takes[i] / o.tokenAmount;
            paid += share;
            r.status = plan.statuses[i];
            r.tokensIn = plan.takes[i];
            r.usdgOut = share;
            r.usdgToSpend = share;
            r.lotId = plan.ids[i];
            _expectReceipt(c, r, false, 0, 0);
        }
    }

    /// @dev reconcileLots: NotInstalled, nothing when the lots fit the balance, else the lots trimmed oldest first
    /// from the head, at most MAX_LOTS_PER_CALL of them, one RECONCILED receipt per trimmed lot, the head moved, and
    /// LotsReconciled with what was trimmed (audit A1-03, A1-13).
    function _modelReconcileLots(Ctx memory c, Acct memory g, uint8 tickerId) internal {
        if (c.reverted) return;
        if (!g.installed) return _revert(c, abi.encodeWithSelector(ISleeveModule.NotInstalled.selector, c.account));
        uint256[] memory ids = _queueView(c.account, tickerId);
        uint256 head = _headView(c.account, tickerId);
        uint256 lotTokens;
        for (uint256 i = head; i < ids.length; ++i) {
            lotTokens += _lotView(ids[i]).tokensRemaining;
        }
        if (lotTokens == 0) return;
        address token = _tokenOf(tickerId);
        int256 held = _heldNow(c, _assetOf(token));
        uint256 balance = held > 0 ? uint256(held) : 0;
        if (lotTokens <= balance) return;
        ISleeveModule.Receipt memory r;
        r.ruleVersion = g.rule.version;
        r.trigger = Trigger.OWNER;
        r.status = Status.RECONCILED;
        r.tickerId = tickerId;
        r.token = token;
        uint256 trimmed = _modelTrimLots(c, r, ids, head, lotTokens - balance);
        _advanceHead(c.account, tickerId);
        bytes32[] memory topics = new bytes32[](3);
        topics[0] = ISleeveModule.LotsReconciled.selector;
        topics[1] = _word(c.account);
        topics[2] = bytes32(uint256(tickerId));
        _expectEvent(topics, abi.encode(balance, trimmed));
        c.trimmed = true;
    }

    /// @dev Trims `excess` off the lots from the head, oldest first, at most MAX_LOTS_PER_CALL lots, with one
    /// RECONCILED receipt per trimmed lot.
    /// @return trimmed The tokens trimmed.
    function _modelTrimLots(
        Ctx memory c,
        ISleeveModule.Receipt memory r,
        uint256[] memory ids,
        uint256 head,
        uint256 excess
    ) internal returns (uint256 trimmed) {
        uint256 lotsTrimmed;
        for (uint256 i = head; i < ids.length && trimmed != excess && lotsTrimmed < MAX_LOTS_PER_CALL; ++i) {
            ISleeveModule.Lot memory lot = _lotView(ids[i]);
            uint256 trim = Math.min(lot.tokensRemaining, excess - trimmed);
            if (trim == 0) continue;
            trimmed += trim;
            ++lotsTrimmed;
            lot.tokensRemaining -= uint128(trim);
            _stageLot(ids[i], lot);
            r.tokensIn = trim;
            r.lotId = ids[i];
            _expectReceipt(c, r, false, 0, 0);
        }
    }

    // Expected events

    function _word(address value) internal pure returns (bytes32) {
        return bytes32(uint256(uint160(value)));
    }

    function _expectEvent(bytes32[] memory topics, bytes memory data) internal {
        _expected.push(Expected({topics: topics, data: data, split: false, cap: 0, equityBps: 0}));
    }

    /// @dev Fills the fields SleeveReceipts writes and expects ReceiptWritten under the next id.
    function _expectReceipt(Ctx memory c, ISleeveModule.Receipt memory r, bool split, uint16 cap, uint16 equityBps)
        internal
    {
        r.id = c.nextId++;
        r.account = c.account;
        r.mode = AccountingMode.WRAPPED;
        r.calendarVersion = calendar.version();
        r.disclosureHash = DISCLOSURE_HASH;
        r.l2Block = block.number;
        r.timestamp = block.timestamp;
        bytes32[] memory topics = new bytes32[](4);
        topics[0] = ISleeveModule.ReceiptWritten.selector;
        topics[1] = bytes32(r.id);
        topics[2] = _word(c.account);
        topics[3] = bytes32(uint256(uint8(r.status)));
        _expected.push(Expected({topics: topics, data: abi.encode(r), split: split, cap: cap, equityBps: equityBps}));
    }

    // Comparisons

    /// @dev The module's events against the expected list, in order, and the receipt checks on every receipt the
    /// module wrote.
    function _compareEvents(Ctx memory c, Vm.Log[] memory logs) internal {
        uint256 next;
        uint256 expectedId = lastReceiptId + 1;
        for (uint256 i; i < logs.length; ++i) {
            if (logs[i].emitter != address(module)) continue;
            Expected memory e;
            bool known = next < _expected.length;
            if (known) e = _expected[next];
            if (!known) {
                _violate(V_MODEL, _say(c, string.concat("unexpected event ", vm.toString(logs[i].topics[0]))));
            } else if (keccak256(abi.encode(logs[i].topics)) != keccak256(abi.encode(e.topics))) {
                _violate(V_MODEL, _say(c, _topicsMismatch(logs[i].topics, e.topics)));
            } else if (keccak256(logs[i].data) != keccak256(e.data)) {
                _violate(V_MODEL, _say(c, _dataMismatch(logs[i].topics[0], logs[i].data, e.data)));
            }
            ++next;
            if (logs[i].topics.length == 4 && logs[i].topics[0] == ISleeveModule.ReceiptWritten.selector) {
                _checkReceipt(c, logs[i], e, known, expectedId++);
            }
        }
        if (next < _expected.length) {
            _violate(V_MODEL, _say(c, string.concat("missing event ", vm.toString(_expected[next].topics[0]))));
        }
    }

    function _topicsMismatch(bytes32[] memory actual, bytes32[] memory expected) internal pure returns (string memory) {
        string memory s = "topics differ: got";
        for (uint256 i; i < actual.length; ++i) {
            s = string.concat(s, " ", vm.toString(actual[i]));
        }
        s = string.concat(s, " expected");
        for (uint256 i; i < expected.length; ++i) {
            s = string.concat(s, " ", vm.toString(expected[i]));
        }
        return s;
    }

    function _dataMismatch(bytes32 topic0, bytes memory actual, bytes memory expected)
        internal
        pure
        returns (string memory)
    {
        if (topic0 != ISleeveModule.ReceiptWritten.selector || actual.length != expected.length) {
            return string.concat(
                "data of ", vm.toString(topic0), " is ", vm.toString(actual), " expected ", vm.toString(expected)
            );
        }
        for (uint256 w; w < actual.length / 32; ++w) {
            bytes32 got;
            bytes32 want;
            assembly ("memory-safe") {
                got := mload(add(add(actual, 0x20), mul(w, 0x20)))
                want := mload(add(add(expected, 0x20), mul(w, 0x20)))
            }
            if (got != want) {
                return string.concat(
                    "receipt field ",
                    _receiptField(w),
                    " is ",
                    vm.toString(uint256(got)),
                    " expected ",
                    vm.toString(uint256(want))
                );
            }
        }
        return "receipt data differ";
    }

    function _receiptField(uint256 index) internal pure returns (string memory) {
        string[39] memory names = [
            "id",
            "account",
            "ruleVersion",
            "trigger",
            "payer",
            "status",
            "reason",
            "mode",
            "tickerId",
            "token",
            "tokenUid",
            "usdgIn",
            "usdgToSpend",
            "usdgToEquity",
            "usdgSpent",
            "usdgQueued",
            "tokensIn",
            "tokensOut",
            "usdgOut",
            "uiMultiplier",
            "execPrice",
            "premiumBps",
            "roundId",
            "answer",
            "updatedAt",
            "usdgRoundId",
            "usdgAnswer",
            "quote",
            "minOut",
            "venueId",
            "pool",
            "calendarVersion",
            "disclosureHash",
            "l2Block",
            "timestamp",
            "lotId",
            "queuedSince",
            "overrideClosed",
            "overrideCapBps"
        ];
        return index < names.length ? names[index] : "?";
    }

    /// @dev I7 on every receipt (sequential id, topics, the stored hash), I2 on split receipts, I6 against the ghost's
    /// unsorted income, and I8 on every fill, all from the receipt the module wrote.
    function _checkReceipt(Ctx memory c, Vm.Log memory log, Expected memory e, bool known, uint256 expectedId)
        internal
    {
        ISleeveModule.Receipt memory r = abi.decode(log.data, (ISleeveModule.Receipt));
        ++statusSeen[uint8(r.status)];
        if (r.status == Status.QUEUED) ++queuedSeen[uint8(r.reason)];
        if (r.id != expectedId) {
            _violate(V_I7, _say(c, string.concat("receipt id ", vm.toString(r.id), " not ", vm.toString(expectedId))));
        }
        if (
            log.topics[1] != bytes32(r.id) || log.topics[2] != _word(r.account)
                || log.topics[3] != bytes32(uint256(uint8(r.status)))
        ) {
            _violate(V_I7, _say(c, "receipt topics differ from its fields"));
        }
        bytes32 stored = module.receiptHash(r.id);
        if (stored != keccak256(log.data)) _violate(V_I7, _say(c, "stored hash differs from the event"));
        if (receiptHashAt[r.id] != bytes32(0)) _violate(V_I7, _say(c, "receipt id written twice"));
        receiptHashAt[r.id] = stored;
        bool splitReceipt = r.status == Status.FILLED || r.status == Status.QUEUED
            || ((r.status == Status.REFUSED_TICKER || r.status == Status.REFUSED_ACCOUNT) && r.usdgIn != 0);
        if (splitReceipt) _checkI2(c, r, e, known);
        if (r.status == Status.FILLED && r.usdgSpent > r.usdgIn) {
            _violate(V_I4, _say(c, "a split spent more than it sorted"));
        }
        if (r.status == Status.SETTLED && r.usdgSpent > r.usdgToEquity) {
            _violate(V_I4, _say(c, "a settle spent more than the bucket"));
        }
        if (r.status == Status.FILLED || r.status == Status.SETTLED) {
            uint16 cap = known ? e.cap : module.ruleOf(r.account).premiumCapBps;
            _checkI8(c, r, cap);
            uint256 asset = _assetOf(r.token);
            if (donated[0] != 0 || (asset < ASSETS && donated[asset] != 0)) ++fillsBesideDonations;
        }
    }

    function _checkI2(Ctx memory c, ISleeveModule.Receipt memory r, Expected memory e, bool known) internal {
        if (r.usdgIn != r.usdgToSpend + r.usdgSpent + r.usdgQueued) {
            _violate(V_I2, _say(c, string.concat("usdgIn ", vm.toString(r.usdgIn), " is not spend + spent + queued")));
        }
        if (!known || !e.split) return;
        uint256 equity = Math.mulDiv(r.usdgIn, e.equityBps, BPS);
        if (r.usdgToEquity != equity) _violate(V_I2, _say(c, "equity part is not the floor of the share"));
        bool refused = r.status == Status.REFUSED_TICKER || r.status == Status.REFUSED_ACCOUNT;
        uint256 toSpend = refused ? r.usdgIn : r.usdgIn - equity;
        if (r.usdgToSpend != toSpend) _violate(V_I2, _say(c, "dust or spend part off"));
    }

    /// @dev I8 from first principles: the cap at the fill, the round the module recorded against the feed now, and
    /// every guard condition read from the mocks at the fill's block.
    function _checkI8(Ctx memory c, ISleeveModule.Receipt memory r, uint16 cap) internal {
        (address token, address feed, SessionCalendar.SessionType sessionType, bool active) = _ticker(r.tickerId);
        (bool open,, uint256 openedAt) = calendar.sessionState(block.timestamp, sessionType);
        string memory problem;
        if (!active || feed == address(0) || token != r.token) problem = "ticker not active";
        else if (!open) problem = "session closed";
        else if (MockStockToken(token).paused()) problem = "token paused";
        else if (MockStockToken(token).oraclePaused()) problem = "oracle paused";
        else if (_multiplierDue(MockStockToken(token))) problem = "multiplier due";
        else if (registry.isBlocked(r.account) || registry.isBlocked(r.pool)) problem = "blocked";
        else problem = _roundProblem(r, feed, openedAt);
        if (bytes(problem).length == 0) problem = _premiumProblem(r, cap);
        if (bytes(problem).length != 0) {
            _violate(V_I8, _say(c, string.concat("fill ", vm.toString(r.id), ": ", problem)));
        }
    }

    function _roundProblem(ISleeveModule.Receipt memory r, address feed, uint256 openedAt)
        internal
        view
        returns (string memory)
    {
        (uint80 roundId, int256 answer, uint256 startedAt, uint256 updatedAt,) = MockFeed(feed).latestRoundData();
        if (r.roundId != roundId || r.answer != answer || r.updatedAt != updatedAt) return "not the latest round";
        if (_stale(answer, startedAt, updatedAt, openedAt)) return "stale round";
        (uint80 usdgRoundId, int256 usdgAnswer,, uint256 usdgUpdatedAt,) = usdgFeed.latestRoundData();
        if (r.usdgRoundId != usdgRoundId || r.usdgAnswer != usdgAnswer) return "not the latest USDG round";
        if (_depegged(usdgAnswer, usdgUpdatedAt)) return "USDG depegged";
        return "";
    }

    function _premiumProblem(ISleeveModule.Receipt memory r, uint16 cap) internal pure returns (string memory) {
        if (r.tokensOut == 0 || r.tokensOut < r.minOut) return "below the minimum";
        if (r.usdgSpent != r.usdgToEquity) return "spent other than the equity";
        uint256 value = r.tokensOut * uint256(r.answer);
        if (r.usdgSpent * PREMIUM_SCALE > value * (BPS + cap)) return "premium above the cap";
        int256 premium = int256(Math.mulDiv(r.usdgSpent, PREMIUM_SCALE, value, Math.Rounding.Ceil)) - int256(BPS);
        if (r.premiumBps != premium || premium > int256(uint256(cap))) return "premium on the receipt";
        return "";
    }

    /// @dev I3 and I4 by balance: every tracked holder's USDG and stock tokens moved exactly as the call was allowed
    /// to move them, so USDG left the account only as a buy's input, only to that buy's pool, and the bought tokens
    /// reached the account.
    function _checkBalances(Ctx memory c) internal {
        uint256[] memory afterwards = _balances();
        for (uint256 i; i < afterwards.length; ++i) {
            int256 moved = int256(afterwards[i]) - int256(c.before[i]);
            if (moved == c.deltas[i]) continue;
            address holder = holders[i / ASSETS];
            uint256 asset = i % ASSETS;
            uint8 kind = holder == address(module) ? V_I1 : asset != 0 && holder == c.account ? V_I3 : V_I4;
            _violate(
                kind,
                _say(
                    c,
                    string.concat(
                        "holder ",
                        vm.toString(holder),
                        " asset ",
                        vm.toString(asset),
                        " moved ",
                        vm.toString(moved),
                        " allowed ",
                        vm.toString(c.deltas[i])
                    )
                )
            );
        }
    }
}
