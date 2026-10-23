import { useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { useI18n } from '../lib/i18n'
import { money, nextPickupSlots, timeOfDay } from '../lib/format'
import { useCart, useConfig, usePlaceOrder, useSession } from '../lib/queries'
import { errorMessage } from '../lib/api'
import { Banner, Button, Card, EmptyState, ErrorState, Pill, SectionHeader, Skeleton, cx } from '../components/ui'

const TIPS = [0, 100, 200, 300]

export function CheckoutPage() {
  const { merchantId } = useParams<{ merchantId: string }>()
  const { t, locale } = useI18n()
  const cart = useCart()
  const config = useConfig()
  const session = useSession()
  const placeOrder = usePlaceOrder()
  const navigate = useNavigate()

  const [slot, setSlot] = useState<string>('asap')
  const [tip, setTip] = useState(200)
  const [note, setNote] = useState('')
  const [method, setMethod] = useState<'card' | 'apple_pay' | 'google_pay'>('card')

  const slots = nextPickupSlots()
  const entry = (cart.data?.carts ?? []).find((candidate) => candidate.merchant_id === merchantId)

  if (cart.isLoading) return <Skeleton className="h-64" />
  if (!session.data?.user) {
    return <ErrorState message={t('cart.needsSignIn')} />
  }
  if (!entry) {
    return (
      <EmptyState
        glyph="🛍️"
        title={t('cart.empty')}
        hint={t('cart.emptyHint')}
        action={
          <Link to="/explore">
            <Button size="sm" className="mt-2">
              {t('nav.explore')}
            </Button>
          </Link>
        }
      />
    )
  }

  const serviceFee = config.data?.fees.serviceFeeCents ?? 99
  const subtotal = entry.subtotalCents
  const total = subtotal + serviceFee + tip

  async function submit() {
    placeOrder.mutate(
      {
        merchantId: entry!.merchant_id,
        pickupSlot: slot === 'asap' ? null : slot,
        tipCents: tip,
        note: note.trim() || undefined,
        paymentMethod: method,
      },
      {
        onSuccess: (data) => {
          navigate(`/orders/${data.order.id}`)
        },
      },
    )
  }

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header>
        <h1 className="font-display text-2xl font-bold tracking-tight">{t('common.checkout')}</h1>
        <p className="text-sm text-muted">{entry.merchant_name}</p>
      </header>

      <Card className="space-y-2">
        {entry.items.map((line) => (
          <div key={line.id} className="flex items-start justify-between gap-3 text-sm">
            <div className="min-w-0">
              <p className="truncate font-semibold">
                {line.qty}× {line.name}
              </p>
              {line.options.length ? (
                <p className="text-xs text-muted">{line.options.map((option) => option.name).join(', ')}</p>
              ) : null}
            </div>
            <span className="font-mono">{money(line.qty * line.unit_price_cents)}</span>
          </div>
        ))}
      </Card>

      <section>
        <SectionHeader title={t('cart.pickupSlot')} />
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSlot('asap')}
            className={cx(
              'min-h-11 rounded-full border px-3.5 text-sm font-semibold',
              slot === 'asap' ? 'border-primary bg-primary/15 text-primary' : 'border-line bg-surface text-muted',
            )}
          >
            {t('cart.asap')}
          </button>
          {slots.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setSlot(option.value)}
              className={cx(
                'min-h-11 rounded-full border px-3.5 font-mono text-sm',
                slot === option.value ? 'border-primary bg-primary/15 text-primary' : 'border-line bg-surface text-muted',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </section>

      <section>
        <SectionHeader title={t('common.tip')} />
        <div className="flex flex-wrap gap-2">
          {TIPS.map((amount) => (
            <button
              key={amount}
              type="button"
              onClick={() => setTip(amount)}
              className={cx(
                'min-h-11 rounded-full border px-3.5 font-mono text-sm',
                tip === amount ? 'border-primary bg-primary/15 text-primary' : 'border-line bg-surface text-muted',
              )}
            >
              {amount === 0 ? '—' : money(amount)}
            </button>
          ))}
        </div>
      </section>

      <section>
        <SectionHeader title={t('cart.note')} />
        <textarea
          value={note}
          onChange={(event) => setNote(event.target.value.slice(0, 200))}
          rows={2}
          placeholder={t('common.optional')}
          className="w-full rounded-2xl border border-line bg-surface p-3 text-sm"
        />
      </section>

      <section>
        <SectionHeader title={t('cart.payWith')} />
        <div className="flex flex-wrap gap-2">
          {(['card', 'apple_pay'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setMethod(option)}
              className={cx(
                'min-h-11 rounded-full border px-3.5 text-sm font-semibold',
                method === option ? 'border-primary bg-primary/15 text-primary' : 'border-line bg-surface text-muted',
              )}
            >
              {option === 'card' ? t('cart.card') : t('cart.wallet')}
            </button>
          ))}
        </div>
        <div className="mt-2">
          <Pill tone="sky">
            {config.data?.integrations.payments === 'stripe' ? 'Stripe' : t('cart.simulated')}
          </Pill>
        </div>
      </section>

      <Card className="space-y-1.5">
        <Row label={t('common.subtotal')} value={money(subtotal)} />
        <Row label={t('common.serviceFee')} value={money(serviceFee)} />
        <Row label={t('common.tip')} value={money(tip)} />
        <div className="flex items-center justify-between border-t border-line pt-2 text-base font-bold">
          <span>{t('common.total')}</span>
          <span className="font-mono">{money(total)}</span>
        </div>
        <p className="text-xs text-muted">
          {locale === 'es'
            ? 'El local cubre una comisión de plataforma del 5% sobre el subtotal.'
            : 'The shop pays a 5% platform fee on the subtotal.'}
        </p>
      </Card>

      {placeOrder.error ? <Banner tone="sunset">{errorMessage(placeOrder.error)}</Banner> : null}

      <Button full size="lg" variant="sunset" disabled={placeOrder.isPending} onClick={submit}>
        {placeOrder.isPending ? '…' : `${t('cart.placeOrder')} · ${money(total)}`}
      </Button>

      <p className="text-center text-xs text-muted">
        {slot === 'asap' ? t('cart.asap') : `${t('cart.pickupSlot')}: ${timeOfDay(slot, locale)}`}
      </p>
    </div>
  )
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between text-sm">
      <span className="text-muted">{label}</span>
      <span className="font-mono">{value}</span>
    </div>
  )
}
