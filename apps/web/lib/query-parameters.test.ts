import { expect, it } from 'vitest'
import { countParameters } from './query-parameters'
import { findingCounters } from './finding-counters'
it('counts URLs rather than repeated parameter values', () => {
  expect([
    ...countParameters(['https://example.com/?a=1&a=2&b=', 'invalid', 'https://example.com/?a=3']),
  ]).toEqual([
    ['a', 2],
    ['b', 1],
  ])
})
it('keeps unknown findings out of typed counters', () => {
  expect(
    findingCounters(['unknown'], null).every(
      (group) => group.primary.length === 0 && group.secondary.length === 0,
    ),
  ).toBe(true)
})
it('separates secondary search findings from primary counters', () => {
  const group = findingCounters(['title-too-long'], 'not-indexable').find(
    (item) => item.type === 'opportunity',
  )
  expect(group?.primary).toEqual([])
  expect(group?.secondary).toEqual(['title-too-long'])
  expect(
    findingCounters(['title-too-long'], 'indexable').find((item) => item.type === 'opportunity')
      ?.primary,
  ).toEqual(['title-too-long'])
})
