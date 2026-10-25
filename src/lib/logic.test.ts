import { describe, expect, it } from 'vitest'
import { buildBatches } from './batching'
import { SEED_PRODUCTS } from './catalog'
import { botReply, INITIAL_BOT, parseItems, type BotCtx, type BotState } from './chatbot'
import { isOpenNow } from './config'
import { canTransition, inDeliveryZone, normalizePhone, paymentStatusAfterRefund, priceCart, refundableCents } from './orders'
import type { Order, PublicOrder, Staff } from './types'

const staff: Staff[] = [
  { id: 'e1', name: 'Dre', role: 'employee', phone: '+13025550102', onShift: true },
  { id: 'e2', name: 'Sam', role: 'employee', phone: '+13025550103', onShift: true },
]
const order = (id: string, zip: string, t: number, extra: Partial<Order> = {}): Order => ({
  id, customerName: 'x', phone: '+13025550199', address: 'a', zip, items: [], subtotalCents: 0, deliveryFeeCents: 0, serviceFeeCents: 0,
  tipCents: 0, totalCents: 0, payment: 'cash', paymentStatus: 'unpaid', refundedCents: 0, status: 'accepted', source: 'web', createdAt: t, ...extra,
})

describe('pricing', () => {
  it('charges delivery under the free threshold', () => {
    expect(priceCart(2000, 100)).toMatchObject({ deliveryFeeCents: 399, serviceFeeCents: 99, totalCents: 2000 + 399 + 99 + 100 })
  })
  it('waives delivery at $60', () => {
    expect(priceCart(6000).deliveryFeeCents).toBe(0)
  })
})

describe('validation', () => {
  it('normalizes phones', () => {
    expect(normalizePhone('(302) 555-0123')).toBe('+13025550123')
    expect(normalizePhone('12')).toBeNull()
  })
  it('checks zones', () => {
    expect(inDeliveryZone('19801')).toBe(true)
    expect(inDeliveryZone('90210')).toBe(false)
    expect(inDeliveryZone('19901')).toBe(false)
  })
})

describe('refunds', () => {
  it('has nothing to refund when unpaid', () => {
    expect(refundableCents({ paymentStatus: 'unpaid', totalCents: 5000, refundedCents: 0 })).toBe(0)
  })
  it('subtracts prior refunds', () => {
    expect(refundableCents({ paymentStatus: 'partial_refund', totalCents: 5000, refundedCents: 1200 })).toBe(3800)
    expect(refundableCents({ paymentStatus: 'refunded', totalCents: 5000, refundedCents: 5000 })).toBe(0)
  })
  it('derives payment status', () => {
    expect(paymentStatusAfterRefund(5000, 1200)).toBe('partial_refund')
    expect(paymentStatusAfterRefund(5000, 5000)).toBe('refunded')
  })
})

describe('order state machine', () => {
  it('allows forward moves and rejects skips', () => {
    expect(canTransition('placed', 'accepted')).toBe(true)
    expect(canTransition('placed', 'delivered')).toBe(false)
    expect(canTransition('out_for_delivery', 'cancelled')).toBe(false)
    expect(canTransition('delivered', 'placed')).toBe(false)
  })
})

describe('batching', () => {
  it('groups by zip and caps at 4', () => {
    const orders = [...Array(5)].map((_, i) => order(`A${i}`, '19801', i)).concat([order('B0', '19711', 9)])
    const plan = buildBatches(orders, staff)
    expect(plan.map((p) => p.orderIds.length).sort()).toEqual([1, 1, 4])
  })
  it('balances drivers', () => {
    const plan = buildBatches([order('A', '19801', 1), order('B', '19711', 2)], staff)
    expect(new Set(plan.map((p) => p.driverId)).size).toBe(2)
  })
  it('does nothing with nobody on shift', () => {
    expect(buildBatches([order('A', '19801', 1)], staff.map((s) => ({ ...s, onShift: false })))).toEqual([])
  })
  it('skips already assigned orders', () => {
    expect(buildBatches([order('A', '19801', 1, { driverId: 'e1' })], staff)).toEqual([])
  })
})

describe('chatbot', () => {
  const ctx: BotCtx = {
    products: SEED_PRODUCTS, orders: [], open: true,
    placeOrder: async (d) => ({ ok: true, order: { ...order('SM1001', d.zip, 1, { status: 'placed' }), paymentUrl: undefined } as PublicOrder }),
    createTicket: async () => ({ id: 'T101' }),
  }
  const say = async (s: BotState, ...inputs: string[]) => {
    let st = s
    for (const i of inputs) st = (await botReply(st, i, ctx)).state
    return st
  }

  it('parses quantities and fuzzy names', () => {
    const { lines } = parseItems('2 smash burger combo, sparkling lemonades', SEED_PRODUCTS)
    expect(lines).toEqual([{ productId: 'c1', qty: 2 }, { productId: 'd2', qty: 1 }])
  })
  it('gathers a full order and places it', async () => {
    const s = await say(INITIAL_BOT, 'start an order', '2 smash burger combo', "no, that's it", 'Jo', '302-555-0123', '1 Main St', '19801', 'cash')
    expect(s.step).toBe('confirm')
    const r = await botReply(s, 'yes', ctx)
    expect(r.replies[0]).toContain('SM1001')
  })
  it('requires a registry card for herbs', async () => {
    const s = await say(INITIAL_BOT, 'order', '1 calm flower', 'no', 'Jo', '3025550123', '1 Main St', '19801', 'cash')
    expect(s.step).toBe('medcard')
  })
  it('rejects out-of-zone zips', async () => {
    const s = await say(INITIAL_BOT, 'order', '3 mac and cheese bowl', 'no', 'Jo', '3025550123', '1 Main St', '90210')
    expect(s.step).toBe('zip')
  })
  it('opens a ticket', async () => {
    const s = await say(INITIAL_BOT, 'I need a refund', 'wrong item arrived')
    expect(s.step).toBe('ticket_phone')
    expect((await botReply(s, '3025550123', ctx)).replies[0]).toContain('T101')
  })
})

describe('store hours (Eastern)', () => {
  // 2026-10-26 is a Monday; EDT is UTC-4.
  const at = (iso: string) => isOpenNow(new Date(iso))
  it('opens at 11am and closes at 10:30pm on weekdays', () => {
    expect(at('2026-10-26T14:59:00Z')).toBe(false)
    expect(at('2026-10-26T15:00:00Z')).toBe(true)
    expect(at('2026-10-27T02:29:00Z')).toBe(true)
    expect(at('2026-10-27T02:30:00Z')).toBe(false)
  })
  it('stays open until midnight on Friday and Saturday', () => {
    expect(at('2026-10-31T03:30:00Z')).toBe(true) // Fri 11:30pm
    expect(at('2026-10-31T04:00:00Z')).toBe(false) // Sat 12:00am
    expect(at('2026-11-01T03:30:00Z')).toBe(true) // Sat 11:30pm
  })
})

describe('chatbot intents', () => {
  const ctx: BotCtx = {
    products: SEED_PRODUCTS, orders: [], open: true,
    placeOrder: async () => ({ ok: false, error: 'unused' }),
    createTicket: async () => ({ id: 'T200' }),
  }
  const ask = async (t: string, s: BotState = INITIAL_BOT) => botReply(s, t, ctx)

  it.each(['what are your hours', 'when do you close', 'are you open', 'hour?'])('answers hours for "%s"', async (q) => {
    expect((await ask(q)).replies[0]).toContain('Sun-Thu 11am-10:30pm')
  })
  it('says closed when the store is closed', async () => {
    const r = await botReply(INITIAL_BOT, 'hours', { ...ctx, open: false })
    expect(r.replies[0]).toContain('closed right now')
  })
  it('lists only the Wilmington zip', async () => {
    expect((await ask('hours')).replies[0]).toContain('Zip codes: 19801.')
  })
  it('explains payment options', async () => {
    expect((await ask('do you take bitcoin')).replies[0]).toContain('Bitcoin')
  })
  it('explains compliance for herbs', async () => {
    expect((await ask('is this legal')).replies[0]).toContain('Delaware law')
  })
  it('routes complaints to a ticket', async () => {
    const r = await ask('my order is late')
    expect(r.state.step).toBe('ticket_subject')
  })
  it('asks for a phone to track an order', async () => {
    expect((await ask('where is my order')).state.step).toBe('track')
  })
  it('reports not found for an unknown phone', async () => {
    const s = (await ask('track my order')).state
    expect((await botReply(s, '3025550123', ctx)).replies[0]).toContain("couldn't find")
  })
  it('shows the driver number only when out for delivery', async () => {
    const o = (status: PublicOrder['status']): PublicOrder => ({ ...order('SM1', '19801', 1, { status, phone: '+13025550123' }), driver: { name: 'Dre', phone: '+13025550102' } } as PublicOrder)
    const s = (await ask('track')).state
    expect((await botReply(s, '3025550123', { ...ctx, orders: [o('out_for_delivery')] })).replies[0]).toContain('+13025550102')
    expect((await botReply(s, '3025550123', { ...ctx, orders: [o('ready')] })).replies[0]).not.toContain('+13025550102')
  })
  it('cancel resets a half-built order', async () => {
    const s = (await ask('order')).state
    const r = await botReply(s, 'cancel', ctx)
    expect(r.state).toEqual(INITIAL_BOT)
  })
  it('caps quantity at available stock and reports it', async () => {
    const products = SEED_PRODUCTS.map((p) => (p.id === 'c2' ? { ...p, stock: 1 } : p))
    const s = (await botReply(INITIAL_BOT, 'order', { ...ctx, products })).state
    const r = await botReply(s, '3 mac and cheese bowl', { ...ctx, products })
    expect(r.replies.join(' ')).toContain('Only 1 Mac & Cheese Bowl left')
    expect(r.state.draft.items).toEqual([{ productId: 'c2', qty: 1 }])
  })
  it('reports out-of-stock items', async () => {
    const products = SEED_PRODUCTS.map((p) => (p.id === 'c2' ? { ...p, stock: 0 } : p))
    const s = (await botReply(INITIAL_BOT, 'order', { ...ctx, products })).state
    expect((await botReply(s, 'mac and cheese bowl', { ...ctx, products })).replies.join(' ')).toContain('out of stock')
  })
  it('rejects short names, bad addresses and non-5-digit zips without advancing', async () => {
    let s = (await botReply(INITIAL_BOT, 'order', ctx)).state
    s = (await botReply(s, '2 mac and cheese bowl', ctx)).state
    s = (await botReply(s, 'no', ctx)).state
    expect(s.step).toBe('name')
    expect((await botReply(s, 'J', ctx)).state.step).toBe('name')
    s = (await botReply(s, 'Jo', ctx)).state
    expect((await botReply(s, '12345', ctx)).state.step).toBe('phone')
    s = (await botReply(s, '3025550123', ctx)).state
    expect((await botReply(s, '1', ctx)).state.step).toBe('address')
    s = (await botReply(s, '1 Main St', ctx)).state
    expect((await botReply(s, 'abc', ctx)).state.step).toBe('zip')
  })
  it('a declined confirmation does not place the order', async () => {
    let placed = false
    const c = { ...ctx, placeOrder: async () => { placed = true; return { ok: false as const, error: 'x' } } }
    let s: BotState = { step: 'confirm', draft: { items: [{ productId: 'c1', qty: 2 }], name: 'Jo', phone: '+13025550123', address: '1 Main St', zip: '19801', payment: 'cash' } }
    s = (await botReply(s, 'no', c)).state
    expect(placed).toBe(false)
    expect(s.step).toBe('idle')
  })
})

describe('parseItems', () => {
  it('handles plurals, quantities and punctuation', () => {
    expect(parseItems('3 Gummy Worms!, 2x beef jerky', SEED_PRODUCTS).lines).toEqual([{ productId: 's2', qty: 3 }, { productId: 's3', qty: 2 }])
  })
  it('merges repeated items', () => {
    expect(parseItems('gummy worms, 2 gummy worms', SEED_PRODUCTS).lines).toEqual([{ productId: 's2', qty: 3 }])
  })
  it('reports unmatched text', () => {
    const r = parseItems('unicorn steak', SEED_PRODUCTS)
    expect(r.lines).toEqual([])
    expect(r.missed).toEqual(['unicorn steak'])
  })
})

describe('phone and pricing edge cases', () => {
  it.each([['302-555-0123', '+13025550123'], ['+1 (302) 555-0123', '+13025550123'], ['1-302-555-0123', '+13025550123']])('normalizes %s', (raw, e164) => {
    expect(normalizePhone(raw)).toBe(e164)
  })
  it.each(['', '555-0123', '2025550123456', 'abcdefghij'])('rejects %s', (raw) => {
    expect(normalizePhone(raw)).toBeNull()
  })
  it('delivery is charged at $59.99 and free at exactly $60.00', () => {
    expect(priceCart(5999).deliveryFeeCents).toBe(399)
    expect(priceCart(6000).deliveryFeeCents).toBe(0)
  })
  it('the tip is added to the total but never to the subtotal', () => {
    const p = priceCart(3000, 500)
    expect(p.subtotalCents).toBe(3000)
    expect(p.totalCents).toBe(3000 + 399 + 99 + 500)
  })
})

describe('state machine (exhaustive)', () => {
  const all = ['placed', 'accepted', 'ready', 'out_for_delivery', 'delivered', 'cancelled'] as const
  const allowed = new Set(['placed>accepted', 'placed>cancelled', 'accepted>ready', 'accepted>cancelled', 'ready>out_for_delivery', 'ready>cancelled', 'out_for_delivery>delivered'])
  for (const from of all) for (const to of all) {
    it(`${from} -> ${to} is ${allowed.has(`${from}>${to}`) ? 'allowed' : 'rejected'}`, () => {
      expect(canTransition(from, to)).toBe(allowed.has(`${from}>${to}`))
    })
  }
})

describe('batching details', () => {
  const dre = { id: 'e1', name: 'Dre', role: 'employee' as const, phone: '+1', onShift: true }
  const sam = { id: 'e2', name: 'Sam', role: 'employee' as const, phone: '+2', onShift: true }
  it('gives new batches to the driver with the fewest active stops', () => {
    const busy = [order('X1', '19801', 1, { driverId: 'e1', status: 'out_for_delivery' }), order('X2', '19801', 2, { driverId: 'e1', status: 'ready' })]
    const plan = buildBatches([...busy, order('N1', '19801', 3)], [dre, sam])
    expect(plan).toHaveLength(1)
    expect(plan[0].driverId).toBe('e2')
  })
  it('ignores off-shift drivers and non-drivers', () => {
    const plan = buildBatches([order('N1', '19801', 1)], [{ ...dre, onShift: false }, { ...sam, role: 'admin' as never }])
    expect(plan).toEqual([])
  })
  it('keeps oldest orders in the first batch', () => {
    const orders = [5, 1, 4, 2, 3].map((t) => order(`O${t}`, '19801', t))
    const plan = buildBatches(orders, [dre])
    expect(plan[0].orderIds).toEqual(['O1', 'O2', 'O3', 'O4'])
    expect(plan[1].orderIds).toEqual(['O5'])
  })
  it('never batches placed, delivered or cancelled orders', () => {
    const orders = (['placed', 'delivered', 'cancelled', 'out_for_delivery'] as const).map((s, i) => order(`S${i}`, '19801', i, { status: s }))
    expect(buildBatches(orders, [dre])).toEqual([])
  })
})
