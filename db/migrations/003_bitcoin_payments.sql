-- Bitcoin checkout (BTCPay Server when configured, sandbox invoice otherwise).
-- The provider is stored per order so card and bitcoin orders coexist, and the invoice
-- columns carry everything the pay panel and the settlement webhook need to match a
-- payment back to its order. Additive only, so it is safe to run before the API deploys.

alter table orders add column if not exists payment_provider text not null default 'stripe';
alter table orders add column if not exists payment_reference text;
alter table orders add column if not exists payment_address text;
alter table orders add column if not exists payment_amount_sats bigint;
alter table orders add column if not exists payment_rate_cents integer;
alter table orders add column if not exists payment_expires_at timestamptz;
alter table orders add column if not exists payment_confirmed_at timestamptz;

-- The settlement webhook resolves an order from its invoice id.
create index if not exists orders_payment_reference_idx on orders (payment_reference);
