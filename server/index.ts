import { existsSync } from 'node:fs'
import { join } from 'node:path'
import express, { type NextFunction, type Request, type Response } from 'express'
import { z } from 'zod'
import { buildBatches } from '../src/lib/batching'
import { STORE } from '../src/lib/config'
import { canTransition, hasRestricted, inDeliveryZone, money, normalizePhone, paymentStatusAfterRefund, priceCart, refundableCents, subtotalOf, toOrderItems } from '../src/lib/orders'
import type { Order, OrderStatus, PublicOrder, StaffState } from '../src/lib/types'
import { attachStaff, COOKIE, endSession, issueOtp, newToken, readCookie, requireRole, safeEqual, verifyOtp } from './auth'
import { mapOrder, mapProduct, mapRefund, mapStaff, mapTicket, q, tx } from './db'
import { createPaymentUrl, handleBtcpayWebhook, handleStripeWebhook, paymentsConfigured, refundStripe, stripeEnabled } from './payments'
import { rateLimit, sendSms } from './util'

const app = express()
app.set('trust proxy', 1)
const prod = process.env.NODE_ENV === 'production'

app.use((_req, res, next) => {
  res.set({ 'X-Content-Type-Options': 'nosniff', 'X-Frame-Options': 'DENY', 'Referrer-Policy': 'same-origin' })
  next()
})

// Webhooks need the raw body for signature checks, so they come before express.json().
app.post('/api/public/stripe-webhook', express.raw({ type: '*/*' }), (req, res) => {
  const r = handleStripeWebhook(req.body as Buffer, req.header('stripe-signature'))
  res.status(r.status).send(r.body)
})
app.post('/api/public/btcpay-webhook', express.raw({ type: '*/*' }), (req, res) => {
  const r = handleBtcpayWebhook(req.body as Buffer, req.header('btcpay-sig'))
  res.status(r.status).send(r.body)
})

app.use(express.json({ limit: '50kb' }))
app.use(attachStaff)

const bad = (res: Response, msg: string, code = 400) => void res.status(code).json({ error: msg })
const parse = <T extends z.ZodType>(schema: T, body: unknown, res: Response): z.infer<T> | null => {
  const r = schema.safeParse(body)
  if (!r.success) {
    bad(res, r.error.issues[0]?.message ?? 'Invalid request.')
    return null
  }
  return r.data
}

const phoneSchema = z.string().transform((s, ctx) => {
  const p = normalizePhone(s)
  if (!p) ctx.addIssue({ code: 'custom', message: 'Enter a valid US phone number.' })
  return p ?? ''
})

// ---------- Public catalog ----------
app.get('/api/products', (_req, res) => {
  res.json({ products: q.all('SELECT * FROM products ORDER BY rowid').map(mapProduct), payments: paymentsConfigured() })
})

// ---------- Orders (customer) ----------
const orderSchema = z.object({
  items: z.array(z.object({ productId: z.string().max(20), qty: z.number().int().min(1).max(20) })).min(1).max(40),
  name: z.string().trim().min(1).max(80),
  phone: phoneSchema,
  address: z.string().trim().min(5).max(160),
  zip: z.string().regex(/^\d{5}$/, 'ZIP must be 5 digits.'),
  payment: z.enum(['card', 'btc', 'cash']),
  tipCents: z.number().int().min(0).max(10_000).default(0),
  medCard: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(300).optional(),
  source: z.enum(['web', 'chat']).default('web'),
})

function publicOrder(o: Order, paymentUrl: string | null): PublicOrder {
  const { medCard, driverId, batchId, idChecked, ...rest } = o
  const d = o.status === 'out_for_delivery' && driverId ? q.get('SELECT name, phone FROM staff WHERE id = ?', driverId) : undefined
  return { ...rest, driver: d ? { name: d.name as string, phone: d.phone as string } : undefined, paymentUrl: o.paymentStatus === 'unpaid' && o.status !== 'cancelled' ? paymentUrl ?? undefined : undefined }
}

const loadOrder = (id: string) => {
  const r = q.get('SELECT * FROM orders WHERE id = ?', id)
  return r ? { order: mapOrder(r), token: r.token as string, paymentUrl: (r.payment_url as string | null) } : null
}

app.post('/api/orders', rateLimit(10, 60_000), async (req, res) => {
  const d = parse(orderSchema, req.body, res)
  if (!d) return
  if (!inDeliveryZone(d.zip)) return bad(res, `We don't deliver to ${d.zip} yet.`)

  let created: { id: string; token: string } | string
  try {
    created = tx(() => {
      const products = q.all('SELECT * FROM products').map(mapProduct)
      const merged = new Map<string, number>()
      for (const l of d.items) merged.set(l.productId, (merged.get(l.productId) ?? 0) + l.qty)
      const lines = [...merged].map(([productId, qty]) => ({ productId, qty }))
      const items = toOrderItems(lines, products)
      if (items.length !== lines.length) return 'Some items are no longer available.'
      const subtotal = subtotalOf(items)
      if (subtotal < STORE.minOrderCents) return 'Minimum order is $20.00.'
      if (hasRestricted(items) && (d.medCard ?? '').length < 4) return 'A Delaware medical registry card number is required for medicinal herbs.'
      for (const i of items) {
        if (q.run('UPDATE products SET stock = stock - ? WHERE id = ? AND stock >= ?', i.qty, i.productId, i.qty).changes !== 1) return `${i.name} is sold out or low on stock.`
      }
      const p = priceCart(subtotal, d.tipCents)
      const token = newToken()
      const r = q.run(
        `INSERT INTO orders (token, customer_name, phone, address, zip, items, subtotal_cents, delivery_fee_cents, service_fee_cents, tip_cents, total_cents, payment, payment_status, status, med_card, notes, source, created_at)
         VALUES (?,?,?,?,?,?,?,?,?,?,?,?, 'unpaid', 'placed', ?,?,?,?)`,
        token, d.name, d.phone, d.address, d.zip, JSON.stringify(items), p.subtotalCents, p.deliveryFeeCents, p.serviceFeeCents, p.tipCents, p.totalCents,
        d.payment, d.medCard ?? null, d.notes ?? null, d.source, Date.now(),
      )
      const id = `SM${r.lastInsertRowid}`
      q.run('UPDATE orders SET id = ? WHERE seq = ?', id, Number(r.lastInsertRowid))
      return { id, token }
    })
  } catch (e) {
    console.error(e)
    return bad(res, 'Could not place the order.', 500)
  }
  if (typeof created === 'string') return bad(res, created, 409)

  const { order } = loadOrder(created.id)!
  let url: string | null = null
  try {
    url = await createPaymentUrl(order, created.token)
    if (url) q.run('UPDATE orders SET payment_url = ? WHERE id = ?', url, order.id)
  } catch (e) {
    console.error('payment link failed', e)
  }
  res.status(201).json({ order: publicOrder(order, url), token: created.token })
})

const tokenParam = z.object({ token: z.string().min(10).max(100) })
app.get('/api/orders/:id', rateLimit(60, 60_000), (req, res) => {
  const t = tokenParam.safeParse(req.query)
  const found = loadOrder(req.params.id as string)
  if (!t.success || !found || !safeEqual(found.token, t.data.token)) return bad(res, 'Order not found.', 404)
  res.json({ order: publicOrder(found.order, found.paymentUrl) })
})

const refs = z.object({
  orders: z.array(z.object({ id: z.string().max(20), token: z.string().max(100) })).max(50).default([]),
  tickets: z.array(z.object({ id: z.string().max(20), token: z.string().max(100) })).max(50).default([]),
})
app.post('/api/lookup', rateLimit(60, 60_000), (req, res) => {
  const d = parse(refs, req.body, res)
  if (!d) return
  const orders = d.orders.flatMap((r) => {
    const f = loadOrder(r.id)
    return f && safeEqual(f.token, r.token) ? [publicOrder(f.order, f.paymentUrl)] : []
  })
  const tickets = d.tickets.flatMap((r) => {
    const row = q.get('SELECT * FROM tickets WHERE id = ?', r.id)
    return row && safeEqual(row.token as string, r.token) ? [mapTicket(row)] : []
  })
  res.json({ orders, tickets })
})

// ---------- Tickets ----------
const ticketSchema = z.object({
  subject: z.string().trim().min(4).max(200),
  type: z.enum(['question', 'order_issue', 'refund', 'other']),
  phone: phoneSchema,
  name: z.string().trim().min(1).max(80),
  orderId: z.string().max(20).optional(),
})
app.post('/api/tickets', rateLimit(10, 60_000), (req, res) => {
  const d = parse(ticketSchema, req.body, res)
  if (!d) return
  const linked = d.orderId ? loadOrder(d.orderId)?.order : undefined
  const orderId = linked && linked.phone === d.phone ? linked.id : null
  const token = newToken()
  const id = tx(() => {
    const r = q.run(
      'INSERT INTO tickets (token, subject, type, priority, status, customer_name, phone, order_id, created_at) VALUES (?,?,?,?,?,?,?,?,?)',
      token, d.subject, d.type, d.type === 'refund' ? 'high' : 'normal', 'open', d.name, d.phone, orderId, Date.now(),
    )
    const tid = `T${r.lastInsertRowid}`
    q.run('UPDATE tickets SET id = ? WHERE seq = ?', tid, Number(r.lastInsertRowid))
    q.run('INSERT INTO ticket_messages (ticket_id, sender, text, at) VALUES (?,?,?,?)', tid, 'customer', d.subject, Date.now())
    return tid
  })
  res.status(201).json({ ticket: mapTicket(q.get('SELECT * FROM tickets WHERE id = ?', id)!), token })
})

const msgSchema = z.object({ token: z.string().max(100), text: z.string().trim().min(1).max(1000) })
app.post('/api/tickets/:id/messages', rateLimit(30, 60_000), (req, res) => {
  const d = parse(msgSchema, req.body, res)
  if (!d) return
  const row = q.get('SELECT * FROM tickets WHERE id = ?', req.params.id as string)
  if (!row || !safeEqual(row.token as string, d.token)) return bad(res, 'Ticket not found.', 404)
  if (row.status === 'resolved') return bad(res, 'This ticket is resolved. Open a new one.', 409)
  q.run('INSERT INTO ticket_messages (ticket_id, sender, text, at) VALUES (?,?,?,?)', row.id as string, 'customer', d.text, Date.now())
  res.json({ ticket: mapTicket(row) })
})

// ---------- Staff auth ----------
app.post('/api/auth/request', rateLimit(5, 60_000), async (req, res) => {
  const d = parse(z.object({ phone: phoneSchema }), req.body, res)
  if (!d) return
  const code = issueOtp(d.phone)
  if (code) await sendSms(d.phone, `Smokology staff code: ${code}. Expires in 10 minutes.`)
  res.json({ ok: true })
})
app.post('/api/auth/verify', rateLimit(10, 60_000), (req, res) => {
  const d = parse(z.object({ phone: phoneSchema, code: z.string().regex(/^\d{6}$/) }), req.body, res)
  if (!d) return
  const token = verifyOtp(d.phone, d.code)
  if (!token) return bad(res, 'Invalid or expired code.', 401)
  res.append('Set-Cookie', `${COOKIE}=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${12 * 3600}${prod ? '; Secure' : ''}`)
  const me = mapStaff(q.get('SELECT * FROM staff WHERE phone = ?', d.phone)!)
  res.json({ me })
})
app.post('/api/auth/logout', (req, res) => {
  const t = readCookie(req, COOKIE)
  if (t) endSession(t)
  res.append('Set-Cookie', `${COOKIE}=; HttpOnly; SameSite=Lax; Path=/; Max-Age=0`)
  res.json({ ok: true })
})
app.get('/api/me', (req, res) => res.json({ me: req.staff ?? null }))

// ---------- Staff state & actions ----------
const staffOnly = requireRole('admin', 'employee')
const adminOnly = requireRole('admin')

app.get('/api/staff/state', staffOnly, (req, res) => {
  const me = req.staff!
  const staff = q.all('SELECT * FROM staff').map(mapStaff)
  const state: StaffState = me.role === 'admin'
    ? { orders: q.all('SELECT * FROM orders ORDER BY seq DESC LIMIT 500').map(mapOrder), tickets: q.all('SELECT * FROM tickets ORDER BY seq DESC LIMIT 300').map(mapTicket), staff, refunds: q.all('SELECT * FROM refunds ORDER BY id DESC LIMIT 500').map(mapRefund) }
    : { orders: q.all("SELECT * FROM orders WHERE driver_id = ? AND status IN ('accepted','ready','out_for_delivery') ORDER BY seq", me.id).map(mapOrder), tickets: [], staff: staff.filter((s) => s.id === me.id), refunds: [] }
  res.json(state)
})

function canAct(req: Request, o: Order, to?: OrderStatus) {
  const me = req.staff!
  if (me.role === 'admin') return true
  return o.driverId === me.id && (to === undefined || to === 'out_for_delivery' || to === 'delivered')
}

const guardedOrder = (req: Request, res: Response, to?: OrderStatus) => {
  const o = loadOrder(req.params.id as string)?.order
  if (!o || !canAct(req, o, to)) return void bad(res, 'Order not found.', 404)
  return o
}

app.post('/api/orders/:id/status', staffOnly, (req, res) => {
  const d = parse(z.object({ to: z.enum(['accepted', 'ready', 'out_for_delivery', 'delivered', 'cancelled']) }), req.body, res)
  if (!d) return
  const o = guardedOrder(req, res, d.to)
  if (!o) return
  if (!canTransition(o.status, d.to)) return bad(res, `Can't move ${o.status} to ${d.to}.`, 409)
  if (d.to === 'out_for_delivery' && !o.driverId) return bad(res, 'Assign a driver first.', 409)
  if (d.to === 'out_for_delivery' && o.payment !== 'cash' && o.paymentStatus !== 'paid') return bad(res, 'Card and Bitcoin orders must be paid before dispatch.', 409)
  if (d.to === 'delivered' && hasRestricted(o.items) && !o.idChecked) return bad(res, 'Check ID and registry card before handoff.', 409)
  tx(() => {
    q.run('UPDATE orders SET status = ? WHERE id = ?', d.to, o.id)
    if (d.to === 'cancelled') for (const i of o.items) q.run('UPDATE products SET stock = stock + ? WHERE id = ?', i.qty, i.productId)
  })
  if (d.to === 'out_for_delivery') {
    const drv = q.get('SELECT name, phone FROM staff WHERE id = ?', o.driverId!)!
    void sendSms(o.phone, `Smokology: your order ${o.id} is on the way with ${drv.name}. Reach them at ${drv.phone}.`)
  }
  res.json({ ok: true })
})

app.post('/api/orders/:id/paid', staffOnly, (req, res) => {
  const o = guardedOrder(req, res)
  if (!o) return
  if (req.staff!.role === 'employee' && o.payment !== 'cash') return bad(res, 'Only cash can be collected by drivers.', 403)
  q.run("UPDATE orders SET payment_status = 'paid' WHERE id = ? AND payment_status = 'unpaid'", o.id)
  res.json({ ok: true })
})

const refundSchema = z.object({ amountCents: z.number().int().min(1).optional(), reason: z.string().trim().min(3).max(300) })

app.post('/api/orders/:id/refund', adminOnly, async (req, res) => {
  const d = parse(refundSchema, req.body, res)
  if (!d) return
  const row = q.get('SELECT * FROM orders WHERE id = ?', req.params.id as string)
  if (!row) return bad(res, 'Order not found.', 404)
  const o = mapOrder(row)
  const amount = d.amountCents ?? refundableCents(o)

  // Reserve inside a transaction so two clicks can't refund the same dollars twice.
  const refundId = tx(() => {
    const fresh = mapOrder(q.get('SELECT * FROM orders WHERE id = ?', o.id)!)
    const remaining = refundableCents(fresh)
    if (remaining === 0) return 'Nothing to refund on this order.'
    if (amount > remaining) return `Only ${money(remaining)} can still be refunded.`
    q.run('UPDATE orders SET refunded_cents = refunded_cents + ?, payment_status = ? WHERE id = ?', amount, paymentStatusAfterRefund(fresh.totalCents, fresh.refundedCents + amount), o.id)
    return Number(q.run('INSERT INTO refunds (order_id, amount_cents, reason, method, status, created_by, created_at) VALUES (?,?,?,?,?,?,?)', o.id, amount, d.reason, o.payment, 'processing', req.staff!.id, Date.now()).lastInsertRowid)
  })
  if (typeof refundId === 'string') return bad(res, refundId, 409)

  const auto = o.payment === 'card' && !!row.provider_ref && stripeEnabled()
  if (!auto) {
    q.run("UPDATE refunds SET status = 'pending_manual' WHERE id = ?", refundId)
    void sendSms(o.phone, `Smokology: we're refunding ${money(amount)} for order ${o.id}. The team will confirm when it's sent.`)
    return void res.json({ ok: true, status: 'pending_manual' })
  }
  try {
    const ref = await refundStripe(row.provider_ref as string, amount, `refund-${refundId}`)
    q.run("UPDATE refunds SET status = 'completed', provider_ref = ? WHERE id = ?", ref, refundId)
    void sendSms(o.phone, `Smokology: ${money(amount)} was refunded to your card for order ${o.id}. It can take 5-10 days to appear.`)
    res.json({ ok: true, status: 'completed' })
  } catch (e) {
    console.error('stripe refund failed', e)
    tx(() => {
      q.run("UPDATE refunds SET status = 'failed' WHERE id = ?", refundId)
      q.run('UPDATE orders SET refunded_cents = refunded_cents - ?, payment_status = ? WHERE id = ?', amount, o.refundedCents > 0 ? paymentStatusAfterRefund(o.totalCents, o.refundedCents) : 'paid', o.id)
    })
    bad(res, 'The card refund failed. Nothing was refunded, try again or refund in the Stripe dashboard.', 502)
  }
})

app.post('/api/refunds/:id/complete', adminOnly, (req, res) => {
  const r = q.run("UPDATE refunds SET status = 'completed' WHERE id = ? AND status = 'pending_manual'", req.params.id as string)
  if (r.changes !== 1) return bad(res, 'Refund not found or already completed.', 404)
  res.json({ ok: true })
})

app.post('/api/orders/:id/idcheck', staffOnly, (req, res) => {
  const d = parse(z.object({ checked: z.boolean() }), req.body, res)
  const o = d && guardedOrder(req, res)
  if (!d || !o) return
  q.run('UPDATE orders SET id_checked = ? WHERE id = ?', d.checked ? 1 : 0, o.id)
  res.json({ ok: true })
})

app.post('/api/orders/:id/assign', adminOnly, (req, res) => {
  const d = parse(z.object({ driverId: z.string().nullable() }), req.body, res)
  const o = d && guardedOrder(req, res)
  if (!d || !o) return
  if (!['accepted', 'ready'].includes(o.status)) return bad(res, 'Order is already dispatched or closed.', 409)
  if (d.driverId && !q.get("SELECT 1 FROM staff WHERE id = ? AND role = 'employee'", d.driverId)) return bad(res, 'Unknown driver.')
  q.run('UPDATE orders SET driver_id = ?, batch_id = NULL WHERE id = ?', d.driverId, o.id)
  res.json({ ok: true })
})

app.post('/api/dispatch/auto', adminOnly, (_req, res) => {
  const orders = q.all("SELECT * FROM orders WHERE status IN ('accepted','ready','out_for_delivery')").map(mapOrder)
  const plan = buildBatches(orders, q.all('SELECT * FROM staff').map(mapStaff))
  tx(() => {
    for (const b of plan) for (const id of b.orderIds) q.run('UPDATE orders SET driver_id = ?, batch_id = ? WHERE id = ?', b.driverId, b.batchId, id)
  })
  res.json({ batches: plan.length })
})

app.post('/api/staff/:id/shift', staffOnly, (req, res) => {
  const id = req.params.id as string
  if (req.staff!.role !== 'admin' && req.staff!.id !== id) return bad(res, 'Not allowed.', 403)
  q.run('UPDATE staff SET on_shift = 1 - on_shift WHERE id = ? AND role = ?', id, 'employee')
  res.json({ ok: true })
})

app.patch('/api/products/:id', adminOnly, (req, res) => {
  const d = parse(z.object({ stock: z.number().int().min(0).max(9999) }), req.body, res)
  if (!d) return
  q.run('UPDATE products SET stock = ? WHERE id = ?', d.stock, req.params.id as string)
  res.json({ ok: true })
})

// Ticket admin actions
app.post('/api/tickets/:id/reply', adminOnly, (req, res) => {
  const d = parse(z.object({ text: z.string().trim().min(1).max(1000) }), req.body, res)
  if (!d) return
  const t = q.get('SELECT id FROM tickets WHERE id = ?', req.params.id as string)
  if (!t) return bad(res, 'Ticket not found.', 404)
  tx(() => {
    q.run('INSERT INTO ticket_messages (ticket_id, sender, text, at) VALUES (?,?,?,?)', t.id as string, 'admin', d.text, Date.now())
    q.run("UPDATE tickets SET status = 'in_progress' WHERE id = ? AND status = 'open'", t.id as string)
  })
  res.json({ ok: true })
})
app.post('/api/tickets/:id/status', adminOnly, (req, res) => {
  const d = parse(z.object({ status: z.enum(['open', 'in_progress', 'resolved']) }), req.body, res)
  if (!d) return
  q.run('UPDATE tickets SET status = ? WHERE id = ?', d.status, req.params.id as string)
  res.json({ ok: true })
})
app.post('/api/tickets/:id/assign', adminOnly, (req, res) => {
  const d = parse(z.object({ assigneeId: z.string().nullable() }), req.body, res)
  if (!d) return
  q.run('UPDATE tickets SET assignee_id = ? WHERE id = ?', d.assigneeId, req.params.id as string)
  res.json({ ok: true })
})

// ---------- Static app (production) ----------
const dist = join(process.cwd(), 'dist')
if (existsSync(dist)) {
  app.use(express.static(dist))
  app.get(/^\/(?!api).*/, (_req, res) => res.sendFile(join(dist, 'index.html')))
}

app.use('/api', (_req, res) => bad(res, 'Not found.', 404))
app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  console.error(err)
  res.status(500).json({ error: 'Server error.' })
})

const port = Number(process.env.PORT ?? 8787)
app.listen(port, () => console.log(`Smokology API on :${port}`))
