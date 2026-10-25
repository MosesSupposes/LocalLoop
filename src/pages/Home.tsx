import { useState } from 'react'
import { motion } from 'framer-motion'
import { Pill, btnPrimary, Empty } from '../components/ui'
import { CATEGORIES } from '../lib/catalog'
import { isOpenNow, STORE } from '../lib/config'
import { money } from '../lib/orders'
import { useStore } from '../lib/store'
import type { Category } from '../lib/types'

export function Home() {
  const products = useStore((s) => s.products)
  const cart = useStore((s) => s.cart)
  const add = useStore((s) => s.addToCart)
  const [cat, setCat] = useState<Category | 'all'>('all')
  const [q, setQ] = useState('')

  const shown = products.filter((p) => (cat === 'all' || p.category === cat) && p.name.toLowerCase().includes(q.toLowerCase()))

  return (
    <div className="space-y-5">
      <section className="bg-hero rounded-[28px] border border-line p-6 md:p-10">
        <Pill tone={isOpenNow() ? 'primary' : 'danger'}>{isOpenNow() ? 'Delivering now' : 'Closed. Order for tomorrow'}</Pill>
        <h1 className="mt-3 font-display text-3xl font-extrabold sm:text-4xl md:text-6xl">Your block,<br />on speed dial.</h1>
        <p className="mt-2 max-w-md text-muted">Comfort food, snacks, gear and compliant medicinal herbs, delivered to your door in Wilmington, DE.</p>
        <ul className="mt-4 flex flex-wrap gap-2 text-xs">
          {[`Delivery ${money(STORE.deliveryFeeCents)}`, `Free over ${money(STORE.freeDeliveryOverCents)}`, 'Card, Bitcoin or cash'].map((t) => (
            <li key={t} className="rounded-full bg-background/40 px-3 py-1 text-muted">{t}</li>
          ))}
        </ul>
      </section>

      <input type="search" aria-label="Search products" placeholder="Search products" value={q} onChange={(e) => setQ(e.target.value)} />

      <div className="no-scrollbar -mx-4 flex gap-2 overflow-x-auto px-4 py-2" role="tablist" aria-label="Categories">
        {[{ id: 'all' as const, label: 'All', emoji: '✨' }, ...CATEGORIES].map((c) => (
          <button
            key={c.id}
            role="tab"
            aria-selected={cat === c.id}
            onClick={() => setCat(c.id)}
            className={`shrink-0 rounded-full border px-4 text-sm font-semibold ${cat === c.id ? 'border-primary bg-primary text-primary-foreground' : 'border-line bg-surface text-foreground'}`}
          >
            {c.emoji} {c.label}
          </button>
        ))}
      </div>

      {shown.length === 0 ? (
        <Empty emoji="🌙" title="Nothing here yet">Try another category.</Empty>
      ) : (
        <ul className="grid grid-cols-2 gap-3 md:grid-cols-3 lg:grid-cols-4">
          {shown.map((p) => {
            const inCart = cart.find((l) => l.productId === p.id)?.qty ?? 0
            return (
              <motion.li key={p.id} layout className="flex flex-col overflow-hidden rounded-card border border-line bg-surface">
                <div className="relative flex h-28 items-center justify-center bg-raised pt-5 text-5xl" aria-hidden>
                  {p.emoji}
                  {p.restricted && <span className="absolute left-2 top-2"><Pill tone="sunset">Med card</Pill></span>}
                </div>
                <div className="flex flex-1 flex-col gap-1 p-3">
                  <p className="font-semibold leading-tight">{p.name}</p>
                  <p className="line-clamp-2 text-xs text-muted">{p.description}</p>
                  <div className="mt-auto flex items-center justify-between pt-2">
                    <span className="font-mono font-bold">{money(p.priceCents)}</span>
                    {p.stock === 0 ? (
                      <Pill tone="danger">Sold out</Pill>
                    ) : (
                      <button className={`${btnPrimary} !px-4 text-sm`} onClick={() => add(p.id)} aria-label={`Add ${p.name} to cart`}>
                        Add
                      </button>
                    )}
                  </div>
                  {p.stock > 0 && p.stock <= 5 && <span className="text-xs text-sunset">Only {p.stock} left</span>}
                  {inCart > 0 && <span className="text-xs font-semibold text-primary">{inCart} in cart</span>}
                </div>
              </motion.li>
            )
          })}
        </ul>
      )}
    </div>
  )
}
