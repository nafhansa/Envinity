import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
  scrypt as scryptCb,
  timingSafeEqual,
} from 'node:crypto';
import { promisify } from 'node:util';

const scrypt = promisify(scryptCb) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number },
) => Promise<Buffer>;

// OWASP-aligned scrypt parameters (N=2^16, r=8, p=1), same as Securinity.
const N = 1 << 16;
const R = 8;
const P = 1;
const KEYLEN = 32;
const MAXMEM = 160 * 1024 * 1024;

/**
 * Envinity never receives the user's password. The browser derives an `authKey`
 * from it (PBKDF2, see apps/web/src/dashboard/crypto.js) and that is what we hash
 * here. A second key derived from the same password (the vault key) never leaves
 * the browser, so the server cannot decrypt anyone's tickets.
 */
export async function hashSecret(value: string): Promise<string> {
  const salt = randomBytes(16);
  const derived = await scrypt(value.normalize('NFKC'), salt, KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
  return ['scrypt', N, R, P, salt.toString('base64'), derived.toString('base64')].join('$');
}

export async function verifySecret(value: string, stored: string | null): Promise<boolean> {
  // Burn comparable CPU so a missing account is not distinguishable by timing.
  if (!stored) {
    await scrypt('dummy', randomBytes(16), KEYLEN, { N, r: R, p: P, maxmem: MAXMEM });
    return false;
  }
  const parts = stored.split('$');
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false;
  const [n, r, p] = [Number(parts[1]), Number(parts[2]), Number(parts[3])];
  if (![n, r, p].every(Number.isInteger)) return false;
  const salt = Buffer.from(parts[4], 'base64');
  const expected = Buffer.from(parts[5], 'base64');
  try {
    const derived = await scrypt(value.normalize('NFKC'), salt, expected.length, { N: n, r, p, maxmem: MAXMEM });
    return derived.length === expected.length && timingSafeEqual(derived, expected);
  } catch {
    return false;
  }
}

/** URL-safe random token. 32 bytes is about 256 bits of entropy. */
export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString('base64url');
}

export function sha256(value: string): string {
  return createHash('sha256').update(value).digest('hex');
}

export function hmacHex(secret: string, payload: string): string {
  return createHmac('sha256', secret).update(payload).digest('hex');
}

export function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) {
    timingSafeEqual(bufA, bufA);
    return false;
  }
  return timingSafeEqual(bufA, bufB);
}

// ---------------------------------------------------------------------------
// AES-256-GCM for server-side secrets at rest (TOTP seeds). Format: v1.iv.tag.ct
// ---------------------------------------------------------------------------

function keyFrom(material: string): Buffer {
  const raw = Buffer.from(material, 'base64');
  if (raw.length === 32) return raw;
  // Accept any long secret string by hashing it down to 32 bytes.
  return createHash('sha256').update(material).digest();
}

export function sealString(plaintext: string, keyMaterial: string, aad = ''): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', keyFrom(keyMaterial), iv);
  cipher.setAAD(Buffer.from(aad));
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return ['v1', iv.toString('base64url'), cipher.getAuthTag().toString('base64url'), ct.toString('base64url')].join('.');
}

export function openString(sealed: string, keyMaterial: string, aad = ''): string {
  const [v, iv, tag, ct] = sealed.split('.');
  if (v !== 'v1' || !iv || !tag || !ct) throw new Error('sealed value is malformed');
  const decipher = createDecipheriv('aes-256-gcm', keyFrom(keyMaterial), Buffer.from(iv, 'base64url'));
  decipher.setAAD(Buffer.from(aad));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ct, 'base64url')), decipher.final()]).toString('utf8');
}

// ---------------------------------------------------------------------------
// Compact HS256 JWT (hand-rolled like Securinity's: small and auditable).
// ---------------------------------------------------------------------------

export interface JwtClaims {
  sub: string;
  tid: string;
  ver: number;
  iat: number;
  exp: number;
  jti: string;
}

const b64u = (input: Buffer | string) => Buffer.from(input).toString('base64url');

export function signJwt(claims: Omit<JwtClaims, 'iat' | 'exp' | 'jti'>, secret: string, ttlSec: number): string {
  const now = Math.floor(Date.now() / 1000);
  const payload: JwtClaims = { ...claims, iat: now, exp: now + ttlSec, jti: randomBytes(9).toString('base64url') };
  const header = b64u(JSON.stringify({ alg: 'HS256', typ: 'JWT' }));
  const body = b64u(JSON.stringify(payload));
  const signature = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  return `${header}.${body}.${signature}`;
}

export type JwtResult = { ok: true; claims: JwtClaims } | { ok: false; reason: 'malformed' | 'signature' | 'expired' };

export function verifyJwt(token: string, secret: string): JwtResult {
  const parts = token.split('.');
  if (parts.length !== 3) return { ok: false, reason: 'malformed' };
  const [header, body, signature] = parts;
  let head: { alg?: string };
  try {
    head = JSON.parse(Buffer.from(header, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  // Reject `alg: none` and algorithm confusion outright.
  if (head.alg !== 'HS256') return { ok: false, reason: 'signature' };
  const expected = createHmac('sha256', secret).update(`${header}.${body}`).digest('base64url');
  if (!safeEqual(signature, expected)) return { ok: false, reason: 'signature' };
  let claims: JwtClaims;
  try {
    claims = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (typeof claims.exp !== 'number' || claims.exp * 1000 <= Date.now()) return { ok: false, reason: 'expired' };
  if (!claims.sub || !claims.tid) return { ok: false, reason: 'malformed' };
  return { ok: true, claims };
}
