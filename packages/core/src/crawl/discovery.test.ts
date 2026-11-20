import { expect, it } from 'vitest'
import { compareCrawlDiscovery, snapshotCrawlDiscovery } from './discovery'
import { DEFAULT_CRAWL_SETTINGS } from './settings'

it('compares recorded discovery settings and treats missing legacy fields as unknown', () => {
  const discoverySettings = snapshotCrawlDiscovery(
    { ...DEFAULT_CRAWL_SETTINGS, includePrefixes: ['/es', '/en'] },
    false,
    '1.2.3',
  )
  const recorded = {
    discoverySettings,
    rendering: { mode: 'rendered' as const, waitMs: 5000, omittedHosts: [] },
    ignoredParameters: ['tracking'],
  }
  expect(
    compareCrawlDiscovery(recorded, {
      ...recorded,
      discoverySettings: {
        ...discoverySettings,
        includePrefixes: ['/en', '/es'],
        maxDepth: 1,
        requestCredentialsSet: true,
      },
      rendering: { ...recorded.rendering, waitMs: 6000 },
      ignoredParameters: [],
    }),
  ).toEqual([
    { setting: 'renderWaitMs', status: 'different' },
    { setting: 'ignoredParameters', status: 'different' },
    { setting: 'maxDepth', status: 'different' },
    { setting: 'requestCredentialsSet', status: 'different' },
  ])
  const unknown = compareCrawlDiscovery({ discoverySettings: null, rendering: null }, recorded)
  expect(unknown).toHaveLength(16)
  expect(unknown.every(({ status }) => status === 'unknown')).toBe(true)
})
