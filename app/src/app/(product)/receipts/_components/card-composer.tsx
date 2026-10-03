'use client';

import type { Address } from '@sleeve/core';
import { useRouter } from 'next/navigation';
import { useId, useMemo, useState, useSyncExternalStore, type JSX } from 'react';

import { CardPreview } from '@/components/cards/card-preview';
import { DEFAULT_CARD_THEME } from '@/components/cards/card-themes';
import { cardView, type CardView } from '@/components/cards/card-view';
import { Button } from '@/components/ui/button';
import { Banner, ErrorBlock } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Select } from '@/components/ui/field';
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import { useCreateCard, useReceipt, useReceipts, useRule, useSession } from '@/data/hooks';
import { useDataLayer } from '@/data/provider';
import type { CardData, ReceiptRecord } from '@/data/types';

import { cardInputOf, draftPaydayCard, draftWeekCard, type CardChoices, type WeekReceipts } from '../_lib/card-draft';
import { weekOptions, type WeekOption } from '../_lib/week';

/**
 * Makes a shareable card (PRD 7.10, D-024): a payday card for one buy, or a week card. The card always shows the
 * ticker, the share of pay and the debt security line; amounts and proof stay off until the owner turns them on.
 * Proof adds receipt numbers, which lead anyone to the account onchain, so it is added only after the owner reads
 * that and confirms.
 *
 * The card itself sits above the choices, drawn by the component the image routes draw the PNG with, from a draft
 * worked out of receipts already read (_lib/card-draft.ts). Each toggle shows at once what a person the card is
 * sent to will see. The card's own page then offers the look, the size and the download.
 */

export type CardSubject = { kind: 'receipt'; receiptId: bigint } | { kind: 'week'; account: Address };

/** Receipts read to find the weeks on offer: one data-layer page, a few months of steady paydays. */
const WEEK_SCAN_LIMIT = 100;

/** The preview's size: the link preview's shape, which keeps the dialog short. The card's page also makes a post. */
const PREVIEW_FORMAT = 'wide';

interface ProofWords {
  checkbox: string;
  title: string;
  warning: string;
  confirm: string;
}

function proofWords(subject: CardSubject): ProofWords {
  if (subject.kind === 'receipt') {
    return {
      checkbox: `Adds receipt ${subject.receiptId} and your account, so anyone can recompute the card.`,
      title: 'The receipt number reveals your account',
      warning: `Anyone can look up receipt ${subject.receiptId} on Robinhood Chain and find your payment address, its balance and every receipt it holds. A shared image cannot be taken back.`,
      confirm: 'Add the receipt number',
    };
  }
  return {
    checkbox: "Adds the week's receipt numbers and your account, so anyone can recompute the card.",
    title: 'Receipt numbers reveal your account',
    warning:
      'Anyone can look up these receipts on Robinhood Chain and find your payment address, its balance and every receipt it holds. A shared image cannot be taken back.',
    confirm: 'Add the receipt numbers',
  };
}

function subscribeToNothing(): () => void {
  return () => undefined;
}

/** The page's origin, for the card's link and proof lines; null on the server, so hydration matches. */
function useOrigin(): string | null {
  return useSyncExternalStore(
    subscribeToNothing,
    () => window.location.origin,
    () => null,
  );
}

interface DraftSource {
  subject: CardSubject;
  record: ReceiptRecord | null | undefined;
  weekReceipts: WeekReceipts | null;
  weekStart: bigint | null;
  ruleEquityBps: number | undefined;
  choices: CardChoices;
}

/** The card the choices would make now, or null while what it is drawn from is still loading. */
function draftCard({ subject, record, weekReceipts, weekStart, ruleEquityBps, choices }: DraftSource): CardData | null {
  if (ruleEquityBps === undefined) return null;
  if (subject.kind === 'receipt') {
    return record === null || record === undefined ? null : draftPaydayCard(record, ruleEquityBps, choices);
  }
  if (weekReceipts === null || weekStart === null) return null;
  return draftWeekCard(weekReceipts, subject.account, weekStart, ruleEquityBps, choices);
}

export interface CardComposerProps {
  open: boolean;
  onClose: () => void;
  subject: CardSubject;
}

export function CardComposer({ open, onClose, subject }: CardComposerProps): JSX.Element {
  const router = useRouter();
  const layer = useDataLayer();
  const warningId = useId();
  const origin = useOrigin();
  const session = useSession();
  const rule = useRule(session.data?.account);
  const createCard = useCreateCard();
  const receipt = useReceipt(subject.kind === 'receipt' ? subject.receiptId : undefined);
  const weekReceipts = useReceipts({
    account: subject.kind === 'week' ? subject.account : undefined,
    limit: WEEK_SCAN_LIMIT,
  });
  const [choices, setChoices] = useState<CardChoices>({ showAmounts: false, showProof: false });
  const [askingProof, setAskingProof] = useState(false);
  const [chosenWeek, setChosenWeek] = useState<string | null>(null);

  const read = useMemo((): WeekReceipts | null => {
    const data = weekReceipts.data;
    if (data === undefined) return null;
    return { records: data.pages.flatMap((page) => page.items), exhausted: !weekReceipts.hasNextPage };
  }, [weekReceipts.data, weekReceipts.hasNextPage]);
  const weeks = useMemo(() => weekOptions(read?.records ?? []), [read]);
  const selectedWeek = weeks.find((week) => week.weekStart.toString() === chosenWeek) ?? weeks[0];
  const weekStart = selectedWeek?.weekStart ?? null;
  const isWeek = subject.kind === 'week';
  const proof = proofWords(subject);
  const input = cardInputOf(subject, weekStart, choices);

  const draft = draftCard({ subject, record: receipt.data, weekReceipts: read, weekStart, ruleEquityBps: rule.data?.equityBps, choices });
  const view = draft === null ? null : cardView(draft, { amounts: true, proof: true, origin, sample: layer.source === 'mock' });
  const noWeeks = isWeek && weekReceipts.isSuccess && weeks.length === 0;

  let preview: PreviewState;
  if (rule.isError || receipt.isError || (subject.kind === 'receipt' && receipt.data === null)) preview = { kind: 'failed' };
  else if (view !== null) preview = { kind: 'ready', view };
  else if (isWeek && read !== null && rule.data !== undefined) preview = { kind: 'unavailable' };
  else preview = { kind: 'loading' };

  function makeCard() {
    if (input === null) return;
    createCard.mutate(input, {
      onSuccess: (card) => {
        onClose();
        router.push(`/card/${card.cardId}`);
      },
    });
  }

  function toggleProof(checked: boolean) {
    if (checked) {
      setAskingProof(true);
      return;
    }
    setChoices((current) => ({ ...current, showProof: false }));
    setAskingProof(false);
  }

  function confirmProof() {
    setChoices((current) => ({ ...current, showProof: true }));
    setAskingProof(false);
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isWeek ? 'Make a week card' : 'Make a payday card'}
      description="A card is an image you can share. It always shows the ticker, your share of pay and “debt security, not a share”. Amounts and your account stay off unless you add them."
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={makeCard} busy={createCard.isPending} busyLabel="Making card" disabled={input === null || askingProof}>
            Make card
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {isWeek ? (
          <WeekField state={weekReceipts} weeks={weeks} value={selectedWeek?.weekStart.toString() ?? ''} onChange={setChosenWeek} />
        ) : null}
        {noWeeks ? null : <Preview state={preview} />}
        <Checkbox
          label="Show amounts"
          description={
            isWeek
              ? 'Adds the USDG that arrived that week and the USDG that bought Stock Tokens.'
              : 'Adds the USDG that arrived and what it bought.'
          }
          checked={choices.showAmounts}
          onChange={(event) => setChoices((current) => ({ ...current, showAmounts: event.target.checked }))}
        />
        <Checkbox label="Show proof" description={proof.checkbox} checked={choices.showProof} onChange={(event) => toggleProof(event.target.checked)} />
        {askingProof ? (
          <Banner title={proof.title}>
            <p id={warningId}>{proof.warning}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {/* Focus moves to the choice, which reads the warning as its description. */}
              <Button size="sm" variant="secondary" onClick={confirmProof} aria-describedby={warningId} autoFocus>
                {proof.confirm}
              </Button>
              <Button size="sm" variant="ghost" onClick={() => setAskingProof(false)}>
                Keep it off
              </Button>
            </div>
          </Banner>
        ) : null}
        {createCard.isError ? (
          <ErrorBlock title="The card was not made" fundsStillHere className="mt-2">
            {createCard.error.message}
          </ErrorBlock>
        ) : null}
      </div>
    </Dialog>
  );
}

type PreviewState = { kind: 'loading' } | { kind: 'ready'; view: CardView } | { kind: 'unavailable' } | { kind: 'failed' };

const PREVIEW_NOTE = 'mb-2 rounded-row border border-dashed border-border-strong bg-surface-muted p-3.5 text-body-s text-ink-secondary';

/**
 * The card as it would be shared, above the choices so a toggle and its effect are seen together. A block of its
 * shape holds the place while its receipts load. When they cannot load, or do not reach back far enough to draw an
 * older week faithfully, the card can still be made and its page shows the image.
 */
function Preview({ state }: { state: PreviewState }): JSX.Element {
  if (state.kind === 'failed') {
    return <p className={PREVIEW_NOTE}>The preview did not load. The card can still be made, and its page shows the image.</p>;
  }
  if (state.kind === 'unavailable') {
    return <p className={PREVIEW_NOTE}>No preview for a week this far back. The card can still be made, and its page shows the image.</p>;
  }
  return (
    <figure className="mb-2 min-w-0">
      {state.kind === 'loading' ? (
        <SkeletonGroup label="Drawing the preview">
          <Skeleton className="aspect-[1200/630] w-full rounded-module" />
        </SkeletonGroup>
      ) : (
        <CardPreview view={state.view} format={PREVIEW_FORMAT} theme={DEFAULT_CARD_THEME} />
      )}
      <figcaption className="mt-2 text-body-s text-ink-muted">
        What anyone you send it to sees. The card&apos;s page offers other looks and a post size.
      </figcaption>
    </figure>
  );
}

interface WeekFieldProps {
  state: ReturnType<typeof useReceipts>;
  weeks: readonly WeekOption[];
  value: string;
  onChange: (weekStart: string) => void;
}

function WeekField({ state, weeks, value, onChange }: WeekFieldProps): JSX.Element {
  if (state.isError) {
    return (
      <ErrorBlock
        title="Your weeks did not load"
        action={
          <Button variant="secondary" size="sm" onClick={() => state.refetch()}>
            Try again
          </Button>
        }
      />
    );
  }
  if (state.isSuccess && weeks.length === 0) {
    return (
      <p className="py-2 text-body-s text-ink-secondary">
        No paydays yet. A week card needs a week with at least one payday or buy.
      </p>
    );
  }
  return (
    <Select
      label="Week"
      hint="Weeks run Monday to Sunday in New York time, like the US market."
      value={value}
      onChange={(event) => onChange(event.target.value)}
      disabled={!state.isSuccess}
      className="mb-2"
    >
      {state.isSuccess ? (
        weeks.map((week) => (
          <option key={week.weekStart.toString()} value={week.weekStart.toString()}>
            {week.label}
          </option>
        ))
      ) : (
        <option value="">Loading weeks</option>
      )}
    </Select>
  );
}
