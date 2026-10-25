import { STORE } from './config'
import type { CartLine, Order, OrderItem, OrderStatus, PaymentStatus, Product } from './types'

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`

export function priceCart(subtotalCents: number, tipCents = 0) {
  const deliveryFeeCents = subtotalCents >= STORE.freeDeliveryOverCents ? 0 : STORE.deliveryFeeCents
  const serviceFeeCents = STORE.serviceFeeCents
  return {
    subtotalCents,
    deliveryFeeCents,
    serviceFeeCents,
    tipCents,
    totalCents: subtotalCents + deliveryFeeCents + serviceFeeCents + tipCents,
  }
}

export function toOrderItems(lines: CartLine[], products: Product[]): OrderItem[] {
  return lines.flatMap((l) => {
    const pr = products.find((x) => x.id === l.productId)
    return pr ? [{ productId: pr.id, name: pr.name, priceCents: pr.priceCents, qty: l.qty, restricted: pr.restricted }] : []
  })
}

export const subtotalOf = (items: OrderItem[]) => items.reduce((s, i) => s + i.priceCents * i.qty, 0)
export const hasRestricted = (items: { restricted?: string }[]) => items.some((i) => i.restricted)

/** Normalizes US numbers to E.164; returns null if invalid. */
export function normalizePhone(raw: string): string | null {
  const d = raw.replace(/\D/g, '')
  if (d.length === 10) return `+1${d}`
  if (d.length === 11 && d.startsWith('1')) return `+${d}`
  return null
}

export const inDeliveryZone = (zip: string) => (STORE.deliveryZips as readonly string[]).includes(zip.trim())

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  placed: ['accepted', 'cancelled'],
  accepted: ['ready', 'cancelled'],
  ready: ['out_for_delivery', 'cancelled'],
  out_for_delivery: ['delivered'],
  delivered: [],
  cancelled: [],
}

export const canTransition = (from: OrderStatus, to: OrderStatus) => TRANSITIONS[from].includes(to)
export const nextStatuses = (from: OrderStatus) => TRANSITIONS[from]

export const STATUS_LABEL: Record<OrderStatus, string> = {
  placed: 'Placed',
  accepted: 'Accepted',
  ready: 'Packed',
  out_for_delivery: 'On the way',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
}

export const STATUS_STEPS: OrderStatus[] = ['placed', 'accepted', 'ready', 'out_for_delivery', 'delivered']

export function orderCode(o: Pick<Order, 'id'>) {
  return o.id.toUpperCase()
}

/** Money still refundable on an order; unpaid orders have nothing to refund. */
export function refundableCents(o: Pick<Order, 'paymentStatus' | 'totalCents' | 'refundedCents'>): number {
  return o.paymentStatus === 'paid' || o.paymentStatus === 'partial_refund' ? Math.max(0, o.totalCents - o.refundedCents) : 0
}

export function paymentStatusAfterRefund(totalCents: number, refundedCents: number): PaymentStatus {
  return refundedCents >= totalCents ? 'refunded' : 'partial_refund'
}
