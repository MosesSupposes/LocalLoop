import { useMemo, useRef, useState } from 'react'
import type { MerchantSummary } from '../lib/types'
import { useI18n } from '../lib/i18n'
import { cx } from './ui'

type Point = { lat: number; lng: number }

/**
 * Neon canvas map. The design brief asks for a dark, glowy Mapbox style; without a Mapbox
 * token this renders the same storefront pins on a stylized night grid so discovery still
 * works offline. Swap in Mapbox GL by exporting the token (see README).
 */
export function NeonMap({
  merchants,
  center,
  span,
  selectedId,
  onSelect,
  onPan,
}: {
  merchants: MerchantSummary[]
  center: Point
  span: number
  selectedId?: string | null
  onSelect?: (merchantId: string) => void
  onPan?: (center: Point) => void
}) {
  const { t } = useI18n()
  const containerRef = useRef<HTMLDivElement>(null)
  const dragState = useRef<{ x: number; y: number; center: Point } | null>(null)
  const [dragging, setDragging] = useState(false)

  const pins = useMemo(() => {
    const halfLat = span / 111.32
    const halfLng = span / (111.32 * Math.cos((center.lat * Math.PI) / 180))
    return merchants.map((merchant) => {
      const lat = (merchant as MerchantSummary & { lat?: number }).lat
      const lng = (merchant as MerchantSummary & { lng?: number }).lng
      // Distance-only fallback: place unlocated pins on a ring by distance + slug hash.
      if (typeof lat !== 'number' || typeof lng !== 'number') {
        let hash = 0
        for (let i = 0; i < merchant.slug.length; i += 1) hash = (hash * 31 + merchant.slug.charCodeAt(i)) % 360
        const angle = (hash / 180) * Math.PI
        const radius = Math.min(0.85, merchant.distance_m / (span * 1000))
        return {
          merchant,
          x: 50 + Math.cos(angle) * radius * 45,
          y: 50 + Math.sin(angle) * radius * 45,
        }
      }
      return {
        merchant,
        x: 50 + ((lng - center.lng) / halfLng) * 50,
        y: 50 - ((lat - center.lat) / halfLat) * 50,
      }
    })
  }, [merchants, center, span])

  const clusters = useMemo(() => {
    const cells = new Map<string, { x: number; y: number; items: typeof pins }>()
    for (const pin of pins) {
      const key = `${Math.round(pin.x / 8)}:${Math.round(pin.y / 8)}`
      const cell = cells.get(key) ?? { x: pin.x, y: pin.y, items: [] as typeof pins }
      cell.items.push(pin)
      cells.set(key, cell)
    }
    return [...cells.values()]
  }, [pins])

  function onPointerDown(event: React.PointerEvent<HTMLDivElement>) {
    if (event.target instanceof HTMLElement && event.target.closest('button')) return
    dragState.current = { x: event.clientX, y: event.clientY, center: { ...center } }
    setDragging(true)
    event.currentTarget.setPointerCapture(event.pointerId)
  }

  function onPointerMove(event: React.PointerEvent<HTMLDivElement>) {
    const state = dragState.current
    const box = containerRef.current?.getBoundingClientRect()
    if (!state || !box || !onPan) return
    const dx = ((event.clientX - state.x) / box.width) * span
    const dy = ((event.clientY - state.y) / box.height) * span
    const lngPerMeter = 1 / (111.32 * 1000 * Math.cos((center.lat * Math.PI) / 180))
    const latPerMeter = 1 / (111.32 * 1000)
    onPan({
      lat: state.center.lat + dy * latPerMeter * 1000 * (span / 1000),
      lng: state.center.lng - dx * lngPerMeter * 1000 * (span / 1000),
    })
  }

  function endDrag() {
    dragState.current = null
    setDragging(false)
  }

  return (
    <div
      ref={containerRef}
      role="application"
      aria-label={t('explore.title')}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endDrag}
      onPointerLeave={endDrag}
      className={cx(
        'relative h-[58vh] min-h-[360px] w-full overflow-hidden rounded-card border border-line bg-surface',
        dragging ? 'cursor-grabbing' : 'cursor-grab',
      )}
    >
      {/* Stylized night grid: fixed decoration, parallaxed slightly while dragging. */}
      <div
        aria-hidden
        className="absolute inset-[-30%] opacity-60"
        style={{
          backgroundImage:
            'linear-gradient(to right, var(--border) 1px, transparent 1px), linear-gradient(to bottom, var(--border) 1px, transparent 1px)',
          backgroundSize: '46px 46px',
          backgroundPosition: dragging ? '6px 6px' : '0 0',
          transition: 'background-position 120ms linear',
        }}
      />
      <div
        aria-hidden
        className="absolute left-[12%] top-[18%] h-[26%] w-[38%] rounded-[40%] opacity-60"
        style={{ background: 'radial-gradient(circle at 40% 40%, oklch(0.5 0.08 220 / 0.5), transparent 70%)' }}
      />
      <div
        aria-hidden
        className="absolute bottom-0 right-0 h-[34%] w-[46%] rounded-[36%] opacity-50"
        style={{ background: 'radial-gradient(circle at 60% 60%, oklch(0.5 0.12 145 / 0.35), transparent 70%)' }}
      />

      {clusters.map((cluster) => {
        if (cluster.items.length > 1) {
          return (
            <button
              key={`cluster-${cluster.items[0]!.merchant.id}`}
              type="button"
              aria-label={`${cluster.items.length} ${t('explore.results')}`}
              onClick={() => onSelect?.(cluster.items[0]!.merchant.id)}
              className="absolute min-h-11 min-w-11 -translate-x-1/2 -translate-y-1/2 rounded-full border border-primary/50 bg-primary/20 px-3 font-mono text-xs font-bold text-primary backdrop-blur"
              style={{ left: `${cluster.x}%`, top: `${cluster.y}%` }}
            >
              {cluster.items.length}
            </button>
          )
        }

        const pin = cluster.items[0]!
        const drop = pin.merchant.has_live_drop
        return (
          <button
            key={pin.merchant.id}
            type="button"
            aria-label={`${pin.merchant.name}, ${pin.merchant.open_now ? t('common.open') : t('common.closed')}`}
            onClick={() => onSelect?.(pin.merchant.id)}
            className={cx(
              'absolute flex h-11 w-11 -translate-x-1/2 -translate-y-1/2 items-center justify-center rounded-full border text-lg transition',
              drop ? 'pin border-sunset/60 bg-sunset/25' : 'border-primary/40 bg-surface-raised',
              selectedId === pin.merchant.id && 'ring-2 ring-primary',
            )}
            style={{ left: `${pin.x}%`, top: `${pin.y}%` }}
          >
            <span aria-hidden>{drop ? '⚡' : '📍'}</span>
          </button>
        )
      })}

      <div className="pointer-events-none absolute bottom-3 left-3 rounded-full border border-line bg-surface/90 px-3 py-1 text-[11px] text-muted backdrop-blur">
        {span >= 2000 ? `${(span / 1000).toFixed(1)} km` : `${span} m`} · {t('explore.mapFallback')}
      </div>
    </div>
  )
}
