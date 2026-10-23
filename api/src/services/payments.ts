import crypto from 'node:crypto'
import { env, features } from '../env.js'
import { HttpError } from '../lib/errors.js'

export type PaymentResult = {
  provider: 'stripe' | 'simulated'
  intentId: string
  status: 'paid' | 'unpaid'
}

/**
 * Charges a pickup order. With STRIPE_SECRET_KEY present this creates a real
 * PaymentIntent; without it the sandbox runs a simulated charge so checkout still
 * completes end to end and nothing leaves the sandbox.
 */
export async function chargeForOrder(input: {
  orderId: string
  amountCents: number
  currency: string
  paymentMethod: string
}): Promise<PaymentResult> {
  if (!features.stripe) {
    return { provider: 'simulated', intentId: `sim_${input.orderId}`, status: 'paid' }
  }

  const body = new URLSearchParams({
    amount: String(input.amountCents),
    currency: input.currency,
    'automatic_payment_methods[enabled]': 'true',
    'metadata[order_id]': input.orderId,
    'metadata[payment_method]': input.paymentMethod,
    confirm: 'true',
    'payment_method_data[type]': 'card',
    'payment_method_data[card][token]': 'tok_visa',
  })

  const res = await fetch('https://api.stripe.com/v1/payment_intents', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      // Idempotency so a retried request cannot double charge.
      'Idempotency-Key': input.orderId,
    },
    body,
  })

  const payload = (await res.json()) as { id?: string; status?: string; error?: { message?: string } }
  if (!res.ok || !payload.id) {
    throw new HttpError(502, payload.error?.message ?? 'Payment provider rejected the charge')
  }
  return {
    provider: 'stripe',
    intentId: payload.id,
    status: payload.status === 'succeeded' ? 'paid' : 'unpaid',
  }
}

export async function refundPayment(intentId: string): Promise<{ refunded: boolean }> {
  if (!features.stripe || intentId.startsWith('sim_')) return { refunded: true }
  const body = new URLSearchParams({ payment_intent: intentId })
  const res = await fetch('https://api.stripe.com/v1/refunds', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.stripeSecretKey}`,
      'Content-Type': 'application/x-www-form-urlencoded',
      'Idempotency-Key': `refund_${intentId}`,
    },
    body,
  })
  return { refunded: res.ok }
}

/** Stripe's `t=...,v1=...` scheme. Only enforced when a webhook secret is configured. */
export function verifyStripeSignature(rawBody: string, header: string | undefined): boolean {
  if (!env.stripeWebhookSecret) return false
  if (!header) return false
  const parts = header.split(',').reduce<Record<string, string>>((acc, part) => {
    const [k, v] = part.split('=')
    if (k && v) acc[k] = v
    return acc
  }, {})
  const timestamp = parts.t
  const signature = parts.v1
  if (!timestamp || !signature) return false
  const expected = crypto
    .createHmac('sha256', env.stripeWebhookSecret)
    .update(`${timestamp}.${rawBody}`)
    .digest('hex')
  if (expected.length !== signature.length) return false
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
}
