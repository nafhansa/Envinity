import { createContext, useCallback, useContext, useEffect, useMemo, useReducer, useState } from 'react'
import { FREE_TTL_MS, USER, generateCode, generateId, seedState, ticketStatus } from './data'

const StoreCtx = createContext(null)

function log(state, text, kind, at) {
  return [{ id: generateId(), at, kind, text }, ...state.activity].slice(0, 50)
}

const label = (t) => `${t.name} / ${t.environment}`

function reducer(state, action) {
  const now = state.now
  switch (action.type) {
    case 'tick': {
      // Expire tickets: when the clock passes expiresAt, the payload is wiped for good.
      let activity = state.activity
      let changed = false
      const tickets = state.tickets.map((t) => {
        if (!t.destroyed && t.expiresAt !== null && t.expiresAt <= action.now) {
          changed = true
          activity = [{ id: generateId(), at: action.now, kind: 'expire', text: `${label(t)} expired and was destroyed` }, ...activity]
          return { ...t, vars: [], destroyed: true }
        }
        return t
      })
      const inbox = state.inbox.map((t) =>
        !t.destroyed && t.expiresAt !== null && t.expiresAt <= action.now ? ((changed = true), { ...t, vars: [], destroyed: true }) : t,
      )
      return changed ? { ...state, now: action.now, tickets, inbox, activity } : { ...state, now: action.now }
    }
    case 'create': {
      const { name, environment, vars, oneTime, keepForever } = action.payload
      const forever = state.plan === 'pro' && keepForever
      const ticket = {
        id: action.id,
        code: generateCode(),
        name,
        environment,
        vars,
        oneTime,
        revoked: false,
        opens: [],
        createdAt: now,
        expiresAt: forever ? null : now + FREE_TTL_MS,
      }
      return { ...state, tickets: [ticket, ...state.tickets], activity: log(state, `You created ${label(ticket)}`, 'create', now) }
    }
    case 'revoke': {
      const t = state.tickets.find((x) => x.id === action.id)
      return {
        ...state,
        tickets: state.tickets.map((x) => (x.id === action.id ? { ...x, revoked: true } : x)),
        activity: log(state, `You revoked ${label(t)}. Its QR and code no longer work.`, 'revoke', now),
      }
    }
    case 'delete': {
      const t = state.tickets.find((x) => x.id === action.id)
      return {
        ...state,
        tickets: state.tickets.filter((x) => x.id !== action.id),
        activity: log(state, `You deleted ${label(t)}`, 'delete', now),
      }
    }
    case 'setPlan': {
      if (action.plan === state.plan) return state
      // Downgrading: tickets that were kept forever fall back to the Free 10 minute rule.
      const tickets =
        action.plan === 'free'
          ? state.tickets.map((t) => (t.expiresAt === null && !t.destroyed ? { ...t, expiresAt: now + FREE_TTL_MS } : t))
          : state.tickets
      const text = action.plan === 'pro' ? 'You upgraded to Pro' : 'You switched to Free. Kept tickets now expire in 10 minutes.'
      return { ...state, plan: action.plan, tickets, activity: log(state, text, 'plan', now) }
    }
    case 'openCode': {
      // Mark a teammate's (or your own) ticket as opened by you.
      const { code } = action
      const own = state.tickets.find((t) => t.code === code)
      if (own) {
        return {
          ...state,
          tickets: state.tickets.map((t) => (t.id === own.id ? { ...t, opens: [{ who: `${USER.firstName} (you)`, via: 'Code', at: now }, ...t.opens] } : t)),
          received: [{ ...own, from: 'You', openedAt: now }, ...state.received.filter((r) => r.code !== code)],
          activity: log(state, `You opened ${label(own)} via code`, 'open', now),
        }
      }
      const t = state.inbox.find((x) => x.code === code)
      return {
        ...state,
        received: [{ ...t, openedAt: now }, ...state.received.filter((r) => r.code !== code)],
        activity: log(state, `You opened ${label(t)} from ${t.from.split(' ')[0]}`, 'open', now),
      }
    }
    case 'toast':
      return { ...state, toasts: [...state.toasts, { id: action.id, text: action.text }] }
    case 'dismissToast':
      return { ...state, toasts: state.toasts.filter((t) => t.id !== action.id) }
    default:
      return state
  }
}

export function StoreProvider({ children }) {
  const [state, dispatch] = useReducer(reducer, null, () => seedState(Date.now()))

  useEffect(() => {
    const id = setInterval(() => dispatch({ type: 'tick', now: Date.now() }), 1000)
    return () => clearInterval(id)
  }, [])

  const toast = useCallback((text) => {
    const id = generateId()
    dispatch({ type: 'toast', id, text })
    setTimeout(() => dispatch({ type: 'dismissToast', id }), 3200)
  }, [])

  const actions = useMemo(
    () => ({
      createTicket(payload) {
        const id = generateId()
        dispatch({ type: 'create', id, payload })
        return id
      },
      revoke: (id) => dispatch({ type: 'revoke', id }),
      remove: (id) => dispatch({ type: 'delete', id }),
      setPlan: (plan) => dispatch({ type: 'setPlan', plan }),
      toast,
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
    [toast],
  )

  /** Validate a code like the server would. Returns { ok, error }. */
  const lookupCode = useCallback(
    (code) => {
      const t = state.tickets.find((x) => x.code === code) || state.inbox.find((x) => x.code === code)
      if (!t) return { ok: false, error: 'No ticket matches this code. Check for typos.' }
      if (t.revoked) return { ok: false, error: 'This ticket was revoked by its owner.' }
      if (t.destroyed || (t.expiresAt !== null && t.expiresAt <= state.now))
        return { ok: false, error: 'This ticket expired. Its data has been destroyed.' }
      if (t.oneTime && t.opens?.length) return { ok: false, error: 'This one-time ticket was already opened.' }
      dispatch({ type: 'openCode', code })
      return { ok: true }
    },
    [state],
  )

  const value = useMemo(() => ({ state, actions, lookupCode }), [state, actions, lookupCode])
  return <StoreCtx.Provider value={value}>{children}</StoreCtx.Provider>
}

export function useStore() {
  return useContext(StoreCtx)
}

export function useTicketStatus(t) {
  const { state } = useStore()
  return ticketStatus(t, state.now)
}

/** Tiny hash router: #/tickets/abc -> { name: 'ticket', id: 'abc' }. Gives deep links + working back button. */
function parseHash() {
  const parts = (typeof window === 'undefined' ? '' : window.location.hash).replace(/^#\/?/, '').split('/').filter(Boolean)
  const [a, b] = parts
  if (a === 'tickets' && b) return { name: 'ticket', id: b }
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
