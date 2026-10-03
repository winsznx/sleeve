'use client';

import { TOTAL_BPS } from '@sleeve/core';
import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useMemo, useState, useSyncExternalStore, type JSX } from 'react';

import { SplitRail } from '@/components/sleeve/split-rail';
import { Button, ButtonLink } from '@/components/ui/button';
import { buttonClasses } from '@/components/ui/button-styles';
import { ErrorBlock } from '@/components/ui/card';
import { CopyField } from '@/components/ui/copy-field';
import { DebtSecurityLine } from '@/components/ui/debt-security-line';
import { EmptyState } from '@/components/ui/empty-state';
import { DefinitionList, type DefinitionItem } from '@/components/ui/list';
import { PageHeader } from '@/components/ui/page-header';
import { Skeleton, SkeletonGroup } from '@/components/ui/skeleton';
import { useCard } from '@/data/hooks';
import type { CardData } from '@/data/types';

import { CARD_HEIGHT, CARD_WIDTH, renderCardPng } from './card-image';
import { cardAltText, cardContent, cardFileName, type CardContent } from './card-content';

/**
 * A card someone shared (PRD 7.10). The image is drawn in the browser from the card's data and shown as the PNG
 * itself, so what a person sees is what they download, long-press or share. Where the browser cannot draw it, the
 * same words show as a card in the page.
 */

const LINK = 'font-medium text-link underline underline-offset-4 hover:text-link-hover';

function subscribeToNothing(): () => void {
  return () => undefined;
}

/** The page's own address; null on the server, so the first render matches the server's. */
function usePageUrl(): string | null {
  return useSyncExternalStore(
    subscribeToNothing,
    () => window.location.href,
    () => null,
  );
}

type CardImage = { status: 'drawing' } | { status: 'failed' } | { status: 'ready'; url: string; file: File; canShare: boolean };

function canShareFile(file: File): boolean {
  return typeof navigator.canShare === 'function' && typeof navigator.share === 'function' && navigator.canShare({ files: [file] });
}

/** Draws the PNG once per content. The canvas, the fonts and the object URL live outside React. */
function useCardImage(content: CardContent): CardImage {
  const [drawn, setDrawn] = useState<{ content: CardContent; image: CardImage } | null>(null);

  useEffect(() => {
    let cancelled = false;
    let url: string | null = null;
    renderCardPng(content).then(
      (blob) => {
        if (cancelled) return;
        const file = new File([blob], cardFileName(content), { type: 'image/png' });
        url = URL.createObjectURL(blob);
        setDrawn({ content, image: { status: 'ready', url, file, canShare: canShareFile(file) } });
      },
      (error: unknown) => {
        if (cancelled) return;
        console.error('The card image could not be drawn', error);
        setDrawn({ content, image: { status: 'failed' } });
      },
    );
    return () => {
      cancelled = true;
      if (url !== null) URL.revokeObjectURL(url);
    };
  }, [content]);

  // A drawing of an earlier content is out of date while the new one runs.
  return drawn !== null && drawn.content === content ? drawn.image : { status: 'drawing' };
}

/** The card in the page, for a browser that cannot draw the image. Same words, same order. */
function CardInPage({ content }: { content: CardContent }): JSX.Element {
  return (
    <div className="rounded-card bg-art-green p-3">
      <div className="rounded-large border border-accent-border bg-surface p-6">
        <div className="flex items-baseline justify-between gap-3">
          <span className="text-h2 text-ink">{content.brand}</span>
          <span className="text-body-s text-ink-secondary">{content.dateLine}</span>
        </div>
        <p className="mt-8 text-display-l tabular-nums text-equity">{content.figure}</p>
        <p className="mt-1 text-h2 text-ink">{content.headline}</p>
        <DebtSecurityLine className="mt-1" />
        {content.facts.length === 0 ? null : (
          <ul className="mt-4 text-body text-ink">
            {content.facts.map((fact) => (
              <li key={fact}>{fact}</li>
            ))}
          </ul>
        )}
        <SplitRail
          parts={{ spend: BigInt(TOTAL_BPS - content.equityBps), equity: BigInt(content.equityBps), waiting: 0n }}
          className="mt-8"
        />
        <p className="mt-2 flex flex-wrap justify-between gap-x-4 text-body-s">
          <span className="text-ink-secondary">{content.spendLabel}</span>
          <span className="font-medium text-equity">{content.equityLabel}</span>
        </p>
        {content.amounts === null ? null : <p className="mt-4 text-body font-medium text-ink">{content.amounts}</p>}
        {content.proof === null ? null : (
          <div className="mt-4 text-body-s">
            <p className="break-all font-mono text-mono text-ink">{content.proof.receipts}</p>
            <p className="break-all font-mono text-mono-s text-ink-secondary">{content.proof.account}</p>
            <p className="text-ink-secondary">{content.proof.verify}</p>
          </div>
        )}
        <p className="mt-6 border-t border-border pt-3 text-micro text-ink-secondary">{content.disclaimer}</p>
      </div>
    </div>
  );
}

function ShareImageButton({ file, url }: { file: File; url: string | null }): JSX.Element {
  const [failed, setFailed] = useState(false);

  async function shareImage() {
    setFailed(false);
    try {
      await navigator.share({ files: [file], title: 'Sleeve card', text: url ?? undefined });
    } catch (error) {
      // Closing the share sheet rejects with AbortError. That is the person's choice, not a failure.
      if (!(error instanceof DOMException && error.name === 'AbortError')) setFailed(true);
    }
  }

  return (
    <>
      <Button variant="secondary" size="lg" icon="share" onClick={shareImage}>
        Share image
      </Button>
      {failed ? (
        <p role="alert" className="text-body-s text-danger sm:basis-full sm:text-center">
          Sharing did not work here. Download the image instead.
        </p>
      ) : null}
    </>
  );
}

function CardActions({ image, content, pageUrl }: { image: CardImage; content: CardContent; pageUrl: string | null }): JSX.Element {
  if (image.status === 'failed') {
    return (
      <p role="status" className="text-center text-body-s text-ink-secondary">
        This browser could not draw the image, so the card shows as text. You can still send the link below.
      </p>
    );
  }
  return (
    <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:justify-center">
      {image.status === 'ready' ? (
        <a href={image.url} download={cardFileName(content)} className={buttonClasses({ size: 'lg' })}>
          Download PNG
        </a>
      ) : (
        <Button size="lg" busy busyLabel="Drawing the image">
          Download PNG
        </Button>
      )}
      {image.status === 'ready' && image.canShare ? <ShareImageButton file={image.file} url={pageUrl} /> : null}
    </div>
  );
}

function ShownList({ card, content }: { card: CardData; content: CardContent }): JSX.Element {
  const proof = content.proof;
  const items: DefinitionItem[] = [
    { id: 'always', term: 'Always', value: 'The ticker, the share of pay, the date and the line “debt security, not a share”.' },
  ];
  if (card.kind === 'week') {
    items.push({ id: 'week', term: 'The week', value: 'Monday to Sunday in New York time, the US market week.' });
  }
  items.push(
    { id: 'amounts', term: 'Amounts', value: card.amounts === null ? 'Hidden by the owner.' : 'Shown by the owner.' },
    {
      id: 'proof',
      term: 'Receipt numbers and account',
      value:
        proof === null ? (
          'Hidden by the owner. Nothing on this card leads to the account onchain.'
        ) : (
          <>
            <span className="block">Shown by the owner. Anyone can use them to find the account onchain.</span>
            <span className="mt-1 flex flex-wrap gap-x-4">
              {proof.receiptIds.map((id) => (
                <Link key={id.toString()} href={`/verify/${id}`} className={`inline-flex min-h-touch items-center ${LINK}`}>
                  Recompute receipt {id.toString()}
                </Link>
              ))}
            </span>
          </>
        ),
    },
  );
  return (
    <section aria-labelledby="card-shows-title" className="mt-10">
      <h2 id="card-shows-title" className="text-h3 text-ink">
        What this card shows
      </h2>
      <DefinitionList className="mt-2" items={items} />
    </section>
  );
}

function CardView({ card }: { card: CardData }): JSX.Element {
  const pageUrl = usePageUrl();
  const host = pageUrl === null ? null : new URL(pageUrl).host;
  const content = useMemo(() => cardContent(card, host), [card, host]);
  const image = useCardImage(content);
  const alt = cardAltText(content);

  return (
    <>
      <figure className="mx-auto w-full max-w-md">
        {image.status === 'ready' ? (
          <Image src={image.url} alt={alt} width={CARD_WIDTH} height={CARD_HEIGHT} unoptimized className="h-auto w-full rounded-card shadow-floating" />
        ) : image.status === 'failed' ? (
          <CardInPage content={content} />
        ) : (
          <SkeletonGroup label="Drawing the card">
            <Skeleton className="aspect-[4/5] w-full rounded-card" />
          </SkeletonGroup>
        )}
      </figure>
      <div className="mt-6">
        <CardActions image={image} content={content} pageUrl={pageUrl} />
      </div>
      {pageUrl === null ? null : (
        <CopyField label="Link to this card" value={pageUrl} copyLabel="Copy link to this card" size="sm" className="mt-8" />
      )}
      <ShownList card={card} content={content} />
      <p className="mt-10 max-w-reading text-body-s text-ink-secondary">
        Sleeve is a payment address on Robinhood Chain that invests part of every payment.{' '}
        <Link href="/" className={LINK}>
          How Sleeve works
        </Link>
      </p>
    </>
  );
}

export interface CardScreenProps {
  /** The opaque card id from the link. It never encodes the receipt or the account. */
  cardId: string;
}

export function CardScreen({ cardId }: CardScreenProps): JSX.Element {
  const card = useCard(cardId);
  const data = card.data;

  if (card.isPending) {
    return (
      <>
        <PageHeader title="A Sleeve card" />
        <SkeletonGroup label="Loading the card" className="mx-auto w-full max-w-md">
          <Skeleton className="aspect-[4/5] w-full rounded-card" />
        </SkeletonGroup>
      </>
    );
  }
  if (data === undefined) {
    return (
      <>
        <PageHeader title="A Sleeve card" />
        <ErrorBlock
          title="The card did not load"
          action={
            <Button variant="secondary" onClick={() => card.refetch()}>
              Try again
            </Button>
          }
        >
          Nothing on any account changed.
        </ErrorBlock>
      </>
    );
  }
  if (data === null) {
    return (
      <>
        <PageHeader title="A Sleeve card" />
        <EmptyState
          title="No card at this link"
          action={
            <ButtonLink href="/verify" variant="secondary">
              Verify a receipt instead
            </ButtonLink>
          }
        >
          The link may be cut short, or the card was never made. Ask the person who sent it for the full link.
        </EmptyState>
      </>
    );
  }
  return (
    <>
      <PageHeader
        title="A Sleeve card"
        description={
          data.kind === 'week'
            ? 'Made from one week of a Sleeve account. It shows only what the owner chose to show.'
            : 'Made from one buy on a Sleeve account. It shows only what the owner chose to show.'
        }
      />
      <CardView card={data} />
    </>
  );
}
