import { REASONS, enumMember, sleeveModuleAbi, type Reason, type RuleInputIssue } from '@sleeve/core';
import { decodeErrorResult, type Abi, type Hex } from 'viem';

import { DataLayerError, isDataLayerError } from '../errors';
import { passkeyFailure } from '../passkey';

/**
 * Every SleeveModule revert, read back from revert data and named the way the app's errors name it. The module ABI
 * carries the errors of every library it links (SleeveTrade, SleeveBuy, SleeveSell, PriceGuard, LedgerMath), so one
 * decode covers a revert from any of them. USDG's own ERC-20 errors decode too, for a withdraw that asks too much.
 */

export type ModuleErrorName = Extract<(typeof sleeveModuleAbi)[number], { type: 'error' }>['name'];

const usdgErrorsAbi = [
  {
    type: 'error',
    name: 'ERC20InsufficientBalance',
    inputs: [
      { name: 'sender', type: 'address' },
      { name: 'balance', type: 'uint256' },
      { name: 'needed', type: 'uint256' },
    ],
  },
  { type: 'error', name: 'ERC20InvalidReceiver', inputs: [{ name: 'receiver', type: 'address' }] },
  { type: 'error', name: 'ERC20InvalidSender', inputs: [{ name: 'sender', type: 'address' }] },
] as const;

const REVERT_ABI = [...sleeveModuleAbi, ...usdgErrorsAbi] as const satisfies Abi;

export interface DecodedRevert {
  name: string;
  args: readonly unknown[];
}

/** The named error in revert data, or null when the data names none this ABI knows. */
export function decodeRevert(data: Hex): DecodedRevert | null {
  if (data.length < 10) return null;
  try {
    const decoded = decodeErrorResult({ abi: REVERT_ABI, data });
    return { name: decoded.errorName, args: decoded.args ?? [] };
  } catch {
    return null;
  }
}

function text(value: unknown): string {
  if (typeof value === 'bigint' || typeof value === 'number' || typeof value === 'boolean') return value.toString();
  if (typeof value === 'string') return value;
  return JSON.stringify(value, (_, inner: unknown) => (typeof inner === 'bigint' ? inner.toString() : inner));
}

function big(args: readonly unknown[], index: number): bigint {
  const value = args[index];
  return typeof value === 'bigint' ? value : BigInt(typeof value === 'number' ? value : 0);
}

function num(args: readonly unknown[], index: number): number {
  const value = args[index];
  return typeof value === 'number' ? value : Number(typeof value === 'bigint' ? value : 0);
}

function address(args: readonly unknown[], index: number): `0x${string}` {
  const value = args[index];
  return typeof value === 'string' && value.startsWith('0x') ? (value as `0x${string}`) : '0x0000000000000000000000000000000000000000';
}

function reasonOf(args: readonly unknown[]): Reason {
  return enumMember(REASONS, num(args, 0));
}

const RULE_ISSUES: Partial<Record<string, RuleInputIssue>> = {
  SharesSumNotTotal: 'SharesSumNotTotal',
  EquityBpsAboveTotal: 'SharesSumNotTotal',
  PremiumCapAboveMax: 'PremiumCapOutOfRange',
  SlippageAboveMax: 'SlippageOutOfRange',
  MinClipBelowFloor: 'MinClipBelowFloor',
  TickerNotActive: 'TickerNotActive',
  TickerNotListed: 'TickerNotActive',
  TickerHasNoFeed: 'TickerNotActive',
  TickerHasNoSession: 'TickerNotActive',
};

export interface RevertContext {
  /** When the ticker's session opens next, for SellWaits(SESSION). */
  reopensAt?: bigint | null;
}

/** The app's error for one decoded revert. Never throws; an error the app has no entry for keeps its name. */
export function revertToDataLayerError(revert: DecodedRevert, context: RevertContext = {}): DataLayerError {
  const { name, args } = revert;
  const issue = RULE_ISSUES[name];
  if (issue !== undefined) {
    return new DataLayerError({ code: 'InvalidRule', issues: [issue] }, `The rule was refused: ${name}`);
  }
  switch (name) {
    case 'SellWaits': {
      const reason = reasonOf(args);
      const wait = reason === 'SESSION' ? 'SESSION' : 'STALE';
      return new DataLayerError(
        { code: 'SellWaits', reason: wait, reopensAt: wait === 'SESSION' ? (context.reopensAt ?? null) : null },
        wait === 'SESSION' ? 'The market is closed, so the sell waits for it to open' : 'The price feed is not fresh, so the sell waits',
      );
    }
    case 'GuardNotClear':
      return new DataLayerError({ code: 'GuardNotClear', reason: reasonOf(args) }, `A guard check did not clear: ${reasonOf(args)}`);
    case 'PremiumAboveCap':
      return new DataLayerError({ code: 'GuardNotClear', reason: 'PREMIUM' }, 'The pool price was above the cap');
    case 'GracePeriodActive':
      return new DataLayerError({ code: 'GracePeriodActive', readyAt: big(args, 0) }, 'The grace period is still running');
    case 'BelowClip':
      return new DataLayerError({ code: 'BelowClip', minClip: big(args, 1) }, 'The amount is below the minimum buy');
    case 'RuleNotActive':
      return new DataLayerError({ code: 'RuleNotActive' }, 'The rule is not active');
    case 'RuleNotPaused':
      return new DataLayerError({ code: 'RuleNotPaused' }, 'The rule is not paused');
    case 'NoRule':
      return new DataLayerError({ code: 'NoRule' }, 'The account has no rule yet');
    case 'NothingWaiting':
      return new DataLayerError({ code: 'NothingWaiting' }, 'Nothing is waiting to be sorted');
    case 'ExceedsLots':
      return new DataLayerError({ code: 'ExceedsLots' }, `The lots hold ${text(args[1])} token units, less than the ${text(args[0])} asked`);
    case 'ExceedsBalance':
      return new DataLayerError(
        { code: 'ExceedsBalance', tokenAmount: big(args, 0), balance: big(args, 1) },
        'The account holds fewer tokens than the sell asks',
      );
    case 'DiscountAboveCap':
      return new DataLayerError({ code: 'DiscountAboveCap' }, `The sale was ${text(args[0])} bps below the feed, over the ${text(args[1])} bps cap`);
    case 'OverrideCapOutOfRange':
      return new DataLayerError({ code: 'OverrideCapOutOfRange' }, `The override cap must be 0 or from ${text(args[1])} to ${text(args[2])} bps`);
    case 'AccountBlocked':
      return new DataLayerError({ code: 'AccountBlocked' }, 'The issuer blocks this account');
    case 'RouterBlocked':
      return new DataLayerError({ code: 'RouterBlocked', router: address(args, 0) }, 'The issuer blocks the swap router');
    case 'PoolBlocked':
      return new DataLayerError({ code: 'PoolBlocked', pool: address(args, 0) }, 'The issuer blocks this pool');
    case 'PoolNotAllowed':
      return new DataLayerError(
        { code: 'PoolNotAllowed', tickerId: num(args, 0), pool: address(args, 1) },
        'This pool is not on the ticker allowlist',
      );
    case 'LotMismatch':
      return new DataLayerError({ code: 'LotMismatch', lotId: big(args, 0) }, 'That lot belongs to another account or ticker');
    case 'UnknownLot':
      return new DataLayerError({ code: 'UnknownLot', lotId: big(args, 0) }, 'No lot has that id');
    case 'TooManyLots':
      return new DataLayerError(
        { code: 'TooManyLots', sellableTokens: big(args, 0), maxLots: big(args, 1) },
        'The sell would draw from more than 100 lots',
      );
    case 'TooLittleUsdg':
      return new DataLayerError(
        { code: 'TooLittleUsdg', usdgOut: big(args, 0), minOut: big(args, 1) },
        'The sale would bring less USDG than the slippage cap allows',
      );
    case 'TooFewTokens':
      return new DataLayerError(
        { code: 'TooFewTokens', tokensOut: big(args, 0), minOut: big(args, 1) },
        'The buy would bring fewer tokens than the slippage cap allows',
      );
    case 'EmptyBucket':
      return new DataLayerError({ code: 'EmptyBucket', tickerId: num(args, 1) }, 'Nothing is waiting for this ticker');
    case 'LedgersAboveBalance':
      return new DataLayerError(
        { code: 'LedgersAboveBalance', shortfall: big(args, 1) },
        'USDG left the account outside Sleeve; a split books it first',
      );
    case 'ZeroAmount':
      return new DataLayerError({ code: 'ZeroAmount' }, 'The amount is zero');
    case 'NotInstalled':
      return new DataLayerError({ code: 'NotInstalled' }, 'The Sleeve module is not installed on this account');
    case 'ModuleNotListed':
      return new DataLayerError({ code: 'ModuleNotListed' }, 'The account no longer lists the Sleeve module');
    case 'OwnerOpOpen':
      return new DataLayerError({ code: 'OwnerOpOpen' }, 'An owner action is still open on this account');
    case 'AccountLocked':
      return new DataLayerError({ code: 'AccountLocked' }, 'Another action on this account is running');
    case 'ERC20InsufficientBalance':
      return new DataLayerError(
        { code: 'InsufficientBalance', balance: big(args, 1), needed: big(args, 2) },
        'The account holds less USDG than the transfer asks',
      );
    default:
      return new DataLayerError({ code: 'ModuleReverted', error: name, args: args.map(text) }, `The contract refused the action: ${name}`);
  }
}

function field(value: unknown, key: string): unknown {
  return typeof value === 'object' && value !== null && key in value ? (value as Record<string, unknown>)[key] : undefined;
}

/** Every error in a cause chain, outermost first. viem nests the RPC error under its own. */
export function causeChain(error: unknown): unknown[] {
  const seen: unknown[] = [];
  let current: unknown = error;
  while (current !== undefined && current !== null && !seen.includes(current) && seen.length < 12) {
    seen.push(current);
    current = field(current, 'cause');
  }
  return seen;
}

const HEX = /^0x[0-9a-fA-F]*$/;

/** Revert data anywhere in a viem error chain: RawContractError.data, an RPC error's data, or data.data. */
export function revertDataOf(error: unknown): Hex | null {
  for (const link of causeChain(error)) {
    const data = field(link, 'data');
    if (typeof data === 'string' && HEX.test(data) && data.length >= 10) return data as Hex;
    const nested = field(data, 'data');
    if (typeof nested === 'string' && HEX.test(nested) && nested.length >= 10) return nested as Hex;
  }
  return null;
}

function nameOf(error: unknown): string {
  const name = field(error, 'name');
  return typeof name === 'string' ? name : '';
}

/**
 * Any failure from a read, a simulation, a signature or a UserOp, as the app's named error. A passkey prompt that
 * closed is PasskeyCancelled, a wallet that declined is WalletRejected (the wallet's error stays as the cause), and a
 * revert is named by its contract error. Nothing is guessed: what none of these names reaches the screen as
 * SourceUnavailable with the original message.
 */
export function toDataLayerFailure(error: unknown, context: RevertContext = {}): DataLayerError {
  if (isDataLayerError(error)) return error;
  const chain = causeChain(error);
  for (const link of chain) {
    if (isDataLayerError(link)) return link;
    const name = nameOf(link);
    if (name === 'NotAllowedError' || name === 'AbortError' || name === 'SecurityError' || name === 'NotSupportedError') {
      return passkeyFailure(link);
    }
    if (name === 'WebAuthnFormatError') {
      return new DataLayerError({ code: 'PasskeyUnavailable' }, field(link, 'message') as string, { cause: error });
    }
    if (name === 'UserRejectedRequestError' || field(link, 'code') === 4001) {
      return new DataLayerError({ code: 'WalletRejected' }, 'The wallet declined the request', { cause: error });
    }
  }
  const data = revertDataOf(error);
  const revert = data === null ? null : decodeRevert(data);
  if (revert !== null) {
    const mapped = revertToDataLayerError(revert, context);
    return new DataLayerError(mapped.detail, mapped.message, { cause: error });
  }
  const message = error instanceof Error ? error.message : String(error);
  return new DataLayerError({ code: 'SourceUnavailable' }, message, { cause: error });
}
