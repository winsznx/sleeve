import { EXPECTED_DECIMALS, formatUnits } from '@sleeve/core';

import type { CheckRow, DerivedRow, FieldRow, ValueUnit, VerifyResult } from '../types';

/**
 * The CLI's readable report. Every value is printed exactly as the verifier reported it, with a readable form beside
 * it where the unit has one, so two values can be compared digit by digit and nothing is rounded away.
 */

const INTEGER = /^-?\d+$/;

function readable(unit: ValueUnit, raw: string): string | null {
  if (!INTEGER.test(raw)) return null;
  const value = BigInt(raw);
  switch (unit) {
    case 'usdg':
      return `${formatUnits(value, EXPECTED_DECIMALS.USDG)} USDG`;
    case 'token':
      return `${formatUnits(value, EXPECTED_DECIMALS.STOCK_TOKEN)} tokens`;
    case 'feed':
      return `${formatUnits(value, EXPECTED_DECIMALS.FEED)} USD`;
    case 'multiplier':
      return formatUnits(value, 18);
    case 'bps':
      return `${raw} bps`;
    case 'timestamp': {
      const ms = Number(value) * 1_000;
      return Number.isSafeInteger(ms) && value > 0n ? new Date(ms).toISOString().replace('.000Z', 'Z') : null;
    }
    default:
      return null;
  }
}

/** "100000000 (100 USDG)": the raw value, then its readable form when it differs. */
export function shown(unit: ValueUnit, raw: string): string {
  const nice = readable(unit, raw);
  return nice === null || nice === raw ? raw : `${raw} (${nice})`;
}

function grid(header: readonly string[], rows: readonly (readonly string[])[]): string[] {
  const widths = header.map((title, column) => Math.max(title.length, ...rows.map((row) => (row[column] ?? '').length)));
  const line = (cells: readonly string[]): string =>
    cells
      .map((cell, column) => (column === cells.length - 1 ? cell : cell.padEnd(widths[column] ?? cell.length)))
      .join('  ')
      .trimEnd();
  return [line(header), ...rows.map(line)];
}

function fieldLines(fields: readonly FieldRow[]): string[] {
  return grid(
    ['Field', 'Receipt', 'Recomputed', 'Result', 'Source'],
    fields.map((row) => [row.field, shown(row.unit, row.receipt), shown(row.unit, row.recomputed), row.status, row.source]),
  );
}

function checkLines(checks: readonly CheckRow[]): string[] {
  return grid(
    ['Check', 'Observed', 'Expected', 'Result', 'What and from where'],
    checks.map((row) => [row.id, shown(row.unit, row.observed), `${row.relation} ${shown(row.unit, row.expected)}`, row.status, `${row.label}. ${row.source}`]),
  );
}

function derivedLines(derived: readonly DerivedRow[]): string[] {
  return grid(
    ['Derived', 'Value', 'From'],
    derived.map((row) => [row.label, shown(row.unit, row.value), row.source]),
  );
}

function groupedBlock(block: bigint): string {
  return block.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ',');
}

export function formatReport(result: VerifyResult): string {
  const lines: string[] = [];
  const total = result.fields.length + result.checks.length;
  if (result.verdict === 'NOT_FOUND') {
    lines.push(`Receipt ${result.receiptId}: NOT_FOUND. The module at ${result.module} has written no receipt with this id.`);
  } else if (result.verdict === 'MATCH') {
    lines.push(`Receipt ${result.receiptId}: MATCH. All ${total} rows match chain data.`);
  } else {
    lines.push(`Receipt ${result.receiptId}: MISMATCH. ${result.mismatches} of ${total} rows differ from chain data; each is listed as found.`);
  }
  lines.push(`Read through ${result.rpcUrl} at block ${groupedBlock(result.checkedAtBlock)} on chain ${result.chainId}.`);
  if (result.transactionHash !== null) lines.push(`Transaction ${result.transactionHash}.`);
  if (result.verdict === 'NOT_FOUND') return `${lines.join('\n')}\n`;

  // The receipt hash leads: when it differs, every field only the hash vouches for differs with it.
  const hash = result.checks.filter((row) => row.id === 'receipt-hash');
  const others = result.checks.filter((row) => row.id !== 'receipt-hash');
  const failing = [...hash, ...result.fields, ...others].filter((row) => row.status === 'MISMATCH');
  if (failing.length > 0) {
    lines.push('', 'Differs:');
    for (const row of failing) lines.push(`  ${'field' in row ? row.field : row.id}: ${row.label}`);
  }
  lines.push('', 'Receipt fields', ...fieldLines(result.fields).map((line) => `  ${line}`));
  lines.push('', 'Checks', ...checkLines(result.checks).map((line) => `  ${line}`));
  if (result.derived.length > 0) {
    lines.push('', 'Derived from logs, not on the receipt', ...derivedLines(result.derived).map((line) => `  ${line}`));
  }
  return `${lines.join('\n')}\n`;
}

/** JSON with every bigint as a decimal string. */
export function formatJson(result: VerifyResult): string {
  return `${JSON.stringify(result, (_key, value: unknown) => (typeof value === 'bigint' ? value.toString() : value), 2)}\n`;
}
