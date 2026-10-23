import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { query, queryOne, withUser } from '../db.js'
import { badRequest, notFound, unauthorized } from '../lib/errors.js'
import { readSession } from '../lib/session.js'

const OptionInput = z.object({ name: z.string().max(60), priceDeltaCents: z.number().int().min(0).max(10000) })
const AddItem = z.object({
  merchantId: z.string().uuid(),
  itemId: z.string().uuid(),
  qty: z.number().int().min(1).max(50).default(1),
  options: z.array(OptionInput).max(10).default([]),
})
const PatchItem = z.object({ qty: z.number().int().min(0).max(50) })

const CART_SELECT = `
  select c.id, c.merchant_id, c.updated_at,
         m.name as merchant_name, m.slug as merchant_slug, m.accepts_pickup, m.phone as merchant_phone,
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'id', ci.id, 'item_id', ci.item_id, 'name', i.name, 'unit', i.unit,
             'qty', ci.qty, 'unit_price_cents', ci.unit_price_cents, 'options', ci.options,
             'image_url', i.image_url) order by ci.created_at asc)
           from cart_items ci join items i on i.id = ci.item_id
           where ci.cart_id = c.id
         ), '[]'::jsonb) as items
  from carts c
  join merchants m on m.id = c.merchant_id
  where c.user_id = current_user_id()
  order by c.updated_at desc
`

async function loadCarts(db: Parameters<typeof query>[0]) {
  return query<{ id: string; items: { qty: number; unit_price_cents: number }[] }>(db, CART_SELECT)
}

/** Recomputes line prices from the menu (and any live drop) so the cart can never drift. */
async function pricedItem(
  db: Parameters<typeof query>[0],
  itemId: string,
  merchantId: string,
  options: { priceDeltaCents: number }[],
) {
  const row = await queryOne<{ id: string; price_cents: number; in_stock: boolean; name: string }>(
    db,
    `select i.id, i.price_cents, i.in_stock, i.name,
            (select d.price_cents from drops d
             where d.item_id = i.id and d.starts_at <= now() and d.ends_at > now() and d.qty_left > 0
             order by d.ends_at asc limit 1) as drop_price_cents
     from items i where i.id = $1 and i.merchant_id = $2`,
    [itemId, merchantId],
  )
  if (!row) throw notFound('That item is not on this menu')
  if (!row.in_stock) throw badRequest(`${row.name} is out of stock right now`)
  const base = (row as unknown as { drop_price_cents: number | null }).drop_price_cents ?? row.price_cents
  const delta = options.reduce((sum, o) => sum + o.priceDeltaCents, 0)
  return { unitPriceCents: base + delta, name: row.name }
}

export async function cartRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/cart', async (req) => {
    const session = await readSession(req)
    if (!session) return { carts: [] }
    return withUser(session.id, async (db) => {
      const carts = await loadCarts(db)
      return { carts: carts.map(withTotals) }
    })
  })

  app.post('/api/cart/items', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const body = AddItem.parse(req.body ?? {})

    return withUser(session.id, async (db) => {
      const merchant = await queryOne<{ id: string; accepts_pickup: boolean; status: string }>(
        db,
        'select id, accepts_pickup, status from merchants where id = $1',
        [body.merchantId],
      )
      if (!merchant) throw notFound('Unknown storefront')
      if (!merchant.accepts_pickup) throw badRequest('This storefront is not taking pickup orders')

      const priced = await pricedItem(db, body.itemId, body.merchantId, body.options)
      const cart = await queryOne<{ id: string }>(
        db,
        `insert into carts (user_id, merchant_id) values ($1, $2)
         on conflict (user_id, merchant_id) do update set updated_at = now()
         returning id`,
        [session.id, body.merchantId],
      )
      const options = body.options.map((o) => ({ name: o.name, priceDeltaCents: o.priceDeltaCents }))

      const existing = await queryOne<{ id: string; qty: number }>(
        db,
        `select id, qty from cart_items
         where cart_id = $1 and item_id = $2 and options = $3::jsonb`,
        [cart!.id, body.itemId, JSON.stringify(options)],
      )
      if (existing) {
        await db.query('update cart_items set qty = qty + $2 where id = $1', [existing.id, body.qty])
      } else {
        await db.query(
          `insert into cart_items (cart_id, item_id, qty, options, unit_price_cents)
           values ($1, $2, $3, $4::jsonb, $5)`,
          [cart!.id, body.itemId, body.qty, JSON.stringify(options), priced.unitPriceCents],
        )
      }
      await db.query('update carts set updated_at = now() where id = $1', [cart!.id])

      const carts = await loadCarts(db)
      return { carts: carts.map(withTotals) }
    })
  })

  app.patch('/api/cart/items/:id', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { id } = req.params as { id: string }
    const { qty } = PatchItem.parse(req.body ?? {})
    return withUser(session.id, async (db) => {
      if (qty === 0) {
        await db.query('delete from cart_items where id = $1', [id])
      } else {
        await db.query('update cart_items set qty = $2 where id = $1', [id, qty])
      }
      await db.query(
        `update carts set updated_at = now() where id in (select cart_id from cart_items where id = $1)`,
        [id],
      )
      const carts = await loadCarts(db)
      return { carts: carts.map(withTotals) }
    })
  })

  app.delete('/api/cart/items/:id', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { id } = req.params as { id: string }
    return withUser(session.id, async (db) => {
      await db.query('delete from cart_items where id = $1', [id])
      const carts = await loadCarts(db)
      return { carts: carts.map(withTotals) }
    })
  })

  app.delete('/api/cart', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { merchant_id: merchantId } = req.query as { merchant_id?: string }
    return withUser(session.id, async (db) => {
      if (merchantId) {
        await db.query('delete from carts where user_id = $1 and merchant_id = $2', [session.id, merchantId])
      } else {
        await db.query('delete from carts where user_id = $1', [session.id])
      }
      const carts = await loadCarts(db)
      return { carts: carts.map(withTotals) }
    })
  })
}

export function cartTotals(items: { qty: number; unit_price_cents: number }[]) {
  const subtotalCents = items.reduce((sum, i) => sum + i.qty * i.unit_price_cents, 0)
  return { subtotalCents, itemCount: items.reduce((sum, i) => sum + i.qty, 0) }
}

function withTotals<T extends { items: { qty: number; unit_price_cents: number }[] }>(cart: T) {
  return { ...cart, ...cartTotals(cart.items) }
}
