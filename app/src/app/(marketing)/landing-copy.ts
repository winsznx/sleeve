/**
 * The sentence a stranger should repeat (PRD section 1), in its two sentences so the headline can set the second on
 * its own line. Render ONE_SENTENCE_PARTS; ONE_SENTENCE is the same words for metadata and tests.
 */
export const ONE_SENTENCE_PARTS = [
  'When you get paid, part of it becomes a US Stock Token you own and the rest stays spendable.',
  'You set it once.',
] as const;

export const ONE_SENTENCE: string = ONE_SENTENCE_PARTS.join(' ');
