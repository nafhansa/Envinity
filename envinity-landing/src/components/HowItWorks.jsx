import { useEffect, useRef, useState } from 'react'
import { AnimatePresence, motion, useMotionValueEvent, useReducedMotion, useScroll, useSpring } from 'framer-motion'
import { Check, Clock, Copy, FileCode2, FolderDown, KeyRound, QrCode, ScanLine } from 'lucide-react'
import { ENV_LINES, FakeQR, ease, fmt, useFastCountdown, withMotion } from './shared'

const STEPS = [
  {
    title: 'Create a ticket',
    body: 'Drop your .env into Envinity. It is encrypted on your device before anything leaves it, then wrapped into a ticket.',
  },
  {
    title: 'Share a QR or a code',
    body: 'Every ticket gets a QR code and an 8 character unique code. Show it on screen or send the code to whoever needs it.',
  },
  {
    title: 'Teammate scans or types',
    body: 'Your teammate opens Envinity, scans the QR or enters the code. Only someone holding the ticket can unlock it.',
  },
  {
    title: 'Variables delivered, then gone',
    body: 'The .env is decrypted on their device, ready to copy or save. Free tickets self-destruct after 10 minutes.',
  },
]

const screenAnim = {
  initial: { opacity: 0, y: 30, scale: 0.97 },
  animate: { opacity: 1, y: 0, scale: 1, transition: { duration: 0.5, ease } },
  exit: { opacity: 0, y: -24, scale: 0.98, transition: { duration: 0.25 } },
}

const stagger = {
  animate: { transition: { staggerChildren: 0.08, delayChildren: 0.15 } },
}
const item = {
  initial: { opacity: 0, y: 12 },
  animate: { opacity: 1, y: 0, transition: { duration: 0.4, ease } },
}

function ScreenCreate() {
  return (
    <motion.div className="screen" {...screenAnim}>
      <motion.div variants={stagger} initial="initial" animate="animate" style={{ display: 'contents' }}>
        <motion.div variants={item} className="screen-title">New ticket</motion.div>
        <motion.div variants={item} className="screen-sub">Encrypted on this device</motion.div>
        <motion.div variants={item} className="drop">
          <div className="file-icon">
            <FileCode2 size={20} aria-hidden="true" />
          </div>
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="mono" style={{ fontSize: 13, fontWeight: 600 }}>.env.production</div>
            <div style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>6 variables, 412 bytes</div>
            <div style={{ height: 4, background: 'var(--track)', borderRadius: 4, marginTop: 6, overflow: 'hidden' }}>
              <motion.div
                style={{ height: '100%', background: 'var(--accent)', borderRadius: 4 }}
                initial={{ width: '0%' }}
                animate={{ width: '100%' }}
                transition={{ duration: 1.1, delay: 0.4, ease: 'easeInOut' }}
              />
            </div>
          </div>
        </motion.div>
        <motion.div variants={item} className="field">
          <label>Ticket name</label>
          <div>acme-api / production</div>
        </motion.div>
        <motion.div variants={item} className="field">
          <label>Expires</label>
          <div style={{ display: 'flex', justifyContent: 'space-between' }}>
            10 minutes <span className="badge warn" style={{ padding: '1px 8px' }}>Free</span>
          </div>
        </motion.div>
        <motion.div variants={item} className="seg">
          <span className="on">One-time</span>
          <span>Multi-use</span>
        </motion.div>
        <motion.div
          variants={item}
          className="screen-btn"
          animate={{ scale: [1, 1, 0.96, 1] }}
          transition={{ duration: 1.6, delay: 1.6, repeat: Infinity, repeatDelay: 1 }}
        >
          Create ticket
        </motion.div>
      </motion.div>
    </motion.div>
  )
}

function ScreenShare() {
  const code = '7K2Q9XPA'.split('')
  return (
    <motion.div className="screen" {...screenAnim}>
      <div className="screen-title">Ticket ready</div>
      <div className="screen-sub">acme-api / production</div>
      <motion.div
        style={{ background: '#ffffff', borderRadius: 20, padding: 14, alignSelf: 'center', marginTop: 6 }}
        initial={{ rotateY: 90 }}
        animate={{ rotateY: 0 }}
        transition={{ duration: 0.6, ease }}
      >
        <FakeQR size={170} seed={42} />
      </motion.div>
      <div style={{ textAlign: 'center', fontSize: 11.5, color: 'var(--fg-muted)', marginTop: 4 }}>or share this code</div>
      <div className="code-boxes">
        {code.map((c, i) => (
          <motion.span
            key={i}
            initial={{ opacity: 0, y: 14, rotateX: -90 }}
            animate={{ opacity: 1, y: 0, rotateX: 0 }}
            transition={{ delay: 0.5 + i * 0.06, type: 'spring', stiffness: 300, damping: 20 }}
          >
            {c}
          </motion.span>
        ))}
      </div>
      <div style={{ display: 'flex', justifyContent: 'center' }}>
        <span className="badge warn">
          <Clock size={12} aria-hidden="true" /> Expires in 09:58
        </span>
      </div>
      <div className="screen-btn" style={{ display: 'flex', gap: 8, alignItems: 'center', justifyContent: 'center' }}>
        <Copy size={16} aria-hidden="true" /> Copy code
      </div>
    </motion.div>
  )
}

function ScreenScan() {
  const reduce = useReducedMotion()
  const [typed, setTyped] = useState(reduce ? 8 : 0)
  useEffect(() => {
    if (reduce) return
    const id = setInterval(() => setTyped((t) => (t >= 8 ? 8 : t + 1)), 220)
    return () => clearInterval(id)
  }, [reduce])
  const code = '7K2Q9XPA'
  const corners = [
    { top: 14, left: 14, borderTopWidth: 3, borderLeftWidth: 3, borderTopLeftRadius: 12 },
    { top: 14, right: 14, borderTopWidth: 3, borderRightWidth: 3, borderTopRightRadius: 12 },
    { bottom: 14, left: 14, borderBottomWidth: 3, borderLeftWidth: 3, borderBottomLeftRadius: 12 },
    { bottom: 14, right: 14, borderBottomWidth: 3, borderRightWidth: 3, borderBottomRightRadius: 12 },
  ]
  return (
    <motion.div className="screen" {...screenAnim}>
      <div className="screen-title">Open ticket</div>
      <div className="seg">
        <span className="on" style={{ display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'center' }}>
          <ScanLine size={13} aria-hidden="true" /> Scan
        </span>
        <span style={{ display: 'flex', gap: 6, justifyContent: 'center', alignItems: 'center' }}>
          <KeyRound size={13} aria-hidden="true" /> Code
        </span>
      </div>
      <div className="viewfinder">
        <motion.div
          style={{ background: '#ffffff', borderRadius: 12, padding: 8 }}
          initial={{ scale: 0.7, rotate: -8, opacity: 0.4 }}
          animate={{ scale: 1, rotate: 0, opacity: 1 }}
          transition={{ duration: 1.2, ease }}
        >
          <FakeQR size={110} seed={42} draw={false} />
        </motion.div>
        {corners.map((c, i) => (
          <motion.div
            key={i}
            className="vf-corner"
            style={c}
            animate={{ scale: [1, 0.9, 1] }}
            transition={{ duration: 1.4, repeat: Infinity, delay: i * 0.05 }}
          />
        ))}
        <motion.div
          className="scanline"
          initial={{ top: '14%' }}
          animate={{ top: ['14%', '86%', '14%'] }}
          transition={{ duration: 2.2, repeat: Infinity, ease: 'easeInOut' }}
        />
      </div>
      <div style={{ fontSize: 11.5, color: 'var(--fg-muted)', textAlign: 'center' }}>or type the unique code</div>
      <div className="code-boxes">
        {code.split('').map((c, i) => (
          <span key={i} style={{ borderColor: i < typed ? 'var(--accent)' : undefined }}>
            {i < typed ? c : ''}
          </span>
        ))}
      </div>
      <AnimatePresence>
        {typed >= 8 && (
          <motion.div
            className="badge ok"
            style={{ alignSelf: 'center' }}
            initial={{ opacity: 0, scale: 0.8 }}
            animate={{ opacity: 1, scale: 1 }}
          >
            <Check size={12} aria-hidden="true" /> Ticket verified
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  )
}

function ScreenReceive() {
  const left = useFastCountdown({ from: 600, seconds: 40, loopPause: 0 })
  return (
    <motion.div className="screen" {...screenAnim}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
        <div className="screen-title">Unlocked</div>
        <motion.div
          initial={{ scale: 0 }}
          animate={{ scale: 1 }}
          transition={{ type: 'spring', stiffness: 400, damping: 14, delay: 0.2 }}
          style={{ width: 30, height: 30, borderRadius: 999, background: 'var(--accent)', display: 'grid', placeItems: 'center' }}
        >
          <Check size={18} color="var(--on-accent)" strokeWidth={3} aria-hidden="true" />
        </motion.div>
      </div>
      <div className="screen-sub">From Rina, acme-api / production</div>
      <div className="env-list">
        {ENV_LINES.map(([k, v], i) => (
          <motion.div
            key={k}
            initial={{ opacity: 0, x: -12, filter: 'blur(4px)' }}
            animate={{ opacity: 1, x: 0, filter: 'blur(0px)' }}
            transition={{ delay: 0.35 + i * 0.12 }}
          >
            <span className="k">{k}</span>
            <span style={{ color: 'var(--fg-muted)' }}>=</span>
            <span className="v">{v}</span>
          </motion.div>
        ))}
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
        <div className="field" style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center', fontSize: 12.5, fontWeight: 600 }}>
          <Copy size={14} aria-hidden="true" /> Copy all
        </div>
        <div className="field" style={{ display: 'flex', gap: 6, alignItems: 'center', justifyContent: 'center', fontSize: 12.5, fontWeight: 600 }}>
          <FolderDown size={14} aria-hidden="true" /> Save .env
        </div>
      </div>
      <div style={{ marginTop: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 11.5, color: 'var(--fg-muted)', marginBottom: 6 }}>
          <span>Ticket self-destructs in</span>
          <span className="mono" style={{ color: 'var(--warn)' }}>{fmt(left)}</span>
        </div>
        <div style={{ height: 6, background: 'var(--track)', borderRadius: 6, overflow: 'hidden' }}>
          <div style={{ height: '100%', width: `${(left / 600) * 100}%`, background: 'linear-gradient(90deg,var(--accent),var(--danger))', borderRadius: 6 }} />
        </div>
      </div>
    </motion.div>
  )
}

const SCREENS = [ScreenCreate, ScreenShare, ScreenScan, ScreenReceive]

function HowItWorks() {
  const track = useRef(null)
  const { scrollYProgress } = useScroll({ target: track, offset: ['start start', 'end end'] })
  const progress = useSpring(scrollYProgress, { stiffness: 120, damping: 24 })
  const [active, setActive] = useState(0)
  useMotionValueEvent(scrollYProgress, 'change', (v) => {
    const i = Math.min(STEPS.length - 1, Math.max(0, Math.floor(v * STEPS.length * 0.999)))
    setActive(i)
  })

  const goTo = (i) => {
    const el = track.current
    if (!el) return
    const top = el.getBoundingClientRect().top + window.scrollY
    const range = el.offsetHeight - window.innerHeight
    window.scrollTo({ top: top + range * ((i + 0.5) / STEPS.length), behavior: 'smooth' })
  }

  const Screen = SCREENS[active]

  return (
    <section className="how" id="how" aria-labelledby="how-title">
      <div className="container" style={{ paddingTop: 120 }}>
        <div className="section-head" style={{ marginBottom: 0 }}>
          <motion.span className="eyebrow" initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }}>
            How it works
          </motion.span>
          <motion.h2
            id="how-title"
            initial={{ opacity: 0, y: 24 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ duration: 0.7, ease }}
          >
            From <span className="mono grad">.env</span> to teammate in four steps
          </motion.h2>
          <motion.p initial={{ opacity: 0 }} whileInView={{ opacity: 1 }} viewport={{ once: true }} transition={{ delay: 0.2 }}>
            Keep scrolling. Each step plays out on the phone exactly as it does in the app.
          </motion.p>
        </div>
      </div>

      <div className="how-track" ref={track}>
        <div className="how-sticky">
          <div className="container how-grid">
            <div className="steps">
              <div className="step-progress" aria-hidden="true">
                <motion.div style={{ scaleY: progress }} />
              </div>
              {STEPS.map((s, i) => (
                <motion.button
                  key={s.title}
                  className={`step ${i === active ? 'active' : ''}`}
                  onClick={() => goTo(i)}
                  animate={{ opacity: i === active ? 1 : 0.45, x: i === active ? 8 : 0 }}
                  transition={{ duration: 0.4, ease }}
                  aria-current={i === active ? 'step' : undefined}
                >
                  <span className="step-num">0{i + 1}</span>
                  <span>
                    <span className="step-title">{s.title}</span>
                    <span className="step-body">{s.body}</span>
                  </span>
                </motion.button>
              ))}
            </div>

            <div className="phone-stage">
              <motion.div
                className="orbit"
                animate={{ rotate: 360 }}
                transition={{ duration: 60, repeat: Infinity, ease: 'linear' }}
              />
              <motion.div
                className="phone"
                animate={{ rotateY: active % 2 ? -6 : 6, rotateX: 2 }}
                transition={{ duration: 0.8, ease }}
                style={{ transformPerspective: 1200 }}
              >
                <div className="phone-screen">
                  <div className="notch" />
                  <AnimatePresence mode="wait">
                    <Screen key={active} />
                  </AnimatePresence>
                </div>
              </motion.div>
              <motion.div
                key={`chip-${active}`}
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="mono"
                style={{ marginTop: 18, fontSize: 13, color: 'var(--fg-muted)', display: 'flex', gap: 8, alignItems: 'center' }}
              >
                <QrCode size={14} color="var(--accent)" aria-hidden="true" /> step {active + 1} / {STEPS.length}
              </motion.div>
            </div>
          </div>
        </div>
      </div>
    </section>
  )
}

export default withMotion(HowItWorks)
