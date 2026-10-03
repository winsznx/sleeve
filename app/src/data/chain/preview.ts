import { LAUNCH_TICKERS, validateRuleInput, type Receipt, type Rule, type TickerId } from '@sleeve/core';
import type { Address } from 'viem';

import { buildOwnerOp, type BatchStep } from '@/lib/chain/owner-ops';

import type {
  ActionPreview,
  ChainPoint,
  MarketSnapshot,
  NetworkFee,
  OwnerAction,
  PreviewBlock,
  PreviewLeg,
  PreviewPrice,
  PreviewWarning,
} from '../types';
import { findOwnerOpEnded, type OwnerOpEndedLog } from './decode';
import { receiptsInLogs } from './history';
import { failureOf, simulateBatch, type SimulatedBatch } from './owner-op';
import type { SellPlan } from './sell';
import type { PreparedOp } from './user-ops';

/**
 * previewAction on chain: the exact batch the owner would sign, run through eth_simulateV1 at the latest block. What
 * moves comes from the receipts and the OwnerOpEnded event the simulation emits, so the preview shows what the
 * module would write, not an estimate of it. The fee comes from preparing the same UserOp through the bundler,
 * sponsored when the paymaster will.
 */

const USDG = { kind: 'USDG' } as const;

function stockToken(tickerId: TickerId) {
  return { kind: 'STOCK_TOKEN', tickerId } as const;
}

export interface PreviewInputs {
  action: OwnerAction;
  account: Address;
  asOf: ChainPoint;
  market: MarketSnapshot;
  rule: Rule;
  unsorted: bigint;
  /** The batch the action sends, or a block found before any simulation. */
  steps: BatchStep[] | PreviewBlock;
  /** A sell's plan, for its legs and price even while it is blocked or waits. */
  sellPlan: SellPlan | null;
  /** Prepares the UserOp for its fee, or names why it cannot be prepared. */
  prepare(callData: `0x${string}`, callGasLimit: bigint | null): Promise<PreparedOp | PreviewBlock>;
  /** The chain's gas price, for a fee when the bundler cannot be asked. */
  gasPrice(): Promise<bigint>;
  simulate?: typeof simulateBatch;
  client: Parameters<typeof simulateBatch>[0];
}

function reopensAt(market: MarketSnapshot, tickerId: TickerId): bigint | null {
  return market.tickers.find((entry) => entry.tickerId === tickerId)?.session.nextOpenAt ?? null;
}

function buyPrice(receipt: Receipt, market: MarketSnapshot, capBps: number): PreviewPrice | null {
  const reference = market.tickers.find((entry) => entry.tickerId === receipt.tickerId)?.feed;
  if (reference === undefined || receipt.execPrice === 0n) return null;
  return {
    side: 'BUY',
    tickerId: receipt.tickerId,
    execPrice: receipt.execPrice,
    reference,
    differenceBps: receipt.premiumBps,
    capBps,
    withinCap: receipt.premiumBps <= BigInt(capBps),
  };
}

interface Movement {
  legs: PreviewLeg[];
  price: PreviewPrice | null;
  warnings: PreviewWarning[];
  blocked: PreviewBlock | null;
}

/** What the simulated receipts of a split, a settle or a release move. */
function receiptMovement(receipts: readonly Receipt[], market: MarketSnapshot, rule: Rule): Movement {
  const legs: PreviewLeg[] = [];
  const warnings: PreviewWarning[] = [];
  let price: PreviewPrice | null = null;
  for (const receipt of receipts) {
    const tickerId = receipt.tickerId;
    const settle = receipt.usdgIn === 0n;
    const from = settle ? ({ kind: 'waiting', tickerId } as const) : ({ kind: 'unsorted' } as const);
    switch (receipt.status) {
      case 'RECONCILED':
        if (receipt.lotId === 0n) warnings.push({ code: 'RECONCILES_FIRST', shortfall: receipt.usdgIn });
        break;
      case 'FILLED':
      case 'SETTLED': {
        const spendPart = receipt.usdgToSpend;
        if (spendPart > 0n) legs.push({ from, to: { kind: 'spend' }, sends: { asset: USDG, amount: spendPart }, receives: null });
        legs.push({
          from,
          to: { kind: 'holding', tickerId },
          sends: { asset: USDG, amount: receipt.usdgSpent },
          receives: { asset: stockToken(tickerId), amount: receipt.tokensOut, minimum: receipt.minOut },
        });
        price = buyPrice(receipt, market, rule.premiumCapBps);
        break;
      }
      case 'QUEUED': {
        if (receipt.usdgToSpend > 0n) {
          legs.push({ from, to: { kind: 'spend' }, sends: { asset: USDG, amount: receipt.usdgToSpend }, receives: null });
        }
        if (receipt.usdgQueued > 0n) {
          legs.push({ from, to: { kind: 'waiting', tickerId }, sends: { asset: USDG, amount: receipt.usdgQueued }, receives: null });
          warnings.push({
            code: 'EQUITY_WILL_WAIT',
            tickerId,
            reason: receipt.reason,
            reopensAt: receipt.reason === 'SESSION' ? reopensAt(market, tickerId) : null,
          });
          if (receipt.reason === 'PREMIUM') price = buyPrice(receipt, market, rule.premiumCapBps);
        }
        break;
      }
      case 'REFUSED_TICKER':
      case 'REFUSED_ACCOUNT': {
        const equity = settle ? receipt.usdgToSpend : receipt.usdgToEquity;
        const spendPart = receipt.usdgToSpend - equity;
        if (spendPart > 0n) legs.push({ from, to: { kind: 'spend' }, sends: { asset: USDG, amount: spendPart }, receives: null });
        if (equity > 0n) legs.push({ from, to: { kind: 'spend' }, sends: { asset: USDG, amount: equity }, receives: null });
        warnings.push({ code: 'EQUITY_TO_SPEND', tickerId, status: receipt.status });
        break;
      }
      case 'RELEASED':
        legs.push({
          from: { kind: 'waiting', tickerId },
          to: { kind: 'spend' },
          sends: { asset: USDG, amount: receipt.usdgToSpend },
          receives: null,
        });
        warnings.push({ code: 'RELEASE_ENDS_WAIT', tickerId });
        break;
      case 'PART_SOLD':
      case 'SOLD':
        break;
    }
  }
  return { legs, price, warnings, blocked: null };
}

function sellMovement(plan: SellPlan, receipts: readonly Receipt[] | null): Movement {
  const { quote, rule, market } = plan;
  const request = quote.request;
  const sold = receipts?.filter((receipt) => receipt.status === 'PART_SOLD' || receipt.status === 'SOLD') ?? [];
  const usdgOut = sold.length > 0 ? sold.reduce((total, receipt) => total + receipt.usdgOut, 0n) : quote.expectedUsdgOut;
  const tokensIn = sold.length > 0 ? sold.reduce((total, receipt) => total + receipt.tokensIn, 0n) : request.amount;
  const first = sold[0];
  const legs: PreviewLeg[] = [
    {
      from: { kind: 'holding', tickerId: request.tickerId },
      to: { kind: 'spend' },
      sends: { asset: stockToken(request.tickerId), amount: tokensIn },
      receives: { asset: USDG, amount: usdgOut, minimum: quote.minOut },
    },
  ];
  const differenceBps = first?.premiumBps ?? quote.discountBps;
  const price: PreviewPrice | null =
    quote.quote > 0n
      ? {
          side: 'SELL',
          tickerId: request.tickerId,
          execPrice: first?.execPrice ?? quote.quote,
          reference: quote.feed,
          differenceBps,
          capBps: quote.capBps,
          withinCap: differenceBps <= BigInt(quote.capBps),
        }
      : null;
  const warnings: PreviewWarning[] = [];
  if (request.overrideClosed && !market.session.open) warnings.push({ code: 'SKIPS_MARKET_WAIT', reopensAt: market.session.nextOpenAt });
  if (request.overrideCapBps > rule.premiumCapBps) {
    warnings.push({ code: 'WIDER_CAP', capBps: request.overrideCapBps, ruleCapBps: rule.premiumCapBps });
  }
  return { legs, price, warnings, blocked: null };
}

function withdrawMovement(ended: OwnerOpEndedLog | null, to: Address): Movement {
  if (ended === null) return { legs: [], price: null, warnings: [], blocked: null };
  const outside = { kind: 'outside', address: to } as const;
  const legs: PreviewLeg[] = [];
  const warnings: PreviewWarning[] = [];
  if (ended.fromSpend > 0n) legs.push({ from: { kind: 'spend' }, to: outside, sends: { asset: USDG, amount: ended.fromSpend }, receives: null });
  if (ended.fromUnsorted > 0n) {
    legs.push({ from: { kind: 'unsorted' }, to: outside, sends: { asset: USDG, amount: ended.fromUnsorted }, receives: null });
    warnings.push({ code: 'SENDS_UNSORTED', amount: ended.fromUnsorted });
  }
  ended.fromBuckets.forEach((amount, tickerId) => {
    if (amount === 0n) return;
    legs.push({ from: { kind: 'waiting', tickerId }, to: outside, sends: { asset: USDG, amount }, receives: null });
    warnings.push({ code: 'SENDS_WAITING', tickerId, amount });
  });
  return { legs, price: null, warnings, blocked: null };
}

function ruleMovement(action: OwnerAction, before: Rule, unsorted: bigint): { rule: ActionPreview['rule']; warnings: PreviewWarning[]; blocked: PreviewBlock | null } {
  switch (action.kind) {
    case 'setRule': {
      const input = action.input;
      const issues = validateRuleInput(input, LAUNCH_TICKERS.map((ticker) => ticker.id));
      const after: Rule = {
        version: before.version + 1,
        status: 'ACTIVE',
        equityBps: input.equityBps,
        tickerId: input.tickerId,
        premiumCapBps: input.premiumCapBps,
        slippageBps: input.slippageBps,
        minClip: input.minClip,
      };
      return { rule: { before, after }, warnings: [], blocked: issues.length > 0 ? { code: 'InvalidRule', issues } : null };
    }
    case 'pauseRule':
      return { rule: { before, after: { ...before, status: 'PAUSED' } }, warnings: [{ code: 'PAUSE_LEAVES_UNSORTED' }], blocked: null };
    case 'resumeRule':
      return {
        rule: { before, after: { ...before, status: 'ACTIVE' } },
        warnings: unsorted > 0n ? [{ code: 'RESUME_SPLITS_UNSORTED', amount: unsorted }] : [],
        blocked: null,
      };
    default:
      return { rule: null, warnings: [], blocked: null };
  }
}

async function feeOf(inputs: PreviewInputs, simulated: SimulatedBatch | null, callData: `0x${string}` | null, callGasLimit: bigint | null) {
  const fallbackGas = (simulated?.gasUsed ?? 0n) + 150_000n;
  if (callData !== null) {
    const prepared = await inputs.prepare(callData, callGasLimit);
    if ('userOp' in prepared) {
      const fee: NetworkFee = {
        gas: prepared.gas,
        gasPriceWei: prepared.userOp.maxFeePerGas,
        wei: prepared.maxCostWei,
        sponsored: prepared.sponsored,
      };
      return { fee, blocked: null };
    }
    const gasPriceWei = await inputs.gasPrice();
    return { fee: { gas: fallbackGas, gasPriceWei, wei: fallbackGas * gasPriceWei, sponsored: false }, blocked: prepared };
  }
  const gasPriceWei = await inputs.gasPrice();
  return { fee: { gas: fallbackGas, gasPriceWei, wei: fallbackGas * gasPriceWei, sponsored: false }, blocked: null };
}

export async function previewOnChain(inputs: PreviewInputs): Promise<ActionPreview> {
  const { action, account, market, rule } = inputs;
  const base = { action, asOf: inputs.asOf };
  const ruleView = ruleMovement(action, rule, inputs.unsorted);

  if (!Array.isArray(inputs.steps)) {
    const { fee } = await feeOf(inputs, null, null, null);
    const movement = inputs.sellPlan === null ? null : sellMovement(inputs.sellPlan, null);
    return {
      ...base,
      legs: movement?.legs ?? [],
      price: movement?.price ?? null,
      rule: ruleView.rule,
      fee,
      warnings: [...(movement?.warnings ?? []), ...ruleView.warnings],
      blocked: inputs.steps,
    };
  }

  const op = buildOwnerOp(account, inputs.steps);
  const simulated = await (inputs.simulate ?? simulateBatch)(inputs.client, account, op.callData);
  let movement: Movement = { legs: [], price: null, warnings: [], blocked: null };
  let blocked: PreviewBlock | null = ruleView.blocked;
  if (!simulated.success) {
    blocked ??= failureOf(simulated.revertData, { reopensAt: actionReopensAt(action, market) }, null).detail;
    if (inputs.sellPlan !== null) movement = sellMovement(inputs.sellPlan, null);
  } else {
    const receipts = receiptsInLogs(simulated.logs, account).map((entry) => entry.receipt);
    switch (action.kind) {
      case 'withdraw':
        movement = withdrawMovement(findOwnerOpEnded(simulated.logs, account), action.request.to);
        break;
      case 'sell':
        movement = inputs.sellPlan === null ? movement : sellMovement(inputs.sellPlan, receipts);
        break;
      case 'split':
      case 'settle':
      case 'release':
        movement = receiptMovement(receipts, market, rule);
        if (action.kind === 'split' && receipts.length === 0) blocked ??= { code: 'NothingWaiting' };
        break;
      default:
        break;
    }
  }
  const { fee, blocked: feeBlock } = await feeOf(inputs, simulated, blocked === null ? op.callData : null, op.callGasLimit);
  return {
    ...base,
    legs: movement.legs,
    price: movement.price,
    rule: ruleView.rule,
    fee,
    warnings: [...movement.warnings, ...ruleView.warnings],
    blocked: blocked ?? feeBlock,
  };
}

function actionReopensAt(action: OwnerAction, market: MarketSnapshot): bigint | null {
  if (action.kind === 'sell') return reopensAt(market, action.request.tickerId);
  if (action.kind === 'settle') return reopensAt(market, action.tickerId);
  return null;
}
