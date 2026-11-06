import { describe, expect, it } from 'vitest'
import { summarizeJobResult } from './job-summary'

describe('summarizeJobResult', () => {
  it('names the pages and URLs of a crawl', () => {
    expect(
      summarizeJobResult('crawl.run', { status: 'completed', pages: 3028, urls: 4417 }),
    ).toEqual({ key: 'crawl', values: { pages: 3028, urls: 4417 } })
    expect(summarizeJobResult('crawl.run', { status: 'cancelled', pages: 1, urls: 2 })?.key).toBe(
      'crawlStopped',
    )
  })

  it('tells why alerts were not sent', () => {
    expect(summarizeJobResult('crawl.alerts', { skipped: 'nobody' })).toEqual({
      key: 'alertsSkipped.nobody',
      values: {},
    })
    expect(summarizeJobResult('crawl.alerts', { sent: 2, left: 0 })).toEqual({
      key: 'alertsSent',
      values: { sent: 2 },
    })
  })

  it('tells a repeated analysis from a new one', () => {
    expect(summarizeJobResult('audit.recompute', { analysed: 0 })?.key).toBe('upToDate')
    expect(summarizeJobResult('audit.recompute', { analysed: 1 })?.key).toBe('recomputed')
  })

  it('summarizes email jobs', () => {
    expect(summarizeJobResult('access.email', { skipped: true })?.key).toBe('emailSkipped')
    expect(summarizeJobResult('mail.send', { messageId: null })?.key).toBe('emailSent')
  })

  it('does not guess what it does not know', () => {
    expect(summarizeJobResult('crawl.run', { pages: 'x' })).toBeNull()
    expect(summarizeJobResult('url.verify', { anything: 1 })).toBeNull()
    expect(summarizeJobResult('crawl.run', null)).toBeNull()
    expect(summarizeJobResult('crawl.run', [1])).toBeNull()
  })
})
