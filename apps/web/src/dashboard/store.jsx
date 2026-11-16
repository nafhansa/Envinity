import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react'
import { api, ApiError } from './api'
import * as C from './crypto'
import { normaliseTicket } from './data'

const generateId = () => Math.random().toString(36).slice(2, 10)

/**
 * Session + workspace data, backed by the Envinity API.
 *
 * The vault key lives only in this module's React state (memory). It is derived
 * from the password and never stored: after a reload the user unlocks again.
 */
const StoreCtx = createContext(null)

export function StoreProvider({ children }) {
  const [phase, setPhase] = useState('loading') // loading | signedOut | mfa | locked | ready
  const [session, setSession] = useState(null)
  const [vaultKey, setVaultKey] = useState(null)
  const [mfa, setMfa] = useState(null) // { challengeToken, email, pendingVault }
  const [tickets, setTickets] = useState([])
  const [activity, setActivity] = useState([])
  const [received, setReceived] = useState([])
  const [toasts, setToasts] = useState([])
  const [skew, setSkew] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  const loadedOnce = useRef(false)

  // 1s clock, corrected for server time so countdowns match the server's expiry.
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now() + skew), 1000)
    return () => clearInterval(id)
  }, [skew])

  const toast = useCallback((text) => {
    const id = generateId()
    setToasts((t) => [...t, { id, text }])
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 3600)
  }, [])

  const signedOut = useCallback(() => {
    setSession(null)
    setVaultKey(null)
    setTickets([])
    setActivity([])
    setReceived([])
    setPhase('signedOut')
  }, [])

  const handle = useCallback(
    (err) => {
      if (err instanceof ApiError && err.status === 401 && !err.code?.startsWith('mfa')) signedOut()
      throw err
    },
    [signedOut],
  )

  const refresh = useCallback(async () => {
    try {
      const [t, a, r] = await Promise.all([
        api.get('/tickets'),
        api.get('/workspace/activity'),
        api.get('/open/received'),
      ])
      setSkew(Date.parse(t.serverTime) - Date.now())
      setTickets(t.tickets.map(normaliseTicket))
      setActivity(a.activity.map((x) => ({ ...x, at: Date.parse(x.at) })))
      setReceived(r.received.map((x) => ({ ...x, openedAt: Date.parse(x.openedAt) })))
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) signedOut()
    }
  }, [signedOut])

  // Boot: is there a session cookie?
  useEffect(() => {
    if (loadedOnce.current) return
    loadedOnce.current = true
    api
      .get('/auth/me')
      .then((me) => {
        setSession(me)
        setPhase('locked') // signed in, but the vault key must be re-derived from the password
      })
      .catch(() => setPhase('signedOut'))
  }, [])

  useEffect(() => {
    if (phase !== 'ready') return
    refresh()
    const id = setInterval(refresh, 15_000)
    return () => clearInterval(id)
  }, [phase, refresh])

  const auth = useMemo(
    () => ({
      async register({ email, name, password }) {
        const salt = C.newKdfSalt()
        const keys = await C.deriveAccountKeys(password, salt)
        const me = await api.post(
          '/auth/register',
          { email, name, authKey: keys.authKey, kdfSalt: salt, kdfIterations: C.ACCOUNT_KDF_ITERATIONS },
          { retry: false },
        )
        setSession(me)
        setVaultKey(keys.vaultKey)
        setPhase('ready')
      },
      async login({ email, password }) {
        const pre = await api.post('/auth/prelogin', { email }, { retry: false })
        const keys = await C.deriveAccountKeys(password, pre.kdfSalt, pre.kdfIterations)
        const res = await api.post('/auth/login', { email, authKey: keys.authKey }, { retry: false })
        if (res.mfaRequired) {
          setMfa({ challengeToken: res.challengeToken, email, pendingVault: keys.vaultKey, expiresAt: Date.now() + res.expiresInSec * 1000 })
          setPhase('mfa')
          return
        }
        setSession(res)
        setVaultKey(keys.vaultKey)
        setPhase('ready')
      },
      async verify2fa({ code, recoveryCode }) {
        const res = await api.post('/auth/2fa/verify', { challengeToken: mfa.challengeToken, code, recoveryCode }, { retry: false })
        setSession(res)
        setVaultKey(mfa.pendingVault)
        setMfa(null)
        setPhase('ready')
      },
      cancelMfa() {
        setMfa(null)
        setPhase('signedOut')
      },
      /** After a reload: re-derive the vault key and confirm the password with the server. */
      async unlock(password) {
        const keys = await C.deriveAccountKeys(password, session.kdf.salt, session.kdf.iterations)
        await api.post('/auth/reauth', { authKey: keys.authKey })
        setVaultKey(keys.vaultKey)
        setPhase('ready')
      },
      async logout() {
        await api.post('/auth/logout', {}, { retry: false }).catch(() => {})
        signedOut()
      },
      /** Derives authKey for sensitive actions (2FA setup/disable) without storing the password. */
      async authKeyFor(password) {
        return (await C.deriveAccountKeys(password, session.kdf.salt, session.kdf.iterations)).authKey
      },
      setSession,
    }),
    [mfa, session, signedOut],
  )

  const actions = useMemo(
    () => ({
      refresh,
      toast,
      async createTicket({ name, environment, vars, oneTime, keepForever }) {
        // A share-code collision is astronomically rare; regenerate and retry if it happens.
        for (let attempt = 0; attempt < 3; attempt++) {
          const sealed = await C.sealTicket({ vars, vaultKey, name, environment, oneTime, keepForever })
          try {
            const created = await api.post('/tickets', sealed.body)
            refresh()
            return created.id
          } catch (err) {
            if (err instanceof ApiError && err.code === 'code_taken') continue
            return handle(err)
          }
        }
        throw new ApiError(409, 'code_taken', 'Could not create a unique share code. Try again.')
      },
      async getTicket(id) {
        const res = await api.get(`/tickets/${id}`).catch(handle)
        const t = normaliseTicket(res.ticket)
        if (!t.ciphertext) return { ticket: t, vars: [], ticketKey: null, code: null }
        const opened = await C.openAsOwner(res.ticket, vaultKey)
        return { ticket: t, ...opened }
      },
      async revoke(id) {
        await api.post(`/tickets/${id}/revoke`).catch(handle)
        refresh()
      },
      async remove(id) {
        await api.del(`/tickets/${id}`).catch(handle)
        refresh()
      },
      async openByCode(code) {
        const res = await api.post('/open/code', { lookup: await C.codeLookup(code) }).catch(handle)
        const vars = await C.openWithCode(code, res)
        refresh()
        return { ticket: normaliseTicket({ ...res.ticket, createdAt: new Date().toISOString() }), vars }
      },
      async openByLink(id, key) {
        const res = await api.post(`/open/qr/${id}`).catch(handle)
        const vars = await C.openWithKey(key, res)
        refresh()
        return { ticket: normaliseTicket({ ...res.ticket, createdAt: new Date().toISOString() }), vars }
      },
      async setPlan(plan) {
        const res = await api.patch('/workspace/plan', { plan }).catch(handle)
        setSession((s) => ({ ...s, tenant: { ...s.tenant, plan: res.plan } }))
        refresh()
        return res
      },
      async copy(text, what = 'Copied') {
        try {
          await navigator.clipboard.writeText(text)
          toast(`${what}. Clipboard clears in 30 seconds.`)
          setTimeout(() => navigator.clipboard.writeText('').catch(() => {}), 30_000)
        } catch {
          toast('Copy failed. Your browser blocked clipboard access.')
        }
      },
    }),
    [refresh, toast, vaultKey, handle],
  )

  const state = { phase, session, tickets, activity, received, toasts, now, mfa, plan: session?.tenant?.plan ?? 'free' }
  const value = useMemo(() => ({ state, actions, auth }), [state, actions, auth]) // eslint-disable-line react-hooks/exhaustive-deps
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>
}

export function useStore() {
  return useContext(StoreCtx)
}

/** Tiny hash router: #/tickets/abc -> { name: 'ticket', id: 'abc' }. Deep links + working back button. */
function parseHash() {
  const parts = (typeof window === 'undefined' ? '' : window.location.hash).replace(/^#\/?/, '').split('/').filter(Boolean)
  const [a, b, c] = parts
  if (a === 'tickets' && b) return { name: 'ticket', id: b }
  // QR links: #/q/<ticketId>/<key>. The key is in the fragment, so it never reaches a server.
  if (a === 'q' && b && c) return { name: 'qr', id: b, key: c }
  if (['tickets', 'new', 'open', 'settings'].includes(a)) return { name: a }
  return { name: 'overview' }
}

export function useRoute() {
  const [route, setRoute] = useState(parseHash)
  useEffect(() => {
    const on = () => {
      setRoute(parseHash())
      window.scrollTo(0, 0)
    }
    window.addEventListener('hashchange', on)
    return () => window.removeEventListener('hashchange', on)
  }, [])
  return route
}

export const go = (path) => {
  window.location.hash = path
}
