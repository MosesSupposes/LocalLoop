import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ownerPool, query, queryOne, withUser } from '../db.js'
import { env, features } from '../env.js'
import { badRequest, conflict, notFound, unauthorized } from '../lib/errors.js'
import { readSession } from '../lib/session.js'
import { CATEGORY_KEYS } from '../lib/categories.js'
import { transitionOrder } from '../services/orderFlow.js'
import { refundPayment } from '../services/payments.js'
import { generateDealCopy } from '../services/menuImport.js'
import { insertNotification } from '../services/notify.js'

const HoursSchema = z.record(z.array(z.tuple([z.string(), z.string()])).max(4))
const TimeRe = /^([01]\d|2[0-3]):[0-5]\d$/

const NewMerchant = z.object({
  name: z.string().min(2).max(80),
  category: z.enum(CATEGORY_KEYS as [string, ...string[]]),
  description: z.string().max(400).optional(),
  address: z.string().min(4).max(200),
  phone: z.string().min(7).max(24),
  lat: z.number().min(-90).max(90),
  lng: z.number().min(-180).max(180),
  hours: HoursSchema.optional(),
})

const MerchantPatch = z.object({
  name: z.string().min(2).max(80).optional(),
  description: z.string().max(400).optional(),
  phone: z.string().min(7).max(24).optional(),
  address: z.string().min(4).max(200).optional(),
  acceptsPickup: z.boolean().optional(),
  acceptsDelivery: z.boolean().optional(),
  hours: HoursSchema.optional(),
  status: z.enum(['live', 'paused']).optional(),
})

const ItemInput = z.object({
  name: z.string().min(1).max(90),
  description: z.string().max(400).nullable().optional(),
  priceCents: z.number().int().min(25).max(200000),
  categoryId: z.string().uuid().nullable().optional(),
  unit: z.string().max(24).nullable().optional(),
  inStock: z.boolean().optional(),
  stockQty: z.number().int().min(0).max(10000).nullable().optional(),
  isCommodity: z.boolean().optional(),
  freshnessNote: z.string().max(120).nullable().optional(),
  tags: z.array(z.string().max(24)).max(6).optional(),
  dietary: z.array(z.string().max(24)).max(6).optional(),
})

const DropInput = z.object({
  itemId: z.string().uuid().nullable().optional(),
  title: z.string().min(3).max(120),
  qtyTotal: z.number().int().min(1).max(500),
  priceCents: z.number().int().min(25).max(200000),
  endsAt: z.string().datetime(),
})

const DealInput = z.object({
  title: z.string().min(3).max(120),
  type: z.enum(['percent', 'fixed']),
  value: z.number().int().min(1).max(100000),
  endsAt: z.string().datetime(),
})

async function requireOwnedMerchant(db: Parameters<typeof query>[0], merchantId: string) {
  const merchant = await queryOne<{
    id: string
    name: string
    status: string
    owner_id: string
    stripe_account_id: string | null
    accepts_pickup: boolean
  }>(
    db,
    'select id, name, status, owner_id, stripe_account_id, accepts_pickup from merchants where id = $1',
    [merchantId],
  )
  if (!merchant) throw notFound('Storefront not found')
  return merchant
}

export async function merchantRoutes(app: FastifyInstance): Promise<void> {
  /** Which storefronts does this account own (a merchant can run more than one)? */
  app.get('/api/merchant/context', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    return withUser(session.id, async (db) => {
      const merchants = await query(
        db,
        `select m.id, m.name, m.slug, m.status, m.category, m.featured, m.hours,
                is_open_now(m.hours, m.timezone) as open_now,
                (select count(*)::int from orders o where o.merchant_id = m.id
                   and o.status in ('placed', 'accepted', 'ready')) as open_orders,
                (select count(*)::int from drops d where d.merchant_id = m.id
                   and d.ends_at > now() and d.qty_left > 0) as live_drops,
                m.stripe_account_id is not null as payouts_connected
         from merchants m where m.owner_id = current_user_id() order by m.name`,
      )
      const roles = await db.query<{ role: string }>('select role from user_roles where user_id = $1', [
        session.id,
      ])
      return {
        merchants,
        roles: roles.rows.map((r) => r.role),
        categories: CATEGORY_KEYS,
        payoutsMode: features.stripe ? 'stripe_connect' : 'simulated',
      }
    })
  })

  /** A new storefront starts as `pending` and waits for neighborhood ops approval. */
  app.post('/api/merchant', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const body = NewMerchant.parse(req.body ?? {})
    const defaultHours = JSON.stringify({
      mon: [['09:00', '18:00']],
      tue: [['09:00', '18:00']],
      wed: [['09:00', '18:00']],
      thu: [['09:00', '18:00']],
      fri: [['09:00', '18:00']],
      sat: [['10:00', '16:00']],
    })
    return withUser(session.id, async (db) => {
      const neighborhood = await queryOne<{ id: string }>(
        db,
        'select id from neighborhoods where active order by name limit 1',
      )
      const slugBase = body.name
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, '-')
        .replace(/^-|-$/g, '')
        .slice(0, 40)
      const slug = `${slugBase}-${Math.random().toString(36).slice(2, 6)}`
      const created = await queryOne<{ id: string; slug: string }>(
        db,
        `insert into merchants (owner_id, neighborhood_id, name, slug, category, description, phone,
                                address, location, hours, status)
         values ($1, $2, $3, $4, $5, $6, $7, $8,
                 st_setsrid(st_makepoint($10, $9), 4326)::geography, $11::jsonb, 'pending')
         returning id, slug`,
        [
          session.id,
          neighborhood?.id ?? null,
          body.name,
          slug,
          body.category,
          body.description ?? null,
          body.phone,
          body.address,
          body.lat,
          body.lng,
          body.hours ? JSON.stringify(body.hours) : defaultHours,
        ],
      )
      await db.query(
        `insert into user_roles (user_id, role) values ($1, 'merchant') on conflict do nothing`,
        [session.id],
      )
      return { merchant: created, status: 'pending' }
    })
  })

  app.patch('/api/merchant/:id', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { id } = req.params as { id: string }
    const body = MerchantPatch.parse(req.body ?? {})
    for (const day of Object.keys(body.hours ?? {})) {
      for (const range of body.hours![day]!) {
        if (!TimeRe.test(range[0]) || !TimeRe.test(range[1])) {
          throw badRequest('Hours must look like 09:00 to 18:00')
        }
      }
    }
    return withUser(session.id, async (db) => {
      const merchant = await requireOwnedMerchant(db, id)
      if (body.status === 'live' && merchant.status === 'pending') {
        throw conflict('Neighborhood ops has to approve the storefront before it goes live')
      }
      const updated = await queryOne(
        db,
        `update merchants set
           name = coalesce($2, name),
           description = coalesce($3, description),
           phone = coalesce($4, phone),
           address = coalesce($5, address),
           accepts_pickup = coalesce($6, accepts_pickup),
           accepts_delivery = coalesce($7, accepts_delivery),
           hours = coalesce($8::jsonb, hours),
           status = coalesce($9::merchant_status, status)
         where id = $1
         returning id, name, slug, status, description, phone, address, hours, accepts_pickup, accepts_delivery`,
        [
          id,
          body.name ?? null,
          body.description ?? null,
          body.phone ?? null,
          body.address ?? null,
          body.acceptsPickup ?? null,
          body.acceptsDelivery ?? null,
          body.hours ? JSON.stringify(body.hours) : null,
          body.status ?? null,
        ],
      )
      return { merchant: updated }
    })
  })

  /** Live order queue for the dashboard. */
  app.get('/api/merchant/:id/orders', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { id } = req.params as { id: string }
    const { status } = z
      .object({ status: z.enum(['open', 'placed', 'accepted', 'ready', 'done', 'cancelled']).optional() })
      .parse(req.query ?? {})

    const filter =
      status === 'open'
        ? `and o.status in ('placed', 'accepted', 'ready')`
        : status === 'done'
          ? `and o.status in ('picked_up', 'delivered')`
          : status
            ? `and o.status = '${status}'::order_status`
            : ''

    return withUser(session.id, async (db) => {
      await requireOwnedMerchant(db, id)
      const orders = await query(
        db,
        `select o.id, o.code, o.status, o.total_cents, o.subtotal_cents, o.tip_cents, o.payment_status,
                o.payment_provider, o.note, o.created_at, o.updated_at, o.pickup_eta,
                p.display_name as neighbor_name,
                (select jsonb_agg(jsonb_build_object('name', oi.name_snapshot, 'qty', oi.qty,
                                                     'price_cents', oi.price_snapshot, 'options', oi.options)
                                  order by oi.name_snapshot)
                 from order_items oi where oi.order_id = o.id) as items
         from orders o join profiles p on p.id = o.user_id
         where o.merchant_id = $1 ${filter}
         order by case o.status when 'placed' then 0 when 'accepted' then 1 when 'ready' then 2 else 3 end,
                  o.created_at desc
         limit 60`,
        [id],
      )
      return { orders }
    })
  })

  /** The big tap-friendly buttons: accept, ready, picked up. Illegal moves are rejected. */
  app.post('/api/merchant/:id/orders/:orderId/:action', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { id, orderId, action } = req.params as { id: string; orderId: string; action: string }
    const map: Record<string, 'accepted' | 'ready' | 'picked_up' | 'cancelled'> = {
      accept: 'accepted',
      ready: 'ready',
      'picked-up': 'picked_up',
      cancel: 'cancelled',
    }
    const to = map[action]
    if (!to) throw badRequest('Unknown order action')
    const { reason } = z.object({ reason: z.string().max(160).optional() }).parse(req.body ?? {})

    return withUser(session.id, async (db) => {
      const merchant = await requireOwnedMerchant(db, id)
      const order = await queryOne<{ id: string; merchant_id: string }>(
        db,
        'select id, merchant_id from orders where id = $1 and merchant_id = $2',
        [orderId, id],
      )
      if (!order) throw notFound('Order not found for this storefront')

      await transitionOrder({
        db,
        orderId,
        to,
        actorId: session.id,
        reason: reason ?? null,
        refund: refundPayment,
      })
      const view = await queryOne(
        db,
        `select o.id, o.code, o.status, o.total_cents, o.pickup_eta, o.updated_at
         from orders o where o.id = $1`,
        [orderId],
      )
      return { order: view, merchant: { id: merchant.id, name: merchant.name } }
    })
  })

  /** Menu read + write. */
  app.get('/api/merchant/:id/menu', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { id } = req.params as { id: string }
    return withUser(session.id, async (db) => {
      await requireOwnedMerchant(db, id)
      const categories = await query(
        db,
        'select id, name, sort from menu_categories where merchant_id = $1 order by sort, name',
        [id],
      )
      const items = await query(
        db,
        `select i.id, i.name, i.description, i.price_cents, i.unit, i.category_id, i.in_stock,
                i.stock_qty, i.tags, i.dietary, i.is_commodity, i.freshness_note, i.sort,
                coalesce((select jsonb_agg(jsonb_build_object('id', o.id, 'name', o.name,
                   'group_name', o.group_name, 'price_delta_cents', o.price_delta_cents, 'required', o.required)
                   order by o.sort) from item_options o where o.item_id = i.id), '[]'::jsonb) as options
         from items i where i.merchant_id = $1 order by i.sort, i.name`,
        [id],
      )
      const drops = await query(
        db,
        `select d.id, d.title, d.qty_total, d.qty_left, d.price_cents, d.starts_at, d.ends_at, d.item_id
         from drops d where d.merchant_id = $1 order by d.ends_at desc limit 20`,
        [id],
      )
      const deals = await query(
        db,
        `select id, title, type, value, starts_at, ends_at, active from deals
         where merchant_id = $1 order by ends_at desc limit 20`,
        [id],
      )
      return { categories, items, drops, deals }
    })
  })

  app.post('/api/merchant/:id/categories', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { id } = req.params as { id: string }
    const body = z.object({ name: z.string().min(1).max(40), sort: z.number().int().min(0).max(99).optional() }).parse(req.body ?? {})
    return withUser(session.id, async (db) => {
      await requireOwnedMerchant(db, id)
      const created = await queryOne(
        db,
        `insert into menu_categories (merchant_id, name, sort) values ($1, $2, $3)
         on conflict (merchant_id, name) do update set sort = excluded.sort
         returning id, name, sort`,
        [id, body.name, body.sort ?? 0],
      )
      return { category: created }
    })
  })

  app.post('/api/merchant/:id/items', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { id } = req.params as { id: string }
    const body = ItemInput.parse(req.body ?? {})
    return withUser(session.id, async (db) => {
      await requireOwnedMerchant(db, id)
      const created = await queryOne(
        db,
        `insert into items (merchant_id, category_id, name, description, price_cents, unit, in_stock,
                            stock_qty, is_commodity, freshness_note, tags, dietary)
         values ($1, $2, $3, $4, $5, $6, coalesce($7, true), $8, coalesce($9, false), $10,
                 coalesce($11::text[], '{}'), coalesce($12::text[], '{}'))
         on conflict (merchant_id, name) do update set price_cents = excluded.price_cents,
           description = excluded.description, category_id = excluded.category_id
         returning id, name, price_cents, in_stock`,
        [
          id,
          body.categoryId ?? null,
          body.name,
          body.description ?? null,
          body.priceCents,
          body.unit ?? null,
          body.inStock ?? null,
          body.stockQty ?? null,
          body.isCommodity ?? null,
          body.freshnessNote ?? null,
          body.tags ?? null,
          body.dietary ?? null,
        ],
      )
      return { item: created }
    })
  })

  app.patch('/api/merchant/:id/items/:itemId', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { id, itemId } = req.params as { id: string; itemId: string }
    const body = ItemInput.partial().parse(req.body ?? {})
    return withUser(session.id, async (db) => {
      await requireOwnedMerchant(db, id)
      const updated = await queryOne(
        db,
        `update items set
           name = coalesce($3, name),
           description = coalesce($4, description),
           price_cents = coalesce($5, price_cents),
           unit = coalesce($6, unit),
           category_id = coalesce($7, category_id),
           in_stock = coalesce($8, in_stock),
           stock_qty = coalesce($9, stock_qty),
           is_commodity = coalesce($10, is_commodity),
           freshness_note = coalesce($11, freshness_note),
           tags = coalesce($12::text[], tags),
           dietary = coalesce($13::text[], dietary)
         where id = $1 and merchant_id = $2
         returning id, name, price_cents, in_stock, stock_qty, category_id`,
        [
          itemId,
          id,
          body.name ?? null,
          body.description ?? null,
          body.priceCents ?? null,
          body.unit ?? null,
          body.categoryId ?? null,
          body.inStock ?? null,
          body.stockQty ?? null,
          body.isCommodity ?? null,
          body.freshnessNote ?? null,
          body.tags ?? null,
          body.dietary ?? null,
        ],
      )
      if (!updated) throw notFound('Item not found')
      return { item: updated }
    })
  })

  app.delete('/api/merchant/:id/items/:itemId', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { id, itemId } = req.params as { id: string; itemId: string }
    return withUser(session.id, async (db) => {
      await requireOwnedMerchant(db, id)
      await db.query('delete from items where id = $1 and merchant_id = $2', [itemId, id])
      return { ok: true }
    })
  })

  app.post('/api/merchant/:id/items/:itemId/options', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { id, itemId } = req.params as { id: string; itemId: string }
    const body = z
      .object({
        name: z.string().min(1).max(60),
        priceDeltaCents: z.number().int().min(0).max(10000).default(0),
        groupName: z.string().min(1).max(40),
        required: z.boolean().default(false),
      })
      .parse(req.body ?? {})
    return withUser(session.id, async (db) => {
      await requireOwnedMerchant(db, id)
      const created = await queryOne(
        db,
        `insert into item_options (item_id, name, price_delta_cents, group_name, required)
         select $1, $2, $3, $4, $5
         where exists (select 1 from items i where i.id = $1 and i.merchant_id = $6)
         on conflict (item_id, group_name, name) do update set price_delta_cents = excluded.price_delta_cents
         returning id, name, group_name, price_delta_cents`,
        [itemId, body.name, body.priceDeltaCents, body.groupName, body.required, id],
      )
      if (!created) throw notFound('Item not found')
      return { option: created }
    })
  })

  /** Drops: time-boxed stock that pushes to neighbors nearby. */
  app.post('/api/merchant/:id/drops', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { id } = req.params as { id: string }
    const body = DropInput.parse(req.body ?? {})
    return withUser(session.id, async (db) => {
      const merchant = await requireOwnedMerchant(db, id)
      const created = await queryOne<{ id: string; title: string }>(
        db,
        `insert into drops (merchant_id, item_id, title, qty_total, qty_left, price_cents, ends_at)
         values ($1, $2, $3, $4, $4, $5, $6)
         on conflict (merchant_id, title) do update set
           qty_total = excluded.qty_total, qty_left = excluded.qty_left,
           price_cents = excluded.price_cents, ends_at = excluded.ends_at
         returning id, title`,
        [id, body.itemId ?? null, body.title, body.qtyTotal, body.priceCents, body.endsAt],
      )
      await insertNotification({
        userId: merchant.owner_id,
        type: 'drop',
        title: `Drop live: ${created!.title}`,
        payload: { dropId: created!.id },
      })
      return { drop: created }
    })
  })

  app.post('/api/merchant/:id/drops/:dropId/close', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { id, dropId } = req.params as { id: string; dropId: string }
    return withUser(session.id, async (db) => {
      await requireOwnedMerchant(db, id)
      const updated = await queryOne(
        db,
        `update drops set ends_at = now() where id = $1 and merchant_id = $2 returning id, ends_at`,
        [dropId, id],
      )
      if (!updated) throw notFound('Drop not found')
      return { drop: updated }
    })
  })

  app.post('/api/merchant/:id/deals', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { id } = req.params as { id: string }
    const body = DealInput.parse(req.body ?? {})
    if (body.type === 'percent' && body.value > 90) throw badRequest('Keep a percent deal at 90 or below')
    return withUser(session.id, async (db) => {
      await requireOwnedMerchant(db, id)
      const created = await queryOne(
        db,
        `insert into deals (merchant_id, title, type, value, ends_at, active)
         values ($1, $2, $3::deal_type, $4, $5, true)
         on conflict (merchant_id, title) do update set value = excluded.value,
           type = excluded.type, ends_at = excluded.ends_at, active = true
         returning id, title, type, value, ends_at`,
        [id, body.title, body.type, body.value, body.endsAt],
      )
      return { deal: created }
    })
  })

  app.delete('/api/merchant/:id/deals/:dealId', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { id, dealId } = req.params as { id: string; dealId: string }
    return withUser(session.id, async (db) => {
      await requireOwnedMerchant(db, id)
      await db.query('update deals set active = false where id = $1 and merchant_id = $2', [dealId, id])
      return { ok: true }
    })
  })

  app.post('/api/merchant/:id/deal-copy', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { id } = req.params as { id: string }
    const body = z
      .object({ itemName: z.string().max(80).optional(), discount: z.string().min(2).max(40) })
      .parse(req.body ?? {})
    return withUser(session.id, async (db) => {
      const merchant = await requireOwnedMerchant(db, id)
      const copy = await generateDealCopy({
        merchantName: merchant.name,
        category: 'storefront',
        itemName: body.itemName,
        discount: body.discount,
      })
      return { copy }
    })
  })

  app.get('/api/merchant/:id/analytics', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { id } = req.params as { id: string }
    return withUser(session.id, async (db) => {
      await requireOwnedMerchant(db, id)
      const summary = await queryOne(
        db,
        `select
           (select count(*)::int from orders where merchant_id = $1 and status not in ('cancelled', 'placed')
              and created_at >= now() - interval '7 days') as orders_7d,
           (select coalesce(sum(subtotal_cents), 0)::int from orders where merchant_id = $1
              and payment_status = 'paid' and created_at >= now() - interval '7 days') as revenue_7d,
           (select coalesce(sum(subtotal_cents - platform_fee_cents), 0)::int from orders where merchant_id = $1
              and payment_status = 'paid' and created_at >= now() - interval '7 days') as payout_7d,
           (select count(*)::int from orders where merchant_id = $1 and status not in ('cancelled', 'placed')
              and created_at >= now() - interval '30 days') as orders_30d,
           (select coalesce(sum(subtotal_cents - platform_fee_cents), 0)::int from orders where merchant_id = $1
              and payment_status = 'paid' and created_at >= now() - interval '30 days') as payout_30d,
           (select count(*)::int from orders where merchant_id = $1 and status in ('placed', 'accepted', 'ready')) as open_orders,
           (select count(*)::int from favorites where merchant_id = $1) as speed_dial_adds,
           (select count(*)::int from reviews where merchant_id = $1) as review_count`,
        [id],
      )
      const daily = await query(
        db,
        `select to_char(d.day, 'YYYY-MM-DD') as day,
                coalesce(sum(o.subtotal_cents), 0)::int as revenue_cents,
                count(o.id)::int as orders
         from generate_series((current_date - interval '13 days'), current_date, interval '1 day') as d(day)
         left join orders o on o.merchant_id = $1 and o.payment_status = 'paid'
              and o.created_at::date = d.day::date
         group by d.day order by d.day`,
        [id],
      )
      const topItems = await query(
        db,
        `select oi.name_snapshot as name, sum(oi.qty)::int as qty,
                sum(oi.qty * oi.price_snapshot)::int as revenue_cents
         from order_items oi join orders o on o.id = oi.order_id
         where o.merchant_id = $1 and o.status <> 'cancelled'
           and o.created_at >= now() - interval '30 days'
         group by oi.name_snapshot order by qty desc limit 6`,
        [id],
      )
      return { summary, daily, topItems }
    })
  })

  app.get('/api/merchant/:id/payouts', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { id } = req.params as { id: string }
    return withUser(session.id, async (db) => {
      const merchant = await requireOwnedMerchant(db, id)
      const rows = await query(
        db,
        `select to_char(date_trunc('day', created_at), 'YYYY-MM-DD') as day,
                coalesce(sum(subtotal_cents - platform_fee_cents), 0)::int as payout_cents,
                coalesce(sum(platform_fee_cents), 0)::int as platform_fee_cents,
                count(*)::int as orders
         from orders
         where merchant_id = $1 and payment_status = 'paid' and status <> 'cancelled'
         group by 1 order by 1 desc limit 14`,
        [id],
      )
      return {
        mode: merchant.stripe_account_id ? 'stripe_connect' : features.stripe ? 'simulated' : 'simulated',
        connected: Boolean(merchant.stripe_account_id),
        rows,
        note: merchant.stripe_account_id
          ? 'Payouts settle to the connected Stripe account in test mode.'
          : 'Sandbox payouts are simulated. Connect Stripe in production to receive real transfers.',
      }
    })
  })

  /** Stripe Connect Express onboarding. Real API calls when keys are configured. */
  app.post('/api/merchant/:id/stripe-connect', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { id } = req.params as { id: string }
    if (!features.stripe) {
      return {
        configured: false,
        message: 'Stripe keys are not configured in this environment, so payouts stay simulated.',
      }
    }
    return withUser(session.id, async (db) => {
      const merchant = await requireOwnedMerchant(db, id)
      let accountId = merchant.stripe_account_id
      if (!accountId) {
        const accountRes = await fetch('https://api.stripe.com/v1/accounts', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${env.stripeSecretKey}`,
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body: new URLSearchParams({
            type: 'express',
            'capabilities[card_payments][requested]': 'true',
            'capabilities[transfers][requested]': 'true',
            'business_profile[name]': merchant.name,
          }),
        })
        const account = (await accountRes.json()) as { id?: string }
        if (!account.id) throw badRequest('Stripe rejected the account request')
        accountId = account.id
        await db.query('update merchants set stripe_account_id = $2 where id = $1', [id, accountId])
      }
      const linkRes = await fetch('https://api.stripe.com/v1/account_links', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${env.stripeSecretKey}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
          account: accountId,
          type: 'account_onboarding',
          refresh_url: `${env.publicWebOrigin}/merchant`,
          return_url: `${env.publicWebOrigin}/merchant`,
        }),
      })
      const link = (await linkRes.json()) as { url?: string }
      return { configured: true, accountId, onboardingUrl: link.url ?? null }
    })
  })

  /** Neighborhood-ops view of pending storefronts is admin-only; this is the owner's own list. */
  app.get('/api/merchant/:id', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { id } = req.params as { id: string }
    return withUser(session.id, async (db) => {
      const merchant = await queryOne(
        db,
        `select m.id, m.name, m.slug, m.status, m.category, m.description, m.phone, m.address, m.hours,
                m.accepts_pickup, m.accepts_delivery, m.rating_avg::float8 as rating_avg,
                st_y(m.location::geometry) as lat, st_x(m.location::geometry) as lng,
                m.stripe_account_id is not null as payouts_connected,
                is_open_now(m.hours, m.timezone) as open_now
         from merchants m where m.id = $1`,
        [id],
      )
      if (!merchant) throw notFound('Storefront not found')
      return { merchant }
    })
  })
}

/** Used by the worker to alert followers when a favorite storefront posts a drop. */
export async function notifyDropFollowers(dropId: string): Promise<number> {
  const rows = await ownerPool.query<{ id: string; title: string; slug: string; user_id: string }>(
    `select d.id, d.title, m.slug, f.user_id
     from drops d
     join merchants m on m.id = d.merchant_id
     join favorites f on f.merchant_id = m.id
     where d.id = $1`,
    [dropId],
  )
  for (const row of rows.rows) {
    await ownerPool.query(
      `insert into notifications (user_id, type, title, payload) values ($1, 'drop', $2, $3::jsonb)`,
      [row.user_id, `New drop at a speed-dial spot: ${row.title}`, JSON.stringify({ slug: row.slug, dropId: row.id })],
    )
  }
  return rows.rowCount ?? 0
}
