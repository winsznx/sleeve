/**
 * Structured logs: one JSON object per line on stdout, which journald keeps on the VPS. Every line has time, level
 * and msg; fields follow. bigints print as decimal strings. Known secrets (the RPC URL's path, which carries the
 * provider's token, and the Supabase service key) are replaced in the serialized line, so an error from a library
 * that quotes its request cannot leak them.
 */

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error', 'fatal'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export type LogFields = Readonly<Record<string, unknown>>;

export interface Logger {
  debug(msg: string, fields?: LogFields): void;
  info(msg: string, fields?: LogFields): void;
  warn(msg: string, fields?: LogFields): void;
  error(msg: string, fields?: LogFields): void;
  fatal(msg: string, fields?: LogFields): void;
  child(fields: LogFields): Logger;
}

export interface LoggerOptions {
  level?: LogLevel;
  /** Strings that must never appear in a line. Shorter than 8 characters is ignored. */
  secrets?: readonly string[];
  write?: (line: string) => void;
  now?: () => Date;
}

const REDACTED = '[redacted]';
const MIN_SECRET_LENGTH = 8;

export function isLogLevel(value: string): value is LogLevel {
  return (LOG_LEVELS as readonly string[]).includes(value);
}

/** An error as plain fields. viem errors keep their short message and details, not their request bodies. */
export function serializeError(error: unknown): Record<string, unknown> {
  if (!(error instanceof Error)) return { message: String(error) };
  const fields: Record<string, unknown> = { name: error.name, message: error.message };
  for (const key of ['code', 'shortMessage', 'details', 'pgCode', 'rule', 'operation', 'txHash'] as const) {
    const value: unknown = (error as unknown as Record<string, unknown>)[key];
    if (value !== undefined && value !== null && value !== '') fields[key] = value;
  }
  if (error.cause !== undefined) fields.cause = serializeError(error.cause);
  return fields;
}

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === 'bigint') return value.toString();
  if (value instanceof Error) return serializeError(value);
  if (value instanceof Map) return Object.fromEntries(value);
  if (value instanceof Set) return [...value];
  return value;
}

export function createLogger(options: LoggerOptions = {}, base: LogFields = {}): Logger {
  const threshold = LOG_LEVELS.indexOf(options.level ?? 'info');
  const secrets = (options.secrets ?? []).filter((secret) => secret.length >= MIN_SECRET_LENGTH);
  const write = options.write ?? ((line: string) => process.stdout.write(`${line}\n`));
  const now = options.now ?? (() => new Date());

  function emit(level: LogLevel, msg: string, fields: LogFields | undefined): void {
    if (LOG_LEVELS.indexOf(level) < threshold) return;
    let line = JSON.stringify({ time: now().toISOString(), level, msg, ...base, ...fields }, replacer);
    for (const secret of secrets) line = line.split(secret).join(REDACTED);
    write(line);
  }

  return {
    debug: (msg, fields) => emit('debug', msg, fields),
    info: (msg, fields) => emit('info', msg, fields),
    warn: (msg, fields) => emit('warn', msg, fields),
    error: (msg, fields) => emit('error', msg, fields),
    fatal: (msg, fields) => emit('fatal', msg, fields),
    child: (fields) => createLogger(options, { ...base, ...fields }),
  };
}

/** The parts of a URL that can carry a credential: userinfo, path and query. */
export function urlSecrets(url: string): string[] {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return [url];
  }
  const parts = [url, `${parsed.pathname}${parsed.search}`, parsed.password, parsed.username];
  return parts.filter((part) => part.length >= MIN_SECRET_LENGTH && part !== '/');
}

/** A logger that drops everything, for tests that do not look at logs. */
export const silentLogger: Logger = createLogger({ write: () => undefined });
