import { act, fireEvent, render, screen, within } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';

import { PRIMARY_NAV, SECONDARY_NAV } from '@/components/sleeve/navigation';

import { installDialogPolyfill, pressEscapeOn } from '../__tests__/dialog-polyfill';

import { AppShell, isCurrentPath } from './app-shell';
import { useToast } from './toast';

const route = vi.hoisted(() => ({ pathname: '/home' }));

vi.mock('next/navigation', () => ({
  usePathname: () => route.pathname,
}));

const ACCOUNT = '0x3efEf72Ee9aF42fd90f193A1A64aC25384179b36';

beforeAll(() => {
  installDialogPolyfill();
});

beforeEach(() => {
  route.pathname = '/home';
});

function renderShell(children: ReactNode = <h1>Page</h1>) {
  return render(
    <AppShell primaryNav={PRIMARY_NAV} secondaryNav={SECONDARY_NAV} account={ACCOUNT}>
      {children}
    </AppShell>,
  );
}

function navs(): HTMLElement[] {
  return screen.getAllByRole('navigation', { name: 'Main' });
}

function moreSheet(): HTMLDialogElement {
  const sheet = screen.getByRole('dialog', { name: 'More' });
  if (!(sheet instanceof HTMLDialogElement)) throw new Error('the More sheet is not a dialog element');
  return sheet;
}

describe('isCurrentPath', () => {
  it('matches a section and the pages under it, never a sibling that shares a prefix', () => {
    expect(isCurrentPath('/receipts', '/receipts')).toBe(true);
    expect(isCurrentPath('/receipts/455', '/receipts')).toBe(true);
    expect(isCurrentPath('/receiptsx', '/receipts')).toBe(false);
    expect(isCurrentPath('/home', '/receipts')).toBe(false);
  });
});

describe('AppShell', () => {
  it('puts the page in main, behind a skip link', () => {
    renderShell();
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main-content');
    expect(within(main).getByRole('heading', { name: 'Page' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Skip to content' })).toHaveAttribute('href', '#main-content');
  });

  it('marks the current section in the rail and the bottom bar, deep pages included', () => {
    route.pathname = '/receipts/455';
    renderShell();
    const [rail, bottom] = navs();
    if (rail === undefined || bottom === undefined) throw new Error('expected the rail and the bottom bar');
    expect(within(rail).getByRole('link', { name: 'Receipts' })).toHaveAttribute('aria-current', 'page');
    expect(within(bottom).getByRole('link', { name: 'Receipts' })).toHaveAttribute('aria-current', 'page');
    expect(within(bottom).getByRole('link', { name: 'Home' })).not.toHaveAttribute('aria-current');
    // The breadcrumb leads back to the section root from a page under it.
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toHaveTextContent('Receipts');
  });

  it('keeps three destinations in the bottom bar and the rest behind More', () => {
    renderShell();
    const bottom = navs()[1];
    if (bottom === undefined) throw new Error('no bottom bar');
    expect(within(bottom).getAllByRole('link').map((link) => link.textContent)).toEqual(['Home', 'Inbox', 'Receipts']);
    const more = within(bottom).getByRole('button', { name: 'More' });
    expect(more).toHaveAttribute('aria-haspopup', 'dialog');
    expect(more).toHaveAttribute('aria-expanded', 'false');

    fireEvent.click(more);
    expect(more).toHaveAttribute('aria-expanded', 'true');
    const sheet = moreSheet();
    expect(within(sheet).getAllByRole('link').map((link) => link.textContent)).toEqual(['Rule', 'Sell', 'Verify a receipt']);
    expect(sheet).toHaveTextContent('0x3efE…9b36');
    expect(sheet).toHaveTextContent('Robinhood Chain, chain id 4663');

    act(() => pressEscapeOn(sheet));
    expect(more).toHaveAttribute('aria-expanded', 'false');
  });

  it('closes the More sheet when one of its links is followed', () => {
    route.pathname = '/rule';
    renderShell();
    // jsdom cannot load another document; stop the browser default once React has handled the click.
    document.addEventListener('click', (event) => event.preventDefault(), { once: true });
    fireEvent.click(screen.getByRole('button', { name: 'More' }));
    const rule = within(moreSheet()).getByRole('link', { name: 'Rule' });
    expect(rule).toHaveAttribute('aria-current', 'page');
    fireEvent.click(rule);
    expect(screen.getByRole('button', { name: 'More' })).toHaveAttribute('aria-expanded', 'false');
  });

  it('never lists a gated feature', () => {
    renderShell();
    const everything = document.body.textContent ?? '';
    expect(everything).not.toMatch(/borrow|pay link|basket|crew/i);
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
    expect(screen.getByRole('status')).toHaveTextContent('Rule saved');
  });
});
