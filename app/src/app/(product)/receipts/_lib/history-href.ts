/** Filters an old /receipts link carries, kept when it moves to /history (D-024). */
const KEPT_PARAMS = ['ticker', 'status'] as const;

/** Where an old /receipts link lands now: the history list, with its ticker and status filters. */
export function historyHref(params: { [key: string]: string | string[] | undefined }): string {
  const query = new URLSearchParams();
  for (const name of KEPT_PARAMS) {
    const value = params[name];
    if (typeof value === 'string' && value !== '') query.set(name, value);
  }
  const text = query.toString();
  return text === '' ? '/history' : `/history?${text}`;
}
