// Creates .env from .env.example with fresh random secrets. Never overwrites an existing .env.
import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';

if (existsSync('.env')) {
  console.log('.env already exists, leaving it untouched.');
  process.exit(0);
}
const out = readFileSync('.env.example', 'utf8')
  .replace(/^JWT_SECRET=$/m, `JWT_SECRET=${randomBytes(48).toString('base64url')}`)
  .replace(/^TOTP_ENCRYPTION_KEY=$/m, `TOTP_ENCRYPTION_KEY=${randomBytes(32).toString('base64')}`)
  .replace(/^LOOKUP_PEPPER=$/m, `LOOKUP_PEPPER=${randomBytes(48).toString('base64url')}`);
writeFileSync('.env', out, { mode: 0o600 });
console.log('Wrote .env with fresh secrets.');
