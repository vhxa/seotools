import { describe, it, expect } from 'vitest'
import { discoveryLinkVaried, type AnswerPair, type Answer } from './paired'
const answer = (hashes: string[], count = hashes.length): Answer => ({
  at: '2026-11-01T00:00:00Z',
  status: 200,
  media: 'html',
  location: null,
  html: {
    title: null,
    titleDigest: '',
    textDigest: '',
    anchors: { digest: hashes.join(''), count, hashes },
  },
})
const pair: AnswerPair = {
  version: 1,
  sourceHash: 's',
  original: answer([]),
  repeat: answer(['t']),
  unknown: null,
  changed: ['anchors'],
  examples: [],
}
describe.each([
  ['earlier', 'later'],
  ['later', 'earlier'],
])('discovered in %s, missing in %s', (a, b) => {
  const discovery = {
    crawlId: a,
    sourceHash: 's',
    targetHash: 't',
    kind: 'anchor',
    rendered: false,
  }
  const input = {
    comparableCompletedCrawls: true,
    discoveredCrawlId: a,
    missingCrawlId: b,
    discovery,
    missing: { crawlId: b, pair },
    targetHash: 't',
  }
  it('requires the retained served discovery and absence followed by positive membership', () => {
    expect(discoveryLinkVaried(input)).toBe(true)
    for (const changes of [
      { missing: { crawlId: b, pair: { ...pair, repeat: { ...answer(['t']), status: 206 } } } },
      { missing: { crawlId: b, pair: { ...pair, original: { ...answer([]), status: 206 } } } },
      { discovery: null },
      { missing: null },
      { comparableCompletedCrawls: false },
      { targetHash: 'other' },
      { discovery: { ...discovery, crawlId: b } },
      { discovery: { ...discovery, rendered: true } },
      { discovery: { ...discovery, kind: 'sitemap' } },
      { discovery: { ...discovery, sourceHash: 'other' } },
      { missing: { crawlId: a, pair } },
      { missing: { crawlId: b, pair: { ...pair, original: answer([], 65) } } },
      { missing: { crawlId: b, pair: { ...pair, repeat: answer(['other']) } } },
      { missing: { crawlId: b, pair: { ...pair, repeat: pair.original, original: pair.repeat! } } },
      { missing: { crawlId: b, pair: { ...pair, changed: ['text'] as AnswerPair['changed'] } } },
    ])
      expect(discoveryLinkVaried({ ...input, ...changes })).toBe(false)
  })
})
