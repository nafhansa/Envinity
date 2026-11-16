import { useEffect, useId, useRef, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { AlertCircle, ArrowLeft, KeyRound, Lock, LogOut, ShieldCheck, Smartphone } from 'lucide-react'
import { Logo } from '../components/shared'
import { ApiError } from './api'
import { useStore } from './store'
import { ease } from './ui'

function Shell({ children, eyebrow, title, sub }) {
  return (
    <div className="auth-wrap">
      <aside className="auth-brand dark">
        <a href="/" className="brand" aria-label="Envinity home">
          <Logo size={36} /> Envinity
        </a>
        <div>
          <div className="label">Powered by Securinity</div>
          <h2>
            Your .env, <span className="grad">sealed.</span>
          </h2>
          <ul className="auth-points">
            <li>
              <Lock size={16} aria-hidden="true" /> Encrypted on your device before it leaves
            </li>
            <li>
              <KeyRound size={16} aria-hidden="true" /> We never see your password or your secrets
            </li>
            <li>
              <ShieldCheck size={16} aria-hidden="true" /> Two-factor sign-in with any authenticator app
            </li>
          </ul>
        </div>
        <p className="fine on-dark">Zero-knowledge by design.</p>
      </aside>
      <main className="auth-main">
        <motion.div
          className="auth-card"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease }}
        >
          <div className="mobile-only auth-mobile-brand">
            <Logo size={32} /> Envinity
          </div>
          {eyebrow && <div className="eyebrow">{eyebrow}</div>}
          <h1>{title}</h1>
          {sub && <p className="auth-sub">{sub}</p>}
          {children}
        </motion.div>
      </main>
    </div>
  )
}

function Field({ label, error, hint, ...props }) {
  const id = useId()
  return (
    <div className="field-group">
      <label htmlFor={id}>{label}</label>
      <input id={id} aria-invalid={!!error} aria-describedby={error || hint ? `${id}-d` : undefined} {...props} />
      {error ? (
        <p className="field-error" id={`${id}-d`}>
          <AlertCircle size={14} aria-hidden="true" /> {error}
        </p>
      ) : (
        hint && (
          <p className="helper" id={`${id}-d`}>
            {hint}
          </p>
        )
      )}
    </div>
  )
}

function FormError({ error }) {
  return (
    <AnimatePresence>
      {error && (
        <motion.div className="form-error" role="alert" initial={{ opacity: 0, y: -6 }} animate={{ opacity: 1, y: 0, x: [0, -6, 6, -3, 0] }} exit={{ opacity: 0 }}>
          <AlertCircle size={16} aria-hidden="true" /> {error}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

const messageOf = (err) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.')

function Busy({ busy, idle, working }) {
  return busy ? (
    <>
      <span className="spinner" aria-hidden="true" /> {working}
    </>
  ) : (
    idle
  )
}

export function SignIn() {
  const { auth } = useStore()
  const [mode, setMode] = useState('signin')
  const [form, setForm] = useState({ name: '', email: '', password: '', confirm: '' })
  const [errors, setErrors] = useState({})
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }))

  const validate = () => {
    const e = {}
    if (!/^\S+@\S+\.\S+$/.test(form.email)) e.email = 'Enter a valid email address.'
    if (mode === 'register') {
      if (!form.name.trim()) e.name = 'Tell us your name.'
      if (form.password.length < 12) e.password = 'Use at least 12 characters. A passphrase works well.'
      else if (form.confirm !== form.password) e.confirm = 'Passwords do not match.'
    } else if (!form.password) e.password = 'Enter your password.'
    setErrors(e)
    return Object.keys(e).length === 0
  }

  const submit = async (ev) => {
    ev.preventDefault()
    setError('')
    if (!validate()) return
    setBusy(true)
    try {
      if (mode === 'register') await auth.register({ email: form.email.trim(), name: form.name.trim(), password: form.password })
      else await auth.login({ email: form.email.trim(), password: form.password })
    } catch (err) {
      setError(messageOf(err))
      setBusy(false)
    }
  }

  const register = mode === 'register'
  return (
    <Shell
      eyebrow={register ? 'Create account' : 'Welcome back'}
      title={register ? 'Start sharing safely' : 'Sign in to Envinity'}
      sub={register ? 'Free forever for 10-minute tickets. No credit card.' : 'Your vault unlocks on this device with your password.'}
    >
      <div className="seg-tabs auth-tabs" role="tablist" aria-label="Account">
        {[
          ['signin', 'Sign in'],
          ['register', 'Create account'],
        ].map(([k, l]) => (
          <button
            key={k}
            role="tab"
            aria-selected={mode === k}
            className={mode === k ? 'on' : ''}
            onClick={() => {
              setMode(k)
              setErrors({})
              setError('')
            }}
          >
            {mode === k && <motion.span layoutId="auth-tab" className="seg-pill" />}
            <span>{l}</span>
          </button>
        ))}
      </div>
      <form className="auth-form" onSubmit={submit} noValidate>
        <FormError error={error} />
        {register && <Field label="Name" value={form.name} onChange={set('name')} error={errors.name} autoComplete="name" />}
        <Field label="Email" type="email" value={form.email} onChange={set('email')} error={errors.email} autoComplete="email" inputMode="email" />
        <Field
          label="Password"
          type="password"
          value={form.password}
          onChange={set('password')}
          error={errors.password}
          autoComplete={register ? 'new-password' : 'current-password'}
          hint={register ? 'At least 12 characters.' : undefined}
        />
        {register && (
          <Field label="Confirm password" type="password" value={form.confirm} onChange={set('confirm')} error={errors.confirm} autoComplete="new-password" />
        )}
        {register && (
          <p className="notice">
            <KeyRound size={16} aria-hidden="true" />
            <span>
              Envinity never receives your password, it only derives your encryption keys from it. If you forget it, tickets you own cannot be
              recovered.
            </span>
          </p>
        )}
        <button className="btn btn-primary" type="submit" disabled={busy}>
          <Busy busy={busy} idle={register ? 'Create account' : 'Sign in'} working="Deriving keys..." />
        </button>
      </form>
    </Shell>
  )
}

export function MfaChallenge() {
  const { auth, state } = useStore()
  const [useRecovery, setUseRecovery] = useState(false)
  const [value, setValue] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)
  const id = useId()

  useEffect(() => inputRef.current?.focus(), [useRecovery])

  const submit = async (ev) => {
    ev?.preventDefault()
    setError('')
    const clean = useRecovery ? value.trim() : value.replace(/\D/g, '')
    if (!useRecovery && clean.length !== 6) {
      setError('Enter the 6-digit code from your authenticator app.')
      return
    }
    setBusy(true)
    try {
      await auth.verify2fa(useRecovery ? { recoveryCode: clean } : { code: clean })
    } catch (err) {
      setError(messageOf(err))
      setValue('')
      setBusy(false)
      if (err instanceof ApiError && /expired|again/i.test(err.message) && !/left/.test(err.message)) {
        setTimeout(() => auth.cancelMfa(), 1600)
      }
    }
  }

  // Auto-submit once 6 digits are typed (or pasted).
  const onChange = (e) => {
    const v = useRecovery ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, '').slice(0, 6)
    setValue(v)
    setError('')
  }
  useEffect(() => {
    if (!useRecovery && value.length === 6 && !busy) submit()
  }, [value]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <Shell eyebrow="Two-factor authentication" title="Confirm it's you" sub={`Signing in as ${state.mfa?.email}.`}>
      <form className="auth-form" onSubmit={submit} noValidate>
        <div className="mfa-icon" aria-hidden="true">
          {useRecovery ? <KeyRound size={26} /> : <Smartphone size={26} />}
        </div>
        <FormError error={error} />
        <div className="field-group">
          <label htmlFor={id}>{useRecovery ? 'Recovery code' : '6-digit code from your authenticator app'}</label>
          <input
            ref={inputRef}
            id={id}
            className={`mono otp-input ${useRecovery ? 'recovery' : ''}`}
            value={value}
            onChange={onChange}
            inputMode={useRecovery ? 'text' : 'numeric'}
            autoComplete="one-time-code"
            placeholder={useRecovery ? 'XXXX-XXXX-XXXX' : '000000'}
            maxLength={useRecovery ? 16 : 6}
            aria-invalid={!!error}
          />
        </div>
        <button className="btn btn-primary" type="submit" disabled={busy}>
          <Busy busy={busy} idle="Verify" working="Verifying..." />
        </button>
        <div className="auth-links">
          <button
            type="button"
            className="link-btn"
            onClick={() => {
              setUseRecovery((v) => !v)
              setValue('')
              setError('')
            }}
          >
            {useRecovery ? 'Use the authenticator app instead' : 'Lost your phone? Use a recovery code'}
          </button>
          <button type="button" className="link-btn muted-link" onClick={auth.cancelMfa}>
            <ArrowLeft size={14} aria-hidden="true" /> Back to sign in
          </button>
        </div>
      </form>
    </Shell>
  )
}

export function Unlock() {
  const { auth, state } = useStore()
  const [password, setPassword] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const submit = async (ev) => {
    ev.preventDefault()
    if (!password) {
      setError('Enter your password.')
      return
    }
    setBusy(true)
    setError('')
    try {
      await auth.unlock(password)
    } catch (err) {
      setError(messageOf(err))
      setBusy(false)
    }
  }

  return (
    <Shell
      eyebrow="Vault locked"
      title={`Welcome back, ${state.session?.user.name.split(' ')[0]}`}
      sub="Your encryption key is never stored. Enter your password to unlock your vault on this device."
    >
      <form className="auth-form" onSubmit={submit} noValidate>
        <FormError error={error} />
        <Field label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
        <button className="btn btn-primary" type="submit" disabled={busy}>
          <Busy busy={busy} idle={<><Lock size={16} aria-hidden="true" /> Unlock vault</>} working="Unlocking..." />
        </button>
        <div className="auth-links">
          <button type="button" className="link-btn muted-link" onClick={auth.logout}>
            <LogOut size={14} aria-hidden="true" /> Sign out ({state.session?.user.email})
          </button>
        </div>
      </form>
    </Shell>
  )
}

export function Loading() {
  return (
    <div className="auth-loading" role="status">
      <Logo size={48} />
      <span className="sr-only">Loading</span>
    </div>
  )
}
