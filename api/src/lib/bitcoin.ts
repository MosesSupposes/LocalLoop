// Bitcoin money rules, kept pure so the arithmetic and the signature check are unit
// tested (api/tests/bitcoin.test.ts). Provider wiring lives in services/bitcoin.ts.
import crypto from 'node:crypto'

/** Used when BITCOIN_USD_RATE is unset: a fixed rate keeps sandbox invoices reproducible. */
export const DEFAULT_BTC_USD_RATE = 62_000
/** Sandbox invoices are short-lived, like a real payment processor's. */
export const INVOICE_TTL_MINUTES = 15
/** Prefix marking an invoice the sandbox settles locally instead of BTCPay. */
export const STUB_INVOICE_PREFIX = 'btc_stub_'
const SATS_PER_BTC = 100_000_000

export function resolvedBtcUsdRate(configuredRate: number): number {
  return configuredRate > 0 ? configuredRate : DEFAULT_BTC_USD_RATE
}

/** Whole satoshis for a USD amount. A payable amount never rounds down to nothing. */
export function usdCentsToSats(amountCents: number, rateUsd: number): number {
  if (amountCents <= 0) return 0
  const btc = amountCents / 100 / resolvedBtcUsdRate(rateUsd)
  return Math.max(1, Math.round(btc * SATS_PER_BTC))
}

/** Fixed 8-decimal BTC string, the way a wallet displays it. */
export function formatBtc(sats: number): string {
  return (Math.max(0, sats) / SATS_PER_BTC).toFixed(8)
}

export function isStubInvoice(invoiceId: string): boolean {
  return invoiceId.startsWith(STUB_INVOICE_PREFIX)
}

export function invoiceExpiry(from: Date = new Date(), minutes: number = INVOICE_TTL_MINUTES): Date {
  return new Date(from.getTime() + minutes * 60_000)
}

/**
 * A deterministic, well-formed-looking bech32 address for a sandbox invoice. It is not a
 * real wallet and holds no funds; the same order always renders the same address so a
 * reload does not look like the payment details changed.
 */
export function stubAddress(seed: string): string {
  const charset = 'qpzry9x8gf2tvdw0s3jn54khce6mua7l'
  const digest = crypto.createHash('sha256').update(seed).digest()
  let body = ''
  for (let i = 0; i < 38; i += 1) body += charset[digest[i % digest.length]! % 32]
  return `bc1q${body}`
}

/** The BIP21 URI a wallet app understands. */
export function bitcoinUri(input: { address: string; sats: number; label?: string; message?: string }): string {
  const params = new URLSearchParams({ amount: formatBtc(input.sats) })
  if (input.label) params.set('label', input.label)
  if (input.message) params.set('message', input.message)
  return `bitcoin:${input.address}?${params.toString()}`
}

/** BTCPay Server signs the raw request body: `BTCPAY-SIG: sha256=<hex hmac>`. */
export function verifyBtcPaySignature(rawBody: string, header: string | undefined, secret: string): boolean {
  if (!secret || !header) return false
  const [scheme, signature] = header.split('=')
  if (scheme !== 'sha256' || !signature) return false
  const expected = crypto.createHmac('sha256', secret).update(rawBody).digest('hex')
  if (expected.length !== signature.length) return false
  return crypto.timingSafeEqual(Buffer.from(expected), Buffer.from(signature))
}
