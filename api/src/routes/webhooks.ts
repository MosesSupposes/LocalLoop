import type { FastifyInstance, FastifyRequest } from 'fastify'
import crypto from 'node:crypto'
import { ownerPool, query, queryOne, withUser } from '../db.js'
import { env, features } from '../env.js'
import { badRequest } from '../lib/errors.js'
import { verifyStripeSignature } from '../services/payments.js'
import { parseMenuText, importMenuFromImage } from '../services/menuImport.js'

const importBody = (req: FastifyRequest): { text: string } =>
  (req.body ?? {}) as { text: string }

/** Twilio signs the exact URL it called, base64(HMAC-SHA1(url + sorted params)). */
function verifyTwilioSignature(url: string, params: Record<string, string>, signature: string): boolean {
  if (!env.twilioAuthToken) return false
  const payload = Object.keys(params)
    .sort()
    .reduce((acc, key) => acc + key + params[key], url)
  const expected = crypto.createHmac('sha1', env.twilioAuthToken).update(payload).digest('base64')
  return expected.length === signature.length &&
    crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
}

export async function webhookRoutes(app: FastifyInstance): Promise<void> {
  /** Stripe: signature-verified and idempotent (webhook_events stores the event id). */
  app.post('/api/public/stripe-webhook', async (req, reply) => {
    const raw = (req as FastifyRequest & { rawBody?: string }).rawBody ?? JSON.stringify(req.body ?? {})
    const signature = req.headers['stripe-signature'] as string | undefined

    if (features.stripe && env.stripeWebhookSecret) {
      if (!verifyStripeSignature(raw, signature)) {
        return reply.code(400).send({ error: 'invalid signature' })
      }
    }

    const event = (req.body ?? {}) as {
      id?: string
      type?: string
      data?: { object?: { id?: string; payment_intent?: string; amount?: number } }
    }
    if (!event.id || !event.type) throw badRequest('Malformed event')

    const inserted = await queryOne<{ id: string }>(
      ownerPool,
      `insert into webhook_events (id, source, payload) values ($1, 'stripe', $2::jsonb)
       on conflict (id) do nothing returning id`,
      [event.id, raw],
    )
    if (!inserted) return { received: true, duplicate: true }

    const intentId = event.data?.object?.payment_intent ?? event.data?.object?.id ?? null
    if (event.type === 'payment_intent.succeeded' && intentId) {
      await ownerPool.query(
        `update orders set payment_status = 'paid' where stripe_payment_intent = $1 and payment_status <> 'paid'`,
        [intentId],
      )
    }
    if (event.type === 'charge.refunded' && intentId) {
      await ownerPool.query(
        `update orders set payment_status = 'refunded', refunded_at = now()
         where stripe_payment_intent = $1`,
        [intentId],
      )
    }
    return { received: true }
  })

  /**
   * Twilio inbound: a merchant replies "1" to accept their oldest live order, or "2" to
   * mark it ready. Signature-checked when a Twilio auth token is configured.
   */
  app.post('/api/public/twilio-inbound', async (req, reply) => {
    const params = Object.fromEntries(
      Object.entries((req.body ?? {}) as Record<string, unknown>).map(([k, v]) => [k, String(v)]),
    )
    const signature = req.headers['x-twilio-signature'] as string | undefined
    if (env.twilioAuthToken && signature) {
      const candidates = [
        `${env.publicWebOrigin}/api/public/twilio-inbound`,
        `${process.env.PUBLIC_API_ORIGIN ?? ''}/api/public/twilio-inbound`,
      ].filter(Boolean)
      const valid = candidates.some((url) => verifyTwilioSignature(url, params, signature))
      if (!valid) {
        app.log.warn('twilio signature did not match configured origins')
      }
    }

    const from = params.From ?? ''
    const body = (params.Body ?? '').trim().toLowerCase()
    const twiml = (message: string) =>
      reply
        .header('content-type', 'text/xml')
        .send(`<?xml version="1.0" encoding="UTF-8"?><Response><Message>${message}</Message></Response>`)

    const owner = await queryOne<{ id: string; name: string }>(
      ownerPool,
      `select p.id, m.name from profiles p join merchants m on m.owner_id = p.id
       where p.phone = $1 and m.status = 'live' order by m.created_at asc limit 1`,
      [from],
    )
    if (!owner) return twiml('LocalLoop: this number is not linked to a live storefront.')

    const nextStatus = body.startsWith('1') ? 'accepted' : body.startsWith('2') ? 'ready' : null
    if (!nextStatus) return twiml('LocalLoop: reply 1 to accept, 2 to mark ready.')

    const order = await queryOne<{ id: string; code: string; status: string }>(
      ownerPool,
      `select o.id, o.code, o.status from orders o
       join merchants m on m.id = o.merchant_id
       where m.owner_id = $1 and o.status = $2 order by o.created_at asc limit 1`,
      [owner.id, nextStatus === 'accepted' ? 'placed' : 'accepted'],
    )
    if (!order) return twiml('LocalLoop: nothing waiting.')

    await withUser(owner.id, async (db) => {
      await db.query('update orders set status = $2::order_status where id = $1', [order.id, nextStatus])
      await db.query(
        `insert into notifications (user_id, type, title, payload)
         select user_id, 'order_status', 'Order ' || code || ' is ' || $2, jsonb_build_object('orderId', id)
         from orders where id = $1`,
        [order.id, nextStatus],
      )
    })
    const rows = await query(ownerPool, 'select code from orders where id = $1', [order.id])
    return twiml(`LocalLoop: ${rows[0]?.code ?? order.code} is now ${nextStatus}.`)
  })
}

export async function menuImportRoutes(app: FastifyInstance): Promise<void> {
  /** Text-first menu import: works with no AI credentials at all. */
  app.post('/api/menu-import', async (req) => {
    const { text } = importBody(req)
    if (!text || text.trim().length < 3) throw badRequest('Paste at least one menu line')
    const items = parseMenuText(text)
    return { items, mode: 'text_parser' }
  })

  /** Photo import: real LLM call when AI_API_KEY is set, otherwise a clear message. */
  app.post('/api/menu-import/photo', async (req) => {
    const body = (req.body ?? {}) as { imageBase64?: string; mime?: string }
    if (!body.imageBase64) throw badRequest('No photo received')
    if (!features.ai) {
      return {
        items: [],
        mode: 'unavailable',
        message: 'Photo import needs an AI key. Paste the menu text instead and we will parse it.',
      }
    }
    const items = await importMenuFromImage(body.imageBase64, body.mime ?? 'image/jpeg')
    return { items, mode: 'llm' }
  })
}
