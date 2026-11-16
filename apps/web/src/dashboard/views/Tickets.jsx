import { useMemo, useState } from 'react'
import { AnimatePresence, motion } from 'framer-motion'
import { ChevronRight, Plus, Search, Ticket } from 'lucide-react'
import { fmtAgo, ticketStatus } from '../data'
import { go, useStore } from '../store'
import { EmptyState, ExpiryMeter, PageHeader, StatusBadge, ease } from '../ui'

const FILTERS = [
  ['all', 'All'],
  ['active', 'Active'],
  ['closed', 'Expired or revoked'],
]

export default function Tickets() {
  const { state } = useStore()
  const [filter, setFilter] = useState('all')
  const [q, setQ] = useState('')

  const list = useMemo(() => {
    const term = q.trim().toLowerCase()
    return state.tickets.filter((t) => {
      const s = ticketStatus(t, state.now)
      if (filter === 'active' && s !== 'active') return false
      if (filter === 'closed' && s === 'active') return false
      if (!term) return true
      return `${t.name} ${t.environment}`.toLowerCase().includes(term)
    })
  }, [state.tickets, state.now, filter, q])

  return (
    <>
      <PageHeader eyebrow="Your tickets" title="Tickets" sub="Each ticket is one encrypted .env with its own QR code and unique code.">
        <button className="btn btn-primary" onClick={() => go('/new')}>
          <Plus size={18} aria-hidden="true" /> New ticket
        </button>
      </PageHeader>

      <div className="toolbar">
        <div className="seg-tabs" role="tablist" aria-label="Filter tickets">
          {FILTERS.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={filter === k} className={filter === k ? 'on' : ''} onClick={() => setFilter(k)}>
              {filter === k && <motion.span layoutId="ticket-filter" className="seg-pill" transition={{ type: 'spring', stiffness: 420, damping: 34 }} />}
              <span>{l}</span>
            </button>
          ))}
        </div>
        <label className="search">
          <Search size={16} aria-hidden="true" />
          <span className="sr-only">Search tickets</span>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search by name or environment" />
        </label>
      </div>

      <div className="card table-card">
        <div className="t-row t-head" aria-hidden="true">
          <span>Ticket</span>
          <span>Type</span>
          <span>Expiry</span>
          <span>Opens</span>
          <span>Status</span>
          <span />
        </div>
        <AnimatePresence initial={false}>
          {list.map((t, i) => (
            <motion.button
              key={t.id}
              layout
              className="t-row"
              onClick={() => go(`/tickets/${t.id}`)}
              initial={{ opacity: 0, y: 10 }}
              animate={{ opacity: 1, y: 0, transition: { delay: i * 0.03, ease } }}
              exit={{ opacity: 0, transition: { duration: 0.15 } }}
            >
              <span className="t-name">
                <strong>{t.name}</strong>
                <span className="t-sub">
                  <span className="env-tag">{t.environment}</span> {t.varCount} vars · {fmtAgo(t.createdAt, state.now)}
                </span>
              </span>
              <span className="t-code">{t.oneTime ? 'One-time' : 'Multi-use'}</span>
              <span>
                <ExpiryMeter ticket={t} compact />
              </span>
              <span className="t-opens">{t.opens}</span>
              <span>
                <StatusBadge ticket={t} />
              </span>
              <ChevronRight size={18} className="t-chev" aria-hidden="true" />
            </motion.button>
          ))}
        </AnimatePresence>
        {list.length === 0 && (
          <EmptyState
            icon={Ticket}
            title={q ? 'No tickets match your search' : 'No tickets here yet'}
            action={
              !q && (
                <button className="btn btn-primary" onClick={() => go('/new')}>
                  <Plus size={18} aria-hidden="true" /> Create a ticket
                </button>
              )
            }
          >
            {q ? 'Try a different name, environment or code.' : 'Create a ticket to share a .env with your team.'}
          </EmptyState>
        )}
      </div>
    </>
  )
}
