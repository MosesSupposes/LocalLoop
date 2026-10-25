import Fastify, { type FastifyRequest } from 'fastify'
import cookie from '@fastify/cookie'
import { ZodError } from 'zod'
import { env, featureSummary } from './env.js'
import { ping } from './db.js'
import { HttpError } from './lib/errors.js'
import { authRoutes } from './routes/auth.js'
import { discoveryRoutes } from './routes/discovery.js'
import { favoriteRoutes } from './routes/favorites.js'
import { cartRoutes } from './routes/cart.js'
import { orderRoutes } from './routes/orders.js'
import { bitcoinRoutes } from './routes/bitcoin.js'
import { merchantRoutes } from './routes/merchant.js'
import { adminRoutes } from './routes/admin.js'
import { menuImportRoutes, webhookRoutes } from './routes/webhooks.js'

const app = Fastify({ logger: { level: 'info' }, trustProxy: true })

await app.register(cookie)

// Keep the raw body around for webhook signature verification.
app.addContentTypeParser('application/json', { parseAs: 'string' }, (req, body, done) => {
  ;(req as FastifyRequest & { rawBody?: string }).rawBody = body as string
  try {
    done(null, JSON.parse(body as string))
  } catch (error) {
    done(error as Error, undefined)
  }
})
app.addContentTypeParser('application/x-www-form-urlencoded', { parseAs: 'string' }, (_req, body, done) => {
  done(null, Object.fromEntries(new URLSearchParams(body as string)))
})

// The web app talks to /api same-origin through the Vite dev proxy. This CORS block only
// matters for direct calls to the API port (webhooks, curl with an Origin header).
app.addHook('onRequest', async (req, reply) => {
  const origin = req.headers.origin
  if (origin && origin === env.publicWebOrigin) {
    reply.header('access-control-allow-origin', origin)
    reply.header('access-control-allow-credentials', 'true')
    reply.header('access-control-allow-headers', 'content-type, stripe-signature, x-twilio-signature')
    reply.header('access-control-allow-methods', 'GET, POST, PATCH, PUT, DELETE, OPTIONS')
    reply.header('vary', 'origin')
  }
  if (req.method === 'OPTIONS') {
    reply.code(204).send()
  }
})

app.setErrorHandler((error, req, reply) => {
  if (error instanceof HttpError) {
    return reply.code(error.statusCode).send({ error: error.message, code: error.code, detail: error.detail })
  }
  if (error instanceof ZodError) {
    return reply.code(400).send({
      error: 'Some of the details look wrong.',
      code: 'validation_error',
      detail: error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    })
  }
  req.log.error({ err: error }, 'unhandled error')
  return reply.code(500).send({ error: 'Something went wrong on our side.' })
})

app.get('/api/health', async () => {
  const dbUp = await ping()
  return {
    ok: dbUp,
    db: dbUp ? 'up' : 'down',
    integrations: featureSummary(),
    time: new Date().toISOString(),
  }
})

// Human-readable endpoint index (also the base44.docs path for this service).
app.get('/docs', async (_req, reply) => {
  const groups: [string, string[]][] = [
    ['Auth', ['POST /api/auth/otp', 'POST /api/auth/otp/verify', 'POST /api/auth/logout', 'GET /api/me', 'PATCH /api/me', 'GET /api/me/loop-points', 'GET /api/me/notifications']],
    ['Discover', ['GET /api/config', 'GET /api/home', 'GET /api/neighborhoods', 'GET /api/merchants/nearby', 'GET /api/merchants/:slug', 'GET /api/drops/live', 'GET /api/search?q=']],
    ['Speed dial', ['GET /api/cart', 'POST /api/cart/items', 'PATCH /api/cart/items/:id', 'DELETE /api/cart/items/:id', 'PUT /api/favorites/:merchantId', 'DELETE /api/favorites/:merchantId']],
    ['Order', ['POST /api/orders', 'GET /api/orders', 'GET /api/orders/:id', 'POST /api/orders/:id/cancel', 'POST /api/orders/:id/reorder', 'POST /api/orders/:id/review', 'POST /api/orders/:id/bitcoin/confirm']],
    ['Merchant', ['GET /api/merchant/context', 'POST /api/merchant', 'GET /api/merchant/:id/orders', 'POST /api/merchant/:id/orders/:orderId/:action', 'GET/PATCH /api/merchant/:id', 'GET /api/merchant/:id/menu', 'POST /api/merchant/:id/items', 'POST /api/merchant/:id/drops', 'POST /api/merchant/:id/deals', 'GET /api/merchant/:id/analytics', 'GET /api/merchant/:id/payouts', 'POST /api/merchant/:id/stripe-connect']],
    ['Neighborhood ops', ['GET /api/admin/overview', 'GET /api/admin/merchants', 'POST /api/admin/merchants/:id/status', 'POST /api/admin/merchants/:id/featured', 'GET/POST /api/admin/neighborhoods', 'POST /api/admin/orders/:id/refund', 'GET /api/admin/audit']],
    ['Webhooks & tools', ['POST /api/public/stripe-webhook', 'POST /api/public/twilio-inbound', 'POST /api/public/btcpay-webhook', 'POST /api/menu-import', 'POST /api/menu-import/photo']],
  ]
  const html = `<!doctype html><html lang="en"><head><meta charset="utf-8">
<title>LocalLoop API</title>
<style>body{font-family:ui-sans-serif,system-ui;background:#0d1512;color:#f2f5ef;padding:2rem;line-height:1.5}
h1{font-size:1.6rem}h2{font-size:1rem;text-transform:uppercase;letter-spacing:.12em;color:#7ff0a0;margin-top:2rem}
code{font-family:ui-monospace,monospace;color:#ffd7a1}</style></head><body>
<h1>LocalLoop API</h1><p>Phase 1 pickup marketplace. Integrations: ${JSON.stringify(featureSummary())}</p>
${groups.map(([name, routes]) => `<h2>${name}</h2><ul>${routes.map((r) => `<li><code>${r}</code></li>`).join('')}</ul>`).join('')}
</body></html>`
  return reply.header('content-type', 'text/html; charset=utf-8').send(html)
})

await app.register(authRoutes)
await app.register(discoveryRoutes)
await app.register(favoriteRoutes)
await app.register(cartRoutes)
await app.register(orderRoutes)
await app.register(bitcoinRoutes)
await app.register(merchantRoutes)
await app.register(adminRoutes)
await app.register(webhookRoutes)
await app.register(menuImportRoutes)

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, async () => {
    await app.close()
    process.exit(0)
  })
}

await app.listen({ host: '0.0.0.0', port: env.port })
