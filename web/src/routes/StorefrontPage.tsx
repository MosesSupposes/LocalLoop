import { useMemo, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useI18n } from '../lib/i18n'
import { countdown, money, tileGradient, todayWindow } from '../lib/format'
import { useConfig, useSession, useStorefront, useToggleFavorite } from '../lib/queries'
import { ItemSheet } from '../components/ItemSheet'
import { DealRibbon } from '../components/MerchantCard'
import { Banner, Button, Card, EmptyState, ErrorState, Pill, SectionHeader, Sheet, Skeleton, Tile, cx } from '../components/ui'
import type { MenuItem } from '../lib/types'

export function StorefrontPage() {
  const { slug } = useParams<{ slug: string }>()
  const { t } = useI18n()
  const storefront = useStorefront(slug)
  const config = useConfig()
  const session = useSession()
  const toggleFavorite = useToggleFavorite()
  const [openItem, setOpenItem] = useState<MenuItem | null>(null)
  const [now] = useState(() => Date.now())

  const grouped = useMemo(() => {
    const categories = storefront.data?.categories ?? []
    const items = storefront.data?.items ?? []
    const groups = categories
      .map((category) => ({
        category,
        items: items.filter((item) => item.category_id === category.id),
      }))
      .filter((group) => group.items.length > 0)
    const loose = items.filter((item) => !item.category_id || !categories.some((c) => c.id === item.category_id))
    if (loose.length) groups.push({ category: { id: 'other', name: t('storefront.menu'), sort: 99 }, items: loose })
    return groups
  }, [storefront.data, t])

  if (storefront.isLoading) return <Skeleton className="h-72" />
  if (storefront.error || !storefront.data) {
    return <ErrorState message={t('common.errorTitle')} onRetry={() => storefront.refetch()} retryLabel={t('common.retry')} />
  }

  const { merchant, deals, drops, reviews } = storefront.data
  const isFavorite = merchant.is_favorite || Boolean(session.data?.user?.favorites.some((f) => f.merchant_id === merchant.id))
  const glyph = config.data?.categories.find((c) => c.key === merchant.category)?.glyph
  const hours = todayWindow(merchant.hours, merchant.timezone)

  return (
    <div className="space-y-5">
      <section className="relative overflow-hidden rounded-card border border-line">
        <div className="h-32 w-full" style={{ backgroundImage: tileGradient(merchant.slug) }} aria-hidden />
        <div className="surface-card -mt-10 rounded-t-card border-0 p-4">
          <div className="flex items-start gap-3">
            <Tile seed={merchant.slug} label={merchant.name} glyph={glyph} size={56} />
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="font-display text-xl font-bold tracking-tight">{merchant.name}</h1>
                <Pill tone={merchant.open_now ? 'open' : 'closed'}>{merchant.open_now ? t('common.open') : t('common.closed')}</Pill>
                {merchant.status === 'paused' ? <Pill tone="closed">{merchant.status}</Pill> : null}
              </div>
              <p className="text-sm text-muted">{merchant.description}</p>
              <p className="mt-1 text-xs text-muted">
                {merchant.address} · {merchant.walk_minutes} {t('common.walk')}
                {hours ? ` · ${hours}` : ''}
              </p>
              <p className="mt-1 font-mono text-xs text-muted">
                ★ {merchant.rating_avg.toFixed(1)} · {merchant.review_count} {t('storefront.reviews')}
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            {merchant.phone ? (
              <a href={`tel:${merchant.phone}`}>
                <Button variant="surface" size="sm">
                  📞 {t('common.call')}
                </Button>
              </a>
            ) : null}
            <a href={`https://maps.google.com/?q=${encodeURIComponent(merchant.address ?? merchant.name)}`} target="_blank" rel="noreferrer">
              <Button variant="surface" size="sm">
                🧭 {t('common.directions')}
              </Button>
            </a>
            <Button
              variant={isFavorite ? 'primary' : 'surface'}
              size="sm"
              disabled={!session.data?.user || toggleFavorite.isPending}
              onClick={() => toggleFavorite.mutate({ merchantId: merchant.id, favorite: isFavorite })}
            >
              {isFavorite ? '♥' : '♡'} {t('common.favorite')}
            </Button>
          </div>

          {!merchant.accepts_pickup ? <Banner tone="sunset">{t('storefront.notAccepting')}</Banner> : null}
        </div>
      </section>

      <div className="space-y-2">
        {deals.map((deal) => (
          <DealRibbon key={deal.id} title={deal.title} type={deal.type} value={deal.value} />
        ))}
        {drops.map((drop) => (
          <div key={drop.id} className="surface-raised flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">⚡ {drop.title}</p>
              <p className="font-mono text-xs text-sunset">
                {money(drop.price_cents)} · {drop.qty_left} {t('storefront.left')} · {t('storefront.endsIn')}{' '}
                {countdown(drop.ends_at, now)}
              </p>
            </div>
            <Button
              size="sm"
              variant="sunset"
              onClick={() => {
                const item = storefront.data!.items.find((candidate) => candidate.id === drop.item_id)
                if (item) setOpenItem(item)
              }}
              disabled={!drop.item_id}
            >
              {t('common.add')}
            </Button>
          </div>
        ))}
      </div>

      {grouped.length ? (
        <nav className="sticky top-0 z-20 -mx-4 flex gap-2 overflow-x-auto border-b border-line bg-background/90 px-4 py-2 backdrop-blur">
          {grouped.map((group) => (
            <button
              key={group.category.id}
              type="button"
              className="min-h-9 shrink-0 rounded-full border border-line px-3 text-xs font-semibold text-muted"
              onClick={() => document.getElementById(`cat-${group.category.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
            >
              {group.category.name}
            </button>
          ))}
        </nav>
      ) : null}

      {grouped.length === 0 ? (
        <EmptyState title={t('storefront.menu')} hint={t('explore.noResults')} />
      ) : (
        grouped.map((group) => (
          <section key={group.category.id} id={`cat-${group.category.id}`} className="scroll-mt-16">
            <SectionHeader title={group.category.name} />
            <div className="grid gap-2 sm:grid-cols-2">
              {group.items.map((item) => {
                const price = item.live_drop?.price_cents ?? item.price_cents
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => setOpenItem(item)}
                    className={cx(
                      'surface-card flex items-start justify-between gap-3 p-3 text-left transition hover:border-primary/40',
                      !item.in_stock && 'opacity-60',
                    )}
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold">{item.name}</p>
                      {item.description ? <p className="line-clamp-2 text-xs text-muted">{item.description}</p> : null}
                      <div className="mt-1 flex flex-wrap gap-1">
                        {item.freshness_note ? <Pill tone="sky">{item.freshness_note}</Pill> : null}
                        {item.live_drop ? <Pill tone="sunset">⚡ {t('storefront.dropPrice')}</Pill> : null}
                        {!item.in_stock ? <Pill tone="closed">{t('storefront.outOfStock')}</Pill> : null}
                      </div>
                    </div>
                    <div className="shrink-0 text-right">
                      <div className="font-mono text-sm font-semibold">{money(price)}</div>
                      {item.unit ? <div className="text-[11px] text-muted">{item.unit}</div> : null}
                    </div>
                  </button>
                )
              })}
            </div>
          </section>
        ))
      )}

      <section>
        <SectionHeader title={t('storefront.reviews')} />
        {reviews.length === 0 ? (
          <Card>
            <p className="text-sm text-muted">{t('storefront.noReviews')}</p>
          </Card>
        ) : (
          <div className="space-y-2">
            {reviews.map((review) => (
              <Card key={review.id} className="p-3">
                <div className="flex items-center justify-between gap-2">
                  <p className="text-sm font-semibold">{review.reviewer_name}</p>
                  <span className="font-mono text-xs text-warning">{'★'.repeat(review.rating)}</span>
                </div>
                {review.body ? <p className="text-sm text-muted">{review.body}</p> : null}
              </Card>
            ))}
          </div>
        )}
      </section>

      <div className="flex justify-center">
        <Link to="/">
          <Button variant="ghost" size="sm">
            ← {t('nav.home')}
          </Button>
        </Link>
      </div>

      <Sheet open={Boolean(openItem)} onClose={() => setOpenItem(null)} title={openItem?.name ?? ''}>
        {openItem ? <ItemSheet merchant={merchant} item={openItem} /> : null}
      </Sheet>
    </div>
  )
}
