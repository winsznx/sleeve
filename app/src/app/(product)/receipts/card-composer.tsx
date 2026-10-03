'use client';

import type { Address } from '@sleeve/core';
import { useRouter } from 'next/navigation';
import { useId, useMemo, useState, type JSX } from 'react';

import { Button } from '@/components/ui/button';
import { Banner, ErrorBlock } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Checkbox, Select } from '@/components/ui/field';
import { useCreateCard, useReceipts } from '@/data/hooks';
import type { CreateCardInput } from '@/data/types';

import { weekOptions, type WeekOption } from './week';

/**
 * Makes a shareable card (PRD 7.10). The card always shows the ticker, the share of pay and the debt security
 * line; amounts and proof stay off until the owner turns them on. Proof adds receipt numbers, which lead anyone to
 * the account onchain, so it is added only after the owner reads that and confirms. The card's own page shows the
 * image and the download.
 */

export type CardSubject = { kind: 'receipt'; receiptId: bigint } | { kind: 'week'; account: Address };

/** Receipts read to find the weeks on offer: one data-layer page, a few months of steady paydays. */
const WEEK_SCAN_LIMIT = 100;

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

export interface CardComposerProps {
  open: boolean;
  onClose: () => void;
  subject: CardSubject;
}

export function CardComposer({ open, onClose, subject }: CardComposerProps): JSX.Element {
  const router = useRouter();
  const warningId = useId();
  const createCard = useCreateCard();
  const weekReceipts = useReceipts({
    account: subject.kind === 'week' ? subject.account : undefined,
    limit: WEEK_SCAN_LIMIT,
  });
  const [showAmounts, setShowAmounts] = useState(false);
  const [showProof, setShowProof] = useState(false);
  const [askingProof, setAskingProof] = useState(false);
  const [chosenWeek, setChosenWeek] = useState<string | null>(null);

  const weeks = useMemo(() => weekOptions(weekReceipts.data?.pages.flatMap((page) => page.items) ?? []), [weekReceipts.data]);
  const selectedWeek = weeks.find((week) => week.weekStart.toString() === chosenWeek) ?? weeks[0];
  const isWeek = subject.kind === 'week';
  const proof = proofWords(subject);

  function cardInput(): CreateCardInput | null {
    if (subject.kind === 'receipt') {
      return { subject: { kind: 'receipt', receiptId: subject.receiptId }, showAmounts, showProof };
    }
    if (selectedWeek === undefined) return null;
    return { subject: { kind: 'week', weekStart: selectedWeek.weekStart }, showAmounts, showProof };
  }

  function makeCard() {
    const input = cardInput();
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
    setShowProof(false);
    setAskingProof(false);
  }

  function confirmProof() {
    setShowProof(true);
    setAskingProof(false);
  }

  const subjectReady = !isWeek || selectedWeek !== undefined;

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title={isWeek ? 'Make a week card' : 'Make a card'}
      description="A card is an image you can share. It always shows the ticker, your share of pay and “debt security, not a share”. Amounts and your account stay off unless you add them."
      actions={
        <>
          <Button variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button onClick={makeCard} busy={createCard.isPending} busyLabel="Making card" disabled={!subjectReady || askingProof}>
            Make card
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-2">
        {isWeek ? (
          <WeekField
            state={weekReceipts}
            weeks={weeks}
            value={selectedWeek?.weekStart.toString() ?? ''}
            onChange={setChosenWeek}
          />
        ) : null}
        <Checkbox
          label="Show amounts"
          description={
            isWeek
              ? 'Adds the USDG that arrived that week and the USDG that bought Stock Tokens.'
              : 'Adds the USDG that arrived and what it bought.'
          }
          checked={showAmounts}
          onChange={(event) => setShowAmounts(event.target.checked)}
        />
        <Checkbox
          label="Show proof"
          description={proof.checkbox}
          checked={showProof}
          onChange={(event) => toggleProof(event.target.checked)}
        />
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
