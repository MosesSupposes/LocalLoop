import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { motion } from 'framer-motion'
import { useI18n } from '../lib/i18n'
import { useConfig, useNearby, useSearch, type NearbyFilters } from '../lib/queries'
import { useUI } from '../lib/store'
import { NeonMap } from '../components/NeonMap'
import { MerchantCard } from '../components/MerchantCard'
import { Button, Chip, EmptyState, ErrorState, Skeleton, cx } from '../components/ui'

const RADII = [800, 1600, 3000, 6000]

export function ExplorePage() {
  const { t, locale } = useI18n()
  const config = useConfig()
  const location = useUI((s) => s.location)
  const setLocation = useUI((s) => s.setLocation)
  const radiusM = useUI((s) => s.radiusM)
  const setRadius = useUI((s) => s.setRadius)
  const [filters, setFilters] = useState<NearbyFilters>({ openNow: false, deals: false, pickup: false, category: null })
  const [term, setTerm] = useState('')
  const [sheet, setSheet] = useState<'peek' | 'half' | 'full'>('half')
  const [selectedId, setSelectedId] = useState<string | null>(null)

  const nearby = useNearby(filters)
  const search = useSearch(term)

  const merchants = useMemo(() => nearby.data?.merchants ?? [], [nearby.data])

  function toggle(key: 'openNow' | 'deals' | 'pickup') {
    setFilters((prev) => ({ ...prev, [key]: !prev[key] }))
  }

  const sheetHeight = sheet === 'peek' ? 'h-24' : sheet === 'half' ? 'h-[46vh]' : 'h-[80vh]'

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-2xl font-bold tracking-tight">{t('explore.title')}</h1>
        <input
          type="search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          placeholder={t('common.search')}
          className="min-h-11 w-full rounded-full border border-line bg-surface px-4 text-sm sm:w-64"
        />
      </div>

      <div className="flex snap-x gap-2 overflow-x-auto pb-1">
        <Chip active={filters.openNow} onClick={() => toggle('openNow')}>
          🕒 {t('explore.openOnly')}
        </Chip>
        <Chip active={filters.deals} onClick={() => toggle('deals')}>
          🏷 {t('explore.dealsOnly')}
        </Chip>
        <Chip active={filters.pickup} onClick={() => toggle('pickup')}>
          🥡 {t('explore.pickupOnly')}
        </Chip>
        {(config.data?.categories ?? []).map((category) => (
          <Chip
            key={category.key}
            active={filters.category === category.key}
            onClick={() => setFilters((prev) => ({ ...prev, category: prev.category === category.key ? null : category.key }))}
          >
            {category.glyph} {locale === 'es' ? category.labelEs : category.labelEn}
          </Chip>
        ))}
      </div>

      <div className="flex items-center gap-2 text-xs text-muted">
        <span>{t('explore.radius')}</span>
        {RADII.map((radius) => (
          <button
            key={radius}
            type="button"
            onClick={() => setRadius(radius)}
            className={cx(
              'min-h-9 rounded-full border px-3 font-mono text-xs',
              radiusM === radius ? 'border-primary bg-primary/15 text-primary' : 'border-line',
            )}
          >
            {radius >= 1000 ? `${radius / 1000}km` : `${radius}m`}
          </button>
        ))}
        <span className="ml-auto font-mono">
          {merchants.length} {t('explore.results')}
        </span>
      </div>

      {search.data && term.trim().length > 1 ? (
        <div className="surface-card space-y-2 p-3">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted">{t('common.search')}</p>
          {search.data.merchants.map((merchant) => (
            <Link
              key={merchant.id}
              to={`/m/${merchant.slug}`}
              className="block w-full text-left text-sm"
              onClick={() => setTerm('')}
            >
              {merchant.name} <span className="text-muted">· {merchant.category}</span>
            </Link>
          ))}
          {search.data.items.map((item) => (
            <Link
              key={item.id}
              to={`/m/${item.merchant_slug}`}
              className="block w-full text-left text-sm"
              onClick={() => setTerm('')}
            >
              {item.name} <span className="text-muted">· {item.merchant_name}</span>
            </Link>
          ))}
          {search.data.merchants.length + search.data.items.length === 0 ? (
            <p className="text-sm text-muted">{t('explore.noResults')}</p>
          ) : null}
        </div>
      ) : null}

      {nearby.isLoading ? (
        <Skeleton className="h-[58vh] min-h-[360px]" />
      ) : nearby.error ? (
        <ErrorState message={t('common.errorTitle')} onRetry={() => nearby.refetch()} retryLabel={t('common.retry')} />
      ) : (
        <NeonMap
          merchants={merchants}
          center={location}
          span={radiusM * 2}
          selectedId={selectedId}
          onSelect={(id) => {
            setSelectedId(id)
            setSheet('half')
          }}
          onPan={(center) => setLocation({ ...center, label: location.label })}
        />
      )}

      <motion.section
        layout
        drag="y"
        dragConstraints={{ top: 0, bottom: 0 }}
        dragElastic={0.12}
        onDragEnd={(_event, info) => {
          if (info.offset.y < -40) setSheet(sheet === 'peek' ? 'half' : 'full')
          else if (info.offset.y > 40) setSheet(sheet === 'full' ? 'half' : 'peek')
        }}
        className={cx(
          'surface-card overflow-hidden p-3 transition-[height] duration-300',
          sheetHeight,
        )}
      >
        <div className="mx-auto mb-2 h-1.5 w-12 rounded-full bg-surface-raised" aria-hidden />
        <div className="mb-2 flex items-center justify-between">
          <h2 className="font-display text-base font-bold">{t('explore.listSheet')}</h2>
          <div className="flex gap-1">
            {(['peek', 'half', 'full'] as const).map((state) => (
              <button
                key={state}
                type="button"
                onClick={() => setSheet(state)}
                aria-label={state}
                className={cx('h-6 w-6 rounded-full border text-[10px]', sheet === state ? 'border-primary text-primary' : 'border-line text-muted')}
              >
                {state === 'peek' ? '▁' : state === 'half' ? '▄' : '█'}
              </button>
            ))}
          </div>
        </div>
        <div className="h-[calc(100%-3.5rem)] space-y-2 overflow-y-auto pr-1">
          {merchants.length === 0 ? (
            <EmptyState title={t('explore.noResults')} />
          ) : (
            merchants.map((merchant) => (
              <div key={merchant.id} className={cx(selectedId === merchant.id && 'rounded-card ring-1 ring-primary')}>
                <MerchantCard merchant={merchant} />
              </div>
            ))
          )}
        </div>
      </motion.section>

      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={() => setFilters({ openNow: false, deals: false, pickup: false, category: null })}>
          {t('common.clear')}
        </Button>
      </div>
    </div>
  )
}
