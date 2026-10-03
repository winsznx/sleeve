import { cx } from './cx';

/**
 * Button looks (docs/DESIGN.md 11.1), kept apart from the button components so a server component can style a
 * link or a form button with them too. Text buttons are pills and black is the action color: there are no green
 * buttons. The destructive variant darkens on hover, because lightening the red would drop the white label below AA.
 */

export type ButtonVariant = 'primary' | 'secondary' | 'ghost' | 'destructive';
export type ButtonSize = 'sm' | 'md' | 'lg';

const VARIANT: Record<ButtonVariant, string> = {
  primary: 'bg-brand text-on-brand hover:bg-brand-strong',
  secondary: 'border border-border-strong bg-surface text-ink hover:border-ink-muted hover:bg-surface-muted',
  ghost: 'bg-transparent text-ink-secondary hover:text-ink',
  destructive: 'bg-danger text-on-danger hover:bg-danger-strong',
};

const SIZE: Record<ButtonSize, string> = {
  sm: 'min-h-control-sm px-4 text-body-s',
  md: 'min-h-control px-5 text-body',
  lg: 'min-h-control-lg px-6 text-body',
};

const BASE =
  'inline-flex items-center justify-center gap-2 rounded-pill font-medium transition-colors duration-fast ease-standard disabled:cursor-not-allowed disabled:opacity-disabled aria-busy:cursor-progress';

export interface ButtonLook {
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** The main action of a flow on a phone spans the content width. */
  fullWidth?: boolean;
  className?: string;
}

export function buttonClasses({ variant = 'primary', size = 'md', fullWidth = false, className }: ButtonLook): string {
  return cx(BASE, VARIANT[variant], SIZE[size], fullWidth && 'w-full', className);
}
