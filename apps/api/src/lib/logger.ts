import { env } from '../env.ts';

type Level = 'debug' | 'info' | 'warn' | 'error';

const ORDER: Record<Level, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const threshold = ORDER[(env.logLevel as Level) in ORDER ? (env.logLevel as Level) : 'info'];

/** Field names whose values must never reach the log stream. */
const REDACT = new Set([
  'authorization',
  'cookie',
  'set-cookie',
  'password',
  'password_hash',
  'authkey',
  'auth_key',
  'token',
  'refresh_token',
  'access_token',
  'challengetoken',
  'code',
  'recoverycode',
  'ciphertext',
  'secret',
  'totp_secret',
]);

export function redact(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[deep]';
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    out[k] = REDACT.has(k.toLowerCase()) ? '[redacted]' : redact(v, depth + 1);
  }
  return out;
}

const COLORS: Record<Level, string> = { debug: '\x1b[90m', info: '\x1b[36m', warn: '\x1b[33m', error: '\x1b[31m' };

function emit(level: Level, message: string, context?: Record<string, unknown>): void {
  if (ORDER[level] < threshold) return;
  const payload = { ts: new Date().toISOString(), level, msg: message, ...(context ? (redact(context) as Record<string, unknown>) : {}) };
  if (env.isProd) {
    process.stdout.write(`${JSON.stringify(payload)}\n`);
    return;
  }
  const { ts, level: _l, msg, ...rest } = payload;
  const extra = Object.keys(rest).length ? ` ${JSON.stringify(rest)}` : '';
  process.stdout.write(`${COLORS[level]}${String(ts).slice(11, 23)} ${level.toUpperCase().padEnd(5)}\x1b[0m ${msg}${extra}\n`);
}

export const logger = {
  debug: (m: string, c?: Record<string, unknown>) => emit('debug', m, c),
  info: (m: string, c?: Record<string, unknown>) => emit('info', m, c),
  warn: (m: string, c?: Record<string, unknown>) => emit('warn', m, c),
  error: (m: string, c?: Record<string, unknown>) => emit('error', m, c),
};
