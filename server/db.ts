import { mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { SEED_PRODUCTS } from '../src/lib/catalog'
import type { Order, OrderItem, Product, Refund, Staff, Ticket, TicketMessage } from '../src/lib/types'

const path = process.env.DB_PATH ?? 'data/smokology.db'
if (path !== ':memory:') mkdirSync(dirname(path), { recursive: true })
export const db = new DatabaseSync(path)
db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON;')

db.exec(`
CREATE TABLE IF NOT EXISTS staff (id TEXT PRIMARY KEY, name TEXT NOT NULL, role TEXT NOT NULL, phone TEXT NOT NULL UNIQUE, on_shift INTEGER NOT NULL DEFAULT 1);
CREATE TABLE IF NOT EXISTS products (id TEXT PRIMARY KEY, name TEXT NOT NULL, category TEXT NOT NULL, price_cents INTEGER NOT NULL, description TEXT NOT NULL, emoji TEXT NOT NULL, stock INTEGER NOT NULL, restricted TEXT);
CREATE TABLE IF NOT EXISTS orders (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE, token TEXT NOT NULL, customer_name TEXT NOT NULL, phone TEXT NOT NULL, address TEXT NOT NULL, zip TEXT NOT NULL,
  items TEXT NOT NULL, subtotal_cents INTEGER NOT NULL, delivery_fee_cents INTEGER NOT NULL, service_fee_cents INTEGER NOT NULL, tip_cents INTEGER NOT NULL, total_cents INTEGER NOT NULL,
  payment TEXT NOT NULL, payment_status TEXT NOT NULL, status TEXT NOT NULL, med_card TEXT, notes TEXT, batch_id TEXT, driver_id TEXT REFERENCES staff(id),
  id_checked INTEGER NOT NULL DEFAULT 0, source TEXT NOT NULL, payment_url TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS tickets (
  seq INTEGER PRIMARY KEY AUTOINCREMENT, id TEXT UNIQUE, token TEXT NOT NULL, subject TEXT NOT NULL, type TEXT NOT NULL, priority TEXT NOT NULL, status TEXT NOT NULL,
  customer_name TEXT NOT NULL, phone TEXT NOT NULL, order_id TEXT, assignee_id TEXT, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS ticket_messages (id INTEGER PRIMARY KEY AUTOINCREMENT, ticket_id TEXT NOT NULL REFERENCES tickets(id), sender TEXT NOT NULL, text TEXT NOT NULL, at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS otp (phone TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0);
CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, staff_id TEXT NOT NULL REFERENCES staff(id), expires INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS webhook_events (id TEXT PRIMARY KEY, received_at INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS refunds (
  id INTEGER PRIMARY KEY AUTOINCREMENT, order_id TEXT NOT NULL REFERENCES orders(id), amount_cents INTEGER NOT NULL CHECK (amount_cents > 0), reason TEXT NOT NULL,
  method TEXT NOT NULL, status TEXT NOT NULL, provider_ref TEXT, created_by TEXT NOT NULL REFERENCES staff(id), created_at INTEGER NOT NULL
);
INSERT OR IGNORE INTO sqlite_sequence (name, seq) VALUES ('orders', 1000), ('tickets', 100);
`)

// Additive migrations for databases created before refunds existed.
const orderCols = (db.prepare('PRAGMA table_info(orders)').all() as { name: string }[]).map((c) => c.name)
if (!orderCols.includes('refunded_cents')) db.exec('ALTER TABLE orders ADD COLUMN refunded_cents INTEGER NOT NULL DEFAULT 0')
if (!orderCols.includes('provider_ref')) db.exec('ALTER TABLE orders ADD COLUMN provider_ref TEXT')

if (!(db.prepare('SELECT COUNT(*) AS n FROM products').get() as { n: number }).n) {
  const ins = db.prepare('INSERT INTO products VALUES (?,?,?,?,?,?,?,?)')
  for (const p of SEED_PRODUCTS) ins.run(p.id, p.name, p.category, p.priceCents, p.description, p.emoji, p.stock, p.restricted ?? null)
}

// Phones come from env so real numbers never live in the repo.
if (!(db.prepare('SELECT COUNT(*) AS n FROM staff').get() as { n: number }).n) {
  const ins = db.prepare('INSERT INTO staff (id, name, role, phone) VALUES (?,?,?,?)')
  ins.run('a1', 'Owner', 'admin', process.env.OWNER_PHONE ?? '+13025550101')
  ins.run('e1', 'Dre', 'employee', process.env.DRIVER1_PHONE ?? '+13025550102')
  ins.run('e2', 'Sam', 'employee', process.env.DRIVER2_PHONE ?? '+13025550103')
}

type R = Record<string, unknown>

export const mapProduct = (r: R): Product => ({
  id: r.id as string, name: r.name as string, category: r.category as Product['category'], priceCents: r.price_cents as number,
  description: r.description as string, emoji: r.emoji as string, stock: r.stock as number, restricted: (r.restricted as 'medical' | null) ?? undefined,
})

export const mapStaff = (r: R): Staff => ({ id: r.id as string, name: r.name as string, role: r.role as Staff['role'], phone: r.phone as string, onShift: !!r.on_shift })

export const mapOrder = (r: R): Order => ({
  id: r.id as string, customerName: r.customer_name as string, phone: r.phone as string, address: r.address as string, zip: r.zip as string,
  items: JSON.parse(r.items as string) as OrderItem[], subtotalCents: r.subtotal_cents as number, deliveryFeeCents: r.delivery_fee_cents as number,
  serviceFeeCents: r.service_fee_cents as number, tipCents: r.tip_cents as number, totalCents: r.total_cents as number,
  payment: r.payment as Order['payment'], paymentStatus: r.payment_status as Order['paymentStatus'], refundedCents: r.refunded_cents as number, status: r.status as Order['status'],
  medCard: (r.med_card as string | null) ?? undefined, notes: (r.notes as string | null) ?? undefined, batchId: (r.batch_id as string | null) ?? undefined,
  driverId: (r.driver_id as string | null) ?? undefined, idChecked: !!r.id_checked, source: r.source as Order['source'], createdAt: r.created_at as number,
})

export const mapRefund = (r: R): Refund => ({
  id: r.id as number, orderId: r.order_id as string, amountCents: r.amount_cents as number, reason: r.reason as string,
  method: r.method as Refund['method'], status: r.status as Refund['status'], createdBy: r.created_by as string, createdAt: r.created_at as number,
})

export const mapTicket = (r: R): Ticket => ({
  id: r.id as string, subject: r.subject as string, type: r.type as Ticket['type'], priority: r.priority as Ticket['priority'], status: r.status as Ticket['status'],
  customerName: r.customer_name as string, phone: r.phone as string, orderId: (r.order_id as string | null) ?? undefined,
  assigneeId: (r.assignee_id as string | null) ?? undefined, createdAt: r.created_at as number,
  messages: (db.prepare('SELECT sender, text, at FROM ticket_messages WHERE ticket_id = ? ORDER BY id').all(r.id as string) as R[]).map(
    (m): TicketMessage => ({ from: m.sender as TicketMessage['from'], text: m.text as string, at: m.at as number }),
  ),
})

export const q = {
  all: (sql: string, ...a: (string | number | null)[]) => db.prepare(sql).all(...a) as R[],
  get: (sql: string, ...a: (string | number | null)[]) => db.prepare(sql).get(...a) as R | undefined,
  run: (sql: string, ...a: (string | number | null)[]) => db.prepare(sql).run(...a),
}

export function tx<T>(fn: () => T): T {
  db.exec('BEGIN IMMEDIATE')
  try {
    const v = fn()
    db.exec('COMMIT')
    return v
  } catch (e) {
    db.exec('ROLLBACK')
    throw e
  }
}
