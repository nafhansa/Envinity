# Envinity

Share `.env` files with your team through a ticket, a QR code or a unique code. Encrypted on your device, gone when you say so.
Envinity, powered by Securinity.

```
apps/
  web/   Astro landing page + React dashboard (/dashboard)
  api/   Express + TypeScript + Postgres API (same architecture as Securinity's apps/api)
```

## Run it locally

Requires Node 20+ and Docker.

```bash
npm run setup                     # writes .env with fresh secrets (never overwrites)
npm run db:up                     # Postgres 17 on 127.0.0.1:5434
npm --prefix apps/api install
npm --prefix apps/web install
npm run migrate
npm run dev:api                   # http://127.0.0.1:4000
npm run dev:web                   # http://localhost:4321, proxies /api to the API
npm test                          # API unit + end-to-end tests (needs the database)
```

## Backend, adapted from Securinity

Same conventions as `securinity/apps/api`:

- Express + TypeScript run with `tsx`, `zod` validation with strict objects, `{ data }` / `{ error }` envelope.
- Postgres with Row Level Security per tenant (`withTenant` / `withSystem`), FORCEd, and a least-privilege `envinity_app` role.
- SQL migrations with checksums (`apps/api/src/db/migrations`).
- Sessions: httpOnly access JWT (15 min), path-scoped rotating refresh token with family reuse detection, double-submit CSRF cookie. Cookie names use an `ev_` prefix.
- scrypt hashing, account lockout, Postgres-backed rate limiting, append-only audit log, log redaction, helmet + strict CORS.

## Security model (zero-knowledge)

| Data | What the server stores |
| --- | --- |
| Password | Nothing. The browser derives `authKey` (PBKDF2 600k + HKDF) and the server stores `scrypt(authKey)`. |
| Vault key | Nothing. Derived from the password in the browser, kept in memory only (re-entered after reload). |
| `.env` contents | AES-256-GCM ciphertext, encrypted in the browser with a random ticket key K. |
| Ticket key K | Wrapped with the owner's vault key, and wrapped with a key derived from the share code (PBKDF2 300k). |
| Share code | `HMAC(LOOKUP_PEPPER, SHA-256(code))` for lookup only. |
| QR link | Carries K in the URL fragment (`#/q/<id>/<key>`), which browsers never send to a server. |

- Free tickets expire 10 minutes after creation. A worker overwrites the ciphertext and every wrapped key with NULL within seconds, and expired payloads are never served even before that.
- Pro tickets are kept until the owner deletes them. Switching Pro to Free puts kept tickets back on a 10-minute timer.
- One-time tickets are claimed atomically, so only one person can open them.
- Share codes are short (8 characters, about 40 bits), so the code path relies on server-side rate limiting (10 tries per 5 min per user, 30 per IP). The QR path does not.
- Forgetting the password means owned tickets cannot be decrypted. That is the price of the server never holding the key.

## Two-factor authentication (TOTP)

- Works with any authenticator app (RFC 6238: SHA-1, 6 digits, 30 s, ±1 step for clock drift).
- Enrolment needs the password, then a valid code. 10 single-use recovery codes are shown once.
- Login with 2FA returns a short-lived challenge (5 min, 5 attempts) instead of a session.
- Replay protection: a code's time step can only be used once.
- TOTP secrets are AES-256-GCM encrypted at rest with `TOTP_ENCRYPTION_KEY`.
- Turning 2FA on or off bumps `token_version` and revokes refresh tokens, signing out other devices.

## API

| Method | Path | |
| --- | --- | --- |
| POST | `/api/auth/prelogin` | KDF salt for an email (fake but stable for unknown emails) |
| POST | `/api/auth/register`, `/api/auth/login` | `login` may return `{ mfaRequired, challengeToken }` |
| POST | `/api/auth/2fa/verify` | complete a 2FA login with `code` or `recoveryCode` |
| POST | `/api/auth/refresh`, `/api/auth/logout` | |
| GET | `/api/auth/me` | |
| POST | `/api/auth/reauth` | confirm the password (vault unlock) |
| POST | `/api/auth/2fa/setup`, `/enable`, `/disable`, `/recovery-codes` | 2FA management |
| GET/POST | `/api/tickets` | list / create |
| GET/DELETE | `/api/tickets/:id` | detail (ciphertext + owner-wrapped key) / delete |
| POST | `/api/tickets/:id/revoke` | |
| POST | `/api/open/code`, `/api/open/qr/:id` | recipient side |
| GET | `/api/open/received` | tickets you opened (metadata only) |
| GET | `/api/workspace/activity` | |
| PATCH | `/api/workspace/plan` | dev only until billing is connected (`ALLOW_PLAN_SELF_SERVE`) |

## Not done yet

- Billing (plan switching is self-serve in development only).
- Password reset is impossible by design for owned tickets; account recovery flow and email verification are not built.
- Team workspaces with multiple members (the schema has `memberships`, the UI is single-user).
- Native Android, iOS and desktop apps.
