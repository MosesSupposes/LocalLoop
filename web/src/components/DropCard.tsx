import { useEffect, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import type { LiveDrop } from '../lib/types'
import { useI18n } from '../lib/i18n'
import { countdown, distanceLabel, money } from '../lib/format'
import { useAddToCart, useSession } from '../lib/queries'
import { Button, Pill } from './ui'

export function DropCard({ drop }: { drop: LiveDrop }) {
  const { t } = useI18n()
  const addToCart = useAddToCart()
  const session = useSession()
  const navigate = useNavigate()
  const [now, setNow] = useState(Date.now())
  const [claimed, setClaimed] = useState(false)

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000)
    return () => clearInterval(timer)
  }, [])

  const left = Math.max(0, drop.qty_left)
  const sold = left / Math.max(1, drop.qty_total)

  async function claim() {
    if (!session.data?.user) {
      navigate(`/m/${drop.merchant_slug}`)
      return
    }
    if (!drop.item_id) {
      navigate(`/m/${drop.merchant_slug}`)
      return
    }
    addToCart.mutate(
      { merchantId: drop.merchant_id, itemId: drop.item_id, qty: 1, options: [] },
      { onSuccess: () => setClaimed(true) },
    )
  }

  return (
    <article className="surface-card flex w-[270px] shrink-0 snap-start flex-col gap-2 p-3">
      <div className="flex items-start justify-between gap-2">
        <Link to={`/m/${drop.merchant_slug}`} className="min-w-0">
          <p className="truncate font-display text-sm font-bold">{drop.merchant_name}</p>
          <p className="text-[11px] text-muted">
            {distanceLabel(drop.distance_m, drop.walk_minutes, t('common.walk'))}
          </p>
        </Link>
        <Pill tone="sunset">
          <span className="font-mono">{countdown(drop.ends_at, now)}</span>
        </Pill>
      </div>

      <p className="line-clamp-2 text-sm">{drop.title}</p>

      <div className="mt-auto space-y-2">
        <div className="h-1.5 overflow-hidden rounded-full bg-surface-raised">
          <div
            className="h-full rounded-full"
            style={{ width: `${Math.round(sold * 100)}%`, background: 'var(--gradient-sunset)' }}
          />
        </div>
        <div className="flex items-center justify-between gap-2">
          <div className="text-xs text-muted">
            <span className="font-mono text-sm font-semibold text-sunset">{money(drop.price_cents)}</span> ·{' '}
            {left} {t('storefront.left')}
          </div>
          <Button size="sm" variant="sunset" onClick={claim} disabled={addToCart.isPending || left === 0}>
            {left === 0 ? t('storefront.soldOut') : claimed ? t('storefront.added') : '⚡ ' + t('common.add')}
          </Button>
        </div>
      </div>
    </article>
  )
}
