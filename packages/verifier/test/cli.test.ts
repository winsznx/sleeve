import { PUBLIC_RPC_URL } from '@sleeve/core';
import { describe, expect, it } from 'vitest';

import { checkEvidence, notFoundResult } from '../src/check';
import { EXIT, USAGE, runCli, type Verify } from '../src/cli/run';
import { formatJson, formatReport, shown } from '../src/cli/table';
import { ProviderBlockedError } from '../src/errors';
import type { VerifyResult } from '../src/types';
import type { VerifyOptions } from '../src/verify';
import { filledSplit } from './support/fixtures';

function capture(): { out: string[]; err: string[]; io: { out: (text: string) => void; err: (text: string) => void } } {
  const out: string[] = [];
  const err: string[] = [];
  return { out, err, io: { out: (text) => out.push(text), err: (text) => err.push(text) } };
}

function returning(result: VerifyResult, seen: { id?: bigint; options?: VerifyOptions } = {}): Verify {
  return async (id, options) => {
    seen.id = id;
    seen.options = options;
    return result;
  };
}

const matching = checkEvidence(filledSplit().evidence);
const differing = checkEvidence({ ...filledSplit().evidence, storedHash: `0x${'00'.repeat(32)}` });
const missing = notFoundResult({ id: 99n, rpcUrl: PUBLIC_RPC_URL, chainId: 4663, module: matching.module, latestBlock: 1n, latestTimestamp: 1n });

describe('sleeve verify', () => {
  it('exits 0 and prints the report when every row matches', async () => {
    // #given
    const { out, io } = capture();
    const seen: { id?: bigint; options?: VerifyOptions } = {};
    // #when
    const code = await runCli(['verify', '3'], io, returning(matching, seen));
    // #then
    expect(code).toBe(EXIT.MATCH);
    expect(seen.id).toBe(3n);
    expect(seen.options?.rpcUrl).toBe(PUBLIC_RPC_URL);
    expect(out.join('')).toMatch(/^Receipt 3: MATCH\. All \d+ rows match chain data\./);
  });

  it('exits 1 on a mismatch and lists what differs first', async () => {
    const { out, io } = capture();
    const code = await runCli(['verify', '3'], io, returning(differing));
    expect(code).toBe(EXIT.MISMATCH);
    expect(out.join('')).toMatch(/MISMATCH\. \d+ of \d+ rows differ/);
    expect(out.join('')).toMatch(/Differs:\n {2}receipt-hash/);
  });

  it('exits 2 for an id the module never wrote', async () => {
    const { out, io } = capture();
    expect(await runCli(['verify', '99'], io, returning(missing))).toBe(EXIT.NOT_FOUND);
    expect(out.join('')).toMatch(/NOT_FOUND/);
  });

  it('passes --rpc and --from-block, and prints JSON with --json', async () => {
    const { out, io } = capture();
    const seen: { id?: bigint; options?: VerifyOptions } = {};
    const code = await runCli(['verify', '--json', '3', '--rpc', 'https://other.rpc', '--from-block', '79338287'], io, returning(matching, seen));
    expect(code).toBe(EXIT.MATCH);
    expect(seen.options).toMatchObject({ rpcUrl: 'https://other.rpc', fromBlock: 79_338_287n });
    const parsed: unknown = JSON.parse(out.join(''));
    expect(parsed).toMatchObject({ receiptId: '3', verdict: 'MATCH' });
  });

  it('reports progress on stderr only when asked to', async () => {
    const { err, io } = capture();
    const verify: Verify = async (id, options) => {
      options.onProgress?.('receipt log');
      return returning(matching)(id, options);
    };
    await runCli(['verify', '3'], { ...io, progress: true }, verify);
    expect(err.join('')).toBe('reading receipt log\n');
  });

  it('exits 3 when the chain could not be read', async () => {
    const { err, io } = capture();
    const blocked: Verify = async () => {
      throw new ProviderBlockedError(PUBLIC_RPC_URL, 6, 429, new Error('429'));
    };
    expect(await runCli(['verify', '3'], io, blocked)).toBe(EXIT.UNVERIFIED);
    expect(err.join('')).toMatch(/could not verify receipt 3: .*refused 6 attempts/);
  });

  it('exits 3 and names an unexpected error', async () => {
    const { err, io } = capture();
    const broken: Verify = async () => {
      throw new TypeError('boom');
    };
    expect(await runCli(['verify', '3'], io, broken)).toBe(EXIT.UNVERIFIED);
    expect(err.join('')).toMatch(/TypeError: boom/);
  });

  it.each([
    [['verify']],
    [['verify', 'abc']],
    [['verify', '1', '2']],
    [['verify', '1', '--rpc']],
    [['verify', '1', '--rpc', 'ftp://x']],
    [['verify', '1', '--from-block', 'x']],
    [['verify', '1', '--fast']],
    [['check', '1']],
  ])('exits 64 with the usage for %j', async (argv) => {
    const { err, io } = capture();
    expect(await runCli(argv, io, returning(matching))).toBe(EXIT.USAGE);
    expect(err.join('')).toContain(USAGE);
  });

  it('prints the usage for help', async () => {
    for (const argv of [[], ['--help'], ['-h'], ['help'], ['verify', '--help']]) {
      const { out, io } = capture();
      expect(await runCli(argv, io, returning(matching))).toBe(0);
      expect(out.join('')).toBe(USAGE);
    }
  });
});

describe('the report', () => {
  it('prints raw values with a readable form beside them, never rounded', () => {
    expect(shown('usdg', '100000000')).toBe('100000000 (100 USDG)');
    expect(shown('token', '129405328380230006')).toBe('129405328380230006 (0.129405328380230006 tokens)');
    expect(shown('feed', '77276570642')).toBe('77276570642 (772.76570642 USD)');
    expect(shown('timestamp', '1791158460')).toBe('1791158460 (2026-10-05T00:01:00Z)');
    expect(shown('bps', '-12')).toBe('-12 (-12 bps)');
    expect(shown('usdg', 'not committed: the stored hash differs')).toBe('not committed: the stored hash differs');
    expect(shown('address', '0x00')).toBe('0x00');
  });

  it('has every field and check, and the derived rows apart', () => {
    const report = formatReport(matching);
    expect(report).toContain('Receipt fields');
    expect(report).toContain('Checks');
    expect(report).toContain('Derived from logs, not on the receipt');
    for (const row of matching.fields) expect(report).toContain(row.field);
  });

  it('writes JSON with bigints as decimal strings', () => {
    const parsed: unknown = JSON.parse(formatJson(matching));
    expect(parsed).toMatchObject({ checkedAtBlock: matching.checkedAtBlock.toString(), receipt: { usdgIn: '1000000000' } });
  });
});
