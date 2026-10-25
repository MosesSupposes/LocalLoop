import { createHmac } from 'node:crypto'
import Stripe from 'stripe'
import type { Order } from '../src/lib/types'
import { safeEqual } from './auth'
import { q } from './db'

const appUrl = () => process.env.APP_URL ?? 'http://localhost:5173'
const stripe = process.env.STRIPE_SECRET_KEY ? new Stripe(process.env.STRIPE_SECRET_KEY) : null

export const paymentsConfigured = () => ({ stripe: !!stripe, btc: !!process.env.BTCPAY_URL })

const returnUrl = (o: Order, token: string) => `${appUrl()}/order/${o.id}?t=${token}`

export async function createPaymentUrl(o: Order, token: string): Promise<string | null> {
  if (o.payment === 'card' && stripe) {
    const line = (name: string, cents: number, qty = 1) => ({ quantity: qty, price_data: { currency: 'usd', unit_amount: cents, product_data: { name } } })
    const extras = [
      [o.deliveryFeeCents, 'Delivery'], [o.serviceFeeCents, 'Service fee'], [o.tipCents, 'Driver tip'],
    ] as const
    const session = await stripe.checkout.sessions.create({
      mode: 'payment',
      line_items: [...o.items.map((i) => line(i.name, i.priceCents, i.qty)), ...extras.filter(([c]) => c > 0).map(([c, n]) => line(n, c))],
      metadata: { orderId: o.id },
      client_reference_id: o.id,
      success_url: returnUrl(o, token),
      cancel_url: returnUrl(o, token),
    })
    return session.url
  }
  if (o.payment === 'btc' && process.env.BTCPAY_URL && process.env.BTCPAY_STORE_ID && process.env.BTCPAY_API_KEY) {
    const res = await fetch(`${process.env.BTCPAY_URL}/api/v1/stores/${process.env.BTCPAY_STORE_ID}/invoices`, {
      method: 'POST',
      headers: { Authorization: `token ${process.env.BTCPAY_API_KEY}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ amount: (o.totalCents / 100).toFixed(2), currency: 'USD', metadata: { orderId: o.id }, checkout: { redirectURL: returnUrl(o, token) } }),
    })
    if (!res.ok) throw new Error(`BTCPay invoice failed: ${res.status}`)
    return ((await res.json()) as { checkoutLink: string }).checkoutLink
  }
  return null
}

/** Returns false when this event id was already processed. */
function firstTime(eventId: string) {
  return q.run('INSERT OR IGNORE INTO webhook_events VALUES (?,?)', eventId, Date.now()).changes === 1
}

function markPaid(orderId: string, expectedCents?: number, providerRef?: string) {
  const row = q.get('SELECT total_cents FROM orders WHERE id = ?', orderId)
  if (!row) return
  if (expectedCents !== undefined && row.total_cents !== expectedCents) {
    console.error(`payment amount mismatch for ${orderId}`)
    return
  }
  // Only unpaid orders move to paid, so a replayed webhook can't undo a refund.
  q.run("UPDATE orders SET payment_status = 'paid', provider_ref = COALESCE(?, provider_ref) WHERE id = ? AND payment_status = 'unpaid'", providerRef ?? null, orderId)
}

export const stripeEnabled = () => !!stripe

/** Refunds against the original PaymentIntent; the idempotency key makes retries safe. */
export async function refundStripe(paymentIntent: string, amountCents: number, key: string): Promise<string> {
  if (!stripe) throw new Error('Stripe is not configured.')
  const r = await stripe.refunds.create({ payment_intent: paymentIntent, amount: amountCents }, { idempotencyKey: key })
  return r.id
}

export function handleStripeWebhook(raw: Buffer, signature: string | undefined): { status: number; body: string } {
  const secret = process.env.STRIPE_WEBHOOK_SECRET
  if (!stripe || !secret || !signature) return { status: 400, body: 'not configured' }
  let event: Stripe.Event
  try {
    event = stripe.webhooks.constructEvent(raw, signature, secret)
  } catch {
    return { status: 400, body: 'bad signature' }
  }
  if (!firstTime(`stripe:${event.id}`)) return { status: 200, body: 'duplicate' }
  if (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') {
    const s = event.data.object as Stripe.Checkout.Session
    if (s.payment_status === 'paid' && s.metadata?.orderId) {
      const pi = typeof s.payment_intent === 'string' ? s.payment_intent : s.payment_intent?.id
      markPaid(s.metadata.orderId, s.amount_total ?? -1, pi)
    }
  }
  return { status: 200, body: 'ok' }
}

export function handleBtcpayWebhook(raw: Buffer, signature: string | undefined): { status: number; body: string } {
  const secret = process.env.BTCPAY_WEBHOOK_SECRET
  if (!secret || !signature) return { status: 400, body: 'not configured' }
  const expected = `sha256=${createHmac('sha256', secret).update(raw).digest('hex')}`
  if (!safeEqual(expected, signature)) return { status: 400, body: 'bad signature' }
  const ev = JSON.parse(raw.toString('utf8')) as { deliveryId?: string; type?: string; metadata?: { orderId?: string } }
  if (!ev.deliveryId || !firstTime(`btcpay:${ev.deliveryId}`)) return { status: 200, body: 'duplicate' }
  if (ev.type === 'InvoiceSettled' && ev.metadata?.orderId) markPaid(ev.metadata.orderId)
  return { status: 200, body: 'ok' }
}
