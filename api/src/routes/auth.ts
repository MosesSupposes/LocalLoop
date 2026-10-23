import crypto from 'node:crypto'
import type { FastifyInstance } from 'fastify'
import { z } from 'zod'
import { ownerPool, queryOne, withUser } from '../db.js'
import { env, features } from '../env.js'
import { badRequest, notFound, unauthorized } from '../lib/errors.js'
import { rateLimitOrThrow } from '../lib/rateLimit.js'
import { clearSessionCookie, createSessionToken, readSession, setSessionCookie } from '../lib/session.js'

const OtpRequest = z.object({ email: z.string().email().max(160) })
const OtpVerify = z.object({ email: z.string().email().max(160), code: z.string().min(4).max(8) })
const ProfilePatch = z.object({
  displayName: z.string().min(1).max(80).optional(),
  locale: z.enum(['en', 'es']).optional(),
  phone: z.string().max(24).optional(),
  homeAddress: z.string().max(200).optional(),
  lat: z.number().min(-90).max(90).optional(),
  lng: z.number().min(-180).max(180).optional(),
})

const hashOtp = (email: string, code: string) =>
  crypto.createHash('sha256').update(`${email}:${code}:${env.sessionSecret}`).digest('hex')

const displayNameFromEmail = (email: string) =>
  email
    .split('@')[0]
    .split(/[._-]/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ') || 'Neighbor'

export async function authRoutes(app: FastifyInstance): Promise<void> {
  /**
   * Email OTP sign-in. Accounts are created on first request, which is how a merchant,
   * admin or neighbor gets in without a password. When SMS is configured the code goes to
   * the phone on file; in the sandbox it is returned as `devCode` so the flow is testable.
   */
  app.post('/api/auth/otp', async (req) => {
    const { email } = OtpRequest.parse(req.body ?? {})
    rateLimitOrThrow(`otp:${email.toLowerCase()}`, 5, 10 * 60 * 1000)

    const normalized = email.toLowerCase()
    const existing = await queryOne<{ id: string; display_name: string; phone: string | null }>(
      ownerPool,
      'select id, display_name, phone from profiles where email = $1',
      [normalized],
    )

    let userId = existing?.id
    if (!userId) {
      const created = await queryOne<{ id: string }>(
        ownerPool,
        `insert into profiles (display_name, email) values ($1, $2) returning id`,
        [displayNameFromEmail(normalized), normalized],
      )
      userId = created!.id
      await ownerPool.query(
        `insert into user_roles (user_id, role) values ($1, 'neighbor') on conflict do nothing`,
        [userId],
      )
    }

    const code = String(crypto.randomInt(100000, 999999))
    await ownerPool.query(
      `insert into otp_codes (email, code_hash, expires_at) values ($1, $2, now() + interval '10 minutes')`,
      [normalized, hashOtp(normalized, code)],
    )

    const smsable = features.sms && Boolean(existing?.phone)
    if (smsable) {
      const { sendSms } = await import('../services/notify.js')
      await sendSms({
        to: existing!.phone!,
        body: `LocalLoop code: ${code}. Expires in 10 minutes.`,
        template: 'otp_login',
      })
    }

    return {
      sent: true,
      channel: smsable ? 'sms' : 'email',
      // No SMS provider configured: surface the code so the sandbox can sign in.
      devCode: smsable ? undefined : code,
    }
  })

  app.post('/api/auth/otp/verify', async (req, reply) => {
    const { email, code } = OtpVerify.parse(req.body ?? {})
    const normalized = email.toLowerCase()
    rateLimitOrThrow(`otp-verify:${normalized}`, 10, 10 * 60 * 1000)

    const record = await queryOne<{ id: string; code_hash: string; attempts: number }>(
      ownerPool,
      `select id, code_hash, attempts from otp_codes
       where email = $1 and consumed_at is null and expires_at > now()
       order by created_at desc limit 1`,
      [normalized],
    )
    if (!record) throw badRequest('That code expired. Request a new one.')
    if (record.attempts >= 5) throw badRequest('Too many wrong codes. Request a new one.')

    if (record.code_hash !== hashOtp(normalized, code)) {
      await ownerPool.query('update otp_codes set attempts = attempts + 1 where id = $1', [record.id])
      throw badRequest('That code does not match.')
    }
    await ownerPool.query('update otp_codes set consumed_at = now() where id = $1', [record.id])

    const user = await queryOne<{ id: string; display_name: string; email: string; locale: string }>(
      ownerPool,
      'select id, display_name, email, locale from profiles where email = $1',
      [normalized],
    )
    if (!user) throw notFound('Account not found')

    setSessionCookie(reply, await createSessionToken({ id: user.id, email: user.email }))
    const roles = await ownerPool.query<{ role: string }>(
      'select role from user_roles where user_id = $1',
      [user.id],
    )
    return { user: { id: user.id, displayName: user.display_name, email: user.email, locale: user.locale }, roles: roles.rows.map((r) => r.role) }
  })

  app.post('/api/auth/logout', async (_req, reply) => {
    clearSessionCookie(reply)
    return { ok: true }
  })

  app.get('/api/me', async (req) => {
    const session = await readSession(req)
    if (!session) return { user: null }
    return withUser(session.id, async (db) => {
      const profile = await queryOne(
        db,
        `select id, display_name, email, phone, locale, home_address,
                st_y(home_location::geometry) as lat, st_x(home_location::geometry) as lng,
                neighborhood_id
         from profiles where id = $1`,
        [session.id],
      )
      if (!profile) return { user: null }
      const roles = await db.query<{ role: string }>('select role from user_roles where user_id = $1', [
        session.id,
      ])
      const points = await queryOne<{ balance: string | null }>(
        db,
        'select sum(points)::text as balance from loop_points where user_id = $1',
        [session.id],
      )
      const favorites = await db.query(
        `select f.merchant_id, f.speed_dial_slot, m.name, m.slug, m.category
         from favorites f join merchants m on m.id = f.merchant_id
         where f.user_id = $1 order by f.speed_dial_slot nulls last`,
        [session.id],
      )
      const unread = await queryOne<{ count: string }>(
        db,
        'select count(*)::text as count from notifications where user_id = $1 and read_at is null',
        [session.id],
      )
      return {
        user: {
          ...profile,
          roles: roles.rows.map((r) => r.role),
          loopPoints: Number(points?.balance ?? 0),
          favorites: favorites.rows,
          unreadNotifications: Number(unread?.count ?? 0),
        },
      }
    })
  })

  app.patch('/api/me', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const body = ProfilePatch.parse(req.body ?? {})
    return withUser(session.id, async (db) => {
      const updated = await queryOne(
        db,
        `update profiles set
           display_name = coalesce($2, display_name),
           locale = coalesce($3, locale),
           phone = coalesce($4, phone),
           home_address = coalesce($5, home_address),
           home_location = case when $6::float8 is null then home_location
                                else st_setsrid(st_makepoint($6::float8, $7::float8), 4326)::geography end
         where id = $1
         returning id, display_name, email, locale, home_address`,
        [
          session.id,
          body.displayName ?? null,
          body.locale ?? null,
          body.phone ?? null,
          body.homeAddress ?? null,
          body.lng ?? null,
          body.lat ?? null,
        ],
      )
      return { user: updated }
    })
  })

  app.get('/api/me/notifications', async (req) => {
    const session = await readSession(req)
    if (!session) return { notifications: [] }
    return withUser(session.id, async (db) => {
      const rows = await db.query(
        `select id, type, title, payload, read_at, created_at from notifications
         where user_id = $1 order by created_at desc limit 30`,
        [session.id],
      )
      return { notifications: rows.rows }
    })
  })

  app.post('/api/me/notifications/:id/read', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    const { id } = req.params as { id: string }
    return withUser(session.id, async (db) => {
      await db.query('update notifications set read_at = now() where id = $1 and user_id = $2', [
        id,
        session.id,
      ])
      return { ok: true }
    })
  })

  app.get('/api/me/loop-points', async (req) => {
    const session = await readSession(req)
    if (!session) throw unauthorized()
    return withUser(session.id, async (db) => {
      const balance = await queryOne<{ balance: string | null }>(
        db,
        'select sum(points)::text as balance from loop_points where user_id = $1',
        [session.id],
      )
      const history = await db.query(
        `select lp.id, lp.points, lp.reason, lp.created_at, m.name as merchant_name
         from loop_points lp left join merchants m on m.id = lp.merchant_id
         where lp.user_id = $1 order by lp.created_at desc limit 25`,
        [session.id],
      )
      return { balance: Number(balance?.balance ?? 0), history: history.rows }
    })
  })
}
