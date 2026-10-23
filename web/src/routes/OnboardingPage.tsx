import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useI18n } from '../lib/i18n'
import { useNearby, useSession, useToggleFavorite } from '../lib/queries'
import { useUI } from '../lib/store'
import { categoryLabel } from '../lib/i18n'
import { useConfig } from '../lib/queries'
import { Button, Card, Pill, Sheet, Skeleton, Tile, cx } from '../components/ui'
import { SignInPanel } from '../components/SignInPanel'

export function OnboardingPage() {
  const { t, locale } = useI18n()
  const navigate = useNavigate()
  const config = useConfig()
  const session = useSession()
  const location = useUI((s) => s.location)
  const setLocation = useUI((s) => s.setLocation)
  const setOnboarded = useUI((s) => s.setOnboarded)
  const toggleFavorite = useToggleFavorite()
  const nearby = useNearby({ openNow: false, deals: false, pickup: false, category: null })

  const [step, setStep] = useState(0)
  const [picked, setPicked] = useState<string[]>([])
  const [signInOpen, setSignInOpen] = useState(false)
  const [geoState, setGeoState] = useState<'idle' | 'asking' | 'denied'>('idle')

  function useDeviceLocation() {
    if (!navigator.geolocation) {
      setGeoState('denied')
      return
    }
    setGeoState('asking')
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setLocation({ lat: position.coords.latitude, lng: position.coords.longitude, label: 'Your location' })
        setGeoState('idle')
      },
      () => setGeoState('denied'),
      { timeout: 8000 },
    )
  }

  const merchants = nearby.data?.merchants ?? []
  const user = session.data?.user

  return (
    <div className="mx-auto max-w-2xl space-y-5">
      <header className="text-center">
        <h1 className="font-display text-3xl font-bold tracking-tight">{t('onboarding.title')}</h1>
        <p className="text-sm text-muted">{t('onboarding.subtitle')}</p>
        <div className="mt-3 flex justify-center gap-2">
          {[0, 1, 2].map((index) => (
            <span
              key={index}
              className={cx('h-1.5 w-10 rounded-full', index <= step ? 'bg-primary' : 'bg-surface-raised')}
            />
          ))}
        </div>
      </header>

      {step === 0 ? (
        <Card className="space-y-3">
          <h2 className="font-display text-lg font-bold">{t('onboarding.step1')}</h2>
          <p className="text-sm text-muted">{t('onboarding.locationHint')}</p>
          <p className="font-mono text-sm">
            {location.label} · {location.lat.toFixed(4)}, {location.lng.toFixed(4)}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button onClick={useDeviceLocation} disabled={geoState === 'asking'}>
              📍 {t('profile.useMyLocation')}
            </Button>
            <Button
              variant="surface"
              onClick={() => {
                setLocation({ lat: 34.0783, lng: -118.2605, label: 'Echo Park' })
              }}
            >
              Echo Park
            </Button>
            <Button
              variant="ghost"
              onClick={() => {
                setStep(1)
              }}
            >
              {t('onboarding.gotIt')} →
            </Button>
          </div>
          {geoState === 'denied' ? <Pill tone="sunset">{t('onboarding.locationHint')}</Pill> : null}
        </Card>
      ) : null}

      {step === 1 ? (
        <Card className="space-y-3">
          <div className="flex items-center justify-between gap-3">
            <h2 className="font-display text-lg font-bold">{t('onboarding.step2')}</h2>
            <Pill tone="pink">
              {picked.length} / 3 {t('onboarding.selected')}
            </Pill>
          </div>
          <p className="text-sm text-muted">{t('onboarding.pickHint')}</p>

          {!user ? (
            <div className="space-y-2">
              <p className="text-sm text-muted">{t('onboarding.signInHint')}</p>
              <Button size="sm" onClick={() => setSignInOpen(true)}>
                {t('common.signIn')}
              </Button>
            </div>
          ) : null}

          {nearby.isLoading ? (
            <Skeleton className="h-40" />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {merchants.slice(0, 8).map((merchant) => {
                const active = picked.includes(merchant.id)
                const glyph = config.data?.categories.find((c) => c.key === merchant.category)?.glyph
                return (
                  <button
                    key={merchant.id}
                    type="button"
                    disabled={!user}
                    onClick={() => {
                      if (active) {
                        setPicked((prev) => prev.filter((id) => id !== merchant.id))
                        toggleFavorite.mutate({ merchantId: merchant.id, favorite: true })
                        return
                      }
                      if (picked.length >= 3) return
                      setPicked((prev) => [...prev, merchant.id])
                      toggleFavorite.mutate({ merchantId: merchant.id, favorite: false })
                    }}
                    className={cx(
                      'surface-raised flex items-center gap-2 p-3 text-left transition disabled:opacity-50',
                      active && 'border-primary glow-primary',
                    )}
                  >
                    <Tile seed={merchant.slug} label={merchant.name} glyph={glyph} size={38} />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold">{merchant.name}</span>
                      <span className="block truncate text-[11px] text-muted">
                        {categoryLabel(merchant.category, config.data?.categories ?? [], locale)}
                      </span>
                    </span>
                  </button>
                )
              })}
            </div>
          )}

          <div className="flex justify-between gap-2">
            <Button variant="ghost" onClick={() => setStep(0)}>
              ← {t('common.back')}
            </Button>
            <Button onClick={() => setStep(2)} disabled={picked.length === 0 && Boolean(user)}>
              {t('common.continue') ?? 'Next'} →
            </Button>
          </div>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card className="space-y-3 text-center">
          <h2 className="font-display text-xl font-bold">{t('onboarding.step3')}</h2>
          <p className="text-sm text-muted">{t('home.speedDialHint')}</p>
          <Button
            size="lg"
            variant="sunset"
            onClick={() => {
              setOnboarded(true)
              navigate('/')
            }}
          >
            {t('onboarding.finish')}
          </Button>
        </Card>
      ) : null}

      <div className="text-center">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setOnboarded(true)
            navigate('/')
          }}
        >
          {t('onboarding.skip')}
        </Button>
      </div>

      <Sheet open={signInOpen} onClose={() => setSignInOpen(false)} title={t('auth.title')}>
        <SignInPanel onDone={() => setSignInOpen(false)} />
      </Sheet>
    </div>
  )
}
