// Mock data + pure helpers for the Envinity dashboard.
// Everything lives in memory: nothing is written to localStorage, because these are secrets.

export const FREE_TTL_MS = 10 * 60 * 1000
const MIN = 60 * 1000
const DAY = 24 * 60 * MIN

export const USER = {
  name: 'Rina Putri',
  firstName: 'Rina',
  email: 'rina@acme.dev',
  initials: 'RP',
  team: 'Acme Engineering',
}

export const ENVIRONMENTS = ['production', 'staging', 'development', 'preview']

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789' // no 0/O/1/I/L to avoid misreads

function randomInts(n) {
  const arr = new Uint32Array(n)
  if (typeof crypto !== 'undefined' && crypto.getRandomValues) crypto.getRandomValues(arr)
  else for (let i = 0; i < n; i++) arr[i] = Math.floor(Math.random() * 2 ** 32)
  return arr
}

export function generateCode() {
  const r = randomInts(8)
  const chars = Array.from(r, (x) => CODE_ALPHABET[x % CODE_ALPHABET.length]).join('')
  return `${chars.slice(0, 4)}-${chars.slice(4)}`
}

export function generateId() {
  return Array.from(randomInts(3), (x) => x.toString(36)).join('').slice(0, 10)
}

/** Normalise user input like "7k2q9xpa" or "7K2Q 9XPA" into "7K2Q-9XPA". */
export function normaliseCode(input) {
  const raw = input.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
  return raw.length > 4 ? `${raw.slice(0, 4)}-${raw.slice(4)}` : raw
}

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

export function fmtAgo(ts, now) {
  const d = Math.max(0, now - ts)
  if (d < MIN) return 'just now'
  if (d < 60 * MIN) return `${Math.floor(d / MIN)}m ago`
  if (d < DAY) return `${Math.floor(d / (60 * MIN))}h ago`
  const days = Math.floor(d / DAY)
  return days === 1 ? 'yesterday' : `${days} days ago`
}

/** active | expired | revoked | used */
export function ticketStatus(t, now) {
  if (t.revoked) return 'revoked'
  if (t.expiresAt !== null && t.expiresAt <= now) return 'expired'
  if (t.oneTime && t.opens.length > 0) return 'used'
  return 'active'
}

export const SAMPLE_ENV = `# acme-api / staging
DATABASE_URL=postgres://app:example@db.staging.internal:5432/app
STRIPE_SECRET_KEY=sk_test_51Hx9aQ2eZvKYlo2C8f
JWT_SECRET=dev-only-b7f1c9e2a04d
REDIS_URL=redis://cache.staging.internal:6379
`

// All example secrets are fake test values.
export function seedState(now) {
  const mk = (over) => ({
    id: generateId(),
    code: generateCode(),
    oneTime: false,
    revoked: false,
    opens: [],
    ...over,
  })
  const tickets = [
    mk({
      name: 'acme-api',
      environment: 'production',
      createdAt: now - 214 * DAY,
      expiresAt: null,
      code: '7K2Q-9XPA',
      vars: [
        { key: 'DATABASE_URL', value: 'postgres://app:example@db.internal:5432/prod' },
        { key: 'STRIPE_SECRET_KEY', value: 'sk_test_51Hx9aQ2eZvKYlo2C8f' },
        { key: 'JWT_SECRET', value: 'example-b7f1c9e2a04d4e6f' },
        { key: 'REDIS_URL', value: 'redis://cache.internal:6379' },
        { key: 'OPENAI_API_KEY', value: 'sk-test-4f8a2c91e7b3' },
        { key: 'S3_BUCKET', value: 'envinity-assets-prod' },
      ],
      opens: [
        { who: 'Dimas Pratama', via: 'QR', at: now - 2 * DAY },
        { who: 'Ayu Lestari', via: 'Code', at: now - 9 * DAY },
        { who: 'Bagas Wicaksono', via: 'QR', at: now - 40 * DAY },
      ],
    }),
    mk({
      name: 'web-app',
      environment: 'staging',
      createdAt: now - 61 * DAY,
      expiresAt: null,
      vars: [
        { key: 'NEXT_PUBLIC_API_URL', value: 'https://api.staging.acme.dev' },
        { key: 'SENTRY_DSN', value: 'https://example@o0.ingest.sentry.io/0' },
        { key: 'SESSION_SECRET', value: 'example-staging-91ac' },
      ],
      opens: [{ who: 'Ayu Lestari', via: 'Code', at: now - 3 * DAY }],
    }),
    mk({
      name: 'ml-worker',
      environment: 'development',
      createdAt: now - 3 * MIN,
      expiresAt: now - 3 * MIN + FREE_TTL_MS,
      oneTime: true,
      vars: [
        { key: 'HF_TOKEN', value: 'hf_test_e1b2c3d4' },
        { key: 'QUEUE_URL', value: 'amqp://localhost:5672' },
      ],
    }),
    mk({
      name: 'landing',
      environment: 'preview',
      createdAt: now - 2 * DAY,
      expiresAt: now - 2 * DAY + FREE_TTL_MS,
      vars: [],
      destroyed: true,
      opens: [{ who: 'Bagas Wicaksono', via: 'QR', at: now - 2 * DAY + 4 * MIN }],
    }),
  ]

  // Tickets teammates shared with Rina. Codes are shown as hints in the "Open a code" view.
  const inbox = [
    {
      id: generateId(),
      code: '4F7H-2KQM',
      from: 'Dimas Pratama',
      name: 'payments-svc',
      environment: 'staging',
      expiresAt: now + 8 * MIN,
      vars: [
        { key: 'MIDTRANS_SERVER_KEY', value: 'SB-Mid-server-example' },
        { key: 'WEBHOOK_SECRET', value: 'whsec_example_51f2' },
        { key: 'DATABASE_URL', value: 'postgres://pay:example@db.staging.internal/pay' },
      ],
    },
    {
      id: generateId(),
      code: 'Q9WN-6RTB',
      from: 'Ayu Lestari',
      name: 'mobile-app',
      environment: 'production',
      expiresAt: null,
      vars: [
        { key: 'FIREBASE_API_KEY', value: 'AIza-example-mobile' },
        { key: 'MAPS_API_KEY', value: 'maps-example-key' },
      ],
    },
  ]

  const activity = [
    { id: generateId(), at: now - 3 * MIN, kind: 'create', text: 'You created ml-worker / development' },
    { id: generateId(), at: now - 2 * DAY + 10 * MIN, kind: 'expire', text: 'landing / preview expired and was destroyed' },
    { id: generateId(), at: now - 2 * DAY + 4 * MIN, kind: 'open', text: 'Bagas opened landing / preview via QR' },
    { id: generateId(), at: now - 2 * DAY, kind: 'open', text: 'Dimas opened acme-api / production via QR' },
    { id: generateId(), at: now - 3 * DAY, kind: 'open', text: 'Ayu opened web-app / staging via code' },
  ]

  return { plan: 'pro', tickets, inbox, activity, received: [], toasts: [], now }
}
