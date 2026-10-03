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
/// owner's rule and keeper, the owner-batch brackets, observe, split, settle and release, sell-back and the lot
/// reconcile, receipts, lots and the views. docs/SPEC.md sections 5 to 15.
/// @dev Every owner function acts on the caller's own state: the module keys each ledger, rule, bracket and lot by
/// msg.sender (D-015), so sell and reconcileLots reach only the caller's own lots. A caller that never installed the
/// module gets NotInstalled. split and settle take the account as an argument and name the trigger from the caller:
/// OWNER when it is the account, KEEPER when it is the account's keeper, PUBLIC otherwise.
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
    /// @param tokenSource The ticker list. Its usdg() must be the same USDG, and its timelock() the calendar's.
    /// @param calendar The session calendar extension: the guard's session step and every receipt's calendar version.
    /// Must answer version(). Its timelock() must be TokenSource's, a SleeveTimelock at its 48-hour floor.
    /// @param swapRouter Uniswap SwapRouter02, the buy and sell venue. Its factory() must be TokenSource's v3Factory().
    /// @param usdgUsdFeed The USDG/USD feed proxy. Must report 8 decimals.
    /// @param defaultKeeper The keeper an install without a keeper gets (B2-7).
    /// @param disclosureHash keccak256 of the issuer disclosure the app shows (B2-10).
    /// @param guardParams The guard limits. Must equal PriceGuard.defaultGuardParams() (D-014, D-019).
    /// @param grace Seconds a public trigger waits. Must be 3,600 (D-009 Q15, D-019).
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
    /// @param version One more than the account's previous rule version, across uninstall and reinstall (D-019), so
    /// (account, version) names one rule for good. Zero while the account has no rule.
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
    ///
    /// What each status fills. Split receipts (FILLED, QUEUED and the refusals a split writes) carry usdgIn, the
    /// unsorted USDG sorted, and satisfy I2: usdgIn == usdgToSpend + usdgSpent + usdgQueued. Settle receipts (SETTLED
    /// and the refusals a settle writes) carry usdgIn zero, usdgToEquity the bucket, and queuedSince. The swap fields
    /// (quote, minOut, venueId, pool) are set exactly when a swap ran: FILLED, SETTLED, PART_SOLD, SOLD and QUEUED with
    /// reason PREMIUM, whose swap was undone. A sell writes one PART_SOLD or SOLD per lot it took tokens from, in the
    /// order it took them: tokensIn is the lot's part, usdgOut and usdgToSpend its pro rata share of the proceeds (the
    /// last lot takes the rounding remainder, so the shares sum to the USDG received), lotId the lot, and execPrice,
    /// premiumBps (the discount), the rounds, quote, minOut, pool and the override fields are the whole sell's.
    /// RECONCILED from a split carries the shortfall as usdgIn, split into usdgSpent off spend and usdgQueued off the
    /// buckets; its tickerId, token and lotId are zero, and the Reconciled event lists each bucket's cut. RECONCILED
    /// from reconcileLots carries the tickerId, the token, the lot as lotId and the tokens trimmed off it as tokensIn,
    /// and no USDG; the LotsReconciled event gives the balance the lots came down to.
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
    /// @param tokenUid The token's uid() at a fill (FILLED, SETTLED) or a sale (PART_SOLD, SOLD), zero otherwise.
    /// @param usdgIn Unsorted USDG a split sorted. RECONCILED: the shortfall, USDG that left outside Sleeve.
    /// @param usdgToSpend USDG credited to spend: a split's spend part plus refused equity, a refused bucket, a
    /// released bucket, or a lot's share of a sell's proceeds.
    /// @param usdgToEquity A split's equity part, or the bucket a settle acted on.
    /// @param usdgSpent USDG that left the account in a buy, measured by balance. RECONCILED: the cut off spend.
    /// @param usdgQueued USDG added to the ticker's bucket. RECONCILED: the cut off the buckets.
    /// @param tokensIn Tokens of the lot that left the account in a sell, measured by balance, or the tokens a lot
    /// reconcile trimmed off the lot.
    /// @param tokensOut Tokens that arrived in a buy, measured by balance.
    /// @param usdgOut The lot's pro rata share of the USDG that arrived from a sell, measured by balance.
    /// @param uiMultiplier The token's uiMultiplier() at a fill or a sale, zero otherwise.
    /// @param execPrice USDG base units per 1e18 token units, rounded against the owner (D-009 Q11): up for a buy,
    /// down for a sell, whose price is the whole sell's.
    /// @param premiumBps A buy's premium above the feed price, or a sell's discount below it (PriceGuard.discountBps,
    /// the whole sell's), in signed basis points rounded against the owner. QUEUED with reason PREMIUM: the premium of
    /// the undone swap.
    /// @param roundId The stock feed round the guard read, zero when the guard stopped before reading it.
    /// @param answer That round's answer.
    /// @param updatedAt That round's updatedAt.
    /// @param usdgRoundId The USDG/USD round the guard read, zero when the guard stopped before reading it.
    /// @param usdgAnswer That round's answer.
    /// @param quote The trigger's quote in token base units per 1e6 USDG base units, a sell's in USDG base units per
    /// 1e18 token units (D-009 Q21).
    /// @param minOut The swap's minimum output: usdgToEquity * quote / 1e6 * (10,000 - slippageBps) / 10,000 for a
    /// buy, tokenAmount * quote / 1e18 * (10,000 - slippageBps) / 10,000 USDG for a sell.
    /// @param venueId 1 for Uniswap v3 through SwapRouter02, zero when no swap ran.
    /// @param pool The pool the swap used.
    /// @param calendarVersion The calendar extension's version() when the receipt was written.
    /// @param disclosureHash The disclosure hash the module was deployed with.
    /// @param l2Block ArbSys arbBlockNumber() when the receipt was written.
    /// @param timestamp block.timestamp when the receipt was written.
    /// @param lotId The lot the receipt creates or changes, zero when none. FILLED and SETTLED: their own id.
    /// PART_SOLD, SOLD and a lot reconcile's RECONCILED: the lot.
    /// @param queuedSince SETTLED, RELEASED and a settle's refusal: the bucket's since.
    /// @param overrideClosed Whether a sell used the off-hours override, which skips the session and feed-age steps.
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

    /// @notice One buy, created by its FILLED or SETTLED receipt and named by that receipt's id (SPEC section 14,
    /// D-009 Q23). Sells move it to PART_SOLD, as often as they leave tokens in it, and then SOLD. reconcileLots trims
    /// tokensRemaining without a status change. Two storage slots: the token amounts are uint128, far above any stock
    /// token's supply.
    /// @param account The account that holds the tokens.
    /// @param tickerId The ticker bought.
    /// @param status FILLED or SETTLED at creation, then PART_SOLD or SOLD.
    /// @param tokensBought Tokens the buy delivered, measured by balance.
    /// @param tokensRemaining Tokens of the lot not sold through Sleeve and not trimmed by reconcileLots yet.
    struct Lot {
        address account;
        uint8 tickerId;
        Status status;
        uint128 tokensBought;
        uint128 tokensRemaining;
    }

    /// @notice The swap a split or settle asks executeBuy to run on the account (SPEC section 11).
    /// @param account The account that pays and receives.
    /// @param token The stock token bought.
    /// @param feed The ticker's feed, read for its decimals.
    /// @param pool The allowlisted v3 pool; the router derives the same pool from its fee.
    /// @param amountIn Exact USDG to spend: the equity part or the whole bucket.
    /// @param minOut The swap's minimum output from the trigger's quote and the rule's slippage cap.
    /// @param answer The feed answer the guard read.
    /// @param premiumCapBps The rule's premium cap.
    struct BuyOrder {
        address account;
        address token;
        address feed;
        address pool;
        uint256 amountIn;
        uint256 minOut;
        int256 answer;
        uint16 premiumCapBps;
    }

    /// @notice What a buy did, measured by balance.
    /// @param usdgSpent USDG that left the account, equal to amountIn.
    /// @param tokensOut Tokens that arrived, at least minOut and above zero.
    /// @param execPrice PriceGuard.execPriceBuy(usdgSpent, tokensOut).
    /// @param premiumBps PriceGuard.premiumBps against the guard's answer, at most the cap.
    struct BuyFill {
        uint256 usdgSpent;
        uint256 tokensOut;
        uint256 execPrice;
        int256 premiumBps;
    }

    /// @notice What split(account, pool, quote) would do now, read without a swap (SPEC section 15). The pool is the
    /// trigger's choice, so the preview checks only that the ticker has an allowlisted pool, not whether a given pool
    /// is allowlisted or blocked.
    /// @param ruleStatus The account's rule status. split reverts RuleNotActive unless it is ACTIVE.
    /// @param tickerId The rule's ticker.
    /// @param shortfall What a reconcile would take off the ledgers first, with a RECONCILED receipt.
    /// @param unsorted USDG the split would sort. With a shortfall it is zero.
    /// @param spendPart The part of unsorted that would go to spend.
    /// @param equityPart The part that would go to the equity leg.
    /// @param status The receipt the split would write: FILLED when it would attempt a buy, else QUEUED,
    /// REFUSED_TICKER or REFUSED_ACCOUNT. Meaningful only when the rule is ACTIVE and unsorted is above zero.
    /// @param reason QUEUED: the first failing guard step that can be read without a swap. A buy can still queue
    /// PREMIUM.
    /// @param buy Whether the split would attempt a buy.
    /// @param publicReadyAt When a PUBLIC trigger may split: the observation plus the grace while the observation
    /// covers the unsorted amount, that is unsorted is below observedUnsorted + 1 USDG, and zero otherwise, when observe
    /// must start or restart the clock first (the same rule the split applies, audit S-01).
    struct SplitPreview {
        RuleStatus ruleStatus;
        uint8 tickerId;
        uint256 shortfall;
        uint256 unsorted;
        uint256 spendPart;
        uint256 equityPart;
        Status status;
        Reason reason;
        bool buy;
        uint256 publicReadyAt;
    }

    /// @notice What settle(account, tickerId, pool, quote) would do now, read without a swap (SPEC section 15), with
    /// the same pool caveat as SplitPreview.
    /// @param ruleStatus The account's rule status. settle reverts RuleNotActive unless it is ACTIVE.
    /// @param amount The bucket.
    /// @param since When the bucket last went from empty to non-empty.
    /// @param bucketReason The bucket's reason.
    /// @param minClip The current rule's minimum clip. settle reverts BelowClip when the bucket is smaller and step 1
    /// or 2 does not refuse it.
    /// @param status SETTLED when settle would attempt a buy, REFUSED_TICKER or REFUSED_ACCOUNT when the bucket would
    /// go to spend, at any size, QUEUED when settle would revert: reason NONE for LedgersAboveBalance, reason CLIP for
    /// BelowClip, otherwise GuardNotClear(reason). Meaningful only when the rule is ACTIVE.
    /// @param reason See status.
    /// @param buy Whether settle would attempt a buy. A buy can still revert GuardNotClear(PREMIUM).
    /// @param publicReadyAt When a PUBLIC trigger may settle: the grace after the later of since and the open
    /// session's opening. Zero when settle would revert LedgersAboveBalance or BelowClip.
    /// @param shortfall What a split must reconcile first, with a RECONCILED receipt: settle reverts
    /// LedgersAboveBalance while it is above zero.
    struct SettlePreview {
        RuleStatus ruleStatus;
        uint256 amount;
        uint64 since;
        Reason bucketReason;
        uint128 minClip;
        Status status;
        Reason reason;
        bool buy;
        uint256 publicReadyAt;
        uint256 shortfall;
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

    /// @notice observe started or restarted an account's public-trigger clock (D-009 Q15).
    /// @param account The account.
    /// @param observedAt The clock's start.
    /// @param observedUnsorted Unsorted USDG at that moment. The clock covers unsorted below this plus 1 USDG
    /// (OBSERVE_RESTART_GROWTH): a public split may sort up to that much on it, and growth of 1 USDG or more needs a
    /// new observation. The level drops, without an event, when unsorted shrinks without a sort (audit A1-25).
    event Observed(address indexed account, uint64 observedAt, uint128 observedUnsorted);

    /// @notice A split brought the ledgers down to the balance after USDG left the account outside Sleeve, spend
    /// first, then the buckets in ascending ticker id (PRD 7.2, D-009 Q4). Companion to the RECONCILED receipt, which
    /// carries the totals.
    /// @param account The account.
    /// @param receiptId The RECONCILED receipt.
    /// @param balance The balance the ledgers were brought down to.
    /// @param fromSpend USDG taken off spend.
    /// @param fromBuckets USDG taken off each bucket, indexed by ticker id.
    event Reconciled(
        address indexed account, uint256 indexed receiptId, uint256 balance, uint256 fromSpend, uint256[] fromBuckets
    );

    /// @notice reconcileLots brought an account's lots for a ticker down to its token balance after tokens left the
    /// account outside Sleeve, oldest lot first, the order sells take them in. Companion to the RECONCILED receipts,
    /// one per trimmed lot.
    /// @param account The account.
    /// @param tickerId The ticker.
    /// @param balance The token balance the lots are brought down to.
    /// @param trimmed Tokens this call trimmed off the lots: their whole excess over the balance, or less when the
    /// call reached its 100-lot bound and a further call trims the rest (audit A1-13).
    event LotsReconciled(address indexed account, uint8 indexed tickerId, uint256 balance, uint256 trimmed);

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

    /// @notice The calendar does not answer version(), so it is not a SessionCalendarExtension.
    /// @param calendar The address given.
    error CalendarProbeFailed(address calendar);

    /// @notice The router derives pools from another factory than the one TokenSource checks pools against.
    /// @param routerFactory The router's factory().
    /// @param tokenSourceFactory TokenSource's v3Factory().
    error RouterFactoryMismatch(address routerFactory, address tokenSourceFactory);

    /// @notice TokenSource and the calendar answer to different admins.
    /// @param tokenSourceTimelock TokenSource's timelock().
    /// @param calendarTimelock The calendar's timelock().
    error TimelockMismatch(address tokenSourceTimelock, address calendarTimelock);

    /// @notice The admin of TokenSource and the calendar is not a SleeveTimelock at its 48-hour floor: it is an
    /// EIP-7702 delegated account, it does not report MIN_DELAY_FLOOR as 172,800, or its delay is below that (audit
    /// A1-26).
    /// @param timelock The admin address.
    error TimelockNotSleeve(address timelock);

    /// @notice The guard limits are not PriceGuard.defaultGuardParams(). The module is immutable, so a looser value
    /// would weaken a guard for good.
    error GuardParamsNotDefault();

    /// @notice The grace period is not 3,600 seconds.
    /// @param grace The grace given.
    error GraceNotDefault(uint256 grace);

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

    /// @notice A keeper or public trigger found the account's owner bracket open in this transaction.
    /// @param account The account.
    error OwnerOpOpen(address account);

    /// @notice The account no longer lists the module as an executor (isModuleInstalled(2, module, "")), so the
    /// module's state for it is stale and a buy could not run.
    /// @param account The account.
    error ModuleNotListed(address account);

    /// @notice onUninstall ran while the account still lists the module as an executor: an uninstallModule of type 4,
    /// 5 or 6, or a direct call, not the executor's removal. The state is kept (audit A1-24).
    /// @param account The account.
    error ModuleStillListed(address account);

    /// @notice A call entered the module for an account whose entry point is still running in this call stack. The
    /// lock is per account, so calls for other accounts are not blocked (audit A1-21).
    /// @param account The account whose state the call would write.
    error AccountLocked(address account);

    /// @notice The trigger's quote is zero.
    error ZeroQuote();

    /// @notice amount * quote does not fit the minOut arithmetic: its high word reaches the quote unit, 1e6 for a buy
    /// and 1e18 for a sell (audit A1-37).
    /// @param quote The quote given.
    error QuoteTooLarge(uint256 quote);

    /// @notice The account has no unsorted USDG and no pending equity, so there is nothing to observe.
    /// @param account The account.
    error NothingWaiting(address account);

    /// @notice A public trigger came before the grace period ended, or no observation covers the unsorted amount.
    /// @param readyAt The earliest time a public trigger can run. A split: the observation plus the grace, or now plus
    /// the grace when observe must start or restart the clock first. A settle: the later of the bucket's since and the
    /// open session's opening, plus the grace.
    error GracePeriodActive(uint256 readyAt);

    /// @notice The trigger's pool is not on the ticker's allowlist, while the allowlist has pools, or a sell's pool is
    /// not on it at all.
    /// @param tickerId The ticker.
    /// @param pool The pool given.
    error PoolNotAllowed(uint8 tickerId, address pool);

    /// @notice PriceGuard.PoolBlocked: the stock token blocklist holds the trigger's pool. Declared here so the ABI
    /// decodes it.
    /// @param pool The pool given.
    error PoolBlocked(address pool);

    /// @notice The bucket is empty, or below the current rule's minimum clip while the guard would buy or wait, so
    /// settle does not act on it. A bucket the guard refuses goes to spend at any size (audit A1-31).
    /// @param amount The bucket.
    /// @param minClip The rule's minimum clip.
    error BelowClip(uint256 amount, uint128 minClip);

    /// @notice settle found the ledgers above the balance: an outside pull is not reconciled yet, so in PRD 7.2's
    /// order part of the buckets may already be gone. A split reconciles first (audit I-02).
    /// @param account The account.
    /// @param shortfall How far spend plus pending equity exceed the balance settle computes from.
    error LedgersAboveBalance(address account, uint256 shortfall);

    /// @notice settle found a timing step failing, or the fill above the premium cap, so the bucket keeps waiting
    /// and nothing changed. sell found a step failing that the off-hours override does not skip: PAUSED,
    /// ORACLE_PAUSED, MULTIPLIER, DEPEG, or STALE for a feed answer at or below zero or from the future while the
    /// override is on.
    /// @param reason The first failing step.
    error GuardNotClear(Reason reason);

    /// @notice release or _releaseBucket found the bucket empty.
    /// @param account The account.
    /// @param tickerId The ticker.
    error EmptyBucket(address account, uint8 tickerId);

    /// @notice executeBuy was called by an address other than the module itself.
    /// @param caller The caller.
    error NotSelf(address caller);

    /// @notice The swap moved a different amount of its input than amountIn, as when the pool ran out of liquidity:
    /// USDG for a buy, stock tokens for a sell.
    /// @param amountIn The amount the swap had to spend.
    /// @param usdgSpent What left the account, measured by balance: USDG for a buy, tokens for a sell.
    error PartialFill(uint256 amountIn, uint256 usdgSpent);

    /// @notice The buy delivered no tokens, or fewer than minOut, measured by balance (I3). The minimum is checked
    /// after the premium cap, so a fill that fails both queues PREMIUM (PRD 7.4 steps 8 and 9, audit A1-12).
    /// @param tokensOut Tokens that arrived, zero when none did.
    /// @param minOut The minimum.
    error TooFewTokens(uint256 tokensOut, uint256 minOut);

    /// @notice The account's allowance of the swap's input to the router is not zero after the swap (I4): USDG after
    /// a buy, the stock token after a sell.
    /// @param allowance The allowance left.
    error AllowanceNotReset(uint256 allowance);

    /// @notice The module's USDG or stock token balance changed across a buy or a sell (I1). Measured as a delta, so a
    /// balance someone sent the module earlier blocks nothing.
    /// @param asset The token.
    /// @param amount The module's balance after the swap.
    error ModuleHoldsFunds(address asset, uint256 amount);

    /// @notice The swap's balance changes on the account do not match the pool's: the pool's USDG and token balances
    /// must move by exactly what the account's moved, the other way round, so a fill is a swap in the allowlisted pool
    /// and not transfers the account arranged (audit A1-23).
    /// @param pool The allowlisted pool of the order.
    /// @param poolUsdgDelta The pool's USDG balance change: plus the USDG a buy spent, minus a sell's proceeds.
    /// @param poolTokenDelta The pool's token balance change: minus the tokens a buy received, plus the tokens a sell
    /// spent.
    error FillNotFromPool(address pool, int256 poolUsdgDelta, int256 poolTokenDelta);

    /// @notice Code inside the account's executeFromExecutor reverted with the PremiumAboveCap selector, which only the
    /// module's own premium check may raise, so split does not queue it (audit A1-19).
    /// @param reason The batch's revert data.
    error BatchReverted(bytes reason);

    /// @notice The fill paid more than the rule's premium cap above the feed price. split catches exactly this, from
    /// the module's own check, and queues PREMIUM; settle turns it into GuardNotClear(PREMIUM).
    /// @param premiumBps The fill's premium, PriceGuard.premiumBps.
    error PremiumAboveCap(int256 premiumBps);

    /// @notice No lot has this id.
    /// @param lotId The id given.
    error UnknownLot(uint256 lotId);

    /// @notice A lot transition outside FILLED, SETTLED or PART_SOLD to PART_SOLD or SOLD (I7).
    /// @param lotId The lot.
    /// @param from Its status.
    /// @param to The status asked for.
    error BadLotTransition(uint256 lotId, Status from, Status to);

    /// @notice A sell asked for zero tokens.
    error ZeroAmount();

    /// @notice The lots a sell may take from hold fewer tokens than it asks for: the account's lots of the ticker
    /// for a sell by amount, the named lot for a sell by lot. Tokens outside lots are not sellable through Sleeve in
    /// M0 (D-009 Q30).
    /// @param tokenAmount The tokens asked for.
    /// @param lotTokens The tokens those lots hold.
    error ExceedsLots(uint256 tokenAmount, uint256 lotTokens);

    /// @notice A sell by amount would take from more lots than one call may, which bounds a sell's receipts and gas
    /// (audit A1-13). Sell at most sellableTokens in this call, or sell by lot id, then the rest.
    /// @param sellableTokens The tokens the oldest maxLots lots that hold tokens cover: the most one sell by amount
    /// takes now.
    /// @param maxLots The most lots one call takes from, 100.
    error TooManyLots(uint256 sellableTokens, uint256 maxLots);

    /// @notice The account holds fewer tokens of the ticker than a sell asks for, though its lots cover the amount:
    /// tokens left outside Sleeve, and reconcileLots brings the lots down to the balance (audit A1).
    /// @param tokenAmount The tokens asked for.
    /// @param balance The account's token balance.
    error ExceedsBalance(uint256 tokenAmount, uint256 balance);

    /// @notice The lot a sell names belongs to another account or another ticker.
    /// @param lotId The lot given.
    error LotMismatch(uint256 lotId);

    /// @notice A sell's overrideCapBps is neither zero nor between the rule's premium cap and MAX_PREMIUM_CAP_BPS.
    /// @param overrideCapBps The cap given.
    /// @param minBps The rule's premium cap, the smallest widened cap.
    /// @param maxBps The largest widened cap (B2-14).
    error OverrideCapOutOfRange(uint16 overrideCapBps, uint16 minBps, uint16 maxBps);

    /// @notice The stock token blocklist holds the account, so its tokens cannot move.
    /// @param account The account.
    error AccountBlocked(address account);

    /// @notice The stock token blocklist holds the router, so the token's approve and transferFrom would revert.
    /// @param router SwapRouter02.
    error RouterBlocked(address router);

    /// @notice The market reference is not live and the sell did not use the off-hours override: the session is
    /// closed, or the feed round is stale (B2-13). Nothing moved. The app shows the sell as waiting with the reopen
    /// time.
    /// @param reason SESSION or STALE.
    error SellWaits(Reason reason);

    /// @notice The sell received less than its discount cap allows below the feed price. The swap was undone.
    /// @param discountBps The sale's discount, PriceGuard.discountBps.
    /// @param capBps The cap the sell was held to.
    error DiscountAboveCap(int256 discountBps, uint16 capBps);

    /// @notice The sell delivered no USDG, or less than minOut, measured by balance. The minimum is checked after the
    /// discount cap, as the buy checks it after the premium cap (audit A1-12).
    /// @param usdgOut USDG that arrived, zero when none did.
    /// @param minOut The minimum.
    error TooLittleUsdg(uint256 usdgOut, uint256 minOut);

    /// @notice Installs the module on the calling account, overwriting any state a failed onUninstall left behind
    /// (D-009 Q20). The spend ledger becomes the account's whole USDG balance and nothing is unsorted (I5). Buckets
    /// left over from an earlier install go to spend with RELEASED receipts first. Rule versions keep counting up.
    /// @dev Caller: the account, through ERC-7579 installModule. If the account has an open owner bracket, the
    /// bracket restarts from the install snapshot. Deviation from ERC-7579, which says onInstall MUST revert when the
    /// module is already initialized for the account: this one overwrites instead, because it cannot tell a double
    /// install from state that Kernel left behind when it ignored a failing onUninstall (D-019).
    /// @param data Empty, or abi.encode(address keeper, RuleInput rule). A zero keeper means defaultKeeper. An
    /// all-zero rule means no rule; any other rule must pass the setRule checks or the install reverts.
    function onInstall(bytes calldata data) external;

    /// @notice Uninstalls the module from the calling account. Each non-empty bucket goes to spend with a RELEASED
    /// receipt, trigger OWNER; then the account's ledgers, rule, keeper and observation are deleted. Receipts, lots
    /// and the rule version counter stay.
    /// @dev Caller: an account that installed the module, through ERC-7579 uninstallModule for the executor type, which
    /// removes the module from the account's config before it calls onUninstall. Reverts NotInstalled, and
    /// ModuleStillListed while the account still lists the module, as after uninstallModule with type 4, 5 or 6 or a
    /// direct call, so the state is kept (audit A1-24). It can also run out of gas (D-019). Kernel v3.1 ignores the
    /// result, so the app checks ModuleUninstallResult. An open owner bracket stays open; endOwnerOp closes it without
    /// booking.
    /// @param data Ignored.
    function onUninstall(bytes calldata data) external;

    /// @notice True for module type 2, executor, only.
    /// @param moduleTypeId The ERC-7579 module type.
    function isModuleType(uint256 moduleTypeId) external view returns (bool);

    /// @notice Whether an account has the module installed.
    /// @param account The account.
    function isInitialized(address account) external view returns (bool);

    /// @notice Sets the calling account's rule: the next version, ACTIVE, at once. USDG already sorted is never
    /// re-sorted.
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
    /// balanceNow - balanceAtBegin - moduleDelta. A positive change credits spend in full (I6), after reconciling any
    /// outside pull still unbooked at the virtual balance balanceAtBegin + moduleDelta, with a RECONCILED receipt, so
    /// the pull comes out of spend and then the buckets before the owner's USDG lands (PRD 7.2 order, audit I-01). A
    /// negative one comes off spend, then unsorted computed from the virtual balance, then the buckets in ascending
    /// ticker id, and lowers the public-trigger level to the unsorted left. Emits OwnerOpEnded. The app puts it last in
    /// every owner batch (I14).
    /// @dev Caller: the account that opened the bracket. Reverts OwnerOpNotOpen without a bracket, NotInstalled for
    /// a caller without the module and without a bracket. An account that uninstalled inside the bracket gets the
    /// bracket cleared and nothing booked.
    function endOwnerOp() external;

    /// @notice Starts or restarts the account's public-trigger clock: stores now and the unsorted amount when no
    /// observation exists or unsorted grew by 1 USDG (OBSERVE_RESTART_GROWTH) or more past the stored amount (D-009
    /// Q15). Growth under 1 USDG rides the running clock, so dust cannot postpone the public fallback, and restarting
    /// it costs 1 USDG of the griefer's money per restart, which becomes the owner's income. When unsorted shrank
    /// without a sort, the stored amount drops to it and the clock keeps running (audit A1-25).
    /// @dev Caller: anyone. Reverts NotInstalled, or NothingWaiting when the account has no unsorted USDG and no
    /// pending equity.
    /// @param account The account.
    /// @return observedAt The observation in force after the call.
    function observe(address account) external returns (uint64 observedAt);

    /// @notice Sorts the account's unsorted USDG by its rule (SPEC section 9). When the ledgers exceed the balance it
    /// reconciles instead, spend first, with a RECONCILED receipt; nothing is unsorted then. Otherwise it splits into
    /// the spend part and the equity part and runs the guard on the rule's ticker in PRD 7.4 order: step 1 refuses the
    /// ticker and step 2 the account, sending the equity part to spend; steps 3 to 7 and the minimum clip queue it in
    /// the ticker's bucket; otherwise it buys through executeBuy, and a fill above the premium cap queues PREMIUM. One
    /// receipt either way. A zero equity part needs no guard: it writes QUEUED with reason CLIP and nothing queued.
    /// Every sort clears the account's observation, so the next payment gets its own grace, and a reconcile lowers the
    /// observed level to zero.
    /// @dev Caller: the account (OWNER), its keeper (KEEPER) or anyone after the grace (PUBLIC). Keeper and public
    /// triggers revert OwnerOpOpen while the account's bracket is open. Reverts NotInstalled, ModuleNotListed,
    /// RuleNotActive, ZeroQuote, GracePeriodActive, PoolNotAllowed for a pool off the allowlist, PoolBlocked,
    /// QuoteTooLarge, and bubbles any buy failure other than the module's own PremiumAboveCap, so a minimum-out
    /// failure or a partial fill moves nothing. Inside an owner bracket it computes unsorted from the virtual balance
    /// and records its USDG change there.
    /// @param account The account.
    /// @param pool An allowlisted pool of the rule's ticker.
    /// @param quote Token base units per 1e6 USDG base units, from the trigger's own quote. Not zero.
    /// @return receiptId The receipt the call wrote, or 0 when nothing was unsorted and the ledgers were whole.
    function split(address account, address pool, uint256 quote) external returns (uint256 receiptId);

    /// @notice Buys a whole bucket once the guard clears (SPEC section 10), at the current rule's caps (D-009 Q24).
    /// Step 1 or 2 failing sends the bucket to spend with a REFUSED receipt, whatever its size. A fill empties the
    /// bucket, writes SETTLED with the bucket's reason and since and the current rule version, and creates a lot. A
    /// settle leaves the account's observation, which serves split only, as it is.
    /// @dev Caller: as split. A public trigger waits for the grace after the later of the bucket's since and the open
    /// session's opening, so the keeper has the first hour of every session; no observation is needed (D-009 Q16 as
    /// amended by audit A1-05). Reverts LedgersAboveBalance while an outside pull is unreconciled (a split reconciles
    /// it first), BelowClip for an empty bucket and, unless step 1 or 2 refuses the bucket, under the current rule's
    /// minimum clip, and GuardNotClear(reason) with no state change when a timing step fails or the fill is above the
    /// premium cap; the other reverts are split's. Inside an owner bracket it records its USDG change there.
    /// @param account The account.
    /// @param tickerId The bucket's ticker.
    /// @param pool An allowlisted pool of that ticker.
    /// @param quote As split.
    /// @return receiptId The SETTLED or REFUSED receipt.
    function settle(address account, uint8 tickerId, address pool, uint256 quote) external returns (uint256 receiptId);

    /// @notice Moves the calling account's whole bucket for a ticker to spend with a RELEASED receipt. No guard runs
    /// and the rule may be paused or unset (I11).
    /// @dev Caller: an installed account. Reverts EmptyBucket for an empty bucket.
    /// @param tickerId The ticker.
    /// @return receiptId The RELEASED receipt.
    function release(uint8 tickerId) external returns (uint256 receiptId);

    /// @notice Sells the calling account's stock tokens from its lots for USDG through one allowlisted pool, with the
    /// guard mirrored (SPEC section 12, PRD 7.5): the ticker known in TokenSource (a removed ticker still sells), the
    /// pool allowlisted, then the account, the pool and the router unblocked, the token not paused, its oracle not
    /// paused, no multiplier change due, USDG within its band, and last the session open and the feed round fresh.
    /// Then one swap in one batch, USDG to the account, and the proceeds to spend, never split (I6). One PART_SOLD or
    /// SOLD receipt per lot taken from, with its pro rata share. An outside pull not reconciled yet is reconciled first,
    /// with a RECONCILED receipt, so the proceeds never refill a bucket the pull emptied (PRD 7.2, audit I-03).
    /// @dev Caller: the account, normally inside its owner bracket, where the proceeds are the module's USDG delta.
    /// lotId zero takes the account's lots of the ticker oldest first; otherwise only that lot. The rule may be
    /// paused or unset. Reverts, in this order: NotInstalled, ZeroAmount, ZeroQuote, OverrideCapOutOfRange,
    /// ModuleNotListed, UnknownLot, LotMismatch, ExceedsLots or TooManyLots for a sell by amount that needs more than
    /// 100 lots, QuoteTooLarge, TickerHasNoFeed, PoolNotAllowed,
    /// ExceedsBalance (tokens left outside Sleeve: reconcileLots first), AccountBlocked, PoolBlocked, RouterBlocked,
    /// GuardNotClear for PAUSED, ORACLE_PAUSED, MULTIPLIER and DEPEG, and SellWaits for SESSION and STALE unless
    /// overrideClosed is set (B2-13). After the swap: PartialFill unless exactly tokenAmount left the account,
    /// TooLittleUsdg when no USDG arrived, FillNotFromPool, AllowanceNotReset, ModuleHoldsFunds, DiscountAboveCap when
    /// usdgOut * 10^(18 + 8 - 6) * 10,000 < tokenAmount * answer * (10,000 - cap), then TooLittleUsdg below minOut.
    /// Every revert leaves nothing moved.
    /// @param tickerId The ticker.
    /// @param tokenAmount Stock token base units to sell, at most the lots' tokens and the account's balance.
    /// @param lotId Zero to sell by amount, oldest lot first, or the one lot to sell from.
    /// @param pool An allowlisted pool of the ticker.
    /// @param quote USDG base units per 1e18 token units, from the owner's own quote. Not zero. minOut =
    /// tokenAmount * quote / 1e18 * (10,000 - slippageBps) / 10,000 with the rule's slippage cap; without a rule the
    /// cap is zero and minOut is the quote's own amount.
    /// @param overrideClosed Skips the session and feed-age steps for this sell only, after the app showed the gap
    /// risk. The feed answer must still be positive and not from the future, and every other step still applies.
    /// @param overrideCapBps Zero to hold the sell to the rule's premium cap as its discount cap (zero without a
    /// rule), or a wider cap for this sell only, from the rule's cap up to MAX_PREMIUM_CAP_BPS (B2-14).
    /// @return receiptId The first receipt the sell wrote, for the oldest lot it took from.
    function sell(
        uint8 tickerId,
        uint256 tokenAmount,
        uint256 lotId,
        address pool,
        uint256 quote,
        bool overrideClosed,
        uint16 overrideCapBps
    ) external returns (uint256 receiptId);

    /// @notice Brings the calling account's lots of a ticker down to its token balance after tokens left outside
    /// Sleeve: trims tokensRemaining oldest lot first, the order sells take them in, since an outflow cannot have come
    /// from a lot bought after it (audit A1-03), writes one RECONCILED receipt per trimmed lot and emits
    /// LotsReconciled. Lot statuses stay as they are. Nothing moves. One call trims at most 100 lots, which bounds its
    /// receipts and gas (audit A1-13); while it returns a receipt id the lots may still exceed the balance, and the
    /// next call trims on.
    /// @dev Caller: an installed account. Reverts NotInstalled.
    /// @param tickerId The ticker.
    /// @return receiptId The first RECONCILED receipt, for the oldest lot trimmed, or 0 when the lots already fit the
    /// balance.
    function reconcileLots(uint8 tickerId) external returns (uint256 receiptId);

    /// @notice Runs one buy on the account through executeFromExecutor, as one batch of exactly USDG.approve(router,
    /// amountIn), router.exactInputSingle with no minimum of the router's own and USDG.approve(router, 0) (SPEC section
    /// 11, D-019), and checks it by balance: USDG spent equals amountIn, tokens arrived, the pool's balances moved by
    /// the same amounts the other way, the allowance is zero, the module's own balances did not change. Then it reverts
    /// PremiumAboveCap when the fill paid more than the cap above the feed price, and TooFewTokens below minOut, in PRD
    /// 7.4's order; either undoes the swap. A PremiumAboveCap from inside the batch reverts BatchReverted.
    /// @dev Caller: the module itself, from split and settle while they hold the account's lock. Anyone else gets
    /// NotSelf.
    /// @param order The buy.
    /// @return fill What the buy did.
    function executeBuy(BuyOrder calldata order) external returns (BuyFill memory fill);

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

    /// @notice A lot.
    /// @param lotId The lot id, which is its FILLED or SETTLED receipt id.
    function lot(uint256 lotId) external view returns (Lot memory);

    /// @notice An account's lots for a ticker, oldest first, and the index sells start from.
    /// @param account The account.
    /// @param tickerId The ticker.
    /// @return lotIds Every lot id, in creation order.
    /// @return head Index into lotIds of the oldest lot that may still hold tokens.
    function lotsOf(address account, uint8 tickerId) external view returns (uint256[] memory lotIds, uint256 head);

    /// @notice An account's public-trigger observation.
    /// @param account The account.
    /// @return observedAt When the clock started, zero when none runs.
    /// @return observedUnsorted Unsorted USDG at that moment.
    function observationOf(address account) external view returns (uint64 observedAt, uint128 observedUnsorted);

    /// @notice What split would do now. See SplitPreview.
    /// @param account The account.
    function previewSplit(address account) external view returns (SplitPreview memory);

    /// @notice What settle would do now for a ticker's bucket. See SettlePreview.
    /// @param account The account.
    /// @param tickerId The ticker.
    function previewSettle(address account, uint8 tickerId) external view returns (SettlePreview memory);

    /// @notice When the session now open for a ticker began, as the guard's fresh-round check and the public settle
    /// grace read it. Zero while the session is closed.
    /// @param tickerId The ticker.
    function sessionOpenedAt(uint8 tickerId) external view returns (uint256);

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
