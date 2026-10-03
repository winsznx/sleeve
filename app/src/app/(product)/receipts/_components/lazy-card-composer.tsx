'use client';

import dynamic from 'next/dynamic';

/**
 * The card composer draws the card art for its preview, the heaviest code on the pages that offer it, so it loads the
 * first time the owner asks for a card. Mount it only after that first request; until then nothing is fetched.
 */
export const LazyCardComposer = dynamic(() => import('./card-composer').then((module) => module.CardComposer), { ssr: false });
