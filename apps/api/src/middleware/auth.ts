import type { NextFunction, Request, Response } from 'express';
import { env } from '../env.ts';
import { withSystem } from '../db/pool.ts';
import { forbidden, unauthorized } from '../lib/errors.ts';
import { safeEqual, verifyJwt } from '../lib/crypto.ts';

export type Role = 'owner' | 'member';

export interface AuthContext {
  userId: string;
  tenantId: string;
  role: Role;
  email: string;
  name: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    auth?: AuthContext;
  }
}

// Same names as Securinity with an `ev_` prefix, so both apps can share a parent domain.
export const ACCESS_COOKIE = 'ev_at';
export const REFRESH_COOKIE = 'ev_rt';
export const CSRF_COOKIE = 'ev_csrf';

async function authenticateSession(token: string): Promise<AuthContext | null> {
  const result = verifyJwt(token, env.jwtSecret);
  if (!result.ok) return null;
  const { claims } = result;

  // token_version lets "sign out everywhere" and 2FA changes kill every access
  // token immediately, without a revocation list.
  return withSystem(async (db) => {
    const { rows } = await db.query<{ token_version: number; role: Role | null; email: string; name: string }>(
      `SELECT u.token_version, m.role, u.email, u.name
         FROM users u
         LEFT JOIN memberships m ON m.user_id = u.id AND m.tenant_id = $2
        WHERE u.id = $1`,
      [claims.sub, claims.tid],
    );
    const row = rows[0];
    if (!row || row.token_version !== claims.ver || !row.role) return null;
    return { userId: claims.sub, tenantId: claims.tid, role: row.role, email: row.email, name: row.name };
  });
}

/** Populates `req.auth` when a valid session cookie is present. Never rejects. */
export async function attachAuth(req: Request, _res: Response, next: NextFunction): Promise<void> {
  try {
    const token = req.cookies?.[ACCESS_COOKIE];
    if (typeof token === 'string' && token) req.auth = (await authenticateSession(token)) ?? undefined;
    next();
  } catch (err) {
    next(err);
  }
}

export function requireAuth(req: Request, _res: Response, next: NextFunction): void {
  if (!req.auth) {
    next(unauthorized('Sign in to continue.'));
    return;
  }
  next();
}

/**
 * Double-submit CSRF check. The csrf cookie is readable by our own JS; an
 * attacker on another origin can neither read it nor set the matching header.
 */
export function csrfGuard(req: Request, _res: Response, next: NextFunction): void {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) {
    next();
    return;
  }
  // No session cookie: nothing for a forged request to ride on (login/register).
  if (!req.cookies?.[ACCESS_COOKIE] && !req.cookies?.[REFRESH_COOKIE]) {
    next();
    return;
  }
  const cookie = req.cookies?.[CSRF_COOKIE];
  const header = req.headers['x-csrf-token'];
  const provided = Array.isArray(header) ? header[0] : header;
  if (!cookie || !provided || !safeEqual(String(cookie), String(provided))) {
    next(forbidden('CSRF token missing or invalid. Refresh the page and try again.'));
    return;
  }
  next();
}
