import { AnimatePresence, MotionConfig, motion } from 'framer-motion'
import { KeyRound, LayoutGrid, LogOut, Plus, Settings as SettingsIcon, ShieldAlert, Sparkles, Ticket } from 'lucide-react'
import { Logo } from '../components/shared'
import '../styles/dashboard.css'
import { Loading, MfaChallenge, SignIn, Unlock } from './AuthScreens'
import { StoreProvider, go, useRoute, useStore } from './store'
import { Toasts, ease } from './ui'
import NewTicket from './views/NewTicket'
import OpenCode, { OpenLink } from './views/OpenCode'
import Overview from './views/Overview'
import Settings from './views/Settings'
import TicketDetail from './views/TicketDetail'
import Tickets from './views/Tickets'

const NAV = [
  { path: '/', name: 'overview', label: 'Overview', Icon: LayoutGrid },
  { path: '/tickets', name: 'tickets', label: 'Tickets', Icon: Ticket, match: ['ticket'] },
  { path: '/new', name: 'new', label: 'New ticket', Icon: Plus },
  { path: '/open', name: 'open', label: 'Open a code', Icon: KeyRound, match: ['qr'] },
  { path: '/settings', name: 'settings', label: 'Settings', Icon: SettingsIcon },
]

const isActive = (item, route) => item.name === route.name || item.match?.includes(route.name)
const initials = (name = '') =>
  name
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase()

function Sidebar({ route }) {
  const { state, auth } = useStore()
  const { user, twoFactor } = state.session
  return (
    <aside className="sidebar" aria-label="Dashboard">
      <a href="/" className="brand side-brand" aria-label="Envinity home">
        <Logo size={32} animate={false} /> Envinity
      </a>
      <nav className="side-nav">
        {NAV.map((item) => {
          const on = isActive(item, route)
          return (
            <a key={item.path} href={`#${item.path}`} className={on ? 'on' : ''} aria-current={on ? 'page' : undefined}>
              {on && <motion.span layoutId="side-active" className="side-active" transition={{ type: 'spring', stiffness: 420, damping: 36 }} />}
              <item.Icon size={18} aria-hidden="true" />
              <span>{item.label}</span>
            </a>
          )
        })}
      </nav>
      <div className="side-foot">
        {!twoFactor.enabled && (
          <a href="#/settings" className="card mfa-nudge">
            <ShieldAlert size={18} aria-hidden="true" />
            <span>
              <strong>Turn on 2FA</strong>
              <span>Protect your vault with an authenticator app.</span>
            </span>
          </a>
        )}
        {state.plan === 'free' ? (
          <div className="card dark upsell">
            <Sparkles size={18} aria-hidden="true" style={{ color: 'var(--accent)' }} />
            <strong>Keep tickets forever</strong>
            <span>Pro tickets stay until you delete them.</span>
            <button className="btn btn-primary" onClick={() => go('/settings')}>
              Upgrade
            </button>
          </div>
        ) : (
          <div className="plan-pill">
            <span className="badge ok">Pro</span> Tickets kept until deleted
          </div>
        )}
        <div className="side-user">
          <span className="avatar-sm">{initials(user.name)}</span>
          <span className="side-user-text">
            <strong>{user.name}</strong>
            <span>{user.email}</span>
          </span>
          <button className="icon-btn" aria-label="Sign out" onClick={auth.logout}>
            <LogOut size={16} />
          </button>
        </div>
      </div>
    </aside>
  )
}

function BottomNav({ route }) {
  return (
    <nav className="bottom-nav" aria-label="Dashboard">
      {NAV.map((item) => {
        const on = isActive(item, route)
        return (
          <a key={item.path} href={`#${item.path}`} className={`${on ? 'on' : ''} ${item.name === 'new' ? 'fab' : ''}`} aria-current={on ? 'page' : undefined}>
            <item.Icon size={item.name === 'new' ? 22 : 20} aria-hidden="true" />
            <span className={item.name === 'new' ? 'sr-only' : ''}>{item.label.replace(' a code', '')}</span>
          </a>
        )
      })}
    </nav>
  )
}

function View({ route }) {
  switch (route.name) {
    case 'tickets':
      return <Tickets />
    case 'ticket':
      return <TicketDetail id={route.id} />
    case 'new':
      return <NewTicket />
    case 'open':
      return <OpenCode />
    case 'qr':
      return <OpenLink id={route.id} ticketKey={route.key} />
    case 'settings':
      return <Settings />
    default:
      return <Overview />
  }
}

function Shell() {
  const route = useRoute()
  const { state, auth } = useStore()
  // During the sign-out exit animation this stays mounted for a moment after the session is gone.
  if (!state.session) return null
  const { user } = state.session
  return (
    <div className="dash">
      <a href="#dash-main" className="sr-only">
        Skip to content
      </a>
      <Sidebar route={route} />
      <div className="dash-main-wrap">
        <header className="mobile-top">
          <a href="/" className="brand" aria-label="Envinity home">
            <Logo size={28} animate={false} /> Envinity
          </a>
          <button className="avatar-sm" aria-label={`Sign out ${user.name}`} title="Sign out" onClick={auth.logout}>
            {initials(user.name)}
          </button>
        </header>
        <main id="dash-main" className="dash-main">
          <AnimatePresence mode="wait">
            <motion.div
              key={route.name + (route.id || '')}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8, transition: { duration: 0.15 } }}
              transition={{ duration: 0.35, ease }}
            >
              <View route={route} />
            </motion.div>
          </AnimatePresence>
        </main>
      </div>
      <BottomNav route={route} />
    </div>
  )
}

function Gate() {
  const { state } = useStore()
  const screen = {
    loading: <Loading />,
    signedOut: <SignIn />,
    mfa: <MfaChallenge />,
    locked: <Unlock />,
    ready: <Shell />,
  }[state.phase]
  return (
    <>
      <AnimatePresence mode="wait">
        <motion.div key={state.phase} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, transition: { duration: 0.12 } }}>
          {screen}
        </motion.div>
      </AnimatePresence>
      <Toasts />
    </>
  )
}

export default function Dashboard() {
  return (
    <MotionConfig reducedMotion="user">
      <StoreProvider>
        <Gate />
      </StoreProvider>
    </MotionConfig>
  )
}
