import { Link } from 'react-router-dom'
import { useI18n } from '../lib/i18n'
import { dayLabel, money, timeOfDay } from '../lib/format'
import { useOrders, useReorder } from '../lib/queries'
import { OrderTracker } from '../components/OrderTracker'
import { Button, Card, EmptyState, ErrorState, Pill, Skeleton } from '../components/ui'

export function OrdersPage() {
  const { t, locale } = useI18n()
  const orders = useOrders()
  const reorder = useReorder()

  if (orders.isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24" />
        <Skeleton className="h-24" />
      </div>
    )
  }
  if (orders.error) {
    return <ErrorState message={t('common.errorTitle')} onRetry={() => orders.refetch()} retryLabel={t('common.retry')} />
  }

  const list = orders.data?.orders ?? []

  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <h1 className="font-display text-2xl font-bold tracking-tight">{t('orders.title')}</h1>

      {list.length === 0 ? (
        <EmptyState
          glyph="🧾"
          title={t('orders.empty')}
          action={
            <Link to="/explore">
              <Button size="sm" className="mt-2">
                {t('nav.explore')}
              </Button>
            </Link>
          }
        />
      ) : (
        list.map((order) => (
          <Card key={order.id} className="space-y-3">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <Link to={`/orders/${order.id}`} className="font-display text-base font-bold hover:text-primary">
                  {order.merchant_name}
                </Link>
                <p className="font-mono text-[11px] text-muted">
                  {order.code} · {dayLabel(order.created_at, locale)} {timeOfDay(order.created_at, locale)}
                </p>
              </div>
              <div className="text-right">
                <Pill tone={order.status === 'cancelled' ? 'closed' : order.status === 'picked_up' ? 'open' : 'sunset'}>
                  {t(`orders.status.${order.status}`)}
                </Pill>
                <p className="mt-1 font-mono text-sm">{money(order.total_cents)}</p>
              </div>
            </div>

            <OrderTracker tracker={order.tracker} compact />

            <p className="text-xs text-muted">
              {order.item_count} {t('orders.items')} ·{' '}
              {(order.items ?? []).slice(0, 3).map((item) => item.name).join(', ')}
              {(order.items?.length ?? 0) > 3 ? '…' : ''}
            </p>

            <div className="flex flex-wrap gap-2">
              <Link to={`/orders/${order.id}`}>
                <Button size="sm" variant="surface">
                  {t('orders.tracker')}
                </Button>
              </Link>
              <Button
                size="sm"
                variant="ghost"
                disabled={reorder.isPending}
                onClick={() => reorder.mutate(order.id, { onSuccess: () => undefined })}
              >
                {t('common.reorder')}
              </Button>
              {reorder.isSuccess ? <Pill tone="open">{t('storefront.added')}</Pill> : null}
            </div>
          </Card>
        ))
      )}
    </div>
  )
}
