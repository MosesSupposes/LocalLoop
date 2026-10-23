import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { query, queryOne, withUser } from '../db.js'
import { forbidden, notFound, unauthorized } from '../lib/errors.js'
import { readSession } from '../lib/session.js'
import { refundPayment } from '../services/payments.js'
import { insertNotification, writeAudit } from '../services/notify.js'

const StatusBody = z.object({ status: z.enum(['pending', 'live', 'paused']) })
const FeaturedBody = z.object({ featured: z.boolean() })
const NewNeighborhood = z.object({
  name: z.string().min(2).max(80),
  city: z.string().min(2).max(80),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  radiusM: z.number().int().min(200).max(20000).default(1600),
})

export async function adminRoutes(app: FastifyInstance): Promise<void> {
  /** Every handler here is gated on the admin role, on top of the RLS admin policies. */
  async function requireAdmin(req: Parameters<typeof readSession>[0], db: Parameters<typeof query>[0]) {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const role = await queryOne<{ role: string }>(
      db,
      `select role from user_roles where user_id = $1 and role = 'admin'`,
      [session.id],
    )
    if (!role) throw forbidden('Neighborhood ops only')
    return session
  }

  app.get('/api/admin/overview', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    return withUser(session.id, async (db) => {
      await requireAdmin(req, db)
      const summary = await queryOne(
        db,
        `select
           (select count(*)::int from merchants where status = 'live') as live_merchants,
           (select count(*)::int from merchants where status = 'pending') as pending_merchants,
           (select count(*)::int from merchants where status = 'paused') as paused_merchants,
           (select count(*)::int from orders) as orders_total,
           (select count(*)::int from orders where created_at >= current_date) as orders_today,
           (select coalesce(sum(total_cents), 0)::int from orders where payment_status = 'paid') as gmv_cents,
           (select coalesce(sum(platform_fee_cents), 0)::int from orders where payment_status = 'paid') as platform_revenue_cents,
           (select count(*)::int from profiles) as people,
           (select count(*)::int from drops where ends_at > now() and qty_left > 0) as live_drops,
           (select count(*)::int from neighborhoods where active) as neighborhoods`,
      )
      const pending = await query(
        db,
        `select id, name, slug, category, address, phone, created_at, status
         from merchants where status = 'pending' order by created_at asc`,
      )
      const topMerchants = await query(
        db,
        `select m.id, m.name, m.slug, m.featured, m.status,
                coalesce(sum(o.subtotal_cents), 0)::int as revenue_cents,
                count(o.id)::int as orders
         from merchants m left join orders o on o.merchant_id = m.id and o.payment_status = 'paid'
         group by m.id order by revenue_cents desc limit 8`,
      )
      const refunds = await query(
        db,
        `select o.id, o.code, o.status, o.total_cents, o.refunded_at, m.name as merchant_name
         from orders o join merchants m on m.id = o.merchant_id
         where o.payment_status = 'refunded' order by o.refunded_at desc nulls last limit 10`,
      )
      const recentOrders = await query(
        db,
        `select o.id, o.code, o.status, o.total_cents, o.created_at, o.payment_status,
                m.name as merchant_name, p.display_name as neighbor_name
         from orders o
         join merchants m on m.id = o.merchant_id
         join profiles p on p.id = o.user_id
         order by o.created_at desc limit 12`,
      )
      return { summary, pending, topMerchants, refunds, recentOrders }
    })
  })

  app.get('/api/admin/merchants', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { status } = z
      .object({ status: z.enum(['pending', 'live', 'paused']).optional() })
      .parse(req.query ?? {})
    return withUser(session.id, async (db) => {
      await requireAdmin(req, db)
      const rows = await query(
        db,
        `select m.id, m.name, m.slug, m.category, m.status, m.featured, m.address, m.phone,
                m.rating_avg::float8 as rating_avg, m.created_at, p.display_name as owner_name,
                (select count(*)::int from items i where i.merchant_id = m.id) as item_count
         from merchants m join profiles p on p.id = m.owner_id
         where ($1::merchant_status is null or m.status = $1::merchant_status)
         order by m.created_at desc`,
        [status ?? null],
      )
      return { merchants: rows }
    })
  })

  app.post('/api/admin/merchants/:id/status', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { id } = req.params as { id: string }
    const { status } = StatusBody.parse(req.body ?? {})
    return withUser(session.id, async (db) => {
      await requireAdmin(req, db)
      const updated = await queryOne<{ id: string; owner_id: string; name: string; status: string }>(
        db,
        'update merchants set status = $2::merchant_status where id = $1 returning id, owner_id, name, status',
        [id, status],
      )
      if (!updated) throw notFound('Storefront not found')
      await writeAudit({
        actorId: session.id,
        action: `merchant.${status}`,
        entity: 'merchants',
        entityId: id,
        detail: { name: updated.name },
      })
      await insertNotification({
        userId: updated.owner_id,
        type: 'merchant_status',
        title:
          status === 'live'
            ? `${updated.name} is approved and live on the block`
            : `${updated.name} is now ${status}`,
        payload: { merchantId: id, status },
      })
      return { merchant: updated }
    })
  })

  app.post('/api/admin/merchants/:id/featured', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { id } = req.params as { id: string }
    const { featured } = FeaturedBody.parse(req.body ?? {})
    return withUser(session.id, async (db) => {
      await requireAdmin(req, db)
      const updated = await queryOne(
        db,
        'update merchants set featured = $2 where id = $1 returning id, name, featured',
        [id, featured],
      )
      if (!updated) throw notFound('Storefront not found')
      await writeAudit({
        actorId: session.id,
        action: featured ? 'merchant.feature' : 'merchant.unfeature',
        entity: 'merchants',
        entityId: id,
      })
      return { merchant: updated }
    })
  })

  app.get('/api/admin/neighborhoods', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    return withUser(session.id, async (db) => {
      await requireAdmin(req, db)
      const rows = await query(
        db,
        `select n.id, n.name, n.slug, n.city, n.timezone, n.active,
                st_y(n.center::geometry) as lat, st_x(n.center::geometry) as lng,
                (select count(*)::int from merchants m where m.neighborhood_id = n.id) as merchant_count,
                (select count(*)::int from merchants m where m.neighborhood_id = n.id and m.status = 'live') as live_count
         from neighborhoods n order by n.created_at asc`,
      )
      return { neighborhoods: rows }
    })
  })

  app.post('/api/admin/neighborhoods', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const body = NewNeighborhood.parse(req.body ?? {})
    return withUser(session.id, async (db) => {
      await requireAdmin(req, db)
      const slug = body.name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)
      const created = await queryOne(
        db,
        `insert into neighborhoods (name, slug, city, boundary, center)
         values ($1, $2, $3,
                 st_setsrid(st_buffer(st_setsrid(st_makepoint($5, $4), 4326)::geography, $6)::geometry, 4326)::geography,
                 st_setsrid(st_makepoint($5, $4), 4326)::geography)
         on conflict (slug) do update set name = excluded.name
         returning id, name, slug, city, active`,
        [body.name, slug, body.city, body.lat, body.lng, body.radiusM],
      )
      await writeAudit({
        actorId: session.id,
        action: 'neighborhood.create',
        entity: 'neighborhoods',
        entityId: created!.id,
        detail: { name: body.name },
      })
      return { neighborhood: created }
    })
  })

  app.post('/api/admin/orders/:id/refund', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { id } = req.params as { id: string }
    return withUser(session.id, async (db) => {
      await requireAdmin(req, db)
      const order = await queryOne<{ id: string; code: string; total_cents: number; payment_status: string; stripe_payment_intent: string | null }>(
        db,
        'select id, code, total_cents, payment_status, stripe_payment_intent from orders where id = $1',
        [id],
      )
      if (!order) throw notFound('Order not found')
      if (order.payment_status !== 'paid') throw forbidden('Only paid orders can be refunded')
      if (order.stripe_payment_intent) {
        const result = await refundPayment(order.stripe_payment_intent)
        if (!result.refunded) throw forbidden('The payment provider rejected the refund')
      }
      await db.query(
        `update orders set payment_status = 'refunded', refunded_at = now() where id = $1`,
        [id],
      )
      await writeAudit({
        actorId: session.id,
        action: 'order.refund',
        entity: 'orders',
        entityId: id,
        detail: { code: order.code, amountCents: order.total_cents },
      })
      return { ok: true, orderId: id }
    })
  })

  app.get('/api/admin/audit', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    return withUser(session.id, async (db) => {
      await requireAdmin(req, db)
      const rows = await query(
        db,
        `select a.id, a.action, a.entity, a.entity_id, a.detail, a.created_at, p.display_name as actor_name
         from audit_log a left join profiles p on p.id = a.actor_id
         order by a.created_at desc limit 40`,
      )
      return { entries: rows }
    })
  })
}
