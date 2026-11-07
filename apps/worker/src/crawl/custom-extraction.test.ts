import { describe, expect, it } from 'vitest'
import { extractCustom } from './custom-extraction'

const html = `<html><head><meta property="product:price" content="49.90"></head><body>
  <h1>Robe</h1><span class="tag"> Spa </span><span class="tag">Gift</span><span class="tag"></span>
  <p class="long">${'word '.repeat(200)}</p></body></html>`

describe('extractCustom', () => {
  it('reads text or an attribute of what each selector matches, bounded', () => {
    const extracted = extractCustom(html, [
      {
        key: 'price',
        name: 'Price',
        selector: 'meta[property="product:price"]',
        attribute: 'content',
      },
      { key: 'tags', name: 'Tags', selector: '.tag', attribute: null },
      { key: 'none', name: 'None', selector: '.missing', attribute: null },
      { key: 'long', name: 'Long', selector: '.long', attribute: null },
    ])
    expect(extracted.price).toEqual(['49.90'])
    expect(extracted.tags).toEqual(['Spa', 'Gift'])
    expect(extracted.none).toBeUndefined()
    expect(extracted.long?.[0]?.length).toBeLessThanOrEqual(300)
  })

  it('does nothing without extractors and survives a selector that cannot run', () => {
    expect(extractCustom(html, [])).toEqual({})
    expect(
      extractCustom(html, [{ key: 'x', name: 'X', selector: ':has(', attribute: null }]),
    ).toEqual({})
  })
})

describe('extractCustom on a page built to break it', () => {
  const nest = (depth: number, inner: string) =>
    `<html><body>${'<div>'.repeat(depth)}${inner}${'</div>'.repeat(depth)}</body></html>`

  it('never fails on elements nested thousands deep', () => {
    const run = () =>
      extractCustom(nest(20_000, 'deep text'), [
        { key: 'text', name: 'Text', selector: 'body', attribute: null },
      ])
    expect(run).not.toThrow()
  })

  it('reads text through deep nesting within its budget', () => {
    expect(
      extractCustom(nest(5_000, 'deep text'), [
        { key: 'text', name: 'Text', selector: 'body', attribute: null },
      ]),
    ).toEqual({ text: ['deep text'] })
  })

  it('still finds a match at the bottom of a deep page', () => {
    expect(
      extractCustom(nest(20_000, '<span class="price">9.99</span>'), [
        { key: 'price', name: 'Price', selector: '.price', attribute: null },
      ]),
    ).toEqual({ price: ['9.99'] })
  })
})
