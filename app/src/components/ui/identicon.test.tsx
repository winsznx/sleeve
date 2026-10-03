import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';

import { StatStrip } from './card';
import { Identicon, identiconCells } from './identicon';

describe('identiconCells', () => {
  it('draws the same mirrored pattern for the same address, and a different one for another', () => {
    const a = identiconCells('0x719DBeC8Ea02dA7A16B32dd98a5e0682da5B265F');
    expect(identiconCells('0x719dbec8ea02da7a16b32dd98a5e0682da5b265f')).toEqual(a);
    for (const cell of a) expect(a.some((other) => other.x === 4 - cell.x && other.y === cell.y && other.strong === cell.strong)).toBe(true);
    expect(identiconCells('0xD7d602160A89BdDB77B6C9048e63C36c8cb1681a')).not.toEqual(a);
  });

  it('never draws an empty picture', () => {
    expect(identiconCells('0x0000000000000000000000000000000000000000')).toEqual([{ x: 2, y: 2, strong: true }]);
  });

  it('is decorative: the address beside it says who it is', () => {
    const { container } = render(<Identicon value="0x719DBeC8Ea02dA7A16B32dd98a5e0682da5B265F" />);
    expect(container.firstElementChild).toHaveAttribute('aria-hidden', 'true');
  });
});

describe('StatStrip', () => {
  it('names the group and shows each figure with its label', () => {
    render(
      <StatStrip
        label="Payments so far"
        items={[
          { id: 'a', icon: 'clock', label: 'Not sorted yet', value: '165.80 USDG', footer: '2 payments' },
          { id: 'b', leading: <span>mark</span>, label: 'Received', value: '5,540.55 USDG' },
        ]}
      />,
    );
    const strip = screen.getByRole('region', { name: 'Payments so far' });
    expect(strip).toHaveTextContent('Not sorted yet165.80 USDG2 payments');
    expect(strip).toHaveTextContent('Received5,540.55 USDG');
  });
});
