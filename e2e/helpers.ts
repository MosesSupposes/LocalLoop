import { readFileSync } from 'node:fs'
import { expect, request as pwRequest, type APIRequestContext, type Browser, type Page } from '@playwright/test'

export const OWNER = '+13025550101'
export const DRIVER = '+13025550102'
const LOG = 'e2e/.tmp/api.log'
const BASE = 'http://localhost:5199'

export async function passAgeGate(page: Page) {
  const btn = page.getByRole('button', { name: /I am 21 or older/ })
  if (await btn.isVisible().catch(() => false)) await btn.click()
}

export async function visit(page: Page, path: string) {
  await page.goto(path)
  await passAgeGate(page)
}

async function readCode(phone: string): Promise<string> {
  for (let i = 0; i < 40; i++) {
    const hits = [...readFileSync(LOG, 'utf8').matchAll(new RegExp(`to \\${phone}: Smokology staff code: (\\d{6})`, 'g'))]
    if (hits.length) return hits[hits.length - 1][1]
    await new Promise((r) => setTimeout(r, 250))
  }
  throw new Error(`No OTP found for ${phone}`)
}

/** Signs in through the real login screen. */
export async function staffLoginUi(page: Page, phone: string) {
  await visit(page, '/staff')
  await page.getByLabel('Mobile number').fill(phone)
  const before = readFileSync(LOG, 'utf8').length
  await page.getByRole('button', { name: 'Text me a code' }).click()
  await expect(page.getByLabel('6-digit code from your text')).toBeVisible()
  expect(readFileSync(LOG, 'utf8').length).toBeGreaterThanOrEqual(before)
  await page.getByLabel('6-digit code from your text').fill(await readCode(phone))
  await page.getByRole('button', { name: 'Verify' }).click()
}

/** API client with a staff session cookie, for fast test setup. */
export async function staffApi(phone: string): Promise<APIRequestContext> {
  const ctx = await pwRequest.newContext({ baseURL: BASE })
  const r = await ctx.post('/api/auth/request', { data: { phone } })
  expect(r.ok()).toBeTruthy()
  const v = await ctx.post('/api/auth/verify', { data: { phone, code: await readCode(phone) } })
  expect(v.ok()).toBeTruthy()
  return ctx
}

export interface Placed {
  id: string
  token: string
}

export async function placeOrderApi(
  req: APIRequestContext,
  opts: { items?: { productId: string; qty: number }[]; payment?: 'card' | 'btc' | 'cash'; name?: string; zip?: string; medCard?: string } = {},
): Promise<Placed> {
  const r = await req.post('/api/orders', {
    data: {
      items: opts.items ?? [{ productId: 'c1', qty: 2 }],
      name: opts.name ?? 'E2E Customer',
      phone: '3025550123',
      address: '1 Test Street',
      zip: opts.zip ?? '19801',
      payment: opts.payment ?? 'cash',
      tipCents: 0,
      medCard: opts.medCard,
    },
  })
  expect(r.status(), await r.text()).toBe(201)
  const j = (await r.json()) as { order: { id: string }; token: string }
  return { id: j.order.id, token: j.token }
}

export async function advance(admin: APIRequestContext, id: string, driverId = 'e1') {
  for (const to of ['accepted', 'ready']) {
    const r = await admin.post(`/api/orders/${id}/status`, { data: { to } })
    expect(r.ok(), await r.text()).toBeTruthy()
  }
  const a = await admin.post(`/api/orders/${id}/assign`, { data: { driverId } })
  expect(a.ok()).toBeTruthy()
}

export const API_PRODUCTS = ['c1', 'h1', 'd1', 's1', 'd2', 'g1', 's5']

/** Both projects share one DB, so top stock back up before each spec file. */
export async function restock() {
  const admin = await staffApi(OWNER)
  for (const id of API_PRODUCTS) await admin.patch(`/api/products/${id}`, { data: { stock: 500 } })
}

export async function newPage(browser: Browser): Promise<Page> {
  return (await browser.newContext()).newPage()
}

/** Pre-loads a browser with the age check passed and the given order/ticket tokens, as if it had placed them. */
export async function seedCustomer(page: Page, tokens: { orders?: Record<string, string>; tickets?: Record<string, string> } = {}) {
  await page.addInitScript((t) => {
    localStorage.setItem('smokology-store-v2', JSON.stringify({ version: 0, state: { ageOk: true, myOrderTokens: t.orders ?? {}, myTicketTokens: t.tickets ?? {} } }))
  }, tokens)
}

export async function openChat(page: Page) {
  await page.getByRole('button', { name: 'Open chat' }).click()
  const chat = page.getByRole('dialog', { name: 'Smokology chat' })
  const say = async (t: string) => {
    await chat.getByLabel('Message').fill(t)
    await chat.getByRole('button', { name: 'Send' }).click()
  }
  return { chat, say }
}

export async function createTicketApi(req: APIRequestContext, subject: string, orderId?: string): Promise<Placed> {
  const r = await req.post('/api/tickets', { data: { subject, type: 'question', phone: '3025550123', name: 'E2E Customer', orderId } })
  expect(r.status()).toBe(201)
  const j = (await r.json()) as { ticket: { id: string }; token: string }
  return { id: j.ticket.id, token: j.token }
}

/** Unauthenticated API client, like a customer's browser. */
export const anonApi = () => pwRequest.newContext({ baseURL: BASE })
