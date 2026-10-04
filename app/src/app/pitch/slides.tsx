import type { ReactNode } from 'react';

import { SleeveLogo } from '@/generated/brand/sleeve-logo';
import { DISCLAIMER } from '@/lib/copy';

import styles from './pitch.module.css';

export interface Footnote {
  n?: number;
  text: string;
}

export interface Slide {
  /** Read out by screen readers and shown in the notes panel. */
  title: string;
  /** Where the slide starts in the 2:45 voiceover. */
  at: string;
  body: ReactNode;
  /** Numbered notes match a <Ref> on the slide; the disclaimer carries no number. */
  footnotes?: readonly Footnote[];
  /**
   * The voiceover word for word. Paragraphs after the first that start with "Cue:" are directions for the speaker,
   * not script. A bracketed span is a placeholder still to fill and renders highlighted.
   */
  notes: string;
}

/**
 * A real capture from trysleeve.xyz, never a mockup: receipt 2, the first HP1 payments, taken while the market was
 * closed. Swap in a filled receipt, which shows the debt security line, once the keeper has bought at an open.
 */
const PRODUCT_SCREENSHOT: string | null = '/pitch/receipt-2.png';

/** Tim's picture, under public/pitch/. Null renders the placeholder. */
const FOUNDER_PHOTO: string | null = '/pitch/tim.jpeg';

/** A value only Tim can supply. Never fill one with an invented value. */
function Placeholder({ children }: { children: ReactNode }): ReactNode {
  return <mark className={styles.placeholder}>{children}</mark>;
}

function Green({ children }: { children: ReactNode }): ReactNode {
  return <span className={styles.green}>{children}</span>;
}

function Ref({ n }: { n: number }): ReactNode {
  return <sup className={styles.ref}>{n}</sup>;
}

export const SLIDES: readonly Slide[] = [
  {
    title: 'Sleeve',
    at: '0:00',
    body: (
      <div className={styles.title}>
        <SleeveLogo variant="horizontal" height={88} />
        <h1 className={styles.headline}>
          Part of every payment becomes <Green>a US Stock Token</Green> you own.
        </h1>
        <p className={styles.sub}>Live on Robinhood Chain mainnet, trysleeve.xyz</p>
      </div>
    ),
    footnotes: [{ text: DISCLAIMER }],
    notes:
      'Sleeve. When you get paid, part of it becomes a US Stock Token you own, and the rest stays spendable. You set it once.',
  },
  {
    title: 'The person',
    at: '0:10',
    body: (
      <div className={styles.stack}>
        <p className={styles.display}>Paid in digital dollars.</p>
        <p className={styles.display}>Means to invest every payday.</p>
        <p className={styles.displayMuted}>Mostly doesn&apos;t.</p>
      </div>
    ),
    notes:
      "We built it for a freelancer in Lagos, paid in digital dollars by clients abroad. She can already buy US Stock Tokens, and she means to every payday. Most paydays she doesn't, because each time it's a new decision: open a wallet, pick a moment, swap, check the price.",
  },
  {
    title: 'The missing default',
    at: '0:28',
    body: (
      <div className={styles.rows}>
        <p className={styles.rowMuted}>Payday, decide, swap, check, put off.</p>
        <p className={styles.rowGreen}>
          Payday, your rule, done.
          <Ref n={1} />
        </p>
      </div>
    ),
    footnotes: [
      { n: 1, text: 'Madrian and Shea, Quarterly Journal of Economics, 2001. Choi, Laibson, Madrian and Metrick, via Wharton.' },
    ],
    notes:
      "What's missing is a default. In the US, payroll deduction quietly turns wages into investments, and research on retirement saving keeps finding the same thing: a default outlasts a fresh decision. Nobody paid in digital dollars has one.",
  },
  {
    title: 'Why now',
    at: '0:45',
    body: (
      <ol className={styles.facts}>
        <li>
          Robinhood Chain went live in July 2026. Stock Tokens are offered in 120+ countries.
          <Ref n={1} />
        </li>
        <li>
          USDG is the chain&apos;s native dollar.
          <Ref n={2} />
        </li>
        <li>
          $1.37B in payroll ran through Rise. In Q1 2026, stablecoin withdrawals beat deposits by $154.5M.
          <Ref n={3} />
        </li>
      </ol>
    ),
    footnotes: [
      { n: 1, text: 'https://securitybrief.co.uk/story/robinhood-launches-chain-stock-tokens-in-120-countries' },
      { n: 2, text: 'https://docs.robinhood.com/chain' },
      { n: 3, text: 'https://stablecoininsider.org/rise-q1-2026-stablecoin-payroll-report/' },
    ],
    notes:
      'And the rails just arrived. Robinhood Chain went live in July, with Stock Tokens offered in more than a hundred and twenty countries and USDG as its native dollar. Stablecoin pay is already mainstream. One payroll platform, Rise, has processed over a billion dollars, and in a single quarter its stablecoin withdrawals beat deposits by a hundred and fifty million.',
  },
  {
    title: 'The product',
    at: '1:07',
    body: (
      <div className={styles.product}>
        {PRODUCT_SCREENSHOT === null ? (
          <div className={styles.shotSlot}>
            <Placeholder>[SCREENSHOT: A REAL SPLIT FROM TRYSLEEVE.XYZ, DEBT SECURITY LINE VISIBLE]</Placeholder>
          </div>
        ) : (
          // eslint-disable-next-line @next/next/no-img-element -- a fixed 1920 by 1080 stage, printed to PDF as is
          <img className={styles.shot} src={PRODUCT_SCREENSHOT} alt="Receipt 2 on trysleeve.xyz: a 1 USDG payment split into 0.50 USDG spendable and 0.50 USDG waiting to buy QQQ" />
        )}
        <p className={styles.caption}>
          Live on mainnet. The demo video shows every step.
          <Ref n={1} />
        </p>
      </div>
    ),
    footnotes: [
      {
        n: 1,
        text: 'Receipt 2 on trysleeve.xyz/receipts/2, a real mainnet payment on 4 October 2026, captured while the market was closed.',
      },
    ],
    notes:
      "So we made the payment address do the work. Share your Sleeve address once, and every USDG payment that lands is split by your rule. Part stays spendable, part buys the Stock Token you chose, and if the market's closed it waits. It's live on mainnet today, and the demo video shows every step.",
  },
  {
    title: 'Why it wins',
    at: '1:27',
    body: (
      <div className={styles.columns}>
        <div>
          <p className={styles.label}>Position</p>
          <p className={styles.statement}>It sits where money arrives.</p>
        </div>
        <div>
          <p className={styles.label}>Trust</p>
          <p className={styles.statement}>Your account. Receipts anyone can check.</p>
        </div>
        <div>
          <p className={styles.label}>Chain</p>
          <p className={styles.statement}>
            Recurring demand, not speculation.
            <Ref n={1} />
          </p>
        </div>
      </div>
    ),
    footnotes: [
      { n: 1, text: "CoinDesk, 13 July 2026, real-world assets near 4 percent of value locked in the chain's first weeks." },
    ],
    notes:
      'Three reasons it wins. Position: Sleeve sits where money arrives, like direct deposit, so it runs without anyone opening an app. Trust: the money stays in your own account, and every split leaves a receipt anyone can check. And the chain gets recurring, income-driven demand for Stock Tokens instead of speculation.',
  },
  {
    title: 'The model',
    at: '1:55',
    body: (
      <dl className={styles.model}>
        <dt>Today</dt>
        <dd>No fee.</dd>
        <dt>Next</dt>
        <dd>
          A small flat fee on <Green>the equity share</Green> only.
        </dd>
        <dt>Then</dt>
        <dd>Payroll and invoicing platforms offer Sleeve as a payout option.</dd>
      </dl>
    ),
    notes:
      'The model is simple. No fee today. Next, a small flat fee on the equity share only, never on the money you spend. Then payroll and invoicing platforms offer Sleeve as a payout option that makes every payout worth more.',
  },
  {
    title: 'Traction and roadmap',
    at: '2:10',
    body: (
      <div className={styles.roadmap}>
        <p className={styles.traction}>
          Live: 10 payments split, 10 receipts verified.
          <Ref n={1} />
        </p>
        <ol className={styles.timeline}>
          <li>
            <span className={styles.label}>30 days</span>
            <span className={styles.step}>
              Pay links, cross-chain pay, borrow without selling <small className={styles.gated}>Not available yet</small>
            </span>
          </li>
          <li>
            <span className={styles.label}>60 days</span>
            <span className={styles.step}>First payroll integration, 100 earners</span>
          </li>
          <li>
            <span className={styles.label}>90 days</span>
            <span className={styles.step}>
              1,000 earners
              <Ref n={2} />
            </span>
          </li>
        </ol>
      </div>
    ),
    footnotes: [
      {
        n: 1,
        text: 'Receipts 1 to 10, 4 October 2026: 1 USDG each from one test payer to two campaign accounts, every receipt matched on the public RPC. results/hp1/RECEIPTS.md, trysleeve.xyz/verify.',
      },
      {
        n: 2,
        text: 'Targets, not forecasts: milestones M1 to M3 of the Sleeve plan. Not available yet: borrowing, until a lending market accepts Stock Tokens as collateral, and cross-chain pay, until a route has been sent.',
      },
    ],
    notes:
      'Where we are: live on mainnet, with ten real payments split. In thirty days, pay links, payments from other chains, and borrowing against Stock Tokens once a lending market supports it. In sixty, our first payroll integration and a hundred earners. In ninety, a thousand.\n\nCue: none of the thirty-day items is live, so on screen they carry Not available yet.',
  },
  {
    title: 'Team and ask',
    at: '2:32',
    body: (
      <div className={styles.team}>
        <div className={styles.founder}>
          {FOUNDER_PHOTO === null ? (
            <div className={styles.photoSlot}>
              <Placeholder>[TIM&apos;S PHOTO]</Placeholder>
            </div>
          ) : (
            // eslint-disable-next-line @next/next/no-img-element -- a fixed 1920 by 1080 stage, printed to PDF as is
            <img className={styles.photo} src={FOUNDER_PHOTO} alt="Tim" />
          )}
          <div>
            <p className={styles.name}>Tim</p>
            <p className={styles.record}>
              60+ products shipped. 19 hackathon wins. 15+ ecosystems.
              <Ref n={1} />
            </p>
          </div>
        </div>
        <p className={styles.ask}>
Looking for: one payroll or invoicing platform to pilot Sleeve payouts.
        </p>
        <div className={styles.close}>
          <SleeveLogo variant="stacked" height={168} />
          <p className={styles.tagline}>Set the split once. Every payment sorts itself.</p>
        </div>
      </div>
    ),
    footnotes: [{ n: 1, text: "Tim's own record." }, { text: DISCLAIMER }],
    notes:
      "I'm Tim, a protocol engineer in Lagos. I've shipped more than sixty products and won nineteen hackathons building across fifteen ecosystems, and I built Sleeve because I want it for my own payments. We're looking for one payroll or invoicing platform to pilot Sleeve as a payout option. Set the split once. Every payment sorts itself.",
  },
];
