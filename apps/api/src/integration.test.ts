/**
 * End-to-end API test against the real Postgres (docker compose up -d && npm run migrate).
 * Uses the dashboard's own crypto module, so encryption is exercised exactly as the browser does it.
 */
import { after, before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import type { Server } from 'node:http';
import type { webcrypto } from 'node:crypto';
import { app } from './server.ts';
import { closePool, withSystem } from './db/pool.ts';
import { destroyExpiredTickets } from './workers/expiry.ts';
import { base32Decode, hotp, timeStep } from './lib/totp.ts';
// @ts-expect-error plain JS module shared with the web app
import * as C from '../../web/src/dashboard/crypto.js';

let server: Server;
let base = '';
const runId = Date.now().toString(36);

/** Minimal cookie-jar client that behaves like the dashboard's api.js. */
class Client {
  jar = new Map<string, string>();
  async req(method: string, path: string, body?: unknown) {
    const headers: Record<string, string> = { Accept: 'application/json' };
    if (method !== 'GET') {
      headers['Content-Type'] = 'application/json';
      const csrf = this.jar.get('ev_csrf');
      if (csrf) headers['X-CSRF-Token'] = csrf;
    }
    if (this.jar.size) headers.Cookie = [...this.jar].map(([k, v]) => `${k}=${v}`).join('; ');
    const res = await fetch(base + path, { method, headers, body: method === 'GET' ? undefined : JSON.stringify(body ?? {}) });
    for (const c of res.headers.getSetCookie()) {
      const [pair] = c.split(';');
      const [k, ...v] = pair.split('=');
      const val = v.join('=');
      if (!val || /Expires=Thu, 01 Jan 1970/.test(c)) this.jar.delete(k);
      else this.jar.set(k, val);
    }
    const json = (await res.json().catch(() => ({}))) as { data?: any; error?: any };
    return { status: res.status, data: json.data, error: json.error };
  }
}

async function register(c: Client, email: string, name: string, password: string) {
  const salt = C.newKdfSalt();
  const keys = await C.deriveAccountKeys(password, salt);
  const r = await c.req('POST', '/api/auth/register', { email, name, authKey: keys.authKey, kdfSalt: salt, kdfIterations: C.ACCOUNT_KDF_ITERATIONS });
  assert.equal(r.status, 201, JSON.stringify(r.error));
  return keys;
}

async function loginKeys(c: Client, email: string, password: string) {
  const pre = await c.req('POST', '/api/auth/prelogin', { email });
  return C.deriveAccountKeys(password, pre.data.kdfSalt, pre.data.kdfIterations);
}

const VARS = [
  { key: 'DATABASE_URL', value: 'postgres://app:example@db:5432/app' },
  { key: 'STRIPE_SECRET_KEY', value: 'sk_test_123' },
];

const owner = new Client();
const mate = new Client();
const ownerEmail = `rina+${runId}@acme.test`;
const mateEmail = `dimas+${runId}@acme.test`;
const PW = 'correct horse battery staple';
let ownerVault: webcrypto.CryptoKey;

before(async () => {
  // Rate limits are shared in Postgres; start each run from a clean slate so reruns are repeatable.
  await withSystem((db) => db.query('DELETE FROM rate_limits'));
  server = app.listen(0, '127.0.0.1');
  await new Promise((r) => server.once('listening', r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  ownerVault = (await register(owner, ownerEmail, 'Rina Putri', PW)).vaultKey;
  await register(mate, mateEmail, 'Dimas Pratama', 'another long passphrase here');
});

after(async () => {
  await withSystem((db) => db.query('DELETE FROM tenants WHERE id IN (SELECT tenant_id FROM memberships m JOIN users u ON u.id = m.user_id WHERE u.email LIKE $1)', [`%+${runId}@acme.test`]));
  await withSystem((db) => db.query('DELETE FROM users WHERE email LIKE $1', [`%+${runId}@acme.test`]));
  server.close();
  await closePool();
});

describe('accounts', () => {
  test('the server never stores the password, only scrypt(authKey)', async () => {
    const row = await withSystem(async (db) => (await db.query('SELECT auth_hash FROM users WHERE email = $1', [ownerEmail])).rows[0]);
    assert.match(row.auth_hash, /^scrypt\$/);
    assert.ok(!row.auth_hash.includes(PW));
  });

  test('prelogin does not reveal whether an email exists', async () => {
    const a = await new Client().req('POST', '/api/auth/prelogin', { email: `ghost+${runId}@acme.test` });
    const b = await new Client().req('POST', '/api/auth/prelogin', { email: `ghost+${runId}@acme.test` });
    assert.equal(a.status, 200);
    assert.equal(a.data.kdfSalt, b.data.kdfSalt, 'fake salt is stable, like a real one');
  });

  test('wrong password is rejected with a generic message', async () => {
    const c = new Client();
    const keys = await loginKeys(c, ownerEmail, 'wrong password!!');
    const r = await c.req('POST', '/api/auth/login', { email: ownerEmail, authKey: keys.authKey });
    assert.equal(r.status, 401);
    assert.equal(r.error.message, 'Email or password is incorrect.');
  });

  test('mutations without the CSRF header are refused', async () => {
    const r = await fetch(`${base}/api/workspace/plan`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json', Cookie: `ev_at=${owner.jar.get('ev_at')}` },
      body: JSON.stringify({ plan: 'pro' }),
    });
    assert.equal(r.status, 403);
  });
});

describe('tickets', () => {
  let ticketId = '';
  let code = '';

  test('free plan cannot keep tickets forever', async () => {
    const sealed = await C.sealTicket({ vars: VARS, vaultKey: ownerVault, name: 'api', environment: 'staging', oneTime: false, keepForever: true });
    const r = await owner.req('POST', '/api/tickets', sealed.body);
    assert.equal(r.status, 402);
  });

  test('create: the server stores only ciphertext and wrapped keys', async () => {
    const sealed = await C.sealTicket({ vars: VARS, vaultKey: ownerVault, name: 'acme-api', environment: 'staging', oneTime: false, keepForever: false });
    const r = await owner.req('POST', '/api/tickets', sealed.body);
    assert.equal(r.status, 201, JSON.stringify(r.error));
    assert.ok(r.data.expiresAt, 'free tickets get an expiry');
    ticketId = r.data.id;
    code = sealed.code;
    const row = await withSystem(async (db) => (await db.query('SELECT * FROM tickets WHERE id = $1', [ticketId])).rows[0]);
    const dump = JSON.stringify(row);
    assert.ok(!dump.includes('sk_test_123') && !dump.includes('DATABASE_URL'), 'no plaintext at rest');
    assert.ok(!dump.includes(code) && !dump.includes(code.replace('-', '')), 'no share code at rest');
  });

  test('owner can decrypt with the vault key; list shows it as active', async () => {
    const list = await owner.req('GET', '/api/tickets');
    assert.equal(list.data.tickets.find((t: any) => t.id === ticketId).status, 'active');
    const d = await owner.req('GET', `/api/tickets/${ticketId}`);
    const opened = await C.openAsOwner(d.data.ticket, ownerVault);
    assert.deepEqual(opened.vars, VARS);
    assert.equal(opened.code, code, 'owner can see the share code again');
  });

  test('another workspace cannot read the ticket (RLS)', async () => {
    const r = await mate.req('GET', `/api/tickets/${ticketId}`);
    assert.equal(r.status, 404);
  });

  test('teammate opens with the share code and decrypts locally', async () => {
    const r = await mate.req('POST', '/api/open/code', { lookup: await C.codeLookup(code.toLowerCase()) });
    assert.equal(r.status, 200, JSON.stringify(r.error));
    assert.equal(r.data.ticket.from, 'Rina Putri');
    assert.deepEqual(await C.openWithCode(code, r.data), VARS);
    const d = await owner.req('GET', `/api/tickets/${ticketId}`);
    assert.equal(d.data.ticket.opens[0].who, 'Dimas Pratama');
    assert.equal(d.data.ticket.opens[0].via, 'code');
  });

  test('a wrong code finds nothing', async () => {
    const r = await mate.req('POST', '/api/open/code', { lookup: await C.codeLookup('AAAA-BBBB') });
    assert.equal(r.status, 404);
  });

  test('QR path: ticket id + key from the fragment', async () => {
    const d = await owner.req('GET', `/api/tickets/${ticketId}`);
    const { ticketKey } = await C.openAsOwner(d.data.ticket, ownerVault);
    const r = await mate.req('POST', `/api/open/qr/${ticketId}`);
    assert.deepEqual(await C.openWithKey(ticketKey, r.data), VARS);
  });

  test('one-time tickets open exactly once', async () => {
    const sealed = await C.sealTicket({ vars: VARS, vaultKey: ownerVault, name: 'once', environment: 'development', oneTime: true, keepForever: false });
    await owner.req('POST', '/api/tickets', sealed.body);
    const lookup = await C.codeLookup(sealed.code);
    const [a, b] = await Promise.all([mate.req('POST', '/api/open/code', { lookup }), owner.req('POST', '/api/open/code', { lookup })]);
    assert.deepEqual([a.status, b.status].sort(), [200, 410]);
  });

  test('revoke stops the code immediately', async () => {
    const r = await owner.req('POST', `/api/tickets/${ticketId}/revoke`);
    assert.equal(r.status, 200);
    const again = await mate.req('POST', '/api/open/code', { lookup: await C.codeLookup(code) });
    assert.equal(again.status, 410);
    assert.match(again.error.message, /revoked/);
  });

  test('expiry destroys ciphertext and keys', async () => {
    const sealed = await C.sealTicket({ vars: VARS, vaultKey: ownerVault, name: 'short', environment: 'preview', oneTime: false, keepForever: false });
    const created = await owner.req('POST', '/api/tickets', sealed.body);
    await withSystem((db) => db.query("UPDATE tickets SET expires_at = now() - interval '1 second' WHERE id = $1", [created.data.id]));
    const before = await owner.req('GET', `/api/tickets/${created.data.id}`);
    assert.equal(before.data.ticket.status, 'expired');
    assert.equal(before.data.ticket.ciphertext, null, 'never served after expiry, even before the sweep');
    assert.ok((await destroyExpiredTickets()) >= 1);
    const row = await withSystem(async (db) => (await db.query('SELECT ciphertext, owner_wrapped_key, code_wrapped_key, destroyed_at FROM tickets WHERE id = $1', [created.data.id])).rows[0]);
    assert.equal(row.ciphertext, null);
    assert.equal(row.owner_wrapped_key, null);
    assert.equal(row.code_wrapped_key, null);
    assert.ok(row.destroyed_at);
    const open = await mate.req('POST', '/api/open/code', { lookup: await C.codeLookup(sealed.code) });
    assert.equal(open.status, 410);
  });

  test('pro keeps tickets; downgrading puts them back on a 10 minute timer', async () => {
    assert.equal((await owner.req('PATCH', '/api/workspace/plan', { plan: 'pro' })).status, 200);
    const sealed = await C.sealTicket({ vars: VARS, vaultKey: ownerVault, name: 'kept', environment: 'production', oneTime: false, keepForever: true });
    const created = await owner.req('POST', '/api/tickets', sealed.body);
    assert.equal(created.data.expiresAt, null);
    const down = await owner.req('PATCH', '/api/workspace/plan', { plan: 'free' });
    assert.ok(down.data.affected >= 1);
    const d = await owner.req('GET', `/api/tickets/${created.data.id}`);
    assert.ok(d.data.ticket.expiresAt);
  });
});

describe('two-factor authentication', () => {
  let secret = '';
  let recoveryCodes: string[] = [];
  let lastStep = 0;
  // Each successful TOTP use must move forward in time (replay protection), so tests simulate future steps.
  const codeAt = (step: number) => hotp(base32Decode(secret), step);

  test('setup requires the password', async () => {
    const r = await owner.req('POST', '/api/auth/2fa/setup', { authKey: (await C.deriveAccountKeys('nope nope nope', C.newKdfSalt())).authKey });
    assert.equal(r.status, 401);
  });

  test('enable with a valid code returns 10 recovery codes', async () => {
    const keys = await loginKeys(owner, ownerEmail, PW);
    const setup = await owner.req('POST', '/api/auth/2fa/setup', { authKey: keys.authKey });
    assert.equal(setup.status, 200);
    assert.match(setup.data.otpauthUri, /^otpauth:\/\/totp\/Envinity/);
    secret = setup.data.secret;
    assert.equal((await owner.req('POST', '/api/auth/2fa/enable', { code: '000000' })).status, 400);
    lastStep = timeStep();
    const r = await owner.req('POST', '/api/auth/2fa/enable', { code: codeAt(lastStep) });
    assert.equal(r.status, 200, JSON.stringify(r.error));
    recoveryCodes = r.data.recoveryCodes;
    assert.equal(recoveryCodes.length, 10);
    assert.equal(r.data.session.twoFactor.enabled, true);
    // The session that enabled 2FA stays signed in (cookies were re-issued).
    assert.equal((await owner.req('GET', '/api/auth/me')).status, 200);
  });

  test('the TOTP secret is encrypted at rest', async () => {
    const row = await withSystem(async (db) => (await db.query('SELECT totp_secret_enc FROM users WHERE email = $1', [ownerEmail])).rows[0]);
    assert.match(row.totp_secret_enc, /^v1\./);
    assert.ok(!row.totp_secret_enc.includes(secret));
  });

  test('login now stops at a challenge and only a valid code completes it', async () => {
    const c = new Client();
    const keys = await loginKeys(c, ownerEmail, PW);
    const r = await c.req('POST', '/api/auth/login', { email: ownerEmail, authKey: keys.authKey });
    assert.equal(r.data.mfaRequired, true);
    assert.ok(!c.jar.has('ev_at'), 'no session before the second factor');
    const bad = await c.req('POST', '/api/auth/2fa/verify', { challengeToken: r.data.challengeToken, code: '123456' });
    assert.equal(bad.status, 401);
    assert.match(bad.error.message, /4 attempts left/);
    // A code from the step already used to enable 2FA is refused (replay protection).
    const replay = await c.req('POST', '/api/auth/2fa/verify', { challengeToken: r.data.challengeToken, code: codeAt(lastStep) });
    assert.equal(replay.status, 401);
    const good = await c.req('POST', '/api/auth/2fa/verify', { challengeToken: r.data.challengeToken, code: codeAt(lastStep + 1) });
    assert.equal(good.status, 200, JSON.stringify(good.error));
    lastStep += 1;
    assert.ok(c.jar.has('ev_at'));
    const reuse = await c.req('POST', '/api/auth/2fa/verify', { challengeToken: r.data.challengeToken, code: codeAt(lastStep) });
    assert.equal(reuse.status, 401, 'a challenge cannot be used twice');
  });

  test('five wrong codes kill the challenge', async () => {
    const c = new Client();
    const keys = await loginKeys(c, ownerEmail, PW);
    const r = await c.req('POST', '/api/auth/login', { email: ownerEmail, authKey: keys.authKey });
    for (let i = 0; i < 5; i++) await c.req('POST', '/api/auth/2fa/verify', { challengeToken: r.data.challengeToken, code: '000000' });
    const after = await c.req('POST', '/api/auth/2fa/verify', { challengeToken: r.data.challengeToken, code: codeAt(lastStep + 1) });
    assert.equal(after.status, 401);
    assert.match(after.error.message, /expired/);
  });

  test('a recovery code works exactly once', async () => {
    const attempt = async () => {
      const c = new Client();
      const keys = await loginKeys(c, ownerEmail, PW);
      const r = await c.req('POST', '/api/auth/login', { email: ownerEmail, authKey: keys.authKey });
      return c.req('POST', '/api/auth/2fa/verify', { challengeToken: r.data.challengeToken, recoveryCode: recoveryCodes[0].toLowerCase() });
    };
    assert.equal((await attempt()).status, 200);
    assert.equal((await attempt()).status, 401);
    const me = await owner.req('GET', '/api/auth/me');
    assert.equal(me.data.twoFactor.recoveryCodesRemaining, 9);
  });

  test('disable needs the password and a second factor', async () => {
    const keys = await loginKeys(owner, ownerEmail, PW);
    const noCode = await owner.req('POST', '/api/auth/2fa/disable', { authKey: keys.authKey, code: '000000' });
    assert.equal(noCode.status, 401);
    const r = await owner.req('POST', '/api/auth/2fa/disable', { authKey: keys.authKey, recoveryCode: recoveryCodes[1] });
    assert.equal(r.status, 200, JSON.stringify(r.error));
    assert.equal(r.data.twoFactor.enabled, false);
  });
});

describe('sessions', () => {
  test('refresh rotates; reusing an old refresh token revokes the family', async () => {
    const c = new Client();
    const keys = await loginKeys(c, mateEmail, 'another long passphrase here');
    await c.req('POST', '/api/auth/login', { email: mateEmail, authKey: keys.authKey });
    const stolen = c.jar.get('ev_rt')!;
    assert.equal((await c.req('POST', '/api/auth/refresh')).status, 200);
    const thief = new Client();
    thief.jar.set('ev_rt', stolen);
    thief.jar.set('ev_csrf', c.jar.get('ev_csrf')!);
    assert.equal((await thief.req('POST', '/api/auth/refresh')).status, 401);
    // The legitimate client's current token belonged to the same family, so it is dead too.
    assert.equal((await c.req('POST', '/api/auth/refresh')).status, 401);
  });
});
