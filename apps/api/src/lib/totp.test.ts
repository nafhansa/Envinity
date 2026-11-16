import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  base32Decode,
  base32Encode,
  generateRecoveryCodes,
  generateTotpSecret,
  hotp,
  normalizeRecoveryCode,
  otpauthUri,
  timeStep,
  verifyTotp,
} from './totp.ts';

// RFC 6238 Appendix B, SHA1 seed "12345678901234567890" (8-digit reference values).
const RFC_SEED = Buffer.from('12345678901234567890');
const RFC_VECTORS: Array<[number, string]> = [
  [59, '94287082'],
  [1111111109, '07081804'],
  [1111111111, '14050471'],
  [1234567890, '89005924'],
  [2000000000, '69279037'],
  [20000000000, '65353130'],
];

test('hotp matches the RFC 6238 SHA1 test vectors', () => {
  for (const [t, expected] of RFC_VECTORS) {
    assert.equal(hotp(RFC_SEED, Math.floor(t / 30), 8), expected, `T=${t}`);
  }
});

test('RFC 4226 HOTP vectors (counter 0..9)', () => {
  const expected = ['755224', '287082', '359152', '969429', '338314', '254676', '287922', '162583', '399871', '520489'];
  expected.forEach((code, counter) => assert.equal(hotp(RFC_SEED, counter), code));
});

test('base32 round-trips', () => {
  const secret = generateTotpSecret();
  assert.equal(secret.length, 32);
  assert.equal(base32Encode(base32Decode(secret)), secret);
  assert.equal(base32Encode(Buffer.from('foobar')), 'MZXW6YTBOI');
});

test('verifyTotp accepts the current code and ±1 step, rejects others', () => {
  const secret = base32Encode(RFC_SEED);
  const now = 1_700_000_000_000;
  const step = timeStep(now);
  const at = (s: number) => hotp(RFC_SEED, s);
  assert.equal(verifyTotp(secret, at(step), { nowMs: now }), step);
  assert.equal(verifyTotp(secret, at(step - 1), { nowMs: now }), step - 1);
  assert.equal(verifyTotp(secret, at(step + 1), { nowMs: now }), step + 1);
  assert.equal(verifyTotp(secret, at(step - 2), { nowMs: now }), null);
  assert.equal(verifyTotp(secret, 'abc123', { nowMs: now }), null);
  assert.equal(verifyTotp(secret, at(step).slice(0, 3) + ' ' + at(step).slice(3), { nowMs: now }), step);
});

test('verifyTotp blocks replay of an already-used step', () => {
  const secret = base32Encode(RFC_SEED);
  const now = 1_700_000_000_000;
  const step = timeStep(now);
  const code = hotp(RFC_SEED, step);
  assert.equal(verifyTotp(secret, code, { nowMs: now, lastUsedStep: step }), null);
  assert.equal(verifyTotp(secret, code, { nowMs: now, lastUsedStep: step - 1 }), step);
});

test('otpauth URI carries issuer and account', () => {
  const uri = otpauthUri('JBSWY3DPEHPK3PXP', 'rina@acme.dev');
  assert.match(uri, /^otpauth:\/\/totp\/Envinity%3Arina%40acme\.dev\?/);
  assert.match(uri, /secret=JBSWY3DPEHPK3PXP/);
  assert.match(uri, /issuer=Envinity/);
});

test('recovery codes are unique, formatted and normalizable', () => {
  const codes = generateRecoveryCodes();
  assert.equal(codes.length, 10);
  assert.equal(new Set(codes).size, 10);
  for (const c of codes) assert.match(c, /^[A-Z2-9]{4}-[A-Z2-9]{4}-[A-Z2-9]{4}$/);
  assert.equal(normalizeRecoveryCode(codes[0].toLowerCase().replace(/-/g, ' ')), codes[0]);
});
