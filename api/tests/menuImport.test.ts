import { describe, expect, it } from 'vitest'
import { parseMenuText } from '../src/services/menuImport.js'

describe('menu text import', () => {
  it('parses name, price and section headings', () => {
    const items = parseMenuText(`Tacos
Al Pastor Taco 3.49
Carne Asada Taco - grilled steak - 3.99
Drinks
Horchata $3.49`)
    expect(items).toHaveLength(3)
    expect(items[0]).toEqual({ name: 'Al Pastor Taco', description: null, priceCents: 349, category: 'Tacos' })
    expect(items[1]?.name).toBe('Carne Asada Taco')
    expect(items[1]?.description).toBe('grilled steak')
    expect(items[2]?.category).toBe('Drinks')
    expect(items[2]?.priceCents).toBe(349)
  })

  it('ignores prose lines without a price', () => {
    expect(parseMenuText('Ask about our daily specials')).toHaveLength(0)
  })
})
