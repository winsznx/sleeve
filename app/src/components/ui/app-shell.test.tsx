import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PRIMARY_NAV, SECONDARY_NAV, SECTION_ALIASES } from '@/components/sleeve/navigation';
import { createMockDataLayer, SAMPLE_ACCOUNT } from '@/data/mock';
import { DataLayerProvider } from '@/data/provider';

import { installDialogPolyfill, pressEscapeOn } from '../__tests__/dialog-polyfill';

import { AppShell, isCurrentPath } from './app-shell';
import { useToast } from './toast';

const route = vi.hoisted(() => ({ pathname: '/home', push: vi.fn() }));

vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
  useRouter: () => ({ push: route.push, replace: vi.fn(), prefetch: vi.fn(), back: vi.fn(), refresh: vi.fn() }),
}));

beforeAll(() => {
  installDialogPolyfill();
  // jsdom lays nothing out, so it has no scrollIntoView; the palette calls it to keep the highlight in view.
  Element.prototype.scrollIntoView = vi.fn();
});

beforeEach(() => {
  route.pathname = '/home';
  route.push.mockReset();
});

function renderShell(children: ReactNode = <h1>Page</h1>, options: { account?: null } = {}) {
  return render(
    <DataLayerProvider dataLayer={createMockDataLayer()}>
      <AppShell primaryNav={PRIMARY_NAV} secondaryNav={SECONDARY_NAV} aliases={SECTION_ALIASES} {...options}>
        {children}
      </AppShell>
    </DataLayerProvider>,
  );
}

function bottomBar(): HTMLElement {
  const bars = screen.getAllByRole('navigation', { name: 'Main' });
  const bottom = bars.at(-1);
  if (bottom === undefined) throw new Error('no bottom bar');
  return bottom;
}

/** An open dialog by name. */
function dialog(name: string): HTMLDialogElement {
  const found = screen.getByRole('dialog', { name });
  if (!(found instanceof HTMLDialogElement)) throw new Error(`${name} is not a dialog element`);
  return found;
}

describe('isCurrentPath', () => {
  it('matches a section and the pages under it, never a sibling that shares a prefix', () => {
    expect(isCurrentPath('/history', '/history')).toBe(true);
    expect(isCurrentPath('/history/455', '/history')).toBe(true);
    expect(isCurrentPath('/historyx', '/history')).toBe(false);
    expect(isCurrentPath('/home', '/history')).toBe(false);
  });
});

describe('AppShell navigation', () => {
  it('puts the page in main, behind a skip link', () => {
    renderShell();
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main-content');
    expect(within(main).getByRole('heading', { name: 'Page' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main-content');
  });

  it('leads with Home, Payments, Holdings and Rule, and keeps History and Check a split lower in the rail', () => {
    renderShell();
    const [rail] = screen.getAllByRole('navigation', { name: 'Main' });
    if (rail === undefined) throw new Error('no rail');
    expect(within(rail).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Home', '/home'],
      ['Payments', '/payments'],
      ['Holdings', '/holdings'],
      ['Rule', '/rule'],
    ]);
    const more = screen.getByRole('navigation', { name: 'More' });
    expect(within(more).getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['History', '/history'],
      ['Check a split', '/verify'],
    ]);
  });

  it('marks the place a details page belongs to, and names the action in the breadcrumb', () => {
    route.pathname = '/receipts/642';
    renderShell();
    expect(within(screen.getByRole('navigation', { name: 'More' })).getByRole('link', { name: 'History' })).toHaveAttribute(
      'aria-current',
      'page',
    );
    const crumbs = screen.getByRole('navigation', { name: 'Breadcrumb' });
    expect(within(crumbs).getByRole('link', { name: 'History' })).toHaveAttribute('href', '/history');
    expect(crumbs).toHaveTextContent('History/#642');
  });

  it('keeps the four places in the bottom bar and the rest behind More', async () => {
    route.pathname = '/sell';
    renderShell();
    const bottom = bottomBar();
    expect(within(bottom).getAllByRole('link').map((link) => link.textContent)).toEqual(['Home', 'Payments', 'Holdings', 'Rule']);
    expect(within(bottom).getByRole('link', { name: 'Holdings' })).toHaveAttribute('aria-current', 'page');

    const more = within(bottom).getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-haspopup', 'dialog');
    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    const sheet = dialog('More');
    expect(within(sheet).getByRole('button', { name: 'Search' })).toBeInTheDocument();
    expect(within(sheet).getAllByRole('link').map((link) => link.textContent)).toEqual(['History', 'Check a split', 'About Sleeve']);
    expect(await within(sheet).findByRole('button', { name: 'Receive USDG' })).toBeInTheDocument();
    expect(sheet).toHaveTextContent('Robinhood Chain, chain id 4663');

    act(() => pressEscapeOn(sheet));
    expect(more).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes the More sheet when one of its links is followed', () => {
    route.pathname = '/history';
    renderShell();
    // jsdom cannot load another document; stop the browser default once React has handled the click.
    document.addEventListener('click', (event) => event.preventDefault(), { once: true });
    fireEvent.click(within(bottomBar()).getByRole('button', { name: 'More' }));
    const history = within(dialog('More')).getByRole('link', { name: 'History' });
    expect(history).toHaveAttribute('aria-current', 'page');
    fireEvent.click(history);
    expect(within(bottomBar()).getByRole('button', { name: 'More' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('never lists a gated feature', () => {
    renderShell();
    fireEvent.click(within(bottomBar()).getByRole('button', { name: 'More' }));
    expect(document.body.textContent ?? '').not.toMatch(/borrow|pay link|basket|crew/i);
  });
});

describe('AppShell top bar', () => {
  it('shows the account by its short payment address and how it signs, with copy beside it', async () => {
    renderShell();
    expect(await screen.findByRole('button', { name: 'Account 0x3efE…9b36, passkey. Show account.' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Copy payment address' })).toBeInTheDocument();
  });

  it('shows the spendable USDG and opens the balances behind it, each Stock Token with the debt security line', async () => {
    renderShell();
    const chip = await screen.findByRole('button', { name: /USDG spendable\. Show your balances\.$/ });
    fireEvent.click(chip);
    const panel = dialog('Your balances');
    expect(await within(panel).findAllByText('debt security, not a share')).not.toHaveLength(0);
    expect(within(panel).getByRole('heading', { name: 'Waiting to buy' })).toBeInTheDocument();
  });

  it('opens Receive with the whole payment address and what the rule does with a payment', async () => {
    renderShell();
    const [receiveButton] = await screen.findAllByRole('button', { name: 'Receive USDG' });
    if (receiveButton === undefined) throw new Error('no Receive button');
    fireEvent.click(receiveButton);
    const receive = dialog('Receive USDG');
    expect(receive).toHaveTextContent(SAMPLE_ACCOUNT);
    expect(await within(receive).findByText(/Your rule splits every payment: 90% stays spendable USDG and 10% buys SPY\./)).toBeInTheDocument();
  });

  it('counts down the market session in the pill and says it in full', async () => {
    renderShell();
    expect(
      await screen.findByRole('button', { name: /^Market closed, opens Sunday 27 September at 20:00 New York time, in 1 day 6 hours\./ }),
    ).toBeInTheDocument();
  });

  it('says when the market read fails, and reads it again on request', async () => {
    const layer = createMockDataLayer();
    const getMarket = vi.fn(layer.getMarket).mockRejectedValueOnce(new Error('The RPC did not answer'));
    render(
      <DataLayerProvider dataLayer={{ ...layer, getMarket }}>
        <AppShell primaryNav={PRIMARY_NAV} secondaryNav={SECONDARY_NAV} aliases={SECTION_ALIASES}>
          <h1>Page</h1>
        </AppShell>
      </DataLayerProvider>,
    );
    fireEvent.click(await screen.findByRole('button', { name: 'Market status unavailable' }));
    expect(await screen.findByRole('button', { name: /^Market closed, opens Sunday 27 September/ })).toBeInTheDocument();
    expect(getMarket).toHaveBeenCalledTimes(2);
  });

  it('says when the balance read fails instead of showing a zero', async () => {
    const layer = createMockDataLayer();
    const getLedger = vi.fn(layer.getLedger).mockRejectedValueOnce(new Error('The RPC did not answer'));
    render(
      <DataLayerProvider dataLayer={{ ...layer, getLedger }}>
        <AppShell primaryNav={PRIMARY_NAV} secondaryNav={SECONDARY_NAV} aliases={SECTION_ALIASES}>
          <h1>Page</h1>
        </AppShell>
      </DataLayerProvider>,
    );
    const failed = await screen.findByRole('button', { name: 'Balance did not load' });
    expect(screen.queryByText(/0\.00 USDG/)).toBeNull();
    fireEvent.click(failed);
    expect(await screen.findByRole('button', { name: /USDG spendable\. Show your balances\.$/ })).toBeInTheDocument();
  });

  it('asks a visitor with no account to sign in instead', () => {
    renderShell(<h1>Page</h1>, { account: null });
    expect(screen.getByRole('link', { name: 'Sign in' })).toHaveAttribute('href', '/onboard');
    expect(screen.queryByRole('button', { name: 'Receive USDG' })).toBeNull();
  });

  it('gives onboarding a focused frame: no rail, no bottom bar, no search, and a way back to the site', () => {
    route.pathname = '/onboard';
    renderShell();
    expect(screen.queryByRole('navigation', { name: 'Main' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Search' })).toBeNull();
    expect(screen.getByRole('link', { name: 'Back to the site' })).toHaveAttribute('href', '/');
  });

  it('gives the page a toast provider', () => {
    function Saves() {
      const toast = useToast();
      return (
        <button type="button" onClick={() => toast.show({ title: 'Rule saved' })}>
          Save
        </button>
      );
    }
    renderShell(<Saves />);
    fireEvent.click(screen.getByRole('button', { name: 'Save' }));
    expect(screen.getByRole('status', { name: '' })).toHaveTextContent('Rule saved');
  });
});

describe('AppShell search', () => {
  /** The palette's dialog, open or not: a closed native dialog has no accessible name to find it by. */
  function palette(): HTMLDialogElement {
    const found = document.querySelector('dialog[data-palette]');
    if (!(found instanceof HTMLDialogElement)) throw new Error('no search palette');
    return found;
  }

  function input(): HTMLElement {
    return within(palette()).getByRole('combobox', { name: 'Search Sleeve' });
  }

  it('opens with ⌘K or Ctrl K, toggles closed with it, and returns focus on Escape', () => {
    renderShell();
    const trigger = screen.getByRole('button', { name: 'Search' });
    trigger.focus();
    fireEvent.keyDown(document, { key: 'k', metaKey: true });
    expect(palette()).toHaveAttribute('open');
    expect(input()).toHaveFocus();
    fireEvent.keyDown(document, { key: 'k', ctrlKey: true });
    expect(palette()).not.toHaveAttribute('open');

    fireEvent.keyDown(document, { key: 'K', ctrlKey: true });
    expect(palette()).toHaveAttribute('open');
    act(() => pressEscapeOn(palette()));
    expect(palette()).not.toHaveAttribute('open');
    expect(trigger).toHaveFocus();
  });

  it('opens with "/" unless focus is in a field', () => {
    renderShell(<input aria-label="Amount" />);
    const field = screen.getByRole('textbox', { name: 'Amount' });
    field.focus();
    fireEvent.keyDown(field, { key: '/' });
    expect(palette()).not.toHaveAttribute('open');
    field.blur();
    fireEvent.keyDown(document.body, { key: '/' });
    expect(palette()).toHaveAttribute('open');
  });

  it('walks the results with the arrow keys and opens the highlighted page with Enter', () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const box = input();
    const options = within(palette()).getAllByRole('option');
    expect(options[0]).toHaveAttribute('aria-selected', 'true');
    expect(box).toHaveAttribute('aria-activedescendant', options[0]?.id);

    fireEvent.keyDown(box, { key: 'ArrowDown' });
    fireEvent.keyDown(box, { key: 'ArrowDown' });
    expect(options[2]).toHaveTextContent('Holdings');
    expect(box).toHaveAttribute('aria-activedescendant', options[2]?.id);
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    fireEvent.keyDown(box, { key: 'ArrowUp' });
    expect(options.at(-1)).toHaveAttribute('aria-selected', 'true');

    fireEvent.change(box, { target: { value: 'holdings' } });
    fireEvent.keyDown(box, { key: 'Enter' });
    expect(route.push).toHaveBeenCalledWith('/holdings');
    expect(palette()).not.toHaveAttribute('open');
  });

  it('finds an action by its number and says what it was', async () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.change(input(), { target: { value: '642' } });
    const group = within(palette()).getByRole('group', { name: 'Action #642' });
    expect(await within(group).findByText('SPY buy waiting')).toBeInTheDocument();
    fireEvent.click(within(group).getByRole('option', { name: /Check #642 on the public page/ }));
    expect(route.push).toHaveBeenCalledWith('/verify/642');
  });

  it('lists the launch Stock Tokens with their reference price and says when nothing matches', async () => {
    renderShell();
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    const tokens = within(palette()).getByRole('group', { name: 'Stock Tokens' });
    expect(within(tokens).getAllByRole('option')).toHaveLength(4);
    expect(await within(tokens).findByText('772.32')).toBeInTheDocument();
    fireEvent.change(input(), { target: { value: 'zzz' } });
    expect(palette()).toHaveTextContent('Nothing matches. Try a page, a ticker such as SPY, or an action number.');
  });

  it('runs Receive USDG from the palette', async () => {
    renderShell();
    // Receiving needs the signed-in account, which the session read brings.
    await screen.findByRole('button', { name: /^Account / });
    fireEvent.click(screen.getByRole('button', { name: 'Search' }));
    fireEvent.change(input(), { target: { value: 'receive' } });
    fireEvent.keyDown(input(), { key: 'Enter' });
    expect(palette()).not.toHaveAttribute('open');
    expect(dialog('Receive USDG')).toHaveAttribute('open');
  });
});
