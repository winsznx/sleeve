import type { Reason, RuleInputIssue } from '@sleeve/core';

import type { SellWaitReason } from './types';

/**
 * Named failures a screen can act on. Contract error names are kept where SPEC.md gives them (RuleNotActive,
 * NothingWaiting, GracePeriodActive, BelowClip, GuardNotClear, SellWaits, ExceedsLots, DiscountAboveCap), so a
 * revert maps across unchanged.
 */
export type DataLayerErrorDetail =
  | { code: 'InvalidRule'; issues: RuleInputIssue[] }
  | { code: 'SellWaits'; reason: SellWaitReason; reopensAt: bigint | null }
  | { code: 'GuardNotClear'; reason: Reason }
  | { code: 'GracePeriodActive'; readyAt: bigint | null }
  | { code: 'BelowClip'; minClip: bigint }
  // SleeveModule reverts that carry values a screen can show (contracts/src, SPEC 9 to 12).
  /** A sell asks more tokens than the account holds; a preview of a send uses the same code without tokenAmount. */
  | { code: 'ExceedsBalance'; tokenAmount?: bigint; balance: bigint }
  | { code: 'RouterBlocked'; router: `0x${string}` }
  | { code: 'PoolBlocked'; pool: `0x${string}` }
  | { code: 'PoolNotAllowed'; tickerId: number; pool: `0x${string}` }
  | { code: 'LotMismatch'; lotId: bigint }
  | { code: 'UnknownLot'; lotId: bigint }
  | { code: 'TooManyLots'; sellableTokens: bigint; maxLots: bigint }
  | { code: 'TooLittleUsdg'; usdgOut: bigint; minOut: bigint }
  | { code: 'TooFewTokens'; tokensOut: bigint; minOut: bigint }
  | { code: 'EmptyBucket'; tickerId: number }
  | { code: 'LedgersAboveBalance'; shortfall: bigint }
  /** USDG's own refusal: the account holds less than the transfer asks. */
  | { code: 'InsufficientBalance'; balance: bigint; needed: bigint }
  /**
   * Kernel's ModuleUninstallResult for the module after an uninstall: false when the module's onUninstall reverted,
   * which Kernel ignores, so the account no longer lists the module and what waited was not released (D-019); null
   * when the transaction carries none for the module.
   */
  | { code: 'UninstallFailed'; result: boolean | null }
  /** Any other SleeveModule error, by its Solidity name, with its arguments as decimal or hex text. */
  | { code: 'ModuleReverted'; error: string; args: readonly string[] }
  /** The bundler or the EntryPoint refused or reverted the UserOp for a reason none of the above names. */
  | { code: 'UserOpFailed'; userOpHash: `0x${string}` | null; reason: string }
  /** A value the chain data layer needs is missing from .env.local. */
  | { code: 'MissingConfig'; key: string }
  | {
      code:
        | 'NotSignedIn'
        | 'PasskeyCancelled'
        | 'PasskeyUnavailable'
        | 'SponsorshipUnavailable'
        | 'SourceUnavailable'
        | 'NotFound'
        | 'RuleNotActive'
        | 'RuleNotPaused'
        | 'NothingWaiting'
        | 'ExceedsLots'
        | 'DiscountAboveCap'
        | 'OverrideCapOutOfRange'
        | 'AccountBlocked'
        | 'ZeroAmount'
        | 'NoRule'
        | 'NotInstalled'
        /** The module is installed, so an op without brackets is refused (D-040). */
        | 'ModuleInstalled'
        | 'ModuleNotListed'
        | 'OwnerOpOpen'
        | 'AccountLocked'
        | 'WalletRejected';
    };

export type DataLayerErrorCode = DataLayerErrorDetail['code'];

export class DataLayerError extends Error {
  readonly detail: DataLayerErrorDetail;

  /** `options.cause` keeps the failure underneath, so a wallet's own error stays readable through the chain. */
  constructor(detail: DataLayerErrorDetail, message: string, options?: ErrorOptions) {
    super(message, options);
    this.name = 'DataLayerError';
    this.detail = detail;
  }

  get code(): DataLayerErrorCode {
    return this.detail.code;
  }
}

export function isDataLayerError(error: unknown): error is DataLayerError {
  return error instanceof DataLayerError;
}
