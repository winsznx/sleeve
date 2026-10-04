#!/usr/bin/env node
/**
 * Builds the app as a Cloudflare Worker with OpenNext and deploys it (D-033).
 *
 *   node scripts/cloudflare.mjs build      check the env, build, and prove no secret reached the output
 *   node scripts/cloudflare.mjs preview    build, then serve the worker locally in workerd
 *   node scripts/cloudflare.mjs deploy     build, deploy, then store the server secrets on the worker
 *
 *   --allow-missing NAME[,NAME]   build without the named public keys, for a staging deploy
 *
 * OpenNext copies every value in the .env files it finds, in app/ and at the repo root, into the worker
 * (.open-next/cloudflare/next-env.mjs). The shared root .env.local also holds the keeper's RPC and the explorer keys.
 * So the build runs with every non-public name set empty, which keeps Next from loading them, the copied file is
 * emptied, and the whole output is scanned for each secret value before anything is uploaded. Public values reach
 * pages through Next's build-time inlining, SUPABASE_SERVICE_ROLE_KEY reaches the worker as a Cloudflare secret, and
 * SLEEVE_ENV comes from wrangler.jsonc. Production's origin, passkey relying party and data source are fixed below
 * (D-034), so .env.local can keep local values for them. Prints names only, never a secret value.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseEnv } from 'node:util';

const APP = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const ROOT = path.join(APP, '..');
const OUTPUT = path.join(APP, '.open-next');
const NEXT_ENV_FILE = path.join(OUTPUT, 'cloudflare', 'next-env.mjs');

/** What production is (D-034). Not secrets: every page carries them. A passkey binds to the relying party for good. */
const PRODUCTION = {
  NEXT_PUBLIC_SITE_URL: 'https://trysleeve.xyz',
  NEXT_PUBLIC_PASSKEY_RP_ID: 'trysleeve.xyz',
  NEXT_PUBLIC_SLEEVE_DATA_SOURCE: 'chain',
};
/** Read by API routes at run time. Stored on the worker as Cloudflare secrets. */
const SERVER_SECRETS = ['SUPABASE_SERVICE_ROLE_KEY'];
/** Non-public names whose values are public anyway, so the leak scan skips them. */
const PUBLIC_CONFIG = new Set(['ROBINHOOD_RPC', 'FORK_RPC', 'KEEPER_PRIVATE_KEY_FILE']);
/** Inlined into the pages at build time. */
const REQUIRED_PUBLIC = [
  'NEXT_PUBLIC_SITE_URL',
  'NEXT_PUBLIC_PASSKEY_RP_ID',
  'NEXT_PUBLIC_ZERODEV_RPC_URL',
  'NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID',
  'NEXT_PUBLIC_SUPABASE_URL',
  'NEXT_PUBLIC_SUPABASE_ANON_KEY',
];
const ZERODEV_URL = /^https:\/\/rpc\.zerodev\.app\/api\/v3\/[0-9a-f-]{36}\/chain\/4663(\?.*)?$/;
/** Shorter values are too likely to occur by chance in a megabyte of minified code. */
const MIN_SCANNED_LENGTH = 16;

function fail(lines) {
  for (const line of lines) console.error(`cloudflare: ${line}`);
  process.exit(1);
}

/** The env files OpenNext reads for production, in its order (later wins), the app's after the root's each time. */
function readEnvFiles() {
  const merged = {};
  for (const name of ['.env', '.env.production', '.env.local', '.env.production.local']) {
    for (const dir of [ROOT, APP]) {
      const file = path.join(dir, name);
      if (existsSync(file) && statSync(file).isFile()) Object.assign(merged, parseEnv(readFileSync(file, 'utf8')));
    }
  }
  return merged;
}

function parseFlags(argv) {
  const allowMissing = new Set();
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === '--allow-missing') {
      for (const name of (argv[index + 1] ?? '').split(',').filter(Boolean)) allowMissing.add(name);
      index += 1;
    } else {
      fail([`unknown argument ${argv[index]}`]);
    }
  }
  return { allowMissing };
}

/** Every problem with the production env, by name. */
function checkEnv(env, { allowMissing, needSecrets }) {
  const problems = [];
  const value = (name) => (env[name] ?? '').trim();
  if (value('NEXT_PUBLIC_SLEEVE_DATA_SOURCE') !== 'chain') problems.push('NEXT_PUBLIC_SLEEVE_DATA_SOURCE must be "chain"');
  for (const name of REQUIRED_PUBLIC) {
    if (value(name) === '' && !allowMissing.has(name)) problems.push(`${name} is empty`);
  }
  if (needSecrets) {
    for (const name of SERVER_SECRETS) if (value(name) === '') problems.push(`${name} is empty`);
  }
  const site = value('NEXT_PUBLIC_SITE_URL');
  if (site !== '') {
    let url = null;
    try {
      url = new URL(site);
    } catch {
      problems.push('NEXT_PUBLIC_SITE_URL is not a URL');
    }
    if (url !== null && (url.protocol !== 'https:' || url.origin !== site.replace(/\/$/, ''))) {
      problems.push('NEXT_PUBLIC_SITE_URL must be an https origin with no path, like https://trysleeve.xyz');
    }
    const rpId = value('NEXT_PUBLIC_PASSKEY_RP_ID');
    if (url !== null && rpId !== '' && url.hostname !== rpId && !url.hostname.endsWith(`.${rpId}`)) {
      problems.push('NEXT_PUBLIC_PASSKEY_RP_ID must be the site host or a parent domain of it');
    }
  }
  const zeroDev = value('NEXT_PUBLIC_ZERODEV_RPC_URL');
  if (zeroDev !== '' && !ZERODEV_URL.test(zeroDev)) {
    problems.push('NEXT_PUBLIC_ZERODEV_RPC_URL must be https://rpc.zerodev.app/api/v3/<project id>/chain/4663');
  }
  const readRpc = value('NEXT_PUBLIC_ROBINHOOD_RPC_URL');
  if (readRpc !== '' && !readRpc.startsWith('https://')) problems.push('NEXT_PUBLIC_ROBINHOOD_RPC_URL must be https');
  for (const [name, secret] of secretValues(env)) {
    for (const publicName of Object.keys(env).filter((key) => key.startsWith('NEXT_PUBLIC_'))) {
      if (value(publicName).includes(secret)) problems.push(`${publicName} holds the value of ${name}, which must never reach a browser`);
    }
  }
  return problems;
}

/** The values that must never leave this machine except as Cloudflare secrets: every non-public name. */
function secretValues(env) {
  return Object.entries(env)
    .filter(([name, value]) => !name.startsWith('NEXT_PUBLIC_') && !PUBLIC_CONFIG.has(name) && value.trim().length >= MIN_SCANNED_LENGTH)
    .map(([name, value]) => [name, value.trim()]);
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: APP, stdio: 'inherit', ...options });
  if (result.status !== 0) fail([`${command} ${args.join(' ')} exited with ${result.status ?? result.signal}`]);
}

function filesUnder(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    const full = path.join(dir, entry.name);
    return entry.isDirectory() ? filesUnder(full) : entry.isFile() ? [full] : [];
  });
}

function build(env) {
  const buildEnv = { ...process.env, ...PRODUCTION, SLEEVE_ENV: 'production' };
  delete buildEnv.NEXT_DIST_DIR;
  for (const [name] of secretValues(env)) buildEnv[name] = '';
  run('pnpm', ['exec', 'opennextjs-cloudflare', 'build'], { env: buildEnv });

  if (!existsSync(NEXT_ENV_FILE)) fail([`${path.relative(APP, NEXT_ENV_FILE)} is missing; OpenNext's output layout changed`]);
  writeFileSync(NEXT_ENV_FILE, 'export const production = {};\nexport const development = {};\nexport const test = {};\n');

  const secrets = secretValues(env).map(([name, secret]) => [name, Buffer.from(secret)]);
  const leaks = [];
  for (const file of filesUnder(OUTPUT)) {
    const bytes = readFileSync(file);
    for (const [name, secret] of secrets) if (bytes.includes(secret)) leaks.push(`the value of ${name} is in ${path.relative(APP, file)}`);
  }
  if (leaks.length > 0) fail(['refusing to continue, a secret reached the build output:', ...leaks]);
  console.log(`cloudflare: build clean, ${secrets.length} secret values absent from ${path.relative(APP, OUTPUT)}`);
}

function putSecrets(env) {
  const payload = JSON.stringify(Object.fromEntries(SERVER_SECRETS.map((name) => [name, env[name].trim()])));
  run('pnpm', ['exec', 'wrangler', 'secret', 'bulk'], { input: payload, stdio: ['pipe', 'inherit', 'inherit'] });
}

const [command, ...rest] = process.argv.slice(2);
if (!['build', 'preview', 'deploy'].includes(command)) fail(['usage: node scripts/cloudflare.mjs build|preview|deploy [--allow-missing NAME,...]']);
const flags = parseFlags(rest);
const env = {
  ...readEnvFiles(),
  ...Object.fromEntries(Object.entries(process.env).filter(([name]) => name.startsWith('NEXT_PUBLIC_'))),
  ...PRODUCTION,
};
const problems = checkEnv(env, { allowMissing: flags.allowMissing, needSecrets: command === 'deploy' });
if (problems.length > 0) fail(['the production env is not ready:', ...problems]);
console.log(`cloudflare: production is ${PRODUCTION.NEXT_PUBLIC_SITE_URL}, passkeys bind to ${PRODUCTION.NEXT_PUBLIC_PASSKEY_RP_ID}`);
for (const name of flags.allowMissing) console.log(`cloudflare: building without ${name}, as --allow-missing asked`);

build(env);
if (command === 'preview') run('pnpm', ['exec', 'opennextjs-cloudflare', 'preview']);
if (command === 'deploy') {
  run('pnpm', ['exec', 'opennextjs-cloudflare', 'deploy']);
  putSecrets(env);
}
