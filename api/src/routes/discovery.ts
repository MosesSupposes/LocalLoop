import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { pool, query, queryOne, withUser } from '../db.js'
import { features } from '../env.js'
import { CATEGORIES } from '../lib/categories.js'
import { notFound } from '../lib/errors.js'
import { readSession } from '../lib/session.js'

/** Default view: the middle of Echo Park (the seeded neighborhood). */
export const DEFAULT_CENTER = { lat: 34.0783, lng: -118.2605 }

const flag = z
  .string()
  .optional()
  .transform((v) => v === '1' || v === 'true')

const NearbyQuery = z.object({
  lat: z.coerce.number().min(-90).max(90).default(DEFAULT_CENTER.lat),
  lng: z.coerce.number().min(-180).max(180).default(DEFAULT_CENTER.lng),
  radius_m: z.coerce.number().int().min(100).max(20000).default(1600),
  category: z.string().max(30).optional(),
  open_now: flag,
  deals: flag,
  pickup: flag,
})

const MERCHANT_FIELDS = `
  nm.id, nm.name, nm.slug, nm.category, nm.description, nm.logo_url, nm.cover_url,
  nm.address, nm.phone, nm.hours, nm.rating_avg::float8 as rating_avg, nm.status,
  nm.accepts_pickup, nm.accepts_delivery, nm.featured, nm.lat, nm.lng,
  round(nm.distance_m)::int as distance_m, nm.walk_minutes, nm.open_now,
  nm.has_live_drop, nm.has_active_deal
`

export async function discoveryRoutes(app: FastifyInstance): Promise<void> {
  app.get('/api/config', async () => {
    const fees = await queryOne<{ platform_fee_bps: number; service_fee_cents: number }>(
      pool,
      'select platform_fee_bps, service_fee_cents from fee_config where id = 1',
    ).catch(() => null)
    return {
      mapboxToken: process.env.MAPBOX_TOKEN || null,
      map: { provider: process.env.MAPBOX_TOKEN ? 'mapbox' : 'neon-canvas' },
      categories: CATEGORIES,
      currency: 'usd',
      fees: {
        platformFeeBps: fees?.platform_fee_bps ?? 500,
        serviceFeeCents: fees?.service_fee_cents ?? 99,
      },
      integrations: {
        payments: features.stripe ? 'stripe' : 'simulated',
        bitcoin: features.bitcoin ? 'btcpay' : 'simulated',
        sms: features.sms ? 'twilio' : 'logged',
        ai: features.ai ? 'llm' : 'text_parser',
      },
      center: DEFAULT_CENTER,
    }
  })

  app.get('/api/neighborhoods', async () => {
    return withUser(null, async (db) => {
      const rows = await query(
        db,
        `select id, name, slug, city, timezone,
                st_y(center::geometry) as lat, st_x(center::geometry) as lng,
                (select count(*)::int from merchants m where m.neighborhood_id = neighborhoods.id and m.status = 'live') as merchant_count
         from neighborhoods where active order by name`,
      )
      return { neighborhoods: rows }
    })
  })

  /** Everything the Home / Speed Dial screen needs in one call. */
  app.get('/api/home', async (req) => {
    const params = NearbyQuery.parse(req.query ?? {})
    const session = await readSession(req)
    return withUser(session?.id ?? null, async (db) => {
      const speedDial = await query(
        db,
        `select m.id, m.name, m.slug, m.category, m.phone, m.status,
                m.rating_avg::float8 as rating_avg, is_open_now(m.hours, m.timezone) as open_now,
                f.speed_dial_slot,
                (select jsonb_build_object('id', d.id, 'title', d.title, 'price_cents', d.price_cents,
                                           'qty_left', d.qty_left, 'qty_total', d.qty_total, 'ends_at', d.ends_at)
                 from drops d
                 where d.merchant_id = m.id and d.starts_at <= now() and d.ends_at > now() and d.qty_left > 0
                 order by d.ends_at asc limit 1) as live_drop,
                (select i.name from items i
                 where i.merchant_id = m.id and i.in_stock
                 order by i.sort asc limit 1) as pick
         from favorites f
         join merchants m on m.id = f.merchant_id
         where f.user_id = current_user_id()
         order by f.speed_dial_slot nulls last, f.created_at asc`,
      )

      const liveDrops = await query(
        db,
        `select d.id, d.title, d.qty_total, d.qty_left, d.price_cents, d.ends_at,
                m.id as merchant_id, m.name as merchant_name, m.slug as merchant_slug, m.category as merchant_category,
                i.name as item_name, i.id as item_id,
                round(st_distance(m.location, o.g))::int as distance_m,
                walk_minutes(st_distance(m.location, o.g)) as walk_minutes
         from drops d
         join merchants m on m.id = d.merchant_id
         left join items i on i.id = d.item_id
         cross join (select st_setsrid(st_makepoint($2, $1), 4326)::geography as g) o
         where d.starts_at <= now() and d.ends_at > now() and d.qty_left > 0
           and st_dwithin(m.location, o.g, $3)
         order by distance_m asc, d.ends_at asc
         limit 12`,
        [params.lat, params.lng, params.radius_m],
      )

      const radius = 3000
      const openNow = await query(
        db,
        `select ${MERCHANT_FIELDS} from nearby_merchants($1, $2, $3, null, true, false, false) nm limit 8`,
        [params.lat, params.lng, radius],
      )
      const featured = await query(
        db,
        `select ${MERCHANT_FIELDS} from nearby_merchants($1, $2, $3, null, false, false, false) nm where nm.featured limit 6`,
        [params.lat, params.lng, radius],
      )
      const deals = await query(
        db,
        `select dl.id, dl.title, dl.type, dl.value, dl.ends_at,
                m.id as merchant_id, m.name as merchant_name, m.slug as merchant_slug, m.category
         from deals dl
         join merchants m on m.id = dl.merchant_id
         where dl.active and dl.starts_at <= now() and dl.ends_at > now() and m.status = 'live'
         order by dl.ends_at asc limit 10`,
      )
      const stats = await queryOne<{ merchants: number; drops: number; open_now: number }>(
        db,
        `select
           (select count(*)::int from merchants where status = 'live') as merchants,
           (select count(*)::int from drops where starts_at <= now() and ends_at > now() and qty_left > 0) as drops,
           (select count(*)::int from merchants where status = 'live' and is_open_now(hours, timezone)) as open_now`,
      )
      return { speedDial, liveDrops, openNow, featured, deals, stats }
    })
  })

  app.get('/api/merchants/nearby', async (req) => {
    const params = NearbyQuery.parse(req.query ?? {})
    return withUser(null, async (db) => {
      const rows = await query(
        db,
        `select ${MERCHANT_FIELDS} from nearby_merchants($1, $2, $3, $4, $5, $6, $7) nm`,
        [
          params.lat,
          params.lng,
          params.radius_m,
          params.category ?? null,
          params.open_now,
          params.deals,
          params.pickup,
        ],
      )
      return { merchants: rows, center: { lat: params.lat, lng: params.lng }, radiusM: params.radius_m }
    })
  })

  app.get('/api/merchants/:slug', async (req) => {
    const { slug } = req.params as { slug: string }
    const q = z
      .object({
        lat: z.coerce.number().min(-90).max(90).default(DEFAULT_CENTER.lat),
        lng: z.coerce.number().min(-180).max(180).default(DEFAULT_CENTER.lng),
      })
      .parse(req.query ?? {})
    const session = await readSession(req)

    return withUser(session?.id ?? null, async (db) => {
      const merchant = await queryOne(
        db,
        `select m.id, m.name, m.slug, m.category, m.description, m.logo_url, m.cover_url, m.phone,
                m.address, m.hours, m.accepts_pickup, m.accepts_delivery, m.status, m.featured,
                m.rating_avg::float8 as rating_avg,
                is_open_now(m.hours, m.timezone) as open_now,
                merchant_has_live_drop(m.id) as has_live_drop,
                merchant_has_active_deal(m.id) as has_active_deal,
                round(st_distance(m.location, o.g))::int as distance_m,
                walk_minutes(st_distance(m.location, o.g)) as walk_minutes,
                (select count(*)::int from reviews r where r.merchant_id = m.id) as review_count,
                exists (select 1 from favorites f where f.merchant_id = m.id and f.user_id = current_user_id()) as is_favorite
         from merchants m
         cross join (select st_setsrid(st_makepoint($2, $1), 4326)::geography as g) o
         where m.slug = $3`,
        [q.lat, q.lng, slug],
      )
      if (!merchant) throw notFound('That storefront is not available')

      const categories = await query(
        db,
        'select id, name, sort from menu_categories where merchant_id = $1 order by sort asc, name asc',
        [merchant.id],
      )

      const items = await query(
        db,
        `select i.id, i.name, i.description, i.price_cents, i.unit, i.image_url, i.in_stock,
                i.stock_qty, i.tags, i.dietary, i.is_commodity, i.freshness_note, i.category_id, i.sort,
                coalesce(
                  (select jsonb_agg(jsonb_build_object(
                      'id', o.id, 'name', o.name, 'group_name', o.group_name,
                      'price_delta_cents', o.price_delta_cents, 'required', o.required) order by o.sort asc)
                   from item_options o where o.item_id = i.id),
                  '[]'::jsonb) as options,
                (select jsonb_build_object('id', d.id, 'title', d.title, 'price_cents', d.price_cents,
                                           'qty_left', d.qty_left, 'qty_total', d.qty_total, 'ends_at', d.ends_at)
                 from drops d
                 where d.item_id = i.id and d.starts_at <= now() and d.ends_at > now() and d.qty_left > 0
                 order by d.ends_at asc limit 1) as live_drop
         from items i
         where i.merchant_id = $1
         order by i.sort asc, i.name asc`,
        [merchant.id],
      )

      const deals = await query(
        db,
        `select id, title, type, value, ends_at from deals
         where merchant_id = $1 and active and starts_at <= now() and ends_at > now()
         order by ends_at asc`,
        [merchant.id],
      )

      const drops = await query(
        db,
        `select d.id, d.title, d.qty_total, d.qty_left, d.price_cents, d.ends_at, d.item_id,
                i.name as item_name
         from drops d left join items i on i.id = d.item_id
         where d.merchant_id = $1 and d.starts_at <= now() and d.ends_at > now() and d.qty_left > 0
         order by d.ends_at asc`,
        [merchant.id],
      )

      const reviews = await query(
        db,
        `select id, rating, body, created_at, reviewer_name from public_reviews
         where merchant_id = $1 order by created_at desc limit 12`,
        [merchant.id],
      )

      return { merchant, categories, items, deals, drops, reviews }
    })
  })

  app.get('/api/drops/live', async (req) => {
    const params = NearbyQuery.parse(req.query ?? {})
    return withUser(null, async (db) => {
      const rows = await query(
        db,
        `select d.id, d.title, d.qty_total, d.qty_left, d.price_cents, d.ends_at,
                m.id as merchant_id, m.name as merchant_name, m.slug as merchant_slug, m.category as merchant_category,
                m.phone as merchant_phone, i.name as item_name, i.id as item_id, i.image_url,
                round(st_distance(m.location, o.g))::int as distance_m,
                walk_minutes(st_distance(m.location, o.g)) as walk_minutes
         from drops d
         join merchants m on m.id = d.merchant_id
         left join items i on i.id = d.item_id
         cross join (select st_setsrid(st_makepoint($2, $1), 4326)::geography as g) o
         where d.starts_at <= now() and d.ends_at > now() and d.qty_left > 0 and m.status = 'live'
           and st_dwithin(m.location, o.g, $3)
         order by distance_m asc, d.ends_at asc`,
        [params.lat, params.lng, params.radius_m],
      )
      return { drops: rows }
    })
  })

  app.get('/api/search', async (req) => {
    const { q } = z.object({ q: z.string().min(1).max(80) }).parse(req.query ?? {})
    const term = `%${q}%`
    return withUser(null, async (db) => {
      const merchants = await query(
        db,
        `select id, name, slug, category, rating_avg::float8 as rating_avg, status,
                is_open_now(hours, timezone) as open_now
         from merchants
         where name ilike $1 or category ilike $1 or description ilike $1
         order by featured desc, name asc limit 12`,
        [term],
      )
      const items = await query(
        db,
        `select i.id, i.name, i.price_cents, i.in_stock, m.name as merchant_name, m.slug as merchant_slug
         from items i join merchants m on m.id = i.merchant_id
         where i.name ilike $1 or i.description ilike $1
         order by i.name asc limit 12`,
        [term],
      )
      return { merchants, items }
    })
  })
}
