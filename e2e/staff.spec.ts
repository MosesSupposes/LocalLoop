import { expect, test } from '@playwright/test'
import { DRIVER, OWNER, advance, anonApi, createTicketApi, newPage, placeOrderApi, restock, seedCustomer, staffApi, staffLoginUi } from './helpers'

test.beforeAll(restock)

test.describe('order lifecycle', () => {
  test('placed to delivered across customer, admin and driver screens', async ({ browser, request }) => {
    const { id, token } = await placeOrderApi(request)

    const customer = await newPage(browser)
    await seedCustomer(customer, { orders: { [id]: token } })
    await customer.goto(`/order/${id}`)
    await expect(customer.getByText('Payment pending')).toBeVisible()

    const adminPage = await newPage(browser)
    await staffLoginUi(adminPage, OWNER)
    await expect(adminPage).toHaveURL(/\/admin/)
    const row = adminPage.locator('li', { hasText: id }).first()
    await row.getByRole('button', { name: 'Mark accepted' }).click()
    await expect(customer.getByLabel(/Order status: Accepted/)).toBeVisible()
    await row.getByRole('button', { name: 'Mark packed' }).click()
    await adminPage.getByRole('tab', { name: 'Dispatch' }).click()
    await adminPage.getByLabel(`Driver for ${id}`).selectOption({ label: 'Dre' })
    await expect(adminPage.getByLabel(`Driver for ${id}`)).toHaveValue('e1')

    const driverPage = await newPage(browser)
    await staffLoginUi(driverPage, DRIVER)
    await expect(driverPage).toHaveURL(/\/driver/)
    const stop = driverPage.locator('li', { hasText: id })
    await stop.getByRole('button', { name: 'Start delivery' }).click()

    await expect(customer.getByText('Your driver')).toBeVisible()
    await expect(customer.getByRole('link', { name: /Call \+13025550102/ })).toBeVisible()

    await stop.getByRole('button', { name: /Cash collected/ }).click()
    await stop.getByRole('button', { name: 'Delivered' }).click()
    await expect(customer.getByText('Paid', { exact: true })).toBeVisible()
    await expect(customer.getByLabel(/Order status: Delivered/)).toBeVisible()
  })

  test('illegal status jumps are rejected', async ({ request }) => {
    const admin = await staffApi(OWNER)
    const { id } = await placeOrderApi(request)
    const skip = await admin.post(`/api/orders/${id}/status`, { data: { to: 'delivered' } })
    expect(skip.status()).toBe(409)
    expect((await admin.post(`/api/orders/${id}/status`, { data: { to: 'out_for_delivery' } })).status()).toBe(409)
    await admin.post(`/api/orders/${id}/status`, { data: { to: 'cancelled' } })
    expect((await admin.post(`/api/orders/${id}/status`, { data: { to: 'accepted' } })).status()).toBe(409)
  })

  test('cannot start delivery without an assigned driver', async ({ request }) => {
    const admin = await staffApi(OWNER)
    const { id } = await placeOrderApi(request)
    for (const to of ['accepted', 'ready']) await admin.post(`/api/orders/${id}/status`, { data: { to } })
    const r = await admin.post(`/api/orders/${id}/status`, { data: { to: 'out_for_delivery' } })
    expect(r.status()).toBe(409)
    expect(await r.text()).toContain('Assign a driver')
  })

  test('cancelling restores stock', async ({ request }) => {
    const admin = await staffApi(OWNER)
    const stock = async () => ((await (await request.get('/api/products')).json()) as { products: { id: string; stock: number }[] }).products.find((p) => p.id === 'd1')!.stock
    const before = await stock()
    const { id } = await placeOrderApi(request, { items: [{ productId: 'd1', qty: 6 }] })
    expect(await stock()).toBe(before - 6)
    await admin.post(`/api/orders/${id}/status`, { data: { to: 'cancelled' } })
    expect(await stock()).toBe(before)
  })

  test('cannot oversell limited stock', async ({ request }) => {
    const admin = await staffApi(OWNER)
    await admin.patch('/api/products/g1', { data: { stock: 2 } })
    const r = await request.post('/api/orders', {
      data: { items: [{ productId: 'g1', qty: 3 }], name: 'Greedy', phone: '3025550123', address: '1 Test Street', zip: '19801', payment: 'cash', tipCents: 0 },
    })
    expect(r.status()).toBe(409)
    expect(await r.text()).toMatch(/sold out|low on stock/)
  })
})

test.describe('dispatch', () => {
  test('auto-batch groups same-ZIP orders under one driver', async ({ request }) => {
    const admin = await staffApi(OWNER)
    const a = await placeOrderApi(request)
    const b = await placeOrderApi(request)
    for (const o of [a, b]) for (const to of ['accepted', 'ready']) await admin.post(`/api/orders/${o.id}/status`, { data: { to } })
    const r = await admin.post('/api/dispatch/auto', { data: {} })
    expect(((await r.json()) as { batches: number }).batches).toBeGreaterThanOrEqual(1)
    const state = (await (await admin.get('/api/staff/state')).json()) as { orders: { id: string; batchId?: string; driverId?: string }[] }
    const [oa, ob] = [a, b].map((o) => state.orders.find((x) => x.id === o.id)!)
    expect(oa.batchId).toBeTruthy()
    expect(oa.batchId).toBe(ob.batchId)
    expect(oa.driverId).toBe(ob.driverId)
  })

  test('auto-batch button in the admin UI creates a batch', async ({ browser, request }) => {
    const admin = await staffApi(OWNER)
    const { id } = await placeOrderApi(request)
    for (const to of ['accepted', 'ready']) await admin.post(`/api/orders/${id}/status`, { data: { to } })
    const page = await newPage(browser)
    await staffLoginUi(page, OWNER)
    await page.getByRole('tab', { name: 'Dispatch' }).click()
    await page.getByRole('button', { name: 'Auto-batch' }).click()
    await expect(page.getByText('Batches updated.')).toBeVisible()
    await expect(page.locator('li', { hasText: id }).getByText(/^B[A-Z0-9]+\d$/)).toBeVisible()
  })

  test('a driver can toggle their own shift but not another driver\'s', async () => {
    const driver = await staffApi(DRIVER)
    const own = await driver.post('/api/staff/e1/shift', { data: {} })
    expect(own.ok()).toBeTruthy()
    expect((await driver.post('/api/staff/e2/shift', { data: {} })).status()).toBe(403)
    await driver.post('/api/staff/e1/shift', { data: {} })
  })

  test('drivers only see their own assigned stops', async ({ request }) => {
    const admin = await staffApi(OWNER)
    const driver = await staffApi(DRIVER)
    const mine = await placeOrderApi(request)
    const theirs = await placeOrderApi(request)
    await advance(admin, mine.id, 'e1')
    await advance(admin, theirs.id, 'e2')
    const state = (await (await driver.get('/api/staff/state')).json()) as { orders: { id: string }[]; tickets: unknown[] }
    const ids = state.orders.map((o) => o.id)
    expect(ids).toContain(mine.id)
    expect(ids).not.toContain(theirs.id)
    expect(state.tickets).toEqual([])
    expect((await driver.post(`/api/orders/${theirs.id}/status`, { data: { to: 'out_for_delivery' } })).status()).toBe(404)
  })

  test('shift toggle works from the admin dispatch tab', async ({ browser }) => {
    const page = await newPage(browser)
    await staffLoginUi(page, OWNER)
    await page.getByRole('tab', { name: 'Dispatch' }).click()
    const sam = page.locator('li', { hasText: 'Sam' })
    await sam.getByRole('button', { name: 'On shift' }).click()
    await expect(sam.getByRole('button', { name: 'Off' })).toBeVisible()
    await sam.getByRole('button', { name: 'Off' }).click()
    await expect(sam.getByRole('button', { name: 'On shift' })).toBeVisible()
  })
})

test.describe('payment and compliance gates', () => {
  test('herb order cannot be handed off without the ID check', async ({ request }) => {
    const admin = await staffApi(OWNER)
    const driver = await staffApi(DRIVER)
    const { id } = await placeOrderApi(request, { items: [{ productId: 'h1', qty: 1 }, { productId: 'c1', qty: 1 }], medCard: 'DE-12345' })
    await advance(admin, id)
    expect((await driver.post(`/api/orders/${id}/status`, { data: { to: 'out_for_delivery' } })).ok()).toBeTruthy()
    const blocked = await driver.post(`/api/orders/${id}/status`, { data: { to: 'delivered' } })
    expect(blocked.status()).toBe(409)
    expect(await blocked.text()).toContain('Check ID')
    await driver.post(`/api/orders/${id}/idcheck`, { data: { checked: true } })
    expect((await driver.post(`/api/orders/${id}/status`, { data: { to: 'delivered' } })).ok()).toBeTruthy()
  })

  test('driver screen requires ticking the ID check before Delivered works', async ({ browser, request }) => {
    const admin = await staffApi(OWNER)
    const { id } = await placeOrderApi(request, { items: [{ productId: 'h1', qty: 1 }, { productId: 'c1', qty: 1 }], medCard: 'DE-77777' })
    await advance(admin, id)
    const page = await newPage(browser)
    await staffLoginUi(page, DRIVER)
    const stop = page.locator('li', { hasText: id })
    await stop.getByRole('button', { name: 'Start delivery' }).click()
    await stop.getByRole('button', { name: /Cash collected/ }).click()
    await stop.getByRole('button', { name: 'Delivered' }).click()
    await expect(page.getByRole('alert')).toContainText('Check ID')
    await stop.getByLabel(/I checked a valid 21\+ ID/).click()
    await expect(stop.getByLabel(/I checked a valid 21\+ ID/)).toBeChecked()
    await stop.getByRole('button', { name: 'Delivered' }).click()
    await expect(stop).toHaveCount(0)
  })

  test('card orders cannot be dispatched until paid', async ({ request }) => {
    const admin = await staffApi(OWNER)
    const driver = await staffApi(DRIVER)
    const { id } = await placeOrderApi(request, { payment: 'card' })
    await advance(admin, id)
    expect((await driver.post(`/api/orders/${id}/status`, { data: { to: 'out_for_delivery' } })).status()).toBe(409)
    await admin.post(`/api/orders/${id}/paid`, { data: {} })
    expect((await driver.post(`/api/orders/${id}/status`, { data: { to: 'out_for_delivery' } })).ok()).toBeTruthy()
  })

  test('drivers can only mark cash orders paid', async ({ request }) => {
    const admin = await staffApi(OWNER)
    const driver = await staffApi(DRIVER)
    const { id } = await placeOrderApi(request, { payment: 'btc' })
    await advance(admin, id)
    expect((await driver.post(`/api/orders/${id}/paid`, { data: {} })).status()).toBe(403)
  })
})

test.describe('catalog admin', () => {
  test('stock buttons change what the storefront sells', async ({ browser }) => {
    const page = await newPage(browser)
    await staffLoginUi(page, OWNER)
    await page.getByRole('tab', { name: 'Catalog' }).click()
    const row = page.locator('li', { hasText: 'Pretzel Bites' })
    const count = row.locator('span.font-mono')
    const before = Number(await count.innerText())
    await row.getByRole('button', { name: /Increase Pretzel Bites stock/ }).click()
    await expect(count).toHaveText(String(before + 1))
    await row.getByRole('button', { name: /Decrease Pretzel Bites stock/ }).click()
    await expect(count).toHaveText(String(before))
  })

  test('a sold-out product shows Sold out and cannot be added', async ({ browser }) => {
    const admin = await staffApi(OWNER)
    await admin.patch('/api/products/s5', { data: { stock: 0 } })
    const page = await newPage(browser)
    await seedCustomer(page)
    await page.goto('/')
    await page.getByLabel('Search products').fill('pretzel')
    await expect(page.getByText('Sold out')).toBeVisible()
    await expect(page.getByRole('button', { name: /Add Pretzel Bites/ })).toHaveCount(0)
    await admin.patch('/api/products/s5', { data: { stock: 30 } })
  })
})

test.describe('ticketing', () => {
  test('admin triages a ticket: assign, reply, resolve; customer sees it and can no longer reply', async ({ browser }) => {
    const anon = await anonApi()
    const t = await createTicketApi(anon, 'My order never arrived')

    const customer = await newPage(browser)
    await seedCustomer(customer, { tickets: { [t.id]: t.token } })
    await customer.goto('/orders')

    const admin = await newPage(browser)
    await staffLoginUi(admin, OWNER)
    await admin.getByRole('tab', { name: /Tickets/ }).click()
    await admin.getByRole('button', { name: new RegExp(t.id) }).click()
    await admin.getByLabel('Assignee').selectOption({ label: 'Owner' })
    await admin.getByLabel('Reply', { exact: true }).fill('Looking into it now')
    await admin.getByRole('button', { name: 'Send' }).click()
    await expect(admin.getByLabel('Status')).toHaveValue('in_progress')

    await customer.getByText(new RegExp(`${t.id} ·`)).click()
    await expect(customer.getByText('Looking into it now')).toBeVisible()
    await customer.getByLabel('Reply').fill('Thank you!')
    await customer.getByRole('button', { name: 'Send' }).click()
    await expect(customer.getByText('Thank you!')).toBeVisible()

    await admin.getByLabel('Status').selectOption('resolved')
    await expect(customer.getByText('resolved')).toBeVisible()
    await expect(customer.getByLabel('Reply')).toHaveCount(0)
    const late = await anon.post(`/api/tickets/${t.id}/messages`, { data: { token: t.token, text: 'one more thing' } })
    expect(late.status()).toBe(409)
  })

  test('ticket filters narrow the list', async ({ browser }) => {
    const anon = await anonApi()
    const t = await createTicketApi(anon, 'Filter check ticket')
    const admin = await newPage(browser)
    await staffLoginUi(admin, OWNER)
    await admin.getByRole('tab', { name: /Tickets/ }).click()
    await admin.getByRole('button', { name: 'resolved', exact: true }).click()
    await expect(admin.getByRole('button', { name: new RegExp(t.id) })).toHaveCount(0)
    await admin.getByRole('button', { name: 'open', exact: true }).click()
    await expect(admin.getByRole('button', { name: new RegExp(t.id) })).toBeVisible()
  })
})
