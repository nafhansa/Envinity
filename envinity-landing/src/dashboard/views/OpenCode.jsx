import { useId, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, Copy, Download, Inbox, KeyRound, ScanLine, Unlock } from 'lucide-react'
import { fmtAgo, normaliseCode, toEnvText } from '../data'
import { useStore } from '../store'
import { EmptyState, ExpiryMeter, PageHeader, SecretRow, ease } from '../ui'
import { downloadEnv } from './TicketDetail'

export default function OpenCode() {
  const { state, actions, lookupCode } = useStore()
  const [code, setCode] = useState('')
  const [error, setError] = useState('')
  const [openedCode, setOpenedCode] = useState(null)
  const id = useId()

  const submit = (e) => {
    e.preventDefault()
    if (code.length < 9) {
      setError('Enter all 8 characters of the code.')
      return
    }
    const res = lookupCode(code)
    if (res.ok) {
      setError('')
      setOpenedCode(code)
      setCode('')
    } else setError(res.error)
  }

  const opened = state.received.find((r) => r.code === openedCode)
  // Live copy (expiry may tick down while viewing)
  const live = opened && (state.inbox.find((x) => x.code === opened.code) || state.tickets.find((x) => x.code === opened.code))

  return (
    <>
      <PageHeader eyebrow="Received" title="Open a code" sub="Got a code from a teammate? Enter it here. In the mobile app you can scan the QR instead." />

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
            inputMode="text"
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
                Demo codes from your teammates: <button type="button" className="code-hint mono" onClick={() => setCode('4F7H-2KQM')}>4F7H-2KQM</button>{' '}
                <button type="button" className="code-hint mono" onClick={() => setCode('Q9WN-6RTB')}>Q9WN-6RTB</button>
              </motion.p>
            )}
          </AnimatePresence>
          <button className="btn btn-primary" type="submit">
            <Unlock size={17} aria-hidden="true" /> Open ticket
          </button>
          <p className="fine on-dark">
            <ScanLine size={14} aria-hidden="true" /> QR scanning is available in the Android and iOS apps.
          </p>
        </motion.form>

        <div>
          <AnimatePresence mode="wait">
            {opened && live ? (
              <motion.section
                key={opened.code}
                className="card panel"
                initial={{ opacity: 0, y: 20, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0 }}
                transition={{ ease, duration: 0.45 }}
                aria-labelledby="opened-title"
              >
                <div className="panel-head">
                  <div>
                    <div className="eyebrow">From {opened.from}</div>
                    <h2 id="opened-title">
                      {opened.name} <span className="env-tag">{opened.environment}</span>
                    </h2>
                  </div>
                  <ExpiryMeter ticket={live} compact />
                </div>
                {live.vars.length ? (
                  <>
                    <div className="secrets">
                      {live.vars.map((v, i) => (
                        <SecretRow key={v.key} k={v.key} v={v.value} index={i} />
                      ))}
                    </div>
                    <div className="share-actions" style={{ marginTop: 16 }}>
                      <button className="btn btn-primary" onClick={() => actions.copy(toEnvText(live.vars), 'All variables copied')}>
                        <Copy size={16} aria-hidden="true" /> Copy all
                      </button>
                      <button className="btn btn-ghost" onClick={() => downloadEnv(live.vars)}>
                        <Download size={16} aria-hidden="true" /> Save .env
                      </button>
                    </div>
                  </>
                ) : (
                  <p className="muted-note">This ticket expired while you were viewing it. Its data is gone.</p>
                )}
              </motion.section>
            ) : (
              <motion.div key="empty" className="card panel" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <EmptyState icon={Inbox} title="Nothing opened yet">
                  Variables from a ticket appear here, masked until you reveal them.
                </EmptyState>
              </motion.div>
            )}
          </AnimatePresence>

          {state.received.length > 0 && (
            <section className="card panel" style={{ marginTop: 16 }} aria-labelledby="hist-title">
              <div className="panel-head">
                <h2 id="hist-title">Opened this session</h2>
              </div>
              <ul className="activity">
                {state.received.map((r) => (
                  <li key={r.code}>
                    <span className="avatar-sm">{r.from[0]}</span>
                    <button className="act-text link-plain" onClick={() => setOpenedCode(r.code)}>
                      {r.name} / {r.environment} from {r.from}
                    </button>
                    <span className="act-time">{fmtAgo(r.openedAt, state.now)}</span>
                  </li>
                ))}
              </ul>
            </section>
          )}
        </div>
      </div>
    </>
  )
}
