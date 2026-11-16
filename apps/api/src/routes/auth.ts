import { Router, type CookieOptions, type Response } from 'express';
import { z } from 'zod';
import { env } from '../env.ts';
import { withSystem, type Db } from '../db/pool.ts';
import { hashSecret, hmacHex, openString, randomToken, sealString, sha256, signJwt, verifySecret } from '../lib/crypto.ts';
import { badRequest, conflict, unauthorized } from '../lib/errors.ts';
import { b64url, handler, ok, parseBody, strictObject } from '../lib/http.ts';
import { rateLimit } from '../lib/ratelimit.ts';
import { auditContext, auditIn } from '../lib/audit.ts';
import {
  generateRecoveryCodes,
  generateTotpSecret,
  hashRecoveryCode,
  otpauthUri,
  verifyTotp,
} from '../lib/totp.ts';
import { ACCESS_COOKIE, CSRF_COOKIE, REFRESH_COOKIE, requireAuth, type Role } from '../middleware/auth.ts';

export const authRouter = Router();

const MAX_FAILED_LOGINS = 8;
const LOCKOUT_MINUTES = 15;
const MAX_MFA_ATTEMPTS = 5;
const DEFAULT_KDF_ITERATIONS = 600_000; // OWASP 2023 guidance for PBKDF2-HMAC-SHA256
const TOTP_SETUP_TTL_MIN = 10;

// ---------------------------------------------------------------------------
// Cookies (Securinity's scheme: httpOnly access + path-scoped refresh + readable CSRF)
// ---------------------------------------------------------------------------

function baseCookie(): CookieOptions {
  return { httpOnly: true, secure: env.cookieSecure, sameSite: 'lax', domain: env.cookieDomain, path: '/' };
}

function setSessionCookies(res: Response, accessToken: string, refreshToken: string, csrfToken: string): void {
  res.cookie(ACCESS_COOKIE, accessToken, { ...baseCookie(), maxAge: env.accessTtlSec * 1000 });
  res.cookie(REFRESH_COOKIE, refreshToken, { ...baseCookie(), path: '/api/auth', maxAge: env.refreshTtlSec * 1000 });
  res.cookie(CSRF_COOKIE, csrfToken, { ...baseCookie(), httpOnly: false, maxAge: env.refreshTtlSec * 1000 });
}

function clearSessionCookies(res: Response): void {
  res.clearCookie(ACCESS_COOKIE, { ...baseCookie() });
  res.clearCookie(REFRESH_COOKIE, { ...baseCookie(), path: '/api/auth' });
  res.clearCookie(CSRF_COOKIE, { ...baseCookie(), httpOnly: false });
}

interface IssueInput {
  userId: string;
  tenantId: string;
  tokenVersion: number;
  familyId?: string;
  ip: string;
  userAgent: string;
}

async function issueSession(db: Db, res: Response, input: IssueInput): Promise<void> {
  const accessToken = signJwt({ sub: input.userId, tid: input.tenantId, ver: input.tokenVersion }, env.jwtSecret, env.accessTtlSec);
  const refreshToken = randomToken(48);
  await db.query(
    `INSERT INTO refresh_tokens (user_id, family_id, token_hash, user_agent, ip, expires_at)
     VALUES ($1, COALESCE($2::uuid, gen_random_uuid()), $3, $4, $5, now() + ($6 || ' seconds')::interval)`,
    [input.userId, input.familyId ?? null, sha256(refreshToken), input.userAgent.slice(0, 500), input.ip, String(env.refreshTtlSec)],
  );
  setSessionCookies(res, accessToken, refreshToken, randomToken(24));
}

/** What the dashboard needs after any successful sign-in. */
async function sessionPayload(db: Db, userId: string) {
  const { rows } = await db.query<{
    id: string;
    email: string;
    name: string;
    kdf_salt: string;
    kdf_iterations: number;
    totp_enabled_at: Date | null;
    tenant_id: string;
    tenant_name: string;
    plan: 'free' | 'pro';
    role: Role;
    codes_left: number;
  }>(
    `SELECT u.id, u.email, u.name, u.kdf_salt, u.kdf_iterations, u.totp_enabled_at,
            t.id AS tenant_id, t.name AS tenant_name, t.plan, m.role,
            (SELECT count(*)::int FROM mfa_recovery_codes r WHERE r.user_id = u.id AND r.used_at IS NULL) AS codes_left
       FROM users u
       JOIN memberships m ON m.user_id = u.id
       JOIN tenants t ON t.id = m.tenant_id
      WHERE u.id = $1
      ORDER BY m.created_at ASC
      LIMIT 1`,
    [userId],
  );
  const r = rows[0];
  if (!r) throw unauthorized('This account is not attached to a workspace.');
  return {
    user: { id: r.id, email: r.email, name: r.name },
    tenant: { id: r.tenant_id, name: r.tenant_name, plan: r.plan },
    role: r.role,
    kdf: { salt: r.kdf_salt, iterations: r.kdf_iterations },
    twoFactor: { enabled: r.totp_enabled_at !== null, enabledAt: r.totp_enabled_at, recoveryCodesRemaining: r.codes_left },
  };
}

async function primaryTenant(db: Db, userId: string): Promise<string> {
  const { rows } = await db.query<{ tenant_id: string }>(
    'SELECT tenant_id FROM memberships WHERE user_id = $1 ORDER BY created_at ASC LIMIT 1',
    [userId],
  );
  if (!rows[0]) throw unauthorized('This account is not attached to a workspace.');
  return rows[0].tenant_id;
}

// ---------------------------------------------------------------------------
// Second factor
// ---------------------------------------------------------------------------

const totpAad = (userId: string) => `totp:${userId}`;

/**
 * Checks a TOTP code (with replay protection) or a single-use recovery code.
 * Mutates state on success: bumps totp_last_step or burns the recovery code.
 */
async function verifySecondFactor(
  db: Db,
  user: { id: string; totp_secret_enc: string | null; totp_last_step: number | null },
  input: { code?: string; recoveryCode?: string },
): Promise<'totp' | 'recovery' | null> {
  if (input.code && user.totp_secret_enc) {
    const secret = openString(user.totp_secret_enc, env.totpEncryptionKey, totpAad(user.id));
    const step = verifyTotp(secret, input.code, { lastUsedStep: user.totp_last_step });
    if (step === null) return null;
    // Conditional update closes the race where two requests use the same code at once.
    const { rowCount } = await db.query(
      'UPDATE users SET totp_last_step = $2 WHERE id = $1 AND (totp_last_step IS NULL OR totp_last_step < $2)',
      [user.id, step],
    );
    return rowCount ? 'totp' : null;
  }
  if (input.recoveryCode) {
    const { rowCount } = await db.query(
      'UPDATE mfa_recovery_codes SET used_at = now() WHERE user_id = $1 AND code_hash = $2 AND used_at IS NULL',
      [user.id, hashRecoveryCode(input.recoveryCode, env.lookupPepper)],
    );
    return rowCount ? 'recovery' : null;
  }
  return null;
}

async function replaceRecoveryCodes(db: Db, userId: string): Promise<string[]> {
  const codes = generateRecoveryCodes();
  await db.query('DELETE FROM mfa_recovery_codes WHERE user_id = $1', [userId]);
  for (const c of codes) {
    await db.query('INSERT INTO mfa_recovery_codes (user_id, code_hash) VALUES ($1, $2)', [userId, hashRecoveryCode(c, env.lookupPepper)]);
  }
  return codes;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const emailSchema = z.string().trim().toLowerCase().min(3).max(254).email('must be a valid email address');
/** 32-byte key derived in the browser from the password. Never the password itself. */
const authKeySchema = b64url(32, 32);
const totpCodeSchema = z.string().trim().regex(/^\d{3}\s?\d{3}$/, 'must be the 6-digit code from your authenticator app');
const recoveryCodeSchema = z.string().trim().min(12).max(20);

const factorSchema = {
  code: totpCodeSchema.optional(),
  recoveryCode: recoveryCodeSchema.optional(),
};
const requireOneFactor = (v: { code?: string; recoveryCode?: string }) => Boolean(v.code) !== Boolean(v.recoveryCode);

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

/**
 * KDF parameters for an email. Unknown emails get a deterministic fake salt, so
 * this endpoint cannot be used to discover which emails have accounts.
 */
authRouter.post(
  '/prelogin',
  rateLimit({ scope: 'auth:prelogin', windowSec: 300, max: 60 }),
  handler(async (req, res) => {
    const { email } = parseBody(req, strictObject({ email: emailSchema }));
    const row = await withSystem(async (db) => {
      const { rows } = await db.query<{ kdf_salt: string; kdf_iterations: number }>(
        'SELECT kdf_salt, kdf_iterations FROM users WHERE email = $1',
        [email],
      );
      return rows[0];
    });
    const fakeSalt = Buffer.from(hmacHex(env.lookupPepper, `kdf:${email}`), 'hex').subarray(0, 16).toString('base64url');
    ok(res, { kdfSalt: row?.kdf_salt ?? fakeSalt, kdfIterations: row?.kdf_iterations ?? DEFAULT_KDF_ITERATIONS });
  }),
);

authRouter.post(
  '/register',
  rateLimit({ scope: 'auth:register', windowSec: 3600, max: 10 }),
  handler(async (req, res) => {
    const body = parseBody(
      req,
      strictObject({
        email: emailSchema,
        name: z.string().trim().min(1).max(120),
        authKey: authKeySchema,
        kdfSalt: b64url(16, 32),
        kdfIterations: z.number().int().min(100_000).max(5_000_000),
      }),
    );
    const ctx = auditContext(req);
    const authHash = await hashSecret(body.authKey);

    const payload = await withSystem(async (db) => {
      const exists = await db.query('SELECT 1 FROM users WHERE email = $1', [body.email]);
      if (exists.rowCount) throw conflict('An account with this email already exists. Sign in instead.');
      const tenant = await db.query<{ id: string }>('INSERT INTO tenants (name) VALUES ($1) RETURNING id', [
        `${body.name.split(' ')[0]}'s workspace`.slice(0, 120),
      ]);
      const user = await db.query<{ id: string; token_version: number }>(
        `INSERT INTO users (email, name, auth_hash, kdf_salt, kdf_iterations)
         VALUES ($1, $2, $3, $4, $5) RETURNING id, token_version`,
        [body.email, body.name, authHash, body.kdfSalt, body.kdfIterations],
      );
      const userId = user.rows[0].id;
      const tenantId = tenant.rows[0].id;
      await db.query("INSERT INTO memberships (user_id, tenant_id, role) VALUES ($1, $2, 'owner')", [userId, tenantId]);
      await auditIn(db, { tenantId, actorUserId: userId, actorLabel: body.email, action: 'auth.register', ...ctx });
      await issueSession(db, res, { userId, tenantId, tokenVersion: user.rows[0].token_version, ...ctx });
      return sessionPayload(db, userId);
    });
    ok(res, payload, 201);
  }),
);

authRouter.post(
  '/login',
  rateLimit({ scope: 'auth:login:ip', windowSec: 300, max: 20 }),
  rateLimit({
    scope: 'auth:login:email',
    windowSec: 900,
    max: 10,
    key: (req) => String((req.body as { email?: string } | undefined)?.email ?? 'unknown').toLowerCase().slice(0, 254),
  }),
  handler(async (req, res) => {
    const body = parseBody(req, strictObject({ email: emailSchema, authKey: authKeySchema }));
    const ctx = auditContext(req);

    const outcome = await withSystem(async (db) => {
      const { rows } = await db.query<{
        id: string;
        email: string;
        auth_hash: string;
        token_version: number;
        failed_logins: number;
        locked_until: Date | null;
        totp_enabled_at: Date | null;
      }>(
        'SELECT id, email, auth_hash, token_version, failed_logins, locked_until, totp_enabled_at FROM users WHERE email = $1',
        [body.email],
      );
      const user = rows[0];
      if (!user) {
        await verifySecret(body.authKey, null);
        return { kind: 'invalid' as const };
      }
      if (user.locked_until && user.locked_until.getTime() > Date.now()) {
        return { kind: 'locked' as const, minutes: Math.ceil((user.locked_until.getTime() - Date.now()) / 60000) };
      }
      if (!(await verifySecret(body.authKey, user.auth_hash))) {
        const failed = user.failed_logins + 1;
        const lock = failed >= MAX_FAILED_LOGINS;
        await db.query(
          `UPDATE users SET failed_logins = $2,
                  locked_until = CASE WHEN $3 THEN now() + ($4 || ' minutes')::interval ELSE locked_until END
            WHERE id = $1`,
          [user.id, lock ? 0 : failed, lock, String(LOCKOUT_MINUTES)],
        );
        await auditIn(db, { tenantId: null, actorUserId: user.id, actorLabel: user.email, action: lock ? 'auth.login_locked' : 'auth.login_failed', ...ctx });
        return lock ? { kind: 'locked' as const, minutes: LOCKOUT_MINUTES } : { kind: 'invalid' as const };
      }

      await db.query('UPDATE users SET failed_logins = 0, locked_until = NULL WHERE id = $1', [user.id]);

      // Password was right. With 2FA on, hand back a short-lived challenge instead of a session.
      if (user.totp_enabled_at) {
        const challengeToken = randomToken(32);
        await db.query(
          `INSERT INTO mfa_challenges (user_id, token_hash, expires_at, ip)
           VALUES ($1, $2, now() + ($3 || ' seconds')::interval, $4)`,
          [user.id, sha256(challengeToken), String(env.mfaChallengeTtlSec), ctx.ip],
        );
        await auditIn(db, { tenantId: null, actorUserId: user.id, actorLabel: user.email, action: 'auth.mfa_challenged', ...ctx });
        return { kind: 'mfa' as const, challengeToken };
      }

      const tenantId = await primaryTenant(db, user.id);
      await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
      await auditIn(db, { tenantId, actorUserId: user.id, actorLabel: user.email, action: 'auth.login', ...ctx });
      await issueSession(db, res, { userId: user.id, tenantId, tokenVersion: user.token_version, ...ctx });
      return { kind: 'ok' as const, payload: await sessionPayload(db, user.id) };
    });

    if (outcome.kind === 'locked') throw unauthorized(`Too many failed attempts. This account is locked for ${outcome.minutes} minutes.`);
    if (outcome.kind === 'invalid') throw unauthorized('Email or password is incorrect.');
    if (outcome.kind === 'mfa') {
      ok(res, { mfaRequired: true, challengeToken: outcome.challengeToken, expiresInSec: env.mfaChallengeTtlSec });
      return;
    }
    ok(res, outcome.payload);
  }),
);

/** Second step of a 2FA login: a TOTP code or a recovery code against the challenge. */
authRouter.post(
  '/2fa/verify',
  rateLimit({ scope: 'auth:2fa:verify', windowSec: 300, max: 20 }),
  handler(async (req, res) => {
    const body = parseBody(req, strictObject({ challengeToken: z.string().min(20).max(100), ...factorSchema }));
    if (!requireOneFactor(body)) throw badRequest('Send either a 6-digit code or a recovery code.');
    const ctx = auditContext(req);

    const outcome = await withSystem(async (db) => {
      const { rows } = await db.query<{
        id: string;
        user_id: string;
        attempts: number;
        expired: boolean;
        consumed_at: Date | null;
      }>(
        `SELECT id, user_id, attempts, expires_at <= now() AS expired, consumed_at
           FROM mfa_challenges WHERE token_hash = $1 FOR UPDATE`,
        [sha256(body.challengeToken)],
      );
      const ch = rows[0];
      if (!ch || ch.consumed_at || ch.expired || ch.attempts >= MAX_MFA_ATTEMPTS) return { kind: 'dead' as const };

      const userRes = await db.query<{
        id: string;
        email: string;
        token_version: number;
        totp_secret_enc: string | null;
        totp_last_step: number | null;
      }>('SELECT id, email, token_version, totp_secret_enc, totp_last_step FROM users WHERE id = $1', [ch.user_id]);
      const user = userRes.rows[0];
      const method = await verifySecondFactor(db, user, body);

      if (!method) {
        const attempts = ch.attempts + 1;
        await db.query('UPDATE mfa_challenges SET attempts = $2 WHERE id = $1', [ch.id, attempts]);
        await auditIn(db, { tenantId: null, actorUserId: user.id, actorLabel: user.email, action: 'auth.mfa_failed', metadata: { attempts }, ...ctx });
        return { kind: 'wrong' as const, left: MAX_MFA_ATTEMPTS - attempts };
      }

      await db.query('UPDATE mfa_challenges SET consumed_at = now() WHERE id = $1', [ch.id]);
      const tenantId = await primaryTenant(db, user.id);
      await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
      await auditIn(db, {
        tenantId,
        actorUserId: user.id,
        actorLabel: user.email,
        action: method === 'recovery' ? 'auth.login_recovery_code' : 'auth.login',
        metadata: { mfa: method },
        ...ctx,
      });
      await issueSession(db, res, { userId: user.id, tenantId, tokenVersion: user.token_version, ...ctx });
      return { kind: 'ok' as const, payload: await sessionPayload(db, user.id) };
    });

    if (outcome.kind === 'dead') throw unauthorized('This sign-in attempt expired. Enter your email and password again.');
    if (outcome.kind === 'wrong') {
      throw unauthorized(
        outcome.left > 0
          ? `That code is not valid. ${outcome.left} attempt${outcome.left === 1 ? '' : 's'} left.`
          : 'Too many wrong codes. Enter your email and password again.',
      );
    }
    ok(res, outcome.payload);
  }),
);

/**
 * Rotating refresh. Presenting a token that was already rotated means it leaked:
 * the whole family is revoked and the user must sign in again (Securinity's model).
 */
authRouter.post(
  '/refresh',
  rateLimit({ scope: 'auth:refresh', windowSec: 300, max: 60 }),
  handler(async (req, res) => {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (typeof raw !== 'string' || raw.length < 20) {
      clearSessionCookies(res);
      throw unauthorized('Session expired. Please sign in again.');
    }
    const ctx = auditContext(req);
    const outcome = await withSystem(async (db) => {
      const { rows } = await db.query<{
        id: string;
        user_id: string;
        family_id: string;
        expired: boolean;
        rotated_at: Date | null;
        revoked_at: Date | null;
      }>(
        'SELECT id, user_id, family_id, expires_at <= now() AS expired, rotated_at, revoked_at FROM refresh_tokens WHERE token_hash = $1 FOR UPDATE',
        [sha256(raw)],
      );
      const token = rows[0];
      if (!token) return { kind: 'unknown' as const };
      if (token.revoked_at || token.rotated_at) {
        await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [token.family_id]);
        await auditIn(db, { tenantId: null, actorUserId: token.user_id, action: 'auth.refresh_reuse_detected', ...ctx });
        return { kind: 'reused' as const };
      }
      if (token.expired) return { kind: 'expired' as const };
      await db.query('UPDATE refresh_tokens SET rotated_at = now() WHERE id = $1', [token.id]);
      const user = await db.query<{ token_version: number }>('SELECT token_version FROM users WHERE id = $1', [token.user_id]);
      const tenantId = await primaryTenant(db, token.user_id);
      await issueSession(db, res, {
        userId: token.user_id,
        tenantId,
        tokenVersion: user.rows[0].token_version,
        familyId: token.family_id,
        ...ctx,
      });
      return { kind: 'ok' as const };
    });
    if (outcome.kind !== 'ok') {
      clearSessionCookies(res);
      throw unauthorized('Session expired. Please sign in again.');
    }
    ok(res, { refreshed: true });
  }),
);

authRouter.post(
  '/logout',
  handler(async (req, res) => {
    const raw = req.cookies?.[REFRESH_COOKIE];
    if (typeof raw === 'string' && raw.length >= 20) {
      await withSystem(async (db) => {
        const { rows } = await db.query<{ family_id: string }>('SELECT family_id FROM refresh_tokens WHERE token_hash = $1', [sha256(raw)]);
        if (rows[0]) {
          await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE family_id = $1 AND revoked_at IS NULL', [rows[0].family_id]);
        }
      });
    }
    clearSessionCookies(res);
    ok(res, { signedOut: true });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  handler(async (req, res) => {
    ok(res, await withSystem((db) => sessionPayload(db, req.auth!.userId)));
  }),
);

/**
 * Confirms the password (as authKey) for an already signed-in user. The dashboard
 * calls it to unlock the vault after a page reload, before deriving the vault key.
 */
authRouter.post(
  '/reauth',
  requireAuth,
  rateLimit({ scope: 'auth:reauth', windowSec: 900, max: 10, key: (req) => req.auth!.userId }),
  handler(async (req, res) => {
    const { authKey } = parseBody(req, strictObject({ authKey: authKeySchema }));
    const valid = await withSystem(async (db) => {
      const { rows } = await db.query<{ auth_hash: string }>('SELECT auth_hash FROM users WHERE id = $1', [req.auth!.userId]);
      return verifySecret(authKey, rows[0]?.auth_hash ?? null);
    });
    if (!valid) throw unauthorized('Password is incorrect.');
    ok(res, { verified: true });
  }),
);

// ---------------------------------------------------------------------------
// 2FA management
// ---------------------------------------------------------------------------

async function requireAuthKey(db: Db, userId: string, authKey: string): Promise<void> {
  const { rows } = await db.query<{ auth_hash: string }>('SELECT auth_hash FROM users WHERE id = $1', [userId]);
  if (!(await verifySecret(authKey, rows[0]?.auth_hash ?? null))) throw unauthorized('Password is incorrect.');
}

/** Step 1: create a pending secret. Requires the password so a hijacked session cannot enrol its own device. */
authRouter.post(
  '/2fa/setup',
  requireAuth,
  rateLimit({ scope: 'auth:2fa:setup', windowSec: 900, max: 10, key: (req) => req.auth!.userId }),
  handler(async (req, res) => {
    const { authKey } = parseBody(req, strictObject({ authKey: authKeySchema }));
    const { userId, email } = req.auth!;
    const secret = generateTotpSecret();
    await withSystem(async (db) => {
      await requireAuthKey(db, userId, authKey);
      const { rows } = await db.query<{ totp_enabled_at: Date | null }>('SELECT totp_enabled_at FROM users WHERE id = $1', [userId]);
      if (rows[0]?.totp_enabled_at) throw conflict('Two-factor authentication is already on. Turn it off first to change devices.');
      await db.query(
        `UPDATE users SET totp_pending_enc = $2, totp_pending_expires_at = now() + ($3 || ' minutes')::interval WHERE id = $1`,
        [userId, sealString(secret, env.totpEncryptionKey, totpAad(userId)), String(TOTP_SETUP_TTL_MIN)],
      );
    });
    ok(res, { secret, otpauthUri: otpauthUri(secret, email), expiresInSec: TOTP_SETUP_TTL_MIN * 60 });
  }),
);

/** Step 2: prove the app is set up by sending a current code. Returns recovery codes once. */
authRouter.post(
  '/2fa/enable',
  requireAuth,
  rateLimit({ scope: 'auth:2fa:enable', windowSec: 300, max: 10, key: (req) => req.auth!.userId }),
  handler(async (req, res) => {
    const { code } = parseBody(req, strictObject({ code: totpCodeSchema }));
    const { userId, email, tenantId } = req.auth!;
    const ctx = auditContext(req);
    const result = await withSystem(async (db) => {
      const { rows } = await db.query<{ totp_pending_enc: string | null; pending_valid: boolean; totp_enabled_at: Date | null }>(
        `SELECT totp_pending_enc, totp_pending_expires_at > now() AS pending_valid, totp_enabled_at FROM users WHERE id = $1 FOR UPDATE`,
        [userId],
      );
      const u = rows[0];
      if (u.totp_enabled_at) throw conflict('Two-factor authentication is already on.');
      if (!u.totp_pending_enc || !u.pending_valid) throw badRequest('Setup expired. Start again to get a new QR code.');
      const secret = openString(u.totp_pending_enc, env.totpEncryptionKey, totpAad(userId));
      const step = verifyTotp(secret, code);
      if (step === null) throw badRequest('That code does not match. Check the time on your phone and try the newest code.');

      // token_version bump signs out every other session; this one is re-issued below.
      const updated = await db.query<{ token_version: number }>(
        `UPDATE users SET totp_secret_enc = totp_pending_enc, totp_enabled_at = now(), totp_last_step = $2,
                          totp_pending_enc = NULL, totp_pending_expires_at = NULL, token_version = token_version + 1
          WHERE id = $1 RETURNING token_version`,
        [userId, step],
      );
      await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
      const codes = await replaceRecoveryCodes(db, userId);
      await auditIn(db, { tenantId, actorUserId: userId, actorLabel: email, action: 'auth.2fa_enabled', ...ctx });
      await issueSession(db, res, { userId, tenantId, tokenVersion: updated.rows[0].token_version, ...ctx });
      return { recoveryCodes: codes, session: await sessionPayload(db, userId) };
    });
    ok(res, result);
  }),
);

authRouter.post(
  '/2fa/disable',
  requireAuth,
  rateLimit({ scope: 'auth:2fa:disable', windowSec: 900, max: 10, key: (req) => req.auth!.userId }),
  handler(async (req, res) => {
    const body = parseBody(req, strictObject({ authKey: authKeySchema, ...factorSchema }));
    if (!requireOneFactor(body)) throw badRequest('Send either a 6-digit code or a recovery code.');
    const { userId, email, tenantId } = req.auth!;
    const ctx = auditContext(req);
    const payload = await withSystem(async (db) => {
      await requireAuthKey(db, userId, body.authKey);
      const { rows } = await db.query<{ id: string; totp_secret_enc: string | null; totp_last_step: number | null }>(
        'SELECT id, totp_secret_enc, totp_last_step FROM users WHERE id = $1 FOR UPDATE',
        [userId],
      );
      if (!rows[0].totp_secret_enc) throw conflict('Two-factor authentication is already off.');
      if (!(await verifySecondFactor(db, rows[0], body))) throw unauthorized('That code is not valid.');
      const updated = await db.query<{ token_version: number }>(
        `UPDATE users SET totp_secret_enc = NULL, totp_enabled_at = NULL, totp_last_step = NULL, token_version = token_version + 1
          WHERE id = $1 RETURNING token_version`,
        [userId],
      );
      await db.query('DELETE FROM mfa_recovery_codes WHERE user_id = $1', [userId]);
      await db.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [userId]);
      await auditIn(db, { tenantId, actorUserId: userId, actorLabel: email, action: 'auth.2fa_disabled', ...ctx });
      await issueSession(db, res, { userId, tenantId, tokenVersion: updated.rows[0].token_version, ...ctx });
      return sessionPayload(db, userId);
    });
    ok(res, payload);
  }),
);

authRouter.post(
  '/2fa/recovery-codes',
  requireAuth,
  rateLimit({ scope: 'auth:2fa:codes', windowSec: 900, max: 5, key: (req) => req.auth!.userId }),
  handler(async (req, res) => {
    const { code } = parseBody(req, strictObject({ code: totpCodeSchema }));
    const { userId, email, tenantId } = req.auth!;
    const ctx = auditContext(req);
    const codes = await withSystem(async (db) => {
      const { rows } = await db.query<{ id: string; totp_secret_enc: string | null; totp_last_step: number | null }>(
        'SELECT id, totp_secret_enc, totp_last_step FROM users WHERE id = $1 FOR UPDATE',
        [userId],
      );
      if (!rows[0].totp_secret_enc) throw conflict('Turn on two-factor authentication first.');
      if (!(await verifySecondFactor(db, rows[0], { code }))) throw unauthorized('That code is not valid.');
      const fresh = await replaceRecoveryCodes(db, userId);
      await auditIn(db, { tenantId, actorUserId: userId, actorLabel: email, action: 'auth.2fa_recovery_codes_regenerated', ...ctx });
      return fresh;
    });
    ok(res, { recoveryCodes: codes });
  }),
);
