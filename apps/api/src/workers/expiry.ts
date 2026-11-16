import { withSystem } from '../db/pool.ts';
import { auditIn } from '../lib/audit.ts';
import { logger } from '../lib/logger.ts';
import { sweepRateLimits } from '../lib/ratelimit.ts';

/**
 * Destroys expired tickets. "Expired" is already enforced at read time; this
 * makes it physical: ciphertext and every wrapped key are overwritten with NULL,
 * so not even a database backup taken afterwards holds the data.
 */
export async function destroyExpiredTickets(): Promise<number> {
  return withSystem(async (db) => {
    const { rows } = await db.query<{ id: string; tenant_id: string; name: string; environment: string }>(
      `UPDATE tickets
          SET ciphertext = NULL, iv = NULL, owner_wrapped_key = NULL, owner_wrap_iv = NULL,
              code_wrapped_key = NULL, code_wrap_iv = NULL, code_salt = NULL,
              owner_code_enc = NULL, owner_code_iv = NULL, destroyed_at = now()
        WHERE destroyed_at IS NULL AND expires_at IS NOT NULL AND expires_at <= now()
        RETURNING id, tenant_id, name, environment`,
    );
    for (const t of rows) {
      await auditIn(db, {
        tenantId: t.tenant_id,
        actorLabel: 'system',
        action: 'ticket.expired',
        targetType: 'ticket',
        targetId: t.id,
        metadata: { name: t.name, environment: t.environment },
      });
    }
    return rows.length;
  });
}

async function housekeeping(): Promise<void> {
  await sweepRateLimits();
  await withSystem(async (db) => {
    await db.query("DELETE FROM mfa_challenges WHERE expires_at < now() - INTERVAL '1 day'");
    await db.query("DELETE FROM refresh_tokens WHERE expires_at < now() - INTERVAL '7 days'");
    await db.query('UPDATE users SET totp_pending_enc = NULL, totp_pending_expires_at = NULL WHERE totp_pending_expires_at < now()');
  });
}

const timers: NodeJS.Timeout[] = [];

export function startWorkers(): void {
  const safe = (name: string, fn: () => Promise<unknown>) => () =>
    fn()
      .then((n) => {
        if (typeof n === 'number' && n > 0) logger.info(`${name}: ${n}`);
      })
      .catch((err) => logger.error(`${name} failed`, { error: err instanceof Error ? err.message : String(err) }));
  // Every 5s: a 10-minute ticket is destroyed within seconds of its deadline.
  timers.push(setInterval(safe('tickets destroyed', destroyExpiredTickets), 5_000));
  timers.push(setInterval(safe('housekeeping', housekeeping), 60 * 60 * 1000));
  for (const t of timers) t.unref();
}

export function stopWorkers(): void {
  for (const t of timers.splice(0)) clearInterval(t);
}
