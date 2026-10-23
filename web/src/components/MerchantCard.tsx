import { Link } from 'react-router-dom'
import type { MerchantSummary } from '../lib/types'
import { categoryLabel, useI18n } from '../lib/i18n'
import { distanceLabel, money } from '../lib/format'
import { useConfig, useToggleFavorite, useSession } from '../lib/queries'
import { Pill, Tile, cx } from './ui'

export function MerchantCard({ merchant, showFavorite = true }: { merchant: MerchantSummary; showFavorite?: boolean }) {
  const { t, locale } = useI18n()
  const config = useConfig()
  const session = useSession()
  const toggleFavorite = useToggleFavorite()

  const isFavorite = Boolean(
    session.data?.user?.favorites.some((favorite) => favorite.merchant_id === merchant.id),
  )
  const glyph = config.data?.categories.find((c) => c.key === merchant.category)?.glyph

  return (
    <article className="surface-card group relative overflow-hidden p-3 transition hover:border-primary/40">
      <Link to={`/m/${merchant.slug}`} className="flex items-start gap-3">
        <Tile seed={merchant.slug} label={merchant.name} glyph={glyph} size={52} />
        <div className="min-w-0 flex-1">
          <div className="flex items-start justify-between gap-2">
            <h3 className="truncate font-display text-base font-bold">{merchant.name}</h3>
            <Pill tone={merchant.open_now ? 'open' : 'closed'}>
              {merchant.open_now ? t('common.open') : t('common.closed')}
            </Pill>
          </div>
          <p className="mt-0.5 truncate text-xs text-muted">
            {categoryLabel(merchant.category, config.data?.categories ?? [], locale)} ·{' '}
            {distanceLabel(merchant.distance_m, merchant.walk_minutes, t('common.walk'))}
          </p>
          <div className="mt-2 flex flex-wrap items-center gap-1.5">
            {merchant.has_live_drop ? <Pill tone="sunset">⚡ {t('home.liveDrops')}</Pill> : null}
            {merchant.has_active_deal ? <Pill tone="pink">🏷 {t('common.discount')}</Pill> : null}
            {merchant.rating_avg > 0 ? (
              <span className="font-mono text-xs text-muted">★ {merchant.rating_avg.toFixed(1)}</span>
            ) : null}
            {merchant.accepts_delivery ? <Pill tone="sky">🛵</Pill> : null}
          </div>
        </div>
      </Link>

      {showFavorite ? (
        <button
          type="button"
          aria-label={t('common.favorite')}
          aria-pressed={isFavorite}
          disabled={!session.data?.user || toggleFavorite.isPending}
          onClick={() => toggleFavorite.mutate({ merchantId: merchant.id, favorite: isFavorite })}
          className={cx(
            'absolute bottom-3 right-3 flex h-11 w-11 items-center justify-center rounded-full border text-lg transition',
            isFavorite ? 'border-pink/50 bg-pink/15 text-pink' : 'border-line bg-surface-raised text-muted',
          )}
        >
          {isFavorite ? '♥' : '♡'}
        </button>
      ) : null}
    </article>
  )
}

export function DealRibbon({ title, value, type }: { title: string; type: string; value: number }) {
  const amount = type === 'percent' ? `${value}% off` : `${money(value)} off`
  return (
    <div className="gradient-sunset glow-sunset flex items-center justify-between gap-3 rounded-2xl px-3 py-2 text-sm font-semibold text-white">
      <span className="truncate">{title}</span>
      <span className="shrink-0 font-mono text-xs uppercase tracking-wide">{amount}</span>
    </div>
  )
}
