// Shared API shapes. One place to change when a payload changes.

export type Category = { key: string; labelEn: string; labelEs: string; glyph: string }

export type FeedConfig = {
  mapboxToken: string | null
  map: { provider: 'mapbox' | 'neon-canvas' }
  categories: Category[]
  currency: string
  fees: { platformFeeBps: number; serviceFeeCents: number }
  integrations: { payments: string; sms: string; ai: string }
  center: { lat: number; lng: number }
}

export type LiveChip = {
  id: string
  title: string
  price_cents: number
  qty_left: number
  qty_total: number
  ends_at: string
}

export type MerchantSummary = {
  id: string
  name: string
  slug: string
  category: string
  description: string | null
  logo_url: string | null
  cover_url: string | null
  address: string | null
  phone: string | null
  hours: Hours
  rating_avg: number
  status: string
  accepts_pickup: boolean
  accepts_delivery: boolean
  featured: boolean
  distance_m: number
  walk_minutes: number
  open_now: boolean
  has_live_drop: boolean
  has_active_deal: boolean
  lat?: number
  lng?: number
}

export type Hours = Record<string, [string, string][]>

export type SpeedDialTile = {
  id: string
  name: string
  slug: string
  category: string
  phone: string | null
  rating_avg: number
  open_now: boolean
  speed_dial_slot: number | null
  live_drop: LiveChip | null
  pick: string | null
}

export type LiveDrop = {
  id: string
  title: string
  qty_total: number
  qty_left: number
  price_cents: number
  ends_at: string
  merchant_id: string
  merchant_name: string
  merchant_slug: string
  merchant_category: string
  merchant_phone?: string | null
  item_name: string | null
  item_id: string | null
  distance_m: number
  walk_minutes: number
}

export type Deal = {
  id: string
  title: string
  type: 'percent' | 'fixed' | 'bogo'
  value: number
  ends_at: string
  merchant_id?: string
  merchant_name?: string
  merchant_slug?: string
  category?: string
}

export type HomeFeed = {
  speedDial: SpeedDialTile[]
  liveDrops: LiveDrop[]
  openNow: MerchantSummary[]
  featured: MerchantSummary[]
  deals: Deal[]
  stats: { merchants: number; drops: number; open_now: number }
}

export type ItemOption = {
  id: string
  name: string
  group_name: string
  price_delta_cents: number
  required: boolean
}

export type MenuItem = {
  id: string
  name: string
  description: string | null
  price_cents: number
  unit: string | null
  image_url: string | null
  in_stock: boolean
  stock_qty: number | null
  tags: string[]
  dietary: string[]
  is_commodity: boolean
  freshness_note: string | null
  category_id: string | null
  sort: number
  options: ItemOption[]
  live_drop: LiveChip | null
}

export type Storefront = {
  merchant: MerchantSummary & {
    review_count: number
    is_favorite: boolean
    timezone?: string
  }
  categories: { id: string; name: string; sort: number }[]
  items: MenuItem[]
  deals: Deal[]
  drops: (LiveChip & { item_id: string | null; item_name: string | null })[]
  reviews: { id: string; rating: number; body: string | null; created_at: string; reviewer_name: string }[]
}

export type CartLine = {
  id: string
  item_id: string
  name: string
  unit: string | null
  qty: number
  unit_price_cents: number
  options: { name: string; priceDeltaCents: number }[]
  image_url: string | null
}

export type Cart = {
  id: string
  merchant_id: string
  merchant_name: string
  merchant_slug: string
  merchant_phone: string | null
  accepts_pickup: boolean
  items: CartLine[]
  subtotalCents: number
  itemCount: number
}

export type OrderStatus =
  | 'placed'
  | 'accepted'
  | 'ready'
  | 'picked_up'
  | 'out_for_delivery'
  | 'delivered'
  | 'cancelled'

export type Order = {
  id: string
  code: string
  status: OrderStatus
  fulfillment: string
  items: { id?: string; name: string; qty: number; price_cents: number; options?: unknown }[]
  subtotal_cents: number
  discount_cents?: number
  platform_fee_cents?: number
  service_fee_cents?: number
  tip_cents?: number
  total_cents: number
  payment_status: string
  created_at: string
  updated_at?: string
  pickup_eta: string | null
  note?: string | null
  cancel_reason?: string | null
  merchant_id?: string
  merchant_name: string
  merchant_slug: string
  merchant_phone?: string | null
  merchant_address?: string | null
  category?: string
  item_count?: number
  reviewed?: boolean
  tracker: { steps: OrderStatus[]; currentIndex: number; cancelled: boolean }
}

export type SessionUser = {
  id: string
  display_name: string
  email: string
  phone?: string | null
  locale: string
  home_address?: string | null
  lat?: number | null
  lng?: number | null
  roles: string[]
  loopPoints: number
  favorites: { merchant_id: string; speed_dial_slot: number | null; name: string; slug: string; category: string }[]
  unreadNotifications: number
}

export type MerchantContext = {
  merchants: {
    id: string
    name: string
    slug: string
    status: string
    category: string
    featured: boolean
    hours?: Hours
    open_now: boolean
    open_orders: number
    live_drops: number
    payouts_connected: boolean
  }[]
  roles: string[]
  categories: string[]
  payoutsMode: string
}

export type MerchantOrder = {
  id: string
  code: string
  status: OrderStatus
  total_cents: number
  subtotal_cents: number
  tip_cents: number
  payment_status: string
  note: string | null
  created_at: string
  updated_at: string
  pickup_eta: string | null
  neighbor_name: string
  items: { name: string; qty: number; price_cents: number; options?: unknown }[]
}

export type AdminOverview = {
  summary: {
    live_merchants: number
    pending_merchants: number
    paused_merchants: number
    orders_total: number
    orders_today: number
    gmv_cents: number
    platform_revenue_cents: number
    people: number
    live_drops: number
    neighborhoods: number
  }
  pending: { id: string; name: string; slug: string; category: string; address: string | null; phone: string | null; created_at: string }[]
  topMerchants: { id: string; name: string; slug: string; featured: boolean; status: string; revenue_cents: number; orders: number }[]
  refunds: { id: string; code: string; status: string; total_cents: number; refunded_at: string | null; merchant_name: string }[]
}
