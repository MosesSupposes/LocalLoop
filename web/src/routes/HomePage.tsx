import { Link } from 'react-router-dom'
import { useI18n } from '../lib/i18n'
import { money } from '../lib/format'
import { useHome, useSession } from '../lib/queries'
import { useUI } from '../lib/store'
import { DropCard } from '../components/DropCard'
import { MerchantCard } from '../components/MerchantCard'
import { Button, EmptyState, ErrorState, Pill, SectionHeader, Skeleton, Stat, Tile } from '../components/ui'

export function HomePage() {
  const { t, locale } = useI18n()
  const home = useHome()
  const session = useSession()
  const location = useUI((s) => s.location)
  const user = session.data?.user

  if (home.isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-24" />
        <Skeleton className="h-40" />
        <Skeleton className="h-32" />
      </div>
    )
  }

  if (home.error) {
    return <ErrorState message={t('common.errorTitle')} onRetry={() => home.refetch()} retryLabel={t('common.retry')} />
  }

  const feed = home.data!
  const greetingName = user?.display_name?.split(' ')[0]

  return (
    <div className="space-y-7">
      <section className="surface-card overflow-hidden p-4">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm text-muted">
              {t('home.greeting')}
              {greetingName ? `, ${greetingName}` : ''} · {location.label}
            </p>
            <h1 className="font-display text-2xl font-bold tracking-tight">{t('home.speedDial')}</h1>
          </div>
          <div className="flex gap-2">
            <Link to="/onboarding">
              <Button variant="surface" size="sm">
                {t('home.setupSpeedDial')}
              </Button>
            </Link>
            <Link to="/explore">
              <Button size="sm">{t('home.browseMap')}</Button>
            </Link>
          </div>
        </div>

        <div className="mt-4 grid grid-cols-3 gap-2">
          <Stat value={feed.stats.merchants} label={t('home.statMerchants')} tone="primary" />
          <Stat value={feed.stats.open_now} label={t('home.statOpen')} tone="sky" />
          <Stat value={feed.stats.drops} label={t('home.statDrops')} tone="sunset" />
        </div>

        {feed.speedDial.length === 0 ? (
          <div className="mt-4">
            <EmptyState
              glyph="📌"
              title={t('home.emptySpeedDial')}
              hint={t('home.speedDialHint')}
              action={
                <Link to="/onboarding">
                  <Button size="sm" className="mt-2">
                    {t('home.setupSpeedDial')}
                  </Button>
                </Link>
              }
            />
          </div>
        ) : (
          <div className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-4">
            {feed.speedDial.map((tile) => (
              <Link
                key={tile.id}
                to={`/m/${tile.slug}`}
                className="surface-raised flex flex-col gap-2 p-3 transition hover:border-primary/40"
              >
                <div className="flex items-start justify-between">
                  <Tile seed={tile.slug} label={tile.name} size={40} />
                  <Pill tone={tile.open_now ? 'open' : 'closed'} className="text-[10px]">
                    {tile.speed_dial_slot ?? '★'}
                  </Pill>
                </div>
                <div className="min-w-0">
                  <p className="truncate font-display text-sm font-bold">{tile.name}</p>
                  {tile.live_drop ? (
                    <p className="truncate text-[11px] text-sunset">
                      ⚡ {money(tile.live_drop.price_cents)} · {tile.live_drop.qty_left} {t('storefront.left')}
                    </p>
                  ) : (
                    <p className="truncate text-[11px] text-muted">{tile.pick}</p>
                  )}
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeader
          title={t('home.liveDrops')}
          action={
            <Link to="/explore" className="text-sm font-semibold text-primary">
              {t('nav.explore')} →
            </Link>
          }
        />
        {feed.liveDrops.length === 0 ? (
          <EmptyState title={t('home.noDrops')} />
        ) : (
          <div className="-mx-4 flex snap-x gap-3 overflow-x-auto px-4 pb-2">
            {feed.liveDrops.map((drop) => (
              <DropCard key={drop.id} drop={{ ...drop, item_id: drop.item_id }} />
            ))}
          </div>
        )}
      </section>

      {feed.deals.length ? (
        <section>
          <SectionHeader title={t('home.dealsNear')} />
          <div className="grid gap-2 sm:grid-cols-2">
            {feed.deals.map((deal) => (
              <Link
                key={deal.id}
                to={`/m/${deal.merchant_slug}`}
                className="surface-card flex items-center justify-between gap-3 p-3 transition hover:border-pink/40"
              >
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{deal.title}</p>
                  <p className="text-xs text-muted">{deal.merchant_name}</p>
                </div>
                <Pill tone="pink">{deal.type === 'percent' ? `${deal.value}%` : money(deal.value)}</Pill>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {feed.featured.length ? (
        <section>
          <SectionHeader title={t('home.featured')} />
          <div className="grid gap-3 sm:grid-cols-2">
            {feed.featured.map((merchant) => (
              <MerchantCard key={merchant.id} merchant={merchant} />
            ))}
          </div>
        </section>
      ) : null}

      <section>
        <SectionHeader title={t('home.openNow')} />
        <div className="grid gap-3 sm:grid-cols-2">
          {feed.openNow.map((merchant) => (
            <MerchantCard key={merchant.id} merchant={merchant} />
          ))}
        </div>
        {feed.openNow.length === 0 ? <EmptyState title={t('explore.noResults')} /> : null}
      </section>

      <p className="text-center text-xs text-muted">
        {t('app.tagline')} · {locale.toUpperCase()}
      </p>
    </div>
  )
}
