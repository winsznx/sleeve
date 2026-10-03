'use client';

import Link from 'next/link';
import { useId, useState, type JSX, type ReactNode } from 'react';

import { tickerTokenKey } from '@/components/token/ticker-icon';
import type { TokenKey } from '@/components/token/registry';
import { TokenIcon } from '@/components/token/token-icon';
import { TokenPair } from '@/components/token/token-stack';
import { cx } from '@/components/ui/cx';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import { formatUtc } from '@/components/ui/format-time';
import { Icon } from '@/components/ui/icons';
import { Identicon } from '@/components/ui/identicon';
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import type { ActionPreview, MoneyPlace, PreviewAsset, PreviewLeg, PreviewPrice } from '@/data/types';
import { useSettings } from '@/lib/settings';

import {
  amountText,
  amountUnit,
  amountValue,
  blockText,
  capText,
  differenceText,
  feeAmountText,
  feeSentence,
  placeLabel,
  priceText,
  referenceText,
  ruleLines,
  warningText,
} from './preview-text';

/**
 * The transaction preview (D-029): what an owner action moves, from where to where, with each token's icon and
 * amount, the price against the market reference and the cap for a buy or a sale, the network fee and who pays it,
 * and what to know before signing. It stands in front of every owner action while previews are on, and it can turn
 * them off from here; Settings turns them back on.
 */

export const SETTINGS_HREF = '/settings';

function assetToken(asset: PreviewAsset): TokenKey | null {
  return asset.kind === 'USDG' ? 'USDG' : tickerTokenKey(asset.tickerId);
}

/** A place as a small chip: its mark, then its name. The words alone carry the meaning. */
function PlaceChip({ place }: { place: MoneyPlace }): JSX.Element {
  let mark: ReactNode;
  switch (place.kind) {
    case 'spend':
      mark = <span aria-hidden="true" className="size-2 rounded-pill bg-spend" />;
      break;
    case 'unsorted':
      mark = <span aria-hidden="true" className="size-2 rounded-pill border border-ink-muted" />;
      break;
    case 'waiting':
      mark = <span aria-hidden="true" className="size-2 rounded-pill bg-waiting-stripes ring-1 ring-inset ring-waiting" />;
      break;
    case 'holding': {
      const token = tickerTokenKey(place.tickerId);
      mark = token === null ? <span aria-hidden="true" className="size-2 rounded-pill bg-equity" /> : <TokenIcon token={token} size="xs" decorative />;
      break;
    }
    case 'outside':
      mark = <Identicon value={place.address} size="xs" />;
      break;
  }
  return (
    <span className="inline-flex min-w-0 items-center gap-1.5 rounded-pill border border-border bg-surface py-0.5 pl-1.5 pr-2.5 text-label text-ink">
      <span className="grid size-4 shrink-0 place-items-center">{mark}</span>
      <span className={cx('min-w-0 truncate', place.kind === 'outside' && 'font-mono')}>{placeLabel(place)}</span>
    </span>
  );
}

function LegRow({ leg }: { leg: PreviewLeg }): JSX.Element {
  const sent = assetToken(leg.sends.asset);
  const received = leg.receives === null ? null : assetToken(leg.receives.asset);
  const showsStockToken = leg.sends.asset.kind === 'STOCK_TOKEN' || leg.receives?.asset.kind === 'STOCK_TOKEN';
  return (
    <li className="flex gap-3 py-3 first:pt-0 last:pb-0">
      <span className="mt-0.5 flex w-11 shrink-0 items-start self-start">
        {sent !== null && received !== null ? (
          <TokenPair from={sent} to={received} size="md" surface="muted" decorative />
        ) : sent !== null ? (
          <TokenIcon token={sent} size="md" decorative />
        ) : null}
      </span>
      <div className="min-w-0 flex-1">
        <p className="text-body font-semibold tabular-nums text-ink">
          <span className="whitespace-nowrap">{amountValue(leg.sends)}</span> {amountUnit(leg.sends)}
          {leg.receives === null ? null : (
            <span className="font-normal text-ink-secondary">
              {' '}
              for about <span className="whitespace-nowrap font-semibold text-ink">{amountValue(leg.receives)}</span>{' '}
              <span className="font-semibold text-ink">{amountUnit(leg.receives)}</span>
            </span>
          )}
        </p>
        <p className="mt-1.5 flex flex-wrap items-center gap-1.5">
          <span className="sr-only">from </span>
          <PlaceChip place={leg.from} />
          <Icon name="arrowRight" className="size-3.5 text-ink-muted" />
          <span className="sr-only"> to </span>
          <PlaceChip place={leg.to} />
        </p>
        {leg.receives === null || leg.receives.minimum === 0n ? null : (
          <p className="mt-1.5 text-body-s text-ink-secondary">
            At least {amountText({ asset: leg.receives.asset, amount: leg.receives.minimum })}, or nothing moves.
          </p>
        )}
        {showsStockToken ? <DebtSecurityLine className="mt-1" /> : null}
      </div>
    </li>
  );
}

function Row({ term, children }: { term: string; children: ReactNode }): JSX.Element {
  return (
    <div className="grid gap-0.5 py-2.5 first:pt-0 last:pb-0 sm:grid-cols-[minmax(0,8.5rem)_minmax(0,1fr)] sm:gap-4">
      <dt className="text-body-s text-ink-secondary">{term}</dt>
      <dd className="min-w-0 text-body-s text-ink">{children}</dd>
    </div>
  );
}

function PriceRows({ price }: { price: PreviewPrice }): JSX.Element {
  return (
    <>
      <Row term={price.side === 'BUY' ? 'Buy price' : 'Sale price'}>
        <span className="font-semibold tabular-nums">{priceText(price)}</span>, from the pool quote
      </Row>
      <Row term="Market reference">
        <span className="tabular-nums">{referenceText(price)}</span>, Chainlink, updated {formatUtc(price.reference.updatedAt)}
      </Row>
      <Row term="Difference">
        <span className="flex items-start gap-1.5">
          <Icon
            name={price.withinCap ? 'check' : 'alert'}
            className={cx('mt-0.5 size-4', price.withinCap ? 'text-success' : 'text-warning')}
          />
          <span>
            {differenceText(price)}. {capText(price)}
          </span>
        </span>
      </Row>
    </>
  );
}

/** "Do not show this again": turns previews off for this browser and says where to turn them back on. */
function TurnOff(): JSX.Element {
  const settings = useSettings();
  const [turnedOff, setTurnedOff] = useState(false);
  if (turnedOff || !settings.previewsEnabled) {
    return (
      <p role="status" className="text-body-s text-ink-secondary">
        Previews are off from now on.{' '}
        <Link href={SETTINGS_HREF} className="font-medium text-link underline underline-offset-4 hover:text-link-hover">
          Turn them back on in Settings
        </Link>
      </p>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        settings.setPreviewsEnabled(false);
        setTurnedOff(true);
      }}
      className="self-start rounded-control text-body-s font-medium text-link underline underline-offset-4 hover:text-link-hover"
    >
      Do not show this again
    </button>
  );
}

export interface TransactionPreviewProps {
  preview: ActionPreview;
  /** Hide the "Do not show this again" link, where the owner cannot act on it. */
  hideTurnOff?: boolean;
  className?: string;
}

export function TransactionPreview({ preview, hideTurnOff = false, className }: TransactionPreviewProps): JSX.Element {
  const titleId = useId();
  const { legs, price, rule, fee, warnings, blocked } = preview;
  return (
    <section aria-labelledby={titleId} className={cx('min-w-0 rounded-large border border-border bg-surface-muted', className)}>
      <header className="flex items-center justify-between gap-3 border-b border-border px-4 py-3">
        <h3 id={titleId} className="flex items-center gap-2 text-body-s font-semibold text-ink">
          <Icon name="receipt" className="size-4 text-ink-secondary" />
          Preview
        </h3>
        <span className="text-label tabular-nums text-ink-muted">As of block {preview.asOf.l2Block.toLocaleString('en-US')}</span>
      </header>

      <div className="flex flex-col gap-4 p-4">
        {legs.length === 0 ? null : (
          <div>
            <h4 className="mb-2.5 text-label font-medium text-ink-secondary">What moves</h4>
            <ul className="divide-y divide-border">
              {legs.map((leg, index) => (
                <LegRow key={index} leg={leg} />
              ))}
            </ul>
          </div>
        )}

        {rule === null ? null : (
          <div>
            <h4 className="mb-2.5 text-label font-medium text-ink-secondary">Your rule, now and after</h4>
            <dl className="divide-y divide-border rounded-row border border-border bg-surface">
              {ruleLines(rule.before, rule.after).map((line) => (
                <div key={line.id} className="grid gap-0.5 px-3.5 py-2.5 text-body-s sm:grid-cols-[minmax(0,7.5rem)_minmax(0,1fr)] sm:gap-3">
                  <dt className="text-ink-secondary">{line.label}</dt>
                  <dd className="min-w-0 tabular-nums text-ink">
                    {line.changed ? (
                      <>
                        <span className="text-ink-secondary line-through decoration-ink-muted">{line.before}</span>{' '}
                        <span className="sr-only">changes to</span>
                        <Icon name="arrowRight" className="inline size-3.5 align-[-2px] text-ink-muted" />{' '}
                        <span className="font-semibold">{line.after}</span>
                      </>
                    ) : (
                      line.after
                    )}
                  </dd>
                </div>
              ))}
            </dl>
            {legs.length === 0 ? <p className="mt-2 text-body-s text-ink-secondary">No money moves. It applies from the next payment.</p> : null}
          </div>
        )}

        <dl className="divide-y divide-border">
          {price === null ? null : <PriceRows price={price} />}
          <Row term="Network fee">
            <span className="font-semibold tabular-nums">{feeAmountText(fee)}</span>. {feeSentence(fee)}
          </Row>
        </dl>

        {warnings.length === 0 ? null : (
          <div className="flex gap-3 rounded-row bg-warning-soft p-3.5">
            <Icon name="alert" className="mt-px text-warning" />
            <div className="min-w-0 text-body-s">
              <p className="font-semibold text-ink">Before you sign</p>
              <ul className="mt-1 flex flex-col gap-1 text-ink-secondary">
                {warnings.map((warning, index) => (
                  <li key={`${warning.code}-${index}`}>{warningText(warning)}</li>
                ))}
              </ul>
            </div>
          </div>
        )}

        {blocked === null ? null : (
          <div role="alert" className="flex gap-3 rounded-row border border-border bg-danger-soft p-3.5">
            <Icon name="alert" className="mt-px text-danger" />
            <div className="min-w-0 text-body-s">
              <p className="font-semibold text-ink">This will not go through now</p>
              <p className="mt-0.5 text-ink-secondary">{blockText(blocked)} Nothing moves.</p>
            </div>
          </div>
        )}

        {hideTurnOff ? null : <TurnOff />}
      </div>
    </section>
  );
}

export function TransactionPreviewSkeleton({ className }: { className?: string }): JSX.Element {
  return (
    <SkeletonGroup label="Reading the preview" className={cx('rounded-large border border-border bg-surface-muted', className)}>
      <div className="border-b border-border px-4 py-3">
        <Skeleton className="h-4 w-24" />
      </div>
      <div className="flex flex-col gap-3 p-4">
        <div className="flex gap-3">
          <Skeleton className="size-6 rounded-pill" />
          <div className="flex-1">
            <Skeleton className="h-4 w-40" />
            <Skeleton className="mt-2 h-5 w-56 max-w-full rounded-pill" />
          </div>
        </div>
        <Skeleton className="h-3.5 w-full" />
        <Skeleton className="h-3.5 w-2/3" />
      </div>
    </SkeletonGroup>
  );
}
