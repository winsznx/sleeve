'use client';

import { type JSX, type ReactNode, useCallback, useEffect, useRef, useState, useSyncExternalStore } from 'react';

import { cx } from '@/components/ui/cx';

import styles from './pitch.module.css';
import type { Slide } from './slides';

const STAGE_WIDTH = 1920;
const STAGE_HEIGHT = 1080;

/** The URL hash holds the 1-based slide number, so a reload or a shared link opens the same slide. */
function subscribeToHash(onChange: () => void): () => void {
  window.addEventListener('hashchange', onChange);
  return () => window.removeEventListener('hashchange', onChange);
}

function readHash(): string {
  return window.location.hash;
}

function readServerHash(): string {
  return '';
}

function slideIndexFromHash(hash: string, count: number): number {
  const n = Number.parseInt(hash.slice(1), 10);
  return Number.isInteger(n) && n >= 1 && n <= count ? n - 1 : 0;
}

function goTo(index: number): void {
  window.location.hash = String(index + 1);
}

function toggleFullscreen(): void {
  const change = document.fullscreenElement ? document.exitFullscreen() : document.documentElement.requestFullscreen();
  change.catch((error: unknown) => console.warn('The browser refused the fullscreen change', error));
}

const PLACEHOLDER_SPAN = /(\[[^\]]+\])/;

/** Script text with every bracketed placeholder highlighted, like the ones on the slides. */
function NotesText({ text }: { text: string }): ReactNode {
  return text.split(PLACEHOLDER_SPAN).map((part, i) =>
    PLACEHOLDER_SPAN.test(part) ? (
      <mark key={i} className={styles.placeholder}>
        {part}
      </mark>
    ) : (
      part
    ),
  );
}

function SpeakerNotes({ slide, index, count }: { slide: Slide; index: number; count: number }): JSX.Element {
  const [script, ...rest] = slide.notes.split('\n\n');
  return (
    <aside className={styles.notes} aria-label="Speaker notes">
      <p className={styles.notesMeta}>
        {index + 1} of {count}, {slide.title}, starts at {slide.at}
      </p>
      <p className={styles.notesScript}>
        <NotesText text={script ?? ''} />
      </p>
      {rest.map((cue) => (
        <p key={cue} className={styles.notesCue}>
          {cue}
        </p>
      ))}
    </aside>
  );
}

/**
 * The deck: one 1920 by 1080 stage scaled to fit the window. Arrows, space and Page Up or Down move between slides,
 * Home and End jump to the ends, F toggles fullscreen and N the speaker notes. Every slide stays in the DOM so print
 * and the PDF export lay them out one per page.
 */
export function PitchDeck({ slides }: { slides: readonly Slide[] }): JSX.Element {
  const hash = useSyncExternalStore(subscribeToHash, readHash, readServerHash);
  const index = slideIndexFromHash(hash, slides.length);
  const [notesOpen, setNotesOpen] = useState(false);
  const viewportRef = useRef<HTMLDivElement>(null);
  const [scale, setScale] = useState(1);

  const step = useCallback(
    (delta: number) => goTo(Math.min(slides.length - 1, Math.max(0, index + delta))),
    [index, slides.length],
  );

  useEffect(() => {
    const viewport = viewportRef.current;
    if (viewport === null) return;
    const observer = new ResizeObserver(([entry]) => {
      if (entry === undefined) return;
      const { width, height } = entry.contentRect;
      setScale(Math.min(width / STAGE_WIDTH, height / STAGE_HEIGHT));
    });
    observer.observe(viewport);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent): void {
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      switch (event.key) {
        case 'ArrowRight':
        case 'ArrowDown':
        case 'PageDown':
          step(1);
          break;
        case 'ArrowLeft':
        case 'ArrowUp':
        case 'PageUp':
          step(-1);
          break;
        case ' ':
          step(event.shiftKey ? -1 : 1);
          break;
        case 'Home':
          goTo(0);
          break;
        case 'End':
          goTo(slides.length - 1);
          break;
        case 'f':
        case 'F':
          toggleFullscreen();
          break;
        case 'n':
        case 'N':
          setNotesOpen((open) => !open);
          break;
        default:
          return;
      }
      event.preventDefault();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [step, slides.length]);

  const current = slides[index];

  return (
    <div className={styles.deck}>
      <div ref={viewportRef} className={styles.viewport}>
        <div className={styles.stage} style={{ transform: `translate(-50%, -50%) scale(${scale})` }}>
          {slides.map((slide, i) => (
            <section
              key={slide.title}
              className={cx(styles.slide, i === index && styles.current)}
              aria-label={`Slide ${i + 1} of ${slides.length}: ${slide.title}`}
              aria-hidden={i !== index}
            >
              <div className={styles.body}>{slide.body}</div>
              {slide.footnotes ? (
                <ol className={styles.footnotes}>
                  {slide.footnotes.map((note) => (
                    <li key={note.text} className={note.n === undefined ? styles.disclaimer : undefined}>
                      {note.n === undefined ? null : <sup>{note.n}</sup>}
                      {note.text}
                    </li>
                  ))}
                </ol>
              ) : null}
              <span className={styles.number} aria-hidden>
                {String(i + 1).padStart(2, '0')}
              </span>
            </section>
          ))}
        </div>
      </div>
      {notesOpen && current ? <SpeakerNotes slide={current} index={index} count={slides.length} /> : null}
    </div>
  );
}
