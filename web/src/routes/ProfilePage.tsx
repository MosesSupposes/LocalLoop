import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import { useI18n } from '../lib/i18n'
import { dayLabel } from '../lib/format'
import { useLoopPoints, useLogout, useNotifications, useSession, useUpdateMe } from '../lib/queries'
import { useUI } from '../lib/store'
import { Button, Card, EmptyState, Field, Pill, SectionHeader, Skeleton, cx } from '../components/ui'

export function ProfilePage() {
  const { t, locale, setLocale } = useI18n()
  const theme = useUI((s) => s.theme)
  const setTheme = useUI((s) => s.setTheme)
  const session = useSession()
  const points = useLoopPoints()
  const notifications = useNotifications()
  const updateMe = useUpdateMe()
  const logout = useLogout()

  const user = session.data?.user
  const [address, setAddress] = useState('')
  const [displayName, setDisplayName] = useState('')
  const [saved, setSaved] = useState(false)

  useEffect(() => {
    if (user) {
      setAddress(user.home_address ?? '')
      setDisplayName(user.display_name ?? '')
    }
  }, [user])

  if (session.isLoading) return <Skeleton className="h-48" />
  if (!user) {
    return <EmptyState glyph="🙂" title={t('cart.needsSignIn')} hint={t('onboarding.signInHint')} />
  }

  const hasMerchant = user.roles.includes('merchant')
  const hasAdmin = user.roles.includes('admin')

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <header className="surface-card flex items-center gap-3 p-4">
        <div
          aria-hidden
          className="flex h-12 w-12 items-center justify-center rounded-2xl font-display text-lg font-bold text-primary-foreground"
          style={{ background: 'var(--primary)' }}
        >
          {user.display_name.slice(0, 1).toUpperCase()}
        </div>
        <div className="min-w-0">
          <h1 className="truncate font-display text-xl font-bold tracking-tight">{user.display_name}</h1>
          <p className="truncate text-xs text-muted">{user.email}</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {user.roles.map((role) => (
              <Pill key={role} tone={role === 'admin' ? 'sky' : role === 'merchant' ? 'sunset' : 'neutral'}>
                {role}
              </Pill>
            ))}
          </div>
        </div>
      </header>

      <section className="grid gap-3 sm:grid-cols-2">
        <Card className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-muted">{t('profile.loopPoints')}</span>
          <span className="font-mono text-3xl font-bold text-primary">{points.data?.balance ?? user.loopPoints}</span>
          <span className="text-xs text-muted">{t('profile.pointsHint')}</span>
        </Card>
        <Card className="flex flex-col gap-1">
          <span className="text-xs uppercase tracking-wide text-muted">{t('common.favorite')}</span>
          <span className="font-mono text-3xl font-bold text-pink">{user.favorites.length}</span>
          <div className="flex flex-wrap gap-1">
            {user.favorites.slice(0, 4).map((favorite) => (
              <Link key={favorite.merchant_id} to={`/m/${favorite.slug}`} className="text-xs font-semibold text-primary">
                {favorite.name}
              </Link>
            ))}
          </div>
        </Card>
      </section>

      <section>
        <SectionHeader title={t('profile.history')} />
        {points.data?.history.length ? (
          <Card className="divide-y divide-line p-0">
            {points.data.history.map((entry) => (
              <div key={entry.id} className="flex items-center justify-between gap-3 px-4 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-semibold">{entry.merchant_name ?? entry.reason}</p>
                  <p className="text-xs text-muted">{dayLabel(entry.created_at, locale)}</p>
                </div>
                <span className="font-mono text-primary">+{entry.points}</span>
              </div>
            ))}
          </Card>
        ) : (
          <EmptyState title={t('profile.pointsHint')} />
        )}
      </section>

      <section>
        <SectionHeader title={t('profile.addresses')} />
        <Card className="space-y-3">
          <Field label={t('profile.addresses')} value={address} onChange={(event) => setAddress(event.target.value)} placeholder={t('profile.addressPlaceholder')} />
          <Field label={t('profile.name')} value={displayName} onChange={(event) => setDisplayName(event.target.value)} />
          <Button
            size="sm"
            disabled={updateMe.isPending}
            onClick={() =>
              updateMe.mutate(
                { homeAddress: address, displayName },
                {
                  onSuccess: () => {
                    setSaved(true)
                    setTimeout(() => setSaved(false), 2000)
                  },
                },
              )
            }
          >
            {saved ? t('profile.saved') : t('common.save')}
          </Button>
        </Card>
      </section>

      <section>
        <SectionHeader title={t('common.language') + ' · ' + t('common.theme')} />
        <Card className="flex flex-wrap items-center gap-3">
          <div className="flex rounded-full border border-line p-0.5">
            {(['en', 'es'] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => {
                  setLocale(code)
                  updateMe.mutate({ locale: code })
                }}
                className={cx(
                  'min-h-9 rounded-full px-4 text-xs font-bold uppercase',
                  locale === code ? 'bg-primary text-primary-foreground' : 'text-muted',
                )}
              >
                {code}
              </button>
            ))}
          </div>
          <div className="flex rounded-full border border-line p-0.5">
            {(['dark', 'light'] as const).map((option) => (
              <button
                key={option}
                type="button"
                onClick={() => setTheme(option)}
                className={cx(
                  'min-h-9 rounded-full px-4 text-xs font-semibold',
                  theme === option ? 'bg-primary text-primary-foreground' : 'text-muted',
                )}
              >
                {option === 'dark' ? t('common.dark') : t('common.light')}
              </button>
            ))}
          </div>
        </Card>
      </section>

      <section>
        <SectionHeader title={t('profile.notifications')} />
        {notifications.data?.notifications.length ? (
          <Card className="divide-y divide-line p-0">
            {notifications.data.notifications.map((entry) => (
              <div key={entry.id} className="px-4 py-2.5">
                <p className={cx('text-sm', entry.read_at ? 'text-muted' : 'font-semibold')}>{entry.title}</p>
                <p className="text-xs text-muted">{dayLabel(entry.created_at, locale)}</p>
              </div>
            ))}
          </Card>
        ) : (
          <EmptyState title={t('profile.noNotifications')} />
        )}
      </section>

      <section className="flex flex-wrap gap-2">
        {hasMerchant ? (
          <Link to="/merchant">
            <Button variant="surface" size="sm">
              🧑‍🍳 {t('nav.merchant')}
            </Button>
          </Link>
        ) : (
          <Link to="/merchant">
            <Button variant="surface" size="sm">
              {t('merchant.openStorefront')}
            </Button>
          </Link>
        )}
        {hasAdmin ? (
          <Link to="/admin">
            <Button variant="surface" size="sm">
              🧭 {t('nav.admin')}
            </Button>
          </Link>
        ) : null}
        <Button variant="danger" size="sm" onClick={() => logout.mutate()}>
          {t('common.signOut')}
        </Button>
      </section>

      <p className="text-center text-xs text-muted">{t('app.tagline')}</p>
    </div>
  )
}
