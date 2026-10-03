import { formatBps } from '@sleeve/core';
import type { JSX, ReactNode } from 'react';

import { percentWords } from '@/components/sleeve/text';
import { cx } from '@/components/ui/cx';
import { formatDuration, formatUtc } from '@/components/ui/format-time';
import { Icon } from '@/components/ui/icons';

import { Glyph } from '../../_components/glyphs';
import { isoTime } from '../../_lib/register';
import type { FillPrice, PriceModel } from '../receipt-panels';
import { Fact, FactGrid, ReceiptPanel } from './fact';

/**
 * The fill against the market reference (PRD 7.11, 10 and 16). Two tiles side by side: the all-in price measured
 * from the account's balances, with the fill's time, and the Chainlink answer the guard read, with its own time. A
 * chip between them names the gap in words, never in red or green. The cap check and the reference's age at the
 * fill follow. The round ids and the multiplier sit in the proof section. An action that read the reference but
 * swapped nothing shows the reference alone.
 */

interface PriceTileProps {
  icon: ReactNode;
  kicker: string;
  value: string;
  unit: string;
  children: ReactNode;
}

function PriceTile({ icon, kicker, value, unit, children }: PriceTileProps): JSX.Element {
  return (
    <div className="min-w-0 rounded-row border border-border bg-surface-muted px-4 pb-4 pt-3.5">
      <p className="flex items-center gap-2 text-body-s font-medium text-ink-secondary">
        {icon}
        {kicker}
      </p>
      <p className="mt-2 flex flex-wrap items-baseline gap-x-1.5">
        <span className="text-figure-s tabular-nums text-ink">{value}</span>
        <span className="text-body-s text-ink-secondary">{unit}</span>
      </p>
      <div className="mt-2 text-body-s text-ink-secondary">{children}</div>
    </div>
  );
}

function gapChip(fill: FillPrice): string {
  if (fill.premiumBps === 0n) return 'At the reference';
  const magnitude = fill.premiumBps < 0n ? -fill.premiumBps : fill.premiumBps;
  return `${formatBps(magnitude, { minFractionDigits: 2 })} ${fill.premiumBps > 0n ? 'above' : 'below'}`;
}

function ReferenceTile({ model }: { model: PriceModel }): JSX.Element {
  return (
    <PriceTile icon={<Icon name="clock" className="size-4" />} kicker="Market reference, Chainlink" value={model.reference} unit={`USD per ${model.symbol}`}>
      <p>
        Published <time dateTime={isoTime(model.referenceAt)}>{formatUtc(model.referenceAt)}</time>
      </p>
    </PriceTile>
  );
}

function FillFacts({ fill }: { fill: FillPrice }): JSX.Element {
  const cap = fill.cap;
  return (
    <>
      <Fact term="Against the reference" note={`The receipt stores ${fill.premiumBps}, rounded against the owner.`}>
        {fill.words}
      </Fact>
      {cap === null ? null : (
        <Fact
          term={cap.source === 'override' ? 'Cap for this sell' : 'Your cap'}
          derived={cap.derived}
          note={cap.source === 'override' ? 'Widened for this sell only, and stored on the receipt.' : undefined}
        >
          <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="tabular-nums">{percentWords(cap.bps)}</span>
            <span className={cx('inline-flex items-center gap-1 font-medium', cap.within ? 'text-success' : 'text-danger')}>
              <Icon name={cap.within ? 'check' : 'alert'} className="size-4" />
              {cap.within ? 'Inside the cap' : 'Outside the cap'}
            </span>
          </span>
        </Fact>
      )}
      <Fact term="Reference age at the fill" note="A stock feed posts on a 0.5 percent move or every 24 hours, so in session it can trail the pool.">
        {formatDuration(fill.referenceAge)}
      </Fact>
    </>
  );
}

export function PricePanel({ model }: { model: PriceModel }): JSX.Element {
  const fill = model.fill;
  return (
    <ReceiptPanel
      id="action-price"
      title={fill === null ? 'Market reference' : 'The price'}
      aside={fill === null ? 'Read by the guard' : 'Pool and reference, kept apart'}
      intro={fill === null ? 'The guard read this price, then stopped before any swap, so there is no all-in price.' : fill.sentence}
    >
      {fill === null ? (
        <div className="mt-4 max-w-sm">
          <ReferenceTile model={model} />
        </div>
      ) : (
        <div className="mt-4 grid md:grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] md:gap-3">
          <PriceTile icon={<Glyph name="pool" className="size-4" />} kicker="All-in price, from the pool" value={fill.execPrice} unit={`USDG per ${model.symbol}`}>
            <p>
              {fill.side === 'buy' ? 'Paid' : 'Received'} <time dateTime={isoTime(fill.filledAt)}>{formatUtc(fill.filledAt)}</time>
            </p>
            <p className="mt-0.5 text-ink-muted">What left and entered the account, so every pool fee is in it.</p>
          </PriceTile>
          <span
            aria-hidden="true"
            className="relative -my-2.5 justify-self-center whitespace-nowrap rounded-pill border border-border-strong bg-surface px-3 py-1 text-label font-semibold tabular-nums text-ink shadow-soft md:my-0 md:self-center"
          >
            {gapChip(fill)}
          </span>
          <ReferenceTile model={model} />
        </div>
      )}

      {fill === null ? null : (
        <FactGrid className="mt-5 border-t border-border pt-5">
          <FillFacts fill={fill} />
        </FactGrid>
      )}
    </ReceiptPanel>
  );
}
