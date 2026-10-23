import type { Hours } from './types'

export function money(cents: number | null | undefined, locale = 'en'): string {
  const value = (cents ?? 0) / 100
  return new Intl.NumberFormat(locale === 'es' ? 'es-US' : 'en-US', {
    style: 'currency',
    currency: 'USD',
  }).format(value)
}

export function distanceLabel(meters: number, walkMinutes: number, walkWord: string): string {
  if (meters < 1000) return `${Math.round(meters)} m · ${walkMinutes} ${walkWord}`
  return `${(meters / 1000).toFixed(1)} km · ${walkMinutes} ${walkWord}`
}

export function countdown(endsAt: string, now = Date.now()): string {
  const ms = new Date(endsAt).getTime() - now
  if (ms <= 0) return '0:00'
  const totalMinutes = Math.floor(ms / 60000)
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  const seconds = Math.floor((ms % 60000) / 1000)
  if (hours >= 1) return `${hours}h ${String(minutes).padStart(2, '0')}m`
  return `${minutes}:${String(seconds).padStart(2, '0')}`
}

export function timeOfDay(iso: string, locale = 'en'): string {
  return new Date(iso).toLocaleTimeString(locale === 'es' ? 'es-US' : 'en-US', {
    hour: 'numeric',
    minute: '2-digit',
  })
}

export function dayLabel(iso: string, locale = 'en'): string {
  return new Date(iso).toLocaleDateString(locale === 'es' ? 'es-US' : 'en-US', {
    month: 'short',
    day: 'numeric',
  })
}

export const DAY_KEYS = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'] as const

export function todayWindow(hours: Hours, timezone?: string): string | null {
  if (!hours || Object.keys(hours).length === 0) return null
  let dayIndex: number
  try {
    const parts = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: timezone }).format(new Date())
    dayIndex = DAY_KEYS.indexOf(parts.toLowerCase() as (typeof DAY_KEYS)[number])
  } catch {
    dayIndex = new Date().getDay()
  }
  const ranges = hours[DAY_KEYS[dayIndex < 0 ? new Date().getDay() : dayIndex]]
  if (!ranges || ranges.length === 0) return null
  return ranges.map(([open, close]) => `${open}–${close}`).join(', ')
}

/** Deterministic gradient for a storefront tile, derived from its slug. */
export function tileGradient(seed: string): string {
  let hash = 0
  for (let i = 0; i < seed.length; i += 1) hash = (hash * 31 + seed.charCodeAt(i)) % 360
  const hueA = hash
  const hueB = (hash + 48) % 360
  return `linear-gradient(135deg, oklch(0.42 0.11 ${hueA}), oklch(0.3 0.08 ${hueB}))`
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? '')
    .join('')
}

export function nextPickupSlots(): { value: string; label: string }[] {
  const slots: { value: string; label: string }[] = []
  const base = new Date()
  base.setMinutes(base.getMinutes() + 20, 0, 0)
  for (let i = 0; i < 4; i += 1) {
    const slot = new Date(base.getTime() + i * 15 * 60000)
    slots.push({
      value: slot.toISOString(),
      label: slot.toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit' }),
    })
  }
  return slots
}
