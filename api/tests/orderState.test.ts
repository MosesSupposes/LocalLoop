import { describe, expect, it } from 'vitest'
import { canTransition, isTerminal, trackerState, TRANSITIONS } from '../src/lib/orderState.js'
import { HttpError } from '../src/lib/errors.js'
import { assertTransition } from '../src/lib/orderState.js'

describe('order state machine', () => {
  it('walks the pickup path', () => {
    expect(canTransition('placed', 'accepted')).toBe(true)
    expect(canTransition('accepted', 'ready')).toBe(true)
    expect(canTransition('ready', 'picked_up')).toBe(true)
  })

  it('rejects skipping steps and illegal moves', () => {
    expect(canTransition('placed', 'ready')).toBe(false)
    expect(canTransition('placed', 'picked_up')).toBe(false)
    expect(canTransition('picked_up', 'cancelled')).toBe(false)
    expect(canTransition('cancelled', 'accepted')).toBe(false)
  })

  it('allows cancelling only before the order is ready', () => {
    expect(canTransition('placed', 'cancelled')).toBe(true)
    expect(canTransition('accepted', 'cancelled')).toBe(true)
    expect(canTransition('ready', 'cancelled')).toBe(false)
  })

  it('keeps delivery states for Phase 3', () => {
    expect(canTransition('out_for_delivery', 'delivered')).toBe(true)
    expect(canTransition('delivered', 'cancelled')).toBe(false)
  })

  it('throws a 409 on an illegal transition', () => {
    try {
      assertTransition('placed', 'picked_up')
      throw new Error('should have thrown')
    } catch (error) {
      expect(error).toBeInstanceOf(HttpError)
      expect((error as HttpError).statusCode).toBe(409)
    }
  })

  it('knows which statuses are terminal', () => {
    expect(isTerminal('delivered')).toBe(true)
    expect(isTerminal('cancelled')).toBe(true)
    expect(isTerminal('placed')).toBe(false)
    expect(Object.keys(TRANSITIONS)).toHaveLength(7)
  })
})

describe('tracker', () => {
  it('reports the current step for the neighbor view', () => {
    expect(trackerState('placed')).toEqual({ steps: ['placed', 'accepted', 'ready', 'picked_up'], currentIndex: 0, cancelled: false })
    expect(trackerState('ready').currentIndex).toBe(2)
    expect(trackerState('picked_up').currentIndex).toBe(3)
  })

  it('flags cancellation', () => {
    const state = trackerState('cancelled')
    expect(state.cancelled).toBe(true)
    expect(state.currentIndex).toBe(1)
  })
})
