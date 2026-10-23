import { tooMany } from './errors.js'

type Bucket = { count: number; resetAt: number }

const buckets = new Map<string, Bucket>()

/**
 * Small in-process fixed-window limiter. Good enough for a single API container;
 * swap for Redis when the API scales horizontally.
 */
export function rateLimitOrThrow(key: string, limit: number, windowMs: number): void {
  const now = Date.now()
  const bucket = buckets.get(key)
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + windowMs })
    return
  }
  bucket.count += 1
  if (bucket.count > limit) {
    const seconds = Math.ceil((bucket.resetAt - now) / 1000)
    throw tooMany(`Too many attempts. Try again in ${seconds}s.`)
  }
}

export function resetRateLimits(): void {
  buckets.clear()
}
