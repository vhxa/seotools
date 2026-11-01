import { describe, expect, it } from 'vitest'
import { formatBytes } from './format'

const format = {
  number: (value: number, options?: Intl.NumberFormatOptions) =>
    new Intl.NumberFormat('en', options).format(value),
} as unknown as Parameters<typeof formatBytes>[0]

describe('formatBytes', () => {
  it.each([
    [0, '0byte'],
    [812, '812byte'],
    [1023, '1,023byte'],
    [1024, '1kB'],
    [1536, '1.5kB'],
    [1024 * 1024, '1MB'],
    [2.4 * 1024 * 1024, '2.4MB'],
  ])('%s → %s', (bytes, expected) => {
    expect(formatBytes(format, bytes).replace(/\s/g, '')).toBe(expected)
  })
})
