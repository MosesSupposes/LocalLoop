import { STORE } from './config'
import type { Order, Staff } from './types'

export interface BatchAssignment {
  batchId: string
  driverId: string
  orderIds: string[]
}

const ACTIVE = new Set(['accepted', 'ready', 'out_for_delivery'])

/**
 * Groups unassigned accepted/ready orders by ZIP, chunks them to maxBatchSize,
 * and gives each chunk to the on-shift employee with the fewest active orders.
 */
export function buildBatches(orders: Order[], staff: Staff[], now = Date.now()): BatchAssignment[] {
  const drivers = staff.filter((s) => s.role === 'employee' && s.onShift)
  if (!drivers.length) return []

  const load = new Map(drivers.map((d) => [d.id, orders.filter((o) => o.driverId === d.id && ACTIVE.has(o.status)).length]))
  const pending = orders
    .filter((o) => (o.status === 'accepted' || o.status === 'ready') && !o.driverId)
    .sort((a, b) => a.createdAt - b.createdAt)

  const byZip = new Map<string, Order[]>()
  for (const o of pending) byZip.set(o.zip, [...(byZip.get(o.zip) ?? []), o])

  const out: BatchAssignment[] = []
  let n = 0
  for (const group of byZip.values()) {
    for (let i = 0; i < group.length; i += STORE.maxBatchSize) {
      const chunk = group.slice(i, i + STORE.maxBatchSize)
      const driver = [...drivers].sort((a, b) => load.get(a.id)! - load.get(b.id)!)[0]
      load.set(driver.id, load.get(driver.id)! + chunk.length)
      out.push({ batchId: `B${now.toString(36).slice(-4).toUpperCase()}${++n}`, driverId: driver.id, orderIds: chunk.map((o) => o.id) })
    }
  }
  return out
}
