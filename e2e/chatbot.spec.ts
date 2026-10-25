import { expect, test } from '@playwright/test'
import { OWNER, advance, openChat, placeOrderApi, restock, staffApi, visit } from './helpers'

test.beforeAll(restock)

test.describe('chatbot', () => {
  test('answers hours, payments and compliance questions', async ({ page }) => {
    await visit(page, '/')
    const { chat, say } = await openChat(page)
    await say('what are your hours')
    await expect(chat.getByText(/Sun-Thu 11am-10:30pm/)).toBeVisible()
    await expect(chat.getByText(/19801/).first()).toBeVisible()
    await say('can I pay with bitcoin')
    await expect(chat.getByText(/card \(Stripe\), Bitcoin, and cash/)).toBeVisible()
    await say('is this legal')
    await expect(chat.getByText(/Delaware law/)).toBeVisible()
  })

  test('quick-reply chips drive the conversation', async ({ page }) => {
    await visit(page, '/')
    const { chat } = await openChat(page)
    await chat.getByRole('button', { name: 'Start an order' }).click()
    await expect(chat.getByRole('button', { name: /Comfort Food/ })).toBeVisible()
    await chat.getByRole('button', { name: /Comfort Food/ }).click()
    await expect(chat.getByText(/Smash Burger Combo — \$12\.99/)).toBeVisible()
  })

  test('takes a full order and the admin sees it as a chat order', async ({ page }) => {
    await visit(page, '/')
    const { chat, say } = await openChat(page)
    await say('start an order')
    await say('2 smash burger combo')
    await expect(chat.getByText(/Got it/)).toBeVisible()
    await say("no, that's it")
    await say('Bot Buyer')
    await say('302-555-0144')
    await say('9 Chat Court')
    await say('19801')
    await say('cash')
    await expect(chat.getByText(/Please confirm/)).toBeVisible()
    await say('yes, place it')
    const placed = chat.getByText(/Order SM\d+ is in/)
    await expect(placed).toBeVisible()
    const id = (await placed.innerText()).match(/SM\d+/)![0]

    const admin = await staffApi(OWNER)
    const state = (await (await admin.get('/api/staff/state')).json()) as { orders: { id: string; source: string; customerName: string }[] }
    expect(state.orders.find((o) => o.id === id)).toMatchObject({ source: 'chat', customerName: 'Bot Buyer' })
  })

  test('refuses a ZIP outside Wilmington and stays on that step', async ({ page }) => {
    await visit(page, '/')
    const { chat, say } = await openChat(page)
    await say('order')
    await say('2 mac and cheese bowl')
    await say('no')
    await say('Far Away')
    await say('302-555-0111')
    await say('1 Other Rd')
    await say('19901')
    await expect(chat.getByText(/don't deliver to 19901/)).toBeVisible()
    await say('19801')
    await expect(chat.getByText('How would you like to pay?').last()).toBeVisible()
  })

  test('enforces the minimum order before confirming', async ({ page }) => {
    await visit(page, '/')
    const { chat, say } = await openChat(page)
    await say('order')
    await say('1 gummy worms')
    await say('no')
    await say('Small Order')
    await say('302-555-0112')
    await say('2 Tiny St')
    await say('19801')
    await say('cash')
    await expect(chat.getByText(/minimum order is \$20\.00/)).toBeVisible()
  })

  test('asks for the registry card when herbs are in the order', async ({ page }) => {
    await visit(page, '/')
    const { chat, say } = await openChat(page)
    await say('order')
    await say('1 calm flower')
    await say('no')
    await say('Med Patient')
    await say('302-555-0113')
    await say('3 Green Ave')
    await say('19801')
    await say('cash')
    await expect(chat.getByText(/registry card number/)).toBeVisible()
  })

  test('reports status and the driver number once out for delivery', async ({ page, request }) => {
    const admin = await staffApi(OWNER)
    const { id, token } = await placeOrderApi(request)
    await advance(admin, id)
    const driver = await staffApi('+13025550102')
    await driver.post(`/api/orders/${id}/paid`, { data: {} })
    await driver.post(`/api/orders/${id}/status`, { data: { to: 'out_for_delivery' } })

    await page.addInitScript((t) => {
      localStorage.setItem('smokology-store-v2', JSON.stringify({ version: 0, state: { ageOk: true, myOrderTokens: { [t.id]: t.token } } }))
    }, { id, token })
    await page.goto('/')
    const { chat, say } = await openChat(page)
    await say('where is my order')
    await say('302-555-0123')
    await expect(chat.getByText(/Dre can be reached directly at \+13025550102/)).toBeVisible()
  })

  test('opens a ticket that the admin answers and the customer reads', async ({ page }) => {
    await visit(page, '/')
    const { chat, say } = await openChat(page)
    await say('I need a refund')
    await say('The fries were cold')
    await say('302-555-0144')
    const ticket = chat.getByText(/Ticket T\d+ is open/)
    await expect(ticket).toBeVisible()
    const id = (await ticket.innerText()).match(/T\d+/)![0]

    const admin = await staffApi(OWNER)
    expect((await admin.post(`/api/tickets/${id}/reply`, { data: { text: 'Credited the fries, sorry!' } })).ok()).toBeTruthy()

    await chat.getByRole('button', { name: 'Close chat' }).click()
    await page.goto('/orders')
    await page.getByText(new RegExp(`${id} ·`)).click()
    await expect(page.getByText('Credited the fries, sorry!')).toBeVisible()
  })

  test('reset clears the conversation and the chat survives a reload', async ({ page }) => {
    await visit(page, '/')
    const { chat, say } = await openChat(page)
    await say('what are your hours')
    await expect(chat.getByText(/Sun-Thu/)).toBeVisible()
    await page.reload()
    const again = await openChat(page)
    await expect(again.chat.getByText(/Sun-Thu/)).toBeVisible()
    await again.chat.getByRole('button', { name: 'Reset' }).click()
    await expect(again.chat.getByText(/Sun-Thu/)).toHaveCount(0)
  })

  test('cancel mid-order starts over', async ({ page }) => {
    await visit(page, '/')
    const { chat, say } = await openChat(page)
    await say('order')
    await say('2 mac and cheese bowl')
    await say('cancel')
    await expect(chat.getByText(/cleared that/)).toBeVisible()
  })
})
