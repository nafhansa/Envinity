import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import { ArrowRight, Clock, LockKeyhole, LockKeyholeOpen, QrCode, ShieldCheck, Ticket } from 'lucide-react'
import { ENV_LINES, FakeQR, Logo, Scramble, ease, fmt, useFastCountdown, withMotion } from './shared'

// phase 0: plain .env  ->  1: encrypting  ->  2: sealed + ticket issued
const PHASE_MS = [2600, 1500, 5400]
const VAULT_LINES = ENV_LINES.slice(0, 3)

function useHeroPhase() {
  const reduce = useReducedMotion()
  const [phase, setPhase] = useState(reduce ? 2 : 0)
  useEffect(() => {
    if (reduce) return
    const t = setTimeout(() => setPhase((p) => (p + 1) % 3), PHASE_MS[phase])
    return () => clearTimeout(t)
  }, [phase, reduce])
  return phase
}

const STATUS = ['Plaintext on your device', 'Encrypting locally...', 'Sealed. Ticket issued.']

function Hero() {
  const phase = useHeroPhase()
  const ref = useRef(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start start', 'end start'] })
  const y = useTransform(scrollYProgress, [0, 1], [0, 100])
  const left = useFastCountdown({ from: 600, seconds: 60, running: phase === 2, loopPause: 0 })

  return (
    <section className="hero" id="top" ref={ref}>
      <div className="container">
        <motion.div
          className="masthead"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ duration: 0.6, delay: 0.1 }}
        >
          <span className="label accent">Secure by design. Built for teams.</span>
          <span className="label">Android / iOS / Desktop / 2026</span>
        </motion.div>
        <motion.div
          className="rule"
          initial={{ scaleX: 0 }}
          animate={{ scaleX: 1 }}
          transition={{ duration: 1.1, ease, delay: 0.15 }}
        />

        <div className="hero-grid">
          <div>
            <motion.div
              initial={{ opacity: 0, scale: 0.6, rotate: -12 }}
              animate={{ opacity: 1, scale: 1, rotate: 0 }}
              transition={{ type: 'spring', stiffness: 220, damping: 16, delay: 0.2 }}
              style={{ width: 72 }}
            >
              <Logo size={72} />
            </motion.div>

            <h1>
              {['Envinity, powered', 'by Securinity'].map((w, i) => (
                <span className="line" key={w}>
                  <motion.span
                    style={{ display: 'inline-block' }}
                    initial={{ y: '110%' }}
                    animate={{ y: 0 }}
                    transition={{ delay: 0.35 + i * 0.1, duration: 0.9, ease }}
                  >
                    {w}
                  </motion.span>
                </span>
              ))}
              <span className="line">
                <motion.span
                  className="tagline"
                  style={{ display: 'inline-block' }}
                  initial={{ y: '110%' }}
                  animate={{ y: 0 }}
                  transition={{ delay: 0.6, duration: 0.9, ease }}
                >
                  Your .env, sealed.
                </motion.span>
              </span>
            </h1>

            <motion.p
              className="hero-sub"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.8, duration: 0.7, ease }}
            >
              Turn your .env into an encrypted ticket. Teammates scan a QR code or type a short code, and the variables
              land on their device. Keep secrets out of chat, in the right hands, and encrypted before they leave yours.
            </motion.p>

            <motion.div
              className="chips"
              initial="hidden"
              animate="show"
              variants={{ show: { transition: { staggerChildren: 0.08, delayChildren: 0.95 } } }}
            >
              {['Zero-knowledge', 'Self-destructing', 'Mobile-first'].map((label) => (
                <motion.span
                  key={label}
                  className="chip"
                  variants={{ hidden: { opacity: 0, y: 8 }, show: { opacity: 1, y: 0 } }}
                >
                  {label}
                </motion.span>
              ))}
            </motion.div>

            <motion.div
              className="hero-actions"
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 1.05, duration: 0.7, ease }}
            >
              <a href="/dashboard" className="btn btn-primary">
                Create your first ticket <ArrowRight size={18} aria-hidden="true" />
              </a>
              <a href="#how" className="btn btn-ghost">
                See how it works
              </a>
            </motion.div>
          </div>

          <motion.div
            className="demo"
            style={{ y }}
            initial={{ opacity: 0, y: 40 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ delay: 0.45, duration: 1, ease }}
            aria-label="Animated demo: three secrets are encrypted on the device and sealed into a shareable ticket"
            role="img"
          >
            <div className="vault">
              <div className="vault-head">
                <span className="label on-dark">Acme API / Production</span>
                <AnimatePresence mode="wait">
                  <motion.span
                    key={phase === 0 ? 'open' : 'locked'}
                    initial={{ scale: 0.5, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.5, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 400, damping: 18 }}
                    style={{ color: 'var(--accent-on-dark)', display: 'grid' }}
                  >
                    {phase === 0 ? <LockKeyholeOpen size={22} /> : <LockKeyhole size={22} />}
                  </motion.span>
                </AnimatePresence>
              </div>

              <div className="vault-rows">
                {VAULT_LINES.map(([k, v], i) => (
                  <motion.div
                    className="vault-row"
                    key={k}
                    initial={{ opacity: 0, x: -10 }}
                    animate={{ opacity: 1, x: 0 }}
                    transition={{ delay: 0.7 + i * 0.08 }}
                  >
                    <div className="vault-key">{k}</div>
                    <div className="vault-val">
                      {phase === 2 ? (
                        <motion.span
                          className="dots"
                          initial={{ opacity: 0, letterSpacing: '0em' }}
                          animate={{ opacity: 1, letterSpacing: '0.32em' }}
                          transition={{ duration: 0.5, delay: i * 0.08 }}
                        >
                          ••••••••
                        </motion.span>
                      ) : (
                        <Scramble className={phase === 1 ? 'enc' : 'plain'} text={v} active={phase === 1} duration={600 + i * 150} />
                      )}
                    </div>
                  </motion.div>
                ))}
                <AnimatePresence>
                  {phase === 1 && (
                    <motion.div
                      className="sweep"
                      initial={{ top: '-20%', opacity: 0 }}
                      animate={{ top: '100%', opacity: [0, 1, 1, 0] }}
                      exit={{ opacity: 0 }}
                      transition={{ duration: 1.3, ease: 'easeInOut' }}
                    />
                  )}
                </AnimatePresence>
              </div>

              <div className="vault-foot">
                <ShieldCheck size={18} style={{ color: 'var(--success-on-dark)' }} aria-hidden="true" />
                <AnimatePresence mode="wait">
                  <motion.span
                    key={phase}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, y: -6 }}
                    transition={{ duration: 0.25 }}
                  >
                    {phase === 2 ? 'Encrypted here. Never readable there.' : STATUS[phase]}
                  </motion.span>
                </AnimatePresence>
              </div>
            </div>

            <AnimatePresence>
              {phase === 2 && (
                <motion.div
                  className="ticket"
                  initial={{ opacity: 0, y: 40, scale: 0.9, rotate: 3 }}
                  animate={{ opacity: 1, y: 0, scale: 1, rotate: 0 }}
                  exit={{ opacity: 0, y: 20, scale: 0.95, transition: { duration: 0.3 } }}
                  transition={{ type: 'spring', stiffness: 220, damping: 22, delay: 0.25 }}
                >
                  <div className="ticket-head">
                    <span className="label" style={{ display: 'inline-flex', gap: 8, alignItems: 'center', color: 'var(--fg)' }}>
                      <Ticket size={15} style={{ color: 'var(--accent)' }} aria-hidden="true" /> Ticket created
                    </span>
                    <span className="mono" style={{ fontSize: 12, color: 'var(--fg-muted)' }}>
                      6 vars
                    </span>
                  </div>
                  <div className="ticket-body">
                    <div className="qr-wrap">
                      <FakeQR size={92} seed={42} />
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 12, color: 'var(--fg-muted)', display: 'flex', gap: 6, alignItems: 'center' }}>
                        <QrCode size={13} aria-hidden="true" /> or enter code
                      </div>
                      <div className="code-chip">7K2Q-9XPA</div>
                      <div className="timer-pill">
                        <Clock size={12} aria-hidden="true" /> {fmt(left)} left
                      </div>
                    </div>
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </motion.div>
        </div>
      </div>
    </section>
  )
}

export default withMotion(Hero)
