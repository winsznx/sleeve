import { DISCLOSURE } from '@sleeve/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';

import { EYEBROWS, ONE_SENTENCE, START_LABEL } from '@/components/landing/copy';
import { resolveExampleReceiptId } from '@/components/landing/example-receipt';
import { LANDING_ANCHORS } from '@/components/shell/site-map';
import { createMockDataLayer } from '@/data/mock';
import { DataLayerProvider } from '@/data/provider';
import type { SleeveDataLayer, VerifyResult } from '@/data/types';
import { DEBT_SECURITY_LINE, EXIT_LINE, ISSUER_NAME } from '@/lib/copy';
import { disclosureParagraphs, readDisclosureText } from '@/lib/disclosure';
import { PROHIBITED_JURISDICTIONS, RESTRICTED_JURISDICTIONS } from '@/lib/jurisdictions';

import { lintText } from '../../../../scripts/copy-lint.mjs';

import LandingPage, { metadata } from './page';

const SECTION = {
  how: 'Get paid as usual. Your rule does the rest.',
  features: 'One rule, every payment',
  sleeves: 'Two sleeves, one account.',
  tickers: 'Four Stock Tokens at launch',
  proof: 'Every split is on chain, and anyone can recompute it.',
  eligibility: 'Who can use Sleeve',
  not: 'What Sleeve is not',
  questions: 'Know what you hold before you start.',
  start: 'Set it once, then get paid.',
} as const;

async function renderLanding(layer: SleeveDataLayer = createMockDataLayer()): Promise<HTMLElement> {
  const { container } = render(<DataLayerProvider dataLayer={layer}>{await LandingPage()}</DataLayerProvider>);
  return container;
}

function scene(): HTMLElement {
  return screen.getByRole('group', { name: 'Sample account: one payday and the account it landed in' });
}

function section(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

/** The card a heading names: closeout's articles carry their title as an h3. */
function card(title: string): HTMLElement {
  const article = screen.getByRole('heading', { name: title }).closest('article');
  if (article === null) throw new Error(`No card titled ${title}`);
  return article;
}

function details(id: string): HTMLDetailsElement {
  const element = document.getElementById(id);
  if (!(element instanceof HTMLDetailsElement)) throw new Error(`#${id} is not a details element`);
  return element;
}

function tabPanel(): HTMLElement {
  return screen.getByRole('tabpanel');
}

/** Every text node outside the issuer's verbatim disclosure, as a reader meets them. */
function visibleCopy(root: HTMLElement): string[] {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const lines: string[] = [];
  for (let node = walker.nextNode(); node !== null; node = walker.nextNode()) {
    const text = node.textContent?.trim() ?? '';
    if (text !== '' && node.parentElement?.closest('#issuer-disclosure > div') === null) lines.push(text);
  }
  return lines;
}

/** Waits until the sample account has loaded everywhere the page reads it. */
async function settled(): Promise<void> {
  await within(scene()).findByText('3,356.05');
  await within(section(SECTION.tickers)).findAllByText('Market closed');
}

afterEach(() => {
  window.history.replaceState(null, '', '/');
});

describe('landing hero', () => {
  it('leads with the PRD sentence as the headline, the badge, and the two ways in', async () => {
    await renderLanding();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(ONE_SENTENCE);
    expect(metadata.description).toBe(ONE_SENTENCE);
    expect(screen.getByText('A payment address that invests part of every payment')).toBeInTheDocument();
    expect(screen.getByText(/^Give payers your address\. Your rule splits every USDG payment/)).toBeInTheDocument();

    const starts = screen.getAllByRole('link', { name: START_LABEL });
    expect(starts.map((link) => link.getAttribute('href'))).toEqual(['/onboard', '/onboard']);
    expect(screen.getByRole('link', { name: 'How it works' })).toHaveAttribute('href', `#${LANDING_ANCHORS.how}`);
  });

  it('shows the example payday resolving into its two parts, with the debt security line', async () => {
    await renderLanding();
    const parts = await within(scene()).findByRole('list', { name: 'What the payment became' });
    expect(scene()).toHaveTextContent('Tuesday 22 September13:40UTC');
    expect(scene()).toHaveTextContent('Rule: 90% stays USDG, 10% buys SPY');
    expect(scene()).toHaveTextContent('Payment arrived1,200.00 USDGFrom 0x557f…99F0 on Robinhood Chain');
    expect(parts).toHaveTextContent('Stays spendable1,080.00 USDG90% of the payment, kept as USDG');
    expect(parts).toHaveTextContent('Became SPY0.155872 SPY');
    expect(parts).toHaveTextContent('For 120.00 USDG. Bought 0.04 percent above the market reference.');
    expect(within(parts).getByText(DEBT_SECURITY_LINE)).toBeInTheDocument();
  });

  it('shows the sample account: both sleeves, the rule split, holdings with the debt security line, and the app', async () => {
    await renderLanding();
    const hero = scene();
    expect(await within(hero).findByText('3,356.05')).toBeInTheDocument();
    expect(hero).toHaveTextContent('Payment address 0x3efE…9b36');
    const sleeves = within(hero).getByRole('list', { name: 'The two sleeves' });
    expect(sleeves).toHaveTextContent('Spend3,356.05USDG, ready to use');
    expect(sleeves).toHaveTextContent('Stock Tokens304.29USDG at Chainlink prices');
    expect(hero).toHaveTextContent('Each payment, by your rule90% stays USDG10% buys SPY');

    const held = within(hero).getByText('Stock Tokens held').parentElement;
    if (held === null) throw new Error('no holdings list');
    expect(held).toHaveTextContent('0.361668 SPYdebt security, not a share279.32 USDG');
    expect(held).toHaveTextContent('0.033504 QQQdebt security, not a share24.97 USDG');
    expect(within(hero).getAllByText(DEBT_SECURITY_LINE)).toHaveLength(3);

    const places = within(within(hero).getByRole('list', { name: 'In the app' })).getAllByRole('link');
    expect(places.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Payments', '/payments'],
      ['Holdings', '/holdings'],
      ['Rule', '/rule'],
      ['History', '/history'],
    ]);
  });

  it('floats the waiting buy with the time until the market opens, counted from chain time', async () => {
    await renderLanding();
    const hero = scene();
    const waiting = (await within(hero).findByText('Waiting to buy SPY')).closest('div.rounded-module');
    if (!(waiting instanceof HTMLElement)) throw new Error('no waiting card');
    expect(waiting).toHaveTextContent('75.00 USDGkept as USDG');
    expect(waiting).toHaveTextContent('Market opens in1d 6h');
    expect(waiting).toHaveTextContent('Sun 27 Sep, 20:00 New York time');
    expect(within(hero).getByText('Market closed')).toBeInTheDocument();
    expect(waiting.querySelector('[data-token="USDG"]')).not.toBeNull();
    expect(waiting.querySelector('[data-token="SPY"]')).not.toBeNull();
  });

  it('lists USDG and the four launch Stock Tokens under the scene, with the network as words', async () => {
    await renderLanding();
    const strip = screen.getByRole('list', { name: 'USDG and the launch Stock Tokens' });
    const items = within(strip).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual(['USDG', 'SPY', 'QQQ', 'NVDA', 'AAPL']);
    for (const item of items) expect(item.querySelector('[data-token]')).not.toBeNull();
    expect(screen.getByText(/^Built on Robinhood Chain\. Payments arrive in USDG/)).toBeInTheDocument();
  });

  it('explains the split without numbers when there is no example payday', async () => {
    const base = createMockDataLayer();
    await renderLanding({ ...base, getReceipt: () => Promise.resolve(null) });
    const hero = scene();
    expect(await within(hero).findByText('The suggested start')).toBeInTheDocument();
    expect(hero).toHaveTextContent('Every payment: 90% stays spendable and 10% buys SPY.');
    expect(hero).toHaveTextContent('The equity share buys a Stock Token');
    expect(within(hero).getByText(DEBT_SECURITY_LINE)).toBeInTheDocument();
    expect(within(hero).queryByText('3,356.05')).toBeNull();
    expect(await screen.findByText('No example receipt yet')).toBeInTheDocument();
    expect(await screen.findByText('The spend share of your first payment lands here as USDG.')).toBeInTheDocument();
    expect(screen.getByText('Your Stock Tokens show up here, each with its value at the Chainlink price.')).toBeInTheDocument();
  });

  it('holds the scene with placeholders, never a zero, while the sample account loads', async () => {
    const base = createMockDataLayer();
    await renderLanding({ ...base, getReceipt: () => new Promise(() => undefined) });
    const hero = scene();
    expect(within(hero).getAllByRole('status').every((status) => status.getAttribute('aria-busy') === 'true')).toBe(true);
    expect(within(hero).getByText('Loading an example payday')).toBeInTheDocument();
    expect(within(hero).getByText('Loading the sample account')).toBeInTheDocument();
    expect(within(hero).queryByText(/0\.00/)).toBeNull();
    expect(within(section(SECTION.how)).getByText('Loading the example payday')).toBeInTheDocument();
  });

  it('says the sample account did not load and loads it again on request', async () => {
    const base = createMockDataLayer();
    let down = true;
    await renderLanding({ ...base, getLedger: (account) => (down ? Promise.reject(new Error('RPC down')) : base.getLedger(account)) });
    const alert = await within(scene()).findByRole('alert');
    expect(alert).toHaveTextContent('Sample account did not load.');
    expect(within(scene()).queryByText('3,356.05')).toBeNull();
    down = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await within(scene()).findByText('3,356.05')).toBeInTheDocument();
  });
});

describe('how a payday works', () => {
  it('names the section with its eyebrow and walks the four steps as tabs, by mouse and keyboard', async () => {
    await renderLanding();
    const how = section(SECTION.how);
    expect(within(how).getByText(EYEBROWS.how)).toBeInTheDocument();
    const tabs = within(within(how).getByRole('tablist', { name: 'How a payday works' })).getAllByRole('tab');
    expect(tabs.map((tab) => tab.textContent)).toEqual([
      expect.stringMatching(/^01Share your address/),
      expect.stringMatching(/^02A payment arrives/),
      expect.stringMatching(/^03Your rule splits it/),
      expect.stringMatching(/^04It lands, or waits for the market/),
    ]);
    const [address, arrives, splits, lands] = tabs;
    if (address === undefined || arrives === undefined || splits === undefined || lands === undefined) throw new Error('four tabs');

    // The split leads, as closeout's second row does.
    expect(tabs.map((tab) => tab.getAttribute('aria-selected'))).toEqual(['false', 'false', 'true', 'false']);
    expect(tabs.map((tab) => tab.tabIndex)).toEqual([-1, -1, 0, -1]);
    expect(await within(tabPanel()).findByText('Payday, 22 Sep 2026, 13:40 UTC')).toBeInTheDocument();
    expect(tabPanel()).toHaveTextContent('1,080.00 USDGspendable120.00 USDGbecame SPY');
    expect(tabPanel()).toHaveTextContent(`0.155872 SPY in the account${DEBT_SECURITY_LINE}`);
    expect(tabPanel()).toHaveTextContent('10%of each payment buys SPY in the suggested start');

    fireEvent.click(lands);
    expect(lands).toHaveAttribute('aria-selected', 'true');
    expect(tabPanel()).toHaveAccessibleName(/^It lands, or waits for the market/);
    expect(tabPanel()).toHaveTextContent('Where the equity share went');
    expect(tabPanel()).toHaveTextContent(`0.155872 SPYLanded${DEBT_SECURITY_LINE}`);
    expect(tabPanel()).toHaveTextContent('75.00 USDGWaiting');
    expect(tabPanel()).toHaveTextContent('Kept as USDG to buy SPY after the market opens, Sun 27 Sep, 20:00 New York time.');
    expect(tabPanel()).toHaveTextContent('1%the suggested cap above the Chainlink price. Past it, the buy waits.');

    fireEvent.keyDown(lands, { key: 'ArrowDown' });
    expect(address).toHaveAttribute('aria-selected', 'true');
    expect(address).toHaveFocus();
    expect(tabPanel()).toHaveTextContent('Payment address0x3efE…9b36');
    expect(tabPanel()).toHaveTextContent('Robinhood Chain, chain id 4663');
    expect(tabPanel()).toHaveTextContent(/1address for every payer/);

    fireEvent.keyDown(address, { key: 'ArrowRight' });
    expect(arrives).toHaveFocus();
    expect(tabPanel()).toHaveTextContent('Payments');
    expect(within(tabPanel()).getAllByRole('listitem').length).toBe(3);
    expect(tabPanel()).toHaveTextContent('1 hourafter which anyone can start a split');

    fireEvent.keyDown(arrives, { key: 'ArrowUp' });
    expect(address).toHaveFocus();
    fireEvent.keyDown(address, { key: 'ArrowLeft' });
    expect(lands).toHaveFocus();
    fireEvent.keyDown(lands, { key: 'Home' });
    expect(address).toHaveFocus();
    fireEvent.keyDown(address, { key: 'End' });
    expect(lands).toHaveFocus();
    expect(tabs.filter((tab) => tab.tabIndex === 0)).toEqual([lands]);
  });

  it('lists the newest payments with what each one became, or that it is spendable until it splits', async () => {
    await renderLanding();
    const tabs = within(section(SECTION.how)).getAllByRole('tab');
    fireEvent.click(tabs[1] as HTMLElement);
    const rows = await within(tabPanel()).findAllByRole('listitem');
    expect(rows).toHaveLength(3);
    await waitFor(() => expect(rows[2]).toHaveTextContent('675.00 USDG spendable, 75.00 USDG waiting, market closed'));
    expect(rows[0]).toHaveTextContent('Spendable until your rule splits it');
    expect(rows[2]).toHaveTextContent('750.00 USDGSortedFrom 0x719D…265F');
    expect(within(tabPanel()).queryByText(DEBT_SECURITY_LINE)).toBeNull();
  });
});

describe('the three cards', () => {
  it('names the section and shows the suggested rule with the guards every rule carries', async () => {
    await renderLanding();
    expect(within(section(SECTION.features)).getByText(EYEBROWS.features)).toBeInTheDocument();
    const rule = card('It splits on arrival');
    expect(rule).toHaveTextContent('Spend share90%USDG');
    expect(rule).toHaveTextContent('Equity share10%SPY');
    expect(rule).toHaveTextContent('Price cap1.00 percentabove the Chainlink price');
    expect(rule).toHaveTextContent('Minimum buy25.00 USDGsmaller amounts wait and add up');
    expect(rule.id).toBe(LANDING_ANCHORS.rule);
  });

  it('shows the market session and the buy waiting for it on the featured card', async () => {
    await renderLanding();
    const waits = card('It waits for the market');
    expect(await within(waits).findByText('SPY market session')).toBeInTheDocument();
    expect(waits).toHaveTextContent('Closed for the weekend. Opens Sun 27 Sep, 20:00 New York time.');
    expect(waits).toHaveTextContent('Chain time Sat 26 Sep, 14:00 New York time');
    expect(waits).toHaveTextContent('Open Sunday 20:00 to Friday 20:00, New York time');
    expect(await within(waits).findByText(/waiting to buy SPY, kept as USDG in the account/)).toBeInTheDocument();
  });

  it('lays out a sell back to USDG as a swap at the Chainlink price, with the debt security line', async () => {
    await renderLanding();
    const sell = card('You can sell back to USDG');
    expect(await within(sell).findByText('You sell')).toBeInTheDocument();
    expect(sell).toHaveTextContent(`You sell0.08446 SPYSPY${DEBT_SECURITY_LINE}Oldest lot first, bought 21 Sep 2026`);
    expect(sell).toHaveTextContent('Worth65.23 USDGUSDGAt the Chainlink price, 772.32 USD per SPY');
    expect(sell).toHaveTextContent('Sleeve sells only within 1.00 percent of the Chainlink price. At this price, at least 64.57 USDG lands in spend.');
    expect(sell).toHaveTextContent('Market closed: the sell waits until Sun 27 Sep, 20:00 New York time, or you override that one sell.');
    expect(within(sell).getByRole('link', { name: 'Sell from Holdings' })).toHaveAttribute('href', '/holdings');
  });
});

describe('the two sleeves', () => {
  it('shows the spend sleeve and the Stock Tokens sleeve of the sample account', async () => {
    await renderLanding();
    const sleeves = section(SECTION.sleeves);
    expect(sleeves.id).toBe(LANDING_ANCHORS.sleeves);
    expect(within(sleeves).getByText(EYEBROWS.sleeves)).toBeInTheDocument();

    const spend = card('Spend');
    expect(await within(spend).findByText('ready to use')).toBeInTheDocument();
    expect(spend).toHaveTextContent('Not split yet165.80 USDG');
    expect(spend).toHaveTextContent('3,356.05USDGready to use');
    await waitFor(() => expect(spend).toHaveTextContent('675.00 USDGfrom a 750.00 USDG payment, 26 Sep 2026'));

    const tokens = card('Stock Tokens');
    expect(tokens.id).toBe(LANDING_ANCHORS.holdings);
    expect(await within(tokens).findByText('at Chainlink prices')).toBeInTheDocument();
    expect(tokens).toHaveTextContent('Waiting to buy SPY75.00 USDG');
    expect(tokens).toHaveTextContent(`0.361668 SPY${DEBT_SECURITY_LINE}3 lots279.32 USDG`);
    expect(tokens).toHaveTextContent(`0.033504 QQQ${DEBT_SECURITY_LINE}1 lot24.97 USDG`);
  });
});

describe('launch tickers', () => {
  it('shows each launch Stock Token with its feed, its pool and fee tier, and the session, live from the market read', async () => {
    await renderLanding();
    const tickers = section(SECTION.tickers);
    expect(await within(tickers).findByText('Sample market data. Market closed. Opens Sun 27 Sep, 20:00 New York time')).toBeInTheDocument();
    const spy = within(tickers).getByRole('article', { name: 'SPY' });
    expect(spy).toHaveTextContent('SPDR S&P 500 ETF Trust');
    expect(spy).toHaveTextContent(DEBT_SECURITY_LINE);
    expect(spy).toHaveTextContent('Chainlink price feed772.32 USDUpdated 25 Sep 2026, 16:03 UTC0x3197…9f6A');
    expect(spy).toHaveTextContent('Allowlisted Uniswap v3 pool, 0.05% fee771.97 USDGQuote for 100 USDG at block 73,280,794');
    expect(spy).toHaveTextContent('0.04 percent below the Chainlink price');
    expect(spy).toHaveTextContent('Session24 hours, 5 days a weekSunday 20:00 to Friday 20:00, New York time');
    expect(spy.querySelector('[data-token="SPY"]')).not.toBeNull();
    expect(within(tickers).getByRole('article', { name: 'AAPL' })).toHaveTextContent('Also allowlisted: 0.3% fee pool');
    for (const symbol of ['QQQ', 'NVDA', 'AAPL']) {
      const article = within(tickers).getByRole('article', { name: symbol });
      expect(article.querySelector(`[data-token="${symbol}"]`)).not.toBeNull();
      expect(article).toHaveTextContent(DEBT_SECURITY_LINE);
    }
  });

  it('keeps the static facts and offers a retry when the market read fails', async () => {
    const base = createMockDataLayer();
    let down = true;
    await renderLanding({ ...base, getMarket: () => (down ? Promise.reject(new Error('RPC down')) : base.getMarket()) });
    const tickers = section(SECTION.tickers);
    const alert = await within(tickers).findByRole('alert');
    expect(alert).toHaveTextContent('Live market data did not load.');
    expect(within(tickers).getByRole('article', { name: 'SPY' })).toHaveTextContent('Session24 hours, 5 days a week');
    expect(within(tickers).queryByText('772.32 USD')).toBeNull();
    down = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await within(tickers).findByText('772.32 USD')).toBeInTheDocument();
  });
});

describe('proof', () => {
  it('recomputes the example split on request and says it matches', async () => {
    await renderLanding();
    const proof = section(SECTION.proof);
    expect(within(proof).getByRole('link', { name: 'Check a split' })).toHaveAttribute('href', '/verify');
    expect(await within(proof).findByText('Not checked on this visit')).toBeInTheDocument();
    expect(proof).toHaveTextContent('Receipt 455, 22 Sep 2026, 13:40 UTCSample');
    expect(proof).toHaveTextContent(`Became0.155872 SPY${DEBT_SECURITY_LINE}`);
    fireEvent.click(within(proof).getByRole('button', { name: 'Recompute receipt 455' }));
    expect(await within(proof).findByText('Matches chain data')).toBeInTheDocument();
    expect(proof).toHaveTextContent(/checks matched, read through rpc\.mainnet\.chain\.robinhood\.com\./);
    expect(within(proof).getByRole('link', { name: 'See every check' })).toHaveAttribute('href', '/verify/455');
  });

  it('lists every field that differs when the verifier finds a mismatch', async () => {
    const base = createMockDataLayer();
    const mismatch = async (id: bigint): Promise<VerifyResult> => {
      const result = await base.verifyReceipt(id);
      return {
        ...result,
        status: 'MISMATCH',
        checks: result.checks.map((check) => (check.id === 'premium' ? { ...check, ok: false } : check)),
      };
    };
    await renderLanding({ ...base, verifyReceipt: mismatch });
    const proof = section(SECTION.proof);
    fireEvent.click(await within(proof).findByRole('button', { name: 'Recompute receipt 455' }));
    expect(await within(proof).findByText('Does not match chain data')).toBeInTheDocument();
    expect(proof).toHaveTextContent(/^.*1 of \d+ checks differ: Premium over the feed price\./);
  });

  it('keeps the trust section near the end, after the product it backs (D-024)', async () => {
    await renderLanding();
    const order = screen.getAllByRole('region').map((region) => region.getAttribute('aria-labelledby'));
    expect(order).toEqual([
      'hero-title',
      'how-title',
      'features-title',
      'sleeves-title',
      'tickers-title',
      'proof-title',
      'eligibility-title',
      'not-title',
      'faq-title',
      'cta-title',
    ]);
    expect(screen.getAllByRole('heading', { level: 2 }).filter((heading) => /receipt/i.test(heading.textContent ?? ''))).toEqual([]);
  });
});

describe('who can use it', () => {
  it('lists the places Sleeve is not open to, and what Sleeve is not', async () => {
    await renderLanding();
    const eligibility = section(SECTION.eligibility);
    expect(eligibility.id).toBe(LANDING_ANCHORS.eligibility);
    for (const country of [...Object.values(RESTRICTED_JURISDICTIONS), ...Object.values(PROHIBITED_JURISDICTIONS)]) {
      expect(within(eligibility).getByText(country)).toBeInTheDocument();
    }
    const not = within(section(SECTION.not)).getAllByRole('listitem');
    expect(not.map((item) => item.textContent)).toEqual([
      expect.stringMatching(/^Not a broker, and not the issuer/),
      expect.stringMatching(/^Not a custodian/),
      expect.stringMatching(/^Not the stock itself/),
      expect.stringMatching(/^Not a trading app/),
      expect.stringMatching(/^Not a promise about prices/),
    ]);
  });
});

describe('questions', () => {
  it('answers the holder questions in an accordion', async () => {
    await renderLanding();
    const faq = section(SECTION.questions);
    expect(faq.id).toBe(LANDING_ANCHORS.questions);
    expect(within(faq).getByText(EYEBROWS.questions)).toBeInTheDocument();
    expect(faq.querySelectorAll('details')).toHaveLength(7);
    expect([...faq.querySelectorAll('details > summary')].map((summary) => summary.textContent)).toEqual([
      'Is a Stock Token the same as the stock?',
      'Who holds my money?',
      'What if the market is closed?',
      'What does it cost?',
      'Who can use it?',
      'How do I get out?',
      'Issuer disclosure, word for word',
    ]);

    const holding = details(LANDING_ANCHORS.holding);
    expect(holding).toHaveTextContent(`No. A Stock Token is a ${DEBT_SECURITY_LINE}, issued by ${ISSUER_NAME}.`);
    expect(holding.open).toBe(false);
    fireEvent.click(within(holding).getByText('Is a Stock Token the same as the stock?'));
    await waitFor(() => expect(holding.open).toBe(true));

    expect(details('market-closed')).toHaveTextContent('The equity share waits as USDG in your account');
    expect(details('what-it-costs')).toHaveTextContent('This version charges no Sleeve fee.');
    expect(within(details('getting-out')).getByText(EXIT_LINE)).toBeInTheDocument();
    expect(within(details('who-can-sign-up')).getByRole('link', { name: 'See the full list' })).toHaveAttribute(
      'href',
      `#${LANDING_ANCHORS.eligibility}`,
    );
  });

  it('carries the issuer disclosure word for word, collapsed, and opens it for a link to it', async () => {
    await renderLanding();
    const disclosure = details('issuer-disclosure');
    expect(disclosure.open).toBe(false);
    for (const paragraph of disclosureParagraphs(await readDisclosureText())) {
      expect(within(disclosure).getByText(paragraph)).toBeInTheDocument();
    }
    expect(disclosure).toHaveTextContent(DISCLOSURE.keccak256);
    expect(disclosure).toHaveTextContent('retrieved 2 October 2026');
    expect(within(disclosure).getByRole('button', { name: 'Copy disclosure hash' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Read the issuer disclosure' })).toHaveAttribute('href', '#issuer-disclosure');

    window.history.replaceState(null, '', '#issuer-disclosure');
    window.dispatchEvent(new HashChangeEvent('hashchange'));
    expect(disclosure.open).toBe(true);
  });
});

describe('closing band', () => {
  it('offers the passkey or wallet sign-up and a way back into the app', async () => {
    await renderLanding();
    const band = section(SECTION.start);
    expect(within(band).getByText(EYEBROWS.start)).toBeInTheDocument();
    expect(within(band).getByRole('link', { name: START_LABEL })).toHaveAttribute('href', '/onboard');
    expect(within(band).getByRole('link', { name: 'Already set up? Open the app' })).toHaveAttribute('href', '/home');
  });
});

describe('copy', () => {
  it('passes the copy lint as rendered, outside the verbatim disclosure', async () => {
    const container = await renderLanding();
    await settled();
    fireEvent.click(await within(section(SECTION.proof)).findByRole('button', { name: 'Recompute receipt 455' }));
    await screen.findByText('Matches chain data');
    for (const tab of within(section(SECTION.how)).getAllByRole('tab')) fireEvent.click(tab);
    const findings = visibleCopy(container).flatMap((line) => lintText(line).map((finding) => `${finding.rule}: ${line}`));
    expect(findings).toEqual([]);
  });

  it('never offers a gated feature as a live control', async () => {
    await renderLanding();
    await settled();
    const controls = [...screen.queryAllByRole('link'), ...screen.queryAllByRole('button')];
    expect(controls.filter((control) => /borrow|pay link|basket|crew/i.test(control.textContent ?? ''))).toEqual([]);
  });

  it('names Robinhood Chain only as the network, and never calls a Stock Token tokenized stock', async () => {
    const container = await renderLanding();
    await settled();
    const text = visibleCopy(container).join(' ');
    expect(text).not.toMatch(/tokeni[sz]ed (stocks?|equit)/i);
    expect(text.match(/Robinhood(?! Chain| Assets \(Jersey\) Limited)/g) ?? []).toEqual([]);
  });
});

describe('example receipt', () => {
  it('uses the sample SPY buy with the mock, a configured id on chain, and none otherwise', () => {
    expect(resolveExampleReceiptId('mock', undefined)).toBe(455n);
    expect(resolveExampleReceiptId('chain', undefined)).toBeNull();
    expect(resolveExampleReceiptId('chain', ' 1207 ')).toBe(1207n);
    expect(() => resolveExampleReceiptId('chain', '0x4b7')).toThrow(/must be a receipt id/);
  });
});
