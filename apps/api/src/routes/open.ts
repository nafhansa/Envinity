import { Router, type Request } from 'express';
import { z } from 'zod';
import { withSystem, type Db } from '../db/pool.ts';
import { gone, notFound } from '../lib/errors.ts';
import { clientIp, handler, ok, parseBody, parseParams, strictObject, uuid } from '../lib/http.ts';
import { rateLimit } from '../lib/ratelimit.ts';
import { auditContext, auditIn } from '../lib/audit.ts';
import { STATUS_SQL, codeLookupHash } from './tickets.ts';

/**
 * Recipient side. The opener is usually in a different workspace from the owner,
 * so these queries run through withSystem and scope by ticket explicitly.
 * The server hands back ciphertext and wrapped keys only: decryption happens in
 * the recipient's browser with the share code (or the key in the QR fragment).
 */
export const openRouter = Router();

interface TicketRow {
  id: string;
  tenant_id: string;
  name: string;
  environment: string;
  var_count: number;
  one_time: boolean;
  expires_at: Date | null;
  status: 'active' | 'expired' | 'revoked' | 'used';
  owner_name: string | null;
  ciphertext: string;
  iv: string;
  code_salt: string | null;
  code_iterations: number | null;
  code_wrapped_key: string | null;
  code_wrap_iv: string | null;
}

const SELECT_TICKET = `
  SELECT t.id, t.tenant_id, t.name, t.environment, t.var_count, t.one_time, t.expires_at,
         ${STATUS_SQL} AS status, u.name AS owner_name,
         t.ciphertext, t.iv, t.code_salt, t.code_iterations, t.code_wrapped_key, t.code_wrap_iv
    FROM tickets t LEFT JOIN users u ON u.id = t.created_by`;

const STATUS_ERRORS = {
  expired: 'This ticket expired. Its data has been destroyed.',
  revoked: 'This ticket was revoked by its owner.',
  used: 'This one-time ticket was already opened.',
} as const;

/** Shared checks + bookkeeping for both ways of opening. */
async function claim(db: Db, req: Request, t: TicketRow | undefined, via: 'code' | 'qr'): Promise<TicketRow> {
  if (!t) throw notFound('No ticket matches this code. Check for typos.');
  if (t.status !== 'active') throw gone(STATUS_ERRORS[t.status]);

  if (t.one_time) {
    // Atomic: two people racing to open a one-time ticket cannot both win.
    const { rowCount } = await db.query('UPDATE tickets SET consumed_at = now() WHERE id = $1 AND consumed_at IS NULL', [t.id]);
    if (!rowCount) throw gone(STATUS_ERRORS.used);
  }

  const { userId, name, email } = req.auth!;
  await db.query(
    'INSERT INTO ticket_opens (tenant_id, ticket_id, opened_by, opener_label, via, ip) VALUES ($1,$2,$3,$4,$5,$6)',
    [t.tenant_id, t.id, userId, name, via, clientIp(req)],
  );
  await auditIn(db, {
    tenantId: t.tenant_id,
    actorUserId: userId,
    actorLabel: email,
    action: 'ticket.opened',
    targetType: 'ticket',
    targetId: t.id,
    metadata: { name: t.name, environment: t.environment, via, by: name },
    ...auditContext(req),
  });
  return t;
}

const meta = (t: TicketRow) => ({
  id: t.id,
  name: t.name,
  environment: t.environment,
  varCount: t.var_count,
  oneTime: t.one_time,
  expiresAt: t.expires_at,
  from: t.owner_name ?? 'A teammate',
});

openRouter.post(
  '/code',
  // Share codes are short, so guessing is throttled hard per user and per IP.
  rateLimit({ scope: 'open:code:user', windowSec: 300, max: 10, key: (req) => req.auth!.userId }),
  rateLimit({ scope: 'open:code:ip', windowSec: 300, max: 30 }),
  handler(async (req, res) => {
    const { lookup } = parseBody(req, strictObject({ lookup: z.string().regex(/^[0-9a-f]{64}$/) }));
    const t = await withSystem(async (db) => {
      const { rows } = await db.query<TicketRow>(`${SELECT_TICKET} WHERE t.code_lookup = $1 FOR UPDATE OF t`, [codeLookupHash(lookup)]);
      const row = rows[0];
      if (row && row.status === 'active' && !row.code_wrapped_key) throw gone(STATUS_ERRORS.revoked);
      return claim(db, req, row, 'code');
    });
    ok(res, {
      ticket: meta(t),
      ciphertext: t.ciphertext,
      iv: t.iv,
      code: { salt: t.code_salt, iterations: t.code_iterations, wrappedKey: t.code_wrapped_key, wrapIv: t.code_wrap_iv },
    });
  }),
);

/** QR links carry the ticket key in the URL fragment, so only id + ciphertext is needed here. */
openRouter.post(
  '/qr/:id',
  rateLimit({ scope: 'open:qr:user', windowSec: 300, max: 30, key: (req) => req.auth!.userId }),
  handler(async (req, res) => {
    const { id } = parseParams(req, z.object({ id: uuid }));
    const t = await withSystem(async (db) => {
      const { rows } = await db.query<TicketRow>(`${SELECT_TICKET} WHERE t.id = $1 FOR UPDATE OF t`, [id]);
      return claim(db, req, rows[0], 'qr');
    });
    ok(res, { ticket: meta(t), ciphertext: t.ciphertext, iv: t.iv });
  }),
);

/** Tickets this user opened (metadata only; the payload is never stored for them). */
openRouter.get(
  '/received',
  handler(async (req, res) => {
    const rows = await withSystem(async (db) => {
      const { rows } = await db.query(
        `SELECT o.id, o.via, o.created_at AS "openedAt", t.name, t.environment, ${STATUS_SQL} AS status,
                COALESCE(u.name, 'A teammate') AS "from"
           FROM ticket_opens o
           JOIN tickets t ON t.id = o.ticket_id
           LEFT JOIN users u ON u.id = t.created_by
          WHERE o.opened_by = $1
          ORDER BY o.created_at DESC
          LIMIT 50`,
        [req.auth!.userId],
      );
      return rows;
    });
    ok(res, { received: rows });
  }),
);
