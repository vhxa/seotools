import { describe, it, expect } from 'vitest'
import { stripIgnoredParameters } from './normalize'
import { ignoredParametersSchema, crawlSettingsSchema, DEFAULT_CRAWL_SETTINGS } from './settings'
describe('ignored parameters', () => {
  it('preserves query bytes, order and case while removing decoded and repeated names', () => {
    expect(
      stripIgnoredParameters(
        'https://example.com/a?x=a%20b&updated%41t=1&updatedAt=2&X=3&utm_source=x&x=last',
        ['updatedAt', 'utm_*'],
        'example.com',
      ),
    ).toBe('https://example.com/a?x=a%20b&X=3&x=last')
    expect(stripIgnoredParameters('https://example.com/a?x=1&x=2', ['x'])).toBe(
      'https://example.com/a',
    )
    expect(stripIgnoredParameters('https://outside.com/?x=1', ['x'], 'example.com')).toBe(
      'https://outside.com/?x=1',
    )
  })
  it('validates names and supplies upgrade defaults', () => {
    const { ignoredParameters: _ignored, ...legacy } = DEFAULT_CRAWL_SETTINGS
    expect(crawlSettingsSchema.parse(legacy).ignoredParameters).toEqual([])
    expect(ignoredParametersSchema.parse([' utm_* ', 'a', 'a'])).toEqual(['utm_*', 'a'])
    for (const value of ['', '*', 'a*b', 'x=y', 'x&y', 'x?y', 'x#y', 'a'.repeat(101)])
      expect(ignoredParametersSchema.safeParse([value]).success).toBe(false)
    expect(ignoredParametersSchema.safeParse(Array(101).fill('a')).success).toBe(false)
  })
})
