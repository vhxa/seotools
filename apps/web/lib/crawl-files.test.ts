import type { CrawlFile } from '@seotools/db'
import { describe, expect, it } from 'vitest'
import {
  indexNowKeyMatches,
  isCheckPending,
  lastFetched,
  llmsFullView,
  llmsView,
  primaryFile,
  robotsView,
  securityView,
  sitemapsView,
  siteFindings,
} from './crawl-files'

const at = new Date('2026-06-15T10:00:00Z')

const file = (overrides: Partial<CrawlFile> = {}): CrawlFile => ({
  domainId: 'd',
  urlHash: 'h',
  url: 'https://example.com/robots.txt',
  kind: 'robots',
  statusCode: 200,
  contentType: 'text/plain',
  redirectTo: null,
  bytes: 10,
  truncated: false,
  body: 'User-agent: *\nDisallow:\nSitemap: https://example.com/s.xml',
  error: null,
  data: null,
  via: 'crawl',
  fetchedAt: at,
  ...overrides,
})
const sitemap = (url: string, entries: number | null, overrides: Partial<CrawlFile> = {}) =>
  file({
    url,
    kind: 'sitemap',
    body: null,
    data:
      entries === null
        ? null
        : { sitemap: { format: 'urlset', entries, lastModified: '2026-01-01T00:00:00.000Z' } },
    ...overrides,
  })

describe('isCheckPending', () => {
  const check = (requestedAt: Date | null) => ({
    domainId: 'd',
    nextCheckAt: at,
    requestedAt,
    checkedAt: null,
    outcome: null,
  })

  it('waits for a domain never checked, or a refresh someone asked for', () => {
    expect(isCheckPending(null, at)).toBe(true)
    expect(isCheckPending(check(at), at)).toBe(true)
    expect(isCheckPending(check(null), at)).toBe(false)
  })

  it('stops waiting for a refresh that got lost', () => {
    expect(isCheckPending(check(new Date(at.getTime() - 16 * 60_000)), at)).toBe(false)
  })
})

describe('primaryFile', () => {
  it('prefers a copy that is really there, over HTTPS', () => {
    const http = file({ url: 'http://example.com/robots.txt' })
    const moved = file({ statusCode: 301, body: null })
    const https = file({ url: 'https://www.example.com/robots.txt' })
    expect(primaryFile([moved, http, https])).toBe(https)
    expect(primaryFile([moved])).toBeNull()
  })
})

describe('lastFetched', () => {
  it('finds the newest request', () => {
    const newer = file({ fetchedAt: new Date(at.getTime() + 1000) })
    expect(lastFetched([file(), newer])).toBe(newer)
    expect(lastFetched([])).toBeNull()
  })
})

describe('robotsView', () => {
  it('has nothing to say before anything was requested', () => {
    expect(robotsView([])).toEqual({ file: null, parsed: null, findings: [], unknown: false })
  })

  it('tells apart no file from an unavailable one', () => {
    expect(robotsView([file({ statusCode: 404, body: null })])).toMatchObject({
      findings: ['missing'],
      unknown: false,
    })
    expect(robotsView([file({ statusCode: 503, body: null })])).toMatchObject({
      findings: ['unavailable'],
      unknown: true,
    })
    expect(robotsView([file({ statusCode: null, body: null, error: 'x' })])).toMatchObject({
      findings: ['unavailable'],
      unknown: true,
    })
    expect(robotsView([file({ body: null })])).toMatchObject({
      findings: ['invalid'],
      unknown: true,
    })
  })

  it('is happy with a clean file', () => {
    expect(robotsView([file()]).findings).toEqual([])
  })

  it.each([
    ['User-agent: *\nDisallow: /\nSitemap: https://a.co/s.xml', 'site-blocked'],
    ['User-agent: *', 'no-sitemaps'],
    ['Nonsense\nSitemap: https://a.co/s.xml', 'syntax-issues'],
  ])('flags %j', (body, finding) => {
    expect(robotsView([file({ body })]).findings).toContain(finding)
  })

  it('flags a file past what Google reads', () => {
    expect(robotsView([file({ truncated: true })]).findings).toContain('too-large')
    expect(robotsView([file({ bytes: 600 * 1024 })]).findings).toContain('too-large')
  })

  it('flags origins serving different rules', () => {
    const other = file({ url: 'https://www.example.com/robots.txt', body: 'User-agent: x' })
    expect(robotsView([file(), other]).findings).toContain('origins-differ')
    const same = file({ url: 'https://www.example.com/robots.txt' })
    expect(robotsView([file(), same]).findings).not.toContain('origins-differ')
  })
})

describe('sitemapsView', () => {
  const robots = [file()]
  const host = 'example.com'

  it('says where each sitemap came from, and adds up what they list', () => {
    const view = sitemapsView(
      [
        sitemap('https://example.com/s.xml', 2),
        sitemap('https://example.com/sitemap.xml', 3),
        sitemap('https://example.com/child.xml', 5),
      ],
      robots,
      host,
    )
    expect(view.rows.map((row) => [row.url, row.origin])).toEqual([
      ['https://example.com/s.xml', 'robots'],
      ['https://example.com/sitemap.xml', 'default'],
      ['https://example.com/child.xml', 'other'],
    ])
    expect(view).toMatchObject({
      fileCount: 3,
      urlCount: 10,
      lastModified: '2026-01-01T00:00:00.000Z',
      findings: [],
    })
  })

  it('does not count the sitemaps of an index twice', () => {
    const index = sitemap('https://example.com/s.xml', null, {
      data: { sitemap: { format: 'index', entries: 1, lastModified: null } },
    })
    const view = sitemapsView([index, sitemap('https://example.com/child.xml', 5)], robots, host)
    expect(view.urlCount).toBe(5)
    expect(view.fileCount).toBe(2)
  })

  it('leaves out usual locations that held nothing, unless declared', () => {
    const view = sitemapsView(
      [
        sitemap('https://example.com/s.xml', 1),
        sitemap('https://example.com/sitemap.xml', null, { statusCode: 404 }),
        sitemap('https://www.example.com/sitemap_index.xml', null, { statusCode: 301 }),
      ],
      robots,
      host,
    )
    expect(view.rows).toHaveLength(2)
    expect(view.triedCount).toBe(1)
  })

  it('reports a child sitemap that is broken', () => {
    const view = sitemapsView(
      [
        sitemap('https://example.com/s.xml', 1),
        sitemap('https://example.com/child.xml', null, { statusCode: 500 }),
      ],
      robots,
      host,
    )
    expect(view.rows.map((row) => row.state)).toEqual(['ok', 'server-error'])
  })

  it('lists a declared sitemap that was not requested, and why', () => {
    const external = file({ body: 'Sitemap: https://cdn.other.com/s.xml' })
    const view = sitemapsView([], [external], host)
    expect(view.rows).toEqual([
      {
        url: 'https://cdn.other.com/s.xml',
        origin: 'robots',
        file: null,
        state: null,
        external: true,
      },
    ])
    expect(view.findings).toEqual(['none'])
  })

  it('reports the rest', () => {
    expect(sitemapsView([], [], host).findings).toEqual(['none'])
    expect(
      sitemapsView([sitemap('https://example.com/sitemap.xml', 1)], [], host).findings,
    ).toEqual(['not-declared'])
    expect(sitemapsView([sitemap('https://example.com/s.xml', 0)], robots, host).findings).toEqual([
      'empty',
    ])
    expect(
      sitemapsView([sitemap('https://example.com/s.xml', null, { statusCode: 404 })], robots, host)
        .findings,
    ).toEqual(['none', 'declared-broken'])
  })
})

describe('llmsView', () => {
  const llms = (overrides: Partial<CrawlFile> = {}) =>
    file({ url: 'https://example.com/llms.txt', kind: 'llms', ...overrides })

  it('tells apart why there is no file', () => {
    expect(llmsView([]).findings).toEqual([])
    expect(llmsView([llms({ statusCode: 404, body: null })]).findings).toEqual(['missing'])
    expect(llmsView([llms({ statusCode: 500, body: null })]).findings).toEqual(['unavailable'])
    expect(llmsView([llms({ body: null })]).findings).toEqual(['invalid'])
  })

  it('checks it against the layout it should have', () => {
    expect(llmsView([llms({ body: '# A\n> B\n## C\n- [D](/d.md)' })]).findings).toEqual([])
    expect(llmsView([llms({ body: 'text' })]).findings).toEqual([
      'no-title',
      'no-summary',
      'no-links',
    ])
  })
})

describe('llmsFullView', () => {
  it('summarizes it by its headings', () => {
    const view = llmsFullView([file({ kind: 'llms-full', body: '## Intro\n# Title\n## More' })])
    expect(view).toMatchObject({ title: 'Title', headingCount: 3 })
    expect(llmsFullView([file({ kind: 'llms-full', statusCode: 404, body: null })])).toBeNull()
  })
})

describe('securityView', () => {
  const security = (body: string, url = 'https://example.com/.well-known/security.txt') =>
    file({ url, kind: 'security', body })

  it('accepts a complete file', () => {
    const view = securityView(security('Contact: a@b.c\nExpires: 2030-01-01T00:00:00Z'), at)
    expect(view.findings).toEqual([])
    expect(view.parsed.contacts).toEqual(['a@b.c'])
  })

  it('reports what RFC 9116 requires', () => {
    expect(securityView(security('Policy: x'), at).findings).toEqual(['no-contact', 'no-expiry'])
    expect(
      securityView(security('Contact: a\nExpires: 2020-01-01T00:00:00Z'), at).findings,
    ).toEqual(['expired'])
    expect(
      securityView(
        security('Contact: a\nExpires: 2030-01-01T00:00:00Z', 'https://example.com/security.txt'),
        at,
      ).findings,
    ).toEqual(['wrong-location'])
  })
})

describe('indexNowKeyMatches', () => {
  it('compares what the file holds', () => {
    expect(indexNowKeyMatches(file({ body: ' abcd1234\n' }), 'abcd1234')).toBe(true)
    expect(indexNowKeyMatches(file({ body: 'other' }), 'abcd1234')).toBe(false)
    expect(indexNowKeyMatches(file({ body: null }), 'abcd1234')).toBe(false)
  })
})

describe('unreadable files are not absent', () => {
  it.each([401, 403, 429, 204, 304, 302])('keeps HTTP %s unknown', (statusCode) => {
    const response = file({ statusCode, body: null })
    expect(robotsView([response])).toMatchObject({ findings: ['unavailable'], unknown: true })
    expect(llmsView([{ ...response, kind: 'llms' }]).findings).toEqual(['unavailable'])
  })

  it('does not hide an access denied response at a default sitemap location', () => {
    const view = sitemapsView(
      [sitemap('https://example.com/sitemap.xml', null, { statusCode: 403 })],
      [],
      'example.com',
    )
    expect(view.triedCount).toBe(0)
    expect(view.rows[0]?.state).toBe('access-denied')
  })
})

describe('siteFindings', () => {
  it('uses the current file state and read time, and omits disabled security.txt', () => {
    const found = siteFindings(
      {
        robots: [file({ body: 'User-agent: *\nDisallow: /' })],
        sitemap: [],
        llms: [],
        security: null,
      },
      'example.com',
      at,
    )
    expect(found).toContainEqual({
      file: 'robots',
      finding: 'site-blocked',
      severe: true,
      readAt: at,
    })
    expect(found.some((row) => row.file === 'security')).toBe(false)
  })
})
