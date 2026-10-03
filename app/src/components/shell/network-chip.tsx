'use client';

import { CHAIN_ID, CHAIN_NAME } from '@sleeve/core';
import type { JSX } from 'react';

import { NetworkGlyph } from '@/components/token/glyphs';
import { cx } from '@/components/ui/cx';
import { useMarket } from '@/data/hooks';
import { DATA_SOURCE } from '@/data/source';
import { DISCLAIMER, SAMPLE_DATA_LINE } from '@/lib/copy';

import { Popover } from './popover';
import { countdownLong } from './time-words';
import { useWallClock } from './use-browser';

/**
 * The network as words with the neutral glyph, never a logo (D-021, icon-system.md 4.5). "Robinhood Chain" is set in
 * the size and weight of the text around it. Its panel names the chain, says where the figures come from, and
 * carries the disclaimer, because the network is named there on its own.
 */
export function NetworkChip({ className }: { className?: string }): JSX.Element {
  return (
    <Popover
      title={CHAIN_NAME}
      className={className}
      buttonClassName="inline-flex min-h-control-sm items-center gap-2 rounded-pill border border-border bg-surface px-3 text-body-s text-ink-secondary transition-colors duration-fast ease-standard hover:border-border-strong hover:text-ink"
      button={
        <>
          <NetworkGlyph className="size-4" />
          {CHAIN_NAME}
        </>
      }
      panelClassName="w-80"
    >
      <NetworkDetails />
    </Popover>
  );
}

/** Where the numbers come from: the sample line on the mock, the block and its age on the chain. */
export function DataLine(): JSX.Element {
  const market = useMarket();
  const wall = useWallClock();
  if (DATA_SOURCE === 'mock') return <>{SAMPLE_DATA_LINE}</>;
  if (market.data === undefined) return <>{market.isError ? 'Chain data did not load.' : 'Reading the chain.'}</>;
  const age = BigInt(Math.max(0, Math.floor(((wall ?? market.dataUpdatedAt) - market.dataUpdatedAt) / 1_000)));
  return (
    <>
      Read at block <span className="tabular-nums">{market.data.asOf.l2Block.toLocaleString('en-US')}</span>,{' '}
      {age < 60n ? 'under a minute ago' : `${countdownLong(age)} ago`}.
    </>
  );
}

function NetworkDetails(): JSX.Element {
  return (
    <div className="space-y-2 p-4 text-body-s">
      <p className="flex items-center gap-2 font-medium text-ink">
        <NetworkGlyph className={cx('size-4 text-ink-secondary')} />
        {CHAIN_NAME}, chain id {CHAIN_ID}
      </p>
      <p className="text-ink-secondary">
        <DataLine />
      </p>
      <p className="border-t border-border pt-2 text-ink-secondary">{DISCLAIMER}</p>
    </div>
  );
}
