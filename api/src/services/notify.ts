import { ownerPool, pool } from '../db.js'
import { env, features } from '../env.js'
import { loopPointsFor } from '../lib/fees.js'

export type SendSmsInput = {
  to: string
  body: string
  template: string
  orderId?: string
}

/**
 * Order alerts. With Twilio credentials the message really goes out (E.164 numbers);
 * without them the message is written to notification_log so the flow is observable
 * in the dashboard and in the sandbox logs.
 */
export async function sendSms(input: SendSmsInput): Promise<{ provider: 'twilio' | 'logged' }> {
  let provider: 'twilio' | 'logged' = 'logged'
  let providerMessageId: string | null = null

  if (features.sms) {
    try {
      const body = new URLSearchParams({ To: input.to, From: env.twilioFromNumber, Body: input.body })
      const res = await fetch(
        `https://api.twilio.com/2010-04-01/Accounts/${env.twilioAccountSid}/Messages.json`,
        {
          method: 'POST',
          headers: {
            Authorization:
              'Basic ' +
              Buffer.from(`${env.twilioAccountSid}:${env.twilioAuthToken}`).toString('base64'),
            'Content-Type': 'application/x-www-form-urlencoded',
          },
          body,
        },
      )
      const payload = (await res.json()) as { sid?: string }
      if (res.ok) {
        provider = 'twilio'
        providerMessageId = payload.sid ?? null
      }
    } catch {
      // never let a messaging failure break an order
    }
  }

  await pool.query(
    `insert into notification_log (channel, recipient, template, body, provider, provider_message_id)
     values ('sms', $1, $2, $3, $4, $5)`,
    [input.to, input.template, input.body, provider, providerMessageId],
  )
  console.log(`[sms:${provider}] ${input.template} -> ${input.to}: ${input.body}`)
  return { provider }
}

/**
 * In-app notification. Written with the owner pool on purpose: the recipient is often
 * a different user than the caller (merchant gets alerted about a neighbor's order),
 * and RLS would otherwise reject the insert.
 */
export async function insertNotification(input: {
  userId: string
  type: string
  title: string
  payload?: Record<string, unknown>
}): Promise<void> {
  await ownerPool.query(
    `insert into notifications (user_id, type, title, payload) values ($1, $2, $3, $4)`,
    [input.userId, input.type, input.title, JSON.stringify(input.payload ?? {})],
  )
}

/**
 * The alert a newly payable order produces: the merchant gets an SMS (or a logged message)
 * plus an in-app nudge, the neighbor gets a receipt. Owner pool on purpose — the merchant's
 * dashboard must react to an order placed by someone else's account.
 */
export async function announceNewOrder(input: {
  orderId: string
  code: string
  merchantId: string
  neighborId: string
}): Promise<void> {
  const res = await ownerPool.query<{ name: string; owner_id: string; phone: string | null }>(
    `select m.name, m.owner_id, p.phone
     from merchants m left join profiles p on p.id = m.owner_id
     where m.id = $1`,
    [input.merchantId],
  )
  const merchant = res.rows[0]
  if (!merchant) return

  const alert = `New LocalLoop pickup order ${input.code} for ${merchant.name}. Open the dashboard to accept.`
  if (merchant.phone) {
    await sendSms({ to: merchant.phone, body: alert, template: 'merchant_new_order', orderId: input.orderId })
  }
  await insertNotification({
    userId: merchant.owner_id,
    type: 'new_order',
    title: `New order ${input.code}`,
    payload: { orderId: input.orderId },
  })
  await insertNotification({
    userId: input.neighborId,
    type: 'order_status',
    title: `Order ${input.code} placed at ${merchant.name}`,
    payload: { orderId: input.orderId },
  })
}

/** Loyalty accrual is a service-side write triggered by a merchant action. */
export async function awardLoopPoints(input: {
  userId: string
  merchantId: string
  orderId: string
  subtotalCents: number
}): Promise<number> {
  const points = loopPointsFor(input.subtotalCents)
  if (points <= 0) return 0
  await ownerPool.query(
    `insert into loop_points (user_id, merchant_id, points, reason, order_id)
     values ($1, $2, $3, 'pickup', $4)`,
    [input.userId, input.merchantId, points, input.orderId],
  )
  return points
}

export async function writeAudit(input: {
  actorId: string | null
  action: string
  entity: string
  entityId?: string | null
  detail?: Record<string, unknown>
}): Promise<void> {
  await pool.query(
    `insert into audit_log (actor_id, action, entity, entity_id, detail) values ($1, $2, $3, $4, $5)`,
    [input.actorId, input.action, input.entity, input.entityId ?? null, JSON.stringify(input.detail ?? {})],
  )
}
