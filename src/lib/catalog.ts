import type { Category, Product } from './types'

export const CATEGORIES: { id: Category; label: string; emoji: string }[] = [
  { id: 'herbs', label: 'Medicinal Herbs', emoji: '🌿' },
  { id: 'comfort', label: 'Comfort Food', emoji: '🍔' },
  { id: 'snacks', label: 'Snacks', emoji: '🍿' },
  { id: 'drinks', label: 'Drinks', emoji: '🥤' },
  { id: 'gear', label: 'Smoker Gear', emoji: '💨' },
  { id: 'merch', label: 'Merch', emoji: '👕' },
]

const p = (
  id: string, name: string, category: Category, priceCents: number,
  emoji: string, description: string, stock = 25, restricted?: 'medical',
): Product => ({ id, name, category, priceCents, emoji, description, stock, restricted })

// Placeholder catalog; owners edit stock in the admin Catalog tab.
export const SEED_PRODUCTS: Product[] = [
  p('h1', 'Calm Flower 3.5g', 'herbs', 4500, '🌿', 'Balanced hybrid, relaxing and clear. Registry card required.', 12, 'medical'),
  p('h2', 'Sleepy Gummies 10pk', 'herbs', 2800, '🍬', 'Night-time gummies, 5mg each. Registry card required.', 20, 'medical'),
  p('h3', 'Relief Tincture 30ml', 'herbs', 5500, '🧴', 'Daytime tincture for aches. Registry card required.', 8, 'medical'),
  p('c1', 'Smash Burger Combo', 'comfort', 1299, '🍔', 'Double smash burger, fries and a drink.'),
  p('c2', 'Mac & Cheese Bowl', 'comfort', 899, '🧀', 'Baked three-cheese mac, crispy top.'),
  p('c3', 'Loaded Nachos', 'comfort', 1099, '🌮', 'Chips, queso, jalapeños, beef, sour cream.'),
  p('c4', 'Chicken Tenders & Waffle Fries', 'comfort', 1199, '🍗', 'Five tenders with honey mustard.'),
  p('c5', 'Grilled Cheese & Tomato Soup', 'comfort', 999, '🥪', 'Sourdough, sharp cheddar, hot soup.'),
  p('s1', 'Hot Cheese Puffs', 'snacks', 399, '🧀', 'Big bag, big crunch.'),
  p('s2', 'Gummy Worms', 'snacks', 349, '🐛', 'Sour and sweet.'),
  p('s3', 'Beef Jerky', 'snacks', 899, '🥩', 'Peppered, 3oz.'),
  p('s4', 'Cookie Dough Bites', 'snacks', 499, '🍪', 'Edible cookie dough, no baking.'),
  p('s5', 'Pretzel Bites', 'snacks', 429, '🥨', 'Honey mustard dip included.'),
  p('d1', 'Cold Brew Can', 'drinks', 399, '☕', 'Sweet cream cold brew.'),
  p('d2', 'Sparkling Lemonade', 'drinks', 299, '🍋', 'Fresh, fizzy, cold.'),
  p('d3', 'Energy Drink', 'drinks', 349, '⚡', 'Tropical, 16oz.'),
  p('d4', 'Sweet Tea Gallon', 'drinks', 599, '🧊', 'Southern style.'),
  p('g1', 'Glass Hand Pipe', 'gear', 2400, '💨', 'Borosilicate, 4 inch. 21+.', 15),
  p('g2', 'Rolling Papers King Size', 'gear', 299, '📄', 'Slow burn, 32 leaves.', 60),
  p('g3', 'Grinder 4-Piece', 'gear', 1800, '⚙️', 'Aluminum with kief catcher.', 18),
  p('g4', 'Butane Torch Lighter', 'gear', 1299, '🔥', 'Refillable, windproof.', 22),
  p('m1', 'Smokology Hoodie', 'merch', 5500, '🧥', 'Heavyweight, neon-lime logo.', 10),
  p('m2', 'Smokology Tee', 'merch', 2800, '👕', 'Soft cotton, black.', 30),
  p('m3', 'Smokology Dad Hat', 'merch', 2200, '🧢', 'Adjustable, embroidered.', 20),
]
