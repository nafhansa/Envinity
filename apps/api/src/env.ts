import { existsSync, readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/**
 * Minimal .env loader (same approach as Securinity): dependency-free, and values
 * already present in process.env always win so container/CI secrets override the file.
 * Resolved relative to this file so `npm run dev` works from any cwd.
 */
function loadDotEnv(): void {
  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
  const path = resolve(repoRoot, '.env');
  if (!existsSync(path)) return;
  for (const rawLine of readFileSync(path, 'utf8').split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let value = line.slice(eq + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

const problems: string[] = [];

function str(key: string, fallback?: string): string {
  const v = process.env[key];
  if (v === undefined || v === '') {
    if (fallback !== undefined) return fallback;
    problems.push(`${key} is required but not set`);
    return '';
  }
  return v;
}

function secret(key: string, minLength = 32): string {
  const v = process.env[key];
  if (!v) {
    problems.push(`${key} is required. Run "npm run setup" in the repo root to generate one.`);
    return '';
  }
  if (v.length < minLength) problems.push(`${key} must be at least ${minLength} characters (got ${v.length}).`);
  if (/^(change|changeme|secret|placeholder|dev)/i.test(v)) problems.push(`${key} is a placeholder value and must be replaced.`);
  return v;
}

function int(key: string, fallback: number): number {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  const n = Number.parseInt(v, 10);
  if (!Number.isFinite(n)) {
    problems.push(`${key} must be an integer (got "${v}").`);
    return fallback;
  }
  return n;
}

function bool(key: string, fallback: boolean): boolean {
  const v = process.env[key];
  if (v === undefined || v === '') return fallback;
  return /^(1|true|yes|on)$/i.test(v);
}

function list(key: string): string[] {
  return (process.env[key] ?? '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const nodeEnv = str('NODE_ENV', 'development');
const isProd = nodeEnv === 'production';

export const env = {
  nodeEnv,
  isProd,
  isTest: nodeEnv === 'test',

  apiPort: int('API_PORT', 4000),
  apiHost: str('API_HOST', '127.0.0.1'),
  /** Public origin of the web app (Astro). Used for CORS. */
  appUrl: str('APP_URL', 'http://localhost:4321').replace(/\/$/, ''),
  extraOrigins: list('CORS_EXTRA_ORIGINS'),

  // Least-privilege role (RLS applies). See migrations/002_app_role.sql.
  databaseUrl: str('DATABASE_URL', 'postgres://envinity_app:envinity_app_dev_password@127.0.0.1:5434/envinity'),
  // Superuser, only used by migrate.ts for DDL.
  migrateDatabaseUrl: str('MIGRATE_DATABASE_URL', 'postgres://envinity:envinity_dev_password@127.0.0.1:5434/envinity'),
  dbPoolMax: int('DB_POOL_MAX', 10),
  dbSsl: bool('DB_SSL', false),

  jwtSecret: secret('JWT_SECRET'),
  /** 32-byte key (base64) that encrypts TOTP secrets at rest. Separate from the JWT key on purpose. */
  totpEncryptionKey: secret('TOTP_ENCRYPTION_KEY', 40),
  /** HMAC pepper for share-code lookups and anti-enumeration salts. */
  lookupPepper: secret('LOOKUP_PEPPER'),

  accessTtlSec: int('ACCESS_TOKEN_TTL_SEC', 900),
  refreshTtlSec: int('REFRESH_TOKEN_TTL_SEC', 60 * 60 * 24 * 30),
  mfaChallengeTtlSec: int('MFA_CHALLENGE_TTL_SEC', 300),

  cookieDomain: process.env.COOKIE_DOMAIN || undefined,
  cookieSecure: bool('COOKIE_SECURE', isProd),
  trustProxyHops: int('TRUST_PROXY_HOPS', 0),
  bodyLimitBytes: int('BODY_LIMIT_BYTES', 256 * 1024),
  logLevel: str('LOG_LEVEL', isProd ? 'info' : 'debug'),

  /** Free-plan ticket lifetime. */
  freeTicketTtlSec: int('FREE_TICKET_TTL_SEC', 600),
  /**
   * Billing is not wired up yet. In development the dashboard can switch plans
   * itself; in production this must stay off until a payment provider sets the plan.
   */
  allowPlanSelfServe: bool('ALLOW_PLAN_SELF_SERVE', !isProd),
  workersEnabled: bool('WORKERS_ENABLED', true),
};

if (problems.length > 0) {
  const message = `Invalid configuration:\n  - ${problems.join('\n  - ')}`;
  // eslint-disable-next-line no-console
  console.error(message);
  throw new Error(message);
}
