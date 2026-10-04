import { REASONS, type Reason, enumMember, sleeveModuleAbi } from '@sleeve/core';
import { BaseError, ContractFunctionRevertedError, type Hex, decodeErrorResult } from 'viem';

/**
 * What a failed call says. A revert carries the module's error name and arguments when the ABI knows them (the
 * module ABI includes every library error); anything else, such as a timeout or an HTTP error, is an RPC failure and
 * says nothing about the chain.
 */
export type CallFailure =
  | { kind: 'revert'; name: string | null; args: readonly unknown[]; data: Hex | null; message: string }
  | { kind: 'rpc'; message: string };

const HEX_DATA = /^0x([0-9a-fA-F]{2})*$/;

function decodeModuleError(data: Hex): { name: string; args: readonly unknown[] } | null {
  try {
    const decoded = decodeErrorResult({ abi: sleeveModuleAbi, data });
    return { name: decoded.errorName, args: decoded.args ?? [] };
  } catch {
    return null;
  }
}

function errorData(error: BaseError): Hex | null {
  const found = error.walk((inner) => {
    const data = (inner as { data?: unknown }).data;
    return typeof data === 'string' && HEX_DATA.test(data) && data.length >= 10;
  });
  const data = found === null ? undefined : (found as { data?: unknown }).data;
  return typeof data === 'string' ? (data as Hex) : null;
}

export function describeFailure(error: unknown): CallFailure {
  if (!(error instanceof BaseError)) {
    return { kind: 'rpc', message: error instanceof Error ? error.message : String(error) };
  }
  const reverted = error.walk((inner) => inner instanceof ContractFunctionRevertedError);
  if (reverted instanceof ContractFunctionRevertedError) {
    if (reverted.data !== undefined) {
      return {
        kind: 'revert',
        name: reverted.data.errorName,
        args: reverted.data.args ?? [],
        data: reverted.raw ?? null,
        message: reverted.shortMessage,
      };
    }
    const raw = reverted.raw ?? null;
    const decoded = raw === null ? null : decodeModuleError(raw);
    return {
      kind: 'revert',
      name: decoded?.name ?? (reverted.reason === undefined ? null : 'Error'),
      args: decoded?.args ?? (reverted.reason === undefined ? [] : [reverted.reason]),
      data: raw,
      message: reverted.shortMessage,
    };
  }
  const data = errorData(error);
  if (data !== null) {
    const decoded = decodeModuleError(data);
    if (decoded !== null) return { kind: 'revert', ...decoded, data, message: error.shortMessage };
  }
  const details = error.details === undefined || error.details === '' ? '' : ` ${error.details}`;
  return { kind: 'rpc', message: `${error.shortMessage}${details}` };
}

/** The Reason in GuardNotClear(reason) or SellWaits(reason), else null. */
export function guardReason(failure: CallFailure): Reason | null {
  if (failure.kind !== 'revert' || (failure.name !== 'GuardNotClear' && failure.name !== 'SellWaits')) return null;
  const [value] = failure.args;
  if (typeof value !== 'number' && typeof value !== 'bigint') return null;
  try {
    return enumMember(REASONS, value);
  } catch {
    return null;
  }
}

function formatArg(value: unknown): string {
  if (typeof value === 'bigint') return value.toString();
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return `[${value.map(formatArg).join(', ')}]`;
  return String(value);
}

/** One line for logs and keeper_runs.error: the error name with its arguments, or the RPC message. */
export function formatFailure(failure: CallFailure): string {
  if (failure.kind === 'rpc') return `rpc: ${failure.message}`;
  if (failure.name === null) return `reverted: ${failure.data ?? failure.message}`;
  const reason = guardReason(failure);
  const args = reason === null ? failure.args.map(formatArg).join(', ') : reason;
  return `${failure.name}(${args})`;
}
