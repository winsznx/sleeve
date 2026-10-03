/**
 * Where the marketing navbar, its phone sheet and the footer lead (D-024). The landing page carries the anchors;
 * the proof documents live with the source, so they link there once NEXT_PUBLIC_SLEEVE_SOURCE_URL names the public
 * repository, and to the landing's proof section until then.
 */

/** Section ids on the landing page. The landing must keep these ids for the links below to land. */
export const LANDING_ANCHORS = {
  how: 'how-it-works',
  sleeves: 'two-sleeves',
  rule: 'your-rule',
  holdings: 'holdings',
  tickers: 'launch-tickers',
  proof: 'proof',
  questions: 'questions',
  /** FAQ answers. */
  eligibility: 'who-can-use-it',
  holding: 'what-you-hold',
} as const;

export const APP_HOME = '/home';
export const VERIFY_PATH = '/verify';
/** The issuer's text exactly as receipts hash it (src/lib/disclosure.ts, which is server only). */
export const DISCLOSURE_PATH = '/disclosure/rhj-disclosure.txt';

function landing(anchor: string): string {
  return `/#${anchor}`;
}

/** The public repository, without a trailing slash, or null until the owner publishes it. */
export function sourceUrl(value: string | undefined = process.env.NEXT_PUBLIC_SLEEVE_SOURCE_URL): string | null {
  const trimmed = value?.trim().replace(/\/+$/, '') ?? '';
  return /^https:\/\/\S+$/.test(trimmed) ? trimmed : null;
}

/** A file in the repository on its default branch, or the landing's proof section while there is no public URL. */
export function sourceLink(path: string, source: string | null = sourceUrl()): string {
  return source === null ? landing(LANDING_ANCHORS.proof) : `${source}/blob/main/${path}`;
}

export function isExternal(href: string): boolean {
  return /^https?:\/\//.test(href);
}

export type ProductKey = 'how' | 'sleeves' | 'rule' | 'holdings';
export type ProofKey = 'check' | 'replay' | 'security' | 'gates';

export interface MenuLink<K extends string = string> {
  key: K;
  href: string;
  title: string;
  description: string;
}

export const PRODUCT_LINKS: readonly MenuLink<ProductKey>[] = [
  {
    key: 'how',
    href: landing(LANDING_ANCHORS.how),
    title: 'How a payday splits',
    description: 'USDG lands at your address and your rule splits it, with no step from you.',
  },
  {
    key: 'sleeves',
    href: landing(LANDING_ANCHORS.sleeves),
    title: 'The two sleeves',
    description: 'The spend share stays USDG. The equity share becomes a Stock Token you hold.',
  },
  {
    key: 'rule',
    href: landing(LANDING_ANCHORS.rule),
    title: 'Your rule',
    description: 'Pick the share of pay, the Stock Token and your price cap. Change it any time.',
  },
  {
    key: 'holdings',
    href: landing(LANDING_ANCHORS.holdings),
    title: 'Holdings and sell-back',
    description: 'What you hold at the Chainlink price, sold back to USDG through the same guard.',
  },
];

export function proofLinks(source: string | null = sourceUrl()): readonly MenuLink<ProofKey>[] {
  return [
    {
      key: 'check',
      href: VERIFY_PATH,
      title: 'Check a split',
      description: 'Enter a receipt number and recompute it from public chain data.',
    },
    {
      key: 'replay',
      href: sourceLink('docs/HP2_RESULTS.md', source),
      title: 'The price-discipline replay',
      description: 'Payments at sampled times, priced from Robinhood Chain quotes and feeds, under rules fixed before the run.',
    },
    {
      key: 'security',
      href: sourceLink('docs/audit/AUDIT_R1.md', source),
      title: 'Security and audit',
      description: 'What the module can move, what it never can, and the audit findings.',
    },
    {
      key: 'gates',
      href: sourceLink('docs/GATES.md', source),
      title: 'Gates',
      description: 'Each gate with its status, the date and the block it was checked at.',
    },
  ];
}

export interface FooterLink {
  href: string;
  label: string;
}

export interface FooterColumn {
  heading: string;
  links: readonly FooterLink[];
}

export function footerColumns(source: string | null = sourceUrl()): readonly FooterColumn[] {
  return [
    {
      heading: 'Product',
      links: [
        ...PRODUCT_LINKS.map((link) => ({ href: link.href, label: link.title })),
        { href: landing(LANDING_ANCHORS.tickers), label: 'Stock Tokens at launch' },
        { href: APP_HOME, label: 'Open the app' },
      ],
    },
    {
      heading: 'Proof',
      links: proofLinks(source).map((link) => ({ href: link.href, label: link.title })),
    },
    {
      heading: 'Legal',
      links: [
        { href: DISCLOSURE_PATH, label: 'Issuer disclosure' },
        { href: landing(LANDING_ANCHORS.holding), label: 'What a Stock Token is' },
        { href: landing(LANDING_ANCHORS.eligibility), label: 'Who can use Sleeve' },
      ],
    },
  ];
}

/** The landing's plain links beside the two menus. */
export const QUESTIONS_LINK: FooterLink = { href: landing(LANDING_ANCHORS.questions), label: 'Questions' };
