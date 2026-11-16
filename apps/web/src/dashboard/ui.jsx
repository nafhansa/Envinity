import { useEffect, useId, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { Ban, CheckCheck, Copy, Eye, EyeOff, Flame, Infinity as InfinityIcon, Timer, X } from 'lucide-react'
import { FREE_TTL_MS, fmtCountdown, ticketStatus } from './data'
import { useStore } from './store'

export const ease = [0.22, 1, 0.36, 1]

export function PageHeader({ eyebrow, title, children, sub }) {
  return (
    <div className="d-head">
      <div style={{ minWidth: 0 }}>
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        <h1>{title}</h1>
        {sub && <p>{sub}</p>}
      </div>
      {children && <div className="d-head-actions">{children}</div>}
    </div>
  )
}

const STATUS_META = {
  active: { cls: 'ok', text: 'Active' },
  expired: { cls: 'muted', text: 'Expired', Icon: Flame },
  revoked: { cls: 'danger', text: 'Revoked', Icon: Ban },
  used: { cls: 'muted', text: 'Opened once', Icon: CheckCheck },
}

export function StatusBadge({ ticket }) {
  const { state } = useStore()
  const s = ticketStatus(ticket, state.now)
  const m = STATUS_META[s]
  return (
    <span className={`badge ${m.cls}`}>
      {m.Icon ? <m.Icon size={12} aria-hidden="true" /> : <span className="live-dot" aria-hidden="true" />}
      {m.text}
    </span>
  )
}

/** Countdown for 10 minute tickets, or an infinity marker for kept tickets. */
export function ExpiryMeter({ ticket, compact = false }) {
  const { state } = useStore()
  const status = ticketStatus(ticket, state.now)
  if (ticket.expiresAt === null) {
    return (
      <span className="expiry forever">
        <InfinityIcon size={15} aria-hidden="true" /> {compact ? 'Kept' : 'Kept until you delete it'}
      </span>
    )
  }
  if (status !== 'active' && status !== 'used') {
    return <span className="expiry gone">Destroyed</span>
  }
  const left = ticket.expiresAt - state.now
  const pct = Math.max(0, Math.min(1, left / FREE_TTL_MS))
  const urgent = left < 2 * 60 * 1000
  return (
    <span className={`expiry timed ${urgent ? 'urgent' : ''}`}>
      <Timer size={14} aria-hidden="true" />
      <span className="mono" aria-label={`Expires in ${fmtCountdown(left)}`}>
        {fmtCountdown(left)}
      </span>
      {!compact && (
        <span className="meter" aria-hidden="true">
          <span style={{ transform: `scaleX(${pct})` }} />
        </span>
      )}
    </span>
  )
}

export function SecretRow({ k, v, index = 0 }) {
  const [shown, setShown] = useState(false)
  const { actions } = useStore()
  return (
    <motion.div
      className="secret-row"
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: index * 0.04, ease }}
    >
      <div className="secret-key mono">{k}</div>
      <div className="secret-val mono">
        <AnimatePresence mode="wait" initial={false}>
          <motion.span
            key={shown ? 'v' : 'm'}
            initial={{ opacity: 0, filter: 'blur(4px)' }}
            animate={{ opacity: 1, filter: 'blur(0px)' }}
            exit={{ opacity: 0 }}
            transition={{ duration: 0.18 }}
          >
            {shown ? v : '••••••••••••'}
          </motion.span>
        </AnimatePresence>
      </div>
      <div className="secret-actions">
        <button className="icon-btn" onClick={() => setShown((s) => !s)} aria-label={`${shown ? 'Hide' : 'Reveal'} ${k}`} aria-pressed={shown}>
          {shown ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
        <button className="icon-btn" onClick={() => actions.copy(v, `${k} copied`)} aria-label={`Copy ${k}`}>
          <Copy size={16} />
        </button>
      </div>
    </motion.div>
  )
}

export function EmptyState({ icon: Icon, title, children, action }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon size={22} aria-hidden="true" />
      </div>
      <h3>{title}</h3>
      <p>{children}</p>
      {action}
    </div>
  )
}

/** Accessible modal: focus moves in, Esc closes, focus returns to the trigger. */
export function Modal({ open, onClose, title, children, actions }) {
  const id = useId()
  const ref = useRef(null)
  // Keep the latest onClose in a ref so the effect runs only on open/close. Otherwise an
  // inline onClose re-runs it every render and steals focus back to the first field.
  const onCloseRef = useRef(onClose)
  useEffect(() => {
    onCloseRef.current = onClose
  })
  useEffect(() => {
    if (!open) return
    const prev = document.activeElement
    const onKey = (e) => e.key === 'Escape' && onCloseRef.current()
    document.addEventListener('keydown', onKey)
    requestAnimationFrame(() => {
      const root = ref.current
      if (root && !root.contains(document.activeElement)) {
        ;(root.querySelector('input, select, textarea') || root.querySelector('button, [href]'))?.focus()
      }
    })
    return () => {
      document.removeEventListener('keydown', onKey)
      prev?.focus?.()
    }
  }, [open])
  return (
    <AnimatePresence>
      {open && (
        <motion.div className="modal-backdrop" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} onClick={onClose}>
          <motion.div
            ref={ref}
            className="modal"
            role="dialog"
            aria-modal="true"
            aria-labelledby={id}
            initial={{ opacity: 0, y: 24, scale: 0.97 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 12, scale: 0.98, transition: { duration: 0.15 } }}
            transition={{ duration: 0.3, ease }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-head">
              <h2 id={id}>{title}</h2>
              <button className="icon-btn" onClick={onClose} aria-label="Close">
                <X size={18} />
              </button>
            </div>
            <div className="modal-body">{children}</div>
            {actions && <div className="modal-actions">{actions}</div>}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

export function Toasts() {
  const { state } = useStore()
  return (
    <div className="toasts" role="status" aria-live="polite">
      <AnimatePresence>
        {state.toasts.map((t) => (
          <motion.div
            key={t.id}
            className="toast"
            layout
            initial={{ opacity: 0, y: 20, scale: 0.95 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 10, transition: { duration: 0.15 } }}
          >
            {t.text}
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  )
}

export function Stat({ label, value, hint, index = 0, tone }) {
  return (
    <motion.div
      className={`card stat ${tone || ''}`}
      initial={{ opacity: 0, y: 16 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.05 + index * 0.06, duration: 0.5, ease }}
    >
      <div className="label">{label}</div>
      <div className="stat-value">{value}</div>
      {hint && <div className="stat-hint">{hint}</div>}
    </motion.div>
  )
}
