import { useState } from 'react'
import { useI18n } from '../../lib/i18n'
import { countdown, money } from '../../lib/format'
import { errorMessage } from '../../lib/api'
import {
  useCloseDrop,
  useCreateDeal,
  useCreateDrop,
  useDeleteDeal,
  useMerchantMenu,
} from '../../lib/queries'
import { Banner, Button, Card, Field, Pill, SectionHeader, Select, Skeleton } from '../ui'

export function MarketingPanel({
  merchantId,
  generateCopy,
}: {
  merchantId: string
  generateCopy: (discount: string, itemName?: string) => Promise<string>
}) {
  const { t } = useI18n()
  const menu = useMerchantMenu(merchantId)
  const createDrop = useCreateDrop(merchantId)
  const closeDrop = useCloseDrop(merchantId)
  const createDeal = useCreateDeal(merchantId)
  const deleteDeal = useDeleteDeal(merchantId)

  const [drop, setDrop] = useState({ itemId: '', title: '', qtyTotal: '10', price: '', hours: '4' })
  const [deal, setDeal] = useState({ title: '', type: 'percent', value: '20', hours: '6' })
  const [copyBusy, setCopyBusy] = useState(false)

  if (menu.isLoading) return <Skeleton className="h-40" />

  const items = menu.data?.items ?? []
  const drops = menu.data?.drops ?? []
  const deals = menu.data?.deals ?? []

  return (
    <div className="space-y-5">
      <Card className="space-y-3">
        <SectionHeader title={t('merchant.addDrop')} />
        <Select label={t('merchant.itemName')} value={drop.itemId} onChange={(event) => setDrop((prev) => ({ ...prev, itemId: event.target.value }))}>
          <option value="">—</option>
          {items.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name} · {money(item.price_cents)}
            </option>
          ))}
        </Select>
        <Field
          label={t('merchant.dropTitle')}
          value={drop.title}
          onChange={(event) => setDrop((prev) => ({ ...prev, title: event.target.value }))}
        />
        <div className="grid gap-3 sm:grid-cols-3">
          <Field label={t('merchant.dropQty')} inputMode="numeric" value={drop.qtyTotal} onChange={(event) => setDrop((prev) => ({ ...prev, qtyTotal: event.target.value }))} />
          <Field label={t('merchant.itemPrice')} inputMode="decimal" value={drop.price} onChange={(event) => setDrop((prev) => ({ ...prev, price: event.target.value }))} />
          <Field label={t('merchant.dropEnds') + ' (+hours)'} inputMode="numeric" value={drop.hours} onChange={(event) => setDrop((prev) => ({ ...prev, hours: event.target.value }))} />
        </div>
        <Button
          size="sm"
          variant="sunset"
          disabled={!drop.title || !drop.price || createDrop.isPending}
          onClick={() =>
            createDrop.mutate(
              {
                itemId: drop.itemId || null,
                title: drop.title,
                qtyTotal: Number(drop.qtyTotal),
                priceCents: Math.round(Number(drop.price) * 100),
                endsAt: new Date(Date.now() + Number(drop.hours) * 3600_000).toISOString(),
              },
              { onSuccess: () => setDrop({ itemId: '', title: '', qtyTotal: '10', price: '', hours: '4' }) },
            )
          }
        >
          {t('merchant.addDrop')}
        </Button>
        {createDrop.error ? <Banner tone="sunset">{errorMessage(createDrop.error)}</Banner> : null}
      </Card>

      <Card className="space-y-3">
        <SectionHeader title={t('merchant.addDeal')} />
        <Field label={t('merchant.dealTitle')} value={deal.title} onChange={(event) => setDeal((prev) => ({ ...prev, title: event.target.value }))} />
        <div className="grid gap-3 sm:grid-cols-3">
          <Select label={t('merchant.dealType')} value={deal.type} onChange={(event) => setDeal((prev) => ({ ...prev, type: event.target.value }))}>
            <option value="percent">{t('merchant.dealPercent')}</option>
            <option value="fixed">{t('merchant.dealFixed')}</option>
          </Select>
          <Field label={t('merchant.dealType')} inputMode="numeric" value={deal.value} onChange={(event) => setDeal((prev) => ({ ...prev, value: event.target.value }))} />
          <Field label={t('merchant.dropEnds') + ' (+hours)'} inputMode="numeric" value={deal.hours} onChange={(event) => setDeal((prev) => ({ ...prev, hours: event.target.value }))} />
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            size="sm"
            disabled={!deal.title || createDeal.isPending}
            onClick={() =>
              createDeal.mutate(
                {
                  title: deal.title,
                  type: deal.type,
                  value: Number(deal.value),
                  endsAt: new Date(Date.now() + Number(deal.hours) * 3600_000).toISOString(),
                },
                { onSuccess: () => setDeal({ title: '', type: 'percent', value: '20', hours: '6' }) },
              )
            }
          >
            {t('merchant.addDeal')}
          </Button>
          <Button
            size="sm"
            variant="surface"
            disabled={copyBusy}
            onClick={async () => {
              setCopyBusy(true)
              try {
                const discount = deal.type === 'percent' ? `${deal.value}% off` : `${money(Number(deal.value))} off`
                const copy = await generateCopy(discount)
                setDeal((prev) => ({ ...prev, title: copy }))
              } finally {
                setCopyBusy(false)
              }
            }}
          >
            ✨ {t('merchant.generateCopy')}
          </Button>
        </div>
        {createDeal.error ? <Banner tone="sunset">{errorMessage(createDeal.error)}</Banner> : null}
      </Card>

      <section className="space-y-2">
        <SectionHeader title={t('home.liveDrops')} />
        {drops.length === 0 ? <p className="text-sm text-muted">—</p> : null}
        {drops.map((entry) => {
          const live = new Date(entry.ends_at).getTime() > Date.now()
          return (
            <Card key={entry.id} className="flex items-center justify-between gap-3 p-3">
              <div className="min-w-0">
                <p className="truncate text-sm font-semibold">{entry.title}</p>
                <p className="font-mono text-xs text-muted">
                  {money(entry.price_cents)} · {entry.qty_left}/{entry.qty_total} ·{' '}
                  {live ? countdown(entry.ends_at) : t('orders.status.cancelled')}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Pill tone={live ? 'sunset' : 'closed'}>{live ? t('home.statDrops') : '—'}</Pill>
                {live ? (
                  <Button size="sm" variant="surface" onClick={() => closeDrop.mutate(entry.id)}>
                    {t('merchant.closeDrop')}
                  </Button>
                ) : null}
              </div>
            </Card>
          )
        })}
      </section>

      <section className="space-y-2">
        <SectionHeader title={t('home.dealsNear')} />
        {deals.length === 0 ? <p className="text-sm text-muted">—</p> : null}
        {deals.map((entry) => (
          <Card key={entry.id} className="flex items-center justify-between gap-3 p-3">
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{entry.title}</p>
              <p className="font-mono text-xs text-muted">
                {entry.type === 'percent' ? `${entry.value}%` : money(entry.value)} ·{' '}
                {new Date(entry.ends_at).getTime() > Date.now() ? countdown(entry.ends_at) : 'ended'}
              </p>
            </div>
            <Button size="sm" variant="danger" onClick={() => deleteDeal.mutate(entry.id)}>
              {t('merchant.removeDeal')}
            </Button>
          </Card>
        ))}
      </section>
    </div>
  )
}
