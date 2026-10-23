import { useState } from 'react'
import type { Hours } from '../../lib/types'
import { DAY_KEYS } from '../../lib/format'
import { useI18n } from '../../lib/i18n'
import { Button, Card, SectionHeader, cx } from '../ui'

type Draft = Record<string, { enabled: boolean; open: string; close: string }>

function toDraft(hours: Hours | undefined): Draft {
  const draft: Draft = {}
  for (const day of DAY_KEYS) {
    const range = hours?.[day]?.[0]
    draft[day] = range
      ? { enabled: true, open: range[0], close: range[1] }
      : { enabled: false, open: '09:00', close: '18:00' }
  }
  return draft
}

export function HoursEditor({
  hours,
  onSave,
  saving,
}: {
  hours: Hours | undefined
  onSave: (hours: Hours) => void
  saving: boolean
}) {
  const { t } = useI18n()
  const [draft, setDraft] = useState<Draft>(() => toDraft(hours))
  const [saved, setSaved] = useState(false)

  return (
    <Card className="space-y-3">
      <SectionHeader title={t('merchant.hours')} />
      <div className="space-y-2">
        {DAY_KEYS.map((day) => (
          <div key={day} className="flex flex-wrap items-center gap-2">
            <span className="w-24 text-sm font-semibold">{t(`merchant.day.${day}`)}</span>
            <button
              type="button"
              aria-pressed={draft[day].enabled}
              onClick={() => setDraft((prev) => ({ ...prev, [day]: { ...prev[day], enabled: !prev[day].enabled } }))}
              className={cx(
                'min-h-9 rounded-full border px-3 text-xs font-semibold',
                draft[day].enabled ? 'border-success/40 text-success' : 'border-line text-muted',
              )}
            >
              {draft[day].enabled ? t('common.open') : t('common.closed')}
            </button>
            <input
              type="time"
              value={draft[day].open}
              aria-label={`${day} open`}
              disabled={!draft[day].enabled}
              onChange={(event) => setDraft((prev) => ({ ...prev, [day]: { ...prev[day], open: event.target.value } }))}
              className="min-h-9 rounded-full border border-line bg-surface px-3 font-mono text-sm disabled:opacity-40"
            />
            <input
              type="time"
              value={draft[day].close}
              aria-label={`${day} close`}
              disabled={!draft[day].enabled}
              onChange={(event) => setDraft((prev) => ({ ...prev, [day]: { ...prev[day], close: event.target.value } }))}
              className="min-h-9 rounded-full border border-line bg-surface px-3 font-mono text-sm disabled:opacity-40"
            />
          </div>
        ))}
      </div>
      <Button
        size="sm"
        disabled={saving}
        onClick={() => {
          const payload: Hours = {}
          for (const day of DAY_KEYS) {
            if (draft[day].enabled) payload[day] = [[draft[day].open, draft[day].close]]
          }
          onSave(payload)
          setSaved(true)
          setTimeout(() => setSaved(false), 2000)
        }}
      >
        {saved ? t('profile.saved') : t('merchant.saveHours')}
      </Button>
    </Card>
  )
}
