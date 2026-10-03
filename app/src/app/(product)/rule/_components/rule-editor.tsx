'use client';

import { formatBps, formatUsdg, RULE_DEFAULTS, RULE_LIMITS, TOTAL_BPS, type Rule, type RuleInput } from '@sleeve/core';
import { useId, useState, type FormEvent, type JSX, type ReactNode } from 'react';

import { tickerSymbol } from '@/components/sleeve/text';
import { Button } from '@/components/ui/button';
import { cx } from '@/components/ui/cx';
import { Note } from '@/components/ui/card';
import { FilterPill } from '@/components/ui/choice';
import { AmountInput } from '@/components/ui/field';
import { Slider, formatBpsValue } from '@/components/ui/slider';
import type { MarketSnapshot } from '@/data/types';

import {
  draftFrom,
  draftInput,
  minClipProblemText,
  ruleChanges,
  SHARE_PRESETS,
  worstCaseLine,
  type RuleDraft,
} from '../_lib/rule-draft';
import { PaydayPreview } from './payday-preview';
import { TickerPicker } from './ticker-picker';

/** The example payday the editor reasons on (PRD 8.1). */
const EXAMPLE_PAYDAY = 500_000_000n;

function draftOf(input: RuleInput): RuleDraft {
  return draftFrom({ ...input, version: 0, status: 'ACTIVE' });
}

function Section({ title, hint, children }: { title: string; hint?: ReactNode; children: ReactNode }): JSX.Element {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="min-w-0 border-t border-border pt-6 first:border-t-0 first:pt-0">
      <h2 id={titleId} className="text-h3 text-ink">
        {title}
      </h2>
      {hint === undefined ? null : <p className="mt-1 max-w-reading text-body-s text-ink-secondary">{hint}</p>}
      <div className="mt-4">{children}</div>
    </section>
  );
}

export interface RuleEditorProps {
  /** The rule as it stands; null while setting up, when the draft starts at the product defaults (D-014). */
  current: Rule | null;
  /** A draft chosen earlier, such as on a step the person came back to. */
  initial?: RuleInput | null;
  market: MarketSnapshot | undefined;
  submitLabel: string;
  /** The rule page asks the owner to sign; onboarding moves to the next step. */
  onSubmit: (input: RuleInput) => void;
  busy?: boolean;
  /** Turn on when saving needs a change against the rule as it stands. */
  requireChange?: boolean;
  /** Extra actions beside the submit, such as Back. */
  secondaryAction?: ReactNode;
  /** aside puts the live split beside the form from 1024 px; inline keeps it in the form, for narrow columns. */
  previewPlacement?: 'aside' | 'inline';
}

/**
 * The rule editor (PRD 7.3 and 7.4, SPEC 6), shared by the rule page and onboarding: which Stock Token, how much of
 * each payment, and the price guard, with a live split of an example payday beside it. Every value is checked the way
 * the module checks it before anything is signed.
 */
export function RuleEditor({
  current,
  initial,
  market,
  submitLabel,
  onSubmit,
  busy = false,
  requireChange = false,
  secondaryAction,
  previewPlacement = 'aside',
}: RuleEditorProps): JSX.Element {
  const [draft, setDraft] = useState<RuleDraft>(() => (initial ? draftOf(initial) : draftFrom(current)));
  const [showClipError, setShowClipError] = useState(false);
  const parsed = draftInput(draft);
  const preview: RuleInput = parsed.ok
    ? parsed.input
    : {
        spendBps: TOTAL_BPS - draft.equityBps,
        equityBps: draft.equityBps,
        tickerId: draft.tickerId,
        premiumCapBps: draft.premiumCapBps,
        slippageBps: draft.slippageBps,
        minClip: current?.minClip ?? RULE_DEFAULTS.minClip,
      };
  const standing = current !== null && current.status !== 'NONE' ? current : null;
  const changes = standing === null ? undefined : ruleChanges(standing, preview);
  const unchanged = requireChange && changes !== undefined && changes.length === 0;
  const equityPart = (EXAMPLE_PAYDAY * BigInt(draft.equityBps)) / BigInt(TOTAL_BPS);
  const symbol = tickerSymbol(draft.tickerId);

  function update(patch: Partial<RuleDraft>) {
    setDraft((previous) => ({ ...previous, ...patch }));
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!parsed.ok) {
      setShowClipError(true);
      return;
    }
    if (unchanged) return;
    onSubmit(parsed.input);
  }

  const share = (
    <div className="flex flex-col gap-4">
      <Slider
        label={`Part of each payment that buys ${symbol}`}
        value={draft.equityBps}
        onValueChange={(equityBps) => update({ equityBps })}
        min={0}
        max={TOTAL_BPS}
        step={100}
        formatValue={(bps) => formatBps(bps)}
        disabled={busy}
        hint={`The rest, ${formatBps(TOTAL_BPS - draft.equityBps)}, stays spendable USDG.`}
      />
      <div role="group" aria-label="Quick picks" className="flex flex-wrap gap-2">
        {SHARE_PRESETS.map((bps) => (
          <FilterPill key={bps} pressed={draft.equityBps === bps} onClick={() => update({ equityBps: bps })} disabled={busy}>
            {formatBps(bps)}
            {bps === RULE_DEFAULTS.equityBps ? ', suggested' : ''}
          </FilterPill>
        ))}
      </div>
    </div>
  );

  return (
    <div className={cx('grid gap-6', previewPlacement === 'aside' && 'lg:grid-cols-[minmax(0,1fr)_21.25rem] lg:items-start')}>
      <form onSubmit={submit} noValidate className="flex min-w-0 flex-col gap-6 rounded-large border border-border bg-surface p-card md:p-6">
        <Section title="Which Stock Token" hint="Your equity share buys this token. It lands in your own account.">
          <TickerPicker value={draft.tickerId} onChange={(tickerId) => update({ tickerId })} market={market} disabled={busy} />
        </Section>

        <Section title="How much of each payment" hint="Set it once. Every payment that arrives splits this way until you change it.">
          {share}
          <PaydayPreview input={preview} changes={changes} className={cx('mt-6', previewPlacement === 'aside' && 'lg:hidden')} />
        </Section>

        <Section
          title="Price guard"
          hint="Sleeve buys only near the Chainlink market reference. When the price is outside your caps, or the market is closed, the equity share waits as USDG in your account."
        >
          <div className="flex flex-col gap-6">
            <Slider
              label="Premium cap"
              value={draft.premiumCapBps}
              onValueChange={(premiumCapBps) => update({ premiumCapBps })}
              min={RULE_LIMITS.premiumCapBps.min}
              max={RULE_LIMITS.premiumCapBps.max}
              step={5}
              formatValue={formatBpsValue}
              disabled={busy}
              hint={`The most a buy may pay above the Chainlink reference. ${worstCaseLine(draft.premiumCapBps, equityPart)}`}
            />
            <Slider
              label="Slippage cap"
              value={draft.slippageBps}
              onValueChange={(slippageBps) => update({ slippageBps })}
              min={RULE_LIMITS.slippageBps.min}
              max={RULE_LIMITS.slippageBps.max}
              step={5}
              formatValue={formatBpsValue}
              disabled={busy}
              hint={`If the pool fills for less than its quote minus ${formatBpsValue(draft.slippageBps)}, the buy reverts and nothing moves.`}
            />
            <AmountInput
              label="Minimum buy"
              value={draft.minClipText}
              onValueChange={(minClipText) => {
                setShowClipError(false);
                update({ minClipText });
              }}
              onBlur={() => setShowClipError(true)}
              unit="USDG"
              decimals={6}
              disabled={busy}
              error={!parsed.ok && showClipError ? minClipProblemText(parsed.problem) : undefined}
              hint={`At least ${formatUsdg(RULE_LIMITS.minClipFloor, { minFractionDigits: 0 })} USDG. Every buy is a swap that costs gas, so a smaller equity share waits as USDG until the waiting USDG adds up to this. One swap's gas then stays a small part of the buy.`}
              className="max-w-sm"
            />
          </div>
        </Section>

        <Note title="What splits and what never does">
          Money already in your account when Sleeve was set up never splits, and neither does USDG you move in through Sleeve. A
          plain transfer from any wallet counts as a payment and splits, even from your own wallet, because the contract cannot
          see who sent it.
        </Note>

        <div className="flex flex-col-reverse gap-3 border-t border-border pt-5 sm:flex-row sm:items-center sm:justify-end">
          {unchanged ? <p className="text-body-s text-ink-muted sm:mr-auto">Change something above to save a new version.</p> : null}
          {secondaryAction}
          {standing === null ? null : (
            <Button
              variant="ghost"
              onClick={() => {
                setShowClipError(false);
                setDraft(draftFrom(standing));
              }}
              disabled={busy || changes?.length === 0}
            >
              Undo changes
            </Button>
          )}
          <Button type="submit" busy={busy} busyLabel="Saving" disabled={unchanged} className="w-full sm:w-auto">
            {submitLabel}
          </Button>
        </div>
      </form>

      {previewPlacement === 'aside' ? (
        <aside className="hidden lg:sticky lg:top-6 lg:block">
          <PaydayPreview input={preview} changes={changes} />
        </aside>
      ) : null}
    </div>
  );
}
