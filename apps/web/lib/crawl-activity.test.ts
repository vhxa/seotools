import { describe, expect, it } from 'vitest'
import { newest, type CrawlActivity } from './crawl-activity'

const at = (when: number, state: CrawlActivity['state']): CrawlActivity => ({ state, at: when })

describe('newest', () => {
  it('keeps the reading made last, whatever order they arrive in', () => {
    const crawling = at(2000, { kind: 'crawling', crawlId: 'a', done: 10, total: 100 })
    // The page a click rendered was read when the crawl was still starting, and arrives late.
    const late = at(1000, { kind: 'starting', crawlId: 'a' })
    expect(newest(crawling, late)).toBe(crawling)
    expect(newest(late, crawling)).toBe(crawling)
  })

  it('keeps the same object when the state did not change', () => {
    const before = at(1000, { kind: 'crawling', crawlId: 'a', done: 10, total: 100 })
    const same = at(3000, { kind: 'crawling', crawlId: 'a', done: 10, total: 100 })
    const moved = at(3000, { kind: 'crawling', crawlId: 'a', done: 11, total: 100 })
    expect(newest(before, same)).toBe(before)
    expect(newest(before, moved)).not.toBe(before)
  })

  it('lets a reading of the same instant replace the old one', () => {
    const before = at(1000, { kind: 'starting', crawlId: 'a' })
    const same = at(1000, { kind: 'processing', crawlId: 'a' })
    expect(newest(before, same)).toBe(same)
  })

  it('never goes back to starting within a crawl, but does for another one', () => {
    const counting = at(1000, { kind: 'crawling', crawlId: 'a', done: 10, total: 100 })
    const again = at(2000, { kind: 'starting', crawlId: 'a' })
    expect(newest(counting, again)).toBe(counting)
    const processing = at(1000, { kind: 'processing', crawlId: 'a' })
    expect(newest(processing, again)).toBe(processing)
    // A crawl started after the first was cancelled is another one: it does start.
    const other = at(3000, { kind: 'starting', crawlId: 'b' })
    expect(newest(counting, other)).toBe(other)
  })

  it('lets a finished crawl return to idle', () => {
    const counting = at(1000, { kind: 'crawling', crawlId: 'a', done: 10, total: 100 })
    const idle = at(2000, { kind: 'idle' })
    expect(newest(counting, idle)).toBe(idle)
  })
})
