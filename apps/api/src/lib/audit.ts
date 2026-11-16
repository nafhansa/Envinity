import type { Request } from 'express';
import type { Db } from '../db/pool.ts';
import { withSystem } from '../db/pool.ts';
import { clientIp } from './http.ts';
import { logger } from './logger.ts';

export interface AuditEntry {
  tenantId: string | null;
  actorUserId?: string | null;
  actorLabel?: string | null;
  action: string;
  targetType?: string | null;
  targetId?: string | null;
  metadata?: Record<string, unknown>;
  ip?: string | null;
  userAgent?: string | null;
}

const SENSITIVE_KEYS = /pass|secret|token|key|hash|code|cipher/i;

function scrub(meta: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(meta)) out[k] = SENSITIVE_KEYS.test(k) ? '[redacted]' : v;
  return out;
}

/** Writes inside an existing transaction, so the audit row lives or dies with it. */
export async function auditIn(db: Db, entry: AuditEntry): Promise<void> {
  await db.query(
    `INSERT INTO audit_log (tenant_id, actor_user_id, actor_label, action, target_type, target_id, metadata, ip, user_agent)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [
      entry.tenantId,
      entry.actorUserId ?? null,
      entry.actorLabel ?? null,
      entry.action,
      entry.targetType ?? null,
      entry.targetId ?? null,
      JSON.stringify(scrub(entry.metadata ?? {})),
      entry.ip ?? null,
      entry.userAgent?.slice(0, 500) ?? null,
    ],
  );
}

export function audit(entry: AuditEntry): void {
  withSystem((db) => auditIn(db, entry)).catch((err) => {
    logger.error('failed to write audit entry', { action: entry.action, error: err instanceof Error ? err.message : String(err) });
  });
}

export function auditContext(req: Request): { ip: string; userAgent: string } {
  return { ip: clientIp(req), userAgent: String(req.headers['user-agent'] ?? '').slice(0, 500) };
}
