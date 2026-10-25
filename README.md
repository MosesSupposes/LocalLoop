# Smokology

Online storefront for Smokology, a single convenience store in Wilmington, DE (5 W 4th St, 19801). Customers order comfort food, snacks, merch, smoker gear and Delaware-compliant medicinal herbs for same-day delivery. Built on the LocalLoop platform.

Roles:

- **Customer**: no account; orders and tickets are tied to secret tokens kept in the browser.
- **Admin** (owner): orders, tickets, dispatch, catalog, refunds.
- **Employee** (driver): assigned delivery stops only.

## Features

- Mobile-first PWA storefront (dark "neon market" theme), 21+ age gate, catalog, cart, checkout, live order tracker.
- Chatbot that answers questions, takes orders step by step, tracks orders, and opens support tickets.
- Admin ticketing: triage, assign, reply, resolve; customers see replies under Orders.
- Dispatch: auto-batches accepted orders by ZIP (max 4 stops) to the least-loaded on-shift driver.
- Compliance: herb orders need a Delaware registry card number, and drivers must confirm a 21+ ID and card check before marking delivered.
- Payments: Stripe Checkout (card) and BTCPay Server (Bitcoin), or cash on delivery. Card/Bitcoin orders can't be dispatched until paid.
- Refunds: partial or full, audit-logged. Card refunds go through Stripe; cash and Bitcoin refunds are confirmed manually.
- Staff sign in with a texted 6-digit code (Twilio, or printed to the server console in dev).

## Stack

React 19, TypeScript, Vite, Tailwind v4, Zustand, Framer Motion, React Router. Express 5, SQLite (`node:sqlite`), Zod, Stripe SDK. Vitest and Playwright (with axe) for tests.

## Getting started

Requires Node 24+ (uses the built-in `node:sqlite`).

```sh
npm install
cp .env.example .env   # optional; fill in as needed
npm run dev
```

- Web: http://localhost:5173 (proxies `/api` to the API)
- API: http://localhost:8787

Staff sign-in is at `/staff`. Seed staff numbers are `+13025550101` (owner) and `+13025550102` / `+13025550103` (drivers); override with `OWNER_PHONE`, `DRIVER1_PHONE`, `DRIVER2_PHONE`. Without Twilio configured, the code is printed in the API terminal as `[sms:dev] ...`.

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` | API and web dev servers together |
| `npm run dev:api` / `npm run dev:web` | Run one side only |
| `npm run build` | Typecheck and build the frontend into `dist/` |
| `npm start` | Production server (serves `dist/` and the API) |
| `npm test` | Unit tests (Vitest) |
| `npm run test:e2e` | End-to-end tests (Playwright, desktop and Pixel 7) |

Install the E2E browser once with `npx playwright install chromium`. E2E runs against a throwaway database and separate ports (API 8798, web 5199).

## Configuration

Copy `.env.example` to `.env`. Never commit it.

| Variable | Purpose |
| --- | --- |
| `VITE_STORE_PHONE` | Customer-facing call/text number (defaults to the store's number) |
| `APP_URL` | Public site URL, used for payment return links |
| `OWNER_PHONE`, `DRIVER1_PHONE`, `DRIVER2_PHONE` | Seed staff numbers (E.164) |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM` | SMS for login codes and "driver is on the way" texts |
| `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` | Card payments and refunds |
| `BTCPAY_URL`, `BTCPAY_STORE_ID`, `BTCPAY_API_KEY`, `BTCPAY_WEBHOOK_SECRET` | Bitcoin invoices |
| `DB_PATH` | SQLite file (default `data/smokology.db`) |
| `PORT` | API port (default 8787) |

Webhooks to register: `POST /api/public/stripe-webhook` and `POST /api/public/btcpay-webhook`. Both verify signatures and ignore repeated events. If a provider isn't configured, orders stay unpaid and an admin marks them paid by hand.

Store settings (hours, delivery ZIPs, fees, minimum order) live in `src/lib/config.ts`; the catalog seed is in `src/lib/catalog.ts` (edit stock later in Admin, Catalog). Hours are Sun-Thu 11am-10:30pm and Fri-Sat 11am-12am, Eastern. Delivery is currently Wilmington 19801 only.

## Project layout

```
src/            React app (pages, components, store, shared business logic in src/lib)
server/         Express API (routes, auth, payments, SQLite)
e2e/            Playwright specs
docs/           User flows (tickets, orders, payments, staff sign-in)
```

Pricing, fees, ZIP checks, the order state machine and batching live in `src/lib` and are shared by the client and the server, so the server remains the authority.

## Deployment

The frontend is a static build and is configured for Netlify (`netlify.toml`). The API needs a Node host with a persistent disk for SQLite (for example Render or Fly.io). Once the API has a URL, uncomment the `/api/*` redirect in `netlify.toml` so the browser stays same-origin and the staff session cookie works. Alternatively, run `npm run build && npm start` on a single host, which serves both.

Note that a Netlify team with visitor access protection will block public visitors until it is turned off in the site settings.

## Beta status and known gaps

- Placeholder data: product catalog and prices, fees, and the $20 minimum still need the store's real values.
- No hosted database, shared rate limiter, or Content-Security-Policy header yet.
- Twilio inbound replies and order alerts to the shop are not built.
- Stripe and BTCPay flows are untested against live providers.
- Native iOS and Android wrapping (for example with Capacitor) is not started.

See [docs/USER_FLOWS.md](docs/USER_FLOWS.md) for the ticket, order, payment and sign-in flows.
