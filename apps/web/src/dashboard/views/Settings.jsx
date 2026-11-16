import { useId, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { QRCodeSVG } from 'qrcode.react'
import { AlertCircle, Check, Copy, Crown, Download, KeyRound, ShieldCheck, ShieldOff, Smartphone, Timer } from 'lucide-react'
import { api, ApiError } from '../api'
import { useStore } from '../store'
import { Modal, PageHeader, ease } from '../ui'

const PLANS = [
  { id: 'free', name: 'Free', price: '$0', Icon: Timer, points: ['Unlimited tickets', 'QR and unique code sharing', 'Tickets self-destruct after 10 minutes'] },
  { id: 'pro', name: 'Pro', price: '$8 / user / month', Icon: Crown, points: ['Keep tickets until you delete them', 'Revoke access any time', 'Access log for every ticket'] },
]

const messageOf = (err) => (err instanceof ApiError ? err.message : 'Something went wrong. Try again.')

function InlineField({ label, ...props }) {
  const id = useId()
  return (
    <div className="field-group">
      <label htmlFor={id}>{label}</label>
      <input id={id} {...props} />
    </div>
  )
}

function ErrorLine({ error }) {
  return error ? (
    <p className="field-error" role="alert">
      <AlertCircle size={14} aria-hidden="true" /> {error}
    </p>
  ) : null
}

function RecoveryCodes({ codes, onDone }) {
  const { actions } = useStore()
  const text = `Envinity recovery codes\nEach code works once. Keep them somewhere safe and offline.\n\n${codes.join('\n')}\n`
  const download = () => {
    const url = URL.createObjectURL(new Blob([text], { type: 'text/plain' }))
    Object.assign(document.createElement('a'), { href: url, download: 'envinity-recovery-codes.txt' }).click()
    URL.revokeObjectURL(url)
  }
  return (
    <div className="mfa-step">
      <p className="modal-body">
        Save these codes. If you lose your phone, each one signs you in once. <strong>This is the only time they are shown.</strong>
      </p>
      <ul className="recovery-grid mono" aria-label="Recovery codes">
        {codes.map((c, i) => (
          <motion.li key={c} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: i * 0.03 }}>
            {c}
          </motion.li>
        ))}
      </ul>
      <div className="share-actions" style={{ justifyContent: 'flex-start' }}>
        <button className="btn btn-ghost" onClick={() => actions.copy(codes.join('\n'), 'Recovery codes copied')}>
          <Copy size={16} aria-hidden="true" /> Copy
        </button>
        <button className="btn btn-ghost" onClick={download}>
          <Download size={16} aria-hidden="true" /> Download .txt
        </button>
        <button className="btn btn-primary" onClick={onDone}>
          <Check size={16} aria-hidden="true" /> I saved them
        </button>
      </div>
    </div>
  )
}

/** Password -> scan QR -> confirm a code -> recovery codes. */
function EnableTwoFactor({ open, onClose }) {
  const { auth, actions } = useStore()
  const [step, setStep] = useState('password')
  const [password, setPassword] = useState('')
  const [setup, setSetup] = useState(null)
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)

  const close = () => {
    setStep('password')
    setPassword('')
    setSetup(null)
    setCode('')
    setCodes(null)
    setError('')
    onClose()
  }

  const start = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const authKey = await auth.authKeyFor(password)
      setSetup(await api.post('/auth/2fa/setup', { authKey }))
      setPassword('')
      setStep('scan')
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  const confirm = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await api.post('/auth/2fa/enable', { code: code.replace(/\D/g, '') })
      auth.setSession(res.session)
      setCodes(res.recoveryCodes)
      setStep('codes')
      actions.refresh()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }

  const titles = { password: 'Turn on two-factor authentication', scan: 'Scan with your authenticator app', codes: 'Save your recovery codes' }
  return (
    <Modal open={open} onClose={step === 'codes' ? () => {} : close} title={titles[step]}>
      <AnimatePresence mode="wait">
        <motion.div key={step} initial={{ opacity: 0, x: 16 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0, x: -16 }} transition={{ duration: 0.2 }}>
          {step === 'password' && (
            <form className="mfa-step" onSubmit={start}>
              <p className="modal-body">Confirm your password first, so nobody with access to an open session can enrol their own phone.</p>
              <InlineField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
              <ErrorLine error={error} />
              <button className="btn btn-primary" disabled={busy || !password}>
                {busy ? <span className="spinner" aria-hidden="true" /> : null} Continue
              </button>
            </form>
          )}
          {step === 'scan' && setup && (
            <form className="mfa-step" onSubmit={confirm}>
              <p className="modal-body">Use Google Authenticator, Authy, 1Password or any TOTP app. Then type the 6-digit code it shows.</p>
              <div className="totp-setup">
                <div className="qr-box">
                  <QRCodeSVG value={setup.otpauthUri} size={168} level="M" fgColor="#201e1d" bgColor="#ffffff" title="Authenticator setup QR code" />
                </div>
                <div className="totp-manual">
                  <span className="label">Can't scan? Enter this key</span>
                  <code className="mono secret-key-box">{setup.secret.match(/.{1,4}/g).join(' ')}</code>
                  <button type="button" className="link-btn" onClick={() => actions.copy(setup.secret, 'Setup key copied')}>
                    <Copy size={14} aria-hidden="true" /> Copy key
                  </button>
                </div>
              </div>
              <InlineField
                label="6-digit code"
                className="mono otp-input"
                value={code}
                onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                inputMode="numeric"
                autoComplete="one-time-code"
                placeholder="000000"
                autoFocus
              />
              <ErrorLine error={error} />
              <button className="btn btn-primary" disabled={busy || code.length !== 6}>
                {busy ? <span className="spinner" aria-hidden="true" /> : <ShieldCheck size={16} aria-hidden="true" />} Turn on 2FA
              </button>
            </form>
          )}
          {step === 'codes' && codes && (
            <RecoveryCodes
              codes={codes}
              onDone={() => {
                actions.toast('Two-factor authentication is on')
                close()
              }}
            />
          )}
        </motion.div>
      </AnimatePresence>
    </Modal>
  )
}

function DisableTwoFactor({ open, onClose }) {
  const { auth, actions } = useStore()
  const [password, setPassword] = useState('')
  const [value, setValue] = useState('')
  const [useRecovery, setUseRecovery] = useState(false)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const close = () => {
    setPassword('')
    setValue('')
    setError('')
    onClose()
  }
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const authKey = await auth.authKeyFor(password)
      const factor = useRecovery ? { recoveryCode: value.trim() } : { code: value.replace(/\D/g, '') }
      auth.setSession(await api.post('/auth/2fa/disable', { authKey, ...factor }))
      actions.toast('Two-factor authentication is off')
      actions.refresh()
      close()
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onClose={close} title="Turn off two-factor authentication?">
      <form className="mfa-step" onSubmit={submit}>
        <p className="modal-body">Your account will be protected by your password only. Other signed-in devices will be signed out.</p>
        <InlineField label="Password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" autoFocus />
        <InlineField
          label={useRecovery ? 'Recovery code' : '6-digit code'}
          className="mono"
          value={value}
          onChange={(e) => setValue(useRecovery ? e.target.value.toUpperCase() : e.target.value.replace(/\D/g, '').slice(0, 6))}
          inputMode={useRecovery ? 'text' : 'numeric'}
          autoComplete="one-time-code"
        />
        <button type="button" className="link-btn" style={{ alignSelf: 'flex-start' }} onClick={() => (setUseRecovery((v) => !v), setValue(''))}>
          {useRecovery ? 'Use the authenticator app' : 'Use a recovery code instead'}
        </button>
        <ErrorLine error={error} />
        <div className="modal-actions">
          <button type="button" className="btn btn-ghost" onClick={close}>
            Cancel
          </button>
          <button className="btn btn-danger" disabled={busy || !password || !value}>
            Turn off 2FA
          </button>
        </div>
      </form>
    </Modal>
  )
}

function RegenerateCodes({ open, onClose }) {
  const { auth } = useStore()
  const [code, setCode] = useState('')
  const [codes, setCodes] = useState(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const close = () => {
    setCode('')
    setCodes(null)
    setError('')
    onClose()
  }
  const submit = async (e) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    try {
      const res = await api.post('/auth/2fa/recovery-codes', { code })
      setCodes(res.recoveryCodes)
      auth.setSession((s) => ({ ...s, twoFactor: { ...s.twoFactor, recoveryCodesRemaining: res.recoveryCodes.length } }))
    } catch (err) {
      setError(messageOf(err))
    } finally {
      setBusy(false)
    }
  }
  return (
    <Modal open={open} onClose={codes ? () => {} : close} title={codes ? 'Your new recovery codes' : 'Generate new recovery codes'}>
      {codes ? (
        <RecoveryCodes codes={codes} onDone={close} />
      ) : (
        <form className="mfa-step" onSubmit={submit}>
          <p className="modal-body">Your old recovery codes stop working as soon as new ones are generated.</p>
          <InlineField
            label="6-digit code"
            className="mono otp-input"
            value={code}
            onChange={(e) => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            inputMode="numeric"
            autoComplete="one-time-code"
            autoFocus
          />
          <ErrorLine error={error} />
          <button className="btn btn-primary" disabled={busy || code.length !== 6}>
            Generate new codes
          </button>
        </form>
      )}
    </Modal>
  )
}

export default function Settings() {
  const { state, actions } = useStore()
  const { session } = state
  const [confirmFree, setConfirmFree] = useState(false)
  const [modal, setModal] = useState(null) // 'enable' | 'disable' | 'codes'
  const kept = state.tickets.filter((t) => t.expiresAt === null && t.status === 'active').length
  const tf = session.twoFactor

  const choose = async (id, confirmed = false) => {
    if (id === state.plan) return
    if (id === 'free' && kept > 0 && !confirmed) {
      setConfirmFree(true)
      return
    }
    try {
      await actions.setPlan(id)
      actions.toast(id === 'pro' ? 'You are on Pro now' : 'You are on Free now')
    } catch (err) {
      actions.toast(messageOf(err))
    }
    setConfirmFree(false)
  }

  return (
    <>
      <PageHeader eyebrow="Account" title="Settings" sub="Your profile, plan and sign-in security." />

      <div className="settings-grid">
        <motion.section className="card panel" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ease, duration: 0.5 }} aria-labelledby="profile-title">
          <h2 id="profile-title" className="panel-title">
            Profile
          </h2>
          <div className="profile">
            <span className="avatar-lg">{session.user.name.slice(0, 1).toUpperCase()}</span>
            <div>
              <strong>{session.user.name}</strong>
              <div className="muted">{session.user.email}</div>
              <div className="muted">{session.tenant.name}</div>
            </div>
          </div>
        </motion.section>

        <motion.section className="card panel" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ease, duration: 0.5, delay: 0.06 }} aria-labelledby="plan-title">
          <h2 id="plan-title" className="panel-title">
            Plan
          </h2>
          <div className="plan-options" role="radiogroup" aria-label="Plan">
            {PLANS.map((p) => {
              const on = state.plan === p.id
              return (
                <button key={p.id} role="radio" aria-checked={on} className={`plan-option ${on ? 'on' : ''}`} onClick={() => choose(p.id)}>
                  <span className="plan-option-head">
                    <p.Icon size={18} aria-hidden="true" />
                    <strong>{p.name}</strong>
                    <span className="muted">{p.price}</span>
                    {on && <span className="badge ok">Current</span>}
                  </span>
                  <ul>
                    {p.points.map((pt) => (
                      <li key={pt}>
                        <Check size={14} aria-hidden="true" /> {pt}
                      </li>
                    ))}
                  </ul>
                </button>
              )
            })}
          </div>
          <p className="helper">Billing is not connected yet. In development you can switch plans here directly.</p>
        </motion.section>

        <motion.section className="card panel" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ease, duration: 0.5, delay: 0.12 }} aria-labelledby="sec-title">
          <div className="panel-head" style={{ marginBottom: 8 }}>
            <h2 id="sec-title">Two-factor authentication</h2>
            <span className={`badge ${tf.enabled ? 'ok' : 'warn'}`}>{tf.enabled ? 'On' : 'Off'}</span>
          </div>
          <div className={`mfa-status ${tf.enabled ? 'on' : ''}`}>
            {tf.enabled ? <ShieldCheck size={22} aria-hidden="true" /> : <Smartphone size={22} aria-hidden="true" />}
            <p>
              {tf.enabled
                ? 'Signing in needs your password and a code from your authenticator app.'
                : 'Add a second step to sign-in with an authenticator app. A stolen password alone will no longer open your vault.'}
            </p>
          </div>
          {tf.enabled ? (
            <>
              <div className="danger-row">
                <div>
                  <strong>Recovery codes</strong>
                  <p>
                    {tf.recoveryCodesRemaining} of 10 left.{tf.recoveryCodesRemaining <= 3 ? ' Generate new ones soon.' : ''}
                  </p>
                </div>
                <button className="btn btn-ghost" onClick={() => setModal('codes')}>
                  <KeyRound size={16} aria-hidden="true" /> New codes
                </button>
              </div>
              <div className="danger-row">
                <div>
                  <strong>Turn off 2FA</strong>
                  <p>Requires your password and a code.</p>
                </div>
                <button className="btn btn-ghost" onClick={() => setModal('disable')}>
                  <ShieldOff size={16} aria-hidden="true" /> Turn off
                </button>
              </div>
            </>
          ) : (
            <button className="btn btn-primary" onClick={() => setModal('enable')}>
              <ShieldCheck size={16} aria-hidden="true" /> Turn on 2FA
            </button>
          )}
        </motion.section>
      </div>

      <EnableTwoFactor open={modal === 'enable'} onClose={() => setModal(null)} />
      <DisableTwoFactor open={modal === 'disable'} onClose={() => setModal(null)} />
      <RegenerateCodes open={modal === 'codes'} onClose={() => setModal(null)} />
      <Modal
        open={confirmFree}
        onClose={() => setConfirmFree(false)}
        title="Switch to Free?"
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => setConfirmFree(false)}>
              Stay on Pro
            </button>
            <button className="btn btn-danger" onClick={() => choose('free', true)}>
              Switch to Free
            </button>
          </>
        }
      >
        You have {kept} kept {kept === 1 ? 'ticket' : 'tickets'}. On Free, {kept === 1 ? 'it' : 'they'} will self-destruct 10 minutes after you switch.
      </Modal>
    </>
  )
}
