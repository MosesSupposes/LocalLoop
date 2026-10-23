import { conflict } from './errors.js'

export const ORDER_STATUSES = [
  'placed',
  'accepted',
  'ready',
  'picked_up',
  'out_for_delivery',
  'delivered',
  'cancelled',
] as const

export type OrderStatus = (typeof ORDER_STATUSES)[number]

/** The only legal forward moves. Cancelling is allowed before the order is ready. */
export const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  placed: ['accepted', 'cancelled'],
  accepted: ['ready', 'cancelled'],
  ready: ['picked_up'],
  picked_up: [],
  out_for_delivery: ['delivered'],
  delivered: [],
  cancelled: [],
}

export function canTransition(from: OrderStatus, to: OrderStatus): boolean {
  return (TRANSITIONS[from] ?? []).includes(to)
}

export function assertTransition(from: OrderStatus, to: OrderStatus): void {
  if (!canTransition(from, to)) {
    throw conflict(`Order cannot move from ${from} to ${to}`, { from, to })
  }
}

export function isTerminal(status: OrderStatus): boolean {
  return TRANSITIONS[status].length === 0
}

/** Steps rendered by the order tracker, with the pickup path as the Phase 1 default. */
export const TRACKER_STEPS: OrderStatus[] = ['placed', 'accepted', 'ready', 'picked_up']

export function trackerState(status: OrderStatus): {
  steps: OrderStatus[]
  currentIndex: number
  cancelled: boolean
} {
  if (status === 'cancelled') {
    return { steps: ['placed', 'cancelled'], currentIndex: 1, cancelled: true }
  }
  const steps: OrderStatus[] =
    status === 'out_for_delivery' || status === 'delivered'
      ? [...TRACKER_STEPS, 'out_for_delivery', 'delivered']
      : TRACKER_STEPS
  return { steps, currentIndex: Math.max(0, steps.indexOf(status)), cancelled: false }
}

/** Seconds-until-ready ETA shown to the neighbor after the merchant accepts. */
export function etaMinutesFor(prepMinutes = 15): number {
  return prepMinutes
}
