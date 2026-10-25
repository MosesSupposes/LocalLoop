import crypto from 'node:crypto'
import { describe, expect, it } from 'vitest'
import {
  DEFAULT_BTC_USD_RATE,
  bitcoinUri,
  formatBtc,
  invoiceExpiry,
  isStubInvoice,
  resolvedBtcUsdRate,
  stubAddress,
  usdCentsToSats,
  verifyBtcPaySignature,
} from '../src/lib/bitcoin.js'

describe('sat conversion', () => {
  it('converts a USD total to whole satoshis at the configured rate', () => {
    // $18.95 at $62,000/BTC = 0.0003056451613 BTC = 30,564.5 sats
    expect(usdCentsToSats(1895, 62_000)).toBe(30_565)
    // $1.00 at $100,000/BTC = 0.00001 BTC = 1,000 sats
    expect(usdCentsToSats(100, 100_000)).toBe(1000)
  })

  it('never rounds a payable amount down to zero sats', () => {
    expect(usdCentsToSats(1, 6_200_000)).toBe(1)
    expect(usdCentsToSats(0, 62_000)).toBe(0)
  })

  it('falls back to the default rate when none is configured', () => {
    expect(resolvedBtcUsdRate(0)).toBe(DEFAULT_BTC_USD_RATE)
    expect(resolvedBtcUsdRate(51_250)).toBe(51_250)
    expect(usdCentsToSats(1895, 0)).toBe(usdCentsToSats(1895, DEFAULT_BTC_USD_RATE))
  })

  it('renders 8-decimal BTC and a BIP21 payment URI', () => {
    expect(formatBtc(30_565)).toBe('0.00030565')
    expect(formatBtc(100_000_000)).toBe('1.00000000')
    const uri = bitcoinUri({ address: 'bc1qexample', sats: 30_565, label: 'LocalLoop LL-1025-0001' })
    expect(uri.startsWith('bitcoin:bc1qexample?')).toBe(true)
    expect(uri).toContain('amount=0.00030565')
    expect(uri).toContain('label=LocalLoop')
  })
})

describe('invoice lifecycle', () => {
  it('expires invoices after the configured window', () => {
    const from = new Date('2026-10-25T17:00:00.000Z')
    expect(invoiceExpiry(from).toISOString()).toBe('2026-10-25T17:15:00.000Z')
    expect(invoiceExpiry(from, 30).toISOString()).toBe('2026-10-25T17:30:00.000Z')
  })

  it('recognises sandbox invoices and derives a stable address', () => {
    expect(isStubInvoice('btc_stub_9f1f')).toBe(true)
    expect(isStubInvoice('8Xk2QhBTCPayInvoice')).toBe(false)
    const first = stubAddress('order-123')
    expect(first).toBe(stubAddress('order-123'))
    expect(first).not.toBe(stubAddress('order-124'))
    expect(first).toMatch(/^bc1q[qpzry9x8gf2tvdw0s3jn54khce6mua7l]{38}$/)
  })
})

describe('BTCPay webhook signature', () => {
  const secret = 'whsec_test'
  const body = JSON.stringify({ type: 'InvoiceSettled', invoiceId: 'abc' })
  const signature = `sha256=${crypto.createHmac('sha256', secret).update(body).digest('hex')}`

  it('accepts a signature computed over the raw body', () => {
    expect(verifyBtcPaySignature(body, signature, secret)).toBe(true)
  })

  it('rejects a tampered body, a tampered signature, and an unconfigured secret', () => {
    expect(verifyBtcPaySignature(body + ' ', signature, secret)).toBe(false)
    expect(verifyBtcPaySignature(body, `sha256=${'0'.repeat(64)}`, secret)).toBe(false)
    expect(verifyBtcPaySignature(body, signature, '')).toBe(false)
    expect(verifyBtcPaySignature(body, undefined, secret)).toBe(false)
    expect(verifyBtcPaySignature(body, 'v1=abc', secret)).toBe(false)
  })
})
