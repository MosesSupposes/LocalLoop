import { expect, test } from '@playwright/test'
import { OWNER, DRIVER, newPage, placeOrderApi, restock, seedCustomer, staffApi, staffLoginUi } from './helpers'

test.beforeAll(restock)

test.describe('refunds', () => {
  test('admin issues a partial then full refund with manual confirmation', async ({ browser, request }) => {
    const admin = await staffApi(OWNER)
    const { id, token } = await placeOrderApi(request, { payment: 'card' })

    const unpaid = await admin.post(`/api/orders/${id}/refund`, { data: { amountCents: 100, reason: 'too early' } })
    expect(unpaid.status()).toBe(409)

    const page = await newPage(browser)
    await staffLoginUi(page, OWNER)
    const row = page.locator('li', { hasText: id }).first()
    await row.getByRole('button', { name: 'Mark paid' }).click()
    await expect(row.getByText('Paid', { exact: true })).toBeVisible()

    await row.getByRole('button', { name: /Refund \(up to/ }).click()
    await row.getByLabel('Refund amount').fill('5.00')
    await row.getByLabel('Refund reason').fill('Missing item')
    await row.getByRole('button', { name: 'Issue refund' }).click()
    await expect(row.getByText(/Part refunded \$5\.00/)).toBeVisible()
    await expect(row.getByTestId('refund-row')).toContainText('pending manual')

    await row.getByRole('button', { name: 'Mark sent' }).click()
    await expect(row.getByTestId('refund-row')).toContainText('completed')

    const customer = await newPage(browser)
    await seedCustomer(customer, { orders: { [id]: token } })
    await customer.goto(`/order/${id}`)
    await expect(customer.getByText('Partly refunded')).toBeVisible()
    await expect(customer.getByText('\u2212$5.00')).toBeVisible()

    const over = await admin.post(`/api/orders/${id}/refund`, { data: { amountCents: 999_999, reason: 'too much' } })
    expect(over.status()).toBe(409)
    const rest = await admin.post(`/api/orders/${id}/refund`, { data: { reason: 'rest of it' } })
    expect(rest.ok()).toBeTruthy()
    await expect(row.getByText('Refunded', { exact: true })).toBeVisible()
    expect((await admin.post(`/api/orders/${id}/refund`, { data: { reason: 'double click' } })).status()).toBe(409)
  })

  test('refund totals can never exceed what was paid', async ({ request }) => {
    const admin = await staffApi(OWNER)
    const { id } = await placeOrderApi(request, { payment: 'cash' })
    await admin.post(`/api/orders/${id}/paid`, { data: {} })
    const total = ((await (await admin.get('/api/staff/state')).json()) as { orders: { id: string; totalCents: number }[] }).orders.find((o) => o.id === id)!.totalCents
    expect((await admin.post(`/api/orders/${id}/refund`, { data: { amountCents: total - 100, reason: 'part one' } })).ok()).toBeTruthy()
    expect((await admin.post(`/api/orders/${id}/refund`, { data: { amountCents: 101, reason: 'part two' } })).status()).toBe(409)
    expect((await admin.post(`/api/orders/${id}/refund`, { data: { amountCents: 100, reason: 'part three' } })).ok()).toBeTruthy()
  })

  test('refund needs a reason and a positive amount', async ({ request }) => {
    const admin = await staffApi(OWNER)
    const { id } = await placeOrderApi(request)
    await admin.post(`/api/orders/${id}/paid`, { data: {} })
    expect((await admin.post(`/api/orders/${id}/refund`, { data: { amountCents: 100 } })).status()).toBe(400)
    expect((await admin.post(`/api/orders/${id}/refund`, { data: { amountCents: 0, reason: 'zero' } })).status()).toBe(400)
    expect((await admin.post(`/api/orders/${id}/refund`, { data: { amountCents: -5, reason: 'negative' } })).status()).toBe(400)
  })

  test('a cancelled paid order can still be refunded', async ({ request }) => {
    const admin = await staffApi(OWNER)
    const { id } = await placeOrderApi(request, { payment: 'btc' })
    await admin.post(`/api/orders/${id}/paid`, { data: {} })
    await admin.post(`/api/orders/${id}/status`, { data: { to: 'cancelled' } })
    expect((await admin.post(`/api/orders/${id}/refund`, { data: { reason: 'cancelled after payment' } })).ok()).toBeTruthy()
  })

  test('only pending manual refunds can be marked sent, and only once', async ({ request }) => {
    const admin = await staffApi(OWNER)
    const { id } = await placeOrderApi(request)
    await admin.post(`/api/orders/${id}/paid`, { data: {} })
    await admin.post(`/api/orders/${id}/refund`, { data: { reason: 'manual cash back' } })
    const refunds = ((await (await admin.get('/api/staff/state')).json()) as { refunds: { id: number; orderId: string; status: string }[] }).refunds
    const mine = refunds.find((r) => r.orderId === id)!
    expect(mine.status).toBe('pending_manual')
    expect((await admin.post(`/api/refunds/${mine.id}/complete`, { data: {} })).ok()).toBeTruthy()
    expect((await admin.post(`/api/refunds/${mine.id}/complete`, { data: {} })).status()).toBe(404)
  })

  test('drivers cannot issue or complete refunds', async ({ request }) => {
    const driver = await staffApi(DRIVER)
    const { id } = await placeOrderApi(request)
    expect((await driver.post(`/api/orders/${id}/refund`, { data: { reason: 'nope' } })).status()).toBe(403)
    expect((await driver.post('/api/refunds/1/complete', { data: {} })).status()).toBe(403)
  })

  test('customers cannot see the staff-only refund list', async ({ request }) => {
    expect((await request.get('/api/staff/state')).status()).toBe(401)
    expect((await request.post('/api/orders/SM1001/refund', { data: { reason: 'sneaky' } })).status()).toBe(401)
  })
})
