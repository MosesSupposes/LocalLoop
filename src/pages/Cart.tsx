import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { Empty, Field, btnGhost, btnPrimary, card } from '../components/ui'
import { STORE } from '../lib/config'
import { hasRestricted, money, priceCart, subtotalOf, toOrderItems } from '../lib/orders'
import { paymentNote } from '../lib/chatbot'
import { useStore } from '../lib/store'
import type { PaymentMethod } from '../lib/types'

function useCartView() {
  const products = useStore((s) => s.products)
  const cart = useStore((s) => s.cart)
  const items = toOrderItems(cart, products)
  return { items, subtotal: subtotalOf(items) }
}

export function Cart() {
  const { items, subtotal } = useCartView()
  const setQty = useStore((s) => s.setQty)
  const stock = useStore((s) => s.products)
  const price = priceCart(subtotal)

  if (!items.length) return <Empty emoji="🛒" title="Your cart is empty"><Link to="/" className="text-primary underline">Browse the shop</Link></Empty>

  return (
    <div className="mx-auto max-w-xl space-y-4">
      <h1 className="font-display text-3xl font-extrabold">Cart</h1>
      <ul className="space-y-2">
        {items.map((i) => {
          const max = stock.find((p) => p.id === i.productId)?.stock ?? 0
          return (
            <li key={i.productId} className={`${card} flex items-center justify-between gap-3`}>
              <div>
                <p className="font-semibold">{i.name}</p>
                <p className="font-mono text-sm text-muted">{money(i.priceCents)}</p>
              </div>
              <div className="flex items-center gap-2">
                <button className={`${btnGhost} !w-11 !px-0`} aria-label={`Remove one ${i.name}`} onClick={() => setQty(i.productId, i.qty - 1)}>−</button>
                <span className="w-6 text-center font-mono">{i.qty}</span>
                <button className={`${btnGhost} !w-11 !px-0`} aria-label={`Add one ${i.name}`} disabled={i.qty >= max} onClick={() => setQty(i.productId, i.qty + 1)}>+</button>
              </div>
            </li>
          )
        })}
      </ul>
      <Totals price={price} />
      {subtotal < STORE.minOrderCents && <p className="text-sm text-sunset">Minimum order is {money(STORE.minOrderCents)}.</p>}
      <Link to="/checkout" aria-disabled={subtotal < STORE.minOrderCents} className={`${btnPrimary} w-full ${subtotal < STORE.minOrderCents ? 'pointer-events-none opacity-40' : ''}`}>Checkout</Link>
    </div>
  )
}

function Totals({ price }: { price: ReturnType<typeof priceCart> }) {
  const row = (l: string, v: number, strong = false) => (
    <div className={`flex justify-between ${strong ? 'text-lg font-bold' : 'text-sm text-muted'}`}><span>{l}</span><span className="font-mono">{money(v)}</span></div>
  )
  return (
    <div className={`${card} space-y-1`}>
      {row('Subtotal', price.subtotalCents)}
      {row('Delivery', price.deliveryFeeCents)}
      {row('Service fee', price.serviceFeeCents)}
      {price.tipCents > 0 && row('Driver tip', price.tipCents)}
      {row('Total', price.totalCents, true)}
    </div>
  )
}

const PAY: { id: PaymentMethod; label: string; hint: string }[] = [
  { id: 'card', label: 'Card (Stripe)', hint: 'We text you a secure Stripe payment link.' },
  { id: 'btc', label: 'Bitcoin', hint: 'We text the wallet address; the team confirms the transfer.' },
  { id: 'cash', label: 'Cash on delivery', hint: 'Pay your driver at the door.' },
]

export function Checkout() {
  const nav = useNavigate()
  const { items, subtotal } = useCartView()
  const customer = useStore((s) => s.customer)
  const cart = useStore((s) => s.cart)
  const placeOrder = useStore((s) => s.placeOrder)
  const clearCart = useStore((s) => s.clearCart)
  const [f, setF] = useState({ ...customer, notes: '', medCard: '' })
  const [payment, setPayment] = useState<PaymentMethod>('card')
  const [tip, setTip] = useState(300)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const restricted = hasRestricted(items)
  const price = priceCart(subtotal, tip)
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value })

  if (!items.length) return <Empty emoji="🛒" title="Nothing to check out"><Link to="/" className="text-primary underline">Browse the shop</Link></Empty>

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setBusy(true)
    setError('')
    const r = await placeOrder({ items: cart, name: f.name, phone: f.phone, address: f.address, zip: f.zip, payment, tipCents: tip, medCard: f.medCard, notes: f.notes })
    setBusy(false)
    if (!r.ok) return setError(r.error)
    clearCart()
    if (r.order.paymentUrl) window.location.assign(r.order.paymentUrl)
    else nav(`/order/${r.order.id}`)
  }

  return (
    <form onSubmit={submit} className="mx-auto grid max-w-4xl gap-6 md:grid-cols-2">
      <div className="space-y-3">
        <h1 className="font-display text-3xl font-extrabold">Delivery details</h1>
        <Field label="Name"><input required value={f.name} onChange={set('name')} autoComplete="name" /></Field>
        <Field label="Mobile number"><input required type="tel" inputMode="tel" value={f.phone} onChange={set('phone')} autoComplete="tel" placeholder="302-555-0123" /></Field>
        <Field label="Street address"><input required value={f.address} onChange={set('address')} autoComplete="street-address" /></Field>
        <Field label="ZIP"><input required inputMode="numeric" maxLength={5} value={f.zip} onChange={set('zip')} autoComplete="postal-code" /></Field>
        <Field label="Notes for driver (optional)"><textarea rows={2} value={f.notes} onChange={set('notes')} /></Field>
        {restricted && (
          <div className={`${card} space-y-2 border-sunset/40`}>
            <p className="text-sm">Medicinal herbs in your order. Enter your Delaware medical marijuana registry card number. The driver verifies your ID and card at the door.</p>
            <input required minLength={4} value={f.medCard} onChange={set('medCard')} placeholder="Registry card number" aria-label="Registry card number" />
          </div>
        )}
      </div>
      <div className="space-y-4">
        <fieldset className="space-y-2">
          <legend className="mb-1 font-display text-xl font-bold">Payment</legend>
          {PAY.map((p) => (
            <label key={p.id} className={`${card} flex cursor-pointer items-start gap-3 ${payment === p.id ? 'border-primary shadow-glow' : ''}`}>
              <input type="radio" name="pay" className="mt-1 !h-5 !w-5 !min-h-0" checked={payment === p.id} onChange={() => setPayment(p.id)} />
              <span><b>{p.label}</b><br /><span className="text-sm text-muted">{p.hint}</span></span>
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend className="mb-1 text-sm text-muted">Driver tip</legend>
          <div className="flex gap-2">
            {[0, 200, 300, 500].map((t) => (
              <button type="button" key={t} onClick={() => setTip(t)} className={`${btn2(tip === t)} flex-1`}>{money(t)}</button>
            ))}
          </div>
        </fieldset>
        <Totals price={price} />
        {error && <p role="alert" className="text-destructive">{error}</p>}
        <button className={`${btnPrimary} w-full`} type="submit" disabled={busy}>{busy ? 'Placing order…' : `Place order · ${money(price.totalCents)}`}</button>
        <p className="text-center text-xs text-muted">{paymentNote({ payment, totalCents: price.totalCents })}</p>
      </div>
    </form>
  )
}

const btn2 = (on: boolean) => `rounded-full border px-3 font-mono text-sm ${on ? 'border-primary bg-primary text-primary-foreground' : 'border-line bg-surface'}`
