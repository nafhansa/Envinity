import { motion } from 'framer-motion'
import { ArrowUpRight, Ban, Eye, Flame, KeyRound, Plus, ShieldCheck, Sparkles, Ticket } from 'lucide-react'
import { activityKind, activityText, fmtAgo, ticketStatus } from '../data'
import { go, useStore } from '../store'
import { EmptyState, ExpiryMeter, PageHeader, Stat, ease } from '../ui'

const KIND_ICON = { create: Ticket, open: Eye, expire: Flame, revoke: Ban, delete: Ban, plan: Sparkles, security: ShieldCheck }

function greeting(now) {
  const h = new Date(now).getHours()
  return h < 11 ? 'Good morning' : h < 15 ? 'Good afternoon' : h < 19 ? 'Good evening' : 'Good night'
}

export default function Overview() {
  const { state } = useStore()
  const { tickets, now, activity, plan, session } = state
  const firstName = session.user.name.split(' ')[0]
  const active = tickets.filter((t) => ticketStatus(t, now) === 'active')
  const expiring = active.filter((t) => t.expiresAt !== null).sort((a, b) => a.expiresAt - b.expiresAt)
  const week = 7 * 24 * 60 * 60 * 1000
  const opens = activity.filter((a) => a.action === 'ticket.opened' && now - a.at < week).length
  const vars = active.reduce((n, t) => n + t.varCount, 0)

  return (
    <>
      <PageHeader
        eyebrow={session.tenant.name}
        title={`${greeting(now)}, ${firstName}.`}
        sub="Every ticket you share, who opened it, and how long it has left."
      >
        <button className="btn btn-ghost" onClick={() => go('/open')}>
          <KeyRound size={17} aria-hidden="true" /> Open a code
        </button>
        <button className="btn btn-primary" onClick={() => go('/new')}>
          <Plus size={18} aria-hidden="true" /> New ticket
        </button>
      </PageHeader>

      <div className="stats">
        <Stat index={0} label="Active tickets" value={active.length} hint={`${vars} variables shared`} />
        <Stat index={1} label="Expiring soon" value={expiring.length} hint="Within the next 10 minutes" tone={expiring.length ? 'warn' : ''} />
        <Stat index={2} label="Opens this week" value={opens} hint="By QR and by code" />
        <Stat
          index={3}
          label="Plan"
          value={plan === 'pro' ? 'Pro' : 'Free'}
          hint={plan === 'pro' ? 'Tickets kept until you delete them' : 'Tickets self-destruct after 10 min'}
          tone="dark"
        />
      </div>

      <div className="two-col">
        <motion.section
          className="card panel"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.25, duration: 0.5, ease }}
          aria-labelledby="exp-title"
        >
          <div className="panel-head">
            <h2 id="exp-title">Expiring soon</h2>
            <button className="link-btn" onClick={() => go('/tickets')}>
              All tickets <ArrowUpRight size={15} aria-hidden="true" />
            </button>
          </div>
          {expiring.length === 0 ? (
            <EmptyState icon={Ticket} title="Nothing is about to expire">
              Tickets with a 10 minute timer show up here so you can see them run out.
            </EmptyState>
          ) : (
            <ul className="plain-list">
              {expiring.map((t) => (
                <li key={t.id}>
                  <button className="row-btn" onClick={() => go(`/tickets/${t.id}`)}>
                    <span className="row-main">
                      <strong>{t.name}</strong>
                      <span className="env-tag">{t.environment}</span>
                    </span>
                    <ExpiryMeter ticket={t} />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </motion.section>

        <motion.section
          className="card panel"
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.32, duration: 0.5, ease }}
          aria-labelledby="act-title"
        >
          <div className="panel-head">
            <h2 id="act-title">Recent activity</h2>
          </div>
          <ul className="activity">
            {activity.length === 0 && <li className="muted-note">Nothing yet. Create your first ticket to see activity here.</li>}
            {activity.slice(0, 7).map((a) => {
              const kind = a.action.startsWith('auth.') ? 'security' : activityKind(a.action)
              const Icon = KIND_ICON[kind] || Ticket
              return (
                <motion.li key={a.id} layout initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                  <span className={`act-icon ${kind}`}>
                    <Icon size={14} aria-hidden="true" />
                  </span>
                  <span className="act-text">{activityText(a, session.user.email)}</span>
                  <span className="act-time">{fmtAgo(a.at, now)}</span>
                </motion.li>
              )
            })}
          </ul>
        </motion.section>
      </div>
    </>
  )
}
