import {
  DISCLOSURE,
  PUBLIC_RPC_URL,
  aggregatorV3Abi,
  discountBps,
  erc20Abi,
  execPriceBuy,
  execPriceSell,
  premiumBps,
  sleeveModuleAbi,
  tokenSourceAbi,
  type Receipt,
} from '@sleeve/core';
import {
  BaseError,
  ContractFunctionRevertedError,
  HttpRequestError,
  createPublicClient,
  decodeEventLog,
  encodeEventTopics,
  isAddressEqual,
  type Address,
  type Log,
  type PublicClient,
} from 'viem';

import { sleeveChain } from '@/lib/chain/chain';
import { readChainConfig } from '@/lib/chain/config';
import { serialHttp } from '@/lib/chain/transport';

import type { ReceiptRecord, VerifyCheck, VerifyResult, VerifyUnit } from '../types';
import { CONTRACTS, createChainContext } from './context';
import { decodeReceiptLog, receiptHashOf, type ReceiptLog } from './decode';
import { HistoryReader, recordOf } from './history';

/**
 * The verifier's recomputation (PRD 10, D-009 Q36) against public chain data, on the public RPC so it never shares a
 * provider with the keeper (D-008, D-012): the receipt against its stored hash, the transaction's Transfer logs, the
 * feed rounds as getRoundData serves them now, and the shared price arithmetic. Every check is listed whether it
 * passes or not; a mismatch is shown, never smoothed.
 */

const TRANSFER_TOPIC = encodeEventTopics({ abi: erc20Abi, eventName: 'Transfer' })[0];

interface CheckInput {
  id: string;
  label: string;
  unit: VerifyUnit;
  source: string;
  expected: bigint | string;
  actual: bigint | string;
  ok?: boolean;
}

function check(input: CheckInput): VerifyCheck {
  const expected = String(input.expected);
  const actual = String(input.actual);
  return { id: input.id, label: input.label, unit: input.unit, source: input.source, expected, actual, ok: input.ok ?? expected === actual };
}

interface Transfer {
  token: Address;
  from: Address;
  to: Address;
  amount: bigint;
}

function transfers(logs: readonly Log[]): Transfer[] {
  return logs
    .filter((log) => log.topics[0] === TRANSFER_TOPIC && log.topics.length === 3)
    .map((log) => {
      const decoded = decodeEventLog({ abi: erc20Abi, eventName: 'Transfer', data: log.data, topics: log.topics });
      return { token: log.address, from: decoded.args.from, to: decoded.args.to, amount: decoded.args.value };
    });
}

function sum(list: readonly Transfer[], token: Address, from: Address, to: Address): bigint {
  return list
    .filter((item) => isAddressEqual(item.token, token) && isAddressEqual(item.from, from) && isAddressEqual(item.to, to))
    .reduce((total, item) => total + item.amount, 0n);
}

export class ChainVerifier {
  private readonly client: PublicClient;
  private readonly history: HistoryReader;

  constructor(client?: PublicClient) {
    this.client =
      client ??
      createPublicClient({ chain: sleeveChain, transport: serialHttp(PUBLIC_RPC_URL), batch: { multicall: true } });
    this.history = new HistoryReader(createChainContext(readChainConfig({}), this.client));
  }

  private async feedOf(tickerId: number): Promise<Address> {
    const [, feed] = await this.client.readContract({
      address: CONTRACTS.tokenSource,
      abi: tokenSourceAbi,
      functionName: 'ticker',
      args: [tickerId],
    });
    return feed;
  }

  private async round(feed: Address, roundId: bigint): Promise<{ answer: bigint; updatedAt: bigint } | null> {
    try {
      const [, answer, , updatedAt] = await this.client.readContract({
        address: feed,
        abi: aggregatorV3Abi,
        functionName: 'getRoundData',
        args: [roundId],
      });
      return { answer, updatedAt };
    } catch (error) {
      // Only a revert means the feed has no such round, which the check then shows as missing. Anything else is the
      // provider, and the whole verification reports it.
      if (error instanceof BaseError && error.walk((inner) => inner instanceof ContractFunctionRevertedError) !== null) return null;
      throw error;
    }
  }

  private async roundChecks(receipt: Receipt): Promise<VerifyCheck[]> {
    const checks: VerifyCheck[] = [];
    if (receipt.roundId !== 0n) {
      const round = await this.round(await this.feedOf(receipt.tickerId), receipt.roundId);
      checks.push(
        check({ id: 'feed-answer', label: 'Feed answer for the round', unit: 'feed', source: 'getRoundData', expected: round?.answer ?? 'missing', actual: receipt.answer }),
        check({ id: 'feed-updated-at', label: 'Feed round time', unit: 'timestamp', source: 'getRoundData', expected: round?.updatedAt ?? 'missing', actual: receipt.updatedAt }),
      );
    }
    if (receipt.usdgRoundId !== 0n) {
      const round = await this.round(CONTRACTS.usdgUsdFeed, receipt.usdgRoundId);
      checks.push(
        check({ id: 'usdg-answer', label: 'USDG/USD answer for the round', unit: 'feed', source: 'getRoundData', expected: round?.answer ?? 'missing', actual: receipt.usdgAnswer }),
      );
    }
    return checks;
  }

  private conservation(receipt: Receipt): VerifyCheck {
    return check({
      id: 'conservation',
      label: 'USDG in equals spend plus spent plus queued',
      unit: 'usdg',
      source: 'Receipt fields',
      expected: receipt.usdgIn,
      actual: receipt.usdgToSpend + receipt.usdgSpent + receipt.usdgQueued,
    });
  }

  private async buyChecks(record: ReceiptRecord, logs: readonly Log[]): Promise<VerifyCheck[]> {
    const { receipt } = record;
    const moved = transfers(logs);
    const checks: VerifyCheck[] = [
      ...(receipt.usdgIn > 0n ? [this.conservation(receipt)] : []),
      check({ id: 'usdg-spent', label: 'USDG that left the account', unit: 'usdg', source: 'Transfer log', expected: sum(moved, CONTRACTS.usdg, receipt.account, receipt.pool), actual: receipt.usdgSpent }),
      check({ id: 'tokens-out', label: 'Stock Tokens that arrived', unit: 'token', source: 'Transfer log', expected: sum(moved, receipt.token, receipt.pool, receipt.account), actual: receipt.tokensOut }),
      ...(await this.roundChecks(receipt)),
    ];
    if (receipt.tokensOut === 0n || receipt.answer <= 0n) return checks;
    const premium = premiumBps(receipt.usdgSpent, receipt.tokensOut, receipt.answer);
    checks.push(
      check({ id: 'exec-price', label: 'Execution price', unit: 'usdg', source: 'Recomputed from the amounts', expected: execPriceBuy(receipt.usdgSpent, receipt.tokensOut), actual: receipt.execPrice }),
      check({ id: 'premium', label: 'Premium over the feed price', unit: 'bps', source: 'Recomputed from the amounts and the round', expected: premium, actual: receipt.premiumBps }),
    );
    const cap = record.derived.rule?.premiumCapBps;
    if (cap !== undefined) {
      checks.push(
        check({ id: 'premium-cap', label: 'Premium within the rule cap', unit: 'bps', source: 'Rule version on the receipt', expected: BigInt(cap), actual: premium, ok: premium <= BigInt(cap) }),
      );
    }
    return checks;
  }

  /** SPEC 13: a sell's receipts are the run of consecutive PART_SOLD and SOLD receipts sharing the whole-sell fields. */
  private async sellChecks(entry: ReceiptLog, logs: readonly Log[]): Promise<VerifyCheck[]> {
    const { receipt } = entry;
    const sameSell = (other: Receipt) =>
      (other.status === 'PART_SOLD' || other.status === 'SOLD') &&
      isAddressEqual(other.account, receipt.account) &&
      other.tickerId === receipt.tickerId &&
      other.execPrice === receipt.execPrice &&
      other.roundId === receipt.roundId &&
      other.quote === receipt.quote &&
      isAddressEqual(other.pool, receipt.pool);
    const inTx = logs
      .filter((log) => isAddressEqual(log.address, CONTRACTS.module))
      .flatMap((log) => (log.topics[0] === RECEIPT_WRITTEN_TOPIC ? [decodeReceiptLog(log).receipt] : []))
      .sort((a, b) => (a.id < b.id ? -1 : 1));
    const at = inTx.findIndex((other) => other.id === receipt.id);
    let start = at;
    while (start > 0 && sameSell(inTx[start - 1]!) && inTx[start - 1]!.id === inTx[start]!.id - 1n) start -= 1;
    let end = at;
    while (end + 1 < inTx.length && sameSell(inTx[end + 1]!) && inTx[end + 1]!.id === inTx[end]!.id + 1n) end += 1;
    const run = at < 0 ? [receipt] : inTx.slice(start, end + 1);
    const tokensIn = run.reduce((total, other) => total + other.tokensIn, 0n);
    const usdgOut = run.reduce((total, other) => total + other.usdgOut, 0n);
    const moved = transfers(logs);
    const checks: VerifyCheck[] = [
      check({ id: 'tokens-in', label: 'Stock Tokens sold in this sell', unit: 'token', source: 'Transfer log', expected: sum(moved, receipt.token, receipt.account, receipt.pool), actual: tokensIn }),
      check({ id: 'usdg-out', label: 'USDG received in this sell', unit: 'usdg', source: 'Transfer log', expected: sum(moved, CONTRACTS.usdg, receipt.pool, receipt.account), actual: usdgOut }),
      check({ id: 'to-spend', label: 'Proceeds credited to spend', unit: 'usdg', source: 'Receipt fields', expected: receipt.usdgOut, actual: receipt.usdgToSpend }),
      ...(await this.roundChecks(receipt)),
    ];
    if (tokensIn === 0n || receipt.answer <= 0n) return checks;
    checks.push(
      check({ id: 'exec-price', label: 'Execution price', unit: 'usdg', source: 'Recomputed from the amounts', expected: execPriceSell(usdgOut, tokensIn), actual: receipt.execPrice }),
      check({ id: 'premium', label: 'Discount against the feed', unit: 'bps', source: 'Recomputed from the amounts and the round', expected: discountBps(usdgOut, tokensIn, receipt.answer), actual: receipt.premiumBps }),
    );
    return checks;
  }

  private reconcileCheck(record: ReceiptRecord): VerifyCheck {
    const reconciliation = record.reconciliation;
    const cut =
      reconciliation === null ? 'missing' : reconciliation.fromSpend + reconciliation.fromBuckets.reduce((total, part) => total + part.amount, 0n);
    return check({
      id: 'reconcile',
      label: 'Ledger cuts cover the shortfall',
      unit: 'usdg',
      source: 'Reconciled event',
      expected: reconciliation?.shortfall ?? 'missing',
      actual: cut,
      ok: reconciliation !== null && reconciliation.shortfall === cut,
    });
  }

  async verify(id: bigint, now: bigint): Promise<VerifyResult> {
    const base = { receiptId: id, checkedAt: now, rpcUrl: PUBLIC_RPC_URL };
    try {
      const entry = await this.history.receiptLog(id);
      if (entry === null) return { ...base, status: 'NOT_FOUND', storedHash: null, recomputedHash: null, checks: [] };
      const { receipt } = entry;
      const history = await this.history.history(receipt.account);
      const stored = (await this.history.storedHashes([id])).get(id) ?? entry.dataHash;
      const record = recordOf(entry, stored, history);
      const recomputedHash = receiptHashOf(receipt);
      const tx = await this.client.getTransactionReceipt({ hash: entry.txHash });
      const statusChecks: VerifyCheck[] = await (async () => {
        switch (receipt.status) {
          case 'FILLED':
          case 'SETTLED':
            return this.buyChecks(record, tx.logs);
          case 'PART_SOLD':
          case 'SOLD':
            return this.sellChecks(entry, tx.logs);
          case 'QUEUED':
            return [this.conservation(receipt), ...(await this.roundChecks(receipt))];
          case 'REFUSED_TICKER':
          case 'REFUSED_ACCOUNT':
          case 'RELEASED':
            return receipt.usdgIn > 0n ? [this.conservation(receipt)] : [];
          case 'RECONCILED':
            return receipt.lotId === 0n ? [this.reconcileCheck(record)] : [];
        }
      })();
      const checks = [
        check({ id: 'receipt-hash', label: 'Receipt hash', unit: 'hash', source: 'receiptHash(id)', expected: stored, actual: recomputedHash }),
        check({ id: 'log-hash', label: 'Receipt log matches the stored hash', unit: 'hash', source: 'ReceiptWritten log', expected: stored, actual: entry.dataHash }),
        ...statusChecks,
        check({ id: 'disclosure-hash', label: 'Issuer disclosure hash', unit: 'hash', source: 'keccak256 of the served disclosure', expected: DISCLOSURE.keccak256, actual: receipt.disclosureHash }),
      ];
      return { ...base, status: checks.every((item) => item.ok) ? 'MATCH' : 'MISMATCH', storedHash: stored, recomputedHash, checks };
    } catch (error) {
      if (error instanceof HttpRequestError || isProviderRefusal(error)) {
        return { ...base, status: 'PROVIDER_BLOCKED', storedHash: null, recomputedHash: null, checks: [] };
      }
      throw error;
    }
  }
}

const RECEIPT_WRITTEN_TOPIC = encodeEventTopics({ abi: sleeveModuleAbi, eventName: 'ReceiptWritten' })[0];

function isProviderRefusal(error: unknown): boolean {
  let current: unknown = error;
  for (let depth = 0; current !== null && typeof current === 'object' && depth < 8; depth += 1) {
    if (current instanceof HttpRequestError) return true;
    current = (current as { cause?: unknown }).cause;
  }
  return false;
}
