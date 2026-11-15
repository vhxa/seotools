import { describe, expect, it } from 'vitest'
import { ALERT_EMAIL_COPY, alertEmail, alertLine, appLink, testEmail } from './alert-email'
import { safeMailError } from './deliveries'

const base = {
  locale: 'en' as const,
  host: 'example.com',
  crawl: {
    status: 'completed' as const,
    finishedAt: new Date('2026-11-05T10:00:00Z'),
    error: null,
    pages: 40,
    urls: 55,
  },
  links: {
    history: 'https://seo.test/domains/example.com/crawls',
    crawlSettings: 'https://seo.test/domains/example.com/settings/crawl',
  },
}

describe('alert emails', () => {
  it('have the same copy in every language', () => {
    expect(Object.keys(ALERT_EMAIL_COPY.es)).toEqual(Object.keys(ALERT_EMAIL_COPY.en))
    for (const key of Object.keys(ALERT_EMAIL_COPY.en) as (keyof typeof ALERT_EMAIL_COPY.en)[]) {
      const placeholders = (text: string) =>
        [...text.matchAll(/\{(\w+)\}/g)].map((m) => m[1]).sort()
      expect(placeholders(ALERT_EMAIL_COPY.es[key]), key).toEqual(
        placeholders(ALERT_EMAIL_COPY.en[key]),
      )
    }
  })

  it('says a failed crawl failed, with the reason on one line and where to look', () => {
    const { subject, text } = alertEmail({
      ...base,
      kinds: ['crawl-problem'],
      crawl: { ...base.crawl, status: 'failed', error: 'boom\n\nline two\u0000' },
    })
    expect(subject).toBe('example.com: the crawl failed')
    expect(text).toContain('Reason: boom line two')
    expect(text).toContain(base.links.history)
  })

  it('merges several kinds into one email, in a fixed order', () => {
    const { subject, text } = alertEmail({
      ...base,
      locale: 'es',
      kinds: ['change-summary', 'crawl-problem'],
      crawl: { ...base.crawl, status: 'incomplete' },
      summary: { state: 'first', pages: 40 },
    })
    expect(subject).toBe('example.com: problema de rastreo, cambios')
    expect(text.indexOf('Problema de rastreo')).toBeLessThan(text.indexOf('primer rastreo'))
    expect(text).toContain(base.links.crawlSettings)
  })

  it('bounds issues and samples, and cuts what a site wrote', () => {
    const groups = Array.from({ length: 14 }, (_, i) => ({
      name: `Issue ${i}`,
      count: 20,
      fresh: 15,
      back: 5,
      samples: ['https://example.com/a\nb', 'https://example.com/b', 'c', 'd', 'e'],
      href: `https://seo.test/x/${i}`,
    }))
    const { text } = alertEmail({
      ...base,
      kinds: ['important-findings'],
      findings: {
        since: new Date('2026-11-04T10:00:00Z'),
        groups,
        cut: true,
        compareHref: 'https://seo.test/c',
      },
    })
    expect(text).toContain('Issue 9')
    expect(text).not.toContain('Issue 10')
    expect(text).toContain('… and 4 more issues')
    expect(text.match(/^ {4}https:\/\/example\.com\/a b$/gm)).toHaveLength(10)
    expect(text).not.toContain('\nd\n')
    expect(text).toContain('The list was cut')
  })

  it('says plainly when crawls cannot be compared instead of sending zeros', () => {
    const { text } = alertEmail({
      ...base,
      kinds: ['change-summary'],
      summary: { state: 'no-base' },
    })
    expect(text).toContain('cannot be compared')
    expect(text).not.toContain('URLs added')
  })

  it('has a test email in both languages', () => {
    expect(testEmail('es').subject).toContain('prueba')
    expect(testEmail('en').text).toContain('test email')
  })
})

describe('helpers', () => {
  it('alertLine puts text on one line and cuts it', () => {
    expect(alertLine('a\r\nb\tc')).toBe('a b c')
    expect(alertLine('x'.repeat(300))).toHaveLength(200)
  })
  it('appLink joins the public address', () => {
    expect(appLink('https://seo.test/', '/domains/a.com')).toBe('https://seo.test/domains/a.com')
  })
})

describe('safeMailError', () => {
  it('removes secrets, tokens and keys, and bounds the text', () => {
    const error = new Error(
      'Invalid login hunter2 at https://x/set-password?token=abc123 key re_1234567890abcdef Bearer abcdefghijkl',
    )
    const text = safeMailError(error, ['hunter2'])
    expect(text).not.toMatch(/hunter2|abc123|re_1234567890abcdef|abcdefghijkl|set-password/)
    expect(text).toContain('https://x/…')
    expect(safeMailError('x'.repeat(2000))).toHaveLength(500)
    expect(safeMailError(new Error(''))).toBe('Unknown error')
  })
})

it.each(['en', 'es'] as const)('translates the browser-unavailable code in %s alerts', (locale) => {
  const { text } = alertEmail({
    ...base,
    locale,
    kinds: ['crawl-problem'],
    crawl: { ...base.crawl, status: 'failed', error: 'browser-unavailable' },
  })
  expect(text).toContain(ALERT_EMAIL_COPY[locale].browserUnavailable)
  expect(text).not.toContain('browser-unavailable')
})
