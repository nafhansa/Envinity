import pg from 'pg';
import { env } from '../env.ts';
import { logger } from '../lib/logger.ts';

const { Pool } = pg;

pg.types.setTypeParser(pg.types.builtins.INT8, (v) => Number.parseInt(v, 10));

export const pool = new Pool({
  connectionString: env.databaseUrl,
  max: env.dbPoolMax,
  ssl: env.dbSsl ? { rejectUnauthorized: true } : undefined,
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 8_000,
  statement_timeout: 15_000,
  query_timeout: 20_000,
});

pool.on('error', (err) => logger.error('postgres pool error', { error: err.message }));

export type Db = pg.PoolClient;

/**
 * Runs `fn` in a transaction pinned to one tenant. Row Level Security does the
 * rest: a query that forgets its WHERE clause returns nothing instead of
 * another workspace's tickets. Same pattern as Securinity.
 */
export async function withTenant<T>(tenantId: string, fn: (db: Db) => Promise<T>): Promise<T> {
  if (!/^[0-9a-f-]{36}$/i.test(tenantId)) throw new Error('withTenant called with a malformed tenant id');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.tenant_id', tenantId]);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

/**
 * Cross-tenant access: auth, the expiry worker, and opening a teammate's ticket
 * by code (the recipient is, by definition, outside the owner's workspace).
 */
export async function withSystem<T>(fn: (db: Db) => Promise<T>): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query('SELECT set_config($1, $2, true)', ['app.bypass_rls', 'on']);
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK').catch(() => {});
    throw err;
  } finally {
    client.release();
  }
}

export async function healthcheck(): Promise<{ ok: boolean; latencyMs: number }> {
  const started = performance.now();
  try {
    await pool.query('SELECT 1');
    return { ok: true, latencyMs: Math.round(performance.now() - started) };
  } catch {
    return { ok: false, latencyMs: Math.round(performance.now() - started) };
  }
}

export async function closePool(): Promise<void> {
  await pool.end();
}
