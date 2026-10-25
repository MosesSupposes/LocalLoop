export type Category = 'comfort' | 'snacks' | 'drinks' | 'merch' | 'gear' | 'herbs'

export interface Product {
  id: string
  name: string
  category: Category
  priceCents: number
  description: string
  emoji: string
  stock: number
  // Medical items require a DE registry card, checked again by the driver at handoff.
  restricted?: 'medical'
}

export interface CartLine {
  productId: string
  qty: number
}

export type Role = 'admin' | 'employee'

export interface Staff {
  id: string
  name: string
  role: Role
  phone: string
  onShift: boolean
}

export type OrderStatus = 'placed' | 'accepted' | 'ready' | 'out_for_delivery' | 'delivered' | 'cancelled'
export type PaymentMethod = 'card' | 'btc' | 'cash'
export type PaymentStatus = 'unpaid' | 'paid' | 'partial_refund' | 'refunded'

export interface OrderItem {
  productId: string
  name: string
  priceCents: number
  qty: number
  restricted?: 'medical'
}

export interface Order {
  id: string
  customerName: string
  phone: string
  address: string
  zip: string
  items: OrderItem[]
  subtotalCents: number
  deliveryFeeCents: number
  serviceFeeCents: number
  tipCents: number
  totalCents: number
  payment: PaymentMethod
  paymentStatus: PaymentStatus
  refundedCents: number
  status: OrderStatus
  medCard?: string
  notes?: string
  batchId?: string
  driverId?: string
  idChecked?: boolean
  source: 'web' | 'chat'
  createdAt: number
}

export type TicketStatus = 'open' | 'in_progress' | 'resolved'
export type TicketType = 'question' | 'order_issue' | 'refund' | 'other'
export type TicketPriority = 'low' | 'normal' | 'high'

export interface TicketMessage {
  from: 'customer' | 'bot' | 'admin' | 'employee'
  text: string
  at: number
}

export interface Ticket {
  id: string
  subject: string
  type: TicketType
  priority: TicketPriority
  status: TicketStatus
  customerName: string
  phone: string
  orderId?: string
  assigneeId?: string
  messages: TicketMessage[]
  createdAt: number
}

export interface ChatMessage {
  from: 'bot' | 'user'
  text: string
  quick?: string[]
}

/** What a customer sees for their own order (token-authenticated). */
export interface PublicOrder extends Omit<Order, 'medCard' | 'driverId' | 'batchId' | 'idChecked'> {
  driver?: { name: string; phone: string }
  paymentUrl?: string
}

export interface StaffState {
  orders: Order[]
  tickets: Ticket[]
  staff: Staff[]
  refunds: Refund[]
}

// pending_manual: provider can't refund automatically (cash, Bitcoin); staff confirms once the money is sent back.
export type RefundStatus = 'processing' | 'completed' | 'pending_manual' | 'failed'

export interface Refund {
  id: number
  orderId: string
  amountCents: number
  reason: string
  method: PaymentMethod
  status: RefundStatus
  createdBy: string
  createdAt: number
}
