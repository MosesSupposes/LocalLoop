LOCALLOOP — Master Build Prompt
"Weedmaps for your block." A hyperlocal discovery + ordering app connecting neighborhood storefronts (bodegas, taquerias, farm stands, bakeries, butchers, co-ops, commodity sellers) to the people who live around them — first as their speed dial, eventually as their front door.

Paste this whole document into your AI builder or hand it to your agent team. Every section is a direct instruction.

0. ROLE & MISSION
You are a senior founding team at a Bay Area seed-stage startup: product lead, design lead, staff full-stack engineer, backend/data engineer, DevOps/SRE, and growth engineer. Ship a production-grade MVP of LocalLoop in phases. Optimize for: speed to a working demo, a strong visual identity, real data flows (no fake buttons), and an architecture that scales from 1 neighborhood to 1,000.

North-star metric: weekly repeat orders per neighborhood. Positioning: DoorDash is a delivery company that has restaurants. LocalLoop is a neighborhood that has delivery. Merchant-first, lower fees, local loyalty.

1. PRODUCT DEFINITION
Personas
Neighbor (Shopper) — wants to know what's open, what's fresh, what's on deal within walking distance, and to reorder favorites in two taps.
Merchant (Storefront Owner) — small, low-tech, often cash-heavy. Needs a menu/inventory page live in 10 minutes, order alerts by SMS, and same-day payouts.
Runner (Courier, Phase 3) — neighborhood locals doing short-radius deliveries by foot, bike, or e-bike.
Admin / Neighborhood Ops — approves merchants, manages featured slots and disputes.
Core loops
Discover: Map + list of nearby storefronts with live "Open now", deals, drops, and freshness tags ("Bread out of the oven 7am", "Mangoes just in").
Speed Dial: Pin up to 8 favorite storefronts to your home screen. One tap to call, message, reorder, or see today's specials.
Order: Pickup (Phase 1) → Local delivery (Phase 3). Cart, checkout, live order status.
Loyalty: Neighborhood-wide punch card ("Loop Points") usable across every participating shop.
Drops & Deals: Merchants post time-boxed items ("20 tamales left, done at 2pm") that push to nearby followers.
Phased scope
Phase	Scope
P1 – Speed Dial (MVP)	Auth, map/list discovery, storefront pages, menus/inventory, favorites/speed dial, pickup ordering, merchant dashboard, Stripe payments, SMS order alerts
P2 – Loop	Deals & drops, push notifications, reviews, Loop Points loyalty, merchant analytics, search with filters
P3 – Front Door	Delivery, runner app, dispatch, live tracking, delivery zones and fees
P4 – Network	Commodity/wholesale ordering between merchants, group buys, subscriptions (weekly produce box), multi-neighborhood expansion
2. DESIGN SYSTEM — "SoCal Neon Market"
Vibe: Weedmaps meets a farmers' market at golden hour. Dark-mode first, glowy neon accents, chunky rounded cards, playful but premium. Silicon Valley polish, Venice Beach energy. No generic purple-on-white SaaS look.

Color tokens (oklch, defined as semantic CSS variables only — never hardcode colors in components)
--background:        oklch(0.16 0.02 160)   /* deep night-green */
--surface:           oklch(0.21 0.025 160)
--surface-raised:    oklch(0.26 0.03 160)
--foreground:        oklch(0.97 0.01 100)   /* warm off-white */
--muted-foreground:  oklch(0.72 0.03 140)
--primary:           oklch(0.86 0.22 145)   /* "Loop Lime" neon green */
--primary-foreground:oklch(0.18 0.03 160)
--accent-sunset:     oklch(0.75 0.19 50)    /* golden-hour orange: deals, drops */
--accent-pink:       oklch(0.72 0.2 0)      /* hot pink: hearts, favorites */
--accent-sky:        oklch(0.8 0.12 220)    /* Pacific blue: delivery, info */
--success / --warning / --destructive
--border:            oklch(1 0 0 / 0.08)
--glow-primary:      0 0 24px oklch(0.86 0.22 145 / 0.45)
--gradient-sunset:   linear-gradient(135deg, var(--accent-sunset), var(--accent-pink))
--gradient-hero:     radial-gradient(at top, oklch(0.3 0.08 150), var(--background))
Provide a light theme ("Daylight Market": cream background, same accents, deepened for contrast) but ship dark as default.

Typography
Display: Clash Display or Syne (bold, chunky, slightly weird).
Body/UI: Plus Jakarta Sans or Manrope.
Numerals/prices/timers: JetBrains Mono or Space Mono.
Scale: 12 / 14 / 16 / 20 / 24 / 32 / 48 / 64. Tight tracking on display text, generous line height on body.
Shape, depth, motion
Radius: cards 20px, buttons fully rounded (pill), sheets 28px top corners.
Elevation through lighter surfaces plus a subtle neon glow on active elements, not heavy drop shadows.
Motion: spring physics (Framer Motion). Map pins pulse when a drop is live. Speed-dial tiles bounce on long-press. Page transitions are 200–300ms. Respect prefers-reduced-motion.
Signature components
Map Pin: circular merchant logo with a category ring color; a sunset halo means an active deal.
Storefront Card: cover photo, logo chip, open/closed pill, distance in walk minutes, deal ribbon.
Speed Dial Grid: a 2×4 grid of big tiles with logo, name, and today's special; quick actions on long-press (Call, Reorder, Message, Directions).
Drop Card: countdown timer in mono font, stock bar, "Claim" CTA with sunset gradient.
Bottom Sheet Map: Weedmaps-style. Full-screen map with a draggable list sheet (peek, half, full).
Category Chips: Tacos, Bakery, Produce, Bodega, Meat & Fish, Coffee, Pantry & Bulk, Flowers, Halal, Vegan.
Order Status Tracker: horizontal steps (Placed → Accepted → Ready → Picked up/On the way → Done) with neon progress.
Accessibility
WCAG AA contrast on all text, 44px minimum tap targets, full keyboard navigation, screen-reader labels on map pins, and an English/Spanish toggle from day one (i18n keys, no hardcoded strings).

3. TECH STACK
Frontend (web/PWA): React 19 + TypeScript, TanStack Start (SSR) or Next.js, Tailwind v4 with tokens, shadcn/ui customized via variants, Framer Motion, TanStack Query, Zustand for cart.
Mobile: PWA first (installable, push, offline speed dial). Phase 2: Expo/React Native sharing types and API client.
Maps: Mapbox GL (custom dark "neon" style) with clustering; geocoding via Mapbox; PostGIS for radius queries.
Backend: Postgres + PostGIS (Supabase/Lovable Cloud or Neon), Row-Level Security, typed server functions/API (tRPC or server functions), Edge/Worker runtime.
Auth: Email OTP, phone OTP (SMS), Google and Apple sign-in. Roles live in a separate user_roles table.
Payments: Stripe Connect Express (merchant onboarding, split payouts, platform fee), Apple Pay and Google Pay.
Messaging: Twilio (SMS order alerts, merchant "reply 1 to accept"), Web Push / Expo push, Resend for email.
Realtime: Postgres realtime channels for order status and live drops.
Search: Postgres full-text + trigram first; Typesense/Meilisearch at scale.
Storage/CDN: Object storage for images with on-the-fly resizing.
AI (Lovable AI Gateway / LLM): menu import from a photo of a paper menu, auto-tagging items, a "what's good near me" conversational search, and deal copy generation for merchants.
Analytics: PostHog (events, funnels, feature flags). Errors: Sentry.
4. DATA MODEL (Postgres)
profiles(id → auth.users, display_name, phone, avatar_url, home_location geography(Point), locale, created_at)
user_roles(id, user_id, role enum[neighbor, merchant, runner, admin])          -- never store roles on profiles
neighborhoods(id, name, slug, boundary geography(Polygon), city, active)
merchants(id, owner_id, neighborhood_id, name, slug, category, description, logo_url, cover_url,
          phone, address, location geography(Point), hours jsonb, accepts_pickup, accepts_delivery,
          stripe_account_id, status enum[pending, live, paused], rating_avg, created_at)
menu_categories(id, merchant_id, name, sort)
items(id, merchant_id, category_id, name, description, price_cents, unit, image_url,
      in_stock bool, stock_qty int null, tags text[], dietary text[], is_commodity bool)
item_options(id, item_id, name, price_delta_cents, group_name, required)
favorites(user_id, merchant_id, speed_dial_slot int null, created_at)           -- PK(user_id, merchant_id)
drops(id, merchant_id, item_id, title, qty_total, qty_left, price_cents, starts_at, ends_at)
deals(id, merchant_id, title, type enum[percent, fixed, bogo], value, starts_at, ends_at, active)
carts(id, user_id, merchant_id, updated_at) / cart_items(...)
orders(id, user_id, merchant_id, status enum[placed, accepted, ready, picked_up, out_for_delivery, delivered, cancelled],
       fulfillment enum[pickup, delivery], subtotal_cents, fee_cents, tip_cents, total_cents,
       stripe_payment_intent, pickup_eta, delivery_address, created_at)
order_items(id, order_id, item_id, name_snapshot, price_snapshot, qty, options jsonb)
reviews(id, order_id, user_id, merchant_id, rating, body, created_at)
loop_points(id, user_id, merchant_id, points, reason, order_id, created_at)
runners(id, user_id, vehicle, active, current_location geography(Point))         -- P3
deliveries(id, order_id, runner_id, status, picked_up_at, delivered_at, route jsonb) -- P3
notifications(id, user_id, type, payload jsonb, read_at)
RLS everywhere. Neighbors read live merchants and items, and only their own orders. Merchants read and write only their own merchant rows and orders. Admin access goes through a has_role() security-definer function.
Key queries: merchants within X meters ordered by distance (GIST index on location), open now computed from hours in the merchant's timezone.
Seed one demo neighborhood (e.g. Echo Park, LA) with 15 realistic merchants, menus, and two live drops.
5. MULTI-AGENT INSTRUCTIONS
Run as an orchestrated team. The Orchestrator owns roadmap.md, splits work, and merges results. Each agent works in its own lane, follows the shared contracts, and reports back with: what changed, files touched, tests run, open questions.

Agent	Owns	Must deliver	Hands off to
Orchestrator / PM	Scope, roadmap, acceptance criteria	Phase plan, user stories, definition of done per story	All
Design Agent	styles.css tokens, component variants, icons, imagery	Design system, Storybook/visual page, generated hero & category art	Frontend
Data/Backend Agent	Schema, migrations, RLS, server functions, seeds	Migrations + RLS policies + typed API + seed data + tests for every rule	Frontend, DevOps
Frontend Agent	Routes, screens, state, map, PWA	All P1 screens wired to real data, loading/empty/error states	QA
Payments Agent	Stripe Connect, webhooks, payouts, fees	Merchant onboarding, checkout, webhook handler (signature-verified), refund flow	Backend
Messaging Agent	SMS, push, email, realtime	Order alerts, drop pushes, merchant SMS accept, templates (EN/ES)	Backend
AI Agent	Menu-photo import, search assistant, auto-tags	Server functions calling the LLM gateway, guardrails, cost limits	Frontend
DevOps/SRE Agent	CI/CD, envs, secrets, monitoring	Pipelines, preview deploys, Sentry, uptime checks, backups	All
QA Agent	Tests, E2E, accessibility, performance	Vitest unit tests, Playwright E2E for core flows, Lighthouse ≥ 90	Orchestrator
Growth Agent	SEO, referral, merchant acquisition	Merchant landing pages (SSR, schema.org LocalBusiness), referral codes, share cards	Frontend
Shared rules for all agents

A single source of truth for types: generate DB types and import them everywhere. No any.
Never hardcode colors, strings, or secrets. Use tokens, i18n keys, and the env/secret manager.
Every business rule (fees, radius, stock decrement, loyalty points, order state transitions) gets a unit test asserting concrete values.
No fake UI. Every button either works or is hidden behind a feature flag.
Small PRs, conventional commits, each PR linked to a roadmap item.
When blocked, write the blocker into roadmap.md and move to the next unblocked task.
6. FRONTEND SPEC (P1 screens)
Onboarding: location permission → pick a neighborhood → "Pick your first 3 spots" to seed speed dial.
Home / Speed Dial: greeting, a 2×4 speed-dial grid, a "Live drops near you" carousel, a "Open now" rail, and category chips.
Explore Map: full-screen neon map, clustering, filter chips (open now, deals, pickup, delivery, dietary), and a draggable list sheet.
Storefront Page: cover, logo, hours, walk time, call/directions/favorite buttons, a sticky category nav, item list, deals banner, and reviews.
Item Sheet: photo, options, quantity, add to cart.
Cart & Checkout: pickup time slots, tip, Apple/Google Pay, Stripe Payment Element.
Order Tracker: realtime status with ETA, plus "Call shop".
Orders / Reorder: history with one-tap reorder.
Profile: Loop Points balance, addresses, language, notifications.
Merchant Dashboard: live order queue (big tap-friendly Accept/Ready buttons with sound alert), a menu editor (including "Import from photo" with AI), hours, drops/deals composer, payouts, basic analytics.
Admin: merchant approvals, neighborhoods, featured slots, refunds.
Every screen needs loading skeletons, an empty state with personality ("No drops yet — the block is sleeping 🌙"), and an error state with retry.

7. BACKEND SPEC
Order state machine enforced server-side: placed → accepted → ready → picked_up | (P3: out_for_delivery → delivered); cancel allowed only before ready. Illegal transitions are rejected and tested.
Stock: atomic decrement on order placement (UPDATE ... WHERE qty_left >= n RETURNING) for drops and limited items.
Fees: configurable platform fee (default 5% merchant-side, $0.99 neighbor service fee for pickup). Store fee config in a table, not code.
Webhooks: /api/public/stripe-webhook and /api/public/twilio-inbound, both signature-verified and idempotent (store event IDs).
Scheduled jobs: expire drops, send "your favorite spot just posted a drop" pushes, nightly payout reconciliation, weekly merchant digest email.
Rate limiting on auth, OTP, and order endpoints. Audit log for admin actions.
Geo: nearby_merchants(lat, lng, radius_m, filters) RPC returning distance and walk minutes.
8. DEVOPS
Environments: local → preview (per PR) → staging → production. Separate databases and Stripe test/live keys.
CI (GitHub Actions): install → lint → typecheck → unit tests → build → Playwright E2E against the preview → migration dry-run.
CD: auto-deploy main to staging; tagged release to production. Migrations run before the app deploy, and they must be backward compatible.
Secrets: the platform secret manager only. Never commit .env.
Observability: Sentry (frontend + server), PostHog, structured logs, uptime checks on checkout and webhooks, alerts to Slack.
Data safety: daily backups with point-in-time recovery; a tested restore runbook.
Performance budgets: LCP < 2.0s on 4G, JS < 200KB initial, map tiles lazy-loaded, images served as AVIF/WebP.
Security: RLS tests in CI, dependency scanning, CSP headers, PII minimization (store phone numbers in E.164, mask them in merchant views after order completion).
9. GROWTH & BRAND
Name ideas: LocalLoop, Blockparty, Corner, Stoop, Nabe, Speeddial.
Tagline: "Your block, on speed dial."
Merchant pitch: "Live in 10 minutes. Lower fees than the big apps. Your neighbors, your rules."
Launch play: one neighborhood, 25 merchants hand-onboarded, window stickers with QR codes ("Speed-dial us on LocalLoop"), and a referral where both neighbors get Loop Points.
SEO: SSR merchant pages with LocalBusiness/Menu schema, per-neighborhood landing pages ("Best tacos open now in Echo Park").
10. ACCEPTANCE CRITERIA (P1 done =)
 A new user can sign up, set location, see real nearby merchants on the map, and favorite 3 into speed dial.
 A neighbor can place a paid pickup order; the merchant gets an SMS and a dashboard alert, accepts it, and marks it ready; the neighbor sees each status live.
 A merchant can onboard via Stripe Connect, build a menu (manually or from a photo), set hours, and receive a payout in test mode.
 RLS tests prove users cannot read others' orders, and merchants cannot edit other merchants.
 Lighthouse ≥ 90 on mobile; EN/ES both complete; dark and light themes pass AA.
 CI is green, the preview deploy works, Sentry is receiving events.
11. FIRST COMMAND TO THE BUILDER
"Build Phase 1 of LocalLoop following this document. Start with the design system tokens and the Home/Speed Dial + Explore Map screens using seeded Echo Park data, then the storefront page, cart, and pickup checkout. Enable the backend, create the schema with RLS and seed data in a migration, and wire everything to real data. Track progress in roadmap.md."
