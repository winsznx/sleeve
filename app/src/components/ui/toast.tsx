'use client';

import Link from 'next/link';
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type FocusEvent,
  type JSX,
  type ReactNode,
} from 'react';

import { IconButton } from './button';
import { cx } from './cx';
import styles from './motion.module.css';

/**
 * Toasts (docs/DESIGN.md 11.7). One at a time, bottom center on a phone above the bottom navigation, bottom right
 * from 768. A confirmation closes itself after six seconds unless it holds an action; an error stays until it is
 * dismissed. Hovering or focusing a toast pauses its clock. A toast confirms and the receipt records: never put a
 * number only in a toast.
 */

export const TOAST_AUTO_CLOSE_MS = 6_000;

export type ToastTone = 'success' | 'info' | 'warning' | 'danger';

export type ToastAction = { label: string; href: string } | { label: string; onClick: () => void };

export interface ToastInput {
  /** danger is announced as an alert and stays until dismissed. Default success. */
  tone?: ToastTone;
  title: string;
  body?: string;
  /** Shown as a link. A toast with an action stays until dismissed. */
  action?: ToastAction;
}

interface ActiveToast extends ToastInput {
  id: number;
}

export interface ToastApi {
  show: (toast: ToastInput) => void;
  dismiss: () => void;
}

const ToastContext = createContext<ToastApi | null>(null);

const DOT: Record<ToastTone, string> = {
  success: 'bg-success',
  info: 'bg-info',
  warning: 'bg-warning',
  danger: 'bg-danger',
};

function isPersistent(toast: ActiveToast): boolean {
  return toast.tone === 'danger' || toast.action !== undefined;
}

export interface ToastProviderProps {
  children: ReactNode;
}

/**
 * Holds the one toast and renders its live regions. AppShell mounts one; a page outside the shell that shows
 * toasts mounts its own. Both regions exist before anything is announced, so screen readers pick up the change.
 */
export function ToastProvider({ children }: ToastProviderProps): JSX.Element {
  const [current, setCurrent] = useState<ActiveToast | null>(null);
  const [pausedId, setPausedId] = useState<number | null>(null);
  const nextId = useRef(1);
  const remaining = useRef(new Map<number, number>());
  const pointer = useRef({ hover: false, focus: false });

  const dismissToast = useCallback((id?: number) => {
    setCurrent((toast) => (toast === null || (id !== undefined && toast.id !== id) ? toast : null));
  }, []);

  const show = useCallback((input: ToastInput) => {
    const id = nextId.current;
    nextId.current += 1;
    remaining.current.clear();
    pointer.current = { hover: false, focus: false };
    setPausedId(null);
    setCurrent({ ...input, id });
  }, []);

  const api = useMemo<ToastApi>(() => ({ show, dismiss: () => dismissToast() }), [show, dismissToast]);

  const persistent = current !== null && isPersistent(current);
  const paused = current !== null && pausedId === current.id;
  const currentId = current?.id ?? null;

  // The auto-close clock is a timer, an external system. Pausing stores what is left of it for this toast.
  useEffect(() => {
    if (currentId === null || persistent || paused) return;
    const store = remaining.current;
    const budget = store.get(currentId) ?? TOAST_AUTO_CLOSE_MS;
    const startedAt = Date.now();
    const timer = window.setTimeout(() => dismissToast(currentId), budget);
    return () => {
      window.clearTimeout(timer);
      store.set(currentId, Math.max(0, budget - (Date.now() - startedAt)));
    };
  }, [currentId, persistent, paused, dismissToast]);

  function syncPause(id: number) {
    setPausedId(pointer.current.hover || pointer.current.focus ? id : null);
  }

  const card =
    current === null ? null : (
      <ToastCard
        key={current.id}
        toast={current}
        onDismiss={() => dismissToast(current.id)}
        onHoverChange={(hover) => {
          pointer.current.hover = hover;
          syncPause(current.id);
        }}
        onFocusChange={(focus) => {
          pointer.current.focus = focus;
          syncPause(current.id);
        }}
      />
    );
  const isAlert = current?.tone === 'danger';

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(var(--toast-inset,0px)_+_var(--space-3))] z-toast flex flex-col items-center px-gutter md:items-end">
        <div role="status" aria-live="polite" aria-atomic="true" className="w-full max-w-toast">
          {isAlert ? null : card}
        </div>
        <div role="alert" aria-atomic="true" className="w-full max-w-toast">
          {isAlert ? card : null}
        </div>
      </div>
    </ToastContext.Provider>
  );
}

/** The toast API. Throws outside a ToastProvider, so a missing provider fails loudly in development. */
export function useToast(): ToastApi {
  const api = useContext(ToastContext);
  if (api === null) throw new Error('useToast needs a ToastProvider above it (AppShell mounts one)');
  return api;
}

interface ToastCardProps {
  toast: ActiveToast;
  onDismiss: () => void;
  onHoverChange: (hover: boolean) => void;
  onFocusChange: (focus: boolean) => void;
}

function ToastCard({ toast, onDismiss, onHoverChange, onFocusChange }: ToastCardProps): JSX.Element {
  const tone = toast.tone ?? 'success';

  function handleBlur(event: FocusEvent<HTMLDivElement>) {
    if (!event.currentTarget.contains(event.relatedTarget)) onFocusChange(false);
  }

  return (
    <div
      onPointerEnter={() => onHoverChange(true)}
      onPointerLeave={() => onHoverChange(false)}
      onFocus={() => onFocusChange(true)}
      onBlur={handleBlur}
      className={cx(
        styles.toast,
        'pointer-events-auto flex items-start gap-3 rounded-module border border-border bg-surface py-3 pl-4 pr-1 text-body-s text-ink shadow-floating',
      )}
    >
      <span aria-hidden="true" className={cx('mt-1.5 size-2 shrink-0 rounded-pill', DOT[tone])} />
      <div className="min-w-0 flex-1 py-0.5">
        <p className="font-semibold">{toast.title}</p>
        {toast.body === undefined ? null : <p className="mt-0.5 text-ink-secondary">{toast.body}</p>}
        {toast.action === undefined ? null : <ToastActionLink action={toast.action} onDone={onDismiss} />}
      </div>
      <IconButton icon="close" label="Dismiss" onClick={onDismiss} className="-my-2" />
    </div>
  );
}

const ACTION_CLASS =
  'mt-1.5 inline-flex min-h-touch items-center font-medium text-link underline underline-offset-4 hover:text-link-hover';

function ToastActionLink({ action, onDone }: { action: ToastAction; onDone: () => void }): JSX.Element {
  if ('href' in action) {
    return (
      <Link href={action.href} onClick={onDone} className={ACTION_CLASS}>
        {action.label}
      </Link>
    );
  }
  return (
    <button
      type="button"
      onClick={() => {
        action.onClick();
        onDone();
      }}
      className={ACTION_CLASS}
    >
      {action.label}
    </button>
  );
}
