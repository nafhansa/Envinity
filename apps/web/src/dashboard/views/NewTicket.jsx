import { useId, useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, FileUp, Infinity as InfinityIcon, Lock, Sparkles, Timer } from 'lucide-react'
import { ENVIRONMENTS, SAMPLE_ENV, parseEnv } from '../data'
import { ApiError } from '../api'
import { go, useStore } from '../store'
import { PageHeader, ease } from '../ui'

export default function NewTicket() {
  const { state, actions } = useStore()
  const pro = state.plan === 'pro'
  const [name, setName] = useState('')
  const [environment, setEnvironment] = useState('staging')
  const [text, setText] = useState('')
  const [oneTime, setOneTime] = useState(false)
  const [keepForever, setKeepForever] = useState(true)
  const [touched, setTouched] = useState(false)
  const [sealing, setSealing] = useState(false)
  const [submitError, setSubmitError] = useState('')
  const fileRef = useRef(null)
  const ids = { name: useId(), env: useId(), text: useId(), err: useId() }

  const parsed = useMemo(() => parseEnv(text), [text])
  const nameError = touched && !name.trim() ? 'Give the ticket a name, like acme-api.' : ''
  const envError =
    touched && parsed.vars.length === 0 && parsed.errors.length === 0 ? 'Paste or upload a .env with at least one variable.' : ''
  const canSubmit = name.trim() && parsed.vars.length > 0 && parsed.errors.length === 0

  const onFile = (e) => {
    const f = e.target.files?.[0]
    if (!f) return
    if (f.size > 64 * 1024) {
      actions.toast('That file is larger than 64 KB. Is it really a .env?')
      return
    }
    f.text().then((t) => {
      setText(t)
      if (!name) setName(f.name.replace(/^\.env\.?/, '') || 'my-project')
    })
    e.target.value = ''
  }

  const submit = async (e) => {
    e.preventDefault()
    setTouched(true)
    if (!canSubmit) return
    setSealing(true)
    setSubmitError('')
    try {
      // Encrypts in this browser (crypto.js), then uploads only ciphertext and wrapped keys.
      const id = await actions.createTicket({ name: name.trim(), environment, vars: parsed.vars, oneTime, keepForever: pro && keepForever })
      actions.toast('Ticket created. Share the QR or the code.')
      go(`/tickets/${id}`)
    } catch (err) {
      setSubmitError(err instanceof ApiError ? err.message : 'Could not create the ticket. Try again.')
      setSealing(false)
    }
  }

  return (
    <>
      <PageHeader eyebrow="New ticket" title="Seal a .env" sub="Your file is encrypted on this device first. The server only ever stores ciphertext." />

      <form className="new-grid" onSubmit={submit} noValidate>
        <motion.div className="card panel form-panel" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ease, duration: 0.5 }}>
          <div className="form-row">
            <div className="field-group">
              <label htmlFor={ids.name}>Ticket name</label>
              <input
                id={ids.name}
                value={name}
                onChange={(e) => setName(e.target.value)}
                onBlur={() => setTouched(true)}
                placeholder="acme-api"
                aria-invalid={!!nameError}
                aria-describedby={nameError ? `${ids.name}-e` : undefined}
                autoComplete="off"
              />
              {nameError && (
                <p className="field-error" id={`${ids.name}-e`}>
                  {nameError}
                </p>
              )}
            </div>
            <div className="field-group">
              <label htmlFor={ids.env}>Environment</label>
              <select id={ids.env} value={environment} onChange={(e) => setEnvironment(e.target.value)}>
                {ENVIRONMENTS.map((x) => (
                  <option key={x}>{x}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="field-group">
            <div className="label-row">
              <label htmlFor={ids.text}>.env contents</label>
              <div style={{ display: 'flex', gap: 4 }}>
                <button type="button" className="link-btn" onClick={() => setText(SAMPLE_ENV)}>
                  Use sample
                </button>
                <button type="button" className="link-btn" onClick={() => fileRef.current?.click()}>
                  <FileUp size={15} aria-hidden="true" /> Upload file
                </button>
              </div>
              <input ref={fileRef} type="file" accept=".env,text/plain" hidden onChange={onFile} />
            </div>
            <textarea
              id={ids.text}
              className="mono"
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={'DATABASE_URL=postgres://...\nSTRIPE_SECRET_KEY=sk_test_...'}
              rows={10}
              spellCheck={false}
              autoComplete="off"
              aria-invalid={parsed.errors.length > 0 || !!envError}
              aria-describedby={ids.err}
            />
            <p className="helper">One KEY=VALUE per line. Keys use UPPER_SNAKE_CASE. Lines starting with # are ignored.</p>
            <div id={ids.err} aria-live="polite">
              {envError && <p className="field-error">{envError}</p>}
              {parsed.errors.map((er) => (
                <p className="field-error" key={er.line}>
                  <AlertCircle size={14} aria-hidden="true" /> Line {er.line}: {er.message}
                </p>
              ))}
            </div>
          </div>
        </motion.div>

        <motion.aside
          className="side-stack"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ ease, duration: 0.5, delay: 0.08 }}
        >
          <div className="card panel">
            <h2 className="panel-title">Expiry</h2>
            {pro ? (
              <div className="radio-cards" role="radiogroup" aria-label="Expiry">
                <button type="button" role="radio" aria-checked={keepForever} className={keepForever ? 'on' : ''} onClick={() => setKeepForever(true)}>
                  <InfinityIcon size={18} aria-hidden="true" />
                  <span>
                    <strong>Until I delete it</strong>
                    <small>Pro. Reuse it for every new teammate.</small>
                  </span>
                </button>
                <button type="button" role="radio" aria-checked={!keepForever} className={!keepForever ? 'on' : ''} onClick={() => setKeepForever(false)}>
                  <Timer size={18} aria-hidden="true" />
                  <span>
                    <strong>10 minutes</strong>
                    <small>Self-destructs after it is generated.</small>
                  </span>
                </button>
              </div>
            ) : (
              <div className="free-note">
                <Timer size={18} aria-hidden="true" />
                <span>
                  <strong>Self-destructs in 10 minutes</strong>
                  <small>Free tickets are wiped 10 minutes after they are generated.</small>
                </span>
                <button type="button" className="link-btn" onClick={() => go('/settings')}>
                  <Sparkles size={14} aria-hidden="true" /> Keep forever with Pro
                </button>
              </div>
            )}
            <label className="toggle">
              <input type="checkbox" checked={oneTime} onChange={(e) => setOneTime(e.target.checked)} />
              <span className="toggle-ui" aria-hidden="true" />
              <span>
                <strong>One-time ticket</strong>
                <small>Locks itself after the first person opens it.</small>
              </span>
            </label>
          </div>

          <div className="card panel dark summary">
            <div className="label">Ready to seal</div>
            <div className="summary-count">
              <motion.span key={parsed.vars.length} initial={{ y: 10, opacity: 0 }} animate={{ y: 0, opacity: 1 }}>
                {parsed.vars.length}
              </motion.span>{' '}
              variables
            </div>
            <ul className="summary-keys mono">
              <AnimatePresence initial={false}>
                {parsed.vars.slice(0, 6).map((v) => (
                  <motion.li key={v.key} initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                    {v.key}
                  </motion.li>
                ))}
              </AnimatePresence>
              {parsed.vars.length > 6 && <li>+{parsed.vars.length - 6} more</li>}
            </ul>
            {submitError && (
              <p className="field-error on-dark" role="alert">
                <AlertCircle size={14} aria-hidden="true" /> {submitError}
              </p>
            )}
            <button className="btn btn-primary" type="submit" disabled={sealing} aria-disabled={!canSubmit}>
              {sealing ? (
                <>
                  <motion.span animate={{ rotate: [0, -12, 12, 0] }} transition={{ repeat: Infinity, duration: 0.6 }} style={{ display: 'grid' }}>
                    <Lock size={17} aria-hidden="true" />
                  </motion.span>
                  Encrypting on this device...
                </>
              ) : (
                <>
                  <Lock size={17} aria-hidden="true" /> Create ticket
                </>
              )}
            </button>
          </div>
        </motion.aside>
      </form>
    </>
  )
}
