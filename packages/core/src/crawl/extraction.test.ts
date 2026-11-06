import { describe, expect, it } from 'vitest'
import { extractorKey, extractorsSchema, validSelector } from './extraction'

describe('custom extraction', () => {
  it('takes valid CSS selectors and refuses the rest', () => {
    expect(validSelector('.price')).toBe(true)
    expect(validSelector('meta[property="og:price:amount"]')).toBe(true)
    expect(validSelector('div > span:nth-child(2)')).toBe(true)
    expect(validSelector('p::before')).toBe(false)
    expect(validSelector('[unclosed')).toBe(false)
    expect(validSelector('')).toBe(false)
  })

  it('makes keys from names, unique among the ones taken', () => {
    expect(extractorKey('Product price', new Set())).toBe('product-price')
    expect(extractorKey('Precio €', new Set(['precio']))).toBe('precio-2')
    expect(extractorKey('***', new Set())).toBe('value')
  })

  it('validates a list of extractors', () => {
    const one = { key: 'price', name: 'Price', selector: '.price', attribute: null }
    expect(extractorsSchema.safeParse([one]).success).toBe(true)
    expect(extractorsSchema.safeParse([one, one]).success).toBe(false)
    expect(extractorsSchema.safeParse([{ ...one, attribute: 'bad attr' }]).success).toBe(false)
  })
})
