import { useEffect, useId, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, Copy, Download, Inbox, KeyRound, Lock, ScanLine, Unlock } from 'lucide-react'
import { ApiError } from '../api'
import { fmtAgo, normaliseCode, toEnvText } from '../data'
import { go, useStore } from '../store'
import { EmptyState, ExpiryMeter, PageHeader, SecretRow, ease } from '../ui'
import { downloadEnv } from './TicketDetail'

const messageOf = (err) => (err instanceof ApiError ? err.message : 'This ticket could not be decrypted. The code or link may be wrong.')

/** Decrypted variables. They exist only in this component's memory, never in storage. */
function UnlockedPanel({ opened }) {
  const { actions } = useStore()
  const { ticket, vars } = opened
  return (
    <motion.section
      className="card panel"
      initial={{ opacity: 0, y: 20, scale: 0.98 }}
      animate={{ opacity: 1, y: 0, scale: 1 }}
      transition={{ ease, duration: 0.45 }}
      aria-labelledby="opened-title"
    >
      <div className="panel-head">
        <div>
          <div className="eyebrow">From {ticket.from}</div>
          <h2 id="opened-title">
            {ticket.name} <span className="env-tag">{ticket.environment}</span>
          </h2>
        </div>
        <ExpiryMeter ticket={{ ...ticket, status: 'active' }} compact />
      </div>
      <div className="secrets">
        {vars.map((v, i) => (
          <SecretRow key={v.key} k={v.key} v={v.value} index={i} />
        ))}
      </div>
      <div className="share-actions" style={{ marginTop: 16, justifyContent: 'flex-start' }}>
        <button className="btn btn-primary" onClick={() => actions.copy(toEnvText(vars), 'All variables copied')}>
          <Copy size={16} aria-hidden="true" /> Copy all
        </button>
        <button className="btn btn-ghost" onClick={() => downloadEnv(vars)}>
          <Download size={16} aria-hidden="true" /> Save .env
        </button>
      </div>
      <p className="fine" style={{ justifyContent: 'flex-start', marginTop: 12 }}>
        <Lock size={14} aria-hidden="true" /> Decrypted on this device. Leaving this page clears it from memory.
      </p>
    </motion.section>
  )
}

function ReceivedList() {
  const { state } = useStore()
  if (!state.received.length) return null
  return (
    <section className="card panel" style={{ marginTop: 16 }} aria-labelledby="hist-title">
      <div className="panel-head">
        <h2 id="hist-title">Recently opened</h2>
        <span className="label">metadata only</span>
      </div>
      <ul className="activity">
        {state.received.slice(0, 8).map((r) => (
          <li key={r.id}>
            <span className="avatar-sm">{r.from[0]}</span>
            <span className="act-text">
              {r.name} / {r.environment} from {r.from}
            </span>
            <span className="act-time">{fmtAgo(r.openedAt, state.now)}</span>
          </li>
        ))}
      </ul>
    </section>
  )
}

export default function OpenCode() {
  const { actions } = useStore()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [opened, setOpened] = useState(null)
  const id = useId()

  const submit = async (e) => {
    e.preventDefault()
    if (code.length < 9) {
      setError('Enter all 8 characters of the code.')
      return
    }
    setBusy(true)
    setError('')
    try {
      setOpened(await actions.openByCode(code))
      setCode('')
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHeader eyebrow="Received" title="Open a code" sub="Got a code from a teammate? Enter it here. Scanning the QR code with your phone camera opens the same ticket." />

      <div className="open-grid">
        <motion.form className="card panel dark code-form" onSubmit={submit} initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ease, duration: 0.5 }}>
          <div className="code-form-icon">
            <KeyRound size={22} aria-hidden="true" />
          </div>
          <label htmlFor={id} className="code-label">
            Unique code
          </label>
          <input
            id={id}
            className={`code-input mono ${error ? 'invalid' : ''}`}
            value={code}
            onChange={(e) => {
              setCode(normaliseCode(e.target.value))
              setError('')
            }}
            placeholder="XXXX-XXXX"
            autoComplete="off"
            autoCapitalize="characters"
            spellCheck={false}
            maxLength={9}
            aria-invalid={!!error}
            aria-describedby={`${id}-help`}
          />
          <AnimatePresence mode="wait">
            {error ? (
              <motion.p key="e" className="field-error on-dark" id={`${id}-help`} initial={{ opacity: 0, y: -4 }} animate={{ opacity: 1, y: 0, x: [0, -6, 6, -3, 0] }} exit={{ opacity: 0 }}>
                <AlertCircle size={14} aria-hidden="true" /> {error}
              </motion.p>
            ) : (
              <motion.p key="h" className="helper on-dark" id={`${id}-help`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                Letters and numbers, dash optional. Codes are not case sensitive.
              </motion.p>
            )}
          </AnimatePresence>
          <button className="btn btn-primary" type="submit" disabled={busy}>
            {busy ? (
              <>
                <span className="spinner" aria-hidden="true" /> Decrypting...
              </>
            ) : (
              <>
                <Unlock size={17} aria-hidden="true" /> Open ticket
              </>
            )}
          </button>
          <p className="fine on-dark">
            <ScanLine size={14} aria-hidden="true" /> Wrong codes are rate limited to stop guessing.
          </p>
        </motion.form>

        <div>
          <AnimatePresence mode="wait">
            {opened ? (
              <UnlockedPanel key={opened.ticket.id} opened={opened} />
            ) : (
              <motion.div key="empty" className="card panel" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <EmptyState icon={Inbox} title="Nothing opened yet">
                  Variables from a ticket appear here, masked until you reveal them.
                </EmptyState>
              </motion.div>
            )}
          </AnimatePresence>
          <ReceivedList />
        </div>
      </div>
    </>
  )
}

/** #/q/<id>/<key>: opened from a QR code or a copied secure link. */
export function OpenLink({ id, ticketKey }) {
  const { actions } = useStore()
  const [opened, setOpened] = useState(null)
  const [error, setError] = useState('')
  const started = useRef(false)

  useEffect(() => {
    if (started.current) return
    started.current = true
    // Drop the key from the address bar and history as soon as it has been read.
    window.history.replaceState(null, '', `${window.location.pathname}#/q/${id}`)
    actions
      .openByLink(id, ticketKey)
      .then(setOpened)
      .catch((err) => setError(messageOf(err)))
  }, [actions, id, ticketKey])

  return (
    <>
      <PageHeader eyebrow="Received" title="Secure link" sub="This ticket was shared with you as a QR code or link." />
      {opened ? (
        <UnlockedPanel opened={opened} />
      ) : error ? (
        <div className="card panel">
          <EmptyState
            icon={AlertCircle}
            title="Could not open this ticket"
            action={
              <button className="btn btn-ghost" onClick={() => go('/open')}>
                Enter a code instead
              </button>
            }
          >
            {error}
          </EmptyState>
        </div>
      ) : (
        <div className="loading-block" role="status">
          <span className="spinner" aria-hidden="true" /> Decrypting on this device...
        </div>
      )}
    </>
  )
}
