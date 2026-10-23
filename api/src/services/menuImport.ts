import { env, features } from '../env.js'

export type ParsedItem = {
  name: string
  description: string | null
  priceCents: number
  category: string
}

const PRICE_RE = /(?:\$)?(\d{1,4}(?:[.,]\d{2})?)\s*$/

/** Offline parser: one item per line, price at the end ("Al Pastor Taco 3.49"). */
export function parseMenuText(text: string): ParsedItem[] {
  const items: ParsedItem[] = []
  let category = 'Menu'
  for (const rawLine of text.split('\n')) {
    const line = rawLine.trim()
    if (!line) continue
    const match = line.match(PRICE_RE)
    if (!match) {
      // A line without a price is treated as a section heading.
      if (line.length <= 40 && !line.includes('  ')) category = line.replace(/[:•-]+$/, '')
      continue
    }
    const dollars = Number(match[1].replace(',', '.'))
    const label = line.slice(0, match.index).replace(/[-–—:.\s]+$/, '').trim()
    if (!label) continue
    const [name, ...rest] = label.split(/\s[-–—]\s/)
    items.push({
      name: (name ?? label).slice(0, 80),
      description: rest.join(' ').trim() || null,
      priceCents: Math.round(dollars * 100),
      category,
    })
  }
  return items.slice(0, 60)
}

/**
 * Menu import from a photo. Uses the LLM gateway when AI_API_KEY is set, otherwise the
 * caller is told to paste the menu text so the same screen still works offline.
 */
export async function importMenuFromImage(base64: string, mime: string): Promise<ParsedItem[]> {
  if (!features.ai) {
    throw new Error('ai_not_configured')
  }
  const res = await fetch(`${env.aiBaseUrl}/chat/completions`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env.aiApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model: env.aiModel,
      response_format: { type: 'json_object' },
      messages: [
        {
          role: 'system',
          content:
            'You read photos of paper menus for a neighborhood storefront app. Reply with JSON: ' +
            '{"items":[{"name":string,"description":string|null,"priceCents":integer,"category":string}]}. ' +
            'Prices are US dollars. No commentary.',
        },
        {
          role: 'user',
          content: [
            { type: 'text', text: 'Extract every sellable item with its price.' },
            { type: 'image_url', image_url: { url: `data:${mime};base64,${base64}` } },
          ],
        },
      ],
      max_tokens: 1500,
    }),
  })
  if (!res.ok) throw new Error('ai_request_failed')
  const payload = (await res.json()) as { choices?: { message?: { content?: string } }[] }
  const content = payload.choices?.[0]?.message?.content ?? '{"items":[]}'
  const parsed = JSON.parse(content) as { items?: ParsedItem[] }
  return (parsed.items ?? []).slice(0, 60)
}

/** Deal copy generator used by the merchant drops/deals composer. */
export async function generateDealCopy(input: {
  merchantName: string
  category: string
  itemName?: string
  discount: string
}): Promise<string> {
  const fallback = input.itemName
    ? `${input.itemName} deal today at ${input.merchantName} — ${input.discount}, while it lasts.`
    : `${input.merchantName}: ${input.discount} today for the block, while it lasts.`
  if (!features.ai) return fallback
  try {
    const res = await fetch(`${env.aiBaseUrl}/chat/completions`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${env.aiApiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: env.aiModel,
        messages: [
          { role: 'system', content: 'Write one short line (max 90 chars) of deal copy for a neighborhood food app. No hashtags, no emoji spam, no quotes.' },
          { role: 'user', content: `${input.merchantName} (${input.category}) offers ${input.discount}${input.itemName ? ` on ${input.itemName}` : ''}.` },
        ],
        max_tokens: 60,
      }),
    })
    if (!res.ok) return fallback
    const payload = (await res.json()) as { choices?: { message?: { content?: string } }[] }
    return (payload.choices?.[0]?.message?.content ?? fallback).trim().slice(0, 90)
  } catch {
    return fallback
  }
}
