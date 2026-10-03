import type { FlagHistory, LogPosition, MultiplierHistory, MultiplierUpdate } from './evidence';

/**
 * The Stock Token's guard state at a receipt, rebuilt from the state now and the events after the receipt, because
 * the public RPC serves no old state (D-008).
 *
 * Pause flags switch only on a change, as OpenZeppelin's Pausable does, so the first switch after the receipt
 * tells the state before it, and with no switch since, the state then is the state now.
 *
 * The multiplier follows ERC-8056 as the tokens implement it (docs/research/chain-constants.md sections 3 and 6):
 * uiMultiplier() is the scheduled value from effectiveAt on and the previous value before it, flipping at
 * effectiveAt without an event, and every update logs the value current at that moment as oldMultiplier.
 */

/** 1e18: the multiplier of a token whose multiplier was never set. */
export const UNIT_MULTIPLIER = 10n ** 18n;

export function comparePositions(a: LogPosition, b: LogPosition): number {
  if (a.blockNumber !== b.blockNumber) return a.blockNumber < b.blockNumber ? -1 : 1;
  return a.logIndex - b.logIndex;
}

export function isAfter(position: LogPosition, reference: LogPosition): boolean {
  return comparePositions(position, reference) > 0;
}

/** A pause flag's value at the receipt. `history.after` holds only switches after the receipt, oldest first. */
export function flagAtReceipt(history: FlagHistory): boolean {
  const first = history.after[0];
  return first === undefined ? history.now : !first.set;
}

/** The multiplier storage in force at the receipt: the update that last set it, or never set. */
interface MultiplierState {
  oldMultiplier: bigint;
  newMultiplier: bigint;
  effectiveAt: bigint;
}

export type MultiplierAtReceipt =
  | {
      known: true;
      /** uiMultiplier() at the receipt's timestamp. */
      value: bigint;
      /** A change scheduled after the receipt's timestamp and in force at it, or null. */
      pending: { newMultiplier: bigint; effectiveAt: bigint } | null;
      /** How the value was found, in words. */
      basis: string;
    }
  | { known: false; basis: string };

function fromState(state: MultiplierState, timestamp: bigint, basis: string): MultiplierAtReceipt {
  if (timestamp >= state.effectiveAt) return { known: true, value: state.newMultiplier, pending: null, basis };
  return {
    known: true,
    value: state.oldMultiplier,
    pending: { newMultiplier: state.newMultiplier, effectiveAt: state.effectiveAt },
    basis,
  };
}

function stateOf(update: MultiplierUpdate): MultiplierState {
  return { oldMultiplier: update.oldMultiplier, newMultiplier: update.newMultiplier, effectiveAt: update.effectiveAt };
}

/**
 * uiMultiplier() at the receipt's timestamp, and whether a change was pending then.
 *
 * With no update after the receipt, the storage then is the storage now: newUIMultiplier() and effectiveAt() give
 * the scheduled value and its time, and the earlier value is uiMultiplier() now while the change is still pending,
 * or the last update before the receipt once it has taken effect. With updates after the receipt, the last update
 * before it set the storage in force at the receipt.
 */
export function multiplierAtReceipt(
  history: MultiplierHistory,
  timestamp: bigint,
  latestTimestamp: bigint,
): MultiplierAtReceipt {
  if (history.after.length === 0) {
    if (timestamp >= history.effectiveAt) {
      return { known: true, value: history.newUIMultiplier, pending: null, basis: 'newUIMultiplier() now, no update since' };
    }
    if (latestTimestamp < history.effectiveAt) {
      return fromState(
        { oldMultiplier: history.uiMultiplier, newMultiplier: history.newUIMultiplier, effectiveAt: history.effectiveAt },
        timestamp,
        'uiMultiplier() now, the change scheduled before the receipt still pending',
      );
    }
    if (history.lastBefore === 'NOT_READ') {
      return { known: false, basis: 'the update that scheduled the change was not read' };
    }
    if (history.lastBefore === null) {
      return { known: false, basis: 'a change is scheduled but no UIMultiplierUpdated log precedes the receipt' };
    }
    return fromState(stateOf(history.lastBefore), timestamp, 'the last UIMultiplierUpdated log before the receipt');
  }
  if (history.lastBefore === 'NOT_READ') {
    return { known: false, basis: 'updates follow the receipt, and the last update before it was not read' };
  }
  if (history.lastBefore === null) {
    return { known: true, value: UNIT_MULTIPLIER, pending: null, basis: 'no UIMultiplierUpdated log before the receipt' };
  }
  return fromState(stateOf(history.lastBefore), timestamp, 'the last UIMultiplierUpdated log before the receipt');
}

/**
 * PriceGuard.checkMultiplier at the receipt: a change to a different multiplier taking effect after the timestamp
 * and at most `window` seconds after it.
 */
export function multiplierDue(at: MultiplierAtReceipt, timestamp: bigint, window: bigint): boolean | null {
  if (!at.known) return null;
  if (at.pending === null) return false;
  return at.pending.effectiveAt - timestamp <= window && at.pending.newMultiplier !== at.value;
}
