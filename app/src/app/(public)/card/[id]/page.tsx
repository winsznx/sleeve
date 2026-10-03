import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';

import { isCardId } from '@/components/cards/card-options';
import { DEFAULT_CARD_THEME, isCardTheme } from '@/components/cards/card-themes';
import { cardSummary, cardView } from '@/components/cards/card-view';
import { readSharedCard } from '@/components/cards/server/card-source';
import { requestOrigin } from '@/components/cards/server/request-origin';
import { DATA_SOURCE } from '@/data/source';

import { PublicFrame } from '../../verify/public-frame';
import { CardScreen, type ServerCard } from './card-screen';

interface CardPageProps {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ [key: string]: string | string[] | undefined }>;
}

/** A shared card is for the people it was sent to. Search engines are asked to leave it out. */
const ROBOTS: Metadata['robots'] = { index: false, follow: false };

/**
 * The title and description link previews show beside the card's image, in the card's own words. The image itself
 * comes from opengraph-image.tsx and twitter-image.tsx in this folder.
 */
export async function generateMetadata({ params }: Pick<CardPageProps, 'params'>): Promise<Metadata> {
  const { id } = await params;
  const read = isCardId(id) ? await readSharedCard(id) : null;
  if (read === null || read.status !== 'found') return { title: 'A Sleeve card', robots: ROBOTS };
  const view = cardView(read.card, { amounts: true, proof: true, origin: null, sample: DATA_SOURCE === 'mock' });
  return {
    title: view.kind === 'payday' ? 'A payday card' : 'A week card',
    description: cardSummary(view),
    robots: ROBOTS,
  };
}

/**
 * The server reads the card once and hands it to the page, so a person who opens a shared link sees the card at
 * once. A card the server has never seen, such as a sample card made in a browser tab, is read by the tab itself.
 */
export default async function CardPage({ params, searchParams }: CardPageProps): Promise<JSX.Element> {
  const { id } = await params;
  if (!isCardId(id)) notFound();
  const [read, query, origin] = await Promise.all([readSharedCard(id), searchParams, requestOrigin()]);
  // On Robinhood Chain the page and the tab read the same card store, so a card the server cannot find does not
  // exist. On the sample data layer the tab may hold a card the server never saw, so the tab gets to look.
  if (read.status === 'missing' && DATA_SOURCE !== 'mock') notFound();
  const theme = typeof query.theme === 'string' && isCardTheme(query.theme) ? query.theme : DEFAULT_CARD_THEME;
  const server: ServerCard = read.status === 'found' ? { status: 'found', card: read.card } : { status: read.status };
  return (
    <PublicFrame width="content">
      <CardScreen cardId={id} server={server} origin={origin} initialTheme={theme} />
    </PublicFrame>
  );
}
