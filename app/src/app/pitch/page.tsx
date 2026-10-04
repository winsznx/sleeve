import type { JSX } from 'react';

import { PitchDeck } from './pitch-deck';
import { SLIDES } from './slides';

export default function PitchPage(): JSX.Element {
  return <PitchDeck slides={SLIDES} />;
}
