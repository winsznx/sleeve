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
  | {
      code:
        | 'NotSignedIn'
        | 'PasskeyCancelled'
        | 'SourceUnavailable'
        | 'NotFound'
        | 'RuleNotActive'
        | 'RuleNotPaused'
        | 'NothingWaiting'
        | 'ExceedsLots'
        | 'DiscountAboveCap'
        | 'OverrideCapOutOfRange'
        | 'AccountBlocked';
    };

export type DataLayerErrorCode = DataLayerErrorDetail['code'];

export class DataLayerError extends Error {
  readonly detail: DataLayerErrorDetail;

  constructor(detail: DataLayerErrorDetail, message: string) {
    super(message);
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
