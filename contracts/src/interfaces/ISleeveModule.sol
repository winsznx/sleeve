// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

import {IERC20} from "@openzeppelin/contracts/token/ERC20/IERC20.sol";
import {IERC7579Module} from "@openzeppelin/contracts/interfaces/draft-IERC7579.sol";
import {SessionCalendarExtension} from "../SessionCalendarExtension.sol";
import {TokenSource} from "../TokenSource.sol";
import {AccountingMode, GuardParams, Reason, Status, Trigger} from "../types/SleeveTypes.sol";
import {IAggregatorV3} from "./IAggregatorV3.sol";
import {ISwapRouter02} from "./ISwapRouter02.sol";

/// @title ISleeveModule
/// @notice The SleeveModule ABI that the keeper, the verifier and the app build against: install and uninstall, the
/// owner's rule and keeper, the owner-batch brackets, receipts and the views. docs/SPEC.md sections 5 to 8, 13 and 15.
/// @dev Every owner function acts on the caller's own state: the module keys each ledger, rule and bracket by
/// msg.sender (D-015). A caller that never installed the module gets NotInstalled.
interface ISleeveModule is IERC7579Module {
    /// @notice A rule's state. NONE: no rule since install. ACTIVE: splits and settles run. PAUSED: they do not, and
    /// new USDG stays unsorted and spendable until the rule resumes (B2-6).
    enum RuleStatus {
        NONE,
        ACTIVE,
        PAUSED
    }

    /// @notice Constructor settings.
    /// @param usdg USDG. Must report 6 decimals.
    /// @param tokenSource The ticker list. Its usdg() must be the same USDG.
    /// @param calendar The session calendar extension receipts take their calendar version from.
    /// @param swapRouter Uniswap SwapRouter02, the buy and sell venue of components 5 and 6.
    /// @param usdgUsdFeed The USDG/USD feed proxy. Must report 8 decimals.
    /// @param defaultKeeper The keeper an install without a keeper gets (B2-7).
    /// @param disclosureHash keccak256 of the issuer disclosure the app shows (B2-10).
    /// @param guardParams The guard limits, PriceGuard.defaultGuardParams() at launch (D-014).
    /// @param grace Seconds a public trigger waits, 3,600 at launch (D-009 Q15).
    struct ModuleConfig {
        IERC20 usdg;
        TokenSource tokenSource;
        SessionCalendarExtension calendar;
        ISwapRouter02 swapRouter;
        IAggregatorV3 usdgUsdFeed;
        address defaultKeeper;
        bytes32 disclosureHash;
        GuardParams guardParams;
        uint256 grace;
    }

    /// @notice A rule as the owner sets it. One leg in M0.
    /// @param spendBps The spend share. spendBps + equityBps must be 10,000 (I9).
    /// @param equityBps The equity share.
    /// @param tickerId The TokenSource ticker the equity share buys: listed, active, with a feed and a session.
    /// @param premiumCapBps The most a buy may pay above the feed price, 0 to 500 (B2-5). The app suggests 100.
    /// @param slippageBps The most a swap may fall short of the trigger's quote, 0 to 500. The app suggests 50.
    /// @param minClip The smallest equity part that buys, in USDG base units, at least 1 USDG. The app suggests 25.
    struct RuleInput {
        uint16 spendBps;
        uint16 equityBps;
        uint8 tickerId;
        uint16 premiumCapBps;
        uint16 slippageBps;
        uint128 minClip;
    }

    /// @notice A rule as the module stores it. SPEC section 5. The spend share is 10,000 - equityBps.
    /// @param version 1 for the first rule after an install, then one more for each setRule.
    /// @param status NONE, ACTIVE or PAUSED.
    /// @param equityBps As RuleInput.
    /// @param tickerId As RuleInput.
    /// @param premiumCapBps As RuleInput.
    /// @param slippageBps As RuleInput.
    /// @param minClip As RuleInput.
    struct Rule {
        uint32 version;
        RuleStatus status;
        uint16 equityBps;
        uint8 tickerId;
        uint16 premiumCapBps;
        uint16 slippageBps;
        uint128 minClip;
    }

    /// @notice Pending equity for one ticker: USDG that waits in the account for the guard to clear. SPEC section 5.
    /// @param amount USDG base units waiting.
    /// @param since When the bucket last went from empty to non-empty.
    /// @param reason The reason of the latest QUEUED receipt for the bucket.
    struct Bucket {
        uint128 amount;
        uint64 since;
        Reason reason;
    }

    /// @notice One onchain record, written in the same transaction as the action. SPEC section 13. The verifier and
    /// the app hash abi.encode(receipt), so the field order never changes; fields are only appended, and only in a
    /// new module version. Fields an action does not use stay zero.
    /// @param id Global sequential id, from 1 (D-009 Q25).
    /// @param account The account the receipt is about.
    /// @param ruleVersion The account's rule version when the receipt was written, zero without a rule.
    /// @param trigger Who started the action (SPEC section 8).
    /// @param payer The pay link payer. Zero in M0.
    /// @param status What the receipt records.
    /// @param reason QUEUED: why the equity part waits. SETTLED and RELEASED: the bucket's reason. Otherwise NONE.
    /// @param mode How owner money is told from income. WRAPPED in M0.
    /// @param tickerId The ticker the receipt is about.
    /// @param token That ticker's stock token.
    /// @param tokenUid The token's uid() when the action read it, zero when no token call ran.
    /// @param usdgIn Unsorted USDG a split sorted.
    /// @param usdgToSpend USDG credited to spend: a split's spend part, refused equity or a released bucket.
    /// @param usdgToEquity A split's equity part.
    /// @param usdgSpent USDG that left the account in a buy, measured by balance.
    /// @param usdgQueued USDG added to the ticker's bucket.
    /// @param tokensIn Tokens that left the account in a sell, measured by balance.
    /// @param tokensOut Tokens that arrived in a buy, measured by balance.
    /// @param usdgOut USDG that arrived from a sell, measured by balance.
    /// @param uiMultiplier The token's uiMultiplier() at the fill.
    /// @param execPrice USDG base units per 1e18 token units, rounded against the owner (D-009 Q11).
    /// @param premiumBps A buy's premium, or a sell's discount, against the feed price in signed basis points.
    /// @param roundId The stock feed round the guard read.
    /// @param answer That round's answer.
    /// @param updatedAt That round's updatedAt.
    /// @param usdgRoundId The USDG/USD round the guard read.
    /// @param usdgAnswer That round's answer.
    /// @param quote The trigger's quote (D-009 Q21).
    /// @param minOut The swap's minimum output.
    /// @param venueId 1 for Uniswap v3 through SwapRouter02, zero when no swap ran.
    /// @param pool The pool the swap used.
    /// @param calendarVersion The calendar extension's version() when the receipt was written.
    /// @param disclosureHash The disclosure hash the module was deployed with.
    /// @param l2Block ArbSys arbBlockNumber() when the receipt was written.
    /// @param timestamp block.timestamp when the receipt was written.
    /// @param lotId The lot the receipt creates or changes, zero when none.
    /// @param queuedSince SETTLED and RELEASED: the bucket's since.
    /// @param overrideClosed Whether a sell used the off-hours override.
    /// @param overrideCapBps The discount cap a sell widened to, zero when not widened.
    struct Receipt {
        uint256 id;
        address account;
        uint32 ruleVersion;
        Trigger trigger;
        address payer;
        Status status;
        Reason reason;
        AccountingMode mode;
        uint8 tickerId;
        address token;
        bytes32 tokenUid;
        uint256 usdgIn;
        uint256 usdgToSpend;
        uint256 usdgToEquity;
        uint256 usdgSpent;
        uint256 usdgQueued;
        uint256 tokensIn;
        uint256 tokensOut;
        uint256 usdgOut;
        uint256 uiMultiplier;
        uint256 execPrice;
        int256 premiumBps;
        uint80 roundId;
        int256 answer;
        uint256 updatedAt;
        uint80 usdgRoundId;
        int256 usdgAnswer;
        uint256 quote;
        uint256 minOut;
        uint8 venueId;
        address pool;
        uint32 calendarVersion;
        bytes32 disclosureHash;
        uint256 l2Block;
        uint256 timestamp;
        uint256 lotId;
        uint64 queuedSince;
        bool overrideClosed;
        uint16 overrideCapBps;
    }

    /// @notice The module was installed on an account. USDG already there became spend (I5).
    /// @param account The account.
    /// @param keeper The account's keeper.
    /// @param spend The install snapshot: the account's whole USDG balance.
    event Installed(address indexed account, address indexed keeper, uint256 spend);

    /// @notice The module was uninstalled from an account. Its buckets went to spend with RELEASED receipts first.
    /// @param account The account.
    /// @param released USDG the buckets held.
    event Uninstalled(address indexed account, uint256 released);

    /// @notice An account set a rule, at install or through setRule. The rule is ACTIVE.
    /// @param account The account.
    /// @param version The rule's version.
    /// @param rule The stored rule.
    event RuleSet(address indexed account, uint32 indexed version, Rule rule);

    /// @notice An account paused its rule.
    /// @param account The account.
    /// @param version The paused rule's version.
    event RulePaused(address indexed account, uint32 indexed version);

    /// @notice An account resumed its paused rule.
    /// @param account The account.
    /// @param version The resumed rule's version.
    event RuleResumed(address indexed account, uint32 indexed version);

    /// @notice An account changed its keeper.
    /// @param account The account.
    /// @param keeper The new keeper, zero for none.
    event KeeperSet(address indexed account, address indexed keeper);

    /// @notice An owner batch closed its bracket and the ledgers took its USDG change (SPEC section 7). The balance
    /// at end is balanceAtBegin + moduleDelta + ownerDelta. A non-negative ownerDelta went to spend in full (I6). A
    /// negative one left spend first, then unsorted, then the buckets in ascending ticker id.
    /// @param account The account.
    /// @param balanceAtBegin The account's USDG balance at beginOwnerOp.
    /// @param moduleDelta The net USDG the module's own actions moved inside the bracket.
    /// @param ownerDelta The rest of the balance change: what the owner's calls moved.
    /// @param fromSpend USDG of an outflow taken off spend.
    /// @param fromUnsorted USDG of an outflow that came out of unsorted, which needs no ledger change.
    /// @param fromBuckets USDG of an outflow taken off each bucket, indexed by ticker id. Empty when no bucket was
    /// touched.
    event OwnerOpEnded(
        address indexed account,
        uint256 balanceAtBegin,
        int256 moduleDelta,
        int256 ownerDelta,
        uint256 fromSpend,
        uint256 fromUnsorted,
        uint256[] fromBuckets
    );

    /// @notice A receipt was written. receiptHash(id) holds keccak256(abi.encode(receipt)).
    /// @param id The receipt id.
    /// @param account The account.
    /// @param status The receipt's status.
    /// @param receipt Every field.
    event ReceiptWritten(uint256 indexed id, address indexed account, Status indexed status, Receipt receipt);

    /// @notice A constructor address has no code.
    /// @param target The address given.
    error NotContract(address target);

    /// @notice USDG reports decimals other than 6, or the USDG/USD feed other than 8.
    /// @param source The token or feed.
    /// @param decimals What it reported.
    /// @param expected What the module requires.
    error UnexpectedDecimals(address source, uint8 decimals, uint8 expected);

    /// @notice The TokenSource given lists pools against another USDG.
    /// @param tokenSourceUsdg TokenSource's usdg().
    /// @param usdg The USDG given to the module.
    error TokenSourceUsdgMismatch(address tokenSourceUsdg, address usdg);

    /// @notice The default keeper is zero.
    error ZeroDefaultKeeper();

    /// @notice The disclosure hash is zero.
    error ZeroDisclosureHash();

    /// @notice The grace period is zero.
    error ZeroGrace();

    /// @notice A guard limit is zero, or the depeg tolerance is above 10,000 bps.
    error InvalidGuardParams();

    /// @notice The caller has not installed the module.
    /// @param caller The caller.
    error NotInstalled(address caller);

    /// @notice onInstall data is neither empty nor abi.encode(address, RuleInput).
    /// @param length The data's length in bytes.
    error InvalidInstallData(uint256 length);

    /// @notice LedgerMath.validateShares: the rule's shares do not sum to 10,000 (I9). Declared here so the ABI
    /// decodes it.
    /// @param spendBps The spend share given.
    /// @param equityBps The equity share given.
    error SharesSumNotTotal(uint16 spendBps, uint16 equityBps);

    /// @notice TokenSource has no ticker with this id.
    /// @param tickerId The id given.
    error TickerNotListed(uint8 tickerId);

    /// @notice The ticker was removed from TokenSource.
    /// @param tickerId The id given.
    error TickerNotActive(uint8 tickerId);

    /// @notice The ticker has no Chainlink feed, so it cannot be a rule target (PRD 7.3).
    /// @param tickerId The id given.
    error TickerHasNoFeed(uint8 tickerId);

    /// @notice The ticker's session type is NONE.
    /// @param tickerId The id given.
    error TickerHasNoSession(uint8 tickerId);

    /// @notice The premium cap is above MAX_PREMIUM_CAP_BPS.
    /// @param premiumCapBps The cap given.
    /// @param maxBps The largest cap allowed.
    error PremiumCapAboveMax(uint16 premiumCapBps, uint16 maxBps);

    /// @notice The slippage cap is above MAX_SLIPPAGE_BPS.
    /// @param slippageBps The cap given.
    /// @param maxBps The largest cap allowed.
    error SlippageAboveMax(uint16 slippageBps, uint16 maxBps);

    /// @notice The minimum clip is below MIN_CLIP_FLOOR.
    /// @param minClip The clip given.
    /// @param floor The smallest clip allowed.
    error MinClipBelowFloor(uint128 minClip, uint128 floor);

    /// @notice The account has no rule.
    /// @param account The account.
    error NoRule(address account);

    /// @notice The account's rule is not ACTIVE.
    /// @param account The account.
    error RuleNotActive(address account);

    /// @notice The account's rule is not PAUSED.
    /// @param account The account.
    error RuleNotPaused(address account);

    /// @notice beginOwnerOp found the account's bracket already open in this transaction.
    /// @param account The account.
    error OwnerOpAlreadyOpen(address account);

    /// @notice endOwnerOp found no open bracket for the account in this transaction.
    /// @param account The account.
    error OwnerOpNotOpen(address account);

    /// @notice Installs the module on the calling account, overwriting any state a failed onUninstall left behind
    /// (D-009 Q20). The spend ledger becomes the account's whole USDG balance and nothing is unsorted (I5). Buckets
    /// left over from an earlier install go to spend with RELEASED receipts first.
    /// @dev Caller: the account, through ERC-7579 installModule. If the account has an open owner bracket, the
    /// bracket restarts from the install snapshot.
    /// @param data Empty, or abi.encode(address keeper, RuleInput rule). A zero keeper means defaultKeeper. An
    /// all-zero rule means no rule; any other rule must pass the setRule checks or the install reverts.
    function onInstall(bytes calldata data) external;

    /// @notice Uninstalls the module from the calling account. Each non-empty bucket goes to spend with a RELEASED
    /// receipt, trigger OWNER; then the account's ledgers, rule, keeper and observation are deleted. Receipts stay.
    /// @dev Caller: an account that installed the module, through ERC-7579 uninstallModule. Never reverts for an
    /// installed account. Kernel v3.1 ignores the result, so the app checks ModuleUninstallResult. An open owner
    /// bracket stays open; endOwnerOp closes it without booking.
    /// @param data Ignored.
    function onUninstall(bytes calldata data) external;

    /// @notice True for module type 2, executor, only.
    /// @param moduleTypeId The ERC-7579 module type.
    function isModuleType(uint256 moduleTypeId) external view returns (bool);

    /// @notice Whether an account has the module installed.
    /// @param account The account.
    function isInitialized(address account) external view returns (bool);

    /// @notice Sets the calling account's rule: version + 1, ACTIVE, at once. USDG already sorted is never re-sorted.
    /// @dev Caller: an installed account. Checks, in order: LedgerMath.validateShares (I9), the ticker is listed,
    /// active, has a feed and a session, the premium and slippage caps are at most 500 bps, and the minimum clip is
    /// at least 1 USDG.
    /// @param input The rule.
    /// @return version The new rule version.
    function setRule(RuleInput calldata input) external returns (uint32 version);

    /// @notice Pauses the calling account's ACTIVE rule. New USDG stays unsorted until resume.
    /// @dev Caller: an installed account. Reverts NoRule without a rule and RuleNotActive when already paused.
    function pauseRule() external;

    /// @notice Resumes the calling account's PAUSED rule with the same version.
    /// @dev Caller: an installed account. Reverts NoRule without a rule and RuleNotPaused when already active.
    function resumeRule() external;

    /// @notice Sets the calling account's keeper. Zero leaves only the owner and public triggers.
    /// @dev Caller: an installed account.
    /// @param keeper The new keeper.
    function setKeeper(address keeper) external;

    /// @notice Opens the calling account's owner bracket for the rest of the transaction: stores its USDG balance
    /// and a zero module delta in transient storage. The app puts it first in every owner batch (I14).
    /// @dev Caller: an installed account. Reverts NotInstalled, or OwnerOpAlreadyOpen when a bracket is open, as
    /// when an earlier UserOp of the bundle left one open.
    function beginOwnerOp() external;

    /// @notice Closes the calling account's owner bracket and books the owner's USDG change: ownerDelta =
    /// balanceNow - balanceAtBegin - moduleDelta. A positive change credits spend in full (I6). A negative one comes
    /// off spend, then unsorted computed from the virtual balance balanceAtBegin + moduleDelta, then the buckets in
    /// ascending ticker id. Emits OwnerOpEnded. The app puts it last in every owner batch (I14).
    /// @dev Caller: the account that opened the bracket. Reverts OwnerOpNotOpen without a bracket, NotInstalled for
    /// a caller without the module and without a bracket. An account that uninstalled inside the bracket gets the
    /// bracket cleared and nothing booked.
    function endOwnerOp() external;

    /// @notice An account's USDG balance and ledgers. Unsorted uses the virtual balance while the account's bracket
    /// is open in the current transaction; offchain reads never see an open bracket.
    /// @param account The account.
    /// @return balance The account's USDG balance.
    /// @return spend The spend ledger.
    /// @return pendingTotal The sum of the buckets.
    /// @return unsorted USDG no ledger accounts for yet. Zero, with spend and pendingTotal, without the module.
    function ledger(address account)
        external
        view
        returns (uint256 balance, uint256 spend, uint256 pendingTotal, uint256 unsorted);

    /// @notice An account's rule.
    /// @param account The account.
    function ruleOf(address account) external view returns (Rule memory);

    /// @notice An account's keeper, zero for none.
    /// @param account The account.
    function keeperOf(address account) external view returns (address);

    /// @notice An account's bucket for a ticker.
    /// @param account The account.
    /// @param tickerId The ticker id.
    function bucketOf(address account, uint8 tickerId) external view returns (Bucket memory);

    /// @notice Whether the account's owner bracket is open in the current transaction.
    /// @param account The account.
    function ownerOpOpen(address account) external view returns (bool);

    /// @notice keccak256(abi.encode(receipt)) of a written receipt, zero for an id not written yet.
    /// @param id The receipt id.
    function receiptHash(uint256 id) external view returns (bytes32);

    /// @notice The id the next receipt will get. Ids start at 1.
    function nextReceiptId() external view returns (uint256);

    /// @notice The guard limits PriceGuard applies.
    function guardParams() external view returns (GuardParams memory);

    /// @notice USDG.
    function usdg() external view returns (IERC20);

    /// @notice The ticker list.
    function tokenSource() external view returns (TokenSource);

    /// @notice The session calendar.
    function calendar() external view returns (SessionCalendarExtension);

    /// @notice The swap venue.
    function swapRouter() external view returns (ISwapRouter02);

    /// @notice The USDG/USD feed proxy.
    function usdgUsdFeed() external view returns (IAggregatorV3);

    /// @notice The keeper an install without a keeper gets.
    function defaultKeeper() external view returns (address);

    /// @notice The issuer disclosure hash every receipt carries.
    function disclosureHash() external view returns (bytes32);

    /// @notice Seconds a public trigger waits.
    function grace() external view returns (uint256);

    /// @notice The largest premium cap a rule may set, in basis points.
    function MAX_PREMIUM_CAP_BPS() external view returns (uint16);

    /// @notice The largest slippage cap a rule may set, in basis points.
    function MAX_SLIPPAGE_BPS() external view returns (uint16);

    /// @notice The smallest minimum clip a rule may set, in USDG base units.
    function MIN_CLIP_FLOOR() external view returns (uint128);
}
