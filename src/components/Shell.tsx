import { NavLink, Link, Outlet } from 'react-router-dom'
import { addressLine, HOURS_SUMMARY, isOpenNow, STORE, telHref } from '../lib/config'
import { useStore } from '../lib/store'
import { ChatWidget } from './ChatWidget'
import { Pill } from './ui'

export function Shell() {
  const count = useStore((s) => s.cart.reduce((n, l) => n + l.qty, 0))
  const open = isOpenNow()
  const link = ({ isActive }: { isActive: boolean }) => `rounded-full px-4 py-2 text-sm font-semibold ${isActive ? 'bg-primary/15 text-primary' : 'text-muted'}`
  const tab = ({ isActive }: { isActive: boolean }) => `flex flex-1 flex-col items-center justify-center text-xs ${isActive ? 'text-primary' : 'text-muted'}`

  return (
    <div className="min-h-dvh pb-24 md:pb-8">
      <header className="safe-top sticky top-0 z-30 border-b border-line bg-background/90 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3 px-4 py-2">
          <Link to="/" className="flex items-center gap-2">
            <span className="flex h-8 w-8 items-center justify-center rounded-full border-2 border-primary"><span className="h-2.5 w-2.5 rounded-full bg-primary" /></span>
            <span className="font-display text-lg font-extrabold sm:text-xl">{STORE.name}</span>
          </Link>
          <nav className="hidden items-center gap-1 md:flex" aria-label="Main">
            <NavLink to="/" end className={link}>Shop</NavLink>
            <NavLink to="/orders" className={link}>Orders</NavLink>
            <NavLink to="/cart" className={link}>Cart{count > 0 && ` (${count})`}</NavLink>
          </nav>
          <div className="flex items-center gap-2">
            <Pill tone={open ? 'primary' : 'danger'}>{open ? 'Open now' : 'Closed'}</Pill>
            <a href={telHref(STORE.phone)} className="inline-flex shrink-0 items-center whitespace-nowrap rounded-full border border-line px-3 text-sm font-semibold" aria-label={`Call ${STORE.phoneDisplay}`}>📞 <span className="ml-1 hidden sm:inline">{STORE.phoneDisplay}</span></a>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 pt-4"><Outlet /></main>
      <footer className="mx-auto max-w-6xl px-4 pt-10 text-center text-xs text-muted">
        <p>{addressLine()} · {HOURS_SUMMARY}</p>
        <p className="mt-1">{STORE.name} · {STORE.minAge}+ only · Medicinal herbs sold to Delaware registry card holders. Powered by LocalLoop.</p>
        <Link to="/staff" className="mt-2 inline-flex items-center text-muted underline">Staff sign in</Link>
      </footer>
      <ChatWidget raised />
      <nav className="safe-bottom fixed inset-x-0 bottom-0 z-30 flex h-16 border-t border-line bg-background/95 backdrop-blur md:hidden" aria-label="Tabs">
        <NavLink to="/" end className={tab}><span className="text-xl" aria-hidden>🛍️</span>Shop</NavLink>
        <NavLink to="/orders" className={tab}><span className="text-xl" aria-hidden>📦</span>Orders</NavLink>
        <NavLink to="/cart" className={tab}>
          <span className="relative text-xl"><span aria-hidden>🛒</span>{count > 0 && <b className="absolute -right-3 -top-1 flex h-4 min-w-4 items-center justify-center rounded-full bg-primary px-1 text-[10px] text-primary-foreground">{count}</b>}</span>Cart
        </NavLink>
      </nav>
    </div>
  )
}
