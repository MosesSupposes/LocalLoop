// Configuration + integration switches. An empty value turns an integration off
// (the app then uses its built-in stub), so the sandbox boots with no credentials.
export const env = {
  nodeEnv: process.env.NODE_ENV ?? 'development',
  port: Number(process.env.PORT ?? 8000),
  previewMode: process.env.BASE44_PREVIEW_MODE === '1',
  publicWebOrigin: process.env.PUBLIC_WEB_ORIGIN ?? 'http://localhost:3000',
  // Owner role: used by background jobs only. Never by request handlers (they need RLS).
  databaseUrl: process.env.DATABASE_URL ?? '',
  // RLS-enforced role: used for every request.
  appDatabaseUrl: process.env.APP_DATABASE_URL ?? '',
  sessionSecret: process.env.SESSION_SECRET || 'localloop-dev-only-session-secret',
  stripeSecretKey: process.env.STRIPE_SECRET_KEY ?? '',
  stripeWebhookSecret: process.env.STRIPE_WEBHOOK_SECRET ?? '',
  twilioAccountSid: process.env.TWILIO_ACCOUNT_SID ?? '',
  twilioAuthToken: process.env.TWILIO_AUTH_TOKEN ?? '',
  twilioFromNumber: process.env.TWILIO_FROM_NUMBER ?? '',
  aiApiKey: process.env.AI_API_KEY ?? '',
  aiBaseUrl: process.env.AI_BASE_URL ?? 'https://api.openai.com/v1',
  aiModel: process.env.AI_MODEL ?? 'gpt-4o-mini',
}

export const features = {
  /** Real Stripe PaymentIntents + webhook verification. */
  stripe: Boolean(env.stripeSecretKey),
  /** Real SMS via Twilio. */
  sms: Boolean(env.twilioAccountSid && env.twilioAuthToken && env.twilioFromNumber),
  /** LLM menu import from a photo. Without a key we fall back to text parsing. */
  ai: Boolean(env.aiApiKey),
}

export function featureSummary() {
  return {
    stripe: features.stripe ? 'live_keys' : 'simulated',
    sms: features.sms ? 'twilio' : 'logged',
    ai: features.ai ? 'llm' : 'text_parser',
  }
}
