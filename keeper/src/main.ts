import { parseArgs } from 'node:util';

import { DEPLOYMENT_4663 } from '@sleeve/core';

import { createKeeperApp } from './app';
import { type KeeperConfig, loadConfig } from './config';
import { ConfigError, KeyFileError } from './errors';
import { healthReport, startHealthServer } from './health';
import { loadKeeperAccount } from './keyfile';
import { createLogger, serializeError, urlSecrets } from './log';
import { KEEPER_VERSION } from './version';

const USAGE = `sleeve keeper ${KEEPER_VERSION}

Usage: node dist/main.js [--once] [--dry-run] [--print-address]

  --once           run one pass (index, decide, act), print the health report, exit
  --dry-run        decide and simulate, never sign or send
  --print-address  print the address of KEEPER_PRIVATE_KEY_FILE and exit

Configuration comes from the environment only; keeper/deploy/keeper.env.example lists every variable.`;

function flags(argv: readonly string[]) {
  try {
    return parseArgs({
      args: [...argv],
      options: {
        once: { type: 'boolean', default: false },
        'dry-run': { type: 'boolean', default: false },
        'print-address': { type: 'boolean', default: false },
        help: { type: 'boolean', default: false },
      },
      strict: true,
    }).values;
  } catch (error) {
    throw new ConfigError('CONFIG_INVALID', `${error instanceof Error ? error.message : String(error)}\n\n${USAGE}`);
  }
}

/** Exit codes: 0 done, 1 a pass or the process failed, 2 the flags, the configuration or the key file refused. */
async function main(argv: readonly string[]): Promise<number> {
  const values = flags(argv);
  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  const dryRun = values['dry-run'];

  if (values['print-address']) {
    const file = process.env.KEEPER_PRIVATE_KEY_FILE;
    if (file === undefined || file === '') {
      throw new ConfigError('CONFIG_MISSING', 'KEEPER_PRIVATE_KEY_FILE is required');
    }
    process.stdout.write(`${(await loadKeeperAccount(file)).address}\n`);
    return 0;
  }

  const config: KeeperConfig = loadConfig(process.env, { dryRun });
  const app = await createKeeperApp(config, { dryRun });
  app.log.info('keeper starting', {
    version: KEEPER_VERSION,
    keeper: app.address,
    module: DEPLOYMENT_4663.contracts.SleeveModule.address,
    dryRun,
    once: values.once,
    pollMs: config.pollMs,
    confirmations: config.confirmations,
    gasCeilingWei: config.gasCeilingWei,
    maxFeeWei: config.maxFeeWei,
    maxGas: config.maxGas,
  });
  await app.keeper.start();

  if (values.once) {
    const report = await app.keeper.pass();
    app.log.info('pass finished', { ...report });
    app.log.info('health', healthReport(app.health, new Date(), app.limits).body);
    return report.errors.length === 0 ? 0 : 1;
  }

  const report = (): ReturnType<typeof healthReport> => healthReport(app.health, new Date(), app.limits);
  const server = await startHealthServer(config.healthPort, report, app.log);
  const controller = new AbortController();
  const stop = (signal: string): void => {
    app.log.info('stopping after the current pass', { signal });
    controller.abort();
  };
  process.once('SIGTERM', () => stop('SIGTERM'));
  process.once('SIGINT', () => stop('SIGINT'));
  await app.keeper.run(controller.signal, config.pollMs);
  await server.close();
  app.log.info('keeper stopped');
  return 0;
}

// Redacts from the first line: a crash message from the RPC library can quote the URL, which carries the API key.
const bootLog = createLogger({
  secrets: [...urlSecrets(process.env.KEEPER_RPC ?? ''), process.env.SUPABASE_SERVICE_ROLE_KEY ?? ''],
});
process.on('unhandledRejection', (error) => {
  bootLog.fatal('unhandled rejection', { error: serializeError(error) });
  process.exit(1);
});

main(process.argv.slice(2)).then(
  (code) => {
    process.exitCode = code;
  },
  (error: unknown) => {
    const refused = error instanceof ConfigError || error instanceof KeyFileError;
    bootLog.fatal(refused ? 'keeper refused to start' : 'keeper crashed', { error: serializeError(error) });
    process.exitCode = refused ? 2 : 1;
  },
);
