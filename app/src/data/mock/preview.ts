import {
  LAUNCH_TICKERS,
  TOTAL_BPS,
  ZERO_ADDRESS,
  exceedsPremium,
  minOutForBuy,
  validateRuleInput,
  type Rule,
  type TickerId,
} from '@sleeve/core';

import type { DataLayerErrorDetail } from '../errors';
import type {
  ActionPreview,
  NetworkFee,
  OwnerAction,
  OwnerActionKind,
  PreviewBlock,
  PreviewLeg,
  PreviewPrice,
  PreviewWarning,
  SellBlock,
  SellRequest,
  WithdrawRequest,
} from '../types';
import {
  buyFill,
  checkSettle,
  contextAtClock,
  outflowSources,
  previewOutcome,
  quoteSell,
  shortfallOf,
  unsortedOf,
  type GuardContext,
  type MockAccount,
  type MockWorld,
} from './engine';

/** docs/FUNDING.md: the gas price the funding plan and docs/GAS.md price every call at. */
const GAS_PRICE_WEI = 31_610_000n;

/**
 * Gas for each owner UserOp. Measured figures come from docs/GAS.md (actualGasUsed of a bracketed owner UserOp); the
 * others are estimates from the nearest measured call, because no fork test has run them as a whole UserOp yet.
 */
const USER_OP_GAS: Record<OwnerActionKind | 'splitWaits', bigint> = {
  /** Estimate: a USDG transfer inside the owner brackets. */
  withdraw: 290_000n,
  /** Measured: sell SOLD, one lot, in a bracketed owner UserOp. */
  sell: 695_926n,
  /** Measured: release in a bracketed owner UserOp. */
  release: 375_809n,
  /** Estimate: the settle module call, 522,261, plus the owner UserOp overhead the split measurement shows. */
  settle: 765_000n,
  /** Measured: split FILLED on SPY in a bracketed owner UserOp. */
  split: 767_702n,
  /** Estimate: a split that stops at the guard, 238,510 to 304,236 for the module call, plus the UserOp overhead. */
  splitWaits: 480_000n,
  /** Estimates: one module storage write inside the owner brackets. */
  setRule: 260_000n,
  pauseRule: 230_000n,
  resumeRule: 230_000n,
};

function fee(gas: bigint): NetworkFee {
  return { gas, gasPriceWei: GAS_PRICE_WEI, wei: gas * GAS_PRICE_WEI, sponsored: true };
}

const USDG = { kind: 'USDG' } as const;

function stockToken(tickerId: TickerId) {
  return { kind: 'STOCK_TOKEN', tickerId } as const;
}

interface Draft {
  legs: PreviewLeg[];
  price: PreviewPrice | null;
  rule: ActionPreview['rule'];
  gas: bigint;
  warnings: PreviewWarning[];
  blocked: PreviewBlock | null;
}

function draft(gas: bigint, fields: Partial<Omit<Draft, 'gas'>> = {}): Draft {
  return { legs: [], price: null, rule: null, warnings: [], blocked: null, gas, ...fields };
}

interface PricedBuy {
  price: PreviewPrice;
  tokens: bigint;
  /** Token units per 1e6 USDG base units, the trigger's quote. */
  quote: bigint;
}

/** A buy of `usdg` at the pool's price now, set against the reference and the rule's cap. Null without a live answer. */
function buyPrice(tickerId: TickerId, usdg: bigint, ctx: GuardContext, capBps: number): PricedBuy | null {
  if (usdg <= 0n || ctx.feed.answer <= 0n) return null;
  const fill = buyFill(usdg, ctx.feed.answer, ctx.venue.buyPremiumBps);
  return {
    price: {
      side: 'BUY',
      tickerId,
      execPrice: fill.execPrice,
      reference: ctx.feed,
      differenceBps: fill.premiumBps,
      capBps,
      withinCap: !exceedsPremium(usdg, fill.tokensOut, ctx.feed.answer, capBps),
    },
    tokens: fill.tokensOut,
    quote: fill.quote,
  };
}

function previewWithdraw(account: MockAccount, request: WithdrawRequest): Draft {
  const result = draft(USER_OP_GAS.withdraw);
  if (request.amount <= 0n) return { ...result, blocked: { code: 'ZeroAmount' } };
  const to = request.to.toLowerCase();
  if (to === ZERO_ADDRESS) return { ...result, blocked: { code: 'InvalidDestination', reason: 'ZERO' } };
  if (to === account.address.toLowerCase()) return { ...result, blocked: { code: 'InvalidDestination', reason: 'SELF' } };
  const sources = outflowSources(account, request.amount);
  const outside = { kind: 'outside', address: request.to } as const;
  if (sources === null) {
    return {
      ...result,
      legs: [{ from: { kind: 'spend' }, to: outside, sends: { asset: USDG, amount: request.amount }, receives: null }],
      blocked: { code: 'InsufficientBalance', balance: account.usdgBalance, needed: request.amount },
    };
  }
  const legs: PreviewLeg[] = [];
  const warnings: PreviewWarning[] = [];
  if (sources.spend > 0n) legs.push({ from: { kind: 'spend' }, to: outside, sends: { asset: USDG, amount: sources.spend }, receives: null });
  if (sources.unsorted > 0n) {
    legs.push({ from: { kind: 'unsorted' }, to: outside, sends: { asset: USDG, amount: sources.unsorted }, receives: null });
    warnings.push({ code: 'SENDS_UNSORTED', amount: sources.unsorted });
  }
  for (const bucket of sources.buckets) {
    legs.push({
      from: { kind: 'waiting', tickerId: bucket.tickerId },
      to: outside,
      sends: { asset: USDG, amount: bucket.amount },
      receives: null,
    });
    warnings.push({ code: 'SENDS_WAITING', tickerId: bucket.tickerId, amount: bucket.amount });
  }
  return { ...result, legs, warnings };
}

function sellBlockDetail(block: SellBlock): DataLayerErrorDetail {
  return block.code === 'GuardNotClear' ? { code: 'GuardNotClear', reason: block.reason } : { code: block.code };
}

function previewSell(world: MockWorld, account: MockAccount, request: SellRequest): Draft {
  const ctx = contextAtClock(world, account, request.tickerId);
  const quote = quoteSell(world, account, request, ctx);
  const legs: PreviewLeg[] = [
    {
      from: { kind: 'holding', tickerId: request.tickerId },
      to: { kind: 'spend' },
      sends: { asset: stockToken(request.tickerId), amount: request.amount },
      receives: { asset: USDG, amount: quote.expectedUsdgOut, minimum: quote.minOut },
    },
  ];
  const price: PreviewPrice | null =
    quote.quote > 0n
      ? {
          side: 'SELL',
          tickerId: request.tickerId,
          execPrice: quote.quote,
          reference: quote.feed,
          differenceBps: quote.discountBps,
          capBps: quote.capBps,
          withinCap: quote.discountBps <= BigInt(quote.capBps),
        }
      : null;
  const warnings: PreviewWarning[] = [];
  if (request.overrideClosed && !ctx.sessionOpen) warnings.push({ code: 'SKIPS_MARKET_WAIT', reopensAt: ctx.reopensAt });
  if (request.overrideCapBps > account.rule.premiumCapBps) {
    warnings.push({ code: 'WIDER_CAP', capBps: request.overrideCapBps, ruleCapBps: account.rule.premiumCapBps });
  }
  let blocked: PreviewBlock | null = null;
  if (quote.blocked !== null) blocked = sellBlockDetail(quote.blocked);
  else if (quote.waits !== null) blocked = { code: 'SellWaits', reason: quote.waits.reason, reopensAt: quote.waits.reopensAt };
  return draft(USER_OP_GAS.sell, { legs, price, warnings, blocked });
}

function previewRelease(account: MockAccount, tickerId: TickerId): Draft {
  const bucket = account.buckets.get(tickerId);
  if (bucket === undefined || bucket.amount === 0n) return draft(USER_OP_GAS.release, { blocked: { code: 'NothingWaiting' } });
  return draft(USER_OP_GAS.release, {
    legs: [{ from: { kind: 'waiting', tickerId }, to: { kind: 'spend' }, sends: { asset: USDG, amount: bucket.amount }, receives: null }],
    warnings: [{ code: 'RELEASE_ENDS_WAIT', tickerId }],
  });
}

function previewSettle(world: MockWorld, account: MockAccount, tickerId: TickerId): Draft {
  const ctx = contextAtClock(world, account, tickerId);
  const check = checkSettle(account, tickerId, ctx);
  const bucket = account.buckets.get(tickerId);
  const waiting = { kind: 'waiting', tickerId } as const;
  if (check.kind === 'REFUSE') {
    return draft(USER_OP_GAS.settle, {
      legs: [{ from: waiting, to: { kind: 'spend' }, sends: { asset: USDG, amount: check.amount }, receives: null }],
      warnings: [{ code: 'EQUITY_TO_SPEND', tickerId, status: check.status }],
    });
  }
  const amount = check.kind === 'BUY' ? check.amount : (bucket?.amount ?? 0n);
  const priced = buyPrice(tickerId, amount, ctx, account.rule.premiumCapBps);
  const legs: PreviewLeg[] =
    amount > 0n
      ? [
          {
            from: waiting,
            to: { kind: 'holding', tickerId },
            sends: { asset: USDG, amount },
            receives:
              priced === null
                ? null
                : {
                    asset: stockToken(tickerId),
                    amount: priced.tokens,
                    minimum: check.kind === 'BUY' ? check.minOut : 0n,
                  },
          },
        ]
      : [];
  return draft(USER_OP_GAS.settle, {
    legs,
    price: priced?.price ?? null,
    blocked: check.kind === 'BLOCKED' ? check.detail : null,
  });
}

function previewSplit(world: MockWorld, account: MockAccount): Draft {
  const rule = account.rule;
  if (rule.status !== 'ACTIVE') return draft(USER_OP_GAS.split, { blocked: { code: 'RuleNotActive' } });
  const shortfall = shortfallOf(account);
  const unsorted = shortfall > 0n ? 0n : unsortedOf(account);
  const warnings: PreviewWarning[] = shortfall > 0n ? [{ code: 'RECONCILES_FIRST', shortfall }] : [];
  if (unsorted === 0n) {
    return draft(USER_OP_GAS.splitWaits, { warnings, blocked: shortfall > 0n ? null : { code: 'NothingWaiting' } });
  }

  const tickerId = rule.tickerId;
  const equityPart = (unsorted * BigInt(rule.equityBps)) / BigInt(TOTAL_BPS);
  const spendPart = unsorted - equityPart;
  const from = { kind: 'unsorted' } as const;
  const legs: PreviewLeg[] = [];
  if (spendPart > 0n) legs.push({ from, to: { kind: 'spend' }, sends: { asset: USDG, amount: spendPart }, receives: null });
  if (equityPart === 0n) return draft(USER_OP_GAS.splitWaits, { legs, warnings });

  const ctx = contextAtClock(world, account, tickerId);
  const outcome = previewOutcome(account, equityPart, ctx);
  if (outcome.kind === 'REFUSE') {
    legs.push({ from, to: { kind: 'spend' }, sends: { asset: USDG, amount: equityPart }, receives: null });
    warnings.push({ code: 'EQUITY_TO_SPEND', tickerId, status: outcome.status });
    return draft(USER_OP_GAS.splitWaits, { legs, warnings });
  }
  const priced = buyPrice(tickerId, equityPart, ctx, rule.premiumCapBps);
  const waitReason = outcome.kind === 'QUEUE' ? outcome.reason : priced !== null && !priced.price.withinCap ? 'PREMIUM' : null;
  if (waitReason !== null) {
    legs.push({ from, to: { kind: 'waiting', tickerId }, sends: { asset: USDG, amount: equityPart }, receives: null });
    warnings.push({
      code: 'EQUITY_WILL_WAIT',
      tickerId,
      reason: waitReason,
      reopensAt: waitReason === 'SESSION' ? ctx.reopensAt : null,
    });
    return draft(waitReason === 'PREMIUM' ? USER_OP_GAS.split : USER_OP_GAS.splitWaits, {
      legs,
      warnings,
      price: waitReason === 'PREMIUM' ? (priced?.price ?? null) : null,
    });
  }
  legs.push({
    from,
    to: { kind: 'holding', tickerId },
    sends: { asset: USDG, amount: equityPart },
    receives:
      priced === null
        ? null
        : { asset: stockToken(tickerId), amount: priced.tokens, minimum: minOutForBuy(equityPart, priced.quote, rule.slippageBps) },
  });
  return draft(USER_OP_GAS.split, { legs, warnings, price: priced?.price ?? null });
}

function previewRuleChange(account: MockAccount, action: Extract<OwnerAction, { kind: 'setRule' | 'pauseRule' | 'resumeRule' }>): Draft {
  const before = account.rule;
  switch (action.kind) {
    case 'setRule': {
      const issues = validateRuleInput(
        action.input,
        LAUNCH_TICKERS.map((ticker) => ticker.id),
      );
      const after: Rule = { version: before.version + 1, status: 'ACTIVE', ...action.input };
      return draft(USER_OP_GAS.setRule, {
        rule: { before, after },
        blocked: issues.length > 0 ? { code: 'InvalidRule', issues } : null,
      });
    }
    case 'pauseRule':
      return draft(USER_OP_GAS.pauseRule, {
        rule: { before, after: { ...before, status: 'PAUSED' } },
        warnings: [{ code: 'PAUSE_LEAVES_UNSORTED' }],
        blocked: before.status === 'ACTIVE' ? null : { code: 'RuleNotActive' },
      });
    case 'resumeRule': {
      const unsorted = unsortedOf(account);
      return draft(USER_OP_GAS.resumeRule, {
        rule: { before, after: { ...before, status: 'ACTIVE' } },
        warnings: unsorted > 0n ? [{ code: 'RESUME_SPLITS_UNSORTED', amount: unsorted }] : [],
        blocked: before.status === 'PAUSED' ? null : { code: 'RuleNotPaused' },
      });
    }
  }
}

/** previewAction (SleeveDataLayer): what an owner action would do now, read from the world without moving anything. */
export function previewAction(world: MockWorld, account: MockAccount, action: OwnerAction): ActionPreview {
  let result: Draft;
  switch (action.kind) {
    case 'withdraw':
      result = previewWithdraw(account, action.request);
      break;
    case 'sell':
      result = previewSell(world, account, action.request);
      break;
    case 'release':
      result = previewRelease(account, action.tickerId);
      break;
    case 'settle':
      result = previewSettle(world, account, action.tickerId);
      break;
    case 'split':
      result = previewSplit(world, account);
      break;
    case 'setRule':
    case 'pauseRule':
    case 'resumeRule':
      result = previewRuleChange(account, action);
      break;
  }
  return {
    action,
    asOf: world.clock,
    legs: result.legs,
    price: result.price,
    rule: result.rule,
    fee: fee(result.gas),
    warnings: result.warnings,
    blocked: result.blocked,
  };
}
