// Thin API client, same contract as Securinity's web client:
//  1. Sessions are httpOnly cookies, so nothing here stores a token.
//  2. Mutations echo the readable `ev_csrf` cookie in X-CSRF-Token (double-submit CSRF).
//  3. One 401 triggers a single shared refresh attempt, then the request is retried once.

export class ApiError extends Error {
  constructor(status, code, message, details, requestId) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.code = code
    this.details = details
    this.requestId = requestId
  }
  get fieldErrors() {
    return Array.isArray(this.details) ? this.details : []
  }
}

function readCookie(name) {
  const match = document.cookie.match(new RegExp(`(?:^|; )${name}=([^;]*)`))
  return match ? decodeURIComponent(match[1]) : null
}

const MUTATING = new Set(['POST', 'PATCH', 'PUT', 'DELETE'])
let refreshInFlight = null

function csrfHeaders() {
  const token = readCookie('ev_csrf')
  return token ? { 'X-CSRF-Token': token } : {}
}

function refreshSession() {
  if (!refreshInFlight) {
    refreshInFlight = fetch('/api/auth/refresh', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...csrfHeaders() },
      body: '{}',
    })
      .then((r) => r.ok)
      .catch(() => false)
      .finally(() => setTimeout(() => (refreshInFlight = null), 0))
  }
  return refreshInFlight
}

export async function request(path, { method = 'GET', body, retry = true } = {}) {
  method = method.toUpperCase()
  const send = () => {
    const headers = { Accept: 'application/json' }
    if (MUTATING.has(method)) Object.assign(headers, { 'Content-Type': 'application/json' }, csrfHeaders())
    return fetch(`/api${path}`, {
      method,
      credentials: 'same-origin',
      headers,
      body: MUTATING.has(method) ? JSON.stringify(body ?? {}) : undefined,
    })
  }

  let res
  try {
    res = await send()
  } catch {
    throw new ApiError(0, 'network', 'Cannot reach Envinity. Check your connection and that the API is running.')
  }
  // Sign-in calls pass retry: false; everything else (including /auth/me) refreshes once.
  if (res.status === 401 && retry) {
    if (await refreshSession()) res = await send()
  }

  const json = await res.json().catch(() => ({}))
  if (!res.ok) {
    const e = json.error || {}
    throw new ApiError(res.status, e.code || 'error', e.message || `Request failed (${res.status}).`, e.details, e.requestId)
  }
  return json.data
}

export const api = {
  get: (p) => request(p),
  post: (p, body, opts) => request(p, { method: 'POST', body, ...opts }),
  patch: (p, body) => request(p, { method: 'PATCH', body }),
  del: (p) => request(p, { method: 'DELETE' }),
}
