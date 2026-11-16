import { useState } from 'react'
import { AnimatePresence, motion, useMotionValueEvent, useScroll } from 'framer-motion'
import { Menu, X } from 'lucide-react'
import { Logo, ease, withMotion } from './shared'

const LINKS = [
  ['How it works', '#how'],
  ['Expiry', '#expiry'],
  ['Security', '#security'],
  ['Pricing', '#pricing'],
  ['FAQ', '#faq'],
]

function Nav() {
  const { scrollY, scrollYProgress } = useScroll()
  const [scrolled, setScrolled] = useState(false)
  const [open, setOpen] = useState(false)
  useMotionValueEvent(scrollY, 'change', (v) => setScrolled(v > 24))

  return (
    <>
      <motion.div className="scroll-progress" style={{ scaleX: scrollYProgress }} />
      <motion.header
        className={`nav ${scrolled || open ? 'scrolled' : ''}`}
        initial={{ y: -80, opacity: 0 }}
        animate={{ y: 0, opacity: 1 }}
        transition={{ duration: 0.7, ease }}
      >
        <nav className="container nav-inner" aria-label="Main">
          <a href="/" className="brand" aria-label="Envinity home">
            <Logo size={34} />
            Envinity
          </a>
          <div className="nav-links">
            {LINKS.map(([label, href]) => (
              <a key={href} href={href}>
                {label}
              </a>
            ))}
          </div>
          <div className="nav-cta">
            <a href="/dashboard" className="btn btn-ghost">
              Sign in
            </a>
            <a href="#download" className="btn btn-primary">
              Get the app
            </a>
            <button
              className="menu-btn"
              aria-label={open ? 'Close menu' : 'Open menu'}
              aria-expanded={open}
              onClick={() => setOpen((o) => !o)}
            >
              {open ? <X size={20} /> : <Menu size={20} />}
            </button>
          </div>
        </nav>
        <AnimatePresence>
          {open && (
            <motion.div
              className="mobile-menu"
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              exit={{ opacity: 0, height: 0 }}
              transition={{ duration: 0.25 }}
            >
              {LINKS.map(([label, href]) => (
                <a key={href} href={href} onClick={() => setOpen(false)}>
                  {label}
                </a>
              ))}
              <a href="#download" className="btn btn-primary" style={{ marginTop: 12, border: 0 }} onClick={() => setOpen(false)}>
                Get the app
              </a>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.header>
    </>
  )
}

export default withMotion(Nav)
