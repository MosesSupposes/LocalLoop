import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { query, queryOne, withUser } from '../db.js'
import { badRequest, unauthorized } from '../lib/errors.js'
import { readSession } from '../lib/session.js'

const FavoriteBody = z.object({ slot: z.number().int().min(1).max(8).nullable().optional() })

export async function favoriteRoutes(app: FastifyInstance): Promise<void> {
  /** Speed dial is capped at 8 tiles per neighbor, matching the 2x4 grid on Home. */
  app.put('/api/favorites/:merchantId', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { merchantId } = req.params as { merchantId: string }
    const body = FavoriteBody.parse(req.body ?? {})

    return withUser(session.id, async (db) => {
      const merchant = await queryOne(db, 'select id, name from merchants where id = $1', [merchantId])
      if (!merchant) throw badRequest('Unknown storefront')

      let slot = body.slot ?? null
      if (slot === null) {
        const used = await query<{ speed_dial_slot: number }>(
          db,
          'select speed_dial_slot from favorites where user_id = $1 and speed_dial_slot is not null',
          [session.id],
        )
        const taken = new Set(used.map((r) => r.speed_dial_slot))
        if (taken.size >= 8) throw badRequest('Your speed dial is full. Remove a tile first.')
        for (let i = 1; i <= 8; i += 1) {
          if (!taken.has(i)) {
            slot = i
            break
          }
        }
      }

      await db.query(
        `insert into favorites (user_id, merchant_id, speed_dial_slot) values ($1, $2, $3)
         on conflict (user_id, merchant_id) do update set speed_dial_slot = excluded.speed_dial_slot`,
        [session.id, merchantId, slot],
      )
      return { ok: true, slot }
    })
  })

  app.delete('/api/favorites/:merchantId', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { merchantId } = req.params as { merchantId: string }
    return withUser(session.id, async (db) => {
      await db.query('delete from favorites where user_id = $1 and merchant_id = $2', [
        session.id,
        merchantId,
      ])
      return { ok: true }
    })
  })
}
