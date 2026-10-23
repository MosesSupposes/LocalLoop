import type { OrderStatus } from '../lib/types'
import { useI18n } from '../lib/i18n'
import { cx } from './ui'

export function OrderTracker({
  tracker,
  compact,
}: {
  tracker: { steps: OrderStatus[]; currentIndex: number; cancelled: boolean }
  compact?: boolean
}) {
  const { t } = useI18n()
  const steps = tracker.steps.filter((step) => step !== 'cancelled')

  return (
    <div className={cx('flex items-center gap-1.5', compact ? 'text-[11px]' : 'text-xs')}>
      {steps.map((step, index) => {
        const done = index <= tracker.currentIndex
        return (
          <div key={step} className="flex min-w-0 flex-1 flex-col gap-1.5">
            <div className="flex items-center gap-1.5">
              <span
                aria-hidden
                className={cx(
                  'h-2 flex-1 rounded-full transition',
                  tracker.cancelled && index === tracker.currentIndex
                    ? 'bg-destructive'
                    : done
                      ? 'bg-primary glow-primary'
                      : 'bg-surface-raised',
                )}
              />
            </div>
            <span className={cx('truncate font-semibold', done ? 'text-foreground' : 'text-muted')}>
              {t(`orders.status.${step}`)}
            </span>
          </div>
        )
      })}
      {tracker.cancelled ? (
        <div className="flex flex-1 flex-col gap-1.5">
          <span aria-hidden className="h-2 rounded-full bg-destructive" />
          <span className="truncate font-semibold text-destructive">{t('orders.status.cancelled')}</span>
        </div>
      ) : null}
    </div>
  )
}
