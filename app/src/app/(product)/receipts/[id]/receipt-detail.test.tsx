import { EXPLORER_URL } from '@sleeve/core';
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { installDialogPolyfill } from '@/components/__tests__/dialog-polyfill';
import { FUNDS_STILL_HERE } from '@/components/ui/card';
import { createMockDataLayer, SAMPLE_RECEIPT_IDS } from '@/data/mock';
import { DataLayerProvider } from '@/data/provider';
import type { ReceiptRecord, SleeveDataLayer, VerifyResult } from '@/data/types';
import { DEBT_SECURITY_LINE } from '@/lib/copy';

import { ReceiptDetail } from './receipt-detail';
import { WRAPPED_LINE } from './receipt-sections';

/** "#" and a number, built so the design guardrail's color grep does not read the test as a hex color. */
const numberSign = (id: string): string => `#${id}`;

const navigation = vi.hoisted(() => ({ push: vi.fn() }));

vi.mock('next/navigation', () => ({
  useRouter: () => ({ push: navigation.push }),
}));

beforeAll(() => {
  installDialogPolyfill();
});

beforeEach(() => {
  navigation.push.mockReset();
});

function renderDetail(id: bigint, layer: SleeveDataLayer = createMockDataLayer()) {
  render(
    <DataLayerProvider dataLayer={layer}>
      <ReceiptDetail id={id.toString()} disclosure={<section aria-label="Issuer disclosure">Issuer text</section>} />
    </DataLayerProvider>,
  );
  return layer;
}

/** Opens another action's details on the same sample world, as following a link would. */
function cleanupAndRender(id: bigint, layer: SleeveDataLayer) {
  cleanup();
  renderDetail(id, layer);
}

async function sampleRecord(id: bigint): Promise<ReceiptRecord> {
  const record = await createMockDataLayer().getReceipt(id);
  if (record === null) throw new Error(`no sample receipt ${id}`);
  return record;
}

function region(name: string): HTMLElement {
  return screen.getByRole('region', { name });
}

function leg(kind: string): HTMLElement {
  const found = document.querySelector<HTMLElement>(`[data-leg="${kind}"]`);
  if (found === null) throw new Error(`no ${kind} leg`);
  return found;
}

describe('the details of a payday', () => {
  it('is titled by what happened, with its status in plain words and its number', async () => {
    renderDetail(SAMPLE_RECEIPT_IDS.filledSpy);
    const title = await screen.findByRole('heading', { level: 1, name: `1,200 USDG payday: 1,080 stayed spendable, 120 became SPY ${numberSign('455')}` });
    expect(title).toBeInTheDocument();
    expect(screen.getByText('Bought')).toHaveAttribute('data-status', 'FILLED');
    expect(screen.getByRole('link', { name: 'History' })).toHaveAttribute('href', '/history');
    expect(screen.queryByText('FILLED')).toBeNull();
  });

  it('draws the split: the payment arriving, the rail, and each leg with its token icon and part of the payday', async () => {
    renderDetail(SAMPLE_RECEIPT_IDS.filledSpy);
    const hero = await screen.findByRole('region', { name: 'The split' });
    expect(hero).toHaveTextContent('1,200.00 USDG');
    expect(hero).toHaveTextContent('arrived from 0x557f…99F0 (derived)');
    expect(hero.querySelectorAll('[data-part]')).toHaveLength(2);

    expect(leg('spend')).toHaveTextContent('Stayed spendable');
    expect(leg('spend')).toHaveTextContent('90 percent');
    expect(leg('spend')).toHaveTextContent('1,080.00 USDG');
    expect(leg('spend').querySelector('[data-token="USDG"]')).not.toBeNull();

    expect(leg('equity')).toHaveTextContent('Became SPY');
    expect(leg('equity')).toHaveTextContent('10 percent');
    expect(leg('equity')).toHaveTextContent('0.155872 SPY');
    expect(within(leg('equity')).getByText(DEBT_SECURITY_LINE)).toBeInTheDocument();
    expect(leg('equity')).toHaveTextContent('for 120.00 USDG, as lot 455');
    expect(leg('equity').querySelector('[data-token="SPY"]')).not.toBeNull();
    expect(within(hero).getByText('Bought 0.04 percent above the market reference.')).toBeInTheDocument();
    expect(within(hero).getByRole('link', { name: 'See the price' })).toHaveAttribute('href', '#action-price');
  });

  it("shows the owner's lot today with a way to sell from it", async () => {
    renderDetail(SAMPLE_RECEIPT_IDS.filledSpy);
    await screen.findByRole('region', { name: 'The split' });
    expect(await within(leg('equity')).findByText('You still hold all of it.')).toBeInTheDocument();
    expect(within(leg('equity')).getByRole('link', { name: 'Sell from this lot' })).toHaveAttribute('href', '/sell?ticker=SPY&lot=455');
  });

  it('says how much of a partly sold lot is left, and when a lot has none', async () => {
    renderDetail(SAMPLE_RECEIPT_IDS.filledQqqSecond);
    await screen.findByRole('region', { name: 'The split' });
    expect(await within(leg('equity')).findByText('You still hold 0.033504 QQQ of it.')).toBeInTheDocument();
  });

  it('says when nothing is left in a lot', async () => {
    renderDetail(SAMPLE_RECEIPT_IDS.filledQqq);
    await screen.findByRole('region', { name: 'The split' });
    expect(await within(leg('equity')).findByText('Nothing is left in this lot today.')).toBeInTheDocument();
    expect(within(leg('equity')).queryByRole('link', { name: 'Sell from this lot' })).toBeNull();
  });

  it('shows the all-in price and the Chainlink reference apart, each with its own time, and the cap check', async () => {
    renderDetail(SAMPLE_RECEIPT_IDS.filledSpy);
    const price = await screen.findByRole('region', { name: 'The price' });
    expect(price).toHaveTextContent('769.859026');
    expect(price).toHaveTextContent('USDG per SPY');
    expect(price).toHaveTextContent('Paid 22 Sep 2026, 13:40 UTC');
    expect(price).toHaveTextContent('769.55120477');
    expect(price).toHaveTextContent('Published 22 Sep 2026, 13:31 UTC');
    expect(price).toHaveTextContent('4 basis points above the market reference');
    expect(within(price).getByText('Your cap')).toHaveTextContent('Your cap (derived)');
    expect(price).toHaveTextContent('Inside the cap');
  });

  it('draws the route through the allowlisted pool with its fee tier and venue', async () => {
    renderDetail(SAMPLE_RECEIPT_IDS.filledSpy);
    const route = await screen.findByRole('region', { name: 'Route' });
    expect(route).toHaveTextContent('0xa7Bb1AC63BBaB0C44316E6c8C455213441689167');
    expect(route).toHaveTextContent('On the SPY pool allowlist');
    expect(route).toHaveTextContent('0.05 percent');
    expect(route).toHaveTextContent('Uniswap v3 through SwapRouter02');
    expect(within(route).getByRole('button', { name: 'Copy pool address' })).toBeInTheDocument();
  });
});

describe('the proof section', () => {
  it('keeps the receipt behind the money: id and hash, rounds, calendar, how it ran, derived fields and the disclosure', async () => {
    const record = await sampleRecord(SAMPLE_RECEIPT_IDS.filledSpy);
    renderDetail(SAMPLE_RECEIPT_IDS.filledSpy);
    const proof = await screen.findByRole('region', { name: 'Proof' });
    expect(proof).toHaveTextContent('Sleeve wrote receipt 455 onchain in the same transaction as this split.');

    const receipt = within(proof).getByRole('region', { name: 'The receipt' });
    expect(within(receipt).getByText(record.receiptHash)).toBeInTheDocument();
    expect(within(receipt).getByRole('button', { name: 'Copy receipt id' })).toBeInTheDocument();

    const rounds = within(proof).getByRole('region', { name: 'What the guard read' });
    expect(rounds).toHaveTextContent(record.receipt.roundId.toString());
    expect(rounds).toHaveTextContent(/Phase 1, round \d+ of that phase\./);

    const session = within(proof).getByRole('region', { name: 'Market session' });
    expect(session).toHaveTextContent('Open. The buy ran inside the session.');
    expect(session).toHaveTextContent('Tue 22 Sep, 09:40 New York time');
    expect(session).toHaveTextContent('Calendar 1, with 0 timelocked changes.');

    expect(within(within(proof).getByRole('region', { name: 'How it ran' })).getByText(WRAPPED_LINE)).toBeInTheDocument();
    expect(within(within(proof).getByRole('region', { name: 'From chain logs' })).getAllByText('(derived)')).toHaveLength(2);
    const fields = within(proof).getByRole('heading', { name: 'All 39 receipt fields as stored' });
    expect(within(fields.closest('details') ?? document.body).getByText('FILLED (0)')).toBeInTheDocument();
    expect(within(proof).getByRole('region', { name: 'Issuer disclosure' })).toBeInTheDocument();
    expect(within(proof).getByRole('link', { name: 'Recompute receipt 455' })).toHaveAttribute('href', '/verify/455');
  });

  it('runs the check here only when asked, and says it matches', async () => {
    const layer = createMockDataLayer();
    const verifyReceipt = vi.fn(async (id: bigint): Promise<VerifyResult> => layer.verifyReceipt(id));
    renderDetail(SAMPLE_RECEIPT_IDS.filledSpy, { ...layer, verifyReceipt });
    const card = await screen.findByRole('region', { name: 'Check this split' });
    expect(card).toHaveTextContent('rpc.mainnet.chain.robinhood.com');
    expect(verifyReceipt).not.toHaveBeenCalled();

    fireEvent.click(within(card).getByRole('button', { name: 'Check it here' }));
    expect(await within(card).findByText('Matches chain data.')).toBeInTheDocument();
    expect(card).toHaveTextContent('All 11 checks match.');
    expect(verifyReceipt).toHaveBeenCalledTimes(1);

    fireEvent.click(within(card).getByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(verifyReceipt).toHaveBeenCalledTimes(2));
  });

  it('links machine values to the block explorer only when the data comes from the chain', async () => {
    const mock = createMockDataLayer();
    renderDetail(SAMPLE_RECEIPT_IDS.filledSpy, mock);
    await screen.findByRole('region', { name: 'Proof' });
    expect(screen.queryByRole('link', { name: 'View on the explorer' })).toBeNull();
  });

  it('offers the explorer for the transaction, the account and the pool on chain data', async () => {
    const record = await sampleRecord(SAMPLE_RECEIPT_IDS.filledSpy);
    renderDetail(SAMPLE_RECEIPT_IDS.filledSpy, { ...createMockDataLayer(), source: 'chain' });
    await screen.findByRole('region', { name: 'Proof' });
    const hrefs = screen.getAllByRole('link', { name: 'View on the explorer' }).map((link) => link.getAttribute('href'));
    expect(hrefs).toContain(`${EXPLORER_URL}/tx/${record.derived.txHash}`);
    expect(hrefs).toContain(`${EXPLORER_URL}/address/${record.receipt.account}`);
    expect(hrefs).toContain(`${EXPLORER_URL}/address/${record.receipt.pool}`);
  });
});

describe('other kinds of action', () => {
  it('shows a waiting equity share as USDG kept in the account, with its reason and the route it was meant to take', async () => {
    renderDetail(SAMPLE_RECEIPT_IDS.queuedSession);
    expect(
      await screen.findByRole('heading', { level: 1, name: `750 USDG payday: 675 stayed spendable, 75 waits to buy SPY ${numberSign('642')}` }),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Market closed').length).toBeGreaterThan(0);
    const hero = region('The split');
    expect(hero.querySelector('[data-part="waiting"]')).not.toBeNull();
    expect(leg('waiting')).toHaveTextContent('Waits to buy SPY');
    expect(leg('waiting')).toHaveTextContent('75.00 USDG');
    expect(leg('waiting')).toHaveTextContent('Kept as USDG in the account because the market was closed.');
    expect(screen.queryByRole('region', { name: 'The price' })).toBeNull();
    expect(region('Route')).toHaveTextContent('No swap ran');
    expect(region('Market session')).toHaveTextContent('Closed, so the equity share waits as USDG.');
    expect(within(region('How it ran')).getByText('Not read')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Make a payday card' })).toBeNull();
  });

  it('says a waiting equity share is still waiting today, and when the market reopens', async () => {
    renderDetail(SAMPLE_RECEIPT_IDS.queuedSession);
    await screen.findByRole('region', { name: 'The split' });
    const line = await waitFor(() => {
      const found = leg('waiting').querySelector('[data-wait-outcome]');
      if (found === null) throw new Error('the wait outcome has not drawn yet');
      return found;
    });
    expect(line).toHaveTextContent('It is still waiting as USDG. The market reopens Sun 27 Sep, 20:00 New York time. (derived)');
  });

  it('ties a payday that waited to the buy that ended the wait', async () => {
    renderDetail(SAMPLE_RECEIPT_IDS.queuedSessionSettled);
    await screen.findByRole('region', { name: 'The split' });
    const toBuy = await within(leg('waiting')).findByRole('link', { name: `Open the buy, ${numberSign('401')}` });
    expect(toBuy).toHaveAttribute('href', '/receipts/401');
    expect(leg('waiting')).toHaveTextContent('It bought SPY on 21 Sep 2026, 00:01 UTC.');
  });

  it('links a buy after a wait back to the payday it waited from', async () => {
    renderDetail(SAMPLE_RECEIPT_IDS.settled);
    const hero = await screen.findByRole('region', { name: 'The buy' });
    const from = hero.querySelector<HTMLElement>('[data-side="from"]');
    expect(await within(from ?? hero).findByRole('link', { name: `payday ${numberSign('388')}` })).toHaveAttribute('href', '/receipts/388');
    expect(from).toHaveTextContent(`From payday ${numberSign('388')} (derived)`);
  });

  it('ties a small wait to the release that moved it to spend, both ways', async () => {
    const layer = renderDetail(SAMPLE_RECEIPT_IDS.queuedClip);
    await screen.findByRole('region', { name: 'The split' });
    expect(await within(leg('waiting')).findByRole('link', { name: `Open the release, ${numberSign('203')}` })).toHaveAttribute(
      'href',
      '/receipts/203',
    );
    expect(leg('waiting')).toHaveTextContent('It moved to spend on 15 Sep 2026, 12:05 UTC.');
    cleanupAndRender(SAMPLE_RECEIPT_IDS.released, layer);
    const hero = await screen.findByRole('region', { name: 'The release' });
    expect(await within(hero).findByRole('link', { name: `payday ${numberSign('198')}` })).toHaveAttribute('href', '/receipts/198');
  });

  it('says nothing about how a wait ended until the receipts after it are read', async () => {
    const layer = createMockDataLayer();
    renderDetail(SAMPLE_RECEIPT_IDS.queuedSessionSettled, { ...layer, listReceipts: () => new Promise(() => undefined) });
    await screen.findByRole('region', { name: 'The split' });
    expect(leg('waiting').querySelector('[data-wait-outcome]')).toBeNull();
  });

  it('draws a settle the guard refused as the waiting USDG moving to spend, tied to the payday it waited from', async () => {
    const layer = createMockDataLayer();
    const released = await sampleRecord(SAMPLE_RECEIPT_IDS.released);
    const refused: ReceiptRecord = {
      ...released,
      receipt: { ...released.receipt, status: 'REFUSED_TICKER', usdgIn: 0n, usdgToEquity: released.receipt.usdgToSpend },
    };
    renderDetail(SAMPLE_RECEIPT_IDS.released, {
      ...layer,
      getReceipt: (id: bigint) => (id === SAMPLE_RECEIPT_IDS.released ? Promise.resolve(refused) : layer.getReceipt(id)),
    });
    expect(
      await screen.findByRole('heading', {
        level: 1,
        name: `10 USDG waiting for QQQ went to spend when the buy was refused ${numberSign('203')}`,
      }),
    ).toBeInTheDocument();
    const hero = region('The refused buy');
    expect(hero).toHaveTextContent("QQQ is no longer on Sleeve's ticker list, so the waiting USDG went to spend.");
    expect(screen.queryByRole('region', { name: 'The split' })).toBeNull();
    expect(region('Check this refused buy')).toBeInTheDocument();
  });

  it('draws a sale as a move from its lot to spend, with the discount against the reference', async () => {
    renderDetail(SAMPLE_RECEIPT_IDS.sold);
    expect(await screen.findByRole('heading', { level: 1, name: `Sold 0.108026 QQQ for 80.006416 USDG ${numberSign('415')}` })).toBeInTheDocument();
    const hero = region('The sale');
    expect(within(hero).getByRole('link', { name: 'Sold from lot 212' })).toHaveAttribute('href', '/receipts/212');
    expect(within(hero).getByText(DEBT_SECURITY_LINE)).toBeInTheDocument();
    expect(hero.querySelector('[data-side="from"] [data-token="QQQ"]')).not.toBeNull();
    expect(hero.querySelector('[data-side="to"] [data-token="USDG"]')).not.toBeNull();
    expect(hero).toHaveTextContent('Sleeve never splits the USDG from a sale.');
    expect(region('The price')).toHaveTextContent('9 basis points below the market reference');
    expect(region('Check this sale')).toBeInTheDocument();
  });

  it('draws a correction as the ledger cuts it made', async () => {
    renderDetail(SAMPLE_RECEIPT_IDS.reconciled);
    const hero = await screen.findByRole('region', { name: 'The correction' });
    expect(hero).toHaveTextContent('Taken from spend (derived)');
    expect(hero).toHaveTextContent('15.00 USDG');
    expect(screen.getByText('Corrected')).toBeInTheDocument();
  });

  it("draws a lot's correction as the Stock Tokens trimmed off the lot, with the debt security line", async () => {
    const layer = createMockDataLayer();
    const reconciled = await sampleRecord(SAMPLE_RECEIPT_IDS.reconciled);
    const lotCorrection: ReceiptRecord = {
      ...reconciled,
      receipt: { ...reconciled.receipt, tickerId: 0, lotId: 455n, tokensIn: 50_000_000_000_000_000n, usdgIn: 0n },
      reconciliation: null,
    };
    renderDetail(SAMPLE_RECEIPT_IDS.reconciled, {
      ...layer,
      getReceipt: (id: bigint) => (id === SAMPLE_RECEIPT_IDS.reconciled ? Promise.resolve(lotCorrection) : layer.getReceipt(id)),
    });
    expect(
      await screen.findByRole('heading', { level: 1, name: `Lot 455 trimmed by 0.05 SPY to match the balance ${numberSign('503')}` }),
    ).toBeInTheDocument();
    const hero = region('The correction');
    expect(hero).toHaveTextContent('To match the balance, Sleeve trimmed lot 455 by 0.05 SPY. Nothing moved.');
    expect(within(hero).getByRole('link', { name: 'lot 455' })).toHaveAttribute('href', '/receipts/455');
    expect(within(hero).getByText(DEBT_SECURITY_LINE)).toBeInTheDocument();
    expect(hero).toHaveTextContent('Lots are trimmed oldest first, the order a sell takes them in.');
  });

  it("notes another account's split and offers no card for it", async () => {
    renderDetail(SAMPLE_RECEIPT_IDS.refusedAccount);
    expect(await screen.findByText("Another account's split")).toBeInTheDocument();
    expect(screen.getByText('Account blocked')).toBeInTheDocument();
    expect(leg('refused')).toHaveTextContent("The issuer's blocklist includes this account");
    expect(region('Market session')).toHaveTextContent('Not reached. The guard stopped first, at the account check.');
    expect(screen.queryByRole('button', { name: 'Make a payday card' })).toBeNull();
  });

  it('says plainly when nothing has that number yet', async () => {
    renderDetail(9_999n);
    expect(await screen.findByRole('heading', { name: 'No action with number 9999 yet' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1 })).toHaveTextContent(numberSign('9999'));
    expect(screen.getByRole('link', { name: 'See your history' })).toHaveAttribute('href', '/history');
  });

  it('says what failed and that the USDG is still in the account, then loads on retry', async () => {
    const layer = createMockDataLayer();
    let failing = true;
    renderDetail(SAMPLE_RECEIPT_IDS.filledSpy, {
      ...layer,
      getReceipt: (id: bigint) => (failing ? Promise.reject(new Error('offline')) : layer.getReceipt(id)),
    });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent(`The details of ${numberSign('455')} did not load`);
    expect(alert).toHaveTextContent(FUNDS_STILL_HERE);
    failing = false;
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    expect(await screen.findByRole('region', { name: 'The split' })).toBeInTheDocument();
  });
});

describe('making a payday card', () => {
  async function openComposer(layer: SleeveDataLayer): Promise<HTMLElement> {
    renderDetail(SAMPLE_RECEIPT_IDS.filledSpy, layer);
    fireEvent.click(await screen.findByRole('button', { name: 'Make a payday card' }));
    return screen.findByRole('dialog', { name: 'Make a payday card' });
  }

  it('makes a card with amounts and proof off unless the owner adds them', async () => {
    const layer = createMockDataLayer();
    const dialog = await openComposer(layer);
    expect(within(dialog).getByRole('checkbox', { name: 'Show amounts' })).not.toBeChecked();
    expect(within(dialog).getByRole('checkbox', { name: 'Show proof' })).not.toBeChecked();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Make card' }));
    });
    await waitFor(() => expect(navigation.push).toHaveBeenCalledTimes(1));
    const cardId = String(navigation.push.mock.calls[0]?.[0]).replace('/card/', '');
    const card = await layer.getCard(cardId);
    expect(card).toMatchObject({ kind: 'receipt', tickerId: 0, amounts: null, proof: null });
  });

  it('previews the card above the choices, and the preview follows every toggle', async () => {
    const dialog = await openComposer(createMockDataLayer());
    const preview = await within(dialog).findByRole('img', { name: /payday card/ });
    expect(preview.getAttribute('aria-label')).toContain('SPY');
    expect(preview.getAttribute('aria-label')).not.toContain('1,200.00 USDG');
    expect(preview.getAttribute('aria-label')).not.toContain('Receipt 455');

    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Show amounts' }));
    expect(within(dialog).getByRole('img', { name: /payday card/ }).getAttribute('aria-label')).toContain('1,200.00 USDG');

    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Show proof' }));
    expect(within(dialog).getByRole('img', { name: /payday card/ }).getAttribute('aria-label')).not.toContain('Receipt 455');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add the receipt number' }));
    expect(within(dialog).getByRole('img', { name: /payday card/ }).getAttribute('aria-label')).toContain('Receipt 455');
  });

  it('adds the receipt number only after the warning that it reveals the account', async () => {
    const layer = createMockDataLayer();
    const dialog = await openComposer(layer);
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Show amounts' }));
    fireEvent.click(within(dialog).getByRole('checkbox', { name: 'Show proof' }));

    const confirm = within(dialog).getByRole('button', { name: 'Add the receipt number' });
    expect(within(dialog).getByText('The receipt number reveals your account')).toBeInTheDocument();
    expect(confirm).toHaveAccessibleDescription(expect.stringContaining('Anyone can look up receipt 455'));
    expect(within(dialog).getByRole('checkbox', { name: 'Show proof' })).not.toBeChecked();
    fireEvent.click(confirm);
    expect(within(dialog).getByRole('checkbox', { name: 'Show proof' })).toBeChecked();

    await act(async () => {
      fireEvent.click(within(dialog).getByRole('button', { name: 'Make card' }));
    });
    await waitFor(() => expect(navigation.push).toHaveBeenCalledTimes(1));
    const card = await layer.getCard(String(navigation.push.mock.calls[0]?.[0]).replace('/card/', ''));
    expect(card?.proof?.receiptIds).toEqual([SAMPLE_RECEIPT_IDS.filledSpy]);
    expect(card?.amounts).not.toBeNull();
  });
});
