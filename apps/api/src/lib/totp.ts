import { createHmac, randomBytes, randomInt } from 'node:crypto';
import { safeEqual, sha256 } from './crypto.ts';

/**
 * TOTP (RFC 6238) on top of HOTP (RFC 4226): HMAC-SHA1, 6 digits, 30 second steps.
 * These are the defaults every authenticator app (Google Authenticator, Authy,
 * 1Password, Microsoft Authenticator) understands without extra parameters.
 * Hand-rolled on purpose, like Securinity's JWT: about 60 lines and testable
 * against the RFC vectors in totp.test.ts.
 */

export const TOTP_DIGITS = 6;
export const TOTP_PERIOD_SEC = 30;
/** Accept one step either side to absorb phone clock drift. */
export const TOTP_WINDOW = 1;

const B32 = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';

export function base32Encode(buf: Buffer): string {
  let bits = 0;
  let value = 0;
  let out = '';
  for (const byte of buf) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += B32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += B32[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(input: string): Buffer {
  const clean = input.toUpperCase().replace(/=+$/, '').replace(/\s+/g, '');
  let bits = 0;
  let value = 0;
  const out: number[] = [];
  for (const ch of clean) {
    const idx = B32.indexOf(ch);
    if (idx === -1) throw new Error('invalid base32 character');
    value = (value << 5) | idx;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

/** 160-bit secret, the size RFC 4226 recommends for HMAC-SHA1. */
export function generateTotpSecret(): string {
  return base32Encode(randomBytes(20));
}

export function hotp(secret: Buffer, counter: number, digits = TOTP_DIGITS): string {
  const msg = Buffer.alloc(8);
  msg.writeBigUInt64BE(BigInt(counter));
  const mac = createHmac('sha1', secret).update(msg).digest();
  const offset = mac[mac.length - 1] & 0x0f;
  const binary =
    ((mac[offset] & 0x7f) << 24) | ((mac[offset + 1] & 0xff) << 16) | ((mac[offset + 2] & 0xff) << 8) | (mac[offset + 3] & 0xff);
  return String(binary % 10 ** digits).padStart(digits, '0');
}

export function timeStep(nowMs = Date.now()): number {
  return Math.floor(nowMs / 1000 / TOTP_PERIOD_SEC);
}

/**
 * Verifies a code and returns the matched time step, or null.
 * `lastUsedStep` blocks replay: a code (or any older one) can be used only once.
 */
export function verifyTotp(
  secretB32: string,
  code: string,
  opts: { nowMs?: number; lastUsedStep?: number | null } = {},
): number | null {
  const normalized = code.replace(/\s+/g, '');
  if (!/^\d{6}$/.test(normalized)) return null;
  const secret = base32Decode(secretB32);
  const current = timeStep(opts.nowMs);
  let matched: number | null = null;
  // Check every candidate (no early exit) so timing doesn't reveal which step matched.
  for (let step = current - TOTP_WINDOW; step <= current + TOTP_WINDOW; step++) {
    if (safeEqual(hotp(secret, step), normalized) && matched === null) matched = step;
  }
  if (matched === null) return null;
  if (opts.lastUsedStep != null && matched <= opts.lastUsedStep) return null;
  return matched;
}

export function otpauthUri(secretB32: string, accountEmail: string, issuer = 'Envinity'): string {
  const label = encodeURIComponent(`${issuer}:${accountEmail}`);
  const params = new URLSearchParams({
    secret: secretB32,
    issuer,
    algorithm: 'SHA1',
    digits: String(TOTP_DIGITS),
    period: String(TOTP_PERIOD_SEC),
  });
  return `otpauth://totp/${label}?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Recovery codes: 10 single-use codes like "K7QF-2M9P-XC4D", stored hashed.
// ---------------------------------------------------------------------------

const RC_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
export const RECOVERY_CODE_COUNT = 10;

export function generateRecoveryCodes(count = RECOVERY_CODE_COUNT): string[] {
  return Array.from({ length: count }, () => {
    const chars = Array.from({ length: 12 }, () => RC_ALPHABET[randomInt(RC_ALPHABET.length)]).join('');
    return `${chars.slice(0, 4)}-${chars.slice(4, 8)}-${chars.slice(8)}`;
  });
}

export function normalizeRecoveryCode(input: string): string {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '');
  return raw.length === 12 ? `${raw.slice(0, 4)}-${raw.slice(4, 8)}-${raw.slice(8)}` : raw;
}

/** Recovery codes carry ~59 bits of entropy, so a fast hash is enough (no scrypt needed). */
export function hashRecoveryCode(code: string, pepper: string): string {
  return sha256(`${pepper}:${normalizeRecoveryCode(code)}`);
}
