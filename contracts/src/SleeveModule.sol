// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC20Metadata} from "@openzeppelin/contracts/token/ERC20/extensions/IERC20Metadata.sol";
import {MODULE_TYPE_EXECUTOR} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {ReentrancyGuardTransient} from "@openzeppelin/contracts/utils/ReentrancyGuardTransient.sol";
import {SlotDerivation} from "@openzeppelin/contracts/utils/SlotDerivation.sol";
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
import {SleeveReceipts} from "./libraries/SleeveReceipts.sol";
import {GuardParams, Status, Trigger} from "./types/SleeveTypes.sol";

/// @title SleeveModule
/// @notice The Sleeve ERC-7579 executor, module type 2: per-account ledgers, the owner's rule and keeper, the
/// owner-batch brackets and the receipt log. USDG that arrives without the account doing anything is unsorted and is
/// the only USDG a split sorts; USDG present at install and USDG an owner batch moves inside its bracket go to the
/// spend ledger (I5, I6). Not upgradeable: a new version is a new install. It holds no funds, ever (I1).
/// @dev Component 4 of the build contract. Split, settle and release (component 5) and sell-back (component 6) add
/// entry points on top of the storage and the internal hooks here: _recordModuleDelta and _sortingBalance for actions
/// inside an open bracket (D-009 Q13), _releaseBucket for releases, and _writeReceipt, which writes through
/// SleeveReceipts so a library that later takes over part of the code shares the same receipt log. Every owner
/// function keys its state by msg.sender (D-015). Every bucket write keeps pendingTotal equal to the sum of the
/// account's buckets, and an emptied bucket is deleted.
contract SleeveModule is ISleeveModule, ReentrancyGuardTransient {
    using SafeCast for uint256;
    using SafeCast for int256;
    using SlotDerivation for bytes32;
    using TransientSlot for bytes32;
    using TransientSlot for TransientSlot.Uint256Slot;
    using TransientSlot for TransientSlot.Int256Slot;

    /// @dev SPEC section 5. Field order as specified.
    struct Account {
        bool installed;
        uint128 spend;
        uint128 pendingTotal;
        address keeper;
        uint64 observedAt;
        uint128 observedUnsorted;
        Rule rule;
    }

    /// @inheritdoc ISleeveModule
    uint16 public constant MAX_PREMIUM_CAP_BPS = 500;

    /// @inheritdoc ISleeveModule
    uint16 public constant MAX_SLIPPAGE_BPS = 500;

    /// @inheritdoc ISleeveModule
    uint128 public constant MIN_CLIP_FLOOR = 1e6;

    uint8 internal constant USDG_DECIMALS = 6;

    /// @dev abi.encode(address, RuleInput): seven words.
    uint256 private constant INSTALL_DATA_LENGTH = 224;

    /// @dev Per-account transient slots: deriveMapping(base, account) holds the USDG balance at beginOwnerOp plus one,
    /// so zero means no bracket is open; the next slot holds the module delta. endOwnerOp zeroes both, and the delta
    /// is only written while the bracket is open.
    bytes32 private constant OWNER_OP_BASE = keccak256("sleeve.module.ownerOp");

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

    mapping(address account => Account) internal _accounts;

    mapping(address account => mapping(uint8 tickerId => Bucket)) internal _buckets;

    SleeveReceipts.Log internal _receipts;

    /// @param config Addresses, limits and constants, checked here: code at every contract address, USDG at 6
    /// decimals, the USDG/USD feed at 8, TokenSource on the same USDG, a non-zero keeper, disclosure hash and grace,
    /// and non-zero guard limits with a depeg tolerance of at most 10,000 bps.
    constructor(ModuleConfig memory config) {
        _requireCode(address(config.usdg));
        _requireCode(address(config.tokenSource));
        _requireCode(address(config.calendar));
        _requireCode(address(config.swapRouter));
        _requireCode(address(config.usdgUsdFeed));
        _requireDecimals(address(config.usdg), IERC20Metadata(address(config.usdg)).decimals(), USDG_DECIMALS);
        _requireDecimals(address(config.usdgUsdFeed), config.usdgUsdFeed.decimals(), PriceGuard.FEED_DECIMALS);
        address sourceUsdg = config.tokenSource.usdg();
        if (sourceUsdg != address(config.usdg)) revert TokenSourceUsdgMismatch(sourceUsdg, address(config.usdg));
        if (config.defaultKeeper == address(0)) revert ZeroDefaultKeeper();
        if (config.disclosureHash == bytes32(0)) revert ZeroDisclosureHash();
        if (config.grace == 0) revert ZeroGrace();
        GuardParams memory params = config.guardParams;
        if (
            params.stockFeedMaxAge == 0 || params.usdgFeedMaxAge == 0 || params.multiplierWindow == 0
                || params.depegToleranceBps > PriceGuard.BPS
        ) revert InvalidGuardParams();

        usdg = config.usdg;
        tokenSource = config.tokenSource;
        calendar = config.calendar;
        swapRouter = config.swapRouter;
        usdgUsdFeed = config.usdgUsdFeed;
        defaultKeeper = config.defaultKeeper;
        disclosureHash = config.disclosureHash;
        grace = config.grace;
        _stockFeedMaxAge = params.stockFeedMaxAge;
        _usdgFeedMaxAge = params.usdgFeedMaxAge;
        _depegToleranceBps = params.depegToleranceBps;
        _multiplierWindow = params.multiplierWindow;
    }

    // Install and uninstall

    /// @inheritdoc ISleeveModule
    function onInstall(bytes calldata data) external nonReentrant {
        address account = msg.sender;
        (address keeper, RuleInput memory input, bool hasRule) = _decodeInstallData(data);
        Account storage acct = _accounts[account];
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
        Account storage acct = _installedAccount(account);
        uint256 released;
        if (acct.pendingTotal != 0) released = _releaseBuckets(account, acct, Trigger.OWNER);
        delete _accounts[account];
        emit Uninstalled(account, released);
    }

    /// @inheritdoc ISleeveModule
    function isModuleType(uint256 moduleTypeId) external pure returns (bool) {
        return moduleTypeId == MODULE_TYPE_EXECUTOR;
    }

    /// @inheritdoc ISleeveModule
    function isInitialized(address account) external view returns (bool) {
        return _accounts[account].installed;
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
        TransientSlot.Uint256Slot beginSlot = _beginSlot(account);
        if (beginSlot.tload() != 0) revert OwnerOpAlreadyOpen(account);
        beginSlot.tstore(usdg.balanceOf(account) + 1);
    }

    /// @inheritdoc ISleeveModule
    function endOwnerOp() external nonReentrant {
        address account = msg.sender;
        Account storage acct = _accounts[account];
        TransientSlot.Uint256Slot beginSlot = _beginSlot(account);
        uint256 begun = beginSlot.tload();
        if (begun == 0) {
            if (!acct.installed) revert NotInstalled(account);
            revert OwnerOpNotOpen(account);
        }
        TransientSlot.Int256Slot deltaSlot = _deltaSlot(account);
        int256 moduleDelta = deltaSlot.tload();
        beginSlot.tstore(0);
        deltaSlot.tstore(0);
        if (!acct.installed) return;
        _bookOwnerOp(account, acct, begun - 1, moduleDelta);
    }

    // Views

    /// @inheritdoc ISleeveModule
    function ledger(address account)
        external
        view
        returns (uint256 balance, uint256 spend, uint256 pendingTotal, uint256 unsorted)
    {
        balance = usdg.balanceOf(account);
        Account storage acct = _accounts[account];
        if (!acct.installed) return (balance, 0, 0, 0);
        spend = acct.spend;
        pendingTotal = acct.pendingTotal;
        unsorted = LedgerMath.unsorted(_sortingBalance(account), spend, pendingTotal);
    }

    /// @inheritdoc ISleeveModule
    function ruleOf(address account) external view returns (Rule memory) {
        return _accounts[account].rule;
    }

    /// @inheritdoc ISleeveModule
    function keeperOf(address account) external view returns (address) {
        return _accounts[account].keeper;
    }

    /// @inheritdoc ISleeveModule
    function bucketOf(address account, uint8 tickerId) external view returns (Bucket memory) {
        return _buckets[account][tickerId];
    }

    /// @inheritdoc ISleeveModule
    function ownerOpOpen(address account) external view returns (bool) {
        return _beginSlot(account).tload() != 0;
    }

    /// @inheritdoc ISleeveModule
    function receiptHash(uint256 id) external view returns (bytes32) {
        return _receipts.hashes[id];
    }

    /// @inheritdoc ISleeveModule
    function nextReceiptId() external view returns (uint256) {
        return _receipts.count + 1;
    }

    /// @inheritdoc ISleeveModule
    function guardParams() external view returns (GuardParams memory) {
        return _guardParams();
    }

    // Hooks for module actions (components 5 and 6)

    /// @notice Adds a module action's net USDG change for the account to its open bracket, so endOwnerOp does not
    /// book it as the owner's (D-009 Q13). Does nothing when no bracket is open.
    /// @param account The account whose USDG the action moved.
    /// @param delta USDG that arrived, positive, or left, negative, measured by balance.
    function _recordModuleDelta(address account, int256 delta) internal {
        if (_beginSlot(account).tload() == 0) return;
        TransientSlot.Int256Slot deltaSlot = _deltaSlot(account);
        deltaSlot.tstore(deltaSlot.tload() + delta);
    }

    /// @notice The balance a split or settle computes unsorted from: inside an open bracket the virtual balance,
    /// balance at begin plus the module delta, so the owner's moves in the same batch never look like income or an
    /// outside pull; otherwise the USDG balance.
    /// @param account The account.
    /// @return The balance, zero when the virtual balance is negative.
    function _sortingBalance(address account) internal view returns (uint256) {
        uint256 begun = _beginSlot(account).tload();
        if (begun == 0) return usdg.balanceOf(account);
        return _virtualBalance(begun - 1, _deltaSlot(account).tload());
    }

    /// @notice Writes a receipt through SleeveReceipts with the calendar version in force and the module's
    /// disclosure hash: the next global id, the module's fields, the stored hash and ReceiptWritten.
    /// @param account The account the receipt is about.
    /// @param receipt Every other field, set by the caller. Modified in place.
    /// @return id The receipt id.
    function _writeReceipt(address account, Receipt memory receipt) internal returns (uint256 id) {
        return SleeveReceipts.write(_receipts, account, receipt, calendar.version(), disclosureHash);
    }

    /// @notice Moves a whole non-empty bucket to spend and writes its RELEASED receipt: usdgToSpend is the amount,
    /// reason and queuedSince are the bucket's, token is the ticker's from TokenSource. No token or feed is read, so
    /// tokenUid and the market fields stay zero and the release cannot be blocked by the issuer's contracts (I11).
    /// @param account The account.
    /// @param tickerId The bucket's ticker id. The bucket must be non-empty.
    /// @param trigger Who released it.
    /// @return amount USDG released.
    function _releaseBucket(address account, uint8 tickerId, Trigger trigger) internal returns (uint256 amount) {
        Bucket memory bucket = _buckets[account][tickerId];
        amount = bucket.amount;
        delete _buckets[account][tickerId];
        Account storage acct = _accounts[account];
        acct.pendingTotal -= bucket.amount;
        acct.spend = LedgerMath.creditSpend(acct.spend, amount).toUint128();

        (address token,,,) = tokenSource.ticker(tickerId);
        Receipt memory receipt;
        receipt.ruleVersion = acct.rule.version;
        receipt.trigger = trigger;
        receipt.status = Status.RELEASED;
        receipt.reason = bucket.reason;
        receipt.tickerId = tickerId;
        receipt.token = token;
        receipt.usdgToSpend = amount;
        receipt.queuedSince = bucket.since;
        _writeReceipt(account, receipt);
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

    /// @dev Books a closed bracket's owner delta and emits OwnerOpEnded.
    function _bookOwnerOp(address account, Account storage acct, uint256 balanceAtBegin, int256 moduleDelta) private {
        int256 ownerDelta = usdg.balanceOf(account).toInt256() - balanceAtBegin.toInt256() - moduleDelta;
        uint256 fromSpend;
        uint256 fromUnsorted;
        uint256[] memory fromBuckets;
        if (ownerDelta >= 0) {
            acct.spend = LedgerMath.creditSpend(acct.spend, ownerDelta.toUint256()).toUint128();
        } else {
            (fromSpend, fromUnsorted, fromBuckets) = _bookOwnerOutflow(
                account, acct, (-ownerDelta).toUint256(), _virtualBalance(balanceAtBegin, moduleDelta)
            );
        }
        emit OwnerOpEnded(account, balanceAtBegin, moduleDelta, ownerDelta, fromSpend, fromUnsorted, fromBuckets);
    }

    /// @dev LedgerMath.allocateOutflow over spend, unsorted at the virtual balance, then the buckets. The buckets are
    /// read only when spend and unsorted do not cover the outflow, which keeps the usual owner batch to two slots.
    function _bookOwnerOutflow(address account, Account storage acct, uint256 outflow, uint256 virtualBalance)
        private
        returns (uint256 fromSpend, uint256 fromUnsorted, uint256[] memory fromBuckets)
    {
        uint256 spend = acct.spend;
        uint256 unsortedUsdg = LedgerMath.unsorted(virtualBalance, spend, acct.pendingTotal);
        if (outflow <= spend + unsortedUsdg) {
            (fromSpend, fromUnsorted, fromBuckets) =
                LedgerMath.allocateOutflow(outflow, spend, unsortedUsdg, new uint256[](0));
        } else {
            (fromSpend, fromUnsorted, fromBuckets) =
                LedgerMath.allocateOutflow(outflow, spend, unsortedUsdg, _pendingByTicker(account));
            _takeFromBuckets(account, acct, fromBuckets);
        }
        acct.spend = (spend - fromSpend).toUint128();
    }

    function _takeFromBuckets(address account, Account storage acct, uint256[] memory fromBuckets) private {
        uint256 taken;
        for (uint256 i; i < fromBuckets.length; ++i) {
            uint256 cut = fromBuckets[i];
            if (cut == 0) continue;
            Bucket storage bucket = _buckets[account][i.toUint8()];
            uint128 left = bucket.amount - cut.toUint128();
            if (left == 0) delete _buckets[account][i.toUint8()];
            else bucket.amount = left;
            taken += cut;
        }
        acct.pendingTotal -= taken.toUint128();
    }

    /// @dev Bucket amounts indexed by ticker id, for every ticker TokenSource ever listed.
    function _pendingByTicker(address account) private view returns (uint256[] memory pending) {
        uint256 count = tokenSource.tickerCount();
        pending = new uint256[](count);
        for (uint256 i; i < count; ++i) {
            pending[i] = _buckets[account][i.toUint8()].amount;
        }
    }

    /// @dev Releases every non-empty bucket in ascending ticker id. Bounded by TokenSource's ticker count, which
    /// never grows after deploy, and stops once pendingTotal reaches zero.
    function _releaseBuckets(address account, Account storage acct, Trigger trigger)
        private
        returns (uint256 released)
    {
        uint256 count = tokenSource.tickerCount();
        for (uint256 i; i < count && acct.pendingTotal != 0; ++i) {
            uint8 tickerId = i.toUint8();
            if (_buckets[account][tickerId].amount != 0) released += _releaseBucket(account, tickerId, trigger);
        }
    }

    function _writeRule(address account, Account storage acct, RuleInput memory input)
        private
        returns (uint32 version)
    {
        _validateRule(input);
        version = acct.rule.version + 1;
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
        TransientSlot.Uint256Slot beginSlot = _beginSlot(account);
        if (beginSlot.tload() == 0) return;
        beginSlot.tstore(balance + 1);
        _deltaSlot(account).tstore(0);
    }

    function _installedAccount(address account) private view returns (Account storage acct) {
        acct = _accounts[account];
        if (!acct.installed) revert NotInstalled(account);
    }

    function _virtualBalance(uint256 balanceAtBegin, int256 moduleDelta) private pure returns (uint256) {
        int256 virtualBalance = balanceAtBegin.toInt256() + moduleDelta;
        return virtualBalance > 0 ? virtualBalance.toUint256() : 0;
    }

    function _beginSlot(address account) private pure returns (TransientSlot.Uint256Slot) {
        return OWNER_OP_BASE.deriveMapping(account).asUint256();
    }

    function _deltaSlot(address account) private pure returns (TransientSlot.Int256Slot) {
        return OWNER_OP_BASE.deriveMapping(account).offset(1).asInt256();
    }

    function _requireCode(address target) private view {
        if (target.code.length == 0) revert NotContract(target);
    }

    function _requireDecimals(address source, uint8 decimals, uint8 expected) private pure {
        if (decimals != expected) revert UnexpectedDecimals(source, decimals, expected);
    }
}
