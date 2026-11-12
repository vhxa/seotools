import { parameterSuggestions, isTrackingParameter } from './query-parameters'
import { describe, expect, it, vi } from 'vitest'
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
  expect(summary).toMatchObject({
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

describe('ignore suggestions', () => {
  const rows = (name: string, value: string, count = 5) =>
    Array.from({ length: count }, (_, i) => ({
      url: `https://example.com/${i}?${name}=${value}`,
      canonical: `https://example.com/${i}` as string | null,
    }))
  it('requires five pairs and 90 percent volatility or canonical agreement', () => {
    expect(
      parameterSuggestions(rows('updatedAt', '2'), rows('updatedAt', '1')).get('updatedAt'),
    ).toEqual(['canonical', 'volatile'])
    expect(parameterSuggestions(rows('x', '2', 4), rows('x', '1', 4)).size).toBe(0)
    const ten = rows('x', '2', 10)
    ten[0]!.canonical = null
    expect(parameterSuggestions(ten).get('x')).toEqual(['canonical'])
    ten[1]!.canonical = null
    expect(parameterSuggestions(ten).size).toBe(0)
  })
  it('marks tracking separately and never suggests ignoring it, even with both heuristic signals', () => {
    for (const name of [
      'utm_source',
      'gclid',
      'fbclid',
      'msclkid',
      'dclid',
      'gbraid',
      'wbraid',
      'mc_cid',
      'mc_eid',
      '_ga',
      '_gl',
      'yclid',
      'igshid',
    ]) {
      expect(isTrackingParameter(name)).toBe(true)
      expect(parameterSuggestions(rows(name, '2'), rows(name, '1')).has(name)).toBe(false)
    }
    expect(isTrackingParameter('UTM_source')).toBe(false)
  })
})

it('skips malformed suggestion observations and caches no observations', async () => {
  expect(parameterSuggestions([{ url: 'invalid', canonical: null }]).size).toBe(0)
  expect(
    await parameterSummary({ queryUrls: pagedSource(1) }, 'no-observations'),
  ).not.toHaveProperty('observations')
})
