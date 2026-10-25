import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '../lib/i18n'
import { money, timeOfDay } from '../lib/format'
import { errorMessage } from '../lib/api'
import { useUI } from '../lib/store'
import {
  useAnalytics,
  useConfig,
  useCreateMerchant,
  useDealCopy,
  useMerchantContext,
  useMerchantOrders,
  usePayouts,
  usePatchMerchant,
  useStripeConnect,
  useOrderAction,
} from '../lib/queries'
import { MenuEditor } from '../components/merchant/MenuEditor'
import { MarketingPanel } from '../components/merchant/MarketingPanel'
import { HoursEditor } from '../components/merchant/HoursEditor'
import { Banner, Button, Card, EmptyState, ErrorState, Field, Pill, SectionHeader, Select, Skeleton, cx } from '../components/ui'

type Tab = 'queue' | 'menu' | 'marketing' | 'hours' | 'analytics' | 'payouts'

/** Short beep when a new order lands, so a busy counter does not need eyes on the screen. */
function useOrderChime(count: number) {
  const previous = useRef(count)
  useEffect(() => {
    if (count > previous.current) {
      try {
        const AudioContextClass = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext
        const ctx = new AudioContextClass()
        const osc = ctx.createOscillator()
        const gain = ctx.createGain()
        osc.frequency.value = 880
        gain.gain.value = 0.05
        osc.connect(gain).connect(ctx.destination)
        osc.start()
        setTimeout(() => {
          osc.stop()
          void ctx.close()
        }, 180)
      } catch {
        /* audio is a nicety, never a blocker */
      }
    }
    previous.current = count
  }, [count])
}

export function MerchantDashboardPage() {
  const { t, locale } = useI18n()
  const user = useUI((s) => s.user)
  const config = useConfig()
  const context = useMerchantContext()
  const [shopId, setShopId] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('queue')
  const [statusFilter, setStatusFilter] = useState<'open' | 'done'>('open')

  const merchants = context.data?.merchants ?? []
  const activeShop = useMemo(
    () => merchants.find((merchant) => merchant.id === shopId) ?? merchants[0],
    [merchants, shopId],
  )

  const orders = useMerchantOrders(activeShop?.id, statusFilter)
  const action = useOrderAction(activeShop?.id)
  const patchMerchant = usePatchMerchant(activeShop?.id)
  const analytics = useAnalytics(activeShop?.id, tab === 'analytics')
  const payouts = usePayouts(activeShop?.id, tab === 'payouts')
  const stripeConnect = useStripeConnect(activeShop?.id)
  const dealCopy = useDealCopy(activeShop?.id)
  const createMerchant = useCreateMerchant()

  useOrderChime((orders.data?.orders ?? []).filter((order) => order.status === 'placed').length)

  const [shopForm, setShopForm] = useState({
    name: '',
    category: config.data?.categories[0]?.key ?? 'tacos',
    address: '',
    phone: '',
    description: '',
  })

  if (!user) {
    return <EmptyState glyph="🧑‍🍳" title={t('cart.needsSignIn')} hint={t('onboarding.signInHint')} />
  }
  if (context.isLoading) return <Skeleton className="h-48" />
  if (context.error) {
    return <ErrorState message={t('common.errorTitle')} onRetry={() => context.refetch()} retryLabel={t('common.retry')} />
  }

  if (merchants.length === 0) {
    return (
      <div className="mx-auto max-w-xl space-y-4">
        <h1 className="font-display text-2xl font-bold tracking-tight">{t('merchant.openStorefront')}</h1>
        <Card className="space-y-3">
          <Field
            label={t('merchant.shopName')}
            value={shopForm.name}
            onChange={(event) => setShopForm((prev) => ({ ...prev, name: event.target.value }))}
          />
          <Select
            label={t('merchant.shopCategory')}
            value={shopForm.category}
            onChange={(event) => setShopForm((prev) => ({ ...prev, category: event.target.value }))}
          >
            {(config.data?.categories ?? []).map((category) => (
              <option key={category.key} value={category.key}>
                {locale === 'es' ? category.labelEs : category.labelEn}
              </option>
            ))}
          </Select>
          <Field
            label={t('merchant.shopAddress')}
            value={shopForm.address}
            onChange={(event) => setShopForm((prev) => ({ ...prev, address: event.target.value }))}
          />
          <Field
            label={t('merchant.shopPhone')}
            value={shopForm.phone}
            onChange={(event) => setShopForm((prev) => ({ ...prev, phone: event.target.value }))}
            placeholder="+12135550123"
          />
          <Field
            label={t('merchant.itemDescription')}
            value={shopForm.description}
            onChange={(event) => setShopForm((prev) => ({ ...prev, description: event.target.value }))}
          />
          <Button
            full
            disabled={createMerchant.isPending || shopForm.name.length < 2 || shopForm.address.length < 4 || shopForm.phone.length < 7}
            onClick={() =>
              createMerchant.mutate(
                {
                  ...shopForm,
                  lat: useUI.getState().location.lat,
                  lng: useUI.getState().location.lng,
                },
                { onSuccess: () => context.refetch() },
              )
            }
          >
            {t('merchant.openStorefront')}
          </Button>
          {createMerchant.error ? <Banner tone="sunset">{errorMessage(createMerchant.error)}</Banner> : null}
          <p className="text-xs text-muted">{t('merchant.pendingNotice')}</p>
        </Card>
      </div>
    )
  }

  const tabs: Tab[] = ['queue', 'menu', 'marketing', 'hours', 'analytics', 'payouts']

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-xs uppercase tracking-wide text-muted">{t('merchant.title')}</p>
          <h1 className="font-display text-2xl font-bold tracking-tight">{activeShop?.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-2">
            <Pill tone={activeShop?.open_now ? 'open' : 'closed'}>
              {activeShop?.open_now ? t('common.open') : t('common.closed')}
            </Pill>
            <Pill tone={activeShop?.status === 'live' ? 'sky' : 'closed'}>{activeShop?.status}</Pill>
            <span className="font-mono text-xs text-muted">{activeShop?.open_orders ?? 0} {t('merchant.openOrders')}</span>
          </div>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {activeShop?.status === 'live' ? (
            <Button variant="surface" size="sm" onClick={() => patchMerchant.mutate({ status: 'paused' })}>
              {t('merchant.pauseShop')}
            </Button>
          ) : activeShop?.status === 'paused' ? (
            <Button variant="surface" size="sm" onClick={() => patchMerchant.mutate({ status: 'live' })}>
              {t('merchant.resumeShop')}
            </Button>
          ) : null}
          <Link to={`/m/${activeShop?.slug}`}>
            <Button variant="ghost" size="sm">
              {t('storefront.menu')} →
            </Button>
          </Link>
        </div>
      </header>

      {merchants.length > 1 ? (
        <div className="flex flex-wrap gap-2" role="tablist" aria-label={t('merchant.chooseShop')}>
          {merchants.map((merchant) => {
            const active = merchant.id === activeShop?.id
            return (
              <button
                key={merchant.id}
                type="button"
                role="tab"
                aria-selected={active}
                onClick={() => setShopId(merchant.id)}
                className={cx(
                  'flex min-h-11 items-center gap-2 rounded-2xl border px-3.5 text-sm font-semibold transition',
                  active ? 'border-primary bg-primary/15 text-primary' : 'border-line bg-surface text-muted',
                )}
              >
                {merchant.name}
                {merchant.open_orders > 0 ? (
                  <span className="rounded-full bg-sunset/20 px-2 font-mono text-xs text-sunset">{merchant.open_orders}</span>
                ) : null}
              </button>
            )
          })}
        </div>
      ) : null}

      {activeShop?.status === 'pending' ? <Banner tone="sky">{t('merchant.pendingNotice')}</Banner> : null}

      <nav className="flex snap-x gap-2 overflow-x-auto pb-1">
        {tabs.map((entry) => (
          <button
            key={entry}
            type="button"
            onClick={() => setTab(entry)}
            className={cx(
              'min-h-11 shrink-0 rounded-full border px-4 text-sm font-semibold transition',
              tab === entry ? 'border-primary bg-primary/15 text-primary' : 'border-line bg-surface text-muted',
            )}
          >
            {t(`merchant.${entry === 'queue' ? 'queue' : entry}`)}
          </button>
        ))}
      </nav>

      {tab === 'queue' ? (
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <SectionHeader title={t('merchant.queue')} />
            <div className="flex gap-2">
              {(['open', 'done'] as const).map((filter) => (
                <button
                  key={filter}
                  type="button"
                  onClick={() => setStatusFilter(filter)}
                  className={cx(
                    'min-h-9 rounded-full border px-3 text-xs font-semibold',
                    statusFilter === filter ? 'border-primary text-primary' : 'border-line text-muted',
                  )}
                >
                  {filter === 'open' ? t('merchant.openOrders') : t('orders.status.picked_up')}
                </button>
              ))}
            </div>
          </div>

          {orders.isLoading ? <Skeleton className="h-32" /> : null}
          {orders.data?.orders.length === 0 ? <EmptyState glyph="🍳" title={t('merchant.noOrders')} /> : null}

          {orders.data?.orders.map((order) => (
            <Card key={order.id} className="space-y-3">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-mono text-sm font-bold">{order.code}</p>
                  <p className="text-xs text-muted">
                    {order.neighbor_name} · {timeOfDay(order.created_at, locale)} · {money(order.total_cents)}
                  </p>
                </div>
                <Pill tone={order.status === 'placed' ? 'sunset' : order.status === 'ready' ? 'open' : 'sky'}>
                  {t(`orders.status.${order.status}`)}
                </Pill>
              </div>

              <ul className="space-y-1 text-sm">
                {order.items.map((item, index) => (
                  <li key={`${order.id}-${index}`} className="flex justify-between gap-3">
                    <span>
                      {item.qty}× {item.name}
                      {Array.isArray(item.options) && item.options.length
                        ? ` (${(item.options as { name: string }[]).map((option) => option.name).join(', ')})`
                        : ''}
                    </span>
                    <span className="font-mono text-muted">{money(item.qty * item.price_cents)}</span>
                  </li>
                ))}
              </ul>

              {order.note ? <Banner tone="muted">{order.note}</Banner> : null}

              {order.payment_provider === 'bitcoin' && order.payment_status !== 'paid' ? (
                <div>
                  <Pill tone="sunset">₿ {t('merchant.awaitingBitcoin')}</Pill>
                </div>
              ) : null}

              <div className="flex flex-wrap gap-2">
                {order.status === 'placed' ? (
                  <Button size="lg" variant="primary" onClick={() => action.mutate({ orderId: order.id, action: 'accept' })}>
                    ✓ {t('merchant.accept')}
                  </Button>
                ) : null}
                {order.status === 'accepted' ? (
                  <Button size="lg" variant="sunset" onClick={() => action.mutate({ orderId: order.id, action: 'ready' })}>
                    🔔 {t('merchant.markReady')}
                  </Button>
                ) : null}
                {order.status === 'ready' ? (
                  <Button size="lg" onClick={() => action.mutate({ orderId: order.id, action: 'picked-up' })}>
                    🤝 {t('merchant.markPickedUp')}
                  </Button>
                ) : null}
                {['placed', 'accepted'].includes(order.status) ? (
                  <Button variant="danger" size="lg" onClick={() => action.mutate({ orderId: order.id, action: 'cancel' })}>
                    {t('merchant.cancel')}
                  </Button>
                ) : null}
              </div>
            </Card>
          ))}
          {action.error ? <Banner tone="sunset">{errorMessage(action.error)}</Banner> : null}
        </section>
      ) : null}

      {tab === 'menu' ? <MenuEditor merchantId={activeShop!.id} /> : null}

      {tab === 'marketing' ? (
        <MarketingPanel
          merchantId={activeShop!.id}
          generateCopy={(discount, itemName) =>
            dealCopy.mutateAsync({ discount, itemName }).then((data) => data.copy)
          }
        />
      ) : null}

      {tab === 'hours' ? (
        <HoursEditor
          hours={activeShop?.hours}
          onSave={(hours) => patchMerchant.mutate({ hours })}
          saving={patchMerchant.isPending}
        />
      ) : null}

      {tab === 'analytics' ? (
        <section className="space-y-4">
          {analytics.isLoading ? <Skeleton className="h-40" /> : null}
          {analytics.data ? (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Metric label={t('merchant.revenue7d')} value={money(analytics.data.summary.revenue_7d ?? 0)} />
                <Metric label={t('merchant.orders7d')} value={String(analytics.data.summary.orders_7d ?? 0)} />
                <Metric label={t('merchant.payout7d')} value={money(analytics.data.summary.payout_7d ?? 0)} />
                <Metric label={t('merchant.speedDialAdds')} value={String(analytics.data.summary.speed_dial_adds ?? 0)} />
              </div>

              <Card>
                <SectionHeader title={t('merchant.dailyRevenue')} />
                <div className="flex h-32 items-end gap-1">
                  {analytics.data.daily.map((day) => {
                    const max = Math.max(...analytics.data!.daily.map((entry) => entry.revenue_cents), 1)
                    return (
                      <div key={day.day} className="flex flex-1 flex-col items-center gap-1">
                        <div
                          className="w-full rounded-t-md"
                          style={{
                            height: `${Math.max(4, (day.revenue_cents / max) * 100)}%`,
                            background: 'var(--gradient-sunset)',
                          }}
                          title={`${day.day}: ${money(day.revenue_cents)}`}
                        />
                        <span className="font-mono text-[9px] text-muted">{day.day.slice(8)}</span>
                      </div>
                    )
                  })}
                </div>
              </Card>

              <Card>
                <SectionHeader title={t('merchant.topItems')} />
                {analytics.data.topItems.length === 0 ? (
                  <p className="text-sm text-muted">—</p>
                ) : (
                  <ul className="space-y-1.5">
                    {analytics.data.topItems.map((item) => (
                      <li key={item.name} className="flex items-center justify-between gap-3 text-sm">
                        <span className="truncate">{item.name}</span>
                        <span className="font-mono text-muted">
                          {item.qty} · {money(item.revenue_cents)}
                        </span>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
            </>
          ) : null}
        </section>
      ) : null}

      {tab === 'payouts' ? (
        <section className="space-y-4">
          <Card className="space-y-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-display text-base font-bold">{t('merchant.payouts')}</p>
                <p className="text-xs text-muted">{payouts.data?.note ?? t('merchant.payoutSimulated')}</p>
              </div>
              <Pill tone={payouts.data?.connected ? 'open' : 'closed'}>{payouts.data?.mode ?? '—'}</Pill>
            </div>
            <Button
              size="sm"
              variant="surface"
              disabled={stripeConnect.isPending}
              onClick={() => stripeConnect.mutate()}
            >
              {t('merchant.connectStripe')}
            </Button>
            {stripeConnect.data?.message ? <Banner tone="muted">{stripeConnect.data.message}</Banner> : null}
            {stripeConnect.data?.onboardingUrl ? (
              <a href={stripeConnect.data.onboardingUrl} target="_blank" rel="noreferrer" className="text-sm font-semibold text-primary">
                Stripe onboarding →
              </a>
            ) : null}
          </Card>

          <Card className="divide-y divide-line p-0">
            {(payouts.data?.rows ?? []).map((row) => (
              <div key={row.day} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <span className="font-mono text-muted">{row.day}</span>
                <span className="font-mono">{money(row.payout_cents)}</span>
              </div>
            ))}
            {(payouts.data?.rows.length ?? 0) === 0 ? <p className="px-4 py-3 text-sm text-muted">—</p> : null}
          </Card>
        </section>
      ) : null}
    </div>
  )
}

function Metric({ label, value }: { label: string; value: string }) {
  return (
    <div className="surface-card px-3 py-2.5">
      <p className="font-mono text-lg font-bold">{value}</p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  )
}
