# LocalLoop roadmap

Definition of done for Phase 1 (from the build spec): a neighbor can sign up, set location,
see real nearby storefronts on the map and pin three into speed dial; place a paid pickup
order that the merchant accepts from their dashboard while the neighbor watches status change
live; a merchant can run a menu, hours, drops and deals and see payouts; RLS tests prove
tenancy isolation.

## Phase 1 — Speed Dial (shipped in this branch)

| # | Item | Status | Notes |
| --- | --- | --- | --- |
| P1-1 | Design system ("SoCal Neon Market") | ✅ | oklch semantic tokens only, dark default + Daylight light theme, EN/ES, reduced-motion support |
| P1-2 | Email OTP auth + roles table | ✅ | no passwords; `user_roles` never on `profiles` |
| P1-3 | Onboarding (location → neighborhood → first 3 spots) | ✅ | speed dial capped at 8 tiles |
| P1-4 | Home / Speed Dial | ✅ | 2×4 grid, live drops carousel, open-now rail, deals, category chips |
| P1-5 | Explore map + filters + list sheet | ✅ | neon canvas map, clustering, draggable peek/half/full sheet |
| P1-6 | Storefront page | ✅ | hours, walk time, deals, drops, sticky category nav, reviews |
| P1-7 | Item sheet (options, qty, add to cart) | ✅ | prices re-derived server-side |
| P1-8 | Cart & pickup checkout | ✅ | pickup slots, tip, service fee, simulated/Stripe payment |
| P1-9 | Order tracker + orders / reorder | ✅ | live polling, cancel before ready, reviews |
| P1-10 | Merchant dashboard | ✅ | order queue with chime, menu editor, menu import, drops/deals, hours, analytics, payouts |
| P1-11 | Admin / neighborhood ops | ✅ | approvals, featured slots, neighborhoods, refunds, audit log |
| P1-12 | Backend rules: order state machine, atomic stock, fee config, rate limits | ✅ | unit tested |
| P1-13 | RLS everywhere + has_role() + RLS tests | ✅ | integration tests in `api/tests/rls.test.ts` |
| P1-14 | Webhooks (signed, idempotent) + scheduled jobs | ✅ | worker service |
| P1-15 | CI (lint → typecheck → tests → build, migration dry run) | ✅ | `.github/workflows/ci.yml` |
| P1-16 | Bitcoin checkout | ✅ | per-order bitcoin invoice (BTCPay Server when configured, local sandbox invoice otherwise), pay panel on the order screen, signed+idempotent settlement webhook, expired invoices released by the worker |
## Phase 1 follow-ups (deliberately out of scope here)

- Service worker + offline speed dial (manifest ships, caching does not).
- Real Mapbox GL neon style (token is read from `MAPBOX_TOKEN`; canvas map is the fallback).
- Stripe Connect live payouts and Apple/Google Pay wallets (Payment Element is stubbed).
- Bitcoin refunds and partial payments are manual: a settled invoice is marked `refunded` on cancel
  but no on-chain refund is broadcast.
- Photo menu import needs `AI_API_KEY`; text import works today.
- Per-item promotion rules so `bogo` deals apply automatically.

## Phase 2 — Loop

Deals & drops push notifications, reviews on the storefront feed, Loop Points redemption,
merchant analytics depth, search with saved filters, saved addresses, i18n copy review.

## Phase 3 — Front Door

Delivery zones and fees, runner app, dispatch, live tracking, `runners`/`deliveries` tables
(already present in the schema but unused).
