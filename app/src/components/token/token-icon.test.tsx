import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import manifest from '../../../public/assets/icons-manifest.json';

import { TOKEN_KEYS, tokenLabel, tokenShape, tokenVisual } from './registry';
import { TokenIcon } from './token-icon';
import { TokenPair, TokenStack } from './token-stack';

describe('registry', () => {
  it('knows every manifest entry and nothing else', () => {
    expect([...TOKEN_KEYS].sort()).toEqual([...Object.keys(manifest.icons), ...Object.keys(manifest.withheld)].sort());
  });

  it('names Stock Tokens in full and currencies by their code', () => {
    expect(tokenLabel('SPY')).toBe('SPY Stock Token');
    expect(tokenLabel('USDG')).toBe('USDG');
    expect(tokenLabel('ETH')).toBe('ETH');
  });

  it('puts Stock Tokens in a tile and currencies in a disc', () => {
    expect(['SPY', 'QQQ', 'NVDA', 'AAPL'].map((key) => tokenShape(key as 'SPY'))).toEqual(['tile', 'tile', 'tile', 'tile']);
    expect(tokenShape('USDG')).toBe('disc');
    expect(tokenShape('ETH')).toBe('disc');
  });

  it('serves a local logo file for every token, Stock Tokens included', () => {
    expect(tokenVisual('USDG')).toMatchObject({ kind: 'logo', src: '/assets/tokens/usdg.png', art: 'disc' });
    expect(tokenVisual('ETH')).toMatchObject({ kind: 'logo', src: '/assets/tokens/eth.png', art: 'mark' });
    expect(tokenVisual('NVDA')).toMatchObject({ kind: 'logo', src: '/assets/tokens/nvda.png', art: 'disc' });
  });

  it('throws outside production on a key the manifest does not have', () => {
    expect(() => tokenVisual('TSLA' as 'SPY')).toThrow(/No icon entry/);
  });
});

describe('TokenIcon', () => {
  it.each(TOKEN_KEYS)('pictures %s with no letters, only an image or a glyph', (token) => {
    const { container } = render(<TokenIcon token={token} />);
    const icon = screen.getByRole('img', { name: tokenLabel(token) });
    expect(icon.textContent).toBe('');
    expect(container.querySelector('img, svg')).not.toBeNull();
  });

  it('draws the logo from the local copy with an empty alt, the name living on the wrapper', () => {
    const { container } = render(<TokenIcon token="USDG" size="lg" />);
    const img = container.querySelector('img');
    expect(img?.getAttribute('src')).toBe('/assets/tokens/usdg.png');
    expect(img?.getAttribute('alt')).toBe('');
    expect(screen.getByRole('img', { name: 'USDG' })).toHaveClass('size-avatar', 'rounded-pill');
  });

  it('draws a Stock Token logo in a rounded tile', () => {
    const { container } = render(<TokenIcon token="AAPL" size="xl" />);
    expect(container.querySelector('img')?.getAttribute('src')).toBe('/assets/tokens/aapl.png');
    expect(screen.getByRole('img', { name: 'AAPL Stock Token' })).toHaveClass('size-icon-tile', 'rounded-[13px]');
  });

  it('hides itself from assistive technology when decorative', () => {
    const { container } = render(<TokenIcon token="ETH" decorative />);
    expect(screen.queryByRole('img')).toBeNull();
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });

  it('adds the network to the name when it carries the chain badge', () => {
    render(<TokenIcon token="SPY" size="lg" chain />);
    expect(screen.getByRole('img', { name: 'SPY Stock Token on Robinhood Chain' })).toBeInTheDocument();
  });

  it('draws the cutout ring in the surface it sits on', () => {
    render(<TokenIcon token="USDG" cutout="muted" />);
    expect(screen.getByRole('img', { name: 'USDG' })).toHaveClass('ring-2', 'ring-surface-muted');
  });
});

describe('TokenStack and TokenPair', () => {
  it('names the whole group once and hides the icons inside', () => {
    render(<TokenStack tokens={['SPY', 'QQQ']} />);
    expect(screen.getAllByRole('img')).toHaveLength(1);
    expect(screen.getByRole('img', { name: 'SPY Stock Token and QQQ Stock Token' })).toBeInTheDocument();
  });

  it('collapses tokens past max into a count and still names every token', () => {
    const { container } = render(<TokenStack tokens={['SPY', 'QQQ', 'NVDA', 'AAPL', 'USDG']} max={3} />);
    expect(container.querySelectorAll('[data-token]')).toHaveLength(2);
    expect(screen.getByTestId('token-stack-count').textContent).toBe('+3');
    expect(
      screen.getByRole('img', { name: 'SPY Stock Token, QQQ Stock Token, NVDA Stock Token, AAPL Stock Token and USDG' }),
    ).toBeInTheDocument();
  });

  it('draws every token when they fit', () => {
    const { container } = render(<TokenStack tokens={['SPY', 'QQQ', 'NVDA', 'AAPL']} />);
    expect(container.querySelectorAll('[data-token]')).toHaveLength(4);
    expect(screen.queryByTestId('token-stack-count')).toBeNull();
  });

  it('renders nothing for no tokens', () => {
    const { container } = render(<TokenStack tokens={[]} />);
    expect(container.firstChild).toBeNull();
  });

  it('names a pair as a movement from one token to the other', () => {
    const { container } = render(<TokenPair from="USDG" to="NVDA" size="lg" />);
    expect(screen.getByRole('img', { name: 'USDG to NVDA Stock Token' })).toBeInTheDocument();
    expect([...container.querySelectorAll('[data-token]')].map((node) => node.getAttribute('data-token'))).toEqual(['USDG', 'NVDA']);
  });
});
