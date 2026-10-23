import { useState } from 'react'
import { useI18n } from '../lib/i18n'
import { money } from '../lib/format'
import { errorMessage } from '../lib/api'
import {
  useAdminAudit,
  useAdminMerchants,
  useAdminNeighborhoods,
  useAdminOverview,
  useCreateNeighborhood,
  useFeatureMerchant,
  useMerchantStatusAction,
  useRefundOrder,
} from '../lib/queries'
import { Badge, Button, Banner, Card, EmptyState, ErrorState, Field, Pill, SectionHeader, Skeleton } from '../components/ui'

export function AdminPage() {
  const { t } = useI18n()
  const overview = useAdminOverview()
  const pending = useAdminMerchants('pending')
  const allMerchants = useAdminMerchants()
  const neighborhoods = useAdminNeighborhoods()
  const audit = useAdminAudit()
  const statusAction = useMerchantStatusAction()
  const feature = useFeatureMerchant()
  const refund = useRefundOrder()
  const createNeighborhood = useCreateNeighborhood()
  const [form, setForm] = useState({ name: '', city: 'Los Angeles', lat: '34.0783', lng: '-118.2605', radiusM: '1600' })

  if (overview.isLoading) return <Skeleton className="h-64" />
  if (overview.error || !overview.data) {
    return <ErrorState message={t('common.errorTitle')} onRetry={() => overview.refetch()} retryLabel={t('common.retry')} />
  }

  const { summary, topMerchants, recentOrders } = overview.data as typeof overview.data & {
    recentOrders: { id: string; code: string; status: string; total_cents: number; created_at: string; payment_status: string; merchant_name: string; neighbor_name: string }[]
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight">{t('admin.title')}</h1>
        <p className="text-sm text-muted">{t('app.tagline')}</p>
      </header>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Metric label={t('admin.gmv')} value={money(summary.gmv_cents)} tone="primary" />
        <Metric label={t('admin.platformRevenue')} value={money(summary.platform_revenue_cents)} tone="sunset" />
        <Metric label={t('admin.ordersToday')} value={String(summary.orders_today)} />
        <Metric label={t('admin.people')} value={String(summary.people)} />
        <Metric label={t('home.statMerchants')} value={String(summary.live_merchants)} />
        <Metric label={t('admin.liveDrops')} value={String(summary.live_drops)} />
        <Metric label={t('admin.neighborhoods')} value={String(summary.neighborhoods)} />
        <Metric label={t('merchant.payouts')} value={String(summary.orders_total)} />
      </div>

      <section>
        <SectionHeader title={t('admin.pending')} />
        {pending.isLoading ? <Skeleton className="h-24" /> : null}
        {(pending.data?.merchants ?? []).length === 0 ? (
          <EmptyState title={t('admin.noPending')} />
        ) : (
          <div className="space-y-2">
            {pending.data!.merchants.map((merchant) => (
              <Card key={merchant.id} className="flex flex-wrap items-center justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{merchant.name}</p>
                  <p className="text-xs text-muted">
                    {merchant.category} · {merchant.address} · {merchant.owner_name}
                  </p>
                </div>
                <div className="flex gap-2">
                  <Button size="sm" disabled={statusAction.isPending} onClick={() => statusAction.mutate({ id: merchant.id, status: 'live' })}>
                    {t('admin.approve')}
                  </Button>
                  <Button
                    size="sm"
                    variant="danger"
                    disabled={statusAction.isPending}
                    onClick={() => statusAction.mutate({ id: merchant.id, status: 'paused' })}
                  >
                    {t('admin.pause')}
                  </Button>
                </div>
              </Card>
            ))}
          </div>
        )}
      </section>

      <section>
        <SectionHeader title={t('admin.topMerchants')} />
        <Card className="divide-y divide-line p-0">
          {topMerchants.map((merchant) => (
            <div key={merchant.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{merchant.name}</p>
                <p className="font-mono text-xs text-muted">
                  {money(merchant.revenue_cents)} · {merchant.orders} orders · {merchant.status}
                </p>
              </div>
              <div className="flex items-center gap-2">
                {merchant.featured ? <Pill tone="pink">featured</Pill> : null}
                <Button
                  size="sm"
                  variant="surface"
                  disabled={feature.isPending}
                  onClick={() => feature.mutate({ id: merchant.id, featured: !merchant.featured })}
                >
                  {merchant.featured ? t('admin.unfeature') : t('admin.feature')}
                </Button>
              </div>
            </div>
          ))}
        </Card>
      </section>

      <section>
        <SectionHeader title={t('orders.title')} />
        <Card className="divide-y divide-line p-0">
          {recentOrders.map((order) => (
            <div key={order.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-2.5">
              <div className="min-w-0">
                <p className="font-mono text-sm font-semibold">{order.code}</p>
                <p className="truncate text-xs text-muted">
                  {order.merchant_name} · {order.neighbor_name} · {order.status} · {order.payment_status}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <span className="font-mono text-sm">{money(order.total_cents)}</span>
                {order.payment_status === 'paid' ? (
                  <Button size="sm" variant="danger" disabled={refund.isPending} onClick={() => refund.mutate(order.id)}>
                    {t('admin.refund')}
                  </Button>
                ) : (
                  <Badge>{order.payment_status}</Badge>
                )}
              </div>
            </div>
          ))}
          {recentOrders.length === 0 ? <p className="px-4 py-3 text-sm text-muted">—</p> : null}
        </Card>
        {refund.error ? <Banner tone="sunset">{errorMessage(refund.error)}</Banner> : null}
      </section>

      <section className="grid gap-4 sm:grid-cols-2">
        <div>
          <SectionHeader title={t('admin.neighborhoods')} />
          <Card className="space-y-2">
            {(neighborhoods.data?.neighborhoods ?? []).map((hood) => (
              <div key={hood.id} className="flex items-center justify-between gap-2 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{hood.name}</p>
                  <p className="text-xs text-muted">{hood.city}</p>
                </div>
                <span className="font-mono text-xs text-muted">
                  {hood.live_count}/{hood.merchant_count}
                </span>
              </div>
            ))}
            <div className="space-y-2 border-t border-line pt-3">
              <Field label={t('admin.newNeighborhood')} value={form.name} onChange={(event) => setForm((prev) => ({ ...prev, name: event.target.value }))} />
              <div className="grid grid-cols-3 gap-2">
                <Field label="lat" value={form.lat} onChange={(event) => setForm((prev) => ({ ...prev, lat: event.target.value }))} />
                <Field label="lng" value={form.lng} onChange={(event) => setForm((prev) => ({ ...prev, lng: event.target.value }))} />
                <Field label="m" value={form.radiusM} onChange={(event) => setForm((prev) => ({ ...prev, radiusM: event.target.value }))} />
              </div>
              <Button
                size="sm"
                disabled={form.name.length < 2 || createNeighborhood.isPending}
                onClick={() =>
                  createNeighborhood.mutate(
                    {
                      name: form.name,
                      city: form.city,
                      lat: Number(form.lat),
                      lng: Number(form.lng),
                      radiusM: Number(form.radiusM),
                    },
                    { onSuccess: () => setForm((prev) => ({ ...prev, name: '' })) },
                  )
                }
              >
                {t('common.add')}
              </Button>
              {createNeighborhood.error ? <Banner tone="sunset">{errorMessage(createNeighborhood.error)}</Banner> : null}
            </div>
          </Card>
        </div>

        <div>
          <SectionHeader title={t('admin.audit')} />
          <Card className="max-h-80 space-y-1.5 overflow-y-auto">
            {(audit.data?.entries ?? []).map((entry) => (
              <div key={entry.id} className="text-xs">
                <p className="font-mono text-primary">{entry.action}</p>
                <p className="text-muted">
                  {entry.entity} · {entry.actor_name ?? 'system'}
                </p>
              </div>
            ))}
            {(audit.data?.entries.length ?? 0) === 0 ? <p className="text-sm text-muted">—</p> : null}
          </Card>
        </div>
      </section>

      <section>
        <SectionHeader title={t('nav.merchant')} />
        <Card className="divide-y divide-line p-0">
          {(allMerchants.data?.merchants ?? []).map((merchant) => (
            <div key={merchant.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
              <div className="min-w-0">
                <p className="truncate font-semibold">{merchant.name}</p>
                <p className="text-xs text-muted">
                  {merchant.owner_name} · {merchant.category} · {merchant.item_count} items
                </p>
              </div>
              <Pill tone={merchant.status === 'live' ? 'open' : merchant.status === 'pending' ? 'sunset' : 'closed'}>
                {merchant.status}
              </Pill>
            </div>
          ))}
        </Card>
      </section>
    </div>
  )
}

function Metric({ label, value, tone }: { label: string; value: string; tone?: 'primary' | 'sunset' }) {
  return (
    <div className="surface-card px-3 py-2.5">
      <p className={'font-mono text-lg font-bold ' + (tone === 'primary' ? 'text-primary' : tone === 'sunset' ? 'text-sunset' : '')}>
        {value}
      </p>
      <p className="text-xs text-muted">{label}</p>
    </div>
  )
}
