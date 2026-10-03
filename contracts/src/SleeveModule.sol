// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {MODULE_TYPE_EXECUTOR} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {TransientSlot} from "@openzeppelin/contracts/utils/TransientSlot.sol";
import {SafeCast} from "@openzeppelin/contracts/utils/math/SafeCast.sol";
import {SessionCalendarExtension} from "./SessionCalendarExtension.sol";
import {TokenSource} from "./TokenSource.sol";
import {IAggregatorV3} from "./interfaces/IAggregatorV3.sol";
import {ISleeveModule} from "./interfaces/ISleeveModule.sol";
import {ISwapRouter02} from "./interfaces/ISwapRouter02.sol";
import {LedgerMath} from "./libraries/LedgerMath.sol";
import {PriceGuard} from "./libraries/PriceGuard.sol";
import {SessionCalendar} from "./libraries/SessionCalendar.sol";
import {SleeveBuy} from "./libraries/SleeveBuy.sol";
import {SleeveState} from "./libraries/SleeveState.sol";
import {SleeveTrade} from "./libraries/SleeveTrade.sol";
import {GuardParams, Trigger} from "./types/SleeveTypes.sol";

/// @title SleeveModule
/// @notice The Sleeve ERC-7579 executor, module type 2: per-account ledgers, the owner's rule and keeper, the
/// owner-batch brackets, split, settle and release, lots and the receipt log. USDG that arrives without the account
/// doing anything is unsorted and is the only USDG a split sorts; USDG present at install and USDG an owner batch moves
/// inside its bracket go to the spend ledger (I5, I6). Not upgradeable: a new version is a new install. It holds no
/// funds, ever (I1).
/// @dev Install, rules, keeper and brackets run here. observe, split, settle, the bucket release and the previews run
/// in the external library SleeveTrade and the buy in SleeveBuy, both reached by DELEGATECALL on the one Store state
/// variable with the immutables passed in Env, so they share these ledgers and this receipt log (D-019). Every entry
/// point that writes holds the transient reentrancy lock; executeBuy, reached only from inside split and settle, does
/// not. Every owner function keys its state by msg.sender (D-015). Every bucket write keeps pendingTotal equal to the
/// sum of the account's buckets, and an emptied bucket is deleted.
contract SleeveModule is ISleeveModule, ReentrancyGuardTransient {
    using SafeCast for uint256;
    using SafeCast for int256;
    using TransientSlot for TransientSlot.Uint256Slot;
    using TransientSlot for TransientSlot.Int256Slot;

    /// @inheritdoc ISleeveModule
    uint16 public constant MAX_PREMIUM_CAP_BPS = 500;

    /// @inheritdoc ISleeveModule
    uint16 public constant MAX_SLIPPAGE_BPS = 500;

    /// @inheritdoc ISleeveModule
    uint128 public constant MIN_CLIP_FLOOR = 1e6;

    uint8 internal constant USDG_DECIMALS = 6;

    /// @dev D-009 Q15: the one grace period the module accepts.
    uint256 internal constant GRACE = 3_600;

    /// @dev abi.encode(address, RuleInput): seven words.
    uint256 private constant INSTALL_DATA_LENGTH = 224;

    /// @inheritdoc ISleeveModule
    IERC20 public immutable usdg;

    /// @inheritdoc ISleeveModule
    TokenSource public immutable tokenSource;

    /// @inheritdoc ISleeveModule
    SessionCalendarExtension public immutable calendar;

    /// @inheritdoc ISleeveModule
    ISwapRouter02 public immutable swapRouter;

    /// @inheritdoc ISleeveModule
    IAggregatorV3 public immutable usdgUsdFeed;

    /// @inheritdoc ISleeveModule
    address public immutable defaultKeeper;

    /// @inheritdoc ISleeveModule
    bytes32 public immutable disclosureHash;

    /// @inheritdoc ISleeveModule
    uint256 public immutable grace;

    uint256 internal immutable _stockFeedMaxAge;
    uint256 internal immutable _usdgFeedMaxAge;
    uint16 internal immutable _depegToleranceBps;
    uint256 internal immutable _multiplierWindow;

    SleeveState.Store internal _store;

    /// @dev Caller: the deploy script, which links SleeveTrade and SleeveBuy.
    /// @param config Addresses, limits and constants, checked here because the module is immutable (D-019): code at
    /// every contract address, USDG at 6 decimals, the USDG/USD feed at 8, a calendar that answers version(),
    /// TokenSource on the same USDG, the router on TokenSource's v3 factory, a non-zero keeper and disclosure hash, the
    /// D-014 guard limits and a 3,600-second grace.
    constructor(ModuleConfig memory config) {
        _requireCode(address(config.usdg));
        _requireCode(address(config.tokenSource));
        _requireCode(address(config.calendar));
        _requireCode(address(config.swapRouter));
        _requireCode(address(config.usdgUsdFeed));
        _requireDecimals(address(config.usdg), IERC20Metadata(address(config.usdg)).decimals(), USDG_DECIMALS);
        _requireDecimals(address(config.usdgUsdFeed), config.usdgUsdFeed.decimals(), PriceGuard.FEED_DECIMALS);
        (bool probed, bytes memory version) =
            address(config.calendar).staticcall(abi.encodeCall(SessionCalendarExtension.version, ()));
        if (!probed || version.length != 32) revert CalendarProbeFailed(address(config.calendar));
        address sourceUsdg = config.tokenSource.usdg();
        if (sourceUsdg != address(config.usdg)) revert TokenSourceUsdgMismatch(sourceUsdg, address(config.usdg));
        address routerFactory = config.swapRouter.factory();
        address sourceFactory = config.tokenSource.v3Factory();
        if (routerFactory != sourceFactory) revert RouterFactoryMismatch(routerFactory, sourceFactory);
        if (config.defaultKeeper == address(0)) revert ZeroDefaultKeeper();
        if (config.disclosureHash == bytes32(0)) revert ZeroDisclosureHash();
        if (keccak256(abi.encode(config.guardParams)) != keccak256(abi.encode(PriceGuard.defaultGuardParams()))) {
            revert GuardParamsNotDefault();
        }
        if (config.grace != GRACE) revert GraceNotDefault(config.grace);

        usdg = config.usdg;
        tokenSource = config.tokenSource;
        calendar = config.calendar;
        swapRouter = config.swapRouter;
        usdgUsdFeed = config.usdgUsdFeed;
        defaultKeeper = config.defaultKeeper;
        disclosureHash = config.disclosureHash;
        grace = config.grace;
        _stockFeedMaxAge = config.guardParams.stockFeedMaxAge;
        _usdgFeedMaxAge = config.guardParams.usdgFeedMaxAge;
        _depegToleranceBps = config.guardParams.depegToleranceBps;
        _multiplierWindow = config.guardParams.multiplierWindow;
    }

    // Install and uninstall

    /// @inheritdoc ISleeveModule
    function onInstall(bytes calldata data) external nonReentrant {
        address account = msg.sender;
        (address keeper, RuleInput memory input, bool hasRule) = _decodeInstallData(data);
        SleeveState.Account storage acct = _store.accounts[account];
        if (acct.pendingTotal != 0) _releaseBuckets(account, acct, Trigger.OWNER);

        uint256 balance = usdg.balanceOf(account);
        address accountKeeper = keeper == address(0) ? defaultKeeper : keeper;
        acct.installed = true;
        acct.spend = LedgerMath.installSnapshot(balance).toUint128();
        acct.keeper = accountKeeper;
        acct.observedAt = 0;
        acct.observedUnsorted = 0;
        delete acct.rule;
        _restartOpenOwnerOp(account, balance);
        emit Installed(account, accountKeeper, balance);

        if (hasRule) _writeRule(account, acct, input);
    }

    /// @inheritdoc ISleeveModule
    function onUninstall(bytes calldata) external nonReentrant {
        address account = msg.sender;
        SleeveState.Account storage acct = _installedAccount(account);
        uint256 released;
        if (acct.pendingTotal != 0) released = _releaseBuckets(account, acct, Trigger.OWNER);
        delete _store.accounts[account];
        emit Uninstalled(account, released);
    }

    /// @inheritdoc ISleeveModule
    function isModuleType(uint256 moduleTypeId) external pure returns (bool) {
        return moduleTypeId == MODULE_TYPE_EXECUTOR;
    }

    /// @inheritdoc ISleeveModule
    function isInitialized(address account) external view returns (bool) {
        return _store.accounts[account].installed;
    }

    // Rules and keeper

    /// @inheritdoc ISleeveModule
    function setRule(RuleInput calldata input) external nonReentrant returns (uint32 version) {
        return _writeRule(msg.sender, _installedAccount(msg.sender), input);
    }

    /// @inheritdoc ISleeveModule
    function pauseRule() external nonReentrant {
        Rule storage rule = _installedAccount(msg.sender).rule;
        if (rule.status == RuleStatus.NONE) revert NoRule(msg.sender);
        if (rule.status != RuleStatus.ACTIVE) revert RuleNotActive(msg.sender);
        rule.status = RuleStatus.PAUSED;
        emit RulePaused(msg.sender, rule.version);
    }

    /// @inheritdoc ISleeveModule
    function resumeRule() external nonReentrant {
        Rule storage rule = _installedAccount(msg.sender).rule;
        if (rule.status == RuleStatus.NONE) revert NoRule(msg.sender);
        if (rule.status != RuleStatus.PAUSED) revert RuleNotPaused(msg.sender);
        rule.status = RuleStatus.ACTIVE;
        emit RuleResumed(msg.sender, rule.version);
    }

    /// @inheritdoc ISleeveModule
    function setKeeper(address keeper) external nonReentrant {
        _installedAccount(msg.sender).keeper = keeper;
        emit KeeperSet(msg.sender, keeper);
    }

    // Owner-batch brackets

    /// @inheritdoc ISleeveModule
    function beginOwnerOp() external nonReentrant {
        address account = msg.sender;
        _installedAccount(account);
        TransientSlot.Uint256Slot beginSlot = SleeveState.beginSlot(account);
        if (beginSlot.tload() != 0) revert OwnerOpAlreadyOpen(account);
        beginSlot.tstore(usdg.balanceOf(account) + 1);
    }

    /// @inheritdoc ISleeveModule
    function endOwnerOp() external nonReentrant {
        address account = msg.sender;
        SleeveState.Account storage acct = _store.accounts[account];
        TransientSlot.Uint256Slot beginSlot = SleeveState.beginSlot(account);
        uint256 begun = beginSlot.tload();
        if (begun == 0) {
            if (!acct.installed) revert NotInstalled(account);
            revert OwnerOpNotOpen(account);
        }
        TransientSlot.Int256Slot deltaSlot = SleeveState.deltaSlot(account);
        int256 moduleDelta = deltaSlot.tload();
        beginSlot.tstore(0);
        deltaSlot.tstore(0);
        if (!acct.installed) return;
        _bookOwnerOp(account, acct, begun - 1, moduleDelta);
    }

    // Observe, split, settle, release

    /// @inheritdoc ISleeveModule
    function observe(address account) external nonReentrant returns (uint64 observedAt) {
        return SleeveTrade.observe(_store, usdg, account);
    }

    /// @inheritdoc ISleeveModule
    function split(address account, address pool, uint256 quote) external nonReentrant returns (uint256 receiptId) {
        return SleeveTrade.split(_store, _env(), account, pool, quote);
    }

    /// @inheritdoc ISleeveModule
    function settle(address account, uint8 tickerId, address pool, uint256 quote)
        external
        nonReentrant
        returns (uint256 receiptId)
    {
        return SleeveTrade.settle(_store, _env(), account, tickerId, pool, quote);
    }

    /// @inheritdoc ISleeveModule
    function release(uint8 tickerId) external nonReentrant returns (uint256 receiptId) {
        _installedAccount(msg.sender);
        (, receiptId) = _releaseBucket(msg.sender, tickerId, Trigger.OWNER);
    }

    /// @inheritdoc ISleeveModule
    function executeBuy(BuyOrder calldata order) external returns (BuyFill memory fill) {
        if (msg.sender != address(this)) revert NotSelf(msg.sender);
        return SleeveBuy.execute(usdg, swapRouter, order);
    }

    // Views

    /// @inheritdoc ISleeveModule
    function ledger(address account)
        external
        view
        returns (uint256 balance, uint256 spend, uint256 pendingTotal, uint256 unsorted)
    {
        balance = usdg.balanceOf(account);
        SleeveState.Account storage acct = _store.accounts[account];
        if (!acct.installed) return (balance, 0, 0, 0);
        spend = acct.spend;
        pendingTotal = acct.pendingTotal;
        unsorted = LedgerMath.unsorted(_sortingBalance(account), spend, pendingTotal);
    }

    /// @inheritdoc ISleeveModule
    function ruleOf(address account) external view returns (Rule memory) {
        return _store.accounts[account].rule;
    }

    /// @inheritdoc ISleeveModule
    function keeperOf(address account) external view returns (address) {
        return _store.accounts[account].keeper;
    }

    /// @inheritdoc ISleeveModule
    function bucketOf(address account, uint8 tickerId) external view returns (Bucket memory) {
        return _store.buckets[account][tickerId];
    }

    /// @inheritdoc ISleeveModule
    function ownerOpOpen(address account) external view returns (bool) {
        return SleeveState.ownerOpOpen(account);
    }

    /// @inheritdoc ISleeveModule
    function receiptHash(uint256 id) external view returns (bytes32) {
        return _store.receipts.hashes[id];
    }

    /// @inheritdoc ISleeveModule
    function nextReceiptId() external view returns (uint256) {
        return _store.receipts.count + 1;
    }

    /// @inheritdoc ISleeveModule
    function lot(uint256 lotId) external view returns (Lot memory) {
        return _store.lots[lotId];
    }

    /// @inheritdoc ISleeveModule
    function lotsOf(address account, uint8 tickerId) external view returns (uint256[] memory lotIds, uint256 head) {
        SleeveState.LotQueue storage queue = _store.lotQueues[account][tickerId];
        return (queue.ids, queue.head);
    }

    /// @inheritdoc ISleeveModule
    function observationOf(address account) external view returns (uint64 observedAt, uint128 observedUnsorted) {
        SleeveState.Account storage acct = _store.accounts[account];
        return (acct.observedAt, acct.observedUnsorted);
    }

    /// @inheritdoc ISleeveModule
    function previewSplit(address account) external view returns (SplitPreview memory) {
        return SleeveTrade.previewSplit(_store, _env(), account);
    }

    /// @inheritdoc ISleeveModule
    function previewSettle(address account, uint8 tickerId) external view returns (SettlePreview memory) {
        return SleeveTrade.previewSettle(_store, _env(), account, tickerId);
    }

    /// @inheritdoc ISleeveModule
    function sessionOpenedAt(uint8 tickerId) external view returns (uint256) {
        (,, SessionCalendar.SessionType sessionType,) = tokenSource.ticker(tickerId);
        (bool open,, uint256 openedAt) = calendar.sessionState(block.timestamp, sessionType);
        return open ? openedAt : 0;
    }

    /// @inheritdoc ISleeveModule
    function guardParams() external view returns (GuardParams memory) {
        return _guardParams();
    }

    // Hooks shared with the test harness

    /// @notice Adds a module action's net USDG change for the account to its open bracket (D-009 Q13). Does nothing
    /// when no bracket is open.
    /// @param account The account whose USDG the action moved.
    /// @param delta USDG that arrived, positive, or left, negative, measured by balance.
    function _recordModuleDelta(address account, int256 delta) internal {
        SleeveState.recordModuleDelta(account, delta);
    }

    /// @notice The balance a split or settle computes unsorted from: the virtual balance inside an open bracket,
    /// otherwise the USDG balance. Zero when the virtual balance is negative.
    /// @param account The account.
    function _sortingBalance(address account) internal view returns (uint256) {
        return SleeveState.sortingBalance(usdg, account);
    }

    /// @notice Moves a whole bucket to spend and writes its RELEASED receipt, through SleeveTrade.releaseBucket.
    /// @param account The account.
    /// @param tickerId The bucket's ticker id. Reverts EmptyBucket when the bucket is empty.
    /// @param trigger Who released it.
    /// @return amount USDG released.
    /// @return receiptId The RELEASED receipt.
    function _releaseBucket(address account, uint8 tickerId, Trigger trigger)
        internal
        returns (uint256 amount, uint256 receiptId)
    {
        return SleeveTrade.releaseBucket(_store, _env(), account, tickerId, trigger);
    }

    /// @notice The guard limits as PriceGuard takes them.
    function _guardParams() internal view returns (GuardParams memory) {
        return GuardParams({
            stockFeedMaxAge: _stockFeedMaxAge,
            usdgFeedMaxAge: _usdgFeedMaxAge,
            depegToleranceBps: _depegToleranceBps,
            multiplierWindow: _multiplierWindow
        });
    }

    // Private

    /// @dev The immutables the libraries need, which a delegatecalled library cannot read itself.
    function _env() private view returns (SleeveState.Env memory) {
        return SleeveState.Env({
            usdg: usdg,
            tokenSource: tokenSource,
            calendar: calendar,
            swapRouter: swapRouter,
            usdgUsdFeed: usdgUsdFeed,
            disclosureHash: disclosureHash,
            grace: grace,
            params: _guardParams()
        });
    }

    /// @dev Books a closed bracket's owner delta and emits OwnerOpEnded.
    function _bookOwnerOp(address account, SleeveState.Account storage acct, uint256 balanceAtBegin, int256 moduleDelta)
        private
    {
        int256 ownerDelta = usdg.balanceOf(account).toInt256() - balanceAtBegin.toInt256() - moduleDelta;
        uint256 fromSpend;
        uint256 fromUnsorted;
        uint256[] memory fromBuckets;
        if (ownerDelta >= 0) {
            acct.spend = LedgerMath.creditSpend(acct.spend, ownerDelta.toUint256()).toUint128();
        } else {
            (fromSpend, fromUnsorted, fromBuckets) = _bookOwnerOutflow(
                account, acct, (-ownerDelta).toUint256(), SleeveState.virtualBalance(balanceAtBegin, moduleDelta)
            );
        }
        emit OwnerOpEnded(account, balanceAtBegin, moduleDelta, ownerDelta, fromSpend, fromUnsorted, fromBuckets);
    }

    /// @dev LedgerMath.allocateOutflow over spend, unsorted at the virtual balance, then the buckets. The buckets are
    /// read only when spend and unsorted do not cover the outflow, which keeps the usual owner batch to two slots.
    function _bookOwnerOutflow(
        address account,
        SleeveState.Account storage acct,
        uint256 outflow,
        uint256 virtualBalance
    ) private returns (uint256 fromSpend, uint256 fromUnsorted, uint256[] memory fromBuckets) {
        uint256 spend = acct.spend;
        uint256 unsortedUsdg = LedgerMath.unsorted(virtualBalance, spend, acct.pendingTotal);
        if (outflow <= spend + unsortedUsdg) {
            (fromSpend, fromUnsorted, fromBuckets) =
                LedgerMath.allocateOutflow(outflow, spend, unsortedUsdg, new uint256[](0));
        } else {
            (fromSpend, fromUnsorted, fromBuckets) = LedgerMath.allocateOutflow(
                outflow, spend, unsortedUsdg, SleeveState.pendingByTicker(_store, tokenSource, account)
            );
            acct.pendingTotal -= SleeveState.takeFromBuckets(_store, account, fromBuckets).toUint128();
        }
        acct.spend = (spend - fromSpend).toUint128();
    }

    /// @dev Releases every non-empty bucket in ascending ticker id. Bounded by TokenSource's ticker count, which
    /// never grows after deploy, and stops once pendingTotal reaches zero.
    function _releaseBuckets(address account, SleeveState.Account storage acct, Trigger trigger)
        private
        returns (uint256 released)
    {
        uint256 count = tokenSource.tickerCount();
        for (uint256 i; i < count && acct.pendingTotal != 0; ++i) {
            uint8 tickerId = i.toUint8();
            if (_store.buckets[account][tickerId].amount == 0) continue;
            (uint256 amount,) = _releaseBucket(account, tickerId, trigger);
            released += amount;
        }
    }

    /// @dev Writes the account's next rule version, which keeps counting across uninstall and reinstall (D-019).
    function _writeRule(address account, SleeveState.Account storage acct, RuleInput memory input)
        private
        returns (uint32 version)
    {
        _validateRule(input);
        version = _store.ruleVersions[account] + 1;
        _store.ruleVersions[account] = version;
        Rule memory rule = Rule({
            version: version,
            status: RuleStatus.ACTIVE,
            equityBps: input.equityBps,
            tickerId: input.tickerId,
            premiumCapBps: input.premiumCapBps,
            slippageBps: input.slippageBps,
            minClip: input.minClip
        });
        acct.rule = rule;
        emit RuleSet(account, version, rule);
    }

    function _validateRule(RuleInput memory input) private view {
        LedgerMath.validateShares(input.spendBps, input.equityBps);
        uint8 tickerId = input.tickerId;
        if (tickerId >= tokenSource.tickerCount()) revert TickerNotListed(tickerId);
        (, address feed, SessionCalendar.SessionType sessionType, bool active) = tokenSource.ticker(tickerId);
        if (!active) revert TickerNotActive(tickerId);
        if (feed == address(0)) revert TickerHasNoFeed(tickerId);
        if (sessionType == SessionCalendar.SessionType.NONE) revert TickerHasNoSession(tickerId);
        if (input.premiumCapBps > MAX_PREMIUM_CAP_BPS) {
            revert PremiumCapAboveMax(input.premiumCapBps, MAX_PREMIUM_CAP_BPS);
        }
        if (input.slippageBps > MAX_SLIPPAGE_BPS) revert SlippageAboveMax(input.slippageBps, MAX_SLIPPAGE_BPS);
        if (input.minClip < MIN_CLIP_FLOOR) revert MinClipBelowFloor(input.minClip, MIN_CLIP_FLOOR);
    }

    function _decodeInstallData(bytes calldata data)
        private
        pure
        returns (address keeper, RuleInput memory input, bool hasRule)
    {
        if (data.length == 0) return (keeper, input, false);
        if (data.length != INSTALL_DATA_LENGTH) revert InvalidInstallData(data.length);
        (keeper, input) = abi.decode(data, (address, RuleInput));
        hasRule = input.spendBps != 0 || input.equityBps != 0 || input.tickerId != 0 || input.premiumCapBps != 0
            || input.slippageBps != 0 || input.minClip != 0;
    }

    /// @dev An install inside an open bracket restarts it from the install snapshot, so the bracket books only what
    /// moves after the install.
    function _restartOpenOwnerOp(address account, uint256 balance) private {
        TransientSlot.Uint256Slot beginSlot = SleeveState.beginSlot(account);
        if (beginSlot.tload() == 0) return;
        beginSlot.tstore(balance + 1);
        SleeveState.deltaSlot(account).tstore(0);
    }

    function _installedAccount(address account) private view returns (SleeveState.Account storage acct) {
        acct = _store.accounts[account];
        if (!acct.installed) revert NotInstalled(account);
    }

    function _requireCode(address target) private view {
        if (target.code.length == 0) revert NotContract(target);
    }

    function _requireDecimals(address source, uint8 decimals, uint8 expected) private pure {
        if (decimals != expected) revert UnexpectedDecimals(source, decimals, expected);
    }
}
