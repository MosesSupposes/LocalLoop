import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import { api, errMsg } from './api'
import { SEED_PRODUCTS } from './catalog'
import { botReply, GREETING, INITIAL_BOT, type BotCtx, type BotState } from './chatbot'
import { isOpenNow } from './config'
import type { CartLine, ChatMessage, PaymentMethod, Product, PublicOrder, Staff, StaffState, Ticket, TicketType } from './types'

export interface PlaceOrderInput {
  items: CartLine[]
  name: string
  phone: string
  address: string
  zip: string
  payment: PaymentMethod
  tipCents?: number
  medCard?: string
  notes?: string
  source?: 'web' | 'chat'
}

type Result<T = unknown> = ({ ok: true } & T) | { ok: false; error: string }
type Refs = Record<string, string>

interface State {
  ageOk: boolean
  products: Product[]
  cart: CartLine[]
  customer: { name: string; phone: string; address: string; zip: string }
  chat: { messages: ChatMessage[]; bot: BotState }
  // Unguessable tokens for this browser's own orders and tickets.
  myOrderTokens: Refs
  myTicketTokens: Refs
  // Everything below is fetched, never persisted.
  myOrders: PublicOrder[]
  myTickets: Ticket[]
  me: Staff | null
  meLoaded: boolean
  staffData: StaffState | null

  verifyAge: () => void
  addToCart: (productId: string, qty?: number) => void
  setQty: (productId: string, qty: number) => void
  clearCart: () => void
  sync: () => Promise<void>
  adoptOrder: (id: string, token: string) => Promise<void>
  placeOrder: (i: PlaceOrderInput) => Promise<Result<{ order: PublicOrder }>>
  createTicket: (a: { subject: string; type: TicketType; phone: string; name: string; orderId?: string }) => Promise<{ id: string } | null>
  customerReply: (ticketId: string, text: string) => Promise<void>
  requestCode: (phone: string) => Promise<Result>
  verifyCode: (phone: string, code: string) => Promise<Result<{ me: Staff }>>
  logout: () => Promise<void>
  act: (path: string, body?: unknown) => Promise<string | null>
  setStock: (productId: string, stock: number) => Promise<void>
  sendChat: (text: string) => Promise<void>
  resetChat: () => void
}

const greet = (): ChatMessage[] => [{ from: 'bot', text: GREETING }]

export const useStore = create<State>()(
  persist(
    (set, get) => ({
      ageOk: false,
      products: SEED_PRODUCTS,
      cart: [],
      customer: { name: '', phone: '', address: '', zip: '' },
      chat: { messages: greet(), bot: INITIAL_BOT },
      myOrderTokens: {},
      myTicketTokens: {},
      myOrders: [],
      myTickets: [],
      me: null,
      meLoaded: false,
      staffData: null,

      verifyAge: () => set({ ageOk: true }),

      addToCart: (productId, qty = 1) =>
        set((s) => {
          const pr = s.products.find((p) => p.id === productId)
          if (!pr) return s
          const have = s.cart.find((l) => l.productId === productId)?.qty ?? 0
          const next = Math.min(have + qty, pr.stock)
          if (next <= 0) return s
          return { cart: have ? s.cart.map((l) => (l.productId === productId ? { ...l, qty: next } : l)) : [...s.cart, { productId, qty: next }] }
        }),
      setQty: (productId, qty) =>
        set((s) => ({ cart: qty <= 0 ? s.cart.filter((l) => l.productId !== productId) : s.cart.map((l) => (l.productId === productId ? { ...l, qty } : l)) })),
      clearCart: () => set({ cart: [] }),

      sync: async () => {
        const s = get()
        const refs = {
          orders: Object.entries(s.myOrderTokens).map(([id, token]) => ({ id, token })),
          tickets: Object.entries(s.myTicketTokens).map(([id, token]) => ({ id, token })),
        }
        const [prod, mine, me] = await Promise.allSettled([
          api<{ products: Product[] }>('/products'),
          refs.orders.length || refs.tickets.length ? api<{ orders: PublicOrder[]; tickets: Ticket[] }>('/lookup', { body: refs }) : Promise.resolve(null),
          api<{ me: Staff | null }>('/me'),
        ])
        const patch: Partial<State> = {}
        if (prod.status === 'fulfilled') patch.products = prod.value.products
        if (mine.status === 'fulfilled' && mine.value) {
          patch.myOrders = mine.value.orders.sort((a, b) => b.createdAt - a.createdAt)
          patch.myTickets = mine.value.tickets
        }
        if (me.status === 'fulfilled') {
          patch.me = me.value.me
          patch.meLoaded = true
          patch.staffData = me.value.me ? await api<StaffState>('/staff/state').catch(() => null) : null
        }
        set(patch)
      },

      adoptOrder: async (id, token) => {
        if (get().myOrderTokens[id] === token) return
        set((s) => ({ myOrderTokens: { ...s.myOrderTokens, [id]: token } }))
        await get().sync()
      },

      placeOrder: async (i) => {
        try {
          const r = await api<{ order: PublicOrder; token: string }>('/orders', { body: { ...i, tipCents: i.tipCents ?? 0 } })
          set((s) => ({
            myOrderTokens: { ...s.myOrderTokens, [r.order.id]: r.token },
            myOrders: [r.order, ...s.myOrders],
            customer: { name: i.name, phone: i.phone, address: i.address, zip: i.zip },
          }))
          void get().sync()
          return { ok: true, order: r.order }
        } catch (e) {
          return { ok: false, error: errMsg(e) }
        }
      },

      createTicket: async (a) => {
        try {
          const r = await api<{ ticket: Ticket; token: string }>('/tickets', { body: a })
          set((s) => ({ myTicketTokens: { ...s.myTicketTokens, [r.ticket.id]: r.token }, myTickets: [r.ticket, ...s.myTickets] }))
          return { id: r.ticket.id }
        } catch {
          return null
        }
      },
      customerReply: async (ticketId, text) => {
        await api(`/tickets/${ticketId}/messages`, { body: { token: get().myTicketTokens[ticketId], text } })
        await get().sync()
      },

      requestCode: async (phone) => {
        try {
          await api('/auth/request', { body: { phone } })
          return { ok: true }
        } catch (e) {
          return { ok: false, error: errMsg(e) }
        }
      },
      verifyCode: async (phone, code) => {
        try {
          const r = await api<{ me: Staff }>('/auth/verify', { body: { phone, code } })
          set({ me: r.me, meLoaded: true })
          await get().sync()
          return { ok: true, me: r.me }
        } catch (e) {
          return { ok: false, error: errMsg(e) }
        }
      },
      logout: async () => {
        await api('/auth/logout', { body: {} }).catch(() => undefined)
        set({ me: null, staffData: null })
      },

      // Staff mutation helper: returns an error message or null, then refreshes.
      act: async (path, body = {}) => {
        try {
          await api(path, { body })
          await get().sync()
          return null
        } catch (e) {
          return errMsg(e)
        }
      },
      setStock: async (productId, stock) => {
        await api(`/products/${productId}`, { method: 'PATCH', body: { stock: Math.max(0, stock) } }).catch(() => undefined)
        await get().sync()
      },

      sendChat: async (text) => {
        const s = get()
        const ctx: BotCtx = {
          products: s.products,
          orders: s.myOrders,
          open: isOpenNow(),
          placeOrder: (d) => get().placeOrder({ ...d, source: 'chat' }),
          createTicket: (a) => get().createTicket(a),
        }
        set({ chat: { ...s.chat, messages: [...s.chat.messages, { from: 'user', text }] } })
        const res = await botReply(s.chat.bot, text, ctx)
        set((c) => ({
          chat: {
            bot: res.state,
            messages: [...c.chat.messages, ...res.replies.map((r, i): ChatMessage => ({ from: 'bot', text: r, quick: i === res.replies.length - 1 ? res.quick : undefined }))],
          },
        }))
      },
      resetChat: () => set({ chat: { messages: greet(), bot: INITIAL_BOT } }),
    }),
    {
      name: 'smokology-store-v2',
      partialize: (s) => ({ ageOk: s.ageOk, cart: s.cart, customer: s.customer, chat: s.chat, myOrderTokens: s.myOrderTokens, myTicketTokens: s.myTicketTokens }),
    },
  ),
)
