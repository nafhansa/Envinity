import { useState } from 'react'
import { motion } from 'framer-motion'
import { Check, Crown, Timer } from 'lucide-react'
import { USER } from '../data'
import { useStore } from '../store'
import { Modal, PageHeader, ease } from '../ui'

const PLANS = [
  {
    id: 'free',
    name: 'Free',
    price: '$0',
    Icon: Timer,
    points: ['Unlimited tickets', 'QR and unique code sharing', 'Tickets self-destruct after 10 minutes'],
  },
  {
    id: 'pro',
    name: 'Pro',
    price: '$8 / user / month',
    Icon: Crown,
    points: ['Keep tickets until you delete them', 'Revoke access any time', 'Access log for every ticket'],
  },
]

export default function Settings() {
  const { state, actions } = useStore()
  const [confirmFree, setConfirmFree] = useState(false)
  const [autoLock, setAutoLock] = useState('5')
  const [clearClipboard, setClearClipboard] = useState(true)
  const kept = state.tickets.filter((t) => t.expiresAt === null && !t.destroyed).length

  const choose = (id) => {
    if (id === state.plan) return
    if (id === 'free' && kept > 0) setConfirmFree(true)
    else {
      actions.setPlan(id)
      actions.toast(id === 'pro' ? 'You are on Pro now' : 'You are on Free now')
    }
  }

  return (
    <>
      <PageHeader eyebrow="Account" title="Settings" sub="This is a demo workspace. Data lives in memory and resets when you reload." />

      <div className="settings-grid">
        <motion.section className="card panel" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ease, duration: 0.5 }} aria-labelledby="profile-title">
          <h2 id="profile-title" className="panel-title">
            Profile
          </h2>
          <div className="profile">
            <span className="avatar-lg">{USER.initials}</span>
            <div>
              <strong>{USER.name}</strong>
              <div className="muted">{USER.email}</div>
              <div className="muted">{USER.team}</div>
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
          <p className="helper">Billing is not connected in this demo. Switching plans only changes how new and kept tickets expire.</p>
        </motion.section>

        <motion.section className="card panel" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ ease, duration: 0.5, delay: 0.12 }} aria-labelledby="sec-title">
          <h2 id="sec-title" className="panel-title">
            Security
          </h2>
          <div className="field-group">
            <label htmlFor="autolock">Auto-lock the app after</label>
            <select id="autolock" value={autoLock} onChange={(e) => setAutoLock(e.target.value)}>
              <option value="1">1 minute</option>
              <option value="5">5 minutes</option>
              <option value="15">15 minutes</option>
            </select>
          </div>
          <label className="toggle">
            <input type="checkbox" checked={clearClipboard} onChange={(e) => setClearClipboard(e.target.checked)} />
            <span className="toggle-ui" aria-hidden="true" />
            <span>
              <strong>Clear clipboard after 30 seconds</strong>
              <small>Copied secrets do not linger after you paste them.</small>
            </span>
          </label>
        </motion.section>
      </div>

      <Modal
        open={confirmFree}
        onClose={() => setConfirmFree(false)}
        title="Switch to Free?"
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => setConfirmFree(false)}>
              Stay on Pro
            </button>
            <button
              className="btn btn-danger"
              onClick={() => {
                actions.setPlan('free')
                setConfirmFree(false)
                actions.toast('You are on Free now')
              }}
            >
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
