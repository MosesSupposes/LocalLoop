import { afterAll, describe, expect, it } from 'vitest'
import crypto from 'node:crypto'
import { ownerPool, withUser } from '../src/db.js'

/**
 * Proves the RLS policies actually isolate tenants:
 *  - a neighbor cannot read another neighbor's order, nor a signed-out visitor
 *  - a merchant sees the orders on their own counter only
 *  - a merchant cannot edit someone else's storefront
 * Skips automatically when the database env vars are absent (e.g. a lint-only CI job).
 */
const suite = process.env.APP_DATABASE_URL && process.env.DATABASE_URL ? describe : describe.skip

suite('row level security', () => {
  const created = { profiles: [] as string[], orders: [] as string[] }

  afterAll(async () => {
    if (created.orders.length) {
      await ownerPool.query('delete from order_items where order_id = any($1::uuid[])', [created.orders])
      await ownerPool.query('delete from orders where id = any($1::uuid[])', [created.orders])
    }
    if (created.profiles.length) {
      await ownerPool.query('delete from profiles where id = any($1::uuid[])', [created.profiles])
    }
    await ownerPool.end()
  })

  async function makeUser(label: string): Promise<string> {
    const id = crypto.randomUUID()
    await ownerPool.query('insert into profiles (id, display_name, email) values ($1, $2, $3)', [
      id,
      `RLS ${label}`,
      `rls-${label}-${id.slice(0, 8)}@localloop.test`,
    ])
    created.profiles.push(id)
    return id
  }

  async function makeOrder(userId: string, merchantId: string, subtotal = 1000): Promise<string> {
    const id = crypto.randomUUID()
    await withUser(userId, async (db) => {
      await db.query(
        `insert into orders (id, code, user_id, merchant_id, status, subtotal_cents, total_cents, payment_status)
         values ($1, $2, $3, $4, 'placed', $5, $5, 'paid')`,
        [id, `RLS-${id.slice(0, 8)}`, userId, merchantId, subtotal],
      )
    })
    created.orders.push(id)
    return id
  }

  async function orderVisibleTo(userId: string | null, orderId: string): Promise<number> {
    return withUser(userId, async (db) => {
      const res = await db.query('select id from orders where id = $1', [orderId])
      return res.rowCount ?? 0
    })
  }

  it('hides an order from other neighbors and from signed-out visitors', async () => {
    const merchant = await ownerPool.query<{ id: string; owner_id: string }>(
      `select id, owner_id from merchants where status = 'live' order by name limit 1`,
    )
    const other = await ownerPool.query<{ owner_id: string }>(
      `select owner_id from merchants where status = 'live' and owner_id <> $1 order by name limit 1`,
      [merchant.rows[0]!.owner_id],
    )
    const merchantId = merchant.rows[0]!.id
    const ownerId = merchant.rows[0]!.owner_id

    const alice = await makeUser('alice')
    const bob = await makeUser('bob')
    const orderId = await makeOrder(alice, merchantId)

    expect(await orderVisibleTo(alice, orderId)).toBe(1)
    expect(await orderVisibleTo(bob, orderId)).toBe(0)
    expect(await orderVisibleTo(null, orderId)).toBe(0)
    expect(await orderVisibleTo(ownerId, orderId)).toBe(1)
    if (other.rows[0]) {
      expect(await orderVisibleTo(other.rows[0].owner_id, orderId)).toBe(0)
    }
  })

  it('stops a neighbor from editing a storefront or reading private profile data', async () => {
    const merchant = await ownerPool.query<{ id: string; owner_id: string; name: string }>(
      `select id, owner_id, name from merchants where status = 'live' order by name limit 1`,
    )
    const merchantId = merchant.rows[0]!.id
    const originalName = merchant.rows[0]!.name
    const intruder = await makeUser('mallory')

    const updated = await withUser(intruder, async (db) => {
      const res = await db.query('update merchants set name = $2 where id = $1', [merchantId, 'Hacked'])
      return res.rowCount ?? 0
    })
    expect(updated).toBe(0)

    const others = await withUser(intruder, async (db) => {
      const res = await db.query('select id, phone from profiles where id <> $1', [intruder])
      return res.rowCount ?? 0
    })
    expect(others).toBe(0)

    const unchanged = await ownerPool.query<{ name: string }>('select name from merchants where id = $1', [
      merchantId,
    ])
    expect(unchanged.rows[0]!.name).toBe(originalName)
  })

  it('reserves drop stock atomically without letting a neighbor write the drop', async () => {
    const drop = await ownerPool.query<{ id: string; qty_left: number }>(
      `select id, qty_left from drops where qty_left > 2 order by ends_at limit 1`,
    )
    if (!drop.rows[0]) return
    const dropId = drop.rows[0].id
    const before = drop.rows[0].qty_left
    const neighbor = await makeUser('erin')

    const reserved = await withUser(neighbor, async (db) => {
      const res = await db.query<{ remaining: number }>('select reserve_drop_units($1, $2) as remaining', [dropId, 2])
      return res.rows[0]?.remaining
    })
    expect(reserved).toBe(before - 2)

    // Asking for more than is left must not reserve anything.
    const tooMany = await withUser(neighbor, async (db) => {
      const res = await db.query<{ remaining: number }>('select reserve_drop_units($1, $2) as remaining', [
        dropId,
        before + 100,
      ])
      return res.rows[0]?.remaining
    })
    expect(tooMany).toBe(-1)

    // A neighbor still cannot rewrite stock directly.
    const directWrite = await withUser(neighbor, async (db) => {
      const res = await db.query('update drops set qty_left = 999 where id = $1', [dropId])
      return res.rowCount ?? 0
    })
    expect(directWrite).toBe(0)

    const after = await ownerPool.query<{ qty_left: number }>('select qty_left from drops where id = $1', [dropId])
    expect(after.rows[0]!.qty_left).toBe(before - 2)

    // Restore the seeded stock level.
    await ownerPool.query('update drops set qty_left = $2 where id = $1', [dropId, before])
  })

  it('lets a neighbor read public storefront data and their own cart only', async () => {
    const alice = await makeUser('carol')
    const bob = await makeUser('dave')

    const publicMerchants = await withUser(alice, async (db) => {
      const res = await db.query('select id from merchants where status = $1', ['live'])
      return res.rowCount ?? 0
    })
    expect(publicMerchants).toBeGreaterThan(1)

    const pending = await withUser(alice, async (db) => {
      const res = await db.query('select id from merchants where status = $1', ['pending'])
      return res.rowCount ?? 0
    })
    expect(pending).toBe(0)

    await withUser(alice, async (db) => {
      await db.query('insert into carts (user_id, merchant_id) select $1, id from merchants limit 1', [alice])
    })
    const bobCarts = await withUser(bob, async (db) => {
      const res = await db.query('select id from carts')
      return res.rowCount ?? 0
    })
    expect(bobCarts).toBe(0)
  })
})
