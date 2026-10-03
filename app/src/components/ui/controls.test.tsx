import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { Button, IconButton } from './button';
import { FilterPill, SegmentedControl } from './choice';
import { AmountInput, Checkbox, Input, Select, sanitizeAmount } from './field';
import { Slider } from './slider';

describe('Button', () => {
  it('is a button by default, so it never submits a form by accident', () => {
    render(<Button>Save rule</Button>);
    expect(screen.getByRole('button', { name: 'Save rule' })).toHaveAttribute('type', 'button');
  });

  it('while busy: announces it, stays focusable, and ignores clicks', () => {
    const onClick = vi.fn();
    render(
      <Button busy busyLabel="Releasing" onClick={onClick}>
        Release to spend
      </Button>,
    );
    const button = screen.getByRole('button');
    expect(button).toHaveAttribute('aria-busy', 'true');
    expect(button).toHaveAttribute('aria-disabled', 'true');
    expect(button).not.toBeDisabled();
    expect(button).toHaveTextContent('Releasing');
    fireEvent.click(button);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('runs its action when not busy', () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Save rule</Button>);
    fireEvent.click(screen.getByRole('button', { name: 'Save rule' }));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('names an icon button from its label', () => {
    render(<IconButton icon="copy" label="Copy receipt hash" />);
    expect(screen.getByRole('button', { name: 'Copy receipt hash' })).toHaveAttribute('title', 'Copy receipt hash');
  });
});

describe('sanitizeAmount', () => {
  it.each([
    ['25', 6, '25'],
    ['25.5', 6, '25.5'],
    ['', 6, ''],
    ['.5', 6, '.5'],
    ['1 200.50', 6, '1200.50'],
    ['12,5', 6, '12.5'],
    ['1,200.50', 6, '1200.50'],
    ['0.123456', 6, '0.123456'],
    ['0.000000000000000001', 18, '0.000000000000000001'],
  ])('accepts %j with %i decimals as %j', (typed, decimals, expected) => {
    expect(sanitizeAmount(typed, decimals)).toBe(expected);
  });

  it.each([
    ['0.1234567', 6],
    ['1.2.3', 6],
    ['-5', 6],
    ['5e3', 6],
    ['abc', 6],
    ['$25', 6],
    ['1.5', 0],
  ])('refuses %j with %i decimals', (typed, decimals) => {
    expect(sanitizeAmount(typed, decimals)).toBeNull();
  });
});

describe('fields', () => {
  it('labels an input, links its hint and marks it invalid with the error read after it', () => {
    render(<Input label="Label for this wallet" hint="Only you see it." error="Enter a label of at least two letters." defaultValue="" />);
    const input = screen.getByLabelText('Label for this wallet');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Only you see it. Enter a label of at least two letters.');
  });

  it('keeps an amount field to what the token allows and reads the unit as part of its description', () => {
    function Harness() {
      const [value, setValue] = useState('');
      return <AmountInput label="Minimum buy" unit="USDG" decimals={6} value={value} onValueChange={setValue} />;
    }
    render(<Harness />);
    const input = screen.getByLabelText('Minimum buy');
    expect(input).toHaveAttribute('inputmode', 'decimal');
    expect(input).toHaveAccessibleDescription('USDG');
    fireEvent.change(input, { target: { value: '25,5' } });
    expect(input).toHaveValue('25.5');
    fireEvent.change(input, { target: { value: '25.1234567' } });
    expect(input).toHaveValue('25.5');
    fireEvent.change(input, { target: { value: '25.123456' } });
    expect(input).toHaveValue('25.123456');
  });

  it('labels a select and a checkbox', () => {
    const onChange = vi.fn();
    render(
      <>
        <Select label="Ticker" defaultValue="0">
          <option value="0">SPY</option>
          <option value="1">QQQ</option>
        </Select>
        <Checkbox label="I am not a US person" description="Sleeve cannot be used by US persons." onChange={onChange} />
      </>,
    );
    expect(screen.getByLabelText('Ticker')).toHaveValue('0');
    const box = screen.getByRole('checkbox', { name: 'I am not a US person' });
    expect(box).toHaveAccessibleDescription('Sleeve cannot be used by US persons.');
    fireEvent.click(screen.getByText('I am not a US person'));
    expect(onChange).toHaveBeenCalledTimes(1);
  });
});

describe('choices', () => {
  it('makes a segmented control a named radio group that reports the new value', () => {
    const onChange = vi.fn();
    render(
      <SegmentedControl
        legend="Equity share"
        options={[
          { value: '500', label: '5%' },
          { value: '1000', label: '10%' },
          { value: '2000', label: '20%', disabled: true },
        ]}
        value="1000"
        onChange={onChange}
      />,
    );
    expect(screen.getByRole('group', { name: 'Equity share' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: '10%' })).toBeChecked();
    expect(screen.getByRole('radio', { name: '20%' })).toBeDisabled();
    fireEvent.click(screen.getByRole('radio', { name: '5%' }));
    expect(onChange).toHaveBeenCalledWith('500');
  });

  it('gives each segmented control its own radio group name', () => {
    const noop = () => undefined;
    render(
      <>
        <SegmentedControl legend="First" options={[{ value: 'a', label: 'A' }]} value="a" onChange={noop} />
        <SegmentedControl legend="Second" options={[{ value: 'a', label: 'A' }]} value="a" onChange={noop} />
      </>,
    );
    const [first, second] = screen.getAllByRole('radio');
    expect(first?.getAttribute('name')).not.toBe(second?.getAttribute('name'));
  });

  it('marks a filter pill pressed', () => {
    render(
      <>
        <FilterPill pressed>Filled</FilterPill>
        <FilterPill pressed={false}>Queued</FilterPill>
      </>,
    );
    expect(screen.getByRole('button', { name: 'Filled' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Queued' })).toHaveAttribute('aria-pressed', 'false');
  });
});

describe('Slider', () => {
  it('reads its value as a percent and reports whole basis points', () => {
    const onValueChange = vi.fn();
    render(<Slider label="Premium cap" value={100} onValueChange={onValueChange} min={0} max={500} step={5} hint="How far above." />);
    const slider = screen.getByRole('slider', { name: 'Premium cap' });
    expect(slider).toHaveAttribute('aria-valuetext', '1.00%');
    expect(slider).toHaveAccessibleDescription('How far above.');
    fireEvent.change(slider, { target: { value: '150' } });
    expect(onValueChange).toHaveBeenCalledWith(150);
  });
});
