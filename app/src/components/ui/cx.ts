export type ClassValue = string | false | null | undefined;

/**
 * Joins class names and drops the empty ones. There is no merge step, so a caller's className adds layout
 * (margin, width, grid placement) and never restyles a component: two utilities for one property would be
 * decided by stylesheet order, not by the order written here.
 */
export function cx(...values: ClassValue[]): string {
  return values.filter((value): value is string => typeof value === 'string' && value !== '').join(' ');
}
