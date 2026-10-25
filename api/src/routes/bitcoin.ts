import type { FastifyInstance } from 'fastify'
import { queryOne, withUser } from '../db.js'
import { features } from '../env.js'
import { badRequest, conflict, notFound, unauthorized } from '../lib/errors.js'
import { rateLimitOrThrow } from '../lib/rateLimit.js'
import { readSession } from '../lib/session.js'
import { announceNewOrder } from '../services/notify.js'
import { bitcoinInvoiceSettled, markBitcoinInvoicePaid } from '../services/bitcoin.js'
import { ORDER_VIEW, respond, type OrderView } from './orders.js'

/**
 * Bitcoin settlement for one order. The panel on the order screen calls this to check
 * whether the money arrived:
 *
 * - With BTCPay credentials only the provider can settle an order — an invoice that has not
 *   settled is a 409, so a neighbor can never mark their own order paid.
 * - With no BTCPay credentials the sandbox invoice settles here, the way the Stripe stub
 *   approves a card charge. Nothing leaves the environment.
 *
 * Either way the write goes through markBitcoinInvoicePaid(), which only ever moves an
 * unpaid order to paid, so a retry or a replayed webhook cannot double-settle.
 */
export async function bitcoinRoutes(app: FastifyInstance): Promise<void> {
  app.post('/api/orders/:id/bitcoin/confirm', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { id } = req.params as { id: string }
    rateLimitOrThrow(`bitcoin:${session.id}`, 30, 60 * 1000)

    // RLS decides who may read the order: its owner, its merchant, or an admin.
    const row = await withUser(session.id, (db) =>
      queryOne<{
        id: string
        payment_provider: string | null
        payment_status: string
        payment_reference: string | null
      }>(
        db,
        'select id, payment_provider, payment_status, payment_reference from orders where id = $1',
        [id],
      ),
    )
    if (!row) throw notFound('Order not found')
    if (row.payment_provider !== 'bitcoin' || !row.payment_reference) {
      throw badRequest('This order is not a bitcoin order')
    }

    let settled = row.payment_status === 'paid'
    if (!settled) {
      if (features.bitcoin && !(await bitcoinInvoiceSettled(row.payment_reference))) {
        throw conflict('That bitcoin payment has not arrived yet. Give it a minute and check again.')
      }
      const paidOrder = await markBitcoinInvoicePaid(row.payment_reference)
      settled = Boolean(paidOrder)
      if (paidOrder) {
        await announceNewOrder({
          orderId: paidOrder.id,
          code: paidOrder.code,
          merchantId: paidOrder.merchant_id,
          neighborId: paidOrder.user_id,
        })
      }
    }

    const order = await withUser(session.id, (db) =>
      queryOne<OrderView>(db, `${ORDER_VIEW} where o.id = $1`, [id]),
    )
    return { order: respond(order!), settled }
  })
}
