// Pure helpers for the Envinity dashboard (no mock data: everything comes from the API).
export { normaliseCode } from './crypto.js'

export const FREE_TTL_MS = 10 * 60 * 1000
export const ENVIRONMENTS = ['production', 'staging', 'development', 'preview']

const KEY_RE = /^[A-Z][A-Z0-9_]*$/

/**
 * Parse .env text. Returns { vars: [{key, value}], errors: [{line, message}] }.
 * Rules follow the design file: UPPER_SNAKE_CASE keys, value required, no duplicates.
 */
export function parseEnv(text) {
  const vars = []
  const errors = []
  const seen = new Set()
  text.split(/\r?\n/).forEach((rawLine, i) => {
    const line = rawLine.trim()
    const n = i + 1
    if (!line || line.startsWith('#')) return
    const clean = line.startsWith('export ') ? line.slice(7).trim() : line
    const eq = clean.indexOf('=')
    if (eq === -1) {
      errors.push({ line: n, message: 'Missing "=". Use KEY=VALUE.' })
      return
    }
    const key = clean.slice(0, eq).trim()
    let value = clean.slice(eq + 1).trim()
    if (/^(['"]).*\1$/.test(value)) value = value.slice(1, -1)
    if (!KEY_RE.test(key)) {
      errors.push({ line: n, message: `"${key || '(empty)'}" must be UPPER_SNAKE_CASE.` })
      return
    }
    if (!value) {
      errors.push({ line: n, message: `${key} has no value.` })
      return
    }
    if (seen.has(key)) {
      errors.push({ line: n, message: `${key} is defined twice.` })
      return
    }
    seen.add(key)
    vars.push({ key, value })
  })
  return { vars, errors }
}

export function toEnvText(vars) {
  return vars.map(({ key, value }) => `${key}=${/\s/.test(value) ? `"${value}"` : value}`).join('\n') + '\n'
}

export function fmtCountdown(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000))
  return `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`
}

const MIN = 60 * 1000
const DAY = 24 * 60 * MIN

export function fmtAgo(ts, now) {
  const d = Math.max(0, now - ts)
  if (d < MIN) return 'just now'
  if (d < 60 * MIN) return `${Math.floor(d / MIN)}m ago`
  if (d < DAY) return `${Math.floor(d / (60 * MIN))}h ago`
  const days = Math.floor(d / DAY)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

/** Server status, plus the client clock for tickets that expired since the last fetch. */
export function ticketStatus(t, now) {
  if (t.status && t.status !== 'active') return t.status
  if (t.expiresAt !== null && t.expiresAt <= now) return 'expired'
  return 'active'
}

/** API timestamps (ISO strings) -> epoch ms, so countdowns are plain arithmetic. */
export function normaliseTicket(t) {
  return {
    ...t,
    expiresAt: t.expiresAt ? Date.parse(t.expiresAt) : null,
    createdAt: Date.parse(t.createdAt),
    opens: Array.isArray(t.opens) ? t.opens.map((o) => ({ ...o, at: Date.parse(o.at) })) : t.opens,
  }
}

const label = (m) => (m?.name ? `${m.name} / ${m.environment}` : 'a ticket')

/** Audit-log rows -> human sentences for the activity feed. */
export function activityText(a, me) {
  const who = a.actor === me ? 'You' : a.actor || 'Someone'
  const m = a.metadata || {}
  switch (a.action) {
    case 'ticket.created':
      return `${who} created ${label(m)}`
    case 'ticket.opened':
      return `${m.by || who} opened ${label(m)} via ${m.via === 'qr' ? 'QR' : 'code'}`
    case 'ticket.revoked':
      return `${who} revoked ${label(m)}`
    case 'ticket.deleted':
      return `${who} deleted ${label(m)}`
    case 'ticket.expired':
      return `${label(m)} expired and was destroyed`
    case 'plan.upgraded':
      return `${who} upgraded to Pro`
    case 'plan.downgraded':
      return `${who} switched to Free`
    case 'auth.2fa_enabled':
      return `${who} turned on two-factor authentication`
    case 'auth.2fa_disabled':
      return `${who} turned off two-factor authentication`
    case 'auth.2fa_recovery_codes_regenerated':
      return `${who} generated new recovery codes`
    default:
      return a.action
  }
}

export const activityKind = (action) =>
  ({
    'ticket.created': 'create',
    'ticket.opened': 'open',
    'ticket.expired': 'expire',
    'ticket.revoked': 'revoke',
    'ticket.deleted': 'delete',
  })[action] || 'plan'

export const SAMPLE_ENV = `# acme-api / staging (sample values)
DATABASE_URL=postgres://app:example@db.staging.internal:5432/app
STRIPE_SECRET_KEY=sk_test_51Hx9aQ2eZvKYlo2C8f
JWT_SECRET=dev-only-b7f1c9e2a04d
REDIS_URL=redis://cache.staging.internal:6379
`
