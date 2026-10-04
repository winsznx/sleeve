import { act, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { DISCLAIMER } from '@/lib/copy';

import { metadata } from './layout';
import { PitchDeck } from './pitch-deck';
import { SLIDES } from './slides';

function currentSlide(): HTMLElement {
  const visible = screen.getAllByRole('region', { hidden: true }).filter((el) => el.getAttribute('aria-hidden') === 'false');
  expect(visible).toHaveLength(1);
  return visible[0] as HTMLElement;
}

function press(key: string): void {
  act(() => {
    fireEvent.keyDown(window, { key });
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  });
}

beforeEach(() => {
  vi.stubGlobal(
    'ResizeObserver',
    class {
      observe(): void {}
      disconnect(): void {}
    },
  );
  window.location.hash = '';
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('pitch deck', () => {
  it('is kept out of search', () => {
    expect(metadata.robots).toEqual({ index: false, follow: false });
  });

  it('has nine slides with the disclaimer on the first and the last', () => {
    expect(SLIDES).toHaveLength(9);
    const disclaimed = SLIDES.map((slide) => slide.footnotes?.some((note) => note.text === DISCLAIMER) ?? false);
    expect(disclaimed[0]).toBe(true);
    expect(disclaimed[8]).toBe(true);
  });

  it('opens on the slide the hash names and moves with the keys', () => {
    window.location.hash = '#4';
    render(<PitchDeck slides={SLIDES} />);
    expect(currentSlide()).toHaveAccessibleName('Slide 4 of 9: Why now');

    press('ArrowRight');
    expect(window.location.hash).toBe('#5');
    press(' ');
    expect(window.location.hash).toBe('#6');
    press('ArrowLeft');
    expect(window.location.hash).toBe('#5');
    press('End');
    press('ArrowRight');
    expect(window.location.hash).toBe('#9');
    press('Home');
    press('ArrowUp');
    expect(window.location.hash).toBe('#1');
  });

  it('hides the speaker notes until N', () => {
    window.location.hash = '#9';
    render(<PitchDeck slides={SLIDES} />);
    expect(screen.queryByRole('complementary', { name: 'Speaker notes' })).toBeNull();

    press('n');
    const notes = screen.getByRole('complementary', { name: 'Speaker notes' });
    expect(notes).toHaveTextContent("I'm Tim, a protocol engineer in Lagos.");

    press('N');
    expect(screen.queryByRole('complementary', { name: 'Speaker notes' })).toBeNull();
  });

  it('highlights a bracketed placeholder in the notes', () => {
    const slides = [{ ...SLIDES[0]!, notes: 'We are looking for [our ask].' }];
    render(<PitchDeck slides={slides} />);
    press('n');
    const notes = screen.getByRole('complementary', { name: 'Speaker notes' });
    expect(notes.querySelector('mark')).toHaveTextContent('[our ask]');
  });

  it('leaves no placeholder in the script', () => {
    expect(SLIDES.filter((slide) => /\[[^\]]+\]/.test(slide.notes)).map((slide) => slide.title)).toEqual([]);
  });

  it('marks every bracketed value on a slide as a placeholder', () => {
    render(<PitchDeck slides={SLIDES} />);
    for (const slide of screen.getAllByRole('region', { hidden: true })) {
      const bracketed = slide.textContent?.match(/\[[^\]]+\]/g) ?? [];
      const marked = [...slide.querySelectorAll('mark')].map((mark) => mark.textContent);
      expect(marked).toEqual(bracketed);
    }
  });
});
