import {
  MODULE_PARAMS,
  PRICE_UNIT,
  RULE_LIMITS,
  TOTAL_BPS,
  accessControlsRegistryAbi,
  discountBps,
  exceedsDiscount,
  minOutForSell,
  erc20Abi,
  type Reason,
  type Rule,
} from '@sleeve/core';
import { ADDRESSES } from '@sleeve/core';
import type { Address } from 'viem';

import { DataLayerError } from '../errors';
import type { MarketSnapshot, SellBlock, SellQuote, SellRequest, TickerMarket } from '../types';
import type { AccountReader, OpenLot } from './account-reads';
import { CONTRACTS, type ChainContext } from './context';
import { feedIsStale, quoterViewAbi, type ListedTicker, type MarketReader } from './market';

/**
 * What a sell would do now (SPEC 12, B2-13, B2-14), from the live contracts: the lots it draws from, the best quote
 * over the ticker's allowlisted pools, the discount against the feed, and the guard in the sell's own order. It never
 * moves anything. The sell itself simulates the exact batch before the owner signs, so a check the quote cannot see
 * (a blocked pool or router) is still named before anything is sent.
 */

export interface SellPlan {
  quote: SellQuote;
  ticker: ListedTicker;
  rule: Rule;
  market: TickerMarket;
}

function depegged(snapshot: MarketSnapshot): boolean {
  const { answer, updatedAt } = snapshot.usdgUsd;
  const now = snapshot.asOf.timestamp;
  if (answer <= 0n || updatedAt > now || now - updatedAt > MODULE_PARAMS.usdgFeedMaxAgeSeconds) return true;
  const par = 100_000_000n;
  const gap = answer > par ? answer - par : par - answer;
  return gap * BigInt(TOTAL_BPS) > BigInt(MODULE_PARAMS.depegToleranceBps) * par;
}

/** The first guard step that refuses a sell with or without the override (SPEC 12 step 5.2). */
function blockingReason(market: TickerMarket, snapshot: MarketSnapshot): Reason | null {
  if (market.paused) return 'PAUSED';
  if (market.oraclePaused) return 'ORACLE_PAUSED';
  const pending = market.pendingMultiplier;
  if (pending !== null && pending.effectiveAt <= snapshot.asOf.timestamp + MODULE_PARAMS.multiplierWindowSeconds) return 'MULTIPLIER';
  if (depegged(snapshot)) return 'DEPEG';
  return null;
}

function draw(lots: readonly OpenLot[], request: SellRequest): { lots: { lotId: bigint; tokens: bigint }[]; covered: boolean; available: bigint } {
  const candidates = request.lotId === 0n ? lots : lots.filter((lot) => lot.id === request.lotId);
  const available = candidates.reduce((total, lot) => total + lot.tokensRemaining, 0n);
  const drawn: { lotId: bigint; tokens: bigint }[] = [];
  let remaining = request.amount;
  for (const lot of candidates) {
    if (remaining === 0n) break;
    const tokens = remaining < lot.tokensRemaining ? remaining : lot.tokensRemaining;
    drawn.push({ lotId: lot.id, tokens });
    remaining -= tokens;
  }
  return { lots: drawn, covered: remaining === 0n && request.amount > 0n, available };
}

export async function planSell(
  ctx: ChainContext,
  market: MarketReader,
  accounts: AccountReader,
  account: Address,
  request: SellRequest,
): Promise<SellPlan> {
  const [ticker, snapshot, rule, lots] = await Promise.all([
    market.ticker(request.tickerId),
    market.snapshot(),
    accounts.rule(account),
    accounts.openLots(account, request.tickerId),
  ]);
  const tickerMarket = snapshot.tickers.find((entry) => entry.tickerId === request.tickerId);
  if (tickerMarket === undefined) throw new DataLayerError({ code: 'NotFound' }, `No market reading for ticker ${request.tickerId}`);
  if (ticker.pools.length === 0) throw new DataLayerError({ code: 'NotFound' }, `Ticker ${request.tickerId} has no allowlisted pool`);

  const [balance, accountBlocked, quotes] = await Promise.all([
    ctx.client.readContract({ address: ticker.token, abi: erc20Abi, functionName: 'balanceOf', args: [account] }),
    ctx.client.readContract({
      address: ADDRESSES.ACCESS_CONTROLS_REGISTRY,
      abi: accessControlsRegistryAbi,
      functionName: 'isBlocked',
      args: [account],
    }),
    request.amount > 0n
      ? ctx.client.multicall({
          allowFailure: true,
          contracts: ticker.pools.map(
            (pool) =>
              ({
                address: CONTRACTS.quoter,
                abi: quoterViewAbi,
                functionName: 'quoteExactInputSingle',
                args: [{ tokenIn: ticker.token, tokenOut: CONTRACTS.usdg, amountIn: request.amount, fee: pool.fee, sqrtPriceLimitX96: 0n }],
              }) as const,
          ),
        })
      : Promise.resolve([]),
  ]);
  // The allowlisted pool that pays the most USDG for this amount; a pool that cannot quote is passed over.
  let chosen: { pool: Address; usdgOut: bigint } = { pool: ticker.pools[0]!.address, usdgOut: 0n };
  for (const [index, pool] of ticker.pools.entries()) {
    const answer = quotes[index];
    if (answer?.status !== 'success') continue;
    const usdgOut = answer.result[0];
    if (usdgOut > chosen.usdgOut) chosen = { pool: pool.address, usdgOut };
  }

  const feed = tickerMarket.feed;
  const capBps = request.overrideCapBps > 0 ? request.overrideCapBps : rule.premiumCapBps;
  const drawn = draw(lots, request);
  const priced = request.amount > 0n && chosen.usdgOut > 0n && feed.answer > 0n;
  const quote = request.amount > 0n ? (chosen.usdgOut * PRICE_UNIT) / request.amount : 0n;
  const minOut = priced ? minOutForSell(request.amount, quote, rule.slippageBps) : 0n;
  const discount = priced ? discountBps(chosen.usdgOut, request.amount, feed.answer) : 0n;

  const overrideValid =
    Number.isInteger(request.overrideCapBps) &&
    (request.overrideCapBps === 0 ||
      (request.overrideCapBps >= rule.premiumCapBps && request.overrideCapBps <= RULE_LIMITS.sellOverrideCapBpsMax));
  const guard = blockingReason(tickerMarket, snapshot);
  let blocked: SellBlock | null = null;
  if (!overrideValid) blocked = { code: 'OverrideCapOutOfRange', maxBps: RULE_LIMITS.sellOverrideCapBpsMax };
  else if (!drawn.covered || balance < request.amount) {
    blocked = { code: 'ExceedsLots', available: drawn.available < balance ? drawn.available : balance };
  } else if (accountBlocked) blocked = { code: 'AccountBlocked' };
  else if (guard !== null) blocked = { code: 'GuardNotClear', reason: guard };
  else if (!priced) blocked = { code: 'GuardNotClear', reason: 'STALE' };
  else if (exceedsDiscount(chosen.usdgOut, request.amount, feed.answer, capBps)) {
    blocked = { code: 'DiscountAboveCap', discountBps: discount, capBps };
  }

  let waits: SellQuote['waits'] = null;
  if (!request.overrideClosed) {
    if (!tickerMarket.session.open) waits = { reason: 'SESSION', reopensAt: tickerMarket.session.nextOpenAt };
    else if (feedIsStale(feed, snapshot.asOf.timestamp, tickerMarket.session.openedAt)) waits = { reason: 'STALE', reopensAt: null };
  }

  return {
    ticker,
    rule,
    market: tickerMarket,
    quote: {
      request,
      pool: chosen.pool,
      quote,
      expectedUsdgOut: chosen.usdgOut,
      minOut,
      discountBps: discount,
      capBps,
      feed,
      lots: drawn.lots,
      waits,
      blocked,
    },
  };
}

/** The named error for a quote that cannot run as asked, or that waits without the override. */
export function sellRefusal(quote: SellQuote): DataLayerError | null {
  const block = quote.blocked;
  if (block !== null) {
    if (block.code === 'GuardNotClear') {
      return new DataLayerError({ code: 'GuardNotClear', reason: block.reason }, `A guard check did not clear: ${block.reason}`);
    }
    return new DataLayerError({ code: block.code }, `The sell cannot run: ${block.code}`);
  }
  if (quote.waits !== null) {
    return new DataLayerError(
      { code: 'SellWaits', reason: quote.waits.reason, reopensAt: quote.waits.reopensAt },
      'The market reference is not live, so the sell waits',
    );
  }
  return null;
}
