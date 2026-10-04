import { type Server, createServer } from 'node:http';
import type { AddressInfo } from 'node:net';

import type { Address, Hex } from '@sleeve/core';
import { formatEther } from 'viem';

import type { Logger } from './log';
import type { KeeperAction, KeeperOutcome } from './store/store';

/** The health endpoint listens on the loopback interface only. Nothing else listens. */
export const HEALTH_HOST = '127.0.0.1';

export interface LastAction {
  action: KeeperAction;
  account: Address | null;
  tickerId: number | null;
  outcome: KeeperOutcome;
  txHash: Hex | null;
  at: Date;
}

/** What the keeper loop reports as it runs. */
export interface HealthState {
  version: string;
  keeper: Address;
  dryRun: boolean;
  startedAt: Date;
  chainHead: { number: bigint; timestamp: bigint } | null;
  indexed: { number: bigint; timestamp: bigint } | null;
  accountsTracked: number;
  lastAction: LastAction | null;
  lastPassAt: Date | null;
  lastPassError: string | null;
  ethBalanceWei: bigint | null;
  /** Open alerts by code, such as LOW_BALANCE or CALENDAR_COVERAGE. */
  alerts: Map<string, string>;
  halted: string | null;
}

export function initialHealth(version: string, keeper: Address, dryRun: boolean, startedAt: Date): HealthState {
  return {
    version,
    keeper,
    dryRun,
    startedAt,
    chainHead: null,
    indexed: null,
    accountsTracked: 0,
    lastAction: null,
    lastPassAt: null,
    lastPassError: null,
    ethBalanceWei: null,
    alerts: new Map(),
    halted: null,
  };
}

export type HealthStatus = 'ok' | 'starting' | 'lagging' | 'stalled' | 'halted';

export interface HealthLimits {
  maxLagSeconds: number;
  /** The loop counts as stalled when no pass finished for this long. */
  stallMs: number;
}

export interface HealthReport {
  status: HealthStatus;
  httpStatus: 200 | 503;
  body: Record<string, unknown>;
}

export function healthReport(state: HealthState, now: Date, limits: HealthLimits): HealthReport {
  const lagBlocks =
    state.chainHead !== null && state.indexed !== null ? state.chainHead.number - state.indexed.number : null;
  const lagSeconds =
    state.chainHead !== null && state.indexed !== null
      ? Number(state.chainHead.timestamp - state.indexed.timestamp)
      : null;
  let status: HealthStatus;
  if (state.halted !== null) status = 'halted';
  else if (state.lastPassAt === null) status = 'starting';
  else if (now.getTime() - state.lastPassAt.getTime() > limits.stallMs) status = 'stalled';
  else if (lagSeconds === null || lagSeconds > limits.maxLagSeconds) status = 'lagging';
  else status = 'ok';

  const body = {
    status,
    version: state.version,
    keeper: state.keeper,
    dryRun: state.dryRun,
    chainHead: state.chainHead?.number.toString() ?? null,
    lastIndexedBlock: state.indexed?.number.toString() ?? null,
    lagBlocks: lagBlocks?.toString() ?? null,
    lagSeconds,
    accountsTracked: state.accountsTracked,
    lastAction:
      state.lastAction === null
        ? null
        : { ...state.lastAction, tickerId: state.lastAction.tickerId, at: state.lastAction.at.toISOString() },
    lastPassAt: state.lastPassAt?.toISOString() ?? null,
    lastPassError: state.lastPassError,
    ethBalance:
      state.ethBalanceWei === null
        ? null
        : { wei: state.ethBalanceWei.toString(), eth: formatEther(state.ethBalanceWei) },
    alerts: [...state.alerts].map(([code, message]) => ({ code, message })),
    halted: state.halted,
    uptimeSeconds: Math.floor((now.getTime() - state.startedAt.getTime()) / 1_000),
  };
  return { status, httpStatus: status === 'ok' ? 200 : 503, body };
}

export interface HealthServer {
  port: number;
  close(): Promise<void>;
}

/** GET /health on 127.0.0.1:port: 200 when the keeper is current, 503 with the same JSON when it is not. */
export function startHealthServer(port: number, report: () => HealthReport, log: Logger): Promise<HealthServer> {
  const server: Server = createServer((request, response) => {
    const path = (request.url ?? '/').split('?')[0];
    if (path !== '/health') {
      response.writeHead(404, { 'content-type': 'application/json' }).end('{"error":"not found"}');
      return;
    }
    if (request.method !== 'GET' && request.method !== 'HEAD') {
      response
        .writeHead(405, { 'content-type': 'application/json', allow: 'GET, HEAD' })
        .end('{"error":"method not allowed"}');
      return;
    }
    const { httpStatus, body } = report();
    response.writeHead(httpStatus, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    response.end(request.method === 'HEAD' ? undefined : JSON.stringify(body));
  });
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, HEALTH_HOST, () => {
      server.off('error', reject);
      const bound = (server.address() as AddressInfo).port;
      log.info('health endpoint listening', { host: HEALTH_HOST, port: bound });
      resolve({
        port: bound,
        close: () => new Promise((done) => server.close(() => done())),
      });
    });
  });
}
