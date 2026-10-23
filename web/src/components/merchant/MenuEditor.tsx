import { useMemo, useState } from 'react'
import { useI18n } from '../../lib/i18n'
import { money } from '../../lib/format'
import { errorMessage } from '../../lib/api'
import {
  useCreateCategory,
  useDeleteItem,
  useMenuImport,
  useMerchantMenu,
  usePhotoImport,
  useSaveItem,
} from '../../lib/queries'
import { Banner, Button, Card, Field, Pill, SectionHeader, Select, Skeleton, cx } from '../ui'

export function MenuEditor({ merchantId }: { merchantId: string }) {
  const { t } = useI18n()
  const menu = useMerchantMenu(merchantId)
  const saveItem = useSaveItem(merchantId)
  const deleteItem = useDeleteItem(merchantId)
  const createCategory = useCreateCategory(merchantId)
  const importText = useMenuImport()
  const importPhoto = usePhotoImport()

  const [newCategory, setNewCategory] = useState('')
  const [draft, setDraft] = useState({ name: '', price: '', description: '', categoryId: '' })
  const [importText_, setImportText] = useState('')
  const [parsed, setParsed] = useState<{ name: string; description: string | null; priceCents: number; category: string }[]>([])

  const categories = menu.data?.categories ?? []
  const items = menu.data?.items ?? []

  const grouped = useMemo(
    () =>
      categories.map((category) => ({
        category,
        items: items.filter((item) => item.category_id === category.id),
      })),
    [categories, items],
  )

  if (menu.isLoading) return <Skeleton className="h-48" />

  return (
    <div className="space-y-5">
      <Card className="space-y-3">
        <SectionHeader title={t('merchant.newItem')} />
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label={t('merchant.itemName')} value={draft.name} onChange={(event) => setDraft((prev) => ({ ...prev, name: event.target.value }))} />
          <Field
            label={t('merchant.itemPrice')}
            inputMode="decimal"
            value={draft.price}
            onChange={(event) => setDraft((prev) => ({ ...prev, price: event.target.value }))}
          />
          <Select
            label={t('merchant.itemCategory')}
            value={draft.categoryId}
            onChange={(event) => setDraft((prev) => ({ ...prev, categoryId: event.target.value }))}
          >
            <option value="">—</option>
            {categories.map((category) => (
              <option key={category.id} value={category.id}>
                {category.name}
              </option>
            ))}
          </Select>
          <Field
            label={t('merchant.itemDescription')}
            value={draft.description}
            onChange={(event) => setDraft((prev) => ({ ...prev, description: event.target.value }))}
          />
        </div>
        <Button
          size="sm"
          disabled={!draft.name || !draft.price || saveItem.isPending}
          onClick={() =>
            saveItem.mutate(
              {
                body: {
                  name: draft.name,
                  priceCents: Math.round(Number(draft.price) * 100),
                  description: draft.description || null,
                  categoryId: draft.categoryId || null,
                },
              },
              { onSuccess: () => setDraft({ name: '', price: '', description: '', categoryId: '' }) },
            )
          }
        >
          {t('common.add')}
        </Button>
        {saveItem.error ? <Banner tone="sunset">{errorMessage(saveItem.error)}</Banner> : null}
      </Card>

      <Card className="space-y-3">
        <SectionHeader title={t('merchant.importMenu')} />
        {importPhoto.data?.message ? <Banner tone="muted">{importPhoto.data.message}</Banner> : null}
        <textarea
          value={importText_}
          onChange={(event) => setImportText(event.target.value)}
          rows={5}
          placeholder={'Tacos\nAl Pastor Taco 3.49\nChips and Guacamole 5.49\nDrinks\nHorchata 3.49'}
          className="w-full rounded-2xl border border-line bg-surface p-3 font-mono text-xs"
        />
        <div className="flex flex-wrap gap-2">
          <Button size="sm" variant="surface" disabled={importText_.trim().length < 3 || importText.isPending} onClick={() => importText.mutate(importText_, { onSuccess: (data) => setParsed(data.items) })}>
            {t('merchant.importText')}
          </Button>
          <label className="inline-flex min-h-9 cursor-pointer items-center rounded-full border border-line bg-surface px-3 text-sm font-semibold">
            📷 {t('merchant.importPhoto')}
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(event) => {
                const file = event.target.files?.[0]
                if (!file) return
                const reader = new FileReader()
                reader.onload = () => {
                  const result = String(reader.result)
                  const base64 = result.split(',')[1] ?? ''
                  importPhoto.mutate({ imageBase64: base64, mime: file.type || 'image/jpeg' })
                }
                reader.readAsDataURL(file)
              }}
            />
          </label>
        </div>
        {importPhoto.data && importPhoto.data.mode === 'unavailable' ? <Banner tone="sunset">{t('merchant.importAiOff')}</Banner> : null}

        {parsed.length ? (
          <div className="space-y-2">
            <p className="text-sm font-semibold text-muted">{t('merchant.importParsed')}</p>
            <ul className="space-y-1 text-sm">
              {parsed.map((item) => (
                <li key={item.name} className="flex items-center justify-between gap-3">
                  <span className="truncate">
                    {item.name} <span className="text-muted">· {item.category}</span>
                  </span>
                  <span className="font-mono text-muted">{money(item.priceCents)}</span>
                </li>
              ))}
            </ul>
            <Button
              size="sm"
              variant="sunset"
              disabled={saveItem.isPending}
              onClick={async () => {
                for (const item of parsed) {
                  await saveItem.mutateAsync({
                    body: { name: item.name, priceCents: item.priceCents, description: item.description },
                  })
                }
                setParsed([])
                setImportText('')
              }}
            >
              {t('merchant.importAdd')} ({parsed.length})
            </Button>
          </div>
        ) : null}
      </Card>

      <Card className="space-y-3">
        <SectionHeader title={t('merchant.itemCategory')} />
        <div className="flex gap-2">
          <Field label={t('merchant.itemCategory')} value={newCategory} onChange={(event) => setNewCategory(event.target.value)} />
          <Button
            size="sm"
            className="mt-6"
            disabled={newCategory.trim().length < 1 || createCategory.isPending}
            onClick={() => createCategory.mutate(newCategory.trim(), { onSuccess: () => setNewCategory('') })}
          >
            {t('common.add')}
          </Button>
        </div>
      </Card>

      {grouped.map((group) => (
        <section key={group.category.id} className="space-y-2">
          <SectionHeader title={group.category.name} />
          {group.items.length === 0 ? <p className="text-sm text-muted">—</p> : null}
          {group.items.map((item) => (
            <Card key={item.id} className="space-y-2 p-3">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="truncate text-sm font-semibold">{item.name}</p>
                  {item.description ? <p className="line-clamp-1 text-xs text-muted">{item.description}</p> : null}
                  <div className="mt-1 flex flex-wrap gap-1">
                    {item.options.length ? <Pill tone="sky">{item.options.length} {t('storefront.options')}</Pill> : null}
                    {item.is_commodity ? <Pill>bulk</Pill> : null}
                    {!item.in_stock ? <Pill tone="closed">{t('storefront.outOfStock')}</Pill> : null}
                  </div>
                </div>
                <div className="shrink-0 text-right">
                  <p className="font-mono text-sm">{money(item.price_cents)}</p>
                  {item.unit ? <p className="text-[11px] text-muted">{item.unit}</p> : null}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <input
                  type="number"
                  step="0.25"
                  defaultValue={(item.price_cents / 100).toFixed(2)}
                  aria-label={t('merchant.itemPrice')}
                  onBlur={(event) => {
                    const value = Math.round(Number(event.target.value) * 100)
                    if (!Number.isFinite(value) || value === item.price_cents) return
                    saveItem.mutate({ itemId: item.id, body: { priceCents: value } })
                  }}
                  className="min-h-9 w-24 rounded-full border border-line bg-surface px-3 font-mono text-sm"
                />
                <button
                  type="button"
                  onClick={() => saveItem.mutate({ itemId: item.id, body: { inStock: !item.in_stock } })}
                  className={cx(
                    'min-h-9 rounded-full border px-3 text-xs font-semibold',
                    item.in_stock ? 'border-success/40 text-success' : 'border-line text-muted',
                  )}
                >
                  {item.in_stock ? '✓' : '✕'} {t('merchant.outOfStockToggle')}
                </button>
                <button
                  type="button"
                  onClick={() => deleteItem.mutate(item.id)}
                  className="min-h-9 rounded-full border border-destructive/40 px-3 text-xs font-semibold text-destructive"
                >
                  {t('common.remove')}
                </button>
              </div>
            </Card>
          ))}
        </section>
      ))}
    </div>
  )
}
