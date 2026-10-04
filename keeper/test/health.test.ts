import { afterEach, describe, expect, it } from 'vitest';

import { HEALTH_HOST, type HealthServer, type HealthState, healthReport, initialHealth, startHealthServer } from '../src/health';
import { silentLogger } from '../src/log';

const KEEPER = '0x8649275ca7ce63d2f9e6487570ec0dce14b6bf46';
const NOW = new Date('2026-10-04T00:01:00Z');
const LIMITS = { maxLagSeconds: 120, stallMs: 60_000 };

function current(overrides: Partial<HealthState> = {}): HealthState {
  return {
    ...initialHealth('0.0.0+abc', KEEPER, false, new Date('2026-10-04T00:00:00Z')),
    chainHead: { number: 79_450_274n, timestamp: 1_791_067_593n },
    indexed: { number: 79_450_210n, timestamp: 1_791_067_587n },
    accountsTracked: 3,
    lastPassAt: new Date('2026-10-04T00:00:58Z'),
    ethBalanceWei: 3_000_000_000_000_000n,
    ...overrides,
  };
}

describe('healthReport', () => {
  it('is ok with the index current and the loop running', () => {
    // #when
    const report = healthReport(current(), NOW, LIMITS);
    // #then
    expect([report.httpStatus, report.body]).toEqual([
      200,
      {
        status: 'ok',
        version: '0.0.0+abc',
        keeper: KEEPER,
        dryRun: false,
        chainHead: '79450274',
        lastIndexedBlock: '79450210',
        lagBlocks: '64',
        lagSeconds: 6,
        accountsTracked: 3,
        lastAction: null,
        lastPassAt: '2026-10-04T00:00:58.000Z',
        lastPassError: null,
        ethBalance: { wei: '3000000000000000', eth: '0.003' },
        alerts: [],
        halted: null,
        uptimeSeconds: 60,
      },
    ]);
  });

  it.each([
    ['starting before the first pass', { lastPassAt: null }, 'starting'],
    ['stalled when no pass finished in time', { lastPassAt: new Date('2026-10-03T23:59:00Z') }, 'stalled'],
    ['lagging when the index is too far behind', { indexed: { number: 79_449_000n, timestamp: 1_791_067_400n } }, 'lagging'],
    ['halted after a reorg below the cursor', { halted: 'block 79450000 changed' }, 'halted'],
  ])('answers 503 %s', (_label, overrides, status) => {
    // #when
    const report = healthReport(current(overrides), NOW, LIMITS);
    // #then
    expect([report.httpStatus, report.status]).toEqual([503, status]);
  });

  it('lists open alerts', () => {
    // #given
    const state = current();
    state.alerts.set('LOW_BALANCE', 'keeper balance 1 wei is under 1000 wei');
    // #when
    const report = healthReport(state, NOW, LIMITS);
    // #then
    expect([report.httpStatus, report.body.alerts]).toEqual([200, [{ code: 'LOW_BALANCE', message: 'keeper balance 1 wei is under 1000 wei' }]]);
  });
});

describe('startHealthServer', () => {
  let server: HealthServer | null = null;

  afterEach(async () => {
    await server?.close();
    server = null;
  });

  it('serves GET /health on 127.0.0.1 with the report status', async () => {
    // #given
    server = await startHealthServer(0, () => healthReport(current({ lastPassAt: null }), NOW, LIMITS), silentLogger);
    // #when
    const response = await fetch(`http://${HEALTH_HOST}:${server.port}/health`);
    // #then
    expect([response.status, ((await response.json()) as { status: string }).status]).toEqual([503, 'starting']);
  });

  it('answers 404 elsewhere and 405 to writes', async () => {
    // #given
    server = await startHealthServer(0, () => healthReport(current(), NOW, LIMITS), silentLogger);
    // #when
    const statuses = [
      (await fetch(`http://${HEALTH_HOST}:${server.port}/`)).status,
      (await fetch(`http://${HEALTH_HOST}:${server.port}/health`, { method: 'POST' })).status,
    ];
    // #then
    expect(statuses).toEqual([404, 405]);
  });

  it('is not reachable on another interface', async () => {
    // #given
    server = await startHealthServer(0, () => healthReport(current(), NOW, LIMITS), silentLogger);
    const { networkInterfaces } = await import('node:os');
    const external = Object.values(networkInterfaces())
      .flat()
      .find((entry) => entry !== undefined && entry.family === 'IPv4' && !entry.internal);
    if (external === undefined) return;
    // #when
    const reached = await fetch(`http://${external.address}:${server.port}/health`, { signal: AbortSignal.timeout(2_000) }).then(
      () => true,
      () => false,
    );
    // #then
    expect(reached).toBe(false);
  });
});
