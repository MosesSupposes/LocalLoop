import { AnimatePresence, motion } from 'framer-motion'
import type { ButtonHTMLAttributes, InputHTMLAttributes, ReactNode } from 'react'
import { useEffect } from 'react'
import { initials, tileGradient } from '../lib/format'

export const cx = (...parts: (string | false | null | undefined)[]) => parts.filter(Boolean).join(' ')

type ButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'sunset' | 'ghost' | 'surface' | 'danger'
  size?: 'sm' | 'md' | 'lg'
  full?: boolean
}

const VARIANTS: Record<string, string> = {
  primary: 'bg-primary text-primary-foreground hover:brightness-105 active:brightness-95',
  sunset: 'text-white gradient-sunset glow-sunset',
  ghost: 'bg-transparent text-foreground hover:bg-surface-raised',
  surface: 'bg-surface-raised text-foreground border border-line hover:brightness-110',
  danger: 'bg-destructive/15 text-destructive border border-destructive/40 hover:bg-destructive/25',
}

const SIZES: Record<string, string> = {
  sm: 'min-h-9 px-3 text-sm',
  md: 'min-h-11 px-4 text-sm', // 44px minimum tap target
  lg: 'min-h-13 px-6 text-base',
}

export function Button({ variant = 'primary', size = 'md', full, className, ...rest }: ButtonProps) {
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-2 rounded-full font-semibold transition',
        'disabled:cursor-not-allowed disabled:opacity-50',
        VARIANTS[variant],
        SIZES[size],
        full && 'w-full',
        className,
      )}
    />
  )
}

export function Card({ children, className, raised }: { children: ReactNode; className?: string; raised?: boolean }) {
  return <div className={cx(raised ? 'surface-raised' : 'surface-card', 'p-4', className)}>{children}</div>
}

export function Pill({
  children,
  tone = 'neutral',
  className,
}: {
  children: ReactNode
  tone?: 'neutral' | 'open' | 'closed' | 'sunset' | 'sky' | 'pink'
  className?: string
}) {
  const tones: Record<string, string> = {
    neutral: 'bg-surface-raised text-muted border-line',
    open: 'bg-success/15 text-success border-success/30',
    closed: 'bg-surface-raised text-muted border-line',
    sunset: 'bg-sunset/15 text-sunset border-sunset/40',
    sky: 'bg-sky/15 text-sky border-sky/40',
    pink: 'bg-pink/15 text-pink border-pink/40',
  }
  return (
    <span
      className={cx(
        'inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs font-semibold tracking-wide',
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  )
}

export function Badge({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-full bg-surface-raised px-2 py-0.5 font-mono text-[11px] text-muted">{children}</span>
  )
}

export function Chip({
  active,
  children,
  onClick,
  pressedLabel,
}: {
  active?: boolean
  children: ReactNode
  onClick: () => void
  pressedLabel?: string
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={Boolean(active)}
      className={cx(
        'inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-sm font-semibold transition',
        active ? 'border-primary bg-primary/15 text-primary glow-primary' : 'border-line bg-surface text-muted hover:text-foreground',
      )}
    >
      {children}
      {active && pressedLabel ? <span className="sr-only">{pressedLabel}</span> : null}
    </button>
  )
}

export function Skeleton({ className }: { className?: string }) {
  return <div className={cx('skeleton rounded-card', className)} />
}

export function SectionHeader({ title, action }: { title: string; action?: ReactNode }) {
  return (
    <div className="mb-3 flex items-end justify-between gap-3">
      <h2 className="font-display text-xl font-bold tracking-tight">{title}</h2>
      {action}
    </div>
  )
}

export function EmptyState({ title, hint, glyph, action }: { title: string; hint?: string; glyph?: string; action?: ReactNode }) {
  return (
    <Card className="flex flex-col items-center gap-2 py-8 text-center">
      {glyph ? <div className="text-3xl">{glyph}</div> : null}
      <p className="font-display text-base font-semibold">{title}</p>
      {hint ? <p className="max-w-xs text-sm text-muted">{hint}</p> : null}
      {action}
    </Card>
  )
}

export function ErrorState({ message, onRetry, retryLabel }: { message: string; onRetry?: () => void; retryLabel?: string }) {
  return (
    <Card className="border-destructive/40">
      <p className="font-semibold text-destructive">{message}</p>
      {onRetry ? (
        <Button variant="surface" size="sm" className="mt-3" onClick={onRetry}>
          {retryLabel ?? 'Try again'}
        </Button>
      ) : null}
    </Card>
  )
}

export function Stat({ value, label, tone }: { value: string | number; label: string; tone?: 'primary' | 'sunset' | 'sky' }) {
  const colors = { primary: 'text-primary', sunset: 'text-sunset', sky: 'text-sky' }
  return (
    <div className="surface-card px-3 py-2.5">
      <div className={cx('font-mono text-lg font-semibold', tone ? colors[tone] : 'text-foreground')}>{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  )
}

export function Tile({ seed, label, glyph, size = 44 }: { seed: string; label: string; glyph?: string; size?: number }) {
  return (
    <div
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-2xl border border-line font-display font-bold text-white"
      style={{ backgroundImage: tileGradient(seed), width: size, height: size, fontSize: size / 2.6 }}
    >
      {glyph ?? initials(label)}
    </div>
  )
}

export function Field({
  label,
  hint,
  ...rest
}: InputHTMLAttributes<HTMLInputElement> & { label: string; hint?: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-muted">{label}</span>
      <input
        {...rest}
        className="min-h-11 w-full rounded-2xl border border-line bg-surface px-3 text-foreground placeholder:text-muted/60"
      />
      {hint ? <span className="mt-1 block text-xs text-muted">{hint}</span> : null}
    </label>
  )
}

export function Select({
  label,
  children,
  ...rest
}: { label: string; children: ReactNode } & React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <label className="block">
      <span className="mb-1 block text-sm font-semibold text-muted">{label}</span>
      <select
        {...rest}
        className="min-h-11 w-full rounded-2xl border border-line bg-surface px-3 text-foreground"
      >
        {children}
      </select>
    </label>
  )
}

export function Sheet({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: ReactNode
}) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    if (open) document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [open, onClose])

  return (
    <AnimatePresence>
      {open ? (
        <motion.div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-0 backdrop-blur-sm sm:items-center sm:p-6"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          onClick={onClose}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            role="dialog"
            aria-label={title}
            aria-modal="true"
            className="max-h-[88vh] w-full overflow-y-auto rounded-t-sheet border border-line bg-surface p-5 sm:max-w-lg sm:rounded-sheet"
            initial={{ y: 80, opacity: 0.6 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 60, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 260, damping: 26 }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mb-4 flex items-start justify-between gap-4">
              <h2 className="font-display text-xl font-bold">{title}</h2>
              <Button variant="ghost" size="sm" onClick={onClose} aria-label="Close">
                ✕
              </Button>
            </div>
            {children}
          </motion.div>
        </motion.div>
      ) : null}
    </AnimatePresence>
  )
}

export function Banner({ children, tone = 'sunset' }: { children: ReactNode; tone?: 'sunset' | 'sky' | 'muted' }) {
  const tones = {
    sunset: 'border-sunset/40 bg-sunset/10 text-sunset',
    sky: 'border-sky/40 bg-sky/10 text-sky',
    muted: 'border-line bg-surface text-muted',
  }
  return <div className={cx('rounded-2xl border px-3 py-2 text-sm', tones[tone])}>{children}</div>
}
