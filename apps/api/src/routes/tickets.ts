import { Router } from 'express';
import { z } from 'zod';
import { env } from '../env.ts';
import { withTenant } from '../db/pool.ts';
import { hmacHex } from '../lib/crypto.ts';
import { ApiError, notFound, planLimit } from '../lib/errors.ts';
import { b64url, handler, ok, parseBody, parseParams, strictObject, uuid } from '../lib/http.ts';
import { rateLimit } from '../lib/ratelimit.ts';
import { auditContext, auditIn } from '../lib/audit.ts';

export const ticketsRouter = Router();

export const ENVIRONMENTS = ['production', 'staging', 'development', 'preview'] as const;

/** Single source of truth for status, so the list, detail and open endpoints agree. */
export const STATUS_SQL = `
  CASE
    WHEN t.revoked_at IS NOT NULL THEN 'revoked'
    WHEN t.destroyed_at IS NOT NULL OR (t.expires_at IS NOT NULL AND t.expires_at <= now()) THEN 'expired'
    WHEN t.one_time AND t.consumed_at IS NOT NULL THEN 'used'
    ELSE 'active'
  END`;

/** HMAC with a server pepper: a leaked database alone cannot be searched by share code. */
export const codeLookupHash = (clientLookup: string) => hmacHex(env.lookupPepper, `code:${clientLookup}`);

const createSchema = strictObject({
  name: z.string().trim().min(1).max(80),
  environment: z.enum(ENVIRONMENTS),
  varCount: z.number().int().min(1).max(500),
  // AES-256-GCM output from the browser. 150k chars is about 110 KB of .env.
  ciphertext: b64url(17, 112_000),
  iv: b64url(12, 12),
  ownerWrappedKey: b64url(48, 48),
  ownerWrapIv: b64url(12, 12),
  code: strictObject({
    // SHA-256 (hex) of the share code, computed in the browser.
    lookup: z.string().regex(/^[0-9a-f]{64}$/),
    salt: b64url(16, 16),
    iterations: z.number().int().min(100_000).max(2_000_000),
    wrappedKey: b64url(48, 48),
    wrapIv: b64url(12, 12),
  }),
  // The share code itself, wrapped with the owner's vault key (browser-side).
  ownerCode: strictObject({ ct: b64url(17, 64), iv: b64url(12, 12) }),
  oneTime: z.boolean(),
  keepForever: z.boolean(),
});

const idParams = z.object({ id: uuid });

ticketsRouter.get(
  '/',
  handler(async (req, res) => {
    const rows = await withTenant(req.auth!.tenantId, async (db) => {
      const { rows } = await db.query(
        `SELECT t.id, t.name, t.environment, t.var_count AS "varCount", t.one_time AS "oneTime",
                t.expires_at AS "expiresAt", t.created_at AS "createdAt", t.revoked_at AS "revokedAt",
                ${STATUS_SQL} AS status,
                (SELECT count(*)::int FROM ticket_opens o WHERE o.ticket_id = t.id) AS opens
           FROM tickets t
          ORDER BY t.created_at DESC
          LIMIT 500`,
      );
      return rows;
    });
    ok(res, { tickets: rows, serverTime: new Date().toISOString() });
  }),
);

ticketsRouter.post(
  '/',
  rateLimit({ scope: 'tickets:create', windowSec: 3600, max: 120, key: (req) => req.auth!.userId }),
  handler(async (req, res) => {
    const body = parseBody(req, createSchema);
    const { tenantId, userId, email } = req.auth!;
    const ctx = auditContext(req);

    const created = await withTenant(tenantId, async (db) => {
      const plan = await db.query<{ plan: 'free' | 'pro' }>('SELECT plan FROM tenants WHERE id = $1', [tenantId]);
      if (body.keepForever && plan.rows[0]?.plan !== 'pro') {
        throw planLimit('Keeping tickets until you delete them is a Pro feature. Free tickets expire after 10 minutes.');
      }
      try {
        const { rows } = await db.query<{ id: string; expires_at: Date | null }>(
          `INSERT INTO tickets (tenant_id, created_by, name, environment, var_count, ciphertext, iv,
                                owner_wrapped_key, owner_wrap_iv, code_lookup, code_salt, code_iterations,
                                code_wrapped_key, code_wrap_iv, one_time, expires_at, owner_code_enc, owner_code_iv)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,
                   CASE WHEN $16 THEN NULL ELSE now() + ($17 || ' seconds')::interval END, $18, $19)
           RETURNING id, expires_at`,
          [
            tenantId,
            userId,
            body.name,
            body.environment,
            body.varCount,
            body.ciphertext,
            body.iv,
            body.ownerWrappedKey,
            body.ownerWrapIv,
            codeLookupHash(body.code.lookup),
            body.code.salt,
            body.code.iterations,
            body.code.wrappedKey,
            body.code.wrapIv,
            body.oneTime,
            body.keepForever,
            String(env.freeTicketTtlSec),
            body.ownerCode.ct,
            body.ownerCode.iv,
          ],
        );
        await auditIn(db, {
          tenantId,
          actorUserId: userId,
          actorLabel: email,
          action: 'ticket.created',
          targetType: 'ticket',
          targetId: rows[0].id,
          metadata: { name: body.name, environment: body.environment, varCount: body.varCount, keepForever: body.keepForever },
          ...ctx,
        });
        return rows[0];
      } catch (err) {
        // Share codes are generated in the browser; on the rare collision it simply retries.
        if ((err as { code?: string; constraint?: string }).constraint === 'tickets_code_lookup_uq') {
          throw new ApiError(409, 'code_taken', 'That share code is already in use. Generate a new one.');
        }
        throw err;
      }
    });
    ok(res, { id: created.id, expiresAt: created.expires_at }, 201);
  }),
);

ticketsRouter.get(
  '/:id',
  handler(async (req, res) => {
    const { id } = parseParams(req, idParams);
    const result = await withTenant(req.auth!.tenantId, async (db) => {
      const { rows } = await db.query(
        `SELECT t.id, t.name, t.environment, t.var_count AS "varCount", t.one_time AS "oneTime",
                t.expires_at AS "expiresAt", t.created_at AS "createdAt", t.revoked_at AS "revokedAt",
                ${STATUS_SQL} AS status,
                -- Expired payloads are never served, even before the worker wipes them.
                CASE WHEN ${STATUS_SQL} = 'expired' THEN NULL ELSE t.ciphertext END AS ciphertext,
                CASE WHEN ${STATUS_SQL} = 'expired' THEN NULL ELSE t.iv END AS iv,
                CASE WHEN ${STATUS_SQL} = 'expired' THEN NULL ELSE t.owner_wrapped_key END AS "ownerWrappedKey",
                CASE WHEN ${STATUS_SQL} = 'expired' THEN NULL ELSE t.owner_wrap_iv END AS "ownerWrapIv",
                CASE WHEN ${STATUS_SQL} = 'active' THEN t.owner_code_enc END AS "ownerCodeEnc",
                CASE WHEN ${STATUS_SQL} = 'active' THEN t.owner_code_iv END AS "ownerCodeIv"
           FROM tickets t WHERE t.id = $1`,
        [id],
      );
      if (!rows[0]) return null;
      const opens = await db.query(
        `SELECT opener_label AS who, via, created_at AS at FROM ticket_opens WHERE ticket_id = $1 ORDER BY created_at DESC LIMIT 100`,
        [id],
      );
      return { ...rows[0], opens: opens.rows };
    });
    if (!result) throw notFound('This ticket no longer exists.');
    ok(res, { ticket: result, serverTime: new Date().toISOString() });
  }),
);

ticketsRouter.post(
  '/:id/revoke',
  handler(async (req, res) => {
    const { id } = parseParams(req, idParams);
    const { tenantId, userId, email } = req.auth!;
    const ctx = auditContext(req);
    const done = await withTenant(tenantId, async (db) => {
      // The code-wrapped key is destroyed, so the share code can never open it again.
      const { rows } = await db.query<{ name: string; environment: string }>(
        `UPDATE tickets SET revoked_at = now(), code_wrapped_key = NULL, code_wrap_iv = NULL, code_salt = NULL,
                           owner_code_enc = NULL, owner_code_iv = NULL
          WHERE id = $1 AND revoked_at IS NULL RETURNING name, environment`,
        [id],
      );
      if (!rows[0]) return false;
      await auditIn(db, {
        tenantId,
        actorUserId: userId,
        actorLabel: email,
        action: 'ticket.revoked',
        targetType: 'ticket',
        targetId: id,
        metadata: { name: rows[0].name, environment: rows[0].environment },
        ...ctx,
      });
      return true;
    });
    if (!done) throw notFound('This ticket does not exist or is already revoked.');
    ok(res, { revoked: true });
  }),
);

ticketsRouter.delete(
  '/:id',
  handler(async (req, res) => {
    const { id } = parseParams(req, idParams);
    const { tenantId, userId, email } = req.auth!;
    const ctx = auditContext(req);
    const done = await withTenant(tenantId, async (db) => {
      const { rows } = await db.query<{ name: string; environment: string }>(
        'DELETE FROM tickets WHERE id = $1 RETURNING name, environment',
        [id],
      );
      if (!rows[0]) return false;
      await auditIn(db, {
        tenantId,
        actorUserId: userId,
        actorLabel: email,
        action: 'ticket.deleted',
        targetType: 'ticket',
        targetId: id,
        metadata: { name: rows[0].name, environment: rows[0].environment },
        ...ctx,
      });
      return true;
    });
    if (!done) throw notFound('This ticket no longer exists.');
    ok(res, { deleted: true });
  }),
);
