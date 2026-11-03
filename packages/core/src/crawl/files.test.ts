import { describe, expect, it } from 'vitest'
import {
  crawlFileKindOf,
  crawlFileRequests,
  crawlFileSource,
  crawlFileState,
  enabledExtraFiles,
  isExtraCrawlFile,
  isDefaultSitemapUrl,
  CRAWL_FILE_KINDS,
} from './files'

const urlsOf = (kind: string, requests: ReturnType<typeof crawlFileRequests>) =>
  requests.filter((request) => request.kind === kind).map((request) => request.url)

describe('crawlFileRequests', () => {
  it('asks only for the essential files by default', () => {
    const requests = crawlFileRequests('example.com', { optionalFiles: [], indexNowKey: null })
    expect(new Set(requests.map((request) => request.kind))).toEqual(
      new Set(['robots', 'sitemap', 'llms', 'llms-full']),
    )
    expect(urlsOf('robots', requests)).toEqual([
      'https://example.com/robots.txt',
      'http://example.com/robots.txt',
      'https://www.example.com/robots.txt',
      'http://www.example.com/robots.txt',
    ])
    expect(urlsOf('llms', requests)).toEqual([
      'https://example.com/llms.txt',
      'https://www.example.com/llms.txt',
    ])
  })

  it('adds the optional files a domain enabled', () => {
    const requests = crawlFileRequests('example.com', {
      optionalFiles: ['security'],
      indexNowKey: 'abcd1234',
    })
    expect(urlsOf('security', requests)).toContain('https://example.com/.well-known/security.txt')
    expect(urlsOf('indexnow', requests)).toEqual([
      'https://example.com/abcd1234.txt',
      'https://www.example.com/abcd1234.txt',
    ])
    expect(urlsOf('ads', requests)).toEqual([])
  })
})

describe('sources', () => {
  it('round-trips every kind', () => {
    for (const kind of CRAWL_FILE_KINDS) expect(crawlFileKindOf(crawlFileSource(kind))).toBe(kind)
  })

  it('does not take a URL listed in a sitemap for a sitemap', () => {
    expect(crawlFileKindOf('sitemap')).toBeNull()
    expect(crawlFileKindOf('link')).toBeNull()
  })
})

describe('isDefaultSitemapUrl', () => {
  it.each([
    ['https://example.com/sitemap.xml', true],
    ['https://www.example.com/sitemap_index.xml', true],
    ['https://example.com/es/sitemap.xml', false],
    ['https://example.com/post-sitemap.xml', false],
  ])('%s is %s', (url, expected) => {
    expect(isDefaultSitemapUrl(url)).toBe(expected)
  })
})

describe('crawlFileState', () => {
  const file = (statusCode: number | null, body: string | null = 'text') => ({
    kind: 'llms' as const,
    statusCode,
    body,
    data: null,
  })

  it.each([
    [200, 'text', 'ok'],
    [200, '', 'ok'],
    [200, null, 'invalid'],
    [204, null, 'unexpected-response'],
    [206, 'partial', 'unexpected-response'],
    [304, null, 'unexpected-response'],
    [301, null, 'redirect'],
    [404, null, 'missing'],
    [410, null, 'missing'],
    [401, null, 'access-denied'],
    [403, null, 'access-denied'],
    [400, null, 'http-error'],
    [429, null, 'http-error'],
    [503, null, 'server-error'],
    [null, null, 'unreachable'],
  ] as const)('status %s with body %j is %s', (status, body, expected) => {
    expect(crawlFileState(file(status, body))).toBe(expected)
  })

  it('goes by what was found in formats whose body is not the point', () => {
    const answered = { statusCode: 200, body: null }
    expect(crawlFileState({ ...answered, kind: 'sitemap', data: null })).toBe('invalid')
    expect(
      crawlFileState({
        ...answered,
        kind: 'sitemap',
        data: { sitemap: { format: null, entries: 0, lastModified: null } },
      }),
    ).toBe('invalid')
    expect(
      crawlFileState({
        ...answered,
        kind: 'sitemap',
        data: { sitemap: { format: 'urlset', entries: 1, lastModified: null } },
      }),
    ).toBe('ok')
    expect(crawlFileState({ ...answered, kind: 'feed', data: null })).toBe('invalid')
    expect(crawlFileState({ ...answered, kind: 'opensearch', data: null })).toBe('invalid')
  })
})

describe('enabledExtraFiles', () => {
  it('lists what a domain turned on, in a fixed order, IndexNow last', () => {
    expect(enabledExtraFiles({ optionalFiles: [], indexNowKey: null })).toEqual([])
    expect(
      enabledExtraFiles({ optionalFiles: ['feed', 'ads', 'nonsense'], indexNowKey: 'abcd1234' }),
    ).toEqual(['ads', 'feed', 'indexnow'])
  })

  it('tells which kinds have a page of their own', () => {
    expect(isExtraCrawlFile('app-ads')).toBe(true)
    expect(isExtraCrawlFile('indexnow')).toBe(true)
    expect(isExtraCrawlFile('robots')).toBe(false)
    expect(isExtraCrawlFile('sitemaps')).toBe(false)
  })
})
