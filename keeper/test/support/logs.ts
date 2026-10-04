import { ADDRESSES, type Address, type Hex, type Receipt, type Rule, RULE_STATUSES, erc20Abi, sleeveModuleAbi } from '@sleeve/core';
import {
  type AbiEvent,
  type Log,
  encodeAbiParameters,
  encodeEventTopics,
  getAbiItem,
  keccak256,
  numberToHex,
  pad,
  stringToHex,
} from 'viem';

import { MODULE_ADDRESS } from '../../src/chain/calls';
import { USER_OPERATION_EVENT_TOPIC } from '../../src/chain/events';
import { encodeReceipt } from '../schema/fixtures';

/**
 * Logs as an RPC returns them, encoded with the deployed module's ABI from packages/core, for tests of the decoders,
 * the chunk processor and the indexer.
 */

export interface Where {
  block: number | bigint;
  index: number;
  tx?: Hex;
}

export function txHash(label: string): Hex {
  return keccak256(stringToHex(label));
}

function base(address: Address, where: Where): Omit<Log, 'data' | 'topics'> {
  const blockNumber = BigInt(where.block);
  return {
    address,
    blockHash: keccak256(stringToHex(`block:${blockNumber}`)),
    blockNumber,
    logIndex: where.index,
    transactionHash: where.tx ?? txHash(`tx:${blockNumber}:${where.index}`),
    transactionIndex: 0,
    removed: false,
  };
}

/** The event's non-indexed inputs, abi-encoded in order: the log's data. */
function eventData(event: AbiEvent, args: Record<string, unknown>): Hex {
  const inputs = event.inputs.filter((input) => input.indexed !== true);
  return encodeAbiParameters(
    inputs,
    inputs.map((input) => args[input.name ?? '']),
  );
}

type ModuleEventName =
  | 'Installed'
  | 'Uninstalled'
  | 'RuleSet'
  | 'RulePaused'
  | 'RuleResumed'
  | 'KeeperSet'
  | 'Observed'
  | 'Reconciled'
  | 'OwnerOpEnded'
  | 'LotsReconciled';

export function moduleLog(eventName: ModuleEventName, args: Record<string, unknown>, where: Where): Log {
  const event = getAbiItem({ abi: sleeveModuleAbi, name: eventName }) as AbiEvent;
  const topics = encodeEventTopics({ abi: [event], eventName, args } as Parameters<typeof encodeEventTopics>[0]);
  return { ...base(MODULE_ADDRESS, where), topics: topics as Log['topics'], data: eventData(event, args) } as Log;
}

export function receiptLog(receipt: Receipt, where: Where): Log {
  const event = getAbiItem({ abi: sleeveModuleAbi, name: 'ReceiptWritten' }) as AbiEvent;
  const status = [
    'FILLED',
    'QUEUED',
    'SETTLED',
    'REFUSED_TICKER',
    'REFUSED_ACCOUNT',
    'RELEASED',
    'PART_SOLD',
    'SOLD',
    'RECONCILED',
  ].indexOf(receipt.status);
  const topics = encodeEventTopics({
    abi: [event],
    eventName: 'ReceiptWritten',
    args: { id: receipt.id, account: receipt.account, status },
  } as Parameters<typeof encodeEventTopics>[0]);
  return { ...base(MODULE_ADDRESS, where), topics: topics as Log['topics'], data: encodeReceipt(receipt) } as Log;
}

export function ruleTuple(rule: Rule): Record<string, unknown> {
  return { ...rule, status: RULE_STATUSES.indexOf(rule.status) };
}

export function transferLog(from: Address, to: Address, amount: bigint, where: Where): Log {
  const event = getAbiItem({ abi: erc20Abi, name: 'Transfer' }) as AbiEvent;
  const topics = encodeEventTopics({ abi: [event], eventName: 'Transfer', args: { from, to } } as Parameters<
    typeof encodeEventTopics
  >[0]);
  return {
    ...base(ADDRESSES.USDG, where),
    topics: topics as Log['topics'],
    data: encodeAbiParameters([{ type: 'uint256' }], [amount]),
  } as Log;
}

/** An EntryPoint UserOperationEvent, which closes one UserOp's logs inside a handleOps transaction. */
export function userOperationLog(sender: Address, where: Where): Log {
  return {
    ...base(ADDRESSES.ENTRY_POINT_V07, where),
    topics: [USER_OPERATION_EVENT_TOPIC, txHash(`op:${where.index}`), pad(sender), pad('0x00')] as Log['topics'],
    data: encodeAbiParameters(
      [{ type: 'uint256' }, { type: 'bool' }, { type: 'uint256' }, { type: 'uint256' }],
      [0n, true, 1n, 1n],
    ),
  } as Log;
}

export function hexNumber(value: number | bigint): Hex {
  return numberToHex(value);
}
