import { useEffect, useState } from 'react'
import { AnimatePresence, motion, useReducedMotion, useScroll, useTransform } from 'framer-motion'
import {
  Apple,
  ArrowUpRight,
  Check,
  ChevronDown,
  Eye,
  EyeOff,
  Laptop,
  MonitorSmartphone,
  Smartphone,
  Users,
} from 'lucide-react'
import { useRef } from 'react'
import { FakeQR, Logo, Reveal, ease, withMotion } from './shared'

/* ---------------- security bento ---------------- */
function CipherStream() {
  const reduce = useReducedMotion()
  const [s, setS] = useState('')
  useEffect(() => {
    const g = 'ABCDEF0123456789abcdef+/'
    const make = () => Array.from({ length: 150 }, () => g[Math.floor(Math.random() * g.length)]).join('')
    setS(make())
    if (reduce) return
    const id = setInterval(() => setS(make()), 140)
    return () => clearInterval(id)
  }, [reduce])
  return <div className="cipher" aria-hidden="true">{s}</div>
}

function LockAnim() {
  return (
    <svg width="120" height="120" viewBox="0 0 120 120" aria-hidden="true">
      <motion.path
        d="M38 54V40a22 22 0 0 1 44 0v14"
        fill="none"
        stroke="var(--fg)"
        strokeWidth="7"
        strokeLinecap="round"
        initial={{ y: -14 }}
        whileInView={{ y: 0 }}
        viewport={{ once: false, margin: '-60px' }}
        transition={{ type: 'spring', stiffness: 300, damping: 12, delay: 0.3 }}
      />
      <rect x="26" y="52" width="68" height="54" rx="12" fill="var(--accent)" />
      <circle cx="60" cy="76" r="7" fill="var(--on-accent)" />
      <rect x="57" y="78" width="6" height="14" rx="3" fill="var(--on-accent)" />
    </svg>
  )
}

function Reveal3() {
  const [show, setShow] = useState(false)
  return (
    <div style={{ width: '100%' }}>
      <div className="log-row mono" style={{ justifyContent: 'space-between' }}>
        <span style={{ minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
          <span className="k">STRIPE_SECRET_KEY</span>=
          <AnimatePresence mode="wait">
            <motion.span
              key={String(show)}
              className="v"
              initial={{ opacity: 0, filter: 'blur(6px)' }}
              animate={{ opacity: 1, filter: 'blur(0px)' }}
              exit={{ opacity: 0 }}
            >
              {show ? 'sk_live_51Hx9aQ' : '••••••••••••'}
            </motion.span>
          </AnimatePresence>
        </span>
        <button
          onClick={() => setShow((v) => !v)}
          aria-label={show ? 'Hide value' : 'Show value'}
          style={{ width: 44, height: 44, display: 'grid', placeItems: 'center', margin: '-10px -8px', color: 'var(--fg-muted)' }}
        >
          {show ? <EyeOff size={16} /> : <Eye size={16} />}
        </button>
      </div>
    </div>
  )
}

function AuditLog() {
  const rows = [
    ['R', 'var(--accent)', 'Rina created acme-api / prod', 'now'],
    ['D', 'var(--warn)', 'Dimas opened via QR', '1m'],
    ['A', '#48413d', 'Ayu opened via code', '3m'],
    ['R', 'var(--accent)', 'Rina revoked access', '4m'],
  ]
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, width: '100%' }}>
      {rows.map(([a, c, t, time], i) => (
        <motion.div
          key={t}
          className="log-row"
          initial={{ opacity: 0, x: -20 }}
          whileInView={{ opacity: 1, x: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.2 + i * 0.15, ease }}
        >
          <span className="avatar" style={{ background: c }}>
            {a}
          </span>
          <span style={{ flex: 1 }}>{t}</span>
          <span className="mono" style={{ fontSize: 11.5, color: 'var(--fg-muted)' }}>
            {time}
          </span>
        </motion.div>
      ))}
    </div>
  )
}

const FEATS = [
  {
    cls: 'span-4 dark',
    title: 'Encrypted before it leaves your device',
    body: 'Your .env is sealed with AES-256-GCM on your phone or laptop. Our servers only ever hold ciphertext, so even we cannot read your secrets.',
    visual: <CipherStream />,
  },
  {
    cls: 'span-2',
    title: 'Ticket is the key',
    body: 'The decryption key lives in the QR and the code, never on our servers.',
    visual: <LockAnim />,
  },
  {
    cls: 'span-2',
    title: 'Masked by default',
    body: 'Values stay hidden on screen until you choose to reveal them. Shoulder surfers get nothing.',
    visual: <Reveal3 />,
  },
  {
    cls: 'span-4',
    title: 'Know who opened what',
    body: 'Every scan and code entry is logged. Revoke a ticket the second it lands in the wrong hands.',
    visual: <AuditLog />,
  },
]

function SecuritySection() {
  return (
    <section className="section" id="security" aria-labelledby="sec-title">
      <div className="container">
        <div className="section-head">
          <Reveal as="span" className="eyebrow">
            Security
          </Reveal>
          <Reveal as="h2" id="sec-title" delay={0.05}>
            Built like a vault, <span className="grad">feels like AirDrop</span>
          </Reveal>
          <Reveal as="p" delay={0.1}>
            Pasting API keys into chat leaves them in history forever. Envinity is designed so secrets travel once and leave no trail.
          </Reveal>
        </div>
        <div className="bento">
          {FEATS.map((f, i) => (
            <motion.article
              key={f.title}
              className={`card feat ${f.cls}`}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.7, delay: (i % 2) * 0.1, ease }}
              whileHover={{ y: -4, borderColor: 'rgba(230,59,15,.35)' }}
            >
              <div className="feat-visual">{f.visual}</div>
              <h3>{f.title}</h3>
              <p>{f.body}</p>
            </motion.article>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ---------------- platforms ---------------- */
function MiniPhone({ seed }) {
  return (
    <div>
      <div className="skel" style={{ width: '60%', height: 10, background: 'var(--track)' }} />
      <div style={{ background: '#ffffff', borderRadius: 10, padding: 6, alignSelf: 'center', marginTop: 4 }}>
        <FakeQR size={80} seed={seed} draw={false} />
      </div>
      <div className="skel" />
      <div className="skel" style={{ width: '70%' }} />
      <div style={{ marginTop: 'auto', height: 22, borderRadius: 8, background: 'var(--accent)' }} />
    </div>
  )
}

function PlatformsSection() {
  const ref = useRef(null)
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start end', 'end start'] })
  const leftX = useTransform(scrollYProgress, [0, 0.5], [-120, 0])
  const rightX = useTransform(scrollYProgress, [0, 0.5], [120, 0])
  const lapY = useTransform(scrollYProgress, [0, 0.5], [80, 0])
  const op = useTransform(scrollYProgress, [0, 0.35], [0, 1])

  return (
    <section className="section" aria-labelledby="plat-title" ref={ref}>
      <div className="container">
        <div className="section-head">
          <Reveal as="span" className="eyebrow">
            Everywhere your team is
          </Reveal>
          <Reveal as="h2" id="plat-title" delay={0.05}>
            Create on desktop. <span className="grad">Scan with your phone.</span>
          </Reveal>
          <Reveal as="p" delay={0.1}>
            Native apps for Android, iOS, macOS, Windows and Linux. One account, tickets synced across every device you sign in to.
          </Reveal>
        </div>

        <div className="devices" aria-hidden="true">
          <motion.div className="laptop" style={{ y: lapY, opacity: op }}>
            <div className="laptop-screen">
              <div style={{ display: 'grid', gridTemplateColumns: '28% 1fr', height: '100%' }}>
                <div style={{ borderRight: '1px solid #26324a', padding: 14, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ display: 'flex', gap: 8, alignItems: 'center', fontWeight: 700, fontSize: 13 }}>
                    <Logo size={20} animate={false} /> Envinity
                  </div>
                  {['Tickets', 'Received', 'Team', 'Settings'].map((t, i) => (
                    <div
                      key={t}
                      style={{
                        fontSize: 12,
                        padding: '6px 8px',
                        borderRadius: 8,
                        background: i === 0 ? 'rgba(230,59,15,.12)' : 'transparent',
                        color: i === 0 ? 'var(--accent)' : 'var(--fg-muted)',
                      }}
                    >
                      {t}
                    </div>
                  ))}
                </div>
                <div style={{ padding: 16, display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div style={{ fontWeight: 700, fontSize: 14 }}>Your tickets</div>
                  {['acme-api / production', 'web-app / staging', 'ml-worker / dev'].map((t, i) => (
                    <motion.div
                      key={t}
                      className="log-row"
                      style={{ fontSize: 12 }}
                      initial={{ opacity: 0, x: 20 }}
                      whileInView={{ opacity: 1, x: 0 }}
                      viewport={{ once: true }}
                      transition={{ delay: 0.3 + i * 0.12 }}
                    >
                      <span className="mono" style={{ flex: 1 }}>{t}</span>
                      <span className={`badge ${i === 2 ? 'warn' : 'ok'}`} style={{ fontSize: 10.5 }}>
                        {i === 2 ? '07:41' : 'forever'}
                      </span>
                    </motion.div>
                  ))}
                </div>
              </div>
            </div>
            <div className="laptop-base" />
          </motion.div>

          <motion.div className="device-phone" style={{ left: '4%', bottom: 0, x: leftX, opacity: op, rotate: -6 }}>
            <MiniPhone seed={11} />
          </motion.div>
          <motion.div className="device-phone" style={{ right: '4%', bottom: 0, x: rightX, opacity: op, rotate: 6 }}>
            <MiniPhone seed={23} />
          </motion.div>
        </div>

        <motion.div
          className="platform-tags"
          initial="h"
          whileInView="s"
          viewport={{ once: true }}
          variants={{ s: { transition: { staggerChildren: 0.08 } } }}
        >
          {[
            [Smartphone, 'Android'],
            [Apple, 'iOS'],
            [Laptop, 'macOS'],
            [MonitorSmartphone, 'Windows'],
            [Laptop, 'Linux'],
          ].map(([Icon, l]) => (
            <motion.span key={l} className="ptag" variants={{ h: { opacity: 0, y: 14 }, s: { opacity: 1, y: 0 } }}>
              <Icon size={18} color="var(--accent)" aria-hidden="true" /> {l}
            </motion.span>
          ))}
        </motion.div>
      </div>
    </section>
  )
}

/* ---------------- pricing ---------------- */
function PricingSection() {
  const [yearly, setYearly] = useState(true)
  const plans = [
    {
      name: 'Free',
      price: '$0',
      per: 'forever',
      desc: 'For quick, one-off handoffs.',
      cta: 'Start free',
      feats: ['Unlimited tickets', 'QR code and unique code sharing', 'End-to-end encryption', 'Tickets auto-delete after 10 minutes'],
    },
    {
      name: 'Pro',
      price: yearly ? '$6' : '$8',
      per: yearly ? 'per user / month, billed yearly' : 'per user / month',
      desc: 'For teams that onboard often.',
      cta: 'Go Pro',
      pro: true,
      feats: [
        'Everything in Free',
        'Tickets stored until you delete them',
        'Revoke access any time',
        'Access log for every ticket',
        'Team workspaces and roles',
        'Sync across all your devices',
      ],
    },
  ]
  return (
    <section className="section" id="pricing" aria-labelledby="price-title">
      <div className="container">
        <div className="section-head">
          <Reveal as="span" className="eyebrow">
            Pricing
          </Reveal>
          <Reveal as="h2" id="price-title" delay={0.05}>
            Free for quick shares. <span className="grad">Pro for keeps.</span>
          </Reveal>
          <Reveal delay={0.1} style={{ display: 'flex', justifyContent: 'center', marginTop: 24 }}>
            <div className="seg" role="group" aria-label="Billing period" style={{ width: 260, position: 'relative' }}>
              {['Monthly', 'Yearly'].map((l) => {
                const on = (l === 'Yearly') === yearly
                return (
                  <button
                    key={l}
                    onClick={() => setYearly(l === 'Yearly')}
                    aria-pressed={on}
                    style={{ position: 'relative', padding: '10px', minHeight: 44, color: on ? 'var(--fg)' : 'var(--fg-muted)', fontWeight: 600 }}
                  >
                    {on && (
                      <motion.span
                        layoutId="billing"
                        style={{ position: 'absolute', inset: 0, background: 'var(--surface)', borderRadius: 9, zIndex: 0 }}
                        transition={{ type: 'spring', stiffness: 400, damping: 32 }}
                      />
                    )}
                    <span style={{ position: 'relative' }}>{l}</span>
                  </button>
                )
              })}
            </div>
          </Reveal>
        </div>

        <div className="pricing">
          {plans.map((p, i) => (
            <motion.div
              key={p.name}
              className={`card price-card ${p.pro ? 'pro dark' : ''}`}
              initial={{ opacity: 0, y: 40 }}
              whileInView={{ opacity: 1, y: 0 }}
              viewport={{ once: true, margin: '-60px' }}
              transition={{ duration: 0.7, delay: i * 0.12, ease }}
            >
              {p.pro && <span className="popular badge warn">Most popular</span>}
              <div>
                <div style={{ fontWeight: 700, fontSize: 20 }}>{p.name}</div>
                <div style={{ color: 'var(--fg-muted)', fontSize: 15 }}>{p.desc}</div>
              </div>
              <div className="price">
                <AnimatePresence mode="wait">
                  <motion.strong
                    key={p.price}
                    initial={{ y: 16, opacity: 0 }}
                    animate={{ y: 0, opacity: 1 }}
                    exit={{ y: -16, opacity: 0 }}
                    transition={{ duration: 0.25 }}
                  >
                    {p.price}
                  </motion.strong>
                </AnimatePresence>
                <span>{p.per}</span>
              </div>
              <ul>
                {p.feats.map((f) => (
                  <li key={f}>
                    <Check size={18} color="var(--accent)" aria-hidden="true" /> {f}
                  </li>
                ))}
              </ul>
              <a href="/dashboard" className={`btn ${p.pro ? 'btn-primary' : 'btn-ghost'}`}>
                {p.cta}
              </a>
            </motion.div>
          ))}
        </div>
      </div>
    </section>
  )
}

/* ---------------- faq ---------------- */
const QA = [
  [
    'What happens when a free ticket expires?',
    'Ten minutes after it is generated, the encrypted payload is permanently deleted from our servers. The QR code and unique code stop working right away. Anyone who already opened it keeps what they saved on their own device.',
  ],
  [
    'Can Envinity read my .env values?',
    'No. Encryption happens on your device and the key travels inside the QR code or unique code, not to our servers. We only store ciphertext we cannot decrypt.',
  ],
  [
    'What if someone sees my unique code?',
    'Codes are short-lived on Free and revocable on Pro. You can also make a ticket one-time, so it locks itself after the first person opens it.',
  ],
  [
    'Do my teammates need an account?',
    'They need the Envinity app to scan or enter a code. Pro workspaces add team roles so you can limit tickets to members only.',
  ],
  [
    'How long do Pro tickets last?',
    'Forever, until the owner deletes them. If you cancel your subscription, existing tickets fall back to the Free rules.',
  ],
]

function FAQSection() {
  const [open, setOpen] = useState(0)
  return (
    <section className="section" id="faq" aria-labelledby="faq-title">
      <div className="container">
        <div className="section-head">
          <Reveal as="span" className="eyebrow">
            FAQ
          </Reveal>
          <Reveal as="h2" id="faq-title" delay={0.05}>
            Questions, answered
          </Reveal>
        </div>
        <div className="faq">
          {QA.map(([q, a], i) => {
            const isOpen = open === i
            return (
              <Reveal key={q} className="faq-item" delay={i * 0.05}>
                <button
                  className="faq-q"
                  aria-expanded={isOpen}
                  aria-controls={`faq-${i}`}
                  onClick={() => setOpen(isOpen ? -1 : i)}
                >
                  <span className="faq-num">{String(i + 1).padStart(2, '0')}</span>
                  <span>{q}</span>
                  <motion.span animate={{ rotate: isOpen ? 180 : 0 }} transition={{ duration: 0.25 }} style={{ flexShrink: 0 }}>
                    <ChevronDown size={20} color="var(--fg-muted)" aria-hidden="true" />
                  </motion.span>
                </button>
                <AnimatePresence initial={false}>
                  {isOpen && (
                    <motion.div
                      id={`faq-${i}`}
                      initial={{ height: 0, opacity: 0 }}
                      animate={{ height: 'auto', opacity: 1 }}
                      exit={{ height: 0, opacity: 0 }}
                      transition={{ duration: 0.3, ease }}
                    >
                      <p className="faq-a">{a}</p>
                    </motion.div>
                  )}
                </AnimatePresence>
              </Reveal>
            )
          })}
        </div>
      </div>
    </section>
  )
}

/* ---------------- cta + footer ---------------- */
function PlayIcon() {
  return (
    <svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 3.5v17l9.5-8.5L4 3.5z" fill="#f3f2f2" />
      <path d="M4 3.5l9.5 8.5 3-2.7L6.2 2.4C5.3 1.9 4.6 2.4 4 3.5z" fill="#f3f2f2" fillOpacity=".7" />
      <path d="M4 20.5l9.5-8.5 3 2.7-10.3 6.9c-.9.5-1.6 0-2.2-1.1z" fill="#f3f2f2" fillOpacity=".5" />
      <path d="M16.5 9.3l3.3 1.9c1 .6 1 2 0 2.6l-3.3 1.9-3-2.7 3-3.7z" fill="#f3f2f2" fillOpacity=".85" />
    </svg>
  )
}

function CTASection() {
  return (
    <section className="section" id="download" aria-labelledby="cta-title">
      <div className="container">
        <motion.div
          className="cta dark"
          initial={{ opacity: 0, y: 40 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true, margin: '-80px' }}
          transition={{ duration: 0.8, ease }}
        >
          <div>
            <motion.div
              style={{ width: 64 }}
              initial={{ rotate: -20, scale: 0.6 }}
              whileInView={{ rotate: 0, scale: 1 }}
              viewport={{ once: true }}
              transition={{ type: 'spring', stiffness: 200, damping: 12, delay: 0.2 }}
            >
              <Logo size={64} />
            </motion.div>
            <h2 id="cta-title">
              Small teams. <br />
              <span className="grad">Serious secrets.</span>
            </h2>
            <p>Stop pasting API keys into group chats. Create your first ticket in under a minute. Free, no credit card required.</p>
            <div style={{ marginTop: 24, color: 'var(--fg-muted)', fontSize: 14, display: 'flex', gap: 8, alignItems: 'center' }}>
              <Users size={16} aria-hidden="true" /> Works for teams of 2 or 2,000
            </div>
          </div>
          <motion.div
            className="store-row"
            initial="h"
            whileInView="s"
            viewport={{ once: true }}
            variants={{ s: { transition: { staggerChildren: 0.1, delayChildren: 0.3 } } }}
          >
            {[
              [<Apple key="a" size={26} aria-hidden="true" />, 'Download on the', 'App Store'],
              [<PlayIcon key="p" />, 'Get it on', 'Google Play'],
              [<Laptop key="l" size={24} aria-hidden="true" />, 'Download for', 'macOS, Windows, Linux'],
            ].map(([icon, small, big]) => (
              <motion.a
                key={big}
                href="#download"
                className="store"
                variants={{ h: { opacity: 0, x: 24 }, s: { opacity: 1, x: 0 } }}
                whileHover={{ x: 4 }}
              >
                {icon}
                <span style={{ flex: 1 }}>
                  <small>{small}</small>
                  <strong>{big}</strong>
                </span>
                <ArrowUpRight size={18} aria-hidden="true" style={{ color: 'var(--accent)' }} />
              </motion.a>
            ))}
          </motion.div>
        </motion.div>
      </div>
    </section>
  )
}

export const Security = withMotion(SecuritySection)
export const Platforms = withMotion(PlatformsSection)
export const Pricing = withMotion(PricingSection)
export const FAQ = withMotion(FAQSection)
export const CTA = withMotion(CTASection)
