# LocalLoop — Phase 1 (Speed Dial)

Hyperlocal discovery + pickup ordering for neighborhood storefronts. "Your block, on speed
dial." This is the Phase 1 slice of the build spec in [`AGENTS.md`](./AGENTS.md): auth, map
discovery, storefronts, menus, speed dial, pickup checkout, order tracking, merchant
dashboard and neighborhood ops.

Live at: **http://localhost:3000** (web) · **http://localhost:8000** (API, `/docs`, webhooks)

## Stack

| Part | What it is | Port |
| --- | --- | --- |
| `web/` | React 19 + TypeScript + Vite + Tailwind v4 + TanStack Query + Zustand + Framer Motion | 3000 |
| `api/` | Fastify + TypeScript, talks to Postgres as an RLS-enforced role | 8000 |
| `db/` | Postgres 16 + PostGIS; migrations, RLS policies, demo seed | 5432 |
| `api/src/worker.ts` | Scheduled jobs: drop pushes, stale-order nudges, nightly payout reconciliation | — |

The web app calls `/api` **same-origin** through the Vite dev proxy, so sessions are plain
first-party cookies with no CORS surface.

## Run it

```bash
docker compose -f docker-compose.base44.yml up -d --build
```

That brings up the database, applies migrations + the idempotent Echo Park seed, then starts
the API, the worker and the web dev server. Re-running is safe: migrations are tracked in
`schema_migrations` and every seed statement is keyed on natural keys.

To reset the data completely: `docker compose -f docker-compose.base44.yml down -v`.

### Demo accounts

Sign-in is email OTP (accounts are created on first request). In this environment no SMS
provider is configured, so the API returns the code in the response and the sign-in sheet
displays it:

| Email | Who |
| --- | --- |
| `neighbor@localloop.dev` | neighbor with 3 speed-dial tiles, order history and Loop Points |
| `gallo@localloop.dev` | merchant owner (Tacos El Gallo, Taqueria La Palma, Carniceria Ramirez, Mariscos El Pescador) |
| `bakery@localloop.dev`, `market@localloop.dev`, `cafe@localloop.dev`, `night@localloop.dev` | the other storefront owners |
| `ops@localloop.dev` | neighborhood ops / admin |

## Tests

```bash
docker compose -f docker-compose.base44.yml exec api npm test
docker compose -f docker-compose.base44.yml exec api npx tsc --noEmit
docker compose -f docker-compose.base44.yml exec web npx tsc --noEmit
```

`api/tests/fees.test.ts`, `orderState.test.ts` and `menuImport.test.ts` are pure unit tests;
`api/tests/rls.test.ts` is an integration test against the running database that proves a
neighbor cannot read another neighbor's order, a signed-out visitor sees none, a merchant
sees only their own counter, and a neighbor cannot edit someone else's storefront. It skips
itself when `DATABASE_URL`/`APP_DATABASE_URL` are absent.

## How the backend enforces the rules

- **Order state machine** (`api/src/lib/orderState.ts`): `placed → accepted → ready → picked_up`,
  cancel only before `ready`; illegal moves are rejected with 409 and unit tested.
- **Money** (`api/src/lib/fees.ts`): configurable platform fee (5% merchant-side) and $0.99
  neighbor service fee come from the `fee_config` table, never code; prices are re-derived
  server-side at checkout, and the best single active deal is applied (never stacked).
- **Stock**: drops are decremented atomically
  (`update drops set qty_left = qty_left - n where qty_left >= n returning qty_left`), so two
  neighbors racing for the last item get one success and one 409.
- **Loyalty**: one Loop Point per dollar of subtotal, credited when the order is picked up.
- **RLS**: the API connects as the non-owner role `localloop_app`, and every request runs in a
  transaction with `app.user_id` set. Policies restrict storefronts to `live` for the public,
  orders to their owner/merchant/admin, and admin access goes through a `security definer`
  `has_role()`. Service-only writes (notifications for another user, loyalty accrual, refunds
  by ops) use the owner pool on purpose — see `api/src/services/notify.ts`.
- **Webhooks**: `/api/public/stripe-webhook` is signature-verified (HMAC over the raw body)
  and idempotent through `webhook_events`; `/api/public/twilio-inbound` supports a merchant
  replying `1` to accept and `2` to mark ready.
- **Rate limits** on OTP request/verify and order placement; **audit log** for every ops action.

## Integrations and credentials

Nothing external is required to run the whole product here. Each integration is switched on by
the presence of its key, and until then the app uses a working local stub:

| Env var | Without it | With it |
| --- | --- | --- |
| `STRIPE_SECRET_KEY` | checkout records a simulated paid charge (`sim_<orderId>`) | real PaymentIntents + refunds; merchant Connect onboarding via `POST /api/merchant/:id/stripe-connect` |
| `STRIPE_WEBHOOK_SECRET` | webhook accepted without signature check | signature enforced |
| `TWILIO_ACCOUNT_SID` / `_AUTH_TOKEN` / `_FROM_NUMBER` | SMS is written to `notification_log` and logged | real SMS order alerts |
| `MAPBOX_TOKEN` | `NeonMap` renders the styled night grid with real storefront pins | the token is exposed via `GET /api/config` for a Mapbox GL style |
| `AI_API_KEY` | menu import parses pasted menu text | photo import calls the LLM gateway |

Real values are delivered by the platform to `/run/base44/app.env` and loaded **after**
`.env.base44-defaults`, so a dashboard value always wins. Never put a user credential under
compose `environment:`.

## Sandbox notes

- The web dev server binds `0.0.0.0:3000` and accepts the preview host. `__VITE_ADDITIONAL_SERVER_ALLOWED_HOSTS`
  is passed through from the platform (Vite ≥ 6.1 appends it to `allowedHosts`), and
  `web/vite.config.ts` additionally appends `.${BASE44_SANDBOX_HOST_DOMAIN}` — only when
  `BASE44_PREVIEW_MODE === '1'`, because the sandbox host changes on every recreation.
  With the flag unset, `allowedHosts` keeps Vite's default behaviour.
- File watching inside the container uses polling (`server.watch.usePolling`), since bind
  mounts do not reliably emit inotify events.
- `npm ci` runs on container start for `web/` and `api/` against their own named volumes, so
  dependency changes from the lockfile apply without rebuilding an image.
- Storefront artwork is generated from the slug (`tileGradient`), so the app renders offline
  without an image CDN. Swapping in real photos means filling `merchants.cover_url`/`logo_url`.

## Known gaps for the next phase

- No service worker yet (installable manifest ships, offline caching does not).
- PWA push notifications, delivery (Phase 3) and per-item promotion rules (bogo) are not
  implemented; `bogo` deals render but are not auto-applied at checkout.
- Payments are simulated unless Stripe keys are provided; payouts shown in the dashboard are
  derived from paid orders (Stripe Connect transfers need real keys).
- Fonts fall back to strong system stacks rather than loading Syne/Plus Jakarta Sans, so the
  preview keeps working with no external font CDN.
