import { expect, it, vi } from 'vitest'
import { PARAMETER_SCAN_LIMIT, countParameters, parameterSummary } from './query-parameters'
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

const pagedSource = (total: number) =>
  vi.fn(async (_crawlId: string, { after, limit }: { after: number | null; limit: number }) => {
    const start = after ?? 0
    const end = Math.min(start + limit, total)
    const urls = Array.from(
      { length: end - start },
      (_, i) => `https://example.com/?p${(start + i) % 3}=1`,
    )
    return { urls, next: end < total ? end : null }
  })

it('counts every page of addresses once and remembers the crawl', async () => {
  const queryUrls = pagedSource(4_500)
  const summary = await parameterSummary({ queryUrls }, 'crawl-a')
  expect(summary).toEqual({
    parameters: [
      ['p0', 1_500],
      ['p1', 1_500],
      ['p2', 1_500],
    ],
    bounded: false,
  })
  const calls = queryUrls.mock.calls.length
  expect(await parameterSummary({ queryUrls }, 'crawl-a')).toBe(summary)
  expect(queryUrls.mock.calls.length).toBe(calls)
})

it('stops at its budget and says so', async () => {
  const queryUrls = pagedSource(PARAMETER_SCAN_LIMIT + 10)
  const summary = await parameterSummary({ queryUrls }, 'crawl-b')
  expect(summary.bounded).toBe(true)
  expect(summary.parameters.reduce((sum, [, count]) => sum + count, 0)).toBe(PARAMETER_SCAN_LIMIT)
})
