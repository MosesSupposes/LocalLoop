// Money rules. Fee config lives in the fee_config table; these functions are pure
// so the values are unit tested (api/tests/fees.test.ts).

export type FeeConfig = { platformFeeBps: number; serviceFeeCents: number }
export type ActiveDeal = { type: 'percent' | 'fixed' | 'bogo'; value: number }
export type Totals = {
  subtotalCents: number
  discountCents: number
  platformFeeCents: number
  serviceFeeCents: number
  tipCents: number
  totalCents: number
}

export const DEFAULT_FEE_CONFIG: FeeConfig = { platformFeeBps: 500, serviceFeeCents: 99 }

/** Merchant-side platform fee, in cents, rounded to the nearest cent. */
export function platformFeeCents(subtotalCents: number, bps: number): number {
  if (subtotalCents <= 0) return 0
  return Math.round((subtotalCents * bps) / 10000)
}

/**
 * Best single active deal against a subtotal. Deals do not stack, and a discount can
 * never exceed the subtotal. 'bogo' promos are display-only in Phase 1 (free-unit logic
 * lands with per-item promotion rules in Phase 2).
 */
export function dealDiscountCents(deals: ActiveDeal[], subtotalCents: number): number {
  let best = 0
  for (const deal of deals) {
    let discount = 0
    if (deal.type === 'percent') discount = Math.round((subtotalCents * deal.value) / 100)
    else if (deal.type === 'fixed') discount = deal.value
    if (discount > best) best = discount
  }
  return Math.min(best, subtotalCents)
}

export function orderTotals(input: {
  subtotalCents: number
  tipCents: number
  discountCents?: number
  feeConfig: FeeConfig
  platformFeePct?: number
}): Totals {
  const discountCents = Math.min(input.discountCents ?? 0, input.subtotalCents)
  const discountedSubtotal = input.subtotalCents - discountCents
  const platformFee = platformFeeCents(
    discountedSubtotal,
    input.feeConfig.platformFeeBps * (input.platformFeePct ?? 1),
  )
  const serviceFeeCents = input.feeConfig.serviceFeeCents
  return {
    subtotalCents: input.subtotalCents,
    discountCents,
    platformFeeCents: platformFee,
    serviceFeeCents,
    tipCents: input.tipCents,
    // The neighbor pays subtotal - discount + service fee + tip. The platform fee is
    // withheld from the merchant payout instead of added on top.
    totalCents: discountedSubtotal + serviceFeeCents + input.tipCents,
  }
}

/** Loop Points: one point per whole dollar of subtotal. */
export function loopPointsFor(subtotalCents: number): number {
  return Math.floor(Math.max(0, subtotalCents) / 100)
}
