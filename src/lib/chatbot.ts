import { CATEGORIES } from './catalog'
import { HOURS_SUMMARY, STORE } from './config'
import { hasRestricted, inDeliveryZone, money, normalizePhone, priceCart, subtotalOf, toOrderItems, STATUS_LABEL } from './orders'
import type { CartLine, Order, PaymentMethod, Product, PublicOrder, TicketType } from './types'

export type BotStep =
  | 'idle' | 'items' | 'more' | 'name' | 'phone' | 'address' | 'zip' | 'payment' | 'medcard' | 'confirm'
  | 'ticket_subject' | 'ticket_phone' | 'track'

export interface Draft {
  items: CartLine[]
  name?: string
  phone?: string
  address?: string
  zip?: string
  payment?: PaymentMethod
  medCard?: string
  ticketSubject?: string
}

export interface BotState {
  step: BotStep
  draft: Draft
}

export interface BotCtx {
  products: Product[]
  orders: PublicOrder[]
  open: boolean
  placeOrder: (d: Required<Pick<Draft, 'name' | 'phone' | 'address' | 'zip' | 'payment'>> & Pick<Draft, 'items' | 'medCard'>) => Promise<{ ok: true; order: PublicOrder } | { ok: false; error: string }>
  createTicket: (a: { subject: string; type: TicketType; phone: string; name: string; orderId?: string }) => Promise<{ id: string } | null>
}

export interface BotResult {
  state: BotState
  replies: string[]
  quick: string[]
}

export const INITIAL_BOT: BotState = { step: 'idle', draft: { items: [] } }
export const GREETING = `Hey, I'm the Smokology bot. I can take your order, answer questions, check an order, or open a support ticket.`
export const MENU_QUICK = ['Start an order', 'Hours & delivery', 'Where is my order?', 'Talk to a human']

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim()
const stem = (w: string) => w.replace(/s$/, '')

export function parseItems(text: string, products: Product[]): { lines: CartLine[]; missed: string[] } {
  const lines: CartLine[] = []
  const missed: string[] = []
  for (const seg of text.split(/,|\band\b|&|\n/i)) {
    const m = seg.trim().match(/^(\d{1,2})\s*x?\s*(.*)$/i)
    const qty = m ? Math.max(1, Number(m[1])) : 1
    const q = norm(m ? m[2] : seg)
    if (q.length < 3) continue
    const words = q.split(' ').map(stem)
    let best: Product | undefined
    let bestScore = 0
    for (const pr of products) {
      const nameWords = norm(pr.name).split(' ').map(stem)
      const hit = words.filter((w) => nameWords.includes(w)).length
      const score = hit / Math.max(words.length, 1) + (hit === nameWords.length ? 0.5 : 0)
      if (hit === words.length && score > bestScore) { best = pr; bestScore = score }
    }
    if (best) {
      const line = lines.find((l) => l.productId === best!.id)
      if (line) line.qty += qty
      else lines.push({ productId: best.id, qty })
    } else missed.push(seg.trim())
  }
  return { lines, missed }
}

function listCategory(id: string, products: Product[]) {
  const cat = CATEGORIES.find((c) => c.id === id)!
  const rows = products.filter((p) => p.category === id && p.stock > 0).map((p) => `${p.emoji} ${p.name} — ${money(p.priceCents)}`)
  return `${cat.emoji} ${cat.label}:\n${rows.join('\n')}`
}

function matchCategory(text: string) {
  const t = norm(text)
  return CATEGORIES.find((c) => t.includes(norm(c.label)) || t === c.id || (c.id === 'herbs' && /\b(herb|flower|gummies|tincture)\b/.test(t)))
}

function summary(d: Draft, products: Product[]) {
  const items = toOrderItems(d.items, products)
  const price = priceCart(subtotalOf(items))
  const rows = items.map((i) => `${i.qty} x ${i.name} — ${money(i.priceCents * i.qty)}`)
  return { items, price, text: `${rows.join('\n')}\nSubtotal ${money(price.subtotalCents)} · Delivery ${money(price.deliveryFeeCents)} · Service ${money(price.serviceFeeCents)}\nTotal ${money(price.totalCents)}` }
}

const yes = (t: string) => /^(y|yes|yep|yeah|confirm|ok|okay|sure|place it|that'?s it|done|no more|nope|nothing|no)\b/i.test(t)
const isNo = (t: string) => /^(n|no|nope|nothing|no more|that'?s it|done)\b/i.test(t)

export async function botReply(state: BotState, input: string, ctx: BotCtx): Promise<BotResult> {
  const text = input.trim()
  const t = norm(text)
  let { step, draft } = state
  const out = (replies: string[], quick: string[] = [], next: BotStep = step, d: Draft = draft): BotResult => ({
    state: { step: next, draft: d }, replies, quick,
  })

  if (/^(cancel|start over|reset|nevermind|never mind)$/.test(t)) return out(['No problem, I cleared that. What else can I do?'], MENU_QUICK, 'idle', { items: [] })

  // Global intents (don't interrupt the middle of address/payment entry).
  const midForm = ['name', 'phone', 'address', 'zip', 'payment', 'medcard', 'ticket_subject', 'ticket_phone', 'track'].includes(step)
  if (!midForm) {
    if (/\b(human|agent|person|manager|complaint|refund|problem|issue|ticket|wrong|missing|late)\b/.test(t)) {
      return out(['Sorry about that. I will open a support ticket for the team. In one sentence, what happened?'], [], 'ticket_subject', { ...draft, ticketSubject: undefined })
    }
    if (/\b(where|status|track|eta|driver)\b/.test(t)) {
      return out(['Sure. What phone number did you order with?'], [], 'track')
    }
    if (/\b(hours?|open|opens|closes?|closed|when)\b/.test(t) && step === 'idle') {
      return out([`We're ${ctx.open ? 'open now' : 'closed right now'}, ${HOURS_SUMMARY}. Delivery is ${money(STORE.deliveryFeeCents)} (free over ${money(STORE.freeDeliveryOverCents)}), min order ${money(STORE.minOrderCents)}. Zip codes: ${STORE.deliveryZips.join(', ')}.`], MENU_QUICK)
    }
    if (/\b(pay|payment|bitcoin|btc|stripe|card)\b/.test(t) && step === 'idle') {
      return out(['We take card (Stripe), Bitcoin, and cash on delivery. For card we text you a secure Stripe link; for Bitcoin we send the wallet address and the team confirms the transfer.'], MENU_QUICK)
    }
    if (/\b(legal|law|medical|card|id|age|21|compliance)\b/.test(t) && step === 'idle') {
      return out([`Everything is 21+ and follows Delaware law. Medicinal herbs need an active Delaware medical marijuana registry card; the driver checks your ID and card at the door and cannot hand over restricted items without both.`], MENU_QUICK)
    }
  }

  switch (step) {
    case 'idle': {
      if (/\b(order|buy|get|want|menu|hungry|snack|start)\b/.test(t) || matchCategory(text)) {
        const cat = matchCategory(text)
        const parsed = parseItems(text, ctx.products)
        if (parsed.lines.length) return addItems(parsed, text)
        if (cat) return out([listCategory(cat.id, ctx.products), 'Tell me what you want, like "2 smash burger combo, 1 sparkling lemonade".'], CATEGORIES.map((c) => c.label), 'items')
        return out(['Pick a category or just tell me what you want.'], CATEGORIES.map((c) => c.label), 'items')
      }
      return out([`I can help with orders, hours, payments, tracking, or a ticket for the team. You can also call or text us at ${STORE.phoneDisplay}.`], MENU_QUICK)
    }
    case 'items':
    case 'more': {
      if (step === 'more' && isNo(t)) return out(['Great. What name should I put on the order?'], [], 'name')
      const cat = matchCategory(text)
      const parsed = parseItems(text, ctx.products)
      if (!parsed.lines.length && cat) return out([listCategory(cat.id, ctx.products)], CATEGORIES.map((c) => c.label))
      return addItems(parsed, text)
    }
    case 'name': {
      if (text.length < 2) return out(['What name should I put on the order?'])
      return out([`Thanks ${text}. What's your mobile number? The driver's number is sent to it once you're on the way.`], [], 'phone', { ...draft, name: text })
    }
    case 'phone': {
      const ph = normalizePhone(text)
      if (!ph) return out(['That doesn\'t look like a US number. Try 10 digits, like 302-555-0123.'])
      return out(['Delivery address (street and unit)?'], [], 'address', { ...draft, phone: ph })
    }
    case 'address': {
      if (text.length < 5) return out(['I need a street address to deliver.'])
      return out(['And the ZIP code?'], [], 'zip', { ...draft, address: text })
    }
    case 'zip': {
      const zip = text.match(/\d{5}/)?.[0]
      if (!zip) return out(['Please send a 5-digit ZIP.'])
      if (!inDeliveryZone(zip)) return out([`We don't deliver to ${zip} yet. Current zips: ${STORE.deliveryZips.join(', ')}. Try another address ZIP, or say "cancel".`])
      return out(['How would you like to pay?'], ['Card (Stripe)', 'Bitcoin', 'Cash on delivery'], 'payment', { ...draft, zip })
    }
    case 'payment': {
      const payment: PaymentMethod | undefined = /btc|bitcoin|crypto/.test(t) ? 'btc' : /cash/.test(t) ? 'cash' : /card|stripe|credit|debit/.test(t) ? 'card' : undefined
      if (!payment) return out(['Choose card, Bitcoin, or cash on delivery.'], ['Card (Stripe)', 'Bitcoin', 'Cash on delivery'])
      const d = { ...draft, payment }
      const items = toOrderItems(d.items, ctx.products)
      if (hasRestricted(items)) return out(['Your order has medicinal herbs. Send your Delaware medical marijuana registry card number. The driver will verify your ID and card at the door.'], [], 'medcard', d)
      return confirm(d)
    }
    case 'medcard': {
      if (text.replace(/\s/g, '').length < 4) return out(['Please send your registry card number.'])
      return confirm({ ...draft, medCard: text })
    }
    case 'confirm': {
      if (!yes(text) || isNo(text)) return out(['Okay, I didn\'t place it. Say "start over" to begin again, or tell me what to change.'], ['Start over'], 'idle', { items: [] })
      const res = await ctx.placeOrder({
        items: draft.items, name: draft.name!, phone: draft.phone!, address: draft.address!, zip: draft.zip!, payment: draft.payment!, medCard: draft.medCard,
      })
      if (!res.ok) return out([res.error], ['Start over'], 'idle', { items: [] })
      const pay = paymentNote(res.order)
      return out([`Order ${res.order.id.toUpperCase()} is in. ${pay}`, `Track it any time on the Orders tab. When your driver is on the way, I'll show their direct number there and in this chat.`], MENU_QUICK, 'idle', { items: [] })
    }
    case 'track': {
      const ph = normalizePhone(text)
      if (!ph) return out(['That doesn\'t look like a US number. Try again.'])
      const mine = ctx.orders.filter((o) => o.phone === ph).sort((a, b) => b.createdAt - a.createdAt)[0]
      if (!mine) return out(['I couldn\'t find an order for that number. Want me to open a ticket?'], ['Talk to a human'], 'idle')
      const driver = mine.driver
      const base = `Order ${mine.id.toUpperCase()}: ${STATUS_LABEL[mine.status]}.`
      const extra = mine.status === 'out_for_delivery' && driver ? ` Your driver ${driver.name} can be reached directly at ${driver.phone}.` : ''
      return out([base + extra], MENU_QUICK, 'idle')
    }
    case 'ticket_subject': {
      if (text.length < 4) return out(['Give me a few more words so the team knows what happened.'])
      return out(['What phone number should the team reach you at?'], [], 'ticket_phone', { ...draft, ticketSubject: text })
    }
    case 'ticket_phone': {
      const ph = normalizePhone(text)
      if (!ph) return out(['That doesn\'t look like a US number. Try again.'])
      const mine = ctx.orders.filter((o) => o.phone === ph).sort((a, b) => b.createdAt - a.createdAt)[0]
      const subject = draft.ticketSubject ?? 'Customer request'
      const type: TicketType = /refund|charge/.test(norm(subject)) ? 'refund' : mine ? 'order_issue' : 'question'
      const tk = await ctx.createTicket({ subject, type, phone: ph, name: mine?.customerName ?? draft.name ?? 'Customer', orderId: mine?.id })
      if (!tk) return out(['I couldn\'t open the ticket right now. Please call or text the shop instead.'], MENU_QUICK, 'idle', { items: [] })
      return out([`Ticket ${tk.id.toUpperCase()} is open${mine ? ` and linked to order ${mine.id.toUpperCase()}` : ''}. A team member will text or call ${ph}. Replies also show on your Orders tab.`], MENU_QUICK, 'idle', { items: [] })
    }
  }

  function addItems(parsed: { lines: CartLine[]; missed: string[] }, raw: string): BotResult {
    if (!parsed.lines.length) {
      return out([`I didn't catch "${raw}". Try an item name from the menu, like "mac & cheese bowl".`], CATEGORIES.map((c) => c.label), 'items')
    }
    const lines = [...draft.items]
    const notes: string[] = []
    for (const l of parsed.lines) {
      const pr = ctx.products.find((p) => p.id === l.productId)!
      const have = lines.find((x) => x.productId === l.productId)?.qty ?? 0
      const qty = Math.min(l.qty, pr.stock - have)
      if (qty <= 0) { notes.push(`${pr.name} is out of stock.`); continue }
      if (qty < l.qty) notes.push(`Only ${pr.stock} ${pr.name} left, added ${qty}.`)
      const ex = lines.find((x) => x.productId === l.productId)
      if (ex) ex.qty += qty
      else lines.push({ productId: l.productId, qty })
    }
    if (parsed.missed.length) notes.push(`Couldn't find: ${parsed.missed.join(', ')}.`)
    const d = { ...draft, items: lines }
    if (!lines.length) return out(notes, CATEGORIES.map((c) => c.label), 'items', d)
    return out([...notes, `Got it:\n${summary(d, ctx.products).text}`, 'Anything else?'], ['No, that\'s it', ...CATEGORIES.map((c) => c.label)], 'more', d)
  }

  function confirm(d: Draft): BotResult {
    const s = summary(d, ctx.products)
    if (s.price.subtotalCents < STORE.minOrderCents) {
      return out([`The minimum order is ${money(STORE.minOrderCents)}. Add a few more items.`], CATEGORIES.map((c) => c.label), 'more', d)
    }
    return out([`Please confirm:\n${s.text}\nPay by ${d.payment === 'btc' ? 'Bitcoin' : d.payment === 'card' ? 'card (Stripe)' : 'cash'}\nTo: ${d.address}, ${d.zip}`, 'Place this order?'], ['Yes, place it', 'No'], 'confirm', d)
  }

  return out(['Something went sideways. Say "start over" to reset.'], MENU_QUICK, 'idle', { items: [] })
}

export function paymentNote(o: Pick<Order, 'payment' | 'totalCents'> & { paymentUrl?: string }) {
  if (o.paymentUrl) return `Pay ${money(o.totalCents)} securely with the Pay now button on your order page.`
  if (o.payment === 'card') return `We'll text you a secure Stripe payment link for ${money(o.totalCents)}.`
  if (o.payment === 'btc') return `We'll text the Bitcoin wallet address for ${money(o.totalCents)}; the team confirms the transfer before dispatch.`
  return `Have ${money(o.totalCents)} in cash ready at the door.`
}
