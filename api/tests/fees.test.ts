import { describe, expect, it } from 'vitest'
import {
  DEFAULT_FEE_CONFIG,
  dealDiscountCents,
  loopPointsFor,
  orderTotals,
  platformFeeCents,
} from '../src/lib/fees.js'

describe('platform fee', () => {
  it('takes 5% of the subtotal, rounded to the cent', () => {
    expect(platformFeeCents(1596, 500)).toBe(80)
    expect(platformFeeCents(1075, 500)).toBe(54)
    expect(platformFeeCents(0, 500)).toBe(0)
  })
})

describe('order totals', () => {
  it('charges the neighbor subtotal + service fee + tip, and withholds the platform fee', () => {
    const totals = orderTotals({
      subtotalCents: 1596,
      tipCents: 200,
      feeConfig: DEFAULT_FEE_CONFIG,
    })
    expect(totals).toEqual({
      subtotalCents: 1596,
      discountCents: 0,
      platformFeeCents: 80,
      serviceFeeCents: 99,
      tipCents: 200,
      totalCents: 1895,
    })
  })

  it('applies a discount before the platform fee and never lets it exceed the subtotal', () => {
    const totals = orderTotals({
      subtotalCents: 2000,
      tipCents: 0,
      discountCents: 5000,
      feeConfig: DEFAULT_FEE_CONFIG,
    })
    expect(totals.discountCents).toBe(2000)
    expect(totals.platformFeeCents).toBe(0)
    expect(totals.totalCents).toBe(99)
  })
})

describe('deals', () => {
  it('applies the single best deal, not a stack', () => {
    const deals = [
      { type: 'percent' as const, value: 20 },
      { type: 'fixed' as const, value: 300 },
    ]
    // 20% of 1399 = 280, the fixed $3 = 300 wins
    expect(dealDiscountCents(deals, 1399)).toBe(300)
  })

  it('ignores bogo promos in Phase 1', () => {
    expect(dealDiscountCents([{ type: 'bogo' as const, value: 1 }], 1000)).toBe(0)
  })

  it('returns zero when there are no deals', () => {
    expect(dealDiscountCents([], 1000)).toBe(0)
  })
})

describe('loop points', () => {
  it('grants one point per whole dollar of subtotal', () => {
    expect(loopPointsFor(1596)).toBe(15)
    expect(loopPointsFor(1075)).toBe(10)
    expect(loopPointsFor(99)).toBe(0)
    expect(loopPointsFor(-5)).toBe(0)
  })
})
