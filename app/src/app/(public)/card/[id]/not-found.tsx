import type { JSX } from 'react';

import { PublicFrame } from '../../verify/public-frame';
import { CardMissing } from './card-screen';

/** A link that names no card: the id has the wrong shape, or the card store has no card by that id. */
export default function CardNotFound(): JSX.Element {
  return (
    <PublicFrame width="content">
      <CardMissing />
    </PublicFrame>
  );
}
