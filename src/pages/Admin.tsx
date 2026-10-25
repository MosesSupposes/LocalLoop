import { useState } from 'react'
import { Navigate } from 'react-router-dom'
import { Empty, Pill, StatusTracker, btnGhost, btnPrimary, card } from '../components/ui'
import { STORE, smsHref, telHref } from '../lib/config'
import { money, nextStatuses, orderCode, refundableCents, STATUS_LABEL } from '../lib/orders'
import { useStore } from '../lib/store'
import type { Order, Ticket, TicketStatus } from '../lib/types'

type Tab = 'orders' | 'tickets' | 'dispatch' | 'catalog'

export function Admin() {
  const { me, meLoaded, logout, staffData } = useStore()
  const [tab, setTab] = useState<Tab>('orders')

  if (!meLoaded) return null
  if (!me || me.role !== 'admin') return <Navigate to="/staff" />
  const openTickets = staffData?.tickets.filter((t) => t.status !== 'resolved').length ?? 0
  const toPlace = staffData?.orders.filter((o) => o.status === 'placed').length ?? 0
  const tabs: [Tab, string][] = [['orders', `Orders${toPlace ? ` (${toPlace})` : ''}`], ['tickets', `Tickets${openTickets ? ` (${openTickets})` : ''}`], ['dispatch', 'Dispatch'], ['catalog', 'Catalog']]

  return (
    <div className="mx-auto min-h-dvh max-w-5xl px-4 pb-10">
      <header className="safe-top sticky top-0 z-20 -mx-4 border-b border-line bg-background/95 px-4 pb-2 backdrop-blur">
        <div className="flex items-center justify-between py-2">
          <h1 className="font-display text-xl font-extrabold sm:text-2xl">{STORE.name} <span className="text-primary">Admin</span></h1>
          <button className={btnGhost + ' !px-4 text-sm'} onClick={logout}>Sign out</button>
        </div>
        <div className="no-scrollbar flex gap-2 overflow-x-auto" role="tablist">
          {tabs.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={tab === id} onClick={() => setTab(id)} className={`shrink-0 rounded-full px-4 text-sm font-semibold ${tab === id ? 'bg-primary text-primary-foreground' : 'bg-surface'}`}>{label}</button>
          ))}
        </div>
      </header>
      <div className="pt-4">
        {!staffData ? <Empty emoji="⏳" title="Loading" /> : (
          <>
            {tab === 'orders' && <OrdersTab />}
            {tab === 'tickets' && <TicketsTab />}
            {tab === 'dispatch' && <DispatchTab />}
            {tab === 'catalog' && <CatalogTab />}
          </>
        )}
      </div>
    </div>
  )
}

export function OrderCard({ o, children }: { o: Order; children?: React.ReactNode }) {
  const staff = useStore((s) => s.staffData?.staff ?? [])
  const driver = staff.find((x) => x.id === o.driverId)
  return (
    <li className={`${card} space-y-3`}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="font-mono text-lg font-bold">{orderCode(o)} <span className="text-sm font-normal text-muted">via {o.source}</span></p>
        <div className="flex gap-1">
          <Pill tone={o.paymentStatus === 'paid' ? 'primary' : o.paymentStatus === 'unpaid' ? 'sunset' : 'sky'}>{payLabel(o)}</Pill>
          {o.items.some((i) => i.restricted) && <Pill tone="sunset">Med card {o.medCard}</Pill>}
        </div>
      </div>
      <StatusTracker status={o.status} />
      <div className="text-sm">
        <p>{o.customerName} · <a className="inline text-primary underline" href={telHref(o.phone)}>{o.phone}</a></p>
        <p className="text-muted">{o.address}, {o.zip}{o.notes ? ` · "${o.notes}"` : ''}</p>
        <p className="mt-1">{o.items.map((i) => `${i.qty}× ${i.name}`).join(', ')}</p>
        <p className="font-mono font-bold">{money(o.totalCents)}{o.tipCents ? ` (tip ${money(o.tipCents)})` : ''}</p>
        {driver && <p className="text-sky">Driver {driver.name}{o.batchId ? ` · batch ${o.batchId}` : ''}</p>}
      </div>
      {children}
    </li>
  )
}

function OrdersTab() {
  const orders = useStore((s) => s.staffData!.orders)
  const act = useStore((s) => s.act)
  const [err, setErr] = useState('')
  const [show, setShow] = useState<'active' | 'all'>('active')
  const list = orders.filter((o) => show === 'all' || !['delivered', 'cancelled'].includes(o.status))
  const run = async (path: string, body?: unknown) => setErr((await act(path, body)) ?? '')

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <button className={show === 'active' ? btnPrimary : btnGhost} onClick={() => setShow('active')}>Active</button>
        <button className={show === 'all' ? btnPrimary : btnGhost} onClick={() => setShow('all')}>All</button>
      </div>
      {err && <p role="alert" className="text-destructive">{err}</p>}
      {list.length === 0 ? <Empty emoji="🌙" title="No orders yet">The block is sleeping.</Empty> : (
        <ul className="space-y-3">
          {list.map((o) => (
            <OrderCard key={o.id} o={o}>
              <div className="flex flex-wrap gap-2">
                {nextStatuses(o.status).filter((s) => s !== 'out_for_delivery' && s !== 'delivered').map((s) => (
                  <button key={s} className={s === 'cancelled' ? `${btnGhost} text-destructive` : btnPrimary} onClick={() => run(`/orders/${o.id}/status`, { to: s })}>
                    {s === 'cancelled' ? 'Cancel' : `Mark ${STATUS_LABEL[s].toLowerCase()}`}
                  </button>
                ))}
                {o.paymentStatus === 'unpaid' && o.status !== 'cancelled' && <button className={btnGhost} onClick={() => run(`/orders/${o.id}/paid`)}>Mark paid</button>}
                <a className={btnGhost} href={smsHref(o.phone)}>Text customer</a>
              </div>
              <RefundPanel o={o} run={run} />
            </OrderCard>
          ))}
        </ul>
      )}
    </div>
  )
}

const TICKET_STATUS: TicketStatus[] = ['open', 'in_progress', 'resolved']

function RefundPanel({ o, run }: { o: Order; run: (path: string, body?: unknown) => Promise<void> }) {
  const allRefunds = useStore((s) => s.staffData!.refunds)
  const refunds = allRefunds.filter((r) => r.orderId === o.id)
  const [open, setOpen] = useState(false)
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const left = refundableCents(o)
  if (!left && !refunds.length) return null

  return (
    <div className="space-y-2 rounded-2xl bg-raised p-3 text-sm">
      {refunds.map((r) => (
        <div key={r.id} className="flex flex-wrap items-center justify-between gap-2" data-testid="refund-row">
          <span>Refund {money(r.amountCents)} · {r.reason}</span>
          <span className="flex items-center gap-2">
            <Pill tone={r.status === 'completed' ? 'primary' : r.status === 'failed' ? 'danger' : 'sunset'}>{r.status.replace('_', ' ')}</Pill>
            {r.status === 'pending_manual' && <button className={`${btnGhost} !px-3 text-xs`} onClick={() => run(`/refunds/${r.id}/complete`)}>Mark sent</button>}
          </span>
        </div>
      ))}
      {left > 0 && !open && <button className={btnGhost} onClick={() => { setOpen(true); setAmount((left / 100).toFixed(2)) }}>Refund (up to {money(left)})</button>}
      {left > 0 && open && (
        <form className="space-y-2" onSubmit={async (e) => {
          e.preventDefault()
          const cents = Math.round(Number(amount) * 100)
          await run(`/orders/${o.id}/refund`, { amountCents: cents, reason })
          setOpen(false)
          setReason('')
        }}>
          <input aria-label="Refund amount" inputMode="decimal" required value={amount} onChange={(e) => setAmount(e.target.value)} />
          <input aria-label="Refund reason" required minLength={3} value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Reason (kept in the audit trail)" />
          <div className="flex gap-2">
            <button className={btnPrimary}>Issue refund</button>
            <button type="button" className={btnGhost} onClick={() => setOpen(false)}>Cancel</button>
          </div>
          <p className="text-xs text-muted">Card orders refund through Stripe. Cash and Bitcoin refunds are marked pending until you confirm they were sent.</p>
        </form>
      )}
    </div>
  )
}

function payLabel(o: Order) {
  if (o.paymentStatus === 'unpaid') return `Unpaid · ${o.payment}`
  if (o.paymentStatus === 'paid') return 'Paid'
  return o.paymentStatus === 'refunded' ? 'Refunded' : `Part refunded ${money(o.refundedCents)}`
}

function TicketsTab() {
  const tickets = useStore((s) => s.staffData!.tickets)
  const staff = useStore((s) => s.staffData!.staff)
  const act = useStore((s) => s.act)
  const [filter, setFilter] = useState<TicketStatus | 'all'>('all')
  const [sel, setSel] = useState<string | null>(null)
  const [text, setText] = useState('')
  const list = tickets.filter((t) => filter === 'all' || t.status === filter)
  const t: Ticket | undefined = tickets.find((x) => x.id === sel)

  return (
    <div className="grid gap-4 md:grid-cols-[320px_1fr]">
      <div className="space-y-2">
        <div className="no-scrollbar flex gap-2 overflow-x-auto">
          {(['all', ...TICKET_STATUS] as const).map((f) => (
            <button key={f} onClick={() => setFilter(f)} className={`shrink-0 rounded-full px-3 text-sm ${filter === f ? 'bg-primary text-primary-foreground' : 'bg-surface'}`}>{f.replace('_', ' ')}</button>
          ))}
        </div>
        {list.length === 0 ? <Empty emoji="🎟️" title="No tickets">Customers open them from the chatbot or an order.</Empty> : (
          <ul className="space-y-2">
            {list.map((x) => (
              <li key={x.id}>
                <button onClick={() => setSel(x.id)} className={`${card} w-full text-left ${sel === x.id ? 'border-primary' : ''}`}>
                  <div className="flex justify-between"><b className="font-mono">{x.id}</b><Pill tone={x.status === 'resolved' ? 'primary' : x.priority === 'high' ? 'danger' : 'sunset'}>{x.status.replace('_', ' ')}</Pill></div>
                  <p className="line-clamp-2 text-sm">{x.subject}</p>
                  <p className="text-xs text-muted">{x.customerName} · {x.type.replace('_', ' ')}</p>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {t ? (
        <section className={`${card} space-y-3`}>
          <div className="flex flex-wrap items-center justify-between gap-2">
            <h2 className="font-display text-xl font-bold">{t.id} · {t.subject}</h2>
            <a className="inline text-primary underline" href={telHref(t.phone)}>{t.phone}</a>
          </div>
          <div className="flex flex-wrap gap-2">
            <select aria-label="Status" className="!w-auto" value={t.status} onChange={(e) => act(`/tickets/${t.id}/status`, { status: e.target.value })}>
              {TICKET_STATUS.map((s) => <option key={s} value={s}>{s.replace('_', ' ')}</option>)}
            </select>
            <select aria-label="Assignee" className="!w-auto" value={t.assigneeId ?? ''} onChange={(e) => act(`/tickets/${t.id}/assign`, { assigneeId: e.target.value || null })}>
              <option value="">Unassigned</option>
              {staff.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
            {t.orderId && <Pill tone="sky">Order {t.orderId}</Pill>}
          </div>
          <div className="space-y-2">
            {t.messages.map((m, i) => (
              <p key={i} className={`rounded-2xl px-3 py-2 text-sm ${m.from === 'customer' ? 'mr-8 bg-raised' : 'ml-8 bg-primary/15'}`}><b className="text-xs uppercase text-muted">{m.from}</b><br />{m.text}</p>
            ))}
          </div>
          <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (text.trim()) { await act(`/tickets/${t.id}/reply`, { text }); setText('') } }}>
            <input aria-label="Reply" value={text} onChange={(e) => setText(e.target.value)} placeholder="Reply to customer" />
            <button className={btnPrimary}>Send</button>
          </form>
        </section>
      ) : <Empty emoji="👈" title="Pick a ticket" />}
    </div>
  )
}

function DispatchTab() {
  const { orders, staff } = useStore((s) => s.staffData!)
  const act = useStore((s) => s.act)
  const [msg, setMsg] = useState('')
  const drivers = staff.filter((s) => s.role === 'employee')
  const open = orders.filter((o) => ['accepted', 'ready'].includes(o.status))
  const unassigned = open.filter((o) => !o.driverId)

  return (
    <div className="space-y-5">
      <section>
        <h2 className="mb-2 font-display text-xl font-bold">Drivers</h2>
        <ul className="grid gap-2 sm:grid-cols-2">
          {drivers.map((d) => (
            <li key={d.id} className={`${card} flex items-center justify-between`}>
              <div><p className="font-semibold">{d.name}</p><p className="font-mono text-xs text-muted">{d.phone}</p></div>
              <button className={d.onShift ? btnPrimary : btnGhost} aria-pressed={d.onShift} onClick={() => act(`/staff/${d.id}/shift`)}>{d.onShift ? 'On shift' : 'Off'}</button>
            </li>
          ))}
        </ul>
      </section>
      <section className="space-y-2">
        <div className="flex items-center justify-between">
          <h2 className="font-display text-xl font-bold">Unassigned ({unassigned.length})</h2>
          <button className="inline-flex items-center justify-center rounded-full bg-sunset px-5 font-semibold text-primary-foreground disabled:opacity-40" disabled={!unassigned.length} onClick={async () => {
            const e = await act('/dispatch/auto')
            setMsg(e ?? 'Batches updated.')
          }}>Auto-batch</button>
        </div>
        {msg && <p className="text-sm text-primary" role="status">{msg}</p>}
        <p className="text-sm text-muted">Batches group accepted orders by ZIP, up to {STORE.maxBatchSize} stops, and go to the least-loaded driver on shift.</p>
        {open.length === 0 ? <Empty emoji="🛵" title="Nothing to dispatch" /> : (
          <ul className="space-y-2">
            {open.map((o) => (
              <li key={o.id} className={`${card} flex flex-wrap items-center justify-between gap-2`}>
                <div><b className="font-mono">{orderCode(o)}</b> <span className="text-sm text-muted">{o.zip} · {o.address}</span>{o.batchId && <Pill tone="sky">{o.batchId}</Pill>}</div>
                <select aria-label={`Driver for ${o.id}`} className="!w-auto" value={o.driverId ?? ''} onChange={(e) => act(`/orders/${o.id}/assign`, { driverId: e.target.value || null })}>
                  <option value="">Unassigned</option>
                  {drivers.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
                </select>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  )
}

function CatalogTab() {
  const products = useStore((s) => s.products)
  const setStock = useStore((s) => s.setStock)
  return (
    <ul className="grid gap-2 md:grid-cols-2">
      {products.map((p) => (
        <li key={p.id} className={`${card} flex items-center justify-between gap-2`}>
          <div><p className="font-semibold">{p.emoji} {p.name}</p><p className="font-mono text-xs text-muted">{money(p.priceCents)}</p></div>
          <div className="flex items-center gap-2">
            <button className={`${btnGhost} !w-11 !px-0`} aria-label={`Decrease ${p.name} stock`} onClick={() => setStock(p.id, p.stock - 1)}>−</button>
            <span className="w-8 text-center font-mono">{p.stock}</span>
            <button className={`${btnGhost} !w-11 !px-0`} aria-label={`Increase ${p.name} stock`} onClick={() => setStock(p.id, p.stock + 1)}>+</button>
          </div>
        </li>
      ))}
    </ul>
  )
}
