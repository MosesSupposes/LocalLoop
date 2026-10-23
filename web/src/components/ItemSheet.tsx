import { useMemo, useState } from 'react'
import type { MenuItem, MerchantSummary } from '../lib/types'
import { useI18n } from '../lib/i18n'
import { money } from '../lib/format'
import { useAddToCart, useSession } from '../lib/queries'
import { errorMessage } from '../lib/api'
import { Banner, Button, Pill, Tile } from './ui'

/** Item sheet: options, quantity, add to cart. Prices are re-derived server-side on add. */
export function ItemSheet({ merchant, item }: { merchant: MerchantSummary; item: MenuItem }) {
  const { t } = useI18n()
  const session = useSession()
  const addToCart = useAddToCart()
  const [qty, setQty] = useState(1)
  // Required groups are radios: preselect the first choice so the primary CTA is reachable
  // without the neighbor having to hunt for the missing answer.
  const [selected, setSelected] = useState<Record<string, string>>(() => {
    const initial: Record<string, string> = {}
    for (const option of item.options) {
      if (option.required && !initial[option.group_name]) initial[option.group_name] = option.name
    }
    return initial
  })
  const [added, setAdded] = useState(false)

  const groups = useMemo(() => {
    const map = new Map<string, MenuItem['options']>()
    for (const option of item.options) {
      const list = map.get(option.group_name) ?? []
      list.push(option)
      map.set(option.group_name, list)
    }
    return [...map.entries()]
  }, [item.options])

  const basePrice = item.live_drop?.price_cents ?? item.price_cents
  const optionDelta = groups.reduce((sum, [groupName, options]) => {
    const chosen = selected[groupName]
    const option = options.find((o) => o.name === chosen)
    return sum + (option?.price_delta_cents ?? 0)
  }, 0)
  const unitPrice = basePrice + optionDelta
  const total = unitPrice * qty

  const missingRequired = groups.some(([groupName, options]) => options.some((o) => o.required) && !selected[groupName])

  function add() {
    const options = groups.flatMap(([groupName, list]) => {
      const chosen = selected[groupName] ?? list.find((o) => o.required)?.name
      const option = list.find((o) => o.name === chosen)
      return option ? [{ name: option.name, priceDeltaCents: option.price_delta_cents }] : []
    })
    addToCart.mutate(
      { merchantId: merchant.id, itemId: item.id, qty, options },
      { onSuccess: () => setAdded(true) },
    )
  }

  return (
    <div className="space-y-4">
      <div className="flex gap-3">
        <Tile seed={item.id} label={item.name} size={64} />
        <div className="min-w-0">
          <h3 className="font-display text-lg font-bold">{item.name}</h3>
          {item.description ? <p className="text-sm text-muted">{item.description}</p> : null}
          <div className="mt-2 flex flex-wrap gap-1.5">
            {item.live_drop ? <Pill tone="sunset">⚡ {money(item.live_drop.price_cents)}</Pill> : null}
            {item.freshness_note ? <Pill tone="sky">{item.freshness_note}</Pill> : null}
            {item.dietary.map((tag) => (
              <Pill key={tag}>{tag}</Pill>
            ))}
            {!item.in_stock ? <Pill tone="closed">{t('storefront.outOfStock')}</Pill> : null}
          </div>
        </div>
      </div>

      {groups.map(([groupName, options]) => (
        <fieldset key={groupName} className="space-y-2">
          <legend className="text-sm font-semibold text-muted">
            {groupName}
            {options.some((o) => o.required) ? ' *' : ''}
          </legend>
          <div className="flex flex-wrap gap-2">
            {options.map((option) => {
              const active = selected[groupName] === option.name
              return (
                <button
                  key={option.id}
                  type="button"
                  aria-pressed={active}
                  onClick={() =>
                    setSelected((prev) => ({ ...prev, [groupName]: active ? '' : option.name }))
                  }
                  className={
                    'min-h-11 rounded-full border px-3.5 text-sm font-semibold transition ' +
                    (active ? 'border-primary bg-primary/15 text-primary' : 'border-line bg-surface text-muted')
                  }
                >
                  {option.name}
                  {option.price_delta_cents > 0 ? ` +${money(option.price_delta_cents)}` : ''}
                </button>
              )
            })}
          </div>
        </fieldset>
      ))}

      <div className="flex items-center justify-between gap-3 border-t border-line pt-4">
        <div className="flex items-center rounded-full border border-line">
          <button type="button" aria-label={t('common.remove')} className="min-h-11 min-w-11 text-xl" onClick={() => setQty((q) => Math.max(1, q - 1))}>
            −
          </button>
          <span className="min-w-8 text-center font-mono">{qty}</span>
          <button type="button" aria-label={t('common.add')} className="min-h-11 min-w-11 text-xl" onClick={() => setQty((q) => Math.min(50, q + 1))}>
            +
          </button>
        </div>
        <div className="text-right">
          <div className="font-mono text-lg font-semibold">{money(total)}</div>
          <div className="text-xs text-muted">
            {money(unitPrice)} {t('common.each')}
          </div>
        </div>
      </div>

      {!session.data?.user ? <Banner tone="sky">{t('cart.needsSignIn')}</Banner> : null}

      <Button
        full
        size="lg"
        variant="sunset"
        disabled={!item.in_stock || missingRequired || addToCart.isPending || !session.data?.user}
        onClick={add}
      >
        {added ? t('storefront.added') : `${t('storefront.addToCart')} · ${money(total)}`}
      </Button>

      {addToCart.error ? <Banner tone="sunset">{errorMessage(addToCart.error)}</Banner> : null}
      {missingRequired ? <Banner tone="muted">{t('storefront.options')} *</Banner> : null}
    </div>
  )
}
