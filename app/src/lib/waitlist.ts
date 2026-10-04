/**
 * The waitlist form's fields and the server's reading of them (D-038), shared so the page and the API route accept
 * exactly the same input. The database checks the same shapes again (supabase/migrations, waitlist).
 */

/** The form's one optional question: how the person is paid today. */
export const PAID_WITH = [
  { value: 'stablecoins', label: 'In stablecoins (USDG, USDC or USDT)' },
  { value: 'bank', label: 'By bank transfer' },
  { value: 'both', label: 'A mix of both' },
  { value: 'payer', label: 'I pay other people' },
] as const;

export type PaidWith = (typeof PAID_WITH)[number]['value'];

const PAID_WITH_VALUES = new Set<string>(PAID_WITH.map((option) => option.value));
const EMAIL = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const SOURCE = /^[a-z-]{1,32}$/;
const DEFAULT_SOURCE = 'site';

/** The honeypot field: hidden from people, filled in by bots. */
export const WAITLIST_TRAP_FIELD = 'company';

export interface WaitlistEntry {
  email: string;
  paidWith: PaidWith | null;
  source: string;
}

export type WaitlistRequest =
  | { kind: 'entry'; entry: WaitlistEntry }
  /** The honeypot was filled: answer as if it worked and store nothing. */
  | { kind: 'trap' }
  | { kind: 'invalid'; error: string };

/** The address lowercased and trimmed, or null when it cannot be an email address. */
export function normalizeEmail(text: string): string | null {
  const email = text.trim().toLowerCase();
  return email.length >= 6 && email.length <= 254 && EMAIL.test(email) ? email : null;
}

/** Where the form was opened from, as the `from` query names it, or the default. */
export function waitlistSource(text: string | null | undefined): string {
  return text !== null && text !== undefined && SOURCE.test(text) ? text : DEFAULT_SOURCE;
}

export function parseWaitlistRequest(body: unknown): WaitlistRequest {
  if (typeof body !== 'object' || body === null) return { kind: 'invalid', error: 'Send the form as a JSON object.' };
  const fields = body as Record<string, unknown>;
  const trap = fields[WAITLIST_TRAP_FIELD];
  if (typeof trap === 'string' && trap.trim() !== '') return { kind: 'trap' };

  const email = typeof fields.email === 'string' ? normalizeEmail(fields.email) : null;
  if (email === null) return { kind: 'invalid', error: 'Enter an email address like you@example.com.' };

  const paidWith = fields.paidWith;
  if (paidWith !== undefined && paidWith !== null && paidWith !== '' && !(typeof paidWith === 'string' && PAID_WITH_VALUES.has(paidWith))) {
    return { kind: 'invalid', error: 'Choose how you are paid from the list, or leave it empty.' };
  }
  return {
    kind: 'entry',
    entry: {
      email,
      paidWith: typeof paidWith === 'string' && paidWith !== '' ? (paidWith as PaidWith) : null,
      source: waitlistSource(typeof fields.source === 'string' ? fields.source : null),
    },
  };
}
