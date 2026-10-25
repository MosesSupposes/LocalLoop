import { ownerPool } from '../db.js'
import { env, features } from '../env.js'
import { HttpError } from '../lib/errors.js'
import {
  bitcoinUri,
  formatBtc,
  invoiceExpiry,
  isStubInvoice,
  resolvedBtcUsdRate,
  stubAddress,
  usdCentsToSats,
} from '../lib/bitcoin.js'

/** What the pay panel shows for an order. */
export type BitcoinInvoice = {
  provider: 'btcpay' | 'simulated'
  invoiceId: string
  address: string | null
  amountSats: number
  amountBtc: string
  rateCents: number
  expiresAt: string
  uri: string | null
  checkoutUrl: string | null
  paid: boolean
  expired: boolean
  simulated: boolean
}

/** The order columns a bitcoin invoice is stored in (db/migrations/003_bitcoin_payments.sql). */
export type BitcoinOrderRow = {
  payment_provider?: string | null
  payment_reference?: string | null
  payment_address?: string | null
  payment_amount_sats?: number | string | null
  payment_rate_cents?: number | null
  payment_expires_at?: string | Date | null
  payment_status?: string | null
}

/** USD cents per whole BTC, locked onto the order when the invoice is created. */
export function invoiceRateCents(): number {
  return Math.round(resolvedBtcUsdRate(env.bitcoinUsdRate) * 100)
}

function btcpayBaseUrl(): string {
  return env.btcpayUrl.replace(/\/+$/, '')
}

export function btcpayCheckoutUrl(invoiceId: string): string {
  return `${btcpayBaseUrl()}/i/${invoiceId}`
}

/** Reads the invoice back off an order row. Null for every non-bitcoin order. */
export function bitcoinInvoiceFromOrder(row: BitcoinOrderRow, now = Date.now()): BitcoinInvoice | null {
  if (row.payment_provider !== 'bitcoin' || !row.payment_reference) return null
  const simulated = isStubInvoice(row.payment_reference)
  const amountSats = Number(row.payment_amount_sats ?? 0)
  const expiresAt = row.payment_expires_at ? new Date(row.payment_expires_at) : null
  const paid = row.payment_status === 'paid'
  const address = row.payment_address ?? null
  return {
    provider: simulated ? 'simulated' : 'btcpay',
    invoiceId: row.payment_reference,
    address,
    amountSats,
    amountBtc: formatBtc(amountSats),
    rateCents: row.payment_rate_cents ?? invoiceRateCents(),
    expiresAt: (expiresAt ?? new Date(now)).toISOString(),
    uri: address ? bitcoinUri({ address, sats: amountSats }) : null,
    checkoutUrl: simulated ? null : btcpayCheckoutUrl(row.payment_reference),
    paid,
    expired: !paid && Boolean(expiresAt && expiresAt.getTime() <= now),
    simulated,
  }
}

export type NewInvoice = {
  provider: 'btcpay' | 'simulated'
  invoiceId: string
  address: string | null
  amountSats: number
  rateCents: number
  expiresAt: Date
  checkoutUrl: string | null
}

/**
 * Opens an invoice for an order. With BTCPay credentials a real invoice is created (the
 * neighbor pays through BTCPay's checkout page); without them the sandbox issues a local
 * invoice that only this environment can settle, so the flow works end to end offline.
 */
export async function createBitcoinInvoice(input: {
  orderId: string
  code: string
  amountCents: number
}): Promise<NewInvoice> {
  const rateCents = invoiceRateCents()
  const amountSats = usdCentsToSats(input.amountCents, env.bitcoinUsdRate)

  if (!features.bitcoin) {
    return {
      provider: 'simulated',
      invoiceId: `btc_stub_${input.orderId}`,
      address: stubAddress(`${input.orderId}:${input.code}`),
      amountSats,
      rateCents,
      expiresAt: invoiceExpiry(),
      checkoutUrl: null,
    }
  }

  const res = await fetch(`${btcpayBaseUrl()}/api/v1/stores/${env.btcpayStoreId}/invoices`, {
    method: 'POST',
    headers: {
      Authorization: `token ${env.btcpayApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      amount: (input.amountCents / 100).toFixed(2),
      currency: 'USD',
      metadata: { orderId: input.orderId, code: input.code },
      checkout: {
        redirectURL: `${env.publicWebOrigin}/orders/${input.orderId}`,
        redirectAutomatically: true,
      },
    }),
  })
  const payload = (await res.json().catch(() => ({}))) as {
    id?: string
    checkoutLink?: string
    expirationTime?: number
    error?: string
    message?: string
  }
  if (!res.ok || !payload.id) {
    throw new HttpError(502, payload.error ?? payload.message ?? 'The bitcoin payment provider rejected the invoice')
  }
  return {
    provider: 'btcpay',
    invoiceId: payload.id,
    address: null,
    amountSats,
    rateCents,
    expiresAt: payload.expirationTime ? new Date(payload.expirationTime * 1000) : invoiceExpiry(),
    checkoutUrl: payload.checkoutLink ?? btcpayCheckoutUrl(payload.id),
  }
}

/** Asks the provider whether the invoice is settled. Sandbox invoices never settle remotely. */
export async function bitcoinInvoiceSettled(invoiceId: string): Promise<boolean> {
  if (isStubInvoice(invoiceId)) return false
  const res = await fetch(`${btcpayBaseUrl()}/api/v1/stores/${env.btcpayStoreId}/invoices/${invoiceId}`, {
    headers: { Authorization: `token ${env.btcpayApiKey}` },
  })
  if (!res.ok) throw new HttpError(502, 'Could not reach the bitcoin payment provider')
  const payload = (await res.json().catch(() => ({}))) as { status?: string }
  return payload.status === 'Settled'
}

export type SettledOrder = { id: string; code: string; user_id: string; merchant_id: string }

/**
 * Marks the order behind an invoice paid, once and only once. Uses the owner pool because
 * the settlement arrives from a webhook with no session; the `payment_status = 'unpaid'`
 * guard makes a replayed webhook a no-op.
 */
export async function markBitcoinInvoicePaid(invoiceId: string): Promise<SettledOrder | null> {
  const res = await ownerPool.query<SettledOrder>(
    `update orders set payment_status = 'paid', payment_confirmed_at = now()
     where payment_reference = $1 and payment_provider = 'bitcoin' and payment_status = 'unpaid'
     returning id, code, user_id, merchant_id`,
    [invoiceId],
  )
  return res.rows[0] ?? null
}
