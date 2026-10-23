import { useEffect, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useUI } from '../lib/store'
import { useI18n } from '../lib/i18n'
import { useCart, useConfig, useLogout, useSession } from '../lib/queries'
import { Button, Sheet, cx } from './ui'
import { SignInPanel } from './SignInPanel'
import { CartPanel } from './CartPanel'

export function AppShell({ children }: { children: React.ReactNode }) {
  const { t, locale, setLocale } = useI18n()
  const theme = useUI((s) => s.theme)
  const setTheme = useUI((s) => s.setTheme)
  const user = useUI((s) => s.user)
  const setUser = useUI((s) => s.setUser)
  const session = useSession()
  const config = useConfig()
  const cart = useCart()
  const logout = useLogout()
  const location = useLocation()
  const [signInOpen, setSignInOpen] = useState(false)
  const [cartOpen, setCartOpen] = useState(false)

  useEffect(() => {
    if (session.data) setUser(session.data.user)
  }, [session.data, setUser])

  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  useEffect(() => {
    document.documentElement.lang = locale
  }, [locale])

  const itemCount = (cart.data?.carts ?? []).reduce((sum, c) => sum + c.itemCount, 0)
  const isMerchant = user?.roles.includes('merchant')
  const isAdmin = user?.roles.includes('admin')

  const navItem = ({ isActive }: { isActive: boolean }, extra = '') =>
    cx(
      'flex min-h-12 flex-col items-center justify-center gap-0.5 rounded-2xl px-3 text-xs font-semibold transition',
      isActive ? 'bg-primary/15 text-primary' : 'text-muted hover:text-foreground',
      extra,
    )

  return (
    <div className="mx-auto flex min-h-dvh w-full max-w-5xl flex-col px-4 pb-28 pt-4 sm:px-6 sm:pb-10">
      <header className="mb-5 flex flex-wrap items-center justify-between gap-3">
        <Link to="/" className="flex items-center gap-2.5">
          <span
            aria-hidden
            className="flex h-10 w-10 items-center justify-center rounded-2xl text-lg font-bold text-primary-foreground glow-primary"
            style={{ background: 'var(--primary)' }}
          >
            LL
          </span>
          <span className="leading-tight">
            <span className="block font-display text-lg font-bold tracking-tight">LocalLoop</span>
            <span className="block text-xs text-muted">{t('app.tagline')}</span>
          </span>
        </Link>

        <div className="flex items-center gap-2">
          <div className="flex rounded-full border border-line bg-surface p-0.5" role="group" aria-label={t('common.language')}>
            {(['en', 'es'] as const).map((code) => (
              <button
                key={code}
                type="button"
                onClick={() => setLocale(code)}
                aria-pressed={locale === code}
                className={cx(
                  'min-h-9 rounded-full px-3 text-xs font-bold uppercase transition',
                  locale === code ? 'bg-primary text-primary-foreground' : 'text-muted',
                )}
              >
                {code}
              </button>
            ))}
          </div>
          <Button
            variant="surface"
            size="sm"
            onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
            aria-label={t('common.theme')}
          >
            {theme === 'dark' ? '🌙' : '☀️'}
          </Button>
          <Button
            variant="surface"
            size="sm"
            aria-label={t('common.viewCart')}
            onClick={() => setCartOpen(true)}
          >
            <span aria-hidden>🛍️</span> <span className="font-mono">{itemCount}</span>
          </Button>
          {user ? (
            <Button variant="ghost" size="sm" onClick={() => logout.mutate()}>
              {t('common.signOut')}
            </Button>
          ) : (
            <Button size="sm" onClick={() => setSignInOpen(true)}>
              {t('common.signIn')}
            </Button>
          )}
        </div>
      </header>

      <main className="flex-1">{children}</main>

      <nav className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface/95 px-3 pb-[env(safe-area-inset-bottom)] pt-2 backdrop-blur sm:sticky sm:bottom-4 sm:mt-6 sm:rounded-3xl sm:border sm:px-4">
        <div className="mx-auto flex max-w-3xl items-stretch justify-between gap-1">
          <NavLink to="/" end className={(s) => navItem(s)}>
            <span aria-hidden>🏠</span>
            {t('nav.home')}
          </NavLink>
          <NavLink to="/explore" className={(s) => navItem(s)}>
            <span aria-hidden>🗺️</span>
            {t('nav.explore')}
          </NavLink>
          <NavLink to="/orders" className={(s) => navItem(s)}>
            <span aria-hidden>🧾</span>
            {t('nav.orders')}
          </NavLink>
          {isMerchant ? (
            <NavLink to="/merchant" className={(s) => navItem(s)}>
              <span aria-hidden>🧑‍🍳</span>
              {t('nav.merchant')}
            </NavLink>
          ) : null}
          {isAdmin ? (
            <NavLink to="/admin" className={(s) => navItem(s)}>
              <span aria-hidden>🧭</span>
              {t('nav.admin')}
            </NavLink>
          ) : null}
          <NavLink to="/profile" className={(s) => navItem(s)}>
            <span aria-hidden>🙂</span>
            {t('nav.profile')}
          </NavLink>
        </div>
      </nav>

      <Sheet open={signInOpen} onClose={() => setSignInOpen(false)} title={t('auth.title')}>
        <SignInPanel
          onDone={() => {
            setSignInOpen(false)
          }}
        />
      </Sheet>

      <Sheet open={cartOpen} onClose={() => setCartOpen(false)} title={t('cart.title')}>
        <CartPanel onCheckout={() => setCartOpen(false)} />
      </Sheet>

      {!config.data?.mapboxToken && location.pathname === '/' ? (
        <p className="mt-6 text-center text-xs text-muted">
          map: {config.data?.map.provider ?? 'neon-canvas'} · payments: {config.data?.integrations.payments ?? '—'} · sms:{' '}
          {config.data?.integrations.sms ?? '—'}
        </p>
      ) : null}
    </div>
  )
}
