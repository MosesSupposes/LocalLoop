export const CATEGORIES = [
  { key: 'tacos', labelEn: 'Tacos', labelEs: 'Tacos', glyph: '🌮' },
  { key: 'bakery', labelEn: 'Bakery', labelEs: 'Panadería', glyph: '🥖' },
  { key: 'produce', labelEn: 'Produce', labelEs: 'Frutas y verduras', glyph: '🥬' },
  { key: 'bodega', labelEn: 'Bodega', labelEs: 'Tienda', glyph: '🏪' },
  { key: 'meat_fish', labelEn: 'Meat & Fish', labelEs: 'Carne y pescado', glyph: '🐟' },
  { key: 'coffee', labelEn: 'Coffee', labelEs: 'Café', glyph: '☕' },
  { key: 'pantry', labelEn: 'Pantry & Bulk', labelEs: 'Despensa', glyph: '🫙' },
  { key: 'flowers', labelEn: 'Flowers', labelEs: 'Flores', glyph: '💐' },
  { key: 'halal', labelEn: 'Halal', labelEs: 'Halal', glyph: '🥙' },
  { key: 'vegan', labelEn: 'Vegan', labelEs: 'Vegano', glyph: '🥗' },
] as const

export type CategoryKey = (typeof CATEGORIES)[number]['key']

export const CATEGORY_KEYS = CATEGORIES.map((c) => c.key)
