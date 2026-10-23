import type { Db } from '../db.js'
import { conflict, notFound } from '../lib/errors.js'
import { assertTransition, type OrderStatus } from '../lib/orderState.js'
import type { refundPayment } from './payments.js'
import { awardLoopPoints, insertNotification, sendSms } from './notify.js'

export type OrderRow = {
  id: string
  code: string
  status: OrderStatus
  user_id: string
  merchant_id: string
  subtotal_cents: number
  total_cents: number
  payment_status: string
  stripe_payment_intent: string | null
  pickup_eta: string | null
}

export async function loadOrder(db: Db, orderId: string): Promise<OrderRow> {
  const res = await db.query<OrderRow>(
    `select id, code, status, user_id, merchant_id, subtotal_cents, total_cents,
            payment_status, stripe_payment_intent, pickup_eta
     from orders where id = $1`,
    [orderId],
  )
  const order = res.rows[0]
  if (!order) throw notFound('Order not found')
  return order
}

const NEIGHBOR_MESSAGES: Record<string, [string, string]> = {
  accepted: ['Order {code} accepted', '{merchant} accepted {code} and is making it now.'],
  ready: ['Order {code} is ready', '{merchant}: {code} is ready for pickup.'],
  picked_up: ['Order {code} picked up', 'Thanks for picking up {code}. You earned {points} Loop Points.'],
  cancelled: ['Order {code} cancelled', '{code} was cancelled. Any payment is refunded.'],
}

/**
 * Single place where order status moves, so the state machine, refund, loyalty accrual and
 * alerts always happen together. Callers pass the RLS-scoped client of the actor, which is
 * what authorizes the write.
 */
export async function transitionOrder(input: {
  db: Db
  orderId: string
  to: OrderStatus
  actorId: string
  reason?: string | null
  /** Service-side refund hook, injected to keep this module free of provider wiring. */
  refund?: typeof refundPayment
}): Promise<OrderRow> {
  const { db, orderId, to, actorId } = input
  const order = await loadOrder(db, orderId)
  assertTransition(order.status, to)

  if (to === 'cancelled' && order.payment_status === 'paid') {
    const refund = input.refund
    if (refund && order.stripe_payment_intent) {
      const result = await refund(order.stripe_payment_intent)
      if (!result.refunded) throw conflict('The refund was rejected by the payment provider')
    }
  }

  const res = await db.query<OrderRow>(
    `update orders set
       status = $2::order_status,
       pickup_eta = case when $2 = 'accepted' then now() + interval '20 minutes' else pickup_eta end,
       cancel_reason = case when $2 = 'cancelled' then $3 else cancel_reason end,
       payment_status = case when $2 = 'cancelled' and payment_status = 'paid' then 'refunded' else payment_status end,
       refunded_at = case when $2 = 'cancelled' and payment_status = 'paid' then now() else refunded_at end
     where id = $1
     returning id, code, status, user_id, merchant_id, subtotal_cents, total_cents,
               payment_status, stripe_payment_intent, pickup_eta`,
    [orderId, to, input.reason ?? null],
  )
  const updated = res.rows[0]!

  const merchant = await db.query<{ name: string; owner_id: string }>(
    'select name, owner_id from merchants where id = $1',
    [order.merchant_id],
  )
  const merchantName = merchant.rows[0]?.name ?? 'The shop'
  const neighbor = await db.query<{ phone: string | null }>(
    'select phone from profiles where id = $1',
    [order.user_id],
  )
  const neighborPhone = neighbor.rows[0]?.phone ?? null

  let points = 0
  if (to === 'picked_up') {
    points = await awardLoopPoints({
      userId: order.user_id,
      merchantId: order.merchant_id,
      orderId: order.id,
      subtotalCents: order.subtotal_cents,
    })
  }

  const template = NEIGHBOR_MESSAGES[to]
  if (template) {
    const title = template[0].replace('{code}', order.code).replace('{merchant}', merchantName)
    const body = template[1]
      .replace('{code}', order.code)
      .replace('{merchant}', merchantName)
      .replace('{points}', String(points))
    await insertNotification({
      userId: order.user_id,
      type: 'order_status',
      title,
      payload: { orderId: order.id, status: to },
    })
    if (neighborPhone) {
      await sendSms({ to: neighborPhone, body, template: `order_${to}`, orderId: order.id })
    }
  }

  if (to === 'cancelled' && merchant.rows[0]?.owner_id) {
    await insertNotification({
      userId: merchant.rows[0].owner_id,
      type: 'order_status',
      title: `${order.code} was cancelled by the neighbor`,
      payload: { orderId: order.id, status: to, actorId },
    })
  }

  return updated
}
