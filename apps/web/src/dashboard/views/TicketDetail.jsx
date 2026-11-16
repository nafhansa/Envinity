import { useCallback, useEffect, useState } from 'react'
import { motion } from 'framer-motion'
import { QRCodeSVG } from 'qrcode.react'
import { ArrowLeft, Ban, Copy, Download, Flame, Link2, ShieldCheck, Trash2 } from 'lucide-react'
import { ApiError } from '../api'
import { fmtAgo, ticketStatus, toEnvText } from '../data'
import { go, useStore } from '../store'
import { EmptyState, ExpiryMeter, Modal, PageHeader, SecretRow, StatusBadge, ease } from '../ui'

export function downloadEnv(vars, filename = '.env') {
  const url = URL.createObjectURL(new Blob([toEnvText(vars)], { type: 'text/plain' }))
  const a = Object.assign(document.createElement('a'), { href: url, download: filename })
  a.click()
  URL.revokeObjectURL(url)
}

const STATUS_COPY = {
  expired: { title: 'Ticket expired', body: 'The 10 minute window ended and the encrypted payload was destroyed. Create a new ticket to share again.' },
  revoked: { title: 'Ticket revoked', body: 'You revoked this ticket. Its QR and code no longer open anything.' },
  used: { title: 'Already opened', body: 'This was a one-time ticket and it has been opened. It cannot be opened again.' },
}

export default function TicketDetail({ id }) {
  const { state, actions } = useStore()
  const [data, setData] = useState(null) // { ticket, vars, ticketKey, code }
  const [error, setError] = useState(null)
  const [confirm, setConfirm] = useState(null)
  const [busy, setBusy] = useState(false)

  const load = useCallback(() => {
    actions
      .getTicket(id)
      .then(setData)
      .catch((err) => setError(err instanceof ApiError ? err : new ApiError(0, 'decrypt', 'This ticket could not be decrypted on this device.')))
  }, [actions, id])

  useEffect(load, [load])

  if (error) {
    return (
      <EmptyState
        icon={Trash2}
        title={error.status === 404 ? 'This ticket no longer exists' : 'Could not open this ticket'}
        action={
          <button className="btn btn-ghost" onClick={() => go('/tickets')}>
            Back to tickets
          </button>
        }
      >
        {error.status === 404 ? 'It was deleted, or the link is wrong.' : error.message}
      </EmptyState>
    )
  }
  if (!data) {
    return (
      <div className="loading-block" role="status">
        <span className="spinner" aria-hidden="true" /> Decrypting on this device...
      </div>
    )
  }

  const { ticket: t, vars, ticketKey, code } = data
  const status = ticketStatus(t, state.now)
  const live = status === 'active' && ticketKey
  // The ticket key rides in the URL fragment: browsers never send it to any server.
  const shareUrl = ticketKey ? `${window.location.origin}/dashboard#/q/${t.id}/${ticketKey}` : ''

  const run = async (fn, done) => {
    setBusy(true)
    try {
      await fn()
      done?.()
    } catch (err) {
      actions.toast(err instanceof ApiError ? err.message : 'Something went wrong.')
    } finally {
      setBusy(false)
      setConfirm(null)
    }
  }

  return (
    <>
      <button className="link-btn back" onClick={() => go('/tickets')}>
        <ArrowLeft size={16} aria-hidden="true" /> All tickets
      </button>
      <PageHeader
        eyebrow={t.environment}
        title={t.name}
        sub={`Created ${fmtAgo(t.createdAt, state.now)} · ${t.varCount} variables${t.oneTime ? ' · One-time ticket' : ''}`}
      >
        <StatusBadge ticket={t} />
      </PageHeader>

      <div className="detail-grid">
        <motion.section
          className={`card share-card ${live ? 'dark' : ''}`}
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.5, ease }}
          aria-label="Share this ticket"
        >
          {live ? (
            <>
              <div className="label">Scan to open</div>
              <motion.div className="qr-box" initial={{ rotateY: 90, opacity: 0 }} animate={{ rotateY: 0, opacity: 1 }} transition={{ duration: 0.6, ease, delay: 0.1 }}>
                <QRCodeSVG value={shareUrl} size={196} level="M" fgColor="#201e1d" bgColor="#ffffff" title={`QR code for ${t.name}`} />
              </motion.div>
              {code && (
                <>
                  <div className="label">Or share the unique code</div>
                  <div className="big-code mono" aria-label={`Share code ${code.split('').join(' ')}`}>
                    {code.split('').map((c, i) => (
                      <motion.span key={i} initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.3 + i * 0.04 }} className={c === '-' ? 'dash' : ''}>
                        {c}
                      </motion.span>
                    ))}
                  </div>
                </>
              )}
              <div className="share-actions">
                {code && (
                  <button className="btn btn-primary" onClick={() => actions.copy(code, 'Code copied')}>
                    <Copy size={16} aria-hidden="true" /> Copy code
                  </button>
                )}
                <button className="btn btn-ghost" onClick={() => actions.copy(shareUrl, 'Secure link copied')}>
                  <Link2 size={16} aria-hidden="true" /> Copy link
                </button>
              </div>
              <div className="expiry-block">
                <ExpiryMeter ticket={t} />
              </div>
              <p className="fine">
                <ShieldCheck size={14} aria-hidden="true" /> The decryption key is inside the QR and code, never on our servers.
              </p>
            </>
          ) : (
            <EmptyState icon={status === 'revoked' ? Ban : Flame} title={STATUS_COPY[status]?.title ?? 'Not shareable'}>
              {STATUS_COPY[status]?.body}
            </EmptyState>
          )}
        </motion.section>

        <div className="detail-side">
          <motion.section className="card panel" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease, delay: 0.08 }} aria-labelledby="vars-title">
            <div className="panel-head">
              <h2 id="vars-title">Variables</h2>
              {vars.length > 0 && (
                <div style={{ display: 'flex', gap: 4 }}>
                  <button className="link-btn" onClick={() => actions.copy(toEnvText(vars), 'All variables copied')}>
                    <Copy size={15} aria-hidden="true" /> Copy all
                  </button>
                  <button className="link-btn" onClick={() => downloadEnv(vars)}>
                    <Download size={15} aria-hidden="true" /> .env
                  </button>
                </div>
              )}
            </div>
            {vars.length ? (
              <div className="secrets">
                {vars.map((v, i) => (
                  <SecretRow key={v.key} k={v.key} v={v.value} index={i} />
                ))}
              </div>
            ) : (
              <p className="muted-note">The encrypted payload was destroyed. Nothing is left to read.</p>
            )}
          </motion.section>

          <motion.section className="card panel" initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, ease, delay: 0.14 }} aria-labelledby="log-title">
            <div className="panel-head">
              <h2 id="log-title">Access log</h2>
              <span className="label">{t.opens.length} opens</span>
            </div>
            {t.opens.length ? (
              <ul className="activity">
                {t.opens.map((o, i) => (
                  <li key={i}>
                    <span className="avatar-sm">{o.who[0]}</span>
                    <span className="act-text">
                      {o.who} opened via {o.via === 'qr' ? 'QR' : 'code'}
                    </span>
                    <span className="act-time">{fmtAgo(o.at, state.now)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="muted-note">Nobody has opened this ticket yet.</p>
            )}
          </motion.section>

          <section className="card panel danger-zone" aria-labelledby="danger-title">
            <h2 id="danger-title">Danger zone</h2>
            <div className="danger-row">
              <div>
                <strong>Revoke ticket</strong>
                <p>The QR and code stop working right away. People who already opened it keep their copy.</p>
              </div>
              <button className="btn btn-ghost" disabled={status !== 'active'} onClick={() => setConfirm('revoke')}>
                <Ban size={16} aria-hidden="true" /> Revoke
              </button>
            </div>
            <div className="danger-row">
              <div>
                <strong>Delete ticket</strong>
                <p>Permanently removes the ticket and its encrypted payload. This cannot be undone.</p>
              </div>
              <button className="btn btn-danger" onClick={() => setConfirm('delete')}>
                <Trash2 size={16} aria-hidden="true" /> Delete
              </button>
            </div>
          </section>
        </div>
      </div>

      <Modal
        open={confirm === 'revoke'}
        onClose={() => setConfirm(null)}
        title={`Revoke ${t.name}?`}
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button className="btn btn-danger" disabled={busy} onClick={() => run(() => actions.revoke(t.id), () => (actions.toast('Ticket revoked'), load()))}>
              Revoke ticket
            </button>
          </>
        }
      >
        Its QR code{code ? <> and the code <span className="mono">{code}</span></> : null} will stop working immediately.
      </Modal>
      <Modal
        open={confirm === 'delete'}
        onClose={() => setConfirm(null)}
        title={`Delete ${t.name}?`}
        actions={
          <>
            <button className="btn btn-ghost" onClick={() => setConfirm(null)}>
              Cancel
            </button>
            <button className="btn btn-danger" disabled={busy} onClick={() => run(() => actions.remove(t.id), () => (actions.toast('Ticket deleted'), go('/tickets')))}>
              Delete permanently
            </button>
          </>
        }
      >
        The ticket and its {t.varCount} encrypted variables will be destroyed. This cannot be undone.
      </Modal>
    </>
  )
}
