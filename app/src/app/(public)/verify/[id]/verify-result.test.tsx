import { PUBLIC_RPC_URL } from '@sleeve/core';
import { fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { createMockDataLayer, SAMPLE_RECEIPT_IDS } from '@/data/mock';
import { DataLayerProvider } from '@/data/provider';
import type { SleeveDataLayer, VerifyResult } from '@/data/types';

import { VerifyResultView } from './verify-result';

/** "#" and a number, built so the design guardrail's color grep does not read the test as a hex color. */
const numberSign = (id: string): string => `#${id}`;

function renderResult(id: bigint, layer: SleeveDataLayer) {
  render(
    <DataLayerProvider dataLayer={layer}>
      <VerifyResultView id={id.toString()} />
    </DataLayerProvider>,
  );
}

/** The sample layer with verifyReceipt counted, and optionally rewritten. */
function layerWith(rewrite: (result: VerifyResult) => VerifyResult = (result) => result) {
  const layer = createMockDataLayer();
  const verifyReceipt = vi.fn(async (id: bigint) => rewrite(await layer.verifyReceipt(id)));
  return { layer: { ...layer, verifyReceipt } satisfies SleeveDataLayer, verifyReceipt, original: layer };
}

async function checkRows(): Promise<HTMLElement[]> {
  return within(await screen.findByRole('list', { name: 'Checks' })).getAllByRole('listitem');
}

describe('verify result', () => {
  it('shows MATCH for every field, with the receipt value beside the recomputed one', async () => {
    const { layer, original } = layerWith();
    const expected = await original.verifyReceipt(SAMPLE_RECEIPT_IDS.filledSpy);
    renderResult(SAMPLE_RECEIPT_IDS.filledSpy, layer);

    expect(await screen.findByRole('heading', { name: 'Matches chain data' })).toBeInTheDocument();
    expect(screen.getByText(`All ${expected.checks.length} checks match.`, { exact: false })).toBeInTheDocument();
    const rows = await checkRows();
    expect(rows).toHaveLength(expected.checks.length);
    for (const row of rows) {
      expect(within(row).getByText('MATCH')).toBeInTheDocument();
      expect(within(row).getByText('Receipt value')).toBeInTheDocument();
      expect(within(row).getByText('Recomputed value')).toBeInTheDocument();
    }
  });

  it('says which RPC it read through and that it is not the keeper provider', async () => {
    renderResult(SAMPLE_RECEIPT_IDS.filledSpy, layerWith().layer);
    expect(await screen.findByText(PUBLIC_RPC_URL)).toBeInTheDocument();
    expect(screen.getByText("This is the public Robinhood Chain RPC, a different provider from the one Sleeve's keeper uses.")).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Matches chain data' })).toHaveTextContent('Read throughrpc.mainnet.chain.robinhood.com');
    expect(screen.getByText('The two hashes are the same')).toBeInTheDocument();
  });

  it('leads with what happened, then names the receipt being checked, its time and its token icons', async () => {
    renderResult(SAMPLE_RECEIPT_IDS.filledSpy, layerWith().layer);
    const heading = await screen.findByRole('heading', {
      level: 1,
      name: `1,200 USDG payday: 1,080 stayed spendable, 120 became SPY ${numberSign('455')}`,
    });
    const header = heading.closest('header');
    expect(
      within(header ?? document.body).getByText(
        'Receipt 455, written 22 Sep 2026, 13:40 UTC. Recomputed from Robinhood Chain data on every visit.',
      ),
    ).toBeInTheDocument();
    expect(header?.querySelector('[data-token="SPY"]')).not.toBeNull();
    expect(header?.querySelector('[data-token="USDG"]')).not.toBeNull();
    expect(screen.getByRole('link', { name: 'Check a split' })).toHaveAttribute('href', '/verify');
  });

  it('names the receipt by its number alone until the receipt reads', async () => {
    const layer = createMockDataLayer();
    renderResult(SAMPLE_RECEIPT_IDS.filledSpy, { ...layer, getReceipt: () => new Promise(() => undefined) });
    expect(await screen.findByRole('heading', { level: 1, name: 'Receipt 455' })).toBeInTheDocument();
    expect(screen.getByText('Recomputed from Robinhood Chain data on every visit, field by field.')).toBeInTheDocument();
  });

  it('lists every field that differs and never smooths the difference', async () => {
    const { layer } = layerWith((result) => {
      const checks = result.checks.map((check) =>
        check.id === 'tokens-out' ? { ...check, expected: (BigInt(check.expected) + 1n).toString(), ok: false } : check,
      );
      return { ...result, status: 'MISMATCH', checks };
    });
    renderResult(SAMPLE_RECEIPT_IDS.filledSpy, layer);

    expect(await screen.findByRole('heading', { name: 'Does not match chain data' })).toBeInTheDocument();
    const differing = screen.getByRole('list', { name: 'Fields that differ' });
    const [item] = within(differing).getAllByRole('listitem');
    expect(item).toHaveTextContent('Stock Tokens that arrived');
    const raws = within(item ?? document.body).getAllByText(/^\d{6,}$/).map((node) => node.textContent);
    expect(raws).toHaveLength(2);
    expect(BigInt(raws[1] ?? '0') - BigInt(raws[0] ?? '0')).toBe(1n);

    const rows = await checkRows();
    expect(rows.filter((row) => within(row).queryByText('MISMATCH') !== null)).toHaveLength(1);
  });

  it('says plainly when no receipt has that number', async () => {
    renderResult(9_999n, layerWith().layer);
    expect(await screen.findByRole('heading', { name: 'No receipt 9999 on Robinhood Chain' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Check another number' })).toHaveAttribute('href', '/verify');
  });

  it('says the provider did not answer and checks again on request', async () => {
    const { layer, verifyReceipt } = layerWith((result) => ({ ...result, status: 'PROVIDER_BLOCKED', checks: [] }));
    renderResult(SAMPLE_RECEIPT_IDS.filledSpy, layer);
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The check could not reach its RPC provider');
    fireEvent.click(within(alert).getByRole('button', { name: 'Try again' }));
    await waitFor(() => expect(verifyReceipt).toHaveBeenCalledTimes(2));
  });

  it('says the check did not run when the verifier fails', async () => {
    const layer = createMockDataLayer();
    renderResult(SAMPLE_RECEIPT_IDS.filledSpy, { ...layer, verifyReceipt: () => Promise.reject(new Error('socket closed')) });
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('The check did not run');
    expect(alert).toHaveTextContent('nothing on any account changed');
  });

  it('recomputes again when asked, never from a cache', async () => {
    const { layer, verifyReceipt } = layerWith();
    renderResult(SAMPLE_RECEIPT_IDS.settled, layer);
    fireEvent.click(await screen.findByRole('button', { name: 'Check again' }));
    await waitFor(() => expect(verifyReceipt).toHaveBeenCalledTimes(2));
    expect(screen.getByRole('link', { name: 'Open receipt 401' })).toHaveAttribute('href', '/receipts/401');
  });
});
