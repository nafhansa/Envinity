import { Router } from 'express';
import { z } from 'zod';
import { env } from '../env.ts';
import { withTenant } from '../db/pool.ts';
import { forbidden } from '../lib/errors.ts';
import { handler, ok, parseBody, strictObject } from '../lib/http.ts';
import { auditContext, auditIn } from '../lib/audit.ts';

/** Workspace-level data: activity feed and plan. */
export const workspaceRouter = Router();

workspaceRouter.get(
  '/activity',
  handler(async (req, res) => {
    const rows = await withTenant(req.auth!.tenantId, async (db) => {
      const { rows } = await db.query(
        `SELECT id, action, actor_label AS actor, metadata, created_at AS at
           FROM audit_log
          WHERE action LIKE 'ticket.%' OR action LIKE 'plan.%' OR action LIKE 'auth.2fa%'
          ORDER BY created_at DESC
          LIMIT 30`,
      );
      return rows;
    });
    ok(res, { activity: rows });
  }),
);

workspaceRouter.patch(
  '/plan',
  handler(async (req, res) => {
    const { plan } = parseBody(req, strictObject({ plan: z.enum(['free', 'pro']) }));
    const { tenantId, userId, email, role } = req.auth!;
    if (!env.allowPlanSelfServe) throw forbidden('Plans are managed through billing.');
    if (role !== 'owner') throw forbidden('Only the workspace owner can change the plan.');
    const ctx = auditContext(req);
    const result = await withTenant(tenantId, async (db) => {
      const before = await db.query<{ plan: string }>('SELECT plan FROM tenants WHERE id = $1 FOR UPDATE', [tenantId]);
      if (before.rows[0].plan === plan) return { plan, affected: 0 };
      await db.query('UPDATE tenants SET plan = $2 WHERE id = $1', [tenantId, plan]);
      let affected = 0;
      if (plan === 'free') {
        // Downgrade: tickets that were kept forever fall back to the 10-minute rule.
        const r = await db.query(
          `UPDATE tickets SET expires_at = now() + ($1 || ' seconds')::interval
            WHERE expires_at IS NULL AND destroyed_at IS NULL AND revoked_at IS NULL`,
          [String(env.freeTicketTtlSec)],
        );
        affected = r.rowCount ?? 0;
      }
      await auditIn(db, {
        tenantId,
        actorUserId: userId,
        actorLabel: email,
        action: plan === 'pro' ? 'plan.upgraded' : 'plan.downgraded',
        metadata: { affected },
        ...ctx,
      });
      return { plan, affected };
    });
    ok(res, result);
  }),
);
