import type { ReactNode } from 'react'
import { STATUS_LABEL } from '../lib/orders'
import type { OrderStatus } from '../lib/types'

export const btn = 'inline-flex whitespace-nowrap items-center justify-center gap-2 rounded-full px-5 font-semibold transition active:scale-95 disabled:opacity-40 disabled:active:scale-100'
export const btnPrimary = `${btn} bg-primary text-primary-foreground hover:shadow-glow`
export const btnGhost = `${btn} border border-line bg-surface text-foreground hover:bg-raised`
export const btnSunset = `${btn} bg-sunset text-primary-foreground`
export const card = 'rounded-card border border-line bg-surface p-4'

export function Pill({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'primary' | 'sunset' | 'sky' | 'danger' }) {
  const tones = {
    muted: 'bg-raised text-muted',
    primary: 'bg-primary/15 text-primary',
    sunset: 'bg-sunset/15 text-sunset',
    sky: 'bg-sky/15 text-sky',
    danger: 'bg-destructive/15 text-destructive',
  }
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2.5 py-0.5 text-xs font-semibold ${tones[tone]}`}>{children}</span>
}

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block space-y-1">
      <span className="text-sm text-muted">{label}</span>
      {children}
    </label>
  )
}

export function Empty({ emoji, title, children }: { emoji: string; title: string; children?: ReactNode }) {
  return (
    <div className="py-14 text-center">
      <div className="text-5xl" aria-hidden>{emoji}</div>
      <p className="mt-3 font-display text-xl font-bold">{title}</p>
      <div className="mt-1 text-muted">{children}</div>
    </div>
  )
}

export function StatusTracker({ status }: { status: OrderStatus }) {
  if (status === 'cancelled') return <Pill tone="danger">Cancelled</Pill>
  const steps: OrderStatus[] = ['placed', 'accepted', 'ready', 'out_for_delivery', 'delivered']
  const at = steps.indexOf(status)
  return (
    <ol className="flex items-start" aria-label={`Order status: ${STATUS_LABEL[status]}`}>
      {steps.map((s, i) => (
        <li key={s} className="flex flex-1 flex-col items-center text-center">
          <div className="flex w-full items-center">
            <div className={`h-1 flex-1 ${i === 0 ? 'opacity-0' : i <= at ? 'bg-primary' : 'bg-raised'}`} />
            <div className={`h-4 w-4 rounded-full ${i <= at ? 'bg-primary shadow-glow' : 'bg-raised'}`} />
            <div className={`h-1 flex-1 ${i === steps.length - 1 ? 'opacity-0' : i < at ? 'bg-primary' : 'bg-raised'}`} />
          </div>
          <span className={`mt-1 text-[11px] leading-tight ${i === at ? 'font-bold text-primary' : 'text-muted'}`}>{STATUS_LABEL[s]}</span>
        </li>
      ))}
    </ol>
  )
}
