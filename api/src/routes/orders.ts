import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ownerPool, query, queryOne, withUser } from '../db.js'
import { badRequest, conflict, notFound, unauthorized } from '../lib/errors.js'
import { dealDiscountCents, orderTotals, type FeeConfig } from '../lib/fees.js'
import { rateLimitOrThrow } from '../lib/rateLimit.js'
import { trackerState, type OrderStatus } from '../lib/orderState.js'
import { readSession } from '../lib/session.js'
import { chargeForOrder, refundPayment } from '../services/payments.js'
import { insertNotification, sendSms } from '../services/notify.js'
import { transitionOrder } from '../services/orderFlow.js'

const CreateOrder = z.object({
  merchantId: z.string().uuid(),
  fulfillment: z.literal('pickup').default('pickup'),
  pickupSlot: z.string().datetime().nullable().optional(),
  tipCents: z.number().int().min(0).max(5000).default(0),
  note: z.string().max(200).nullable().optional(),
  paymentMethod: z.enum(['card', 'apple_pay', 'google_pay']).default('card'),
})

const ORDER_VIEW = `
  select o.id, o.code, o.status, o.fulfillment, o.subtotal_cents, o.discount_cents,
         o.platform_fee_cents,
         o.service_fee_cents, o.tip_cents, o.total_cents, o.currency, o.payment_status,
         o.pickup_slot, o.pickup_eta, o.note, o.cancel_reason, o.created_at, o.updated_at,
         m.id as merchant_id, m.name as merchant_name, m.slug as merchant_slug, m.category,
         m.phone as merchant_phone, m.address as merchant_address,
         (select jsonb_agg(jsonb_build_object(
             'id', oi.id, 'name', oi.name_snapshot, 'qty', oi.qty,
             'price_cents', oi.price_snapshot, 'options', oi.options) order by oi.name_snapshot)
          from order_items oi where oi.order_id = o.id) as items
  from orders o join merchants m on m.id = o.merchant_id
`

type OrderView = {
  id: string
  code: string
  status: OrderStatus
  merchant_name: string
  items: { qty: number; price_cents: number }[]
  [key: string]: unknown
}

function respond(order: OrderView) {
  return { ...order, tracker: trackerState(order.status) }
}

export async function orderRoutes(app: FastifyInstance): Promise<void> {
  /** Places a pickup order from the server-side cart. Prices, fees and stock are all re-derived here. */
  app.post('/api/orders', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const body = CreateOrder.parse(req.body ?? {})
    rateLimitOrThrow(`order:${session.id}`, 10, 60 * 1000)

    const created = await withUser(session.id, async (db) => {
      const cart = await queryOne<{ id: string }>(
        db,
        'select id from carts where user_id = $1 and merchant_id = $2',
        [session.id, body.merchantId],
      )
      if (!cart) throw badRequest('Your cart is empty')

      const lines = await query<{
        item_id: string
        name: string
        qty: number
        unit_price_cents: number
        options: unknown
      }>(
        db,
        `select ci.item_id, i.name, ci.qty, ci.unit_price_cents, ci.options
         from cart_items ci join items i on i.id = ci.item_id
         where ci.cart_id = $1`,
        [cart.id],
      )
      if (lines.length === 0) throw badRequest('Your cart is empty')

      const merchant = await queryOne<{ id: string; name: string; status: string; accepts_pickup: boolean; owner_id: string }>(
        db,
        'select id, name, status, accepts_pickup, owner_id from merchants where id = $1',
        [body.merchantId],
      )
      if (!merchant) throw notFound('Unknown storefront')
      if (merchant.status !== 'live') throw conflict('This storefront is not accepting orders right now')
      if (!merchant.accepts_pickup) throw conflict('This storefront does not offer pickup')

      const subtotalCents = lines.reduce((sum, l) => sum + l.qty * l.unit_price_cents, 0)

      const feeRow = await queryOne<{ platform_fee_bps: number; service_fee_cents: number }>(
        db,
        'select platform_fee_bps, service_fee_cents from fee_config where id = 1',
      )
      const feeConfig: FeeConfig = {
        platformFeeBps: feeRow?.platform_fee_bps ?? 500,
        serviceFeeCents: feeRow?.service_fee_cents ?? 99,
      }

      const activeDeals = await query<{ type: 'percent' | 'fixed' | 'bogo'; value: number }>(
        db,
        `select type, value from deals
         where merchant_id = $1 and active and starts_at <= now() and ends_at > now()`,
        [body.merchantId],
      )
      const discountCents = dealDiscountCents(activeDeals, subtotalCents)
      const totals = orderTotals({
        subtotalCents,
        tipCents: body.tipCents,
        discountCents,
        feeConfig,
      })

      const codeRow = await queryOne<{ code: string }>(
        db,
        `select 'LL-' || to_char(now(), 'MMDD') || '-' || lpad(nextval('order_code_seq')::text, 4, '0') as code`,
      )

      const order = await queryOne<{ id: string }>(
        db,
        `insert into orders (code, user_id, merchant_id, status, fulfillment, subtotal_cents,
                             discount_cents, platform_fee_cents, service_fee_cents, tip_cents,
                             total_cents, payment_status, pickup_slot, note)
         values ($1, $2, $3, 'placed', 'pickup', $4, $5, $6, $7, $8, $9, 'unpaid', $10, $11)
         returning id`,
        [
          codeRow!.code,
          session.id,
          body.merchantId,
          totals.subtotalCents,
          discountCents,
          totals.platformFeeCents,
          totals.serviceFeeCents,
          totals.tipCents,
          totals.totalCents,
          body.pickupSlot ?? null,
          body.note ?? null,
        ],
      )
      const orderId = order!.id

      for (const line of lines) {
        // A live drop for this item takes the last units atomically; a losing race is a 409.
        const drop = await queryOne<{ id: string }>(
          db,
          `select id from drops
           where item_id = $1 and starts_at <= now() and ends_at > now() and qty_left >= $2
           order by ends_at asc limit 1`,
          [line.item_id, line.qty],
        )
        let dropId: string | null = null
        if (drop) {
          // RLS-safe atomic reservation: a neighbor has no UPDATE policy on drops, and should
          // not have one. The security-definer function only ever subtracts, and only when the
          // units are still there, so two neighbors racing for the last item cannot both win.
          const reserved = await queryOne<{ remaining: number }>(
            db,
            'select reserve_drop_units($1, $2) as remaining',
            [drop.id, line.qty],
          )
          if (!reserved || reserved.remaining < 0) throw conflict(`The drop for ${line.name} just sold out`)
          dropId = drop.id
        }

        await db.query(
          `insert into order_items (order_id, item_id, drop_id, name_snapshot, price_snapshot, qty, options)
           values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
          [orderId, line.item_id, dropId, line.name, line.unit_price_cents, line.qty, JSON.stringify(line.options ?? [])],
        )
      }

      const payment = await chargeForOrder({
        orderId,
        amountCents: totals.totalCents,
        currency: 'usd',
        paymentMethod: body.paymentMethod,
      })
      await db.query(
        `update orders set payment_status = $2, stripe_payment_intent = $3 where id = $1`,
        [orderId, payment.status, payment.intentId],
      )

      await db.query('delete from carts where id = $1', [cart.id])

      const view = await queryOne<OrderView>(db, `${ORDER_VIEW} where o.id = $1`, [orderId])
      return { order: respond(view!), merchant, totals, discountCents, payment }
    })

    // Alerts fire outside the request transaction: a messaging hiccup must not roll back an order.
    const merchantPhone = await queryOne<{ phone: string | null }>(
      ownerPool,
      'select phone from profiles where id = $1',
      [created.merchant.owner_id],
    )
    const alert = `New LocalLoop pickup order ${created.order.code} for ${created.order.merchant_name}. Open the dashboard to accept.`
    if (merchantPhone?.phone) {
      await sendSms({ to: merchantPhone.phone, body: alert, template: 'merchant_new_order' })
    }
    await insertNotification({
      userId: created.merchant.owner_id,
      type: 'new_order',
      title: `New order ${created.order.code}`,
      payload: { orderId: created.order.id },
    })
    await insertNotification({
      userId: session.id,
      type: 'order_status',
      title: `Order ${created.order.code} placed at ${created.order.merchant_name}`,
      payload: { orderId: created.order.id },
    })

    return { order: created.order, totals: created.totals, discountCents: created.discountCents }
  })

  /** Live tracker poll target: cheap, RLS-scoped, returns the step list too. */
  app.get('/api/orders/:id', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { id } = req.params as { id: string }
    return withUser(session.id, async (db) => {
      const order = await queryOne<OrderView>(db, `${ORDER_VIEW} where o.id = $1`, [id])
      if (!order) throw notFound('Order not found')
      return { order: respond(order) }
    })
  })

  app.get('/api/orders', async (req) => {
    const session = await readSession(req)
    if (!session) return { orders: [] }
    return withUser(session.id, async (db) => {
      const orders = await query<OrderView>(
        db,
        `select o.id, o.code, o.status, o.fulfillment, o.subtotal_cents, o.tip_cents, o.total_cents,
                o.payment_status, o.created_at, o.pickup_eta,
                m.name as merchant_name, m.slug as merchant_slug, m.category, m.phone as merchant_phone,
                (select jsonb_agg(jsonb_build_object('name', oi.name_snapshot, 'qty', oi.qty,
                                                     'price_cents', oi.price_snapshot) order by oi.name_snapshot)
                 from order_items oi where oi.order_id = o.id) as items,
                (select coalesce(sum(oi.qty), 0)::int from order_items oi where oi.order_id = o.id) as item_count,
                exists (select 1 from reviews r where r.order_id = o.id) as reviewed
         from orders o join merchants m on m.id = o.merchant_id
         where o.user_id = current_user_id()
         order by o.created_at desc limit 50`,
      )
      return { orders: orders.map((o) => respond(o)) }
    })
  })

  app.post('/api/orders/:id/cancel', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { id } = req.params as { id: string }
    const { reason } = z.object({ reason: z.string().max(160).optional() }).parse(req.body ?? {})
    return withUser(session.id, async (db) => {
      const order = await transitionOrder({ db, orderId: id, to: 'cancelled', actorId: session.id, reason, refund: refundPayment })
      const view = await queryOne<OrderView>(db, `${ORDER_VIEW} where o.id = $1`, [order.id])
      return { order: respond(view!) }
    })
  })

  /** One-tap reorder: rebuilds the cart from an order's history at today's prices. */
  app.post('/api/orders/:id/reorder', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { id } = req.params as { id: string }
    return withUser(session.id, async (db) => {
      const order = await queryOne<{ id: string; merchant_id: string; status: string }>(
        db,
        'select id, merchant_id, status from orders where id = $1',
        [id],
      )
      if (!order) throw notFound('Order not found')
      const lines = await query<{ item_id: string | null; qty: number; options: unknown }>(
        db,
        'select item_id, qty, options from order_items where order_id = $1',
        [id],
      )
      const cart = await queryOne<{ id: string }>(
        db,
        `insert into carts (user_id, merchant_id) values ($1, $2)
         on conflict (user_id, merchant_id) do update set updated_at = now() returning id`,
        [session.id, order.merchant_id],
      )
      let added = 0
      for (const line of lines) {
        if (!line.item_id) continue
        const item = await queryOne<{ price_cents: number; in_stock: boolean }>(
          db,
          'select price_cents, in_stock from items where id = $1',
          [line.item_id],
        )
        if (!item || !item.in_stock) continue
        await db.query(
          `insert into cart_items (cart_id, item_id, qty, options, unit_price_cents)
           values ($1, $2, $3, $4::jsonb, $5)`,
          [cart!.id, line.item_id, line.qty, JSON.stringify(line.options ?? []), item.price_cents],
        )
        added += 1
      }
      await db.query('update carts set updated_at = now() where id = $1', [cart!.id])
      return { ok: true, added, merchantId: order.merchant_id, cartId: cart!.id }
    })
  })

  app.post('/api/orders/:id/review', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { id } = req.params as { id: string }
    const body = z
      .object({ rating: z.number().int().min(1).max(5), body: z.string().max(600).optional() })
      .parse(req.body ?? {})
    return withUser(session.id, async (db) => {
      const order = await queryOne<{ id: string; merchant_id: string; status: string }>(
        db,
        'select id, merchant_id, status from orders where id = $1 and user_id = $2',
        [id, session.id],
      )
      if (!order) throw notFound('Order not found')
      if (!['picked_up', 'delivered'].includes(order.status)) {
        throw badRequest('You can review an order once you have picked it up')
      }
      const review = await queryOne<{ id: string }>(
        db,
        `insert into reviews (order_id, user_id, merchant_id, rating, body)
         values ($1, $2, $3, $4, $5) returning id`,
        [order.id, session.id, order.merchant_id, body.rating, body.body ?? null],
      )
      await db.query(
        `update merchants set rating_avg = coalesce(
           (select round(avg(rating)::numeric, 1) from reviews where merchant_id = $1), 0)
         where id = $1`,
        [order.merchant_id],
      )
      return { ok: true, reviewId: review!.id }
    })
  })
}
