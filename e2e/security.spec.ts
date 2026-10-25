import { expect, test } from '@playwright/test'
import { OWNER, passAgeGate, placeOrderApi, restock, staffApi } from './helpers'

test.beforeAll(restock)

const orderBody = (over: Record<string, unknown> = {}) => ({
  items: [{ productId: 'c1', qty: 2 }], name: 'Sec Test', phone: '3025550123', address: '1 Test Street', zip: '19801', payment: 'cash', tipCents: 0, ...over,
})

test.describe('access control', () => {
  test('staff endpoints require sign-in', async ({ request }) => {
    expect((await request.get('/api/staff/state')).status()).toBe(401)
    expect((await request.post('/api/dispatch/auto', { data: {} })).status()).toBe(401)
    expect((await request.patch('/api/products/c1', { data: { stock: 1 } })).status()).toBe(401)
    expect((await request.post('/api/tickets/T101/reply', { data: { text: 'hi' } })).status()).toBe(401)
  })

  test('admin screens redirect anonymous visitors to sign-in', async ({ page }) => {
    await page.goto('/admin')
    await passAgeGate(page)
    await expect(page).toHaveURL(/\/staff/)
    await page.goto('/driver')
    await expect(page).toHaveURL(/\/staff/)
  })

  test('wrong OTP is rejected and a code works only once', async ({ request }) => {
    expect((await request.post('/api/auth/verify', { data: { phone: OWNER, code: '000000' } })).status()).toBe(401)
    await staffApi(OWNER)
    expect((await request.post('/api/auth/verify', { data: { phone: OWNER, code: '123456' } })).status()).toBe(401)
  })

  test('OTP request does not reveal whether a number is staff', async ({ request }) => {
    const known = await request.post('/api/auth/request', { data: { phone: OWNER } })
    const unknown = await request.post('/api/auth/request', { data: { phone: '+13025559999' } })
    expect(known.status()).toBe(200)
    expect(unknown.status()).toBe(200)
    expect(await unknown.json()).toEqual(await known.json())
  })

  test('signing out ends the session', async () => {
    const admin = await staffApi(OWNER)
    expect((await admin.get('/api/me').then((r) => r.json())).me).not.toBeNull()
    await admin.post('/api/auth/logout', { data: {} })
    expect((await admin.get('/api/staff/state')).status()).toBe(401)
  })

  test('staff session cookie is HttpOnly and SameSite', async ({ playwright }) => {
    const ctx = await playwright.request.newContext({ baseURL: 'http://localhost:5199' })
    await ctx.post('/api/auth/request', { data: { phone: OWNER } })
    const { readFileSync } = await import('node:fs')
    const code = [...readFileSync('e2e/.tmp/api.log', 'utf8').matchAll(/staff code: (\d{6})/g)].pop()![1]
    const res = await ctx.post('/api/auth/verify', { data: { phone: OWNER, code } })
    const cookie = res.headersArray().find((h) => h.name.toLowerCase() === 'set-cookie')!.value
    expect(cookie).toMatch(/HttpOnly/)
    expect(cookie).toMatch(/SameSite=Lax/)
  })
})

test.describe('customer data', () => {
  test('order lookup needs the right token and hides the registry card', async ({ request }) => {
    const { id, token } = await placeOrderApi(request, { items: [{ productId: 'h1', qty: 1 }, { productId: 'c1', qty: 1 }], medCard: 'DE-SECRET-1' })
    expect((await request.get(`/api/orders/${id}?token=${'0'.repeat(48)}`)).status()).toBe(404)
    expect((await request.get(`/api/orders/${id}`)).status()).toBe(404)
    const ok = await request.get(`/api/orders/${id}?token=${token}`)
    expect(ok.ok()).toBeTruthy()
    const text = JSON.stringify(await ok.json())
    expect(text).not.toContain('medCard')
    expect(text).not.toContain('DE-SECRET-1')
  })

  test('bulk lookup ignores orders with bad tokens', async ({ request }) => {
    const a = await placeOrderApi(request)
    const b = await placeOrderApi(request)
    const r = await request.post('/api/lookup', { data: { orders: [{ id: a.id, token: a.token }, { id: b.id, token: 'wrong-token-value' }], tickets: [] } })
    const ids = ((await r.json()) as { orders: { id: string }[] }).orders.map((o) => o.id)
    expect(ids).toEqual([a.id])
  })

  test('driver details only appear once the order is out for delivery', async ({ request }) => {
    const { id, token } = await placeOrderApi(request)
    const view = (await (await request.get(`/api/orders/${id}?token=${token}`)).json()) as { order: { driver?: unknown } }
    expect(view.order.driver).toBeUndefined()
  })
})

test.describe('order validation', () => {
  test('server re-prices orders and ignores client-supplied totals', async ({ request }) => {
    const r = await request.post('/api/orders', { data: orderBody({ totalCents: 1, subtotalCents: 1, priceCents: 1 }) })
    expect(r.status()).toBe(201)
    expect(((await r.json()) as { order: { totalCents: number } }).order.totalCents).toBe(2598 + 399 + 99)
  })

  test('enforces the $20 minimum', async ({ request }) => {
    const r = await request.post('/api/orders', { data: orderBody({ items: [{ productId: 's1', qty: 1 }] }) })
    expect(r.status()).toBe(409)
  })

  test('rejects herbs without a registry card', async ({ request }) => {
    const r = await request.post('/api/orders', { data: orderBody({ items: [{ productId: 'h1', qty: 1 }] }) })
    expect(r.status()).toBe(409)
    expect(await r.text()).toMatch(/registry card/)
  })

  test('rejects out-of-zone, bad phone, empty cart, bad quantity and unknown product', async ({ request }) => {
    const bad = [
      orderBody({ zip: '19901' }),
      orderBody({ zip: 'abcde' }),
      orderBody({ phone: '123' }),
      orderBody({ items: [] }),
      orderBody({ items: [{ productId: 'c1', qty: 0 }] }),
      orderBody({ items: [{ productId: 'c1', qty: 999 }] }),
      orderBody({ tipCents: -1 }),
      orderBody({ payment: 'paypal' }),
      orderBody({ name: '' }),
    ]
    for (const b of bad) expect((await request.post('/api/orders', { data: b })).status(), JSON.stringify(b)).toBe(400)
    expect((await request.post('/api/orders', { data: orderBody({ items: [{ productId: 'nope', qty: 1 }] }) })).status()).toBe(409)
  })

  test('duplicate lines for the same product are merged, not double-counted past stock', async ({ request }) => {
    const admin = await staffApi(OWNER)
    await admin.patch('/api/products/g3', { data: { stock: 3 } })
    const r = await request.post('/api/orders', { data: orderBody({ items: [{ productId: 'g3', qty: 2 }, { productId: 'g3', qty: 2 }] }) })
    expect(r.status()).toBe(409)
    await admin.patch('/api/products/g3', { data: { stock: 18 } })
  })

  test('does not echo script content back as markup-breaking data', async ({ request }) => {
    const r = await request.post('/api/orders', { data: orderBody({ name: '<script>alert(1)</script>' }) })
    expect(r.status()).toBe(201)
    expect(r.headers()['content-type']).toContain('application/json')
    expect(r.headers()['x-content-type-options']).toBe('nosniff')
  })
})

test.describe('webhooks', () => {
  test('unsigned Stripe and BTCPay webhooks are rejected', async ({ request }) => {
    expect((await request.post('/api/public/stripe-webhook', { data: '{"id":"evt_1"}', headers: { 'stripe-signature': 'bad' } })).status()).toBe(400)
    expect((await request.post('/api/public/btcpay-webhook', { data: '{"deliveryId":"d1"}', headers: { 'btcpay-sig': 'sha256=bad' } })).status()).toBe(400)
    expect((await request.post('/api/public/stripe-webhook', { data: '{}' })).status()).toBe(400)
  })

  test('a forged webhook cannot mark an order paid', async ({ request }) => {
    const { id, token } = await placeOrderApi(request, { payment: 'card' })
    await request.post('/api/public/stripe-webhook', { data: JSON.stringify({ id: 'evt_fake', type: 'checkout.session.completed', data: { object: { payment_status: 'paid', metadata: { orderId: id } } } }), headers: { 'stripe-signature': 't=1,v1=00' } })
    const view = (await (await request.get(`/api/orders/${id}?token=${token}`)).json()) as { order: { paymentStatus: string } }
    expect(view.order.paymentStatus).toBe('unpaid')
  })
})

test.describe('misc API hygiene', () => {
  test('unknown API routes return JSON 404', async ({ request }) => {
    const r = await request.get('/api/does-not-exist')
    expect(r.status()).toBe(404)
    expect(r.headers()['content-type']).toContain('application/json')
  })

  test('oversized request bodies are rejected', async ({ request }) => {
    const r = await request.post('/api/orders', { data: orderBody({ notes: 'x'.repeat(60_000) }) })
    expect([400, 413, 500]).toContain(r.status())
    expect(r.status()).not.toBe(201)
  })
})
