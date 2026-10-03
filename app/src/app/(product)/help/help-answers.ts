import { CHAIN_NAME } from '@sleeve/core';

import { SECTION_IDS } from '@/components/landing/copy';
import { DISCLOSURE_PATH } from '@/components/shell/site-map';
import { DEBT_SECURITY_LINE, EXIT_LINE, ISSUER_NAME } from '@/lib/copy';
import { NO_RECOVERY_LINE, RECOVERY_WALLET_LINE } from '@/lib/signer';

/**
 * The owner's common questions, each answered in plain words and pointed at the screen that does the thing
 * (D-029). The cost, custody, holding and eligibility answers say what the landing's questions say, so the two
 * never disagree. Search reads the question, the answer and the extra words people use for it.
 */

export interface HelpLink {
  href: string;
  label: string;
}

export interface HelpAnswer {
  /** The anchor, so other screens can link to one answer: /help#getting-out. */
  id: string;
  question: string;
  paragraphs: readonly string[];
  links: readonly HelpLink[];
  /** Other words people search for it by. */
  keywords: readonly string[];
}

export const HELP_ANSWERS: readonly HelpAnswer[] = [
  {
    id: 'where-money-went',
    question: 'Where did my money go?',
    paragraphs: [
      'Payments lists every USDG payment that reached your address and what it became: the part that stayed spendable, and the part that bought a Stock Token or waits as USDG to buy one.',
      'History lists every action Sleeve took for you, newest first, and each one opens to its details.',
    ],
    links: [
      { href: '/payments', label: 'Open Payments' },
      { href: '/history', label: 'Open History' },
    ],
    keywords: ['payment', 'split', 'arrived', 'missing', 'balance', 'spendable'],
  },
  {
    id: 'holdings',
    question: 'Where are my holdings?',
    paragraphs: [
      `Holdings lists the Stock Tokens in your account on ${CHAIN_NAME}, each valued at the Chainlink reference price, with the buys that make it up.`,
      'They sit in your own smart account, not with Sleeve.',
    ],
    links: [{ href: '/holdings', label: 'Open Holdings' }],
    keywords: ['portfolio', 'Stock Tokens', 'spy', 'qqq', 'nvda', 'aapl', 'value'],
  },
  {
    id: 'send',
    question: 'How do I withdraw or send USDG?',
    paragraphs: [
      'Your spendable USDG is already in your own account. To move it, choose Send on Home, enter the address and the amount, check what moves, then sign.',
      'Send only spendable USDG. USDG that waits to buy a Stock Token can move to spend first, from the same screen that shows why it waits.',
    ],
    links: [{ href: '/home', label: 'Go to Home' }],
    keywords: ['withdraw', 'send', 'transfer', 'move', 'cash out', 'pay'],
  },
  {
    id: 'waiting',
    question: 'Why is my money waiting?',
    paragraphs: [
      "The equity share of a payment waits as USDG in your account when the market is closed, when the price sits further above the Chainlink reference than your cap allows, or when it is below your minimum buy. The app says which, and when Sleeve tries again.",
      'Waiting USDG is yours. You can move it to spend at any time, and nothing checks the market for that.',
    ],
    links: [
      { href: '/home', label: 'See what waits on Home' },
      { href: '/rule', label: 'Check your cap and minimum buy' },
    ],
    keywords: ['waiting', 'queued', 'closed', 'market', 'premium', 'cap', 'release', 'minimum'],
  },
  {
    id: 'what-i-bought',
    question: 'What did I buy, and at what price?',
    paragraphs: [
      'Every buy opens to its details: the Stock Token and how much of it, the all-in price measured from what left and entered your account, and how far that was above or below the Chainlink reference at the time.',
      'Anyone can check a split against public chain data on the Check a split page.',
    ],
    links: [
      { href: '/history', label: 'Open History' },
      { href: '/verify', label: 'Check a split' },
    ],
    keywords: ['price', 'bought', 'fill', 'premium', 'reference', 'chainlink', 'receipt', 'record'],
  },
  {
    id: 'stock-token',
    question: 'Is a Stock Token the same as the stock?',
    paragraphs: [
      `No. A Stock Token is a ${DEBT_SECURITY_LINE}, issued by ${ISSUER_NAME}. It tracks a US stock or fund and gives you no rights in, or against, the company or fund behind it.`,
      "The issuer's own disclosure says so word for word.",
    ],
    links: [
      { href: DISCLOSURE_PATH, label: 'Read the issuer disclosure' },
      { href: '/holdings', label: 'Open Holdings' },
    ],
    keywords: ['debt security', 'stock', 'own', 'rights', 'issuer', 'disclosure', 'vote'],
  },
  {
    id: 'cost',
    question: 'What does it cost?',
    paragraphs: [
      'This version charges no Sleeve fee. A buy pays the pool fee and any premium inside your cap, and its record shows the all-in price.',
      'Sleeve pays the gas for splits and covers the gas for your own actions, within a limit.',
    ],
    links: [{ href: '/rule', label: 'Set your price cap' }],
    keywords: ['fee', 'fees', 'gas', 'price', 'charge', 'premium'],
  },
  {
    id: 'sell-back',
    question: 'How do I sell back to USDG?',
    paragraphs: [
      'Open Holdings and choose Sell back on a Stock Token. The sale goes through the same check against the Chainlink price, and the USDG lands in spend.',
      'While the market is closed, a sell waits unless you choose to override that one sell.',
      EXIT_LINE,
    ],
    links: [
      { href: '/holdings', label: 'Open Holdings' },
      { href: '/sell', label: 'Sell back' },
    ],
    keywords: ['sell', 'sale', 'exit', 'cash', 'redeem', 'swap'],
  },
  {
    id: 'getting-out',
    question: 'How do I get out if Sleeve disappears?',
    paragraphs: [
      `Your USDG and Stock Tokens stay in your own smart account on ${CHAIN_NAME}, and Sleeve never takes custody of them.`,
      `A recovery wallet is the way in that does not need Sleeve. ${RECOVERY_WALLET_LINE}`,
      NO_RECOVERY_LINE,
    ],
    links: [{ href: '/settings', label: 'See your recovery signer' }],
    keywords: ['recovery', 'custody', 'shut down', 'lost', 'passkey', 'wallet', 'backup', 'uninstall'],
  },
  {
    id: 'who-can-use',
    question: 'Who can use Sleeve?',
    paragraphs: [
      'People outside the United States who are paid in digital dollars, except where the issuer of Stock Tokens restricts or prohibits its offer.',
    ],
    links: [{ href: `/#${SECTION_IDS.eligibility}`, label: 'See the full list' }],
    keywords: ['eligible', 'country', 'countries', 'us', 'restricted', 'sign up', 'who'],
  },
];

/** Every word of the query must appear in the question, the answer or the keywords. */
export function matchesQuery(answer: HelpAnswer, query: string): boolean {
  const words = query.toLowerCase().split(/\s+/).filter((word) => word !== '');
  if (words.length === 0) return true;
  const haystack = [answer.question, ...answer.paragraphs, ...answer.keywords].join(' ').toLowerCase();
  return words.every((word) => haystack.includes(word));
}
