import { useMemo, useRef, useState } from 'react'
import { AnimatePresence, motion, useInView } from 'framer-motion'
import { Crown, Flame, Infinity as InfinityIcon, Timer, Trash2 } from 'lucide-react'
import { Reveal, ease, fmt, useFastCountdown, withMotion } from './shared'

const R = 92
const C = 2 * Math.PI * R

function Ring({ value, color, children }) {
  return (
    <div style={{ position: 'relative', width: 220, height: 220 }}>
      <svg width="220" height="220" viewBox="0 0 220 220" aria-hidden="true" style={{ transform: 'rotate(-90deg)' }}>
        <circle cx="110" cy="110" r={R} fill="none" stroke="var(--track)" strokeWidth="10" />
        <circle
          cx="110"
          cy="110"
          r={R}
          fill="none"
          stroke={color}
          strokeWidth="10"
          strokeLinecap="round"
          strokeDasharray={C}
          strokeDashoffset={C * (1 - value)}
        />
      </svg>
      <div className="ring-label">{children}</div>
    </div>
  )
}

function Particles() {
  const ps = useMemo(
    () =>
      Array.from({ length: 28 }, (_, i) => ({
        x: 10 + Math.random() * 80,
        y: 20 + Math.random() * 60,
        dx: (Math.random() - 0.5) * 120,
        dy: -40 - Math.random() * 80,
        d: Math.random() * 0.3,
        c: i % 3 ? 'var(--warn)' : 'var(--danger)',
      })),
    [],
  )
  return ps.map((p, i) => (
    <motion.span
      key={i}
      className="particle"
      style={{ left: `${p.x}%`, top: `${p.y}%`, background: p.c }}
      initial={{ opacity: 1, x: 0, y: 0, scale: 1 }}
      animate={{ opacity: 0, x: p.dx, y: p.dy, scale: 0, rotate: 180 }}
      transition={{ duration: 1.2, delay: p.d, ease: 'easeOut' }}
    />
  ))
}

function FreeCard() {
  const ref = useRef(null)
  const inView = useInView(ref, { margin: '-120px' })
  const left = useFastCountdown({ from: 600, seconds: 8, running: inView, loopPause: 3200 })
  const expired = left === 0
  const color = left > 300 ? 'var(--fg)' : left > 120 ? 'var(--accent)' : 'var(--danger)'

  return (
    <Reveal className="card plan-card" ref={ref}>
      <div className="plan-top">
        <span className="badge warn">
          <Timer size={13} aria-hidden="true" /> Free account
        </span>
        <span className="mono" style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
          shown at 75x speed
        </span>
      </div>
      <h3>Gone in 10 minutes</h3>
      <p>Every free ticket starts a countdown the moment it is generated. At zero, the encrypted payload is wiped from our servers. No archive, no backup.</p>

      <div className="ring-area">
        <Ring value={left / 600} color={color}>
          <AnimatePresence mode="wait">
            {expired ? (
              <motion.div key="x" initial={{ scale: 0.6, opacity: 0 }} animate={{ scale: 1, opacity: 1 }} exit={{ opacity: 0 }}>
                <Flame size={40} style={{ margin: '0 auto 6px', color: 'var(--danger)' }} aria-hidden="true" />
                <small>Ticket destroyed</small>
              </motion.div>
            ) : (
              <motion.div key="t" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }}>
                <strong style={{ color }}>{fmt(left)}</strong>
                <small>until self-destruct</small>
              </motion.div>
            )}
          </AnimatePresence>
        </Ring>
      </div>

      <div className="mini-env" aria-live="polite">
        <AnimatePresence mode="wait">
          {expired ? (
            <motion.div key="gone" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} style={{ color: 'var(--danger)' }}>
              <Particles />
              {'> 410 Gone'}
              <div style={{ color: 'var(--fg-muted)' }}>{'> ticket 7K2Q-9XPA no longer exists'}</div>
            </motion.div>
          ) : (
            <motion.div key="env" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, filter: 'blur(6px)', scale: 0.98 }}>
              <div>
                <span className="k">JWT_SECRET</span>=<span className="v">b7f1c9e2a04d</span>
              </div>
              <div>
                <span className="k">REDIS_URL</span>=<span className="v">redis://cache.internal</span>
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </Reveal>
  )
}

function ProCard() {
  const [tickets, setTickets] = useState([
    { id: 'A1', name: 'acme-api / production', age: 'Created 214 days ago' },
    { id: 'B2', name: 'web-app / staging', age: 'Created 61 days ago' },
    { id: 'C3', name: 'ml-worker / dev', age: 'Created 3 days ago' },
  ])
  const remove = (id) => setTickets((t) => t.filter((x) => x.id !== id))
  const reset = () =>
    setTickets([
      { id: 'A1', name: 'acme-api / production', age: 'Created 214 days ago' },
      { id: 'B2', name: 'web-app / staging', age: 'Created 61 days ago' },
      { id: 'C3', name: 'ml-worker / dev', age: 'Created 3 days ago' },
    ])

  return (
    <Reveal className="card plan-card pro dark" delay={0.12}>
      <div className="plan-top">
        <span className="badge ok">
          <Crown size={13} aria-hidden="true" /> Subscription
        </span>
        <span className="mono" style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
          try deleting one
        </span>
      </div>
      <h3>Kept until you delete it</h3>
      <p>Subscribers keep tickets for as long as they need. Onboard a new hire next month with the same ticket. It only disappears when the owner deletes it.</p>

      <div className="ring-area">
        <Ring value={1} color="var(--accent)">
          <motion.div
            animate={{ scale: [1, 1.08, 1] }}
            transition={{ duration: 2.4, repeat: Infinity, ease: 'easeInOut' }}
          >
            <InfinityIcon size={64} strokeWidth={2.2} style={{ margin: '0 auto', color: 'var(--accent)' }} aria-hidden="true" />
          </motion.div>
          <small style={{ position: 'absolute', bottom: 62 }}>no expiry</small>
        </Ring>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minHeight: 82 }}>
        <AnimatePresence initial={false}>
          {tickets.map((t) => (
            <motion.div
              key={t.id}
              layout
              className="log-row"
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, x: 60, transition: { duration: 0.25 } }}
              transition={{ duration: 0.35, ease }}
            >
              <InfinityIcon size={15} color="var(--accent)" aria-hidden="true" />
              <span style={{ flex: 1, minWidth: 0 }}>
                <span className="mono" style={{ fontSize: 12.5 }}>{t.name}</span>
                <span style={{ display: 'block', fontSize: 11.5, color: 'var(--fg-muted)' }}>{t.age}</span>
              </span>
              <button
                onClick={() => remove(t.id)}
                aria-label={`Delete ticket ${t.name}`}
                style={{ width: 44, height: 44, display: 'grid', placeItems: 'center', borderRadius: 10, color: 'var(--fg-muted)', margin: '-10px -8px -10px 0' }}
              >
                <Trash2 size={16} aria-hidden="true" />
              </button>
            </motion.div>
          ))}
        </AnimatePresence>
        {tickets.length === 0 && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            className="btn btn-ghost"
            onClick={reset}
          >
            Only the owner can do that. Restore demo
          </motion.button>
        )}
      </div>
    </Reveal>
  )
}

function Expiry() {
  return (
    <section className="section" id="expiry" aria-labelledby="expiry-title">
      <div className="container">
        <div className="section-head">
          <Reveal as="span" className="eyebrow">
            Lifetime of a ticket
          </Reveal>
          <Reveal as="h2" id="expiry-title" delay={0.05}>
            Secrets should not <span className="grad">outlive their purpose</span>
          </Reveal>
          <Reveal as="p" delay={0.1}>
            Free tickets vanish 10 minutes after they are generated. With a subscription you decide when they go.
          </Reveal>
        </div>
        <div className="expiry-grid">
          <FreeCard />
          <ProCard />
        </div>
      </div>
    </section>
  )
}

export default withMotion(Expiry)
