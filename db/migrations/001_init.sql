-- LocalLoop Phase 1 schema: Postgres + PostGIS, RLS everywhere, typed business rules in the DB
-- only where they belong (geo, open-now). Order state machine lives in the API (unit tested).

create extension if not exists postgis;
create extension if not exists pg_trgm;

-- ---------------------------------------------------------------- enums
do $$ begin create type user_role as enum ('neighbor', 'merchant', 'runner', 'admin');
exception when duplicate_object then null; end $$;
do $$ begin create type merchant_status as enum ('pending', 'live', 'paused');
exception when duplicate_object then null; end $$;
do $$ begin create type order_status as enum ('placed', 'accepted', 'ready', 'picked_up', 'out_for_delivery', 'delivered', 'cancelled');
exception when duplicate_object then null; end $$;
do $$ begin create type fulfillment_type as enum ('pickup', 'delivery');
exception when duplicate_object then null; end $$;
do $$ begin create type deal_type as enum ('percent', 'fixed', 'bogo');
exception when duplicate_object then null; end $$;

-- ---------------------------------------------------------------- identity
create table if not exists profiles (
  id uuid primary key default gen_random_uuid(),
  display_name text not null,
  email text not null unique,
  phone text,
  avatar_url text,
  home_location geography(Point, 4326),
  home_address text,
  neighborhood_id uuid,
  locale text not null default 'en',
  created_at timestamptz not null default now()
);

create table if not exists user_roles (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  role user_role not null,
  created_at timestamptz not null default now(),
  unique (user_id, role)
);

create table if not exists neighborhoods (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  boundary geography(Polygon, 4326),
  center geography(Point, 4326),
  city text not null,
  timezone text not null default 'America/Los_Angeles',
  active boolean not null default true,
  created_at timestamptz not null default now()
);

alter table profiles drop constraint if exists profiles_neighborhood_fk;
alter table profiles add constraint profiles_neighborhood_fk
  foreign key (neighborhood_id) references neighborhoods(id) on delete set null;

-- ---------------------------------------------------------------- merchants & menus
create table if not exists merchants (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references profiles(id) on delete cascade,
  neighborhood_id uuid references neighborhoods(id) on delete set null,
  name text not null,
  slug text not null unique,
  category text not null,
  description text,
  logo_url text,
  cover_url text,
  phone text,
  address text,
  location geography(Point, 4326) not null,
  timezone text not null default 'America/Los_Angeles',
  hours jsonb not null default '{}'::jsonb,
  accepts_pickup boolean not null default true,
  accepts_delivery boolean not null default false,
  stripe_account_id text,
  status merchant_status not null default 'pending',
  featured boolean not null default false,
  rating_avg numeric(2,1) not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists merchants_location_idx on merchants using gist (location);
create index if not exists merchants_name_trgm_idx on merchants using gin (name gin_trgm_ops);

create table if not exists menu_categories (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  name text not null,
  sort integer not null default 0
);

create table if not exists items (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  category_id uuid references menu_categories(id) on delete set null,
  name text not null,
  description text,
  price_cents integer not null check (price_cents >= 0),
  unit text,
  image_url text,
  in_stock boolean not null default true,
  stock_qty integer,
  tags text[] not null default '{}',
  dietary text[] not null default '{}',
  is_commodity boolean not null default false,
  freshness_note text,
  sort integer not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists items_merchant_idx on items (merchant_id);

create table if not exists item_options (
  id uuid primary key default gen_random_uuid(),
  item_id uuid not null references items(id) on delete cascade,
  name text not null,
  price_delta_cents integer not null default 0,
  group_name text not null,
  required boolean not null default false,
  sort integer not null default 0
);
create index if not exists item_options_item_idx on item_options (item_id);

-- ---------------------------------------------------------------- favorites (speed dial)
create table if not exists favorites (
  user_id uuid not null references profiles(id) on delete cascade,
  merchant_id uuid not null references merchants(id) on delete cascade,
  speed_dial_slot integer check (speed_dial_slot between 1 and 8),
  created_at timestamptz not null default now(),
  primary key (user_id, merchant_id),
  unique (user_id, speed_dial_slot)
);

-- ---------------------------------------------------------------- drops & deals
create table if not exists drops (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  item_id uuid references items(id) on delete set null,
  title text not null,
  qty_total integer not null check (qty_total > 0),
  qty_left integer not null check (qty_left >= 0),
  price_cents integer not null check (price_cents >= 0),
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists drops_merchant_idx on drops (merchant_id, ends_at desc);

create table if not exists deals (
  id uuid primary key default gen_random_uuid(),
  merchant_id uuid not null references merchants(id) on delete cascade,
  title text not null,
  type deal_type not null,
  value integer not null,
  starts_at timestamptz not null default now(),
  ends_at timestamptz not null,
  active boolean not null default true
);
create index if not exists deals_merchant_idx on deals (merchant_id);

-- ---------------------------------------------------------------- carts
create table if not exists carts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  merchant_id uuid not null references merchants(id) on delete cascade,
  updated_at timestamptz not null default now(),
  unique (user_id, merchant_id)
);

create table if not exists cart_items (
  id uuid primary key default gen_random_uuid(),
  cart_id uuid not null references carts(id) on delete cascade,
  item_id uuid not null references items(id) on delete cascade,
  qty integer not null check (qty > 0),
  options jsonb not null default '[]'::jsonb,
  unit_price_cents integer not null,
  created_at timestamptz not null default now()
);
create index if not exists cart_items_cart_idx on cart_items (cart_id);

-- ---------------------------------------------------------------- orders
create sequence if not exists order_code_seq start 1004;

create table if not exists orders (
  id uuid primary key default gen_random_uuid(),
  code text not null unique,
  user_id uuid not null references profiles(id) on delete cascade,
  merchant_id uuid not null references merchants(id) on delete cascade,
  status order_status not null default 'placed',
  fulfillment fulfillment_type not null default 'pickup',
  subtotal_cents integer not null,
  discount_cents integer not null default 0,
  platform_fee_cents integer not null default 0,
  service_fee_cents integer not null default 0,
  tip_cents integer not null default 0,
  total_cents integer not null,
  currency text not null default 'usd',
  payment_status text not null default 'unpaid' check (payment_status in ('unpaid', 'paid', 'refunded')),
  stripe_payment_intent text,
  pickup_slot timestamptz,
  pickup_eta timestamptz,
  delivery_address text,
  note text,
  cancel_reason text,
  refunded_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index if not exists orders_user_idx on orders (user_id, created_at desc);
create index if not exists orders_merchant_idx on orders (merchant_id, created_at desc);

create table if not exists order_items (
  id uuid primary key default gen_random_uuid(),
  order_id uuid not null references orders(id) on delete cascade,
  item_id uuid references items(id) on delete set null,
  drop_id uuid references drops(id) on delete set null,
  name_snapshot text not null,
  price_snapshot integer not null,
  qty integer not null check (qty > 0),
  options jsonb not null default '[]'::jsonb
);
create index if not exists order_items_order_idx on order_items (order_id);

create table if not exists reviews (
  id uuid primary key default gen_random_uuid(),
  order_id uuid references orders(id) on delete set null,
  user_id uuid not null references profiles(id) on delete cascade,
  merchant_id uuid not null references merchants(id) on delete cascade,
  rating integer not null check (rating between 1 and 5),
  body text,
  created_at timestamptz not null default now()
);
create index if not exists reviews_merchant_idx on reviews (merchant_id);

create table if not exists loop_points (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  merchant_id uuid references merchants(id) on delete set null,
  points integer not null,
  reason text not null,
  order_id uuid references orders(id) on delete set null,
  created_at timestamptz not null default now()
);

create table if not exists notifications (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles(id) on delete cascade,
  type text not null,
  title text not null,
  payload jsonb not null default '{}'::jsonb,
  read_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists notifications_user_idx on notifications (user_id, created_at desc);

-- ---------------------------------------------------------------- service tables (API-only, no client query path)
create table if not exists fee_config (
  id integer primary key default 1 check (id = 1),
  platform_fee_bps integer not null default 500,
  service_fee_cents integer not null default 99,
  updated_at timestamptz not null default now()
);
insert into fee_config (id) values (1) on conflict (id) do nothing;

create table if not exists otp_codes (
  id uuid primary key default gen_random_uuid(),
  email text not null,
  code_hash text not null,
  attempts integer not null default 0,
  consumed_at timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists otp_codes_email_idx on otp_codes (email, created_at desc);

create table if not exists notification_log (
  id uuid primary key default gen_random_uuid(),
  channel text not null,
  recipient text not null,
  template text not null,
  body text not null,
  provider text not null,
  provider_message_id text,
  created_at timestamptz not null default now()
);

create table if not exists webhook_events (
  id text primary key,
  source text not null,
  payload jsonb not null default '{}'::jsonb,
  received_at timestamptz not null default now()
);

create table if not exists audit_log (
  id uuid primary key default gen_random_uuid(),
  actor_id uuid,
  action text not null,
  entity text not null,
  entity_id uuid,
  detail jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------- helper functions
create or replace function current_user_id() returns uuid
language sql stable as $$
  select nullif(current_setting('app.user_id', true), '')::uuid
$$;

create or replace function has_role(p_role user_role) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from user_roles ur
    where ur.user_id = current_user_id() and ur.role = p_role
  )
$$;

create or replace function walk_minutes(p_meters double precision) returns integer
language sql immutable as $$
  select greatest(1, round(p_meters / 80.0)::int)   -- ~80 m per minute on foot
$$;

create or replace function is_open_now(p_hours jsonb, p_timezone text) returns boolean
language plpgsql stable as $$
declare
  v_local timestamp;
  v_day text;
  v_ranges jsonb;
  v_range jsonb;
  v_now time;
begin
  if p_hours is null or p_hours = '{}'::jsonb then
    return false;
  end if;
  v_local := now() at time zone coalesce(nullif(p_timezone, ''), 'UTC');
  v_day := (array['sun','mon','tue','wed','thu','fri','sat'])[extract(dow from v_local)::int + 1];
  v_ranges := p_hours -> v_day;
  if v_ranges is null or jsonb_typeof(v_ranges) <> 'array' then
    return false;
  end if;
  v_now := v_local::time;
  for v_range in select * from jsonb_array_elements(v_ranges) loop
    if (v_range ->> 1)::time <= (v_range ->> 0)::time then      -- wraps past midnight
      if v_now >= (v_range ->> 0)::time or v_now < (v_range ->> 1)::time then
        return true;
      end if;
    elsif v_now >= (v_range ->> 0)::time and v_now < (v_range ->> 1)::time then
      return true;
    end if;
  end loop;
  return false;
end $$;

create or replace function merchant_has_live_drop(p_merchant_id uuid) returns boolean
language sql stable as $$
  select exists (
    select 1 from drops d
    where d.merchant_id = p_merchant_id
      and d.starts_at <= now() and d.ends_at > now() and d.qty_left > 0
  )
$$;

create or replace function merchant_has_active_deal(p_merchant_id uuid) returns boolean
language sql stable as $$
  select exists (
    select 1 from deals dl
    where dl.merchant_id = p_merchant_id
      and dl.active and dl.starts_at <= now() and dl.ends_at > now()
  )
$$;

create or replace function nearby_merchants(
  p_lat double precision,
  p_lng double precision,
  p_radius_m integer default 1600,
  p_category text default null,
  p_open_now boolean default false,
  p_deals_only boolean default false,
  p_pickup_only boolean default false
) returns table (
  id uuid, name text, slug text, category text, description text,
  logo_url text, cover_url text, address text, phone text, hours jsonb,
  rating_avg numeric, status merchant_status, accepts_pickup boolean,
  accepts_delivery boolean, featured boolean, lat double precision, lng double precision,
  distance_m double precision, walk_minutes integer, open_now boolean,
  has_live_drop boolean, has_active_deal boolean
)
language sql stable as $$
  with origin as (
    select st_setsrid(st_makepoint(p_lng, p_lat), 4326)::geography as g
  )
  select m.id, m.name, m.slug, m.category, m.description, m.logo_url, m.cover_url,
         m.address, m.phone, m.hours, m.rating_avg, m.status, m.accepts_pickup,
         m.accepts_delivery, m.featured,
         st_y(m.location::geometry) as lat, st_x(m.location::geometry) as lng,
         st_distance(m.location, o.g) as distance_m,
         walk_minutes(st_distance(m.location, o.g)) as walk_minutes,
         is_open_now(m.hours, m.timezone) as open_now,
         merchant_has_live_drop(m.id) as has_live_drop,
         merchant_has_active_deal(m.id) as has_active_deal
  from merchants m, origin o
  where st_dwithin(m.location, o.g, p_radius_m)
    and (p_category is null or m.category = p_category)
    and (not p_pickup_only or m.accepts_pickup)
    and (not p_open_now or is_open_now(m.hours, m.timezone))
    and (not p_deals_only or merchant_has_active_deal(m.id))
  order by distance_m asc
  limit 100
$$;

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists orders_touch_updated_at on orders;
create trigger orders_touch_updated_at before update on orders
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------- Row-Level Security
alter table profiles enable row level security;
alter table user_roles enable row level security;
alter table neighborhoods enable row level security;
alter table merchants enable row level security;
alter table menu_categories enable row level security;
alter table items enable row level security;
alter table item_options enable row level security;
alter table favorites enable row level security;
alter table drops enable row level security;
alter table deals enable row level security;
alter table carts enable row level security;
alter table cart_items enable row level security;
alter table orders enable row level security;
alter table order_items enable row level security;
alter table reviews enable row level security;
alter table loop_points enable row level security;
alter table notifications enable row level security;
alter table audit_log enable row level security;

-- profiles: yourself, admins, and merchants you have ordered from (they need the name on the ticket)
drop policy if exists profiles_select on profiles;
create policy profiles_select on profiles for select using (
  id = current_user_id()
  or has_role('admin')
  or exists (
    select 1 from orders o
    join merchants m on m.id = o.merchant_id
    where o.user_id = profiles.id and m.owner_id = current_user_id()
  )
);
drop policy if exists profiles_insert_self on profiles;
create policy profiles_insert_self on profiles for insert with check (id = current_user_id() or has_role('admin'));
drop policy if exists profiles_update_self on profiles;
create policy profiles_update_self on profiles for update using (id = current_user_id() or has_role('admin'));

-- user_roles: you may claim the neighbor role for yourself; anything else is admin-only
drop policy if exists user_roles_select on user_roles;
create policy user_roles_select on user_roles for select using (user_id = current_user_id() or has_role('admin'));
drop policy if exists user_roles_insert on user_roles;
create policy user_roles_insert on user_roles for insert with check (
  has_role('admin') or (user_id = current_user_id() and role = 'neighbor')
);
drop policy if exists user_roles_admin_write on user_roles;
create policy user_roles_admin_write on user_roles for update using (has_role('admin'));
drop policy if exists user_roles_admin_delete on user_roles;
create policy user_roles_admin_delete on user_roles for delete using (has_role('admin'));

drop policy if exists neighborhoods_read on neighborhoods;
create policy neighborhoods_read on neighborhoods for select using (active or has_role('admin'));
drop policy if exists neighborhoods_admin_write on neighborhoods;
create policy neighborhoods_admin_write on neighborhoods for all using (has_role('admin')) with check (has_role('admin'));

-- merchants: public sees live storefronts; owners see and edit their own; admin sees all
drop policy if exists merchants_read on merchants;
create policy merchants_read on merchants for select using (
  status = 'live' or owner_id = current_user_id() or has_role('admin')
);
drop policy if exists merchants_insert_owner on merchants;
create policy merchants_insert_owner on merchants for insert with check (
  owner_id = current_user_id() or has_role('admin')
);
drop policy if exists merchants_update_owner on merchants;
create policy merchants_update_owner on merchants for update using (
  owner_id = current_user_id() or has_role('admin')
) with check (owner_id = current_user_id() or has_role('admin'));
drop policy if exists merchants_delete_owner on merchants;
create policy merchants_delete_owner on merchants for delete using (
  owner_id = current_user_id() or has_role('admin')
);

-- Natural keys used by the idempotent seeds.
create unique index if not exists menu_categories_merchant_name_key on menu_categories (merchant_id, name);
create unique index if not exists items_merchant_name_key on items (merchant_id, name);
create unique index if not exists item_options_group_name_key on item_options (item_id, group_name, name);
create unique index if not exists drops_merchant_title_key on drops (merchant_id, title);
create unique index if not exists deals_merchant_title_key on deals (merchant_id, title);

-- menus follow their merchant's visibility
create policy menu_categories_read on menu_categories for select using (
  exists (select 1 from merchants m where m.id = menu_categories.merchant_id)
);
create policy menu_categories_owner_write on menu_categories for all using (
  exists (select 1 from merchants m where m.id = menu_categories.merchant_id and m.owner_id = current_user_id())
  or has_role('admin')
) with check (
  exists (select 1 from merchants m where m.id = menu_categories.merchant_id and m.owner_id = current_user_id())
  or has_role('admin')
);

create policy items_read on items for select using (
  exists (select 1 from merchants m where m.id = items.merchant_id)
);
create policy items_owner_write on items for all using (
  exists (select 1 from merchants m where m.id = items.merchant_id and m.owner_id = current_user_id())
  or has_role('admin')
) with check (
  exists (select 1 from merchants m where m.id = items.merchant_id and m.owner_id = current_user_id())
  or has_role('admin')
);

create policy item_options_read on item_options for select using (
  exists (select 1 from items i where i.id = item_options.item_id)
);
create policy item_options_owner_write on item_options for all using (
  exists (
    select 1 from items i join merchants m on m.id = i.merchant_id
    where i.id = item_options.item_id and m.owner_id = current_user_id()
  ) or has_role('admin')
) with check (
  exists (
    select 1 from items i join merchants m on m.id = i.merchant_id
    where i.id = item_options.item_id and m.owner_id = current_user_id()
  ) or has_role('admin')
);

drop policy if exists favorites_own on favorites;
create policy favorites_own on favorites for all using (user_id = current_user_id() or has_role('admin'))
  with check (user_id = current_user_id() or has_role('admin'));

drop policy if exists drops_read on drops;
create policy drops_read on drops for select using (
  exists (select 1 from merchants m where m.id = drops.merchant_id) or has_role('admin')
);
drop policy if exists drops_owner_write on drops;
create policy drops_owner_write on drops for all using (
  exists (select 1 from merchants m where m.id = drops.merchant_id and m.owner_id = current_user_id())
  or has_role('admin')
) with check (
  exists (select 1 from merchants m where m.id = drops.merchant_id and m.owner_id = current_user_id())
  or has_role('admin')
);

drop policy if exists deals_read on deals;
create policy deals_read on deals for select using (
  exists (select 1 from merchants m where m.id = deals.merchant_id) or has_role('admin')
);
drop policy if exists deals_owner_write on deals;
create policy deals_owner_write on deals for all using (
  exists (select 1 from merchants m where m.id = deals.merchant_id and m.owner_id = current_user_id())
  or has_role('admin')
) with check (
  exists (select 1 from merchants m where m.id = deals.merchant_id and m.owner_id = current_user_id())
  or has_role('admin')
);

drop policy if exists carts_own on carts;
create policy carts_own on carts for all using (user_id = current_user_id() or has_role('admin'))
  with check (user_id = current_user_id() or has_role('admin'));

drop policy if exists cart_items_own on cart_items;
create policy cart_items_own on cart_items for all using (
  exists (select 1 from carts c where c.id = cart_items.cart_id and (c.user_id = current_user_id() or has_role('admin')))
) with check (
  exists (select 1 from carts c where c.id = cart_items.cart_id and (c.user_id = current_user_id() or has_role('admin')))
);

drop policy if exists orders_read on orders;
create policy orders_read on orders for select using (
  user_id = current_user_id()
  or has_role('admin')
  or exists (select 1 from merchants m where m.id = orders.merchant_id and m.owner_id = current_user_id())
);
drop policy if exists orders_insert_own on orders;
create policy orders_insert_own on orders for insert with check (
  user_id = current_user_id() or has_role('admin')
);
drop policy if exists orders_update on orders;
create policy orders_update on orders for update using (
  user_id = current_user_id()
  or has_role('admin')
  or exists (select 1 from merchants m where m.id = orders.merchant_id and m.owner_id = current_user_id())
) with check (
  user_id = current_user_id()
  or has_role('admin')
  or exists (select 1 from merchants m where m.id = orders.merchant_id and m.owner_id = current_user_id())
);

drop policy if exists order_items_read on order_items;
create policy order_items_read on order_items for select using (
  exists (select 1 from orders o where o.id = order_items.order_id)
);
drop policy if exists order_items_insert on order_items;
create policy order_items_insert on order_items for insert with check (
  exists (select 1 from orders o where o.id = order_items.order_id and (o.user_id = current_user_id() or has_role('admin')))
);

drop policy if exists reviews_read on reviews;
create policy reviews_read on reviews for select using (
  exists (select 1 from merchants m where m.id = reviews.merchant_id) or has_role('admin')
);
drop policy if exists reviews_write_own on reviews;
create policy reviews_write_own on reviews for insert with check (user_id = current_user_id() or has_role('admin'));
drop policy if exists reviews_update_own on reviews;
create policy reviews_update_own on reviews for update using (user_id = current_user_id() or has_role('admin'));

drop policy if exists loop_points_read on loop_points;
create policy loop_points_read on loop_points for select using (
  user_id = current_user_id()
  or has_role('admin')
  or exists (select 1 from merchants m where m.id = loop_points.merchant_id and m.owner_id = current_user_id())
);
drop policy if exists loop_points_insert on loop_points;
create policy loop_points_insert on loop_points for insert with check (
  user_id = current_user_id() or has_role('admin')
);

drop policy if exists notifications_own on notifications;
create policy notifications_own on notifications for all using (user_id = current_user_id() or has_role('admin'))
  with check (user_id = current_user_id() or has_role('admin'));

drop policy if exists audit_log_admin_read on audit_log;
create policy audit_log_admin_read on audit_log for select using (has_role('admin'));
drop policy if exists audit_log_insert on audit_log;
create policy audit_log_insert on audit_log for insert with check (true);

-- ---------------------------------------------------------------- public read surface
-- Reviews are public with a first-name-only reviewer label. The view deliberately exposes
-- just these columns (never phone/home_location) and is the only way the API reads reviews.
create or replace view public_reviews as
  select r.id,
         r.merchant_id,
         r.rating,
         r.body,
         r.created_at,
         split_part(p.display_name, ' ', 1) as reviewer_name
  from reviews r
  join profiles p on p.id = r.user_id;

grant select on public_reviews to public;
