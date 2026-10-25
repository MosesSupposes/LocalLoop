import { useEffect, useState } from 'react'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { Empty, Pill, StatusTracker, btnGhost, btnPrimary, card } from '../components/ui'
import { paymentNote } from '../lib/chatbot'
import { STORE, smsHref, telHref } from '../lib/config'
import { money, orderCode } from '../lib/orders'
import { useStore } from '../lib/store'
import type { PublicOrder, Ticket } from '../lib/types'

export function OrderPage() {
  const { id } = useParams()
  const [params] = useSearchParams()
  const order = useStore((s) => s.myOrders.find((o) => o.id === id))
  const known = useStore((s) => (id ? !!s.myOrderTokens[id] : false))
  const adoptOrder = useStore((s) => s.adoptOrder)
  const createTicket = useStore((s) => s.createTicket)
  const [sent, setSent] = useState('')
  const [issue, setIssue] = useState('')
  const [err, setErr] = useState('')
  const t = params.get('t')

  useEffect(() => {
    if (id && t) void adoptOrder(id, t)
  }, [id, t, adoptOrder])

  if (!order) {
    return known || t ? <Empty emoji="⏳" title="Loading your order" /> : <Empty emoji="🔎" title="Order not found"><Link to="/orders" className="text-primary underline">Your orders</Link></Empty>
  }

  const d = order.driver
  return (
    <div className="mx-auto max-w-xl space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="font-display text-3xl font-extrabold">Order <span className="font-mono">{orderCode(order)}</span></h1>
        <Pill tone={order.paymentStatus === 'unpaid' ? 'sunset' : 'primary'}>{order.paymentStatus === 'unpaid' ? 'Payment pending' : order.paymentStatus === 'paid' ? 'Paid' : order.paymentStatus === 'refunded' ? 'Refunded' : 'Partly refunded'}</Pill>
      </div>
      <div className={card}><StatusTracker status={order.status} /></div>

      {order.paymentUrl && <a className={`${btnPrimary} w-full`} href={order.paymentUrl}>Pay now · {money(order.totalCents)}</a>}

      {d && (
        <div className={`${card} border-sky/50`}>
          <p className="text-sm text-muted">Your driver</p>
          <p className="text-xl font-bold">{d.name}</p>
          <div className="mt-2 flex gap-2">
            <a className={btnPrimary} href={telHref(d.phone)}>Call {d.phone}</a>
            <a className={btnGhost} href={smsHref(d.phone)}>Text</a>
          </div>
        </div>
      )}

      <div className={`${card} space-y-1`}>
        {order.items.map((i) => (
          <div key={i.productId} className="flex justify-between text-sm"><span>{i.qty} × {i.name}</span><span className="font-mono">{money(i.priceCents * i.qty)}</span></div>
        ))}
        <hr className="border-line" />
        <div className="flex justify-between font-bold"><span>Total</span><span className="font-mono">{money(order.totalCents)}</span></div>
        {order.refundedCents > 0 && <div className="flex justify-between text-sky"><span>Refunded</span><span className="font-mono">−{money(order.refundedCents)}</span></div>}
        <p className="pt-1 text-xs text-muted">{order.address}, {order.zip}</p>
      </div>

      {order.paymentStatus === 'unpaid' && order.status !== 'cancelled' && !order.paymentUrl && <p className="text-sm text-muted">{paymentNote(order)}</p>}
      {order.items.some((i) => i.restricted) && <p className="text-sm text-sunset">Have your 21+ ID and registry card ready at the door.</p>}

      <a className={`${btnGhost} w-full`} href={telHref(STORE.phone)}>Call the shop {STORE.phoneDisplay}</a>

      <details className={card}>
        <summary className="cursor-pointer font-semibold">Report a problem</summary>
        {sent ? (
          <p className="mt-2 text-primary">Ticket {sent} opened. We'll text you.</p>
        ) : (
          <form className="mt-3 space-y-2" onSubmit={async (e) => {
            e.preventDefault()
            const tk = await createTicket({ subject: issue, type: 'order_issue', phone: order.phone, name: order.customerName, orderId: order.id })
            if (tk) setSent(tk.id)
            else setErr('Could not open the ticket. Please call the shop.')
          }}>
            <textarea required minLength={4} rows={3} value={issue} onChange={(e) => setIssue(e.target.value)} aria-label="What went wrong?" placeholder="What went wrong?" />
            {err && <p role="alert" className="text-destructive">{err}</p>}
            <button className={btnPrimary} type="submit">Open ticket</button>
          </form>
        )}
      </details>
    </div>
  )
}

export function Orders() {
  const orders = useStore((s) => s.myOrders)
  const tickets = useStore((s) => s.myTickets)
  const customerReply = useStore((s) => s.customerReply)

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="font-display text-3xl font-extrabold">Your orders</h1>
      {orders.length === 0 ? <Empty emoji="📦" title="No orders yet">The block is sleeping.</Empty> : (
        <ul className="space-y-2">{orders.map((o) => <OrderRow key={o.id} o={o} />)}</ul>
      )}
      <p className="text-xs text-muted">Orders are saved on this device. Lost track? Call {STORE.phoneDisplay}.</p>
      {tickets.length > 0 && (
        <section className="space-y-2">
          <h2 className="font-display text-xl font-bold">Support tickets</h2>
          {tickets.map((t) => <TicketThread key={t.id} t={t} onReply={(text) => customerReply(t.id, text)} />)}
        </section>
      )}
    </div>
  )
}

function OrderRow({ o }: { o: PublicOrder }) {
  return (
    <li>
      <Link to={`/order/${o.id}`} className={`${card} flex items-center justify-between`}>
        <div>
          <p className="font-mono font-bold">{orderCode(o)}</p>
          <p className="text-sm text-muted">{new Date(o.createdAt).toLocaleString()} · {o.items.length} items</p>
        </div>
        <div className="text-right">
          <p className="font-mono">{money(o.totalCents)}</p>
          <Pill tone="primary">{o.status.replace(/_/g, ' ')}</Pill>
        </div>
      </Link>
    </li>
  )
}

function TicketThread({ t, onReply }: { t: Ticket; onReply: (s: string) => Promise<void> }) {
  const [text, setText] = useState('')
  return (
    <details className={card}>
      <summary className="flex cursor-pointer items-center justify-between">
        <span className="font-semibold">{t.id} · {t.subject}</span>
        <Pill tone={t.status === 'resolved' ? 'primary' : 'sunset'}>{t.status.replace('_', ' ')}</Pill>
      </summary>
      <div className="mt-3 space-y-2">
        {t.messages.map((m, i) => (
          <p key={i} className={`rounded-2xl px-3 py-2 text-sm ${m.from === 'customer' ? 'ml-8 bg-primary/15' : 'mr-8 bg-raised'}`}>{m.text}</p>
        ))}
        {t.status !== 'resolved' && (
          <form className="flex gap-2" onSubmit={async (e) => { e.preventDefault(); if (text.trim()) { await onReply(text); setText('') } }}>
            <input value={text} onChange={(e) => setText(e.target.value)} aria-label="Reply" placeholder="Reply" />
            <button className={btnPrimary}>Send</button>
          </form>
        )}
      </div>
    </details>
  )
}
