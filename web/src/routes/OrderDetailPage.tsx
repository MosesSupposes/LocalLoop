import { Link, useParams } from 'react-router-dom'
import { useState } from 'react'
import { useI18n } from '../lib/i18n'
import { dayLabel, money, timeOfDay } from '../lib/format'
import { useCancelOrder, useOrder, useReviewOrder } from '../lib/queries'
import { errorMessage } from '../lib/api'
import { OrderTracker } from '../components/OrderTracker'
import { Banner, Button, Card, ErrorState, Pill, Skeleton } from '../components/ui'

export function OrderDetailPage() {
  const { id } = useParams<{ id: string }>()
  const { t, locale } = useI18n()
  const order = useOrder(id)
  const cancelOrder = useCancelOrder()
  const reviewOrder = useReviewOrder()
  const [rating, setRating] = useState(0)
  const [reviewBody, setReviewBody] = useState('')

  if (order.isLoading) return <Skeleton className="h-64" />
  if (order.error || !order.data) {
    return <ErrorState message={t('common.errorTitle')} onRetry={() => order.refetch()} retryLabel={t('common.retry')} />
  }

  const record = order.data.order
  const canCancel = ['placed', 'accepted'].includes(record.status)
  const canReview = ['picked_up', 'delivered'].includes(record.status)

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="font-mono text-xs text-muted">{record.code}</p>
          <h1 className="font-display text-2xl font-bold tracking-tight">{record.merchant_name}</h1>
          <p className="text-xs text-muted">
            {dayLabel(record.created_at, locale)} · {timeOfDay(record.created_at, locale)}
          </p>
        </div>
        <Pill tone={record.status === 'cancelled' ? 'closed' : record.status === 'picked_up' ? 'open' : 'sunset'}>
          {t(`orders.status.${record.status}`)}
        </Pill>
      </header>

      <Card className="space-y-3">
        <h2 className="text-sm font-semibold text-muted">{t('orders.tracker')}</h2>
        <OrderTracker tracker={record.tracker} />
        {record.pickup_eta && !record.tracker.cancelled ? (
          <p className="font-mono text-xs text-muted">
            {t('orders.eta')} {timeOfDay(record.pickup_eta, locale)}
          </p>
        ) : null}
      </Card>

      <Card className="space-y-2">
        {record.items.map((line, index) => (
          <div key={`${line.name}-${index}`} className="flex items-center justify-between gap-3 text-sm">
            <span className="min-w-0 truncate">
              {line.qty}× {line.name}
            </span>
            <span className="font-mono">{money(line.qty * line.price_cents)}</span>
          </div>
        ))}
        <div className="space-y-1 border-t border-line pt-2 text-sm">
          <div className="flex justify-between">
            <span className="text-muted">{t('common.subtotal')}</span>
            <span className="font-mono">{money(record.subtotal_cents)}</span>
          </div>
          {record.discount_cents ? (
            <div className="flex justify-between text-sunset">
              <span>{t('common.discount')}</span>
              <span className="font-mono">−{money(record.discount_cents)}</span>
            </div>
          ) : null}
          <div className="flex justify-between">
            <span className="text-muted">{t('common.serviceFee')}</span>
            <span className="font-mono">{money(record.service_fee_cents ?? 0)}</span>
          </div>
          <div className="flex justify-between">
            <span className="text-muted">{t('common.tip')}</span>
            <span className="font-mono">{money(record.tip_cents ?? 0)}</span>
          </div>
          <div className="flex justify-between border-t border-line pt-1 text-base font-bold">
            <span>{t('common.total')}</span>
            <span className="font-mono">{money(record.total_cents)}</span>
          </div>
          <p className="text-xs text-muted">
            {record.payment_status === 'paid' ? '✓ paid' : record.payment_status} · {record.fulfillment}
          </p>
        </div>
      </Card>

      <div className="flex flex-wrap gap-2">
        {record.merchant_phone ? (
          <a href={`tel:${record.merchant_phone}`}>
            <Button variant="surface" size="sm">
              📞 {t('common.call')}
            </Button>
          </a>
        ) : null}
        <Link to={`/m/${record.merchant_slug}`}>
          <Button variant="surface" size="sm">
            {t('common.reorder')}
          </Button>
        </Link>
        {canCancel ? (
          <Button
            variant="danger"
            size="sm"
            disabled={cancelOrder.isPending}
            onClick={() => cancelOrder.mutate({ id: record.id, reason: 'changed my mind' })}
          >
            {t('orders.cancelOrder')}
          </Button>
        ) : null}
      </div>

      {record.status === 'cancelled' && record.cancel_reason ? (
        <Banner tone="muted">
          {t('orders.cancelled')} · {record.cancel_reason}
        </Banner>
      ) : null}

      {canReview ? (
        <Card className="space-y-3">
          <h2 className="font-display text-base font-bold">{t('common.review')}</h2>
          <div className="flex gap-2">
            {[1, 2, 3, 4, 5].map((star) => (
              <button
                key={star}
                type="button"
                aria-label={`${star}`}
                onClick={() => setRating(star)}
                className={'min-h-11 min-w-11 rounded-full border text-lg ' + (rating >= star ? 'border-warning text-warning' : 'border-line text-muted')}
              >
                ★
              </button>
            ))}
          </div>
          <textarea
            value={reviewBody}
            onChange={(event) => setReviewBody(event.target.value.slice(0, 600))}
            rows={2}
            placeholder={t('orders.reviewBody')}
            className="w-full rounded-2xl border border-line bg-surface p-3 text-sm"
          />
          <Button
            size="sm"
            disabled={rating === 0 || reviewOrder.isPending}
            onClick={() =>
              reviewOrder.mutate({ id: record.id, rating, body: reviewBody.trim() || undefined })
            }
          >
            {t('common.submit')}
          </Button>
          {reviewOrder.isSuccess ? <Pill tone="open">{t('orders.reviewed')}</Pill> : null}
          {reviewOrder.error ? <Banner tone="sunset">{errorMessage(reviewOrder.error)}</Banner> : null}
        </Card>
      ) : null}

      {cancelOrder.error ? <Banner tone="sunset">{errorMessage(cancelOrder.error)}</Banner> : null}

      <div className="text-center">
        <Link to="/orders" className="text-sm font-semibold text-primary">
          ← {t('orders.title')}
        </Link>
      </div>
    </div>
  )
}
