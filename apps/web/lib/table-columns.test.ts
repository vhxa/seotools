import { describe, expect, it } from 'vitest'
import { readColumnWidths } from './table-columns'

describe('stored table widths', () => {
  const defaults = { url: 360, title: 280 }
  it('keeps defaults for missing, malformed and non-object preferences', () => {
    for (const value of [null, '{', 'null', '[]', 'true']) {
      expect(readColumnWidths(value, defaults)).toEqual(defaults)
    }
  })
  it('accepts known finite widths, bounds them and ignores unknown columns', () => {
    expect(readColumnWidths('{"url":9000,"title":-5,"unknown":200}', defaults)).toEqual({
      url: 800,
      title: 80,
    })
    expect(readColumnWidths('{"url":450,"title":"500"}', defaults)).toEqual({
      url: 450,
      title: 280,
    })
    expect(defaults).toEqual({ url: 360, title: 280 })
  })
})
