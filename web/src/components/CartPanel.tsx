import { useNavigate } from 'react-router-dom'
import { useI18n } from '../lib/i18n'
import { money } from '../lib/format'
import { useCart, useClearCart, useRemoveCartLine, useSession, useUpdateCartLine } from '../lib/queries'
import { Button, EmptyState, Pill, Skeleton } from './ui'

export function CartPanel({ onCheckout }: { onCheckout: () => void }) {
  const { t } = useI18n()
  const cart = useCart()
  const session = useSession()
  const updateLine = useUpdateCartLine()
  const removeLine = useRemoveCartLine()
  const clearCart = useClearCart()
  const navigate = useNavigate()

  if (cart.isLoading) return <Skeleton className="h-32" />

  const carts = cart.data?.carts ?? []
  if (carts.length === 0) {
    return <EmptyState glyph="🛍️" title={t('cart.empty')} hint={t('cart.emptyHint')} />
  }

  const signedIn = Boolean(session.data?.user)

  return (
    <div className="space-y-5">
      {carts.map((entry) => (
        <div key={entry.id} className="space-y-3">
          <div className="flex items-center justify-between gap-2">
            <div>
              <p className="font-display font-bold">{entry.merchant_name}</p>
              <p className="text-xs text-muted">
                {entry.itemCount} {t('orders.items')} · {entry.accepts_pickup ? t('explore.pickupOnly') : '—'}
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={() => clearCart.mutate(entry.merchant_id)}>
              {t('common.clear')}
            </Button>
          </div>

          <ul className="space-y-2">
            {entry.items.map((line) => (
              <li key={line.id} className="surface-raised flex items-start justify-between gap-3 p-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{line.name}</p>
                  <p className="text-xs text-muted">
                    {money(line.unit_price_cents)} {t('common.each')}
                    {line.options.length ? ` · ${line.options.map((o) => o.name).join(', ')}` : ''}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <div className="flex items-center rounded-full border border-line">
                    <button
                      type="button"
                      aria-label={t('common.remove')}
                      className="min-h-9 min-w-9 text-lg"
                      onClick={() => updateLine.mutate({ id: line.id, qty: line.qty - 1 })}
                    >
                      −
                    </button>
                    <span className="min-w-6 text-center font-mono text-sm">{line.qty}</span>
                    <button
                      type="button"
                      aria-label={t('common.add')}
                      className="min-h-9 min-w-9 text-lg"
                      onClick={() => updateLine.mutate({ id: line.id, qty: line.qty + 1 })}
                    >
                      +
                    </button>
                  </div>
                  <button
                    type="button"
                    className="text-xs font-semibold text-muted underline"
                    onClick={() => removeLine.mutate(line.id)}
                  >
                    {t('common.remove')}
                  </button>
                </div>
              </li>
            ))}
          </ul>

          <div className="flex items-center justify-between border-t border-line pt-3">
            <span className="text-sm text-muted">{t('common.subtotal')}</span>
            <span className="font-mono font-semibold">{money(entry.subtotalCents)}</span>
          </div>

          {signedIn ? (
            <Button
              full
              variant="sunset"
              onClick={() => {
                onCheckout()
                navigate(`/checkout/${entry.merchant_id}`)
              }}
            >
              {t('common.checkout')}
            </Button>
          ) : (
            <Pill tone="sky">{t('cart.needsSignIn')}</Pill>
          )}
        </div>
      ))}
    </div>
  )
}
