'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState, useSyncExternalStore, type JSX, type MouseEvent, type ReactNode } from 'react';

import { CardPreview } from '@/components/cards/card-preview';
import { CARD_FORMATS, CARD_FORMAT_KEYS, DEFAULT_CARD_FORMAT, type CardFormat, type CardLook } from '@/components/cards/card-options';
import type { CardTheme } from '@/components/cards/card-themes';
import { cardFacts, cardFileName, cardHolds, cardView, type CardFact, type CardView } from '@/components/cards/card-view';
import { ThemePicker } from '@/components/cards/theme-picker';
import { START_HREF, START_LABEL } from '@/components/landing/copy';
import { TokenPair, TokenStack } from '@/components/token/token-stack';
import { buttonClasses } from '@/components/ui/button-styles';
import { Button, ButtonLink } from '@/components/ui/button';
import { ErrorBlock, Note } from '@/components/ui/card';
import { SegmentedControl } from '@/components/ui/choice';
import { CopyField } from '@/components/ui/copy-field';
import { cx } from '@/components/ui/cx';
import { EmptyState } from '@/components/ui/empty-state';
import { Checkbox } from '@/components/ui/field';
import { Icon } from '@/components/ui/icons';
import { DefinitionList } from '@/components/ui/list';
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import { SplitMark } from '@/components/ui/wordmark';
import { useCard } from '@/data/hooks';
import { DATA_SOURCE } from '@/data/source';
import type { CardData } from '@/data/types';

import { useCardImage, type CardImageSource } from './use-card-image';

/**
 * A card someone shared (PRD 7.10, D-024). The preview is the card drawn in the page by the component next/og uses
 * for the PNG, so what a person sees is what they save. The look and the size are the viewer's to pick; the amounts
 * and the proof are the owner's choice, made when the card was made, and a viewer can only leave them off.
 */

/** What the server read when it drew the page. */
export type ServerCard = { status: 'found'; card: CardData } | { status: 'missing' } | { status: 'unavailable' };

export interface CardScreenProps {
  /** The opaque card id from the link. It never encodes the receipt or the account. */
  cardId: string;
  server: ServerCard;
  /** Where the page was served from, for the card's printed address. Null when the request named no host. */
  origin: string | null;
  /** The look the link asked for. */
  initialTheme: CardTheme;
}

const LINK = 'font-medium text-link underline underline-offset-4 hover:text-link-hover';

function subscribeToNothing(): () => void {
  return () => undefined;
}

/** A browser capability, false on the server so the first render matches the server's. */
function useBrowserSupports(check: () => boolean): boolean {
  return useSyncExternalStore(subscribeToNothing, check, () => false);
}

function canCopyImages(): boolean {
  return typeof ClipboardItem === 'function' && typeof navigator.clipboard?.write === 'function';
}

function canShareLinks(): boolean {
  return typeof navigator.share === 'function';
}

function browserOrigin(): string | null {
  return window.location.origin;
}

function serverOrigin(): string | null {
  return null;
}

export function CardScreen({ cardId, server, origin, initialTheme }: CardScreenProps): JSX.Element {
  const known = server.status === 'found' ? server.card : null;
  // A card the server could not read is read by this tab, which on the sample data layer may hold it.
  const read = useCard(known === null ? cardId : undefined);

  if (known !== null) return <CardStudio card={known} cardId={cardId} serverHasCard origin={origin} initialTheme={initialTheme} />;
  if (read.isError) {
    return (
      <>
        <ScreenHeader card={null} className="mb-6" />
        <ErrorBlock
          title="The card did not load"
          action={
            <Button variant="secondary" onClick={() => void read.refetch()}>
              Try again
            </Button>
          }
        >
          {read.error.message}
        </ErrorBlock>
      </>
    );
  }
  if (read.data === undefined) {
    return (
      <>
        <ScreenHeader card={null} />
        <CardLoading />
      </>
    );
  }
  if (read.data === null) return <CardMissing />;
  return <CardStudio card={read.data} cardId={cardId} serverHasCard={false} origin={origin} initialTheme={initialTheme} />;
}

/** A link that names no card, here or in the card store. */
export function CardMissing(): JSX.Element {
  return (
    <>
      <ScreenHeader card={null} className="mb-6" />
      <EmptyState
        title="No card at this link"
        action={
          <ButtonLink href="/" variant="secondary">
            See how Sleeve works
          </ButtonLink>
        }
      >
        The link may be cut short, or the card was never made. Ask the person who sent it for the full link.
      </EmptyState>
    </>
  );
}

function ScreenHeader({ card, className }: { card: CardData | null; className?: string }): JSX.Element {
  const title = card === null ? 'A Sleeve card' : card.kind === 'week' ? 'A week card' : 'A payday card';
  const description =
    card === null
      ? 'A picture of what a payday on a Sleeve account became.'
      : card.kind === 'week'
        ? 'One week of paydays on a Sleeve account, and the Stock Tokens they bought. It shows only what the owner chose to show.'
        : 'What one payday on a Sleeve account became. It shows only what the owner chose to show.';
  return (
    <header className={cx('min-w-0', className)}>
      <h1 className="text-h1 text-ink">{title}</h1>
      <p className="mt-2 max-w-reading text-body text-ink-secondary">{description}</p>
    </header>
  );
}

function CardLoading(): JSX.Element {
  return (
    <SkeletonGroup label="Loading the card" className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)] lg:gap-12">
      <div className="order-2 flex flex-col gap-6 lg:order-1">
        <Skeleton className="h-24 w-full rounded-row" />
        <Skeleton className="h-10 w-48 rounded-pill" />
        <Skeleton className="h-12 w-56 rounded-pill" />
      </div>
      <div className="order-1 rounded-card bg-surface-muted p-6 sm:p-10 lg:order-2">
        <Skeleton className="mx-auto aspect-[4/5] w-full max-w-[25rem] rounded-module" />
      </div>
    </SkeletonGroup>
  );
}

interface StudioProps {
  card: CardData;
  cardId: string;
  /** The server read this card, so it can draw the image by the card's id. */
  serverHasCard: boolean;
  origin: string | null;
  initialTheme: CardTheme;
}

const FORMAT_OPTIONS = CARD_FORMAT_KEYS.map((format) => ({ value: format, label: CARD_FORMATS[format].label }));

function CardStudio({ card, cardId, serverHasCard, origin, initialTheme }: StudioProps): JSX.Element {
  const pageOrigin = useSyncExternalStore(subscribeToNothing, browserOrigin, serverOrigin);
  const shownOrigin = origin ?? pageOrigin;
  const holds = cardHolds(card);
  const [theme, setTheme] = useState<CardTheme>(initialTheme);
  const [format, setFormat] = useState<CardFormat>(DEFAULT_CARD_FORMAT);
  const [amounts, setAmounts] = useState(true);
  const [proof, setProof] = useState(true);
  const look: CardLook = { theme, amounts, proof };
  // A sample card made in this tab has no address anyone else can open, so neither its preview nor its image prints one.
  const tabOnly = !serverHasCard && DATA_SOURCE === 'mock';
  const view = useMemo(
    () => cardView(tabOnly ? { ...card, cardId: '' } : card, { amounts, proof, origin: shownOrigin, sample: DATA_SOURCE === 'mock' }),
    [card, tabOnly, amounts, proof, shownOrigin],
  );
  const image = useCardImage(cardId, card, serverHasCard);
  const pageUrl = shownOrigin === null ? null : `${shownOrigin}/card/${cardId}`;
  const size = CARD_FORMATS[format];

  return (
    <>
      <div className="grid gap-6 lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)] lg:grid-rows-[auto_1fr] lg:gap-x-12 lg:gap-y-8">
        <ScreenHeader card={card} className="lg:col-start-1 lg:row-start-1" />

        <section aria-label="Card preview" className="min-w-0 lg:sticky lg:top-6 lg:col-start-2 lg:row-span-2 lg:row-start-1 lg:self-start">
          <div className="rounded-card bg-stage px-3 py-6 sm:px-10 sm:py-12">
            <CardPreview
              view={view}
              format={format}
              theme={theme}
              className={cx('mx-auto', format === 'post' ? 'max-w-[25rem]' : 'max-w-[40rem]')}
            />
          </div>
          <p className="mt-3 text-center text-body-s text-ink-secondary">
            {size.label}, {size.description}. The image you download is this card.
          </p>
        </section>

        <div className="flex min-w-0 flex-col gap-6 lg:col-start-1 lg:row-start-2">
          <ThemePicker value={theme} onChange={setTheme} />
          <SegmentedControl legend="Size" options={FORMAT_OPTIONS} value={format} onChange={setFormat} hint={size.description} />
          {holds.amounts || holds.proof ? (
            <fieldset className="min-w-0">
              <legend className="text-body-s font-semibold text-ink">On this image</legend>
              <p className="mt-1 text-body-s text-ink-secondary">The owner chose to show these. Leave one off the image you save.</p>
              {holds.amounts ? <Checkbox label="Amounts" checked={amounts} onChange={(event) => setAmounts(event.target.checked)} /> : null}
              {holds.proof ? (
                <Checkbox
                  label={card.proof !== null && card.proof.receiptIds.length > 1 ? 'Receipts and account' : 'Receipt and account'}
                  description="They lead anyone to the account onchain."
                  checked={proof}
                  onChange={(event) => setProof(event.target.checked)}
                />
              ) : null}
            </fieldset>
          ) : null}
          <CardActions
            image={image}
            view={view}
            format={format}
            look={look}
            pageUrl={pageUrl}
            fileName={cardFileName(view.kind, cardId, format)}
          />
          {pageUrl === null ? null : (
            <CopyField
              label="Link to this card"
              value={pageUrl}
              copyLabel="Copy link to this card"
              size="sm"
              hint={tabOnly ? 'This sample card lives in this browser tab, so the link opens it only here.' : undefined}
            />
          )}
        </div>
      </div>

      <CardWords view={view} facts={cardFacts(view, holds)} />
      <AboutSleeve />
    </>
  );
}

/* Actions ------------------------------------------------------------------------------------------------------- */

type Action = 'download' | 'copy' | 'share';
type ActionState =
  { action: Action; status: 'busy' } | { action: Action; status: 'done' } | { action: Action; status: 'failed'; message: string };

const DONE_MS = 4_000;

function isAbort(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError';
}

async function fetchImage(path: string): Promise<Blob> {
  const response = await fetch(path);
  if (!response.ok) throw new Error(`The image could not be drawn (${response.status}).`);
  return response.blob();
}

function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 0);
}

const DONE_TEXT: Record<Action, string> = {
  download: 'Download started.',
  copy: 'Image copied. Paste it into a post or a chat.',
  share: '',
};

/** Both labels share one grid cell, so the control keeps its width while it works (components/ui/button.tsx). */
function BusyLabel({ busy, label, busyLabel }: { busy: boolean; label: string; busyLabel: string }): JSX.Element {
  return (
    <span className="grid">
      <span aria-hidden={busy || undefined} className={cx('col-start-1 row-start-1', busy && 'invisible')}>
        {label}
      </span>
      <span aria-hidden={!busy || undefined} className={cx('col-start-1 row-start-1', !busy && 'invisible')}>
        {busyLabel}
      </span>
    </span>
  );
}

interface ActionsProps {
  image: CardImageSource;
  view: CardView;
  format: CardFormat;
  look: CardLook;
  pageUrl: string | null;
  /** The name the downloaded file is saved under. */
  fileName: string;
}

function CardActions({ image, view, format, look, pageUrl, fileName }: ActionsProps): JSX.Element {
  const canCopyImage = useBrowserSupports(canCopyImages);
  const canShare = useBrowserSupports(canShareLinks);
  const [state, setState] = useState<ActionState | null>(null);

  // A confirmation is a timer, outside React: it clears itself and is cancelled by the next action or unmount.
  useEffect(() => {
    if (state?.status !== 'done') return;
    const timer = window.setTimeout(() => setState(null), DONE_MS);
    return () => window.clearTimeout(timer);
  }, [state]);

  if (image.status === 'checking') {
    return (
      <div className="flex flex-col gap-2.5 sm:flex-row">
        <Button size="lg" icon="receive" busy busyLabel="Getting the image ready">
          Download image
        </Button>
      </div>
    );
  }
  if (image.status === 'failed') {
    return (
      <ErrorBlock
        title="The image service did not answer"
        action={
          <Button variant="secondary" onClick={image.retry}>
            Try again
          </Button>
        }
      >
        The card is still here as a preview and in words below.
      </ErrorBlock>
    );
  }
  if (image.status === 'unavailable') {
    return image.reason === 'sample-tab' ? (
      <Note title="This sample card has no image to download">
        It shows sample activity from this browser tab, and the image service draws only the shared sample history. Cards made from the
        sample paydays download as usual.
      </Note>
    ) : (
      <Note title="The image is not ready yet">The card is here as a preview and in words below. Try again in a minute.</Note>
    );
  }

  const path = image.path;
  const busy = (action: Action) => state?.action === action && state.status === 'busy';
  const downloadPath = path(format, look, true);

  async function download(event: MouseEvent<HTMLAnchorElement>) {
    event.preventDefault();
    if (busy('download')) return;
    setState({ action: 'download', status: 'busy' });
    try {
      saveBlob(await fetchImage(downloadPath), fileName);
      setState({ action: 'download', status: 'done' });
    } catch (error) {
      setState({ action: 'download', status: 'failed', message: error instanceof Error ? error.message : 'The image could not be saved.' });
    }
  }

  async function copyImage() {
    setState({ action: 'copy', status: 'busy' });
    try {
      // The item takes the promise, so the browser keeps the click's permission while the image is drawn.
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': fetchImage(path(format, look, false)) })]);
      setState({ action: 'copy', status: 'done' });
    } catch (error) {
      setState(
        isAbort(error)
          ? null
          : { action: 'copy', status: 'failed', message: 'This browser could not copy the image. Download it instead.' },
      );
    }
  }

  async function share() {
    if (pageUrl === null) return;
    setState({ action: 'share', status: 'busy' });
    try {
      await navigator.share({ title: view.kind === 'payday' ? 'A payday card on Sleeve' : 'A week card on Sleeve', url: pageUrl });
      setState(null);
    } catch (error) {
      // Closing the share sheet rejects with AbortError. That is the person's choice, not a failure.
      setState(isAbort(error) ? null : { action: 'share', status: 'failed', message: 'Sharing did not work here. Copy the link instead.' });
    }
  }

  const status = state === null || state.status === 'busy' ? '' : state.status === 'failed' ? state.message : DONE_TEXT[state.action];

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2.5 sm:flex-row sm:flex-wrap">
        <a
          href={downloadPath}
          download={fileName}
          onClick={download}
          aria-busy={busy('download') || undefined}
          className={buttonClasses({ size: 'lg' })}
        >
          <Icon name="receive" />
          <BusyLabel busy={busy('download')} label="Download image" busyLabel="Drawing the image" />
        </a>
        {canCopyImage ? (
          <Button size="lg" variant="secondary" icon="copy" onClick={copyImage} busy={busy('copy')} busyLabel="Copying">
            Copy image
          </Button>
        ) : null}
        {canShare && pageUrl !== null ? (
          <Button size="lg" variant="secondary" icon="share" onClick={share} busy={busy('share')} busyLabel="Sharing">
            Share link
          </Button>
        ) : null}
      </div>
      <p role="status" className={state?.status === 'failed' ? 'text-body-s text-danger' : 'text-body-s text-ink-secondary'}>
        {status}
      </p>
    </div>
  );
}

/* The card in words ----------------------------------------------------------------------------------------------- */

/** The token icons beside the facts that name a Stock Token, the way every token appears in the app. */
function factValue(fact: CardFact, view: CardView): ReactNode {
  const tokens = view.kind === 'payday' ? null : view.tokens.map((token) => token.key);
  if (fact.id === 'became' && view.kind === 'payday') {
    return (
      <span className="inline-flex items-start gap-2.5">
        <TokenPair from="USDG" to={view.token.key} size="sm" decorative className="mt-px" />
        <span>{fact.value}</span>
      </span>
    );
  }
  if (fact.id === 'bought' && tokens !== null && tokens.length > 0) {
    return (
      <span className="inline-flex items-start gap-2.5">
        <TokenStack tokens={tokens} size="sm" decorative className="mt-px" />
        <span>{fact.value}</span>
      </span>
    );
  }
  return fact.value;
}

function CardWords({ view, facts }: { view: CardView; facts: readonly CardFact[] }): JSX.Element {
  const receiptIds = view.proof?.receiptIds ?? [];
  return (
    <section
      aria-labelledby="card-words-title"
      className="mt-12 grid gap-4 border-t border-border pt-8 lg:grid-cols-[minmax(0,25rem)_minmax(0,1fr)] lg:gap-12"
    >
      <div>
        <h2 id="card-words-title" className="text-h2 text-ink">
          The card in words
        </h2>
        <p className="mt-2 text-body-s text-ink-secondary">
          {view.kind === 'payday' ? 'The day is a date, never a time.' : 'Weeks run Monday to Sunday in New York time, like the US market.'}{' '}
          Amounts and the account appear only when the owner showed them.
        </p>
      </div>
      <div className="min-w-0">
        <DefinitionList items={facts.map((fact) => ({ id: fact.id, term: fact.term, value: factValue(fact, view) }))} />
        {receiptIds.length === 0 ? null : (
          <p className="mt-3 flex flex-wrap gap-x-5">
            {receiptIds.map((id) => (
              <Link key={id.toString()} href={`/verify/${id}`} className={cx('inline-flex min-h-touch items-center text-body-s', LINK)}>
                Check receipt {id.toString()}
              </Link>
            ))}
          </p>
        )}
      </div>
    </section>
  );
}

/** For the people a card was sent to: what Sleeve is, and the way in. */
function AboutSleeve(): JSX.Element {
  return (
    <section
      aria-labelledby="about-sleeve-title"
      className="mt-12 flex flex-col gap-5 rounded-card border border-border bg-surface-muted p-5 sm:p-6 md:flex-row md:items-center md:justify-between"
    >
      <div className="flex min-w-0 items-start gap-3">
        <SplitMark className="mt-0.5" />
        <div className="min-w-0">
          <h2 id="about-sleeve-title" className="text-h3 text-ink">
            What Sleeve is
          </h2>
          <p className="mt-1 max-w-reading text-body-s text-ink-secondary">
            A payment address on Robinhood Chain that invests part of every payment. Each payday splits by your rule into spendable USDG and
            a Stock Token. When the market is closed, the Stock Token part waits as USDG and buys at the open.
          </p>
        </div>
      </div>
      <div className="flex shrink-0 flex-col gap-2.5 sm:flex-row">
        <ButtonLink href={START_HREF}>{START_LABEL}</ButtonLink>
        <ButtonLink href="/" variant="secondary">
          How Sleeve works
        </ButtonLink>
      </div>
    </section>
  );
}
