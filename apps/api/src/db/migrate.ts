import { createHash } from 'node:crypto';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';
import { env } from '../env.ts';
import { logger } from '../lib/logger.ts';

const migrationsDir = join(dirname(fileURLToPath(import.meta.url)), 'migrations');

// Separate superuser connection: DDL needs it, while every request query runs as
// the least-privilege `envinity_app` role (migrations/002_app_role.sql).
const pool = new pg.Pool({ connectionString: env.migrateDatabaseUrl, max: 2 });

export async function migrate(): Promise<void> {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name        TEXT PRIMARY KEY,
      checksum    TEXT NOT NULL,
      applied_at  TIMESTAMPTZ NOT NULL DEFAULT now()
    )`);

  const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await pool.query<{ name: string; checksum: string }>('SELECT name, checksum FROM schema_migrations');
  const applied = new Map(rows.map((r) => [r.name, r.checksum]));

  for (const file of files) {
    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    const sum = createHash('sha256').update(sql).digest('hex').slice(0, 32);
    const previous = applied.get(file);
    if (previous) {
      if (previous !== sum) {
        throw new Error(`Migration ${file} was modified after it was applied. Create a new migration file instead.`);
      }
      continue;
    }
    logger.info(`applying migration ${file}`);
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(sql);
      await client.query('INSERT INTO schema_migrations (name, checksum) VALUES ($1, $2)', [file, sum]);
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK').catch(() => {});
      throw new Error(`Migration ${file} failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      client.release();
    }
  }
  logger.info(`database up to date (${files.length} migration${files.length === 1 ? '' : 's'})`);
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];
if (invokedDirectly) {
  migrate()
    .then(() => pool.end())
    .then(() => process.exit(0))
    .catch(async (err) => {
      logger.error('migration failed', { error: err instanceof Error ? err.message : String(err) });
      await pool.end().catch(() => {});
      process.exit(1);
    });
}
