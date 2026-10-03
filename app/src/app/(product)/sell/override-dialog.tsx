'use client';

import { RULE_LIMITS, formatBps } from '@sleeve/core';
import { useState, type JSX } from 'react';

import { percentWords } from '@/components/sleeve/text';
import { Button } from '@/components/ui/button';
import { Banner } from '@/components/ui/card';
import { SegmentedControl } from '@/components/ui/choice';
import { Dialog } from '@/components/ui/dialog';

import { discountWords, gapRiskSentences, overrideCapChoices, type SellWait } from './sell-text';

export interface OverrideDialogProps {
  open: boolean;
  /** Keep waiting: closes without changing anything. */
  onClose: () => void;
  /** The owner accepted the gap risk for this sell. 0 keeps the rule's cap; anything else widens it for this sell. */
  onContinue: (overrideCapBps: number) => void;
  symbol: string;
  wait: SellWait;
  /** When the Chainlink answer the cap is measured against was published. */
  referenceAt: bigint;
  /** The rule's premium cap, which is also a sell's discount cap unless this sell widens it. */
  ruleCapBps: number;
  /** How far below that answer the quoted sell sits, PriceGuard discountBps. */
  discountBps: bigint;
  /** The cap chosen last time for this sell, when the owner opens the dialog again. */
  initialCapBps?: number;
}

function capLabel(bps: number): string {
  return formatBps(bps, { minFractionDigits: 2 });
}

/**
 * The override is offered once per sell, and only here, after the gap risk is in front of the owner (PRD 7.5). It
 * skips the session and reference-age checks for this one sell and may widen its discount cap up to 500 bps
 * (B2-14). Mount it with a new key each time it opens, so the cap starts from the current choice.
 */
export function OverrideDialog({
  open,
  onClose,
  onContinue,
  symbol,
  wait,
  referenceAt,
  ruleCapBps,
  discountBps,
  initialCapBps,
}: OverrideDialogProps): JSX.Element {
  const choices = overrideCapChoices(ruleCapBps);
  const [capBps, setCapBps] = useState(() =>
    initialCapBps !== undefined && choices.includes(initialCapBps) ? initialCapBps : ruleCapBps,
  );
  const tooTight = discountBps > BigInt(capBps);

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Sell without waiting?"
      description={
        wait.reason === 'SESSION'
          ? 'The market is closed. This sell would run now, against the last reference price.'
          : 'The reference price is out of date. This sell would run now, against that old price.'
      }
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Keep waiting
          </Button>
          <Button onClick={() => onContinue(capBps === ruleCapBps ? 0 : capBps)}>Continue without waiting</Button>
        </>
      }
    >
      <div className="space-y-3 text-body text-ink">
        {gapRiskSentences(wait, symbol, referenceAt).map((sentence) => (
          <p key={sentence}>{sentence}</p>
        ))}
        <p className="text-body-s text-ink-secondary">
          This choice covers this one sell. Every other check still runs: the issuer&apos;s pause and blocklist, a
          pending multiplier change, and the USDG price.
        </p>
      </div>

      {choices.length > 1 ? (
        <SegmentedControl
          legend="Cap for this sell"
          options={choices.map((bps) => ({ value: String(bps), label: capLabel(bps) }))}
          value={String(capBps)}
          onChange={(value) => setCapBps(Number(value))}
          hint={`How far below the last reference price this sell may go. ${capLabel(ruleCapBps)} is your rule's cap.`}
          className="mt-5"
        />
      ) : (
        <p className="mt-5 text-body-s text-ink-secondary">
          Your cap is already {percentWords(RULE_LIMITS.sellOverrideCapBpsMax)}, the most one sell allows.
        </p>
      )}

      {tooTight ? (
        <Banner title="This cap is too tight for this sell" className="mt-4">
          At the last price, this sell is {discountWords(discountBps)}, more than {percentWords(capBps)}. Pick a wider cap
          or sell less.
        </Banner>
      ) : null}
    </Dialog>
  );
}
