// Scheduled jobs. Runs as a separate small service: it uses the owner pool on purpose,
// because these jobs legitimately act across tenants.
import { ownerPool } from './db.js'
import { notifyDropFollowers } from './routes/merchant.js'
import { insertNotification, sendSms } from './services/notify.js'

const TICK_MS = 60_000
let lastNightly: string | null = null

/** New drops push to the neighbors who have that storefront on their speed dial. */
async function pushNewDrops(): Promise<void> {
  const drops = await ownerPool.query<{ id: string }>(
    `select d.id from drops d
     where d.starts_at >= now() - interval '10 minutes'
       and not exists (
         select 1 from notifications n
         where n.payload->>'dropId' = d.id::text
       )`,
  )
  for (const drop of drops.rows) {
    const sent = await notifyDropFollowers(drop.id)
    if (sent > 0) console.log(`[worker] pushed drop ${drop.id} to ${sent} speed dial(s)`)
  }
}

/** Nudge merchants who have not acknowledged an order. */
async function nudgeStaleOrders(): Promise<void> {
  const stale = await ownerPool.query<{ id: string; code: string; owner_id: string }>(
    `select o.id, o.code, m.owner_id
     from orders o join merchants m on m.id = o.merchant_id
     where o.status = 'placed' and o.created_at < now() - interval '10 minutes'
       and not exists (
         select 1 from notifications n
         where n.payload->>'orderId' = o.id::text and n.type = 'order_nudge'
       )`,
  )
  for (const order of stale.rows) {
    await insertNotification({
      userId: order.owner_id,
      type: 'order_nudge',
      title: `Order ${order.code} is still waiting for a tap`,
      payload: { orderId: order.id },
    })
  }
}

/** Nightly payout reconciliation + merchant digest. */
async function nightlyReconciliation(): Promise<void> {
  const today = new Date().toISOString().slice(0, 10)
  if (lastNightly === today) return
  lastNightly = today

  const merchants = await ownerPool.query<{ id: string; name: string; owner_id: string; phone: string | null; payout: number; orders: number }>(
    `select m.id, m.name, m.owner_id, p.phone,
            coalesce(sum(o.subtotal_cents - o.platform_fee_cents), 0)::int as payout,
            count(o.id)::int as orders
     from merchants m
     join profiles p on p.id = m.owner_id
     left join orders o on o.merchant_id = m.id
       and o.payment_status = 'paid' and o.status <> 'cancelled'
       and o.created_at >= current_date - interval '1 day'
     where m.status = 'live'
     group by m.id, m.name, m.owner_id, p.phone`,
  )

  for (const merchant of merchants.rows) {
    const cents = merchant.payout
    await ownerPool.query(
      `insert into audit_log (actor_id, action, entity, entity_id, detail)
       values (null, 'payout.reconcile', 'merchants', $1, $2::jsonb)`,
      [merchant.id, JSON.stringify({ payoutCents: cents, orders: merchant.orders, day: today })],
    )
    if (merchant.orders > 0) {
      const summary = `${merchant.name}: ${merchant.orders} pickup order(s) yesterday, $${(cents / 100).toFixed(2)} net after the platform fee.`
      if (merchant.phone) {
        await sendSms({ to: merchant.phone, body: summary, template: 'merchant_digest' })
      } else {
        await sendSms({ to: 'digest@localloop.dev', body: summary, template: 'merchant_digest_email' })
      }
      await insertNotification({
        userId: merchant.owner_id,
        type: 'digest',
        title: summary,
        payload: { merchantId: merchant.id },
      })
    }
  }
  console.log(`[worker] nightly reconciliation ran for ${merchants.rowCount} storefront(s)`)
}

async function tick(): Promise<void> {
  try {
    await pushNewDrops()
    await nudgeStaleOrders()
    await nightlyReconciliation()
  } catch (error) {
    console.error('[worker] tick failed', error)
  }
}

console.log('[worker] LocalLoop jobs started')
await tick()
setInterval(tick, TICK_MS)
