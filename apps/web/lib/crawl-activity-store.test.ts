import { beforeEach, describe, expect, it } from 'vitest'
import type { CrawlActivity } from './crawl-activity'
import {
  offerActivity,
  readActivity,
  resetActivity,
  subscribeActivity,
} from './crawl-activity-store'

const at = (when: number, state: CrawlActivity['state']): CrawlActivity => ({ state, at: when })

describe('activity store', () => {
  beforeEach(resetActivity)

  it('starts idle', () => {
    expect(readActivity('a.com').state.kind).toBe('idle')
  })

  it('keeps the newest reading, whatever order they are offered in', () => {
    const counting = at(3000, { kind: 'crawling', crawlId: 'x', done: 11, total: 156 })
    offerActivity('a.com', counting)
    // The page drawn again with a reading from before the numbers: it must not put "starting" back.
    offerActivity('a.com', at(1000, { kind: 'starting', crawlId: 'x' }))
    expect(readActivity('a.com')).toBe(counting)
  })

  it('keeps each domain apart and tells its listeners only of changes', () => {
    let calls = 0
    const stop = subscribeActivity(() => calls++)
    offerActivity('a.com', at(1000, { kind: 'starting', crawlId: 'x' }))
    offerActivity('a.com', at(2000, { kind: 'starting', crawlId: 'x' }))
    expect(calls).toBe(1)
    expect(readActivity('b.com').state.kind).toBe('idle')
    stop()
    offerActivity('a.com', at(3000, { kind: 'processing', crawlId: 'x' }))
    expect(calls).toBe(1)
  })
})
