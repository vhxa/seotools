import { describe, expect, it } from 'vitest'
import { accessAfterMove } from './domain-move'

describe('accessAfterMove', () => {
  it('says access is unchanged while access is not set per company', () => {
    expect(
      accessAfterMove({ from: { id: 'a', name: 'Acme' }, to: { id: 'b', name: 'Beta' } }),
    ).toEqual({ kind: 'unchanged' })
  })
})
