import { useEffect, useMemo, useRef, useState } from 'react'
import { MotionConfig, motion, useInView, useReducedMotion } from 'framer-motion'

export const ease = [0.22, 1, 0.36, 1]

export const ENV_LINES = [
  ['DATABASE_URL', 'postgres://app:s3cr3t@db.internal:5432/prod'],
  ['STRIPE_SECRET_KEY', 'sk_live_51Hx9aQ2eZvKYlo2C8f'],
  ['JWT_SECRET', 'b7f1c9e2a04d4e6f9a1c'],
  ['REDIS_URL', 'redis://cache.internal:6379'],
  ['OPENAI_API_KEY', 'sk-proj-4f8a2c91e7b3'],
  ['S3_BUCKET', 'envinity-assets-prod'],
]

const GLYPHS = 'ABCDEF0123456789abcdef+/=#$%&@'

/** Brand mark: a sealed hexagon with an "S" (Securinity) on the brand orange. */
export function Logo({ size = 32, animate = true }) {
  const reduce = useReducedMotion()
  const draw = animate && !reduce
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true">
      <rect width="64" height="64" rx="6" fill="#E63B0F" />
      <motion.path
        d="M32 11 L50.2 21.5 V42.5 L32 53 L13.8 42.5 V21.5 Z"
        fill="none"
        stroke="#ffffff"
        strokeWidth="3.6"
        strokeLinejoin="round"
        initial={draw ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ duration: 1.1, ease }}
      />
      <motion.path
        d="M39.5 24.5 H29 a5.25 5.25 0 0 0 0 10.5 H35 a5.25 5.25 0 0 1 0 10.5 H24.5"
        fill="none"
        stroke="#ffffff"
        strokeWidth="4"
        strokeLinecap="round"
        strokeLinejoin="round"
        initial={draw ? { pathLength: 0 } : false}
        animate={{ pathLength: 1 }}
        transition={{ duration: 0.9, delay: 0.6, ease }}
      />
    </svg>
  )
}

/** Deterministic QR-looking SVG. Purely decorative. */
export function FakeQR({ size = 120, seed = 7, draw = true, color = '#201e1d' }) {
  const reduce = useReducedMotion()
  const n = 25
  const cells = useMemo(() => {
    let s = seed
    const rand = () => {
      s = (s * 9301 + 49297) % 233280
      return s / 233280
    }
    const out = []
    const inFinder = (x, y) =>
      (x < 8 && y < 8) || (x > n - 9 && y < 8) || (x < 8 && y > n - 9)
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        if (inFinder(x, y)) continue
        if (rand() > 0.52) out.push([x, y])
      }
    }
    return out
  }, [seed])
  const finder = (x, y) => (
    <g key={`${x}-${y}`}>
      <rect x={x} y={y} width="7" height="7" rx="1.4" fill={color} />
      <rect x={x + 1} y={y + 1} width="5" height="5" rx="1" fill="#ffffff" />
      <rect x={x + 2} y={y + 2} width="3" height="3" rx="0.6" fill={color} />
    </g>
  )
  return (
    <svg width={size} height={size} viewBox={`0 0 ${n} ${n}`} role="img" aria-label="QR code">
      {finder(0, 0)}
      {finder(n - 7, 0)}
      {finder(0, n - 7)}
      {cells.map(([x, y], i) => (
        <motion.rect
          key={i}
          x={x + 0.08}
          y={y + 0.08}
          width="0.84"
          height="0.84"
          rx="0.2"
          fill={color}
          initial={draw && !reduce ? { opacity: 0, scale: 0 } : false}
          animate={{ opacity: 1, scale: 1 }}
          transition={{ delay: draw ? (x + y) * 0.018 : 0, duration: 0.25 }}
          style={{ transformOrigin: `${x + 0.5}px ${y + 0.5}px` }}
        />
      ))}
    </svg>
  )
}

/** Text that scrambles into ciphertext (or back) when `active` flips. */
export function Scramble({ text, active, className, duration = 900 }) {
  const reduce = useReducedMotion()
  const target = useMemo(() => {
    if (!active) return text
    let h = 0
    for (const c of text) h = (h * 31 + c.charCodeAt(0)) >>> 0
    return Array.from({ length: Math.min(text.length, 26) }, () => {
      h = (h * 1103515245 + 12345) >>> 0
      return GLYPHS[(h >>> 8) % GLYPHS.length]
    }).join('')
  }, [text, active])
  const [out, setOut] = useState(target)
  useEffect(() => {
    if (reduce) {
      setOut(target)
      return
    }
    const start = performance.now()
    let raf
    const tick = (t) => {
      const p = Math.min(1, (t - start) / duration)
      const reveal = Math.floor(p * target.length)
      let s = target.slice(0, reveal)
      for (let i = reveal; i < target.length; i++) {
        s += GLYPHS[Math.floor(Math.random() * GLYPHS.length)]
      }
      setOut(s)
      if (p < 1) raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [target, duration, reduce])
  return <span className={className}>{out}</span>
}

/** Fade-and-rise when scrolled into view. */
export function Reveal({ children, delay = 0, y = 28, className, as = 'div', ...rest }) {
  const Comp = motion[as]
  return (
    <Comp
      className={className}
      initial={{ opacity: 0, y }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-80px' }}
      transition={{ duration: 0.7, delay, ease }}
      {...rest}
    >
      {children}
    </Comp>
  )
}

/** Countdown that runs in "fast forward" so 10 minutes plays out in a few seconds. */
export function useFastCountdown({ from = 600, seconds = 9, running = true, loopPause = 2600 }) {
  const [left, setLeft] = useState(from)
  const ref = useRef()
  useEffect(() => {
    if (!running) return
    let raf
    let start = performance.now()
    let doneAt = null
    const tick = (t) => {
      if (doneAt !== null) {
        if (t - doneAt > loopPause) {
          doneAt = null
          start = t
          setLeft(from)
        }
      } else {
        const p = Math.min(1, (t - start) / (seconds * 1000))
        const v = Math.round(from * (1 - p))
        setLeft(v)
        if (p >= 1) doneAt = t
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    ref.current = raf
    return () => cancelAnimationFrame(raf)
  }, [from, seconds, running, loopPause])
  return left
}

export const fmt = (s) =>
  `${String(Math.floor(s / 60)).padStart(2, '0')}:${String(s % 60).padStart(2, '0')}`

export function useInViewOnce(ref, margin = '-100px') {
  return useInView(ref, { margin })
}

/**
 * Every Astro island is its own React root, so each one gets its own MotionConfig.
 * reducedMotion="user" makes framer-motion honour the OS "reduce motion" setting.
 */
export function withMotion(Component) {
  function WithMotion(props) {
    return (
      <MotionConfig reducedMotion="user">
        <Component {...props} />
      </MotionConfig>
    )
  }
  WithMotion.displayName = `withMotion(${Component.name})`
  return WithMotion
}
