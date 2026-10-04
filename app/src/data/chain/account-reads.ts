import {
  LOT_STATUSES,
  REASONS,
  RULE_STATUSES,
  STATUSES,
  enumMember,
  sleeveModuleAbi,
  erc20Abi,
  tokenSourceAbi,
  tokenValueUsdg,
  type Rule,
  type TickerId,
} from '@sleeve/core';
import { encodeEventTopics, isAddressEqual, zeroAddress, type Address } from 'viem';

import { ECDSA_VALIDATOR, MODULE_TYPE_EXECUTOR, ecdsaValidatorAbi, kernelAbi, rootValidatorAddress } from '@/lib/chain/kernel';

import { DataLayerError } from '../errors';
import type { AccountOverview, BucketView, Holding, LedgerView, LotView, SplitOutcome, SplitPreview } from '../types';
import { CONTRACTS, type ChainContext } from './context';
import { ruleFromRaw } from './decode';
import type { HistoryReader } from './history';
import type { MarketReader } from './market';

/** Lots a sell or a holding reads at most, from the queue's head (SPEC 12's bound). */
const MAX_LOTS = 100;

export interface OpenLot {
  id: bigint;
  tickerId: TickerId;
  status: (typeof LOT_STATUSES)[number];
  tokensBought: bigint;
  tokensRemaining: bigint;
}

/** One account's module state, read from the live contracts. */
export class AccountReader {
  private grace: Promise<bigint> | null = null;

  constructor(
    private readonly ctx: ChainContext,
    private readonly market: MarketReader,
    private readonly history: HistoryReader,
  ) {}

  private graceSeconds(): Promise<bigint> {
    this.grace ??= this.ctx.client.readContract({ address: CONTRACTS.module, abi: sleeveModuleAbi, functionName: 'grace' });
    return this.grace;
  }

  async overview(account: Address): Promise<AccountOverview> {
    const { client } = this.ctx;
    const code = await client.getCode({ address: account });
    const deployed = code !== undefined && code !== '0x';
    const reads = await client.multicall({
      allowFailure: false,
      contracts: [
        { address: CONTRACTS.module, abi: sleeveModuleAbi, functionName: 'isInitialized', args: [account] },
        { address: CONTRACTS.module, abi: sleeveModuleAbi, functionName: 'keeperOf', args: [account] },
        { address: CONTRACTS.module, abi: sleeveModuleAbi, functionName: 'defaultKeeper' },
        { address: ECDSA_VALIDATOR, abi: ecdsaValidatorAbi, functionName: 'ecdsaValidatorStorage', args: [account] },
      ],
    });
    const [initialized, keeper, defaultKeeper, ecdsaOwner] = reads as [boolean, Address, Address, Address];
    let listed = false;
    let root: Address | null = null;
    if (deployed) {
      const [installed, rootId] = await client.multicall({
        allowFailure: false,
        contracts: [
          { address: account, abi: kernelAbi, functionName: 'isModuleInstalled', args: [MODULE_TYPE_EXECUTOR, CONTRACTS.module, '0x'] },
          { address: account, abi: kernelAbi, functionName: 'rootValidator' },
        ],
      });
      listed = installed;
      root = rootValidatorAddress(rootId);
    }
    const installedAt = initialized ? await this.installedAt(account) : null;
    const rootIsEcdsa = root !== null && isAddressEqual(root, ECDSA_VALIDATOR);
    return {
      address: account,
      deployed,
      moduleInstalled: deployed && initialized && listed,
      installedAt,
      keeper,
      keeperIsDefault: isAddressEqual(keeper, defaultKeeper),
      recoverySigner: !rootIsEcdsa && !isAddressEqual(ecdsaOwner, zeroAddress) ? ecdsaOwner : null,
      accountingMode: 'WRAPPED',
    };
  }

  /** Unix seconds of the latest Installed event, or null. */
  private async installedAt(account: Address): Promise<bigint | null> {
    const head = await this.ctx.client.getBlockNumber({ cacheTime: 1_000 });
    const logs = await this.ctx.logs
      .stream({
        address: CONTRACTS.module,
        topics: encodeEventTopics({ abi: sleeveModuleAbi, eventName: 'Installed', args: { account } }),
      })
      .read(head);
    const last = logs.at(-1);
    return last?.blockNumber == null ? null : this.history.blockTime(last.blockNumber);
  }

  async ledger(account: Address): Promise<LedgerView> {
    const [asOf, reads, grace] = await Promise.all([
      this.market.head(),
      this.ctx.client.multicall({
        allowFailure: false,
        contracts: [
          { address: CONTRACTS.module, abi: sleeveModuleAbi, functionName: 'ledger', args: [account] },
          { address: CONTRACTS.module, abi: sleeveModuleAbi, functionName: 'observationOf', args: [account] },
        ],
      }),
      this.graceSeconds(),
    ]);
    const [balance, spend, pendingTotal, unsorted] = reads[0] as readonly [bigint, bigint, bigint, bigint];
    const [observedAt, observedUnsorted] = reads[1] as readonly [bigint, bigint];
    return {
      balance,
      spend,
      pendingTotal,
      unsorted,
      asOf,
      observation: observedAt === 0n ? null : { observedAt, observedUnsorted, graceEndsAt: observedAt + grace },
    };
  }

  async rule(account: Address): Promise<Rule> {
    const raw = await this.ctx.client.readContract({
      address: CONTRACTS.module,
      abi: sleeveModuleAbi,
      functionName: 'ruleOf',
      args: [account],
    });
    return ruleFromRaw(raw);
  }

  /**
   * Ticker ids whose bucket holds USDG, ascending: what a removal releases in its own batch (D-040). Reads only the
   * TokenSource count and the buckets, never the market, so a removal does not wait on feeds or pools.
   */
  async waitingTickerIds(account: Address): Promise<TickerId[]> {
    const { client } = this.ctx;
    const count = await client.readContract({ address: CONTRACTS.tokenSource, abi: tokenSourceAbi, functionName: 'tickerCount' });
    const ids = Array.from({ length: Number(count) }, (_, index) => index);
    const reads = await client.multicall({
      allowFailure: false,
      contracts: ids.map((id) => ({ address: CONTRACTS.module, abi: sleeveModuleAbi, functionName: 'bucketOf', args: [account, id] }) as const),
    });
    return ids.filter((_, index) => (reads[index] as { amount: bigint }).amount > 0n);
  }

  async buckets(account: Address): Promise<BucketView[]> {
    const tickers = await this.market.tickers();
    const reads = await this.ctx.client.multicall({
      allowFailure: false,
      contracts: tickers.map(
        (ticker) => ({ address: CONTRACTS.module, abi: sleeveModuleAbi, functionName: 'bucketOf', args: [account, ticker.id] }) as const,
      ),
    });
    return tickers
      .map((ticker, index) => {
        const bucket = reads[index] as { amount: bigint; since: bigint; reason: number };
        return { tickerId: ticker.id, amount: bucket.amount, since: bucket.since, reason: enumMember(REASONS, bucket.reason) };
      })
      .filter((bucket) => bucket.amount > 0n);
  }

  async previewSplit(account: Address): Promise<SplitPreview> {
    const [asOf, raw] = await Promise.all([
      this.market.head(),
      this.ctx.client.readContract({ address: CONTRACTS.module, abi: sleeveModuleAbi, functionName: 'previewSplit', args: [account] }),
    ]);
    const ruleStatus = enumMember(RULE_STATUSES, raw.ruleStatus);
    const status = enumMember(STATUSES, raw.status);
    const reason = enumMember(REASONS, raw.reason);
    let outcome: SplitOutcome | null = null;
    if (ruleStatus === 'ACTIVE' && raw.unsorted > 0n) {
      if (status === 'REFUSED_TICKER' || status === 'REFUSED_ACCOUNT') outcome = { kind: 'REFUSE', status };
      else if (raw.buy) outcome = { kind: 'BUY' };
      else outcome = { kind: 'QUEUE', reason };
    }
    return {
      asOf,
      ruleStatus,
      tickerId: raw.tickerId,
      shortfall: raw.shortfall,
      unsorted: raw.unsorted,
      spendPart: raw.spendPart,
      equityPart: raw.equityPart,
      outcome,
    };
  }

  /** The account's open lots of one ticker from the queue's head, oldest first, at most 100. */
  async openLots(account: Address, tickerId: TickerId): Promise<OpenLot[]> {
    const [lotIds, head] = await this.ctx.client.readContract({
      address: CONTRACTS.module,
      abi: sleeveModuleAbi,
      functionName: 'lotsOf',
      args: [account, tickerId],
    });
    const ids = lotIds.slice(Number(head));
    if (ids.length === 0) return [];
    const lots = await this.ctx.client.multicall({
      allowFailure: false,
      contracts: ids.map((id) => ({ address: CONTRACTS.module, abi: sleeveModuleAbi, functionName: 'lot', args: [id] }) as const),
    });
    const open: OpenLot[] = [];
    ids.forEach((id, index) => {
      const lot = lots[index] as { account: Address; tickerId: number; status: number; tokensBought: bigint; tokensRemaining: bigint };
      if (lot.tokensRemaining === 0n || open.length >= MAX_LOTS) return;
      open.push({
        id,
        tickerId: lot.tickerId,
        status: enumMember(LOT_STATUSES, lot.status),
        tokensBought: lot.tokensBought,
        tokensRemaining: lot.tokensRemaining,
      });
    });
    return open;
  }

  async holdings(account: Address): Promise<Holding[]> {
    const [tickers, market] = await Promise.all([this.market.tickers(), this.market.snapshot()]);
    const balances = await this.ctx.client.multicall({
      allowFailure: false,
      contracts: tickers.map((ticker) => ({ address: ticker.token, abi: erc20Abi, functionName: 'balanceOf', args: [account] }) as const),
    });
    const lotsByTicker = await Promise.all(tickers.map((ticker) => this.openLots(account, ticker.id)));
    const buys = await this.history.receiptLogs(lotsByTicker.flat().map((lot) => lot.id));
    const buyById = new Map(buys.map((entry) => [entry.receipt.id, entry.receipt]));

    const holdings: Holding[] = [];
    tickers.forEach((ticker, index) => {
      const balance = balances[index] as bigint;
      const lots: LotView[] = (lotsByTicker[index] ?? []).map((lot) => {
        const bought = buyById.get(lot.id);
        if (bought === undefined) {
          throw new DataLayerError({ code: 'SourceUnavailable' }, `The receipt of lot ${lot.id} did not read back`);
        }
        return {
          id: lot.id,
          account,
          tickerId: lot.tickerId,
          status: lot.status,
          tokensBought: lot.tokensBought,
          tokensRemaining: lot.tokensRemaining,
          boughtAt: bought.timestamp,
          usdgSpent: bought.usdgSpent,
          execPrice: bought.execPrice,
          premiumBps: bought.premiumBps,
          uiMultiplierAtFill: bought.uiMultiplier,
        };
      });
      if (balance === 0n && lots.length === 0) return;
      const feed = market.tickers.find((entry) => entry.tickerId === ticker.id)?.feed;
      if (feed === undefined) throw new DataLayerError({ code: 'SourceUnavailable' }, `No feed reading for ticker ${ticker.id}`);
      holdings.push({
        tickerId: ticker.id,
        balance,
        inLots: lots.reduce((total, lot) => total + lot.tokensRemaining, 0n),
        value: tokenValueUsdg(balance, feed.answer),
        feed,
        lots,
      });
    });
    return holdings;
  }
}
