import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import type { JSX } from 'react';

import { PublicFrame } from '../../verify/public-frame';
import { CardScreen } from './card-screen';

/** A shared card is for the people it was sent to. Search engines are asked to leave it out. */
export const metadata: Metadata = { title: 'Shared card', robots: { index: false, follow: false } };

/** Card ids are opaque (src/data/types.ts getCard). Anything outside this shape is not one, so it is not looked up. */
const CARD_ID = /^[A-Za-z0-9_-]{1,64}$/;

interface CardPageProps {
  params: Promise<{ id: string }>;
}

/** The card reads in the browser through the data layer; the page never echoes the id into the text. */
export default async function CardPage({ params }: CardPageProps): Promise<JSX.Element> {
  const { id } = await params;
  if (!CARD_ID.test(id)) notFound();
  return (
    <PublicFrame>
      <CardScreen cardId={id} />
    </PublicFrame>
  );
}
