import { describe, expect, it } from 'vitest'
import { httpStatusVariant } from './http-status'

describe('HTTP status presentation', () => {
  it.each([404, 410])('keeps HTTP %s neutral only for confirmed automatic checks', (status) => {
    expect(httpStatusVariant(status, true)).toBe('secondary')
    expect(httpStatusVariant(status, false)).toBe('destructive')
    expect(httpStatusVariant(status)).toBe('destructive')
  })

  it.each([401, 403, 429, 500, null])('does not hide HTTP or request failures: %s', (status) => {
    expect(httpStatusVariant(status, true)).toBe('destructive')
  })

  it('preserves successful and redirected responses', () => {
    expect(httpStatusVariant(200)).toBe('outline')
    expect(httpStatusVariant(301)).toBe('secondary')
  })
})
