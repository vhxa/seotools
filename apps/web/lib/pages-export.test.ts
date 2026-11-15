import { crawlUrlHash } from '@seotools/core'
import { PAGE_ISSUES, PAGE_ISSUE_IDS } from '@seotools/core/crawl/issues'
import { ISSUE_EVIDENCE } from '@seotools/core/crawl/evidence'
import type { CrawlUrl, CrawlUrlAudit, CrawlUrlIssue, FindingStateRecord } from '@seotools/db'
import { createTranslator } from 'next-intl'
import { describe, expect, it, vi } from 'vitest'
import en from '../messages/en.json'
import es from '../messages/es.json'
import { CSV_BOM } from './csv'
import {
  EXPORT_KINDS,
  EXPORT_LINKS_PAGE_SIZE,
  ExportInconsistentError,
  FINDINGS_COLUMNS,
  LINKS_COLUMNS,
  PAGES_COLUMNS,
  REDIRECTS_COLUMNS,
  contentDisposition,
  crawlMoment,
  csvStream,
  describeListing,
  exportCsv,
  exportFileName,
  exportHeader,
  exportRecords,
  exportRefusal,
  findingsOf,
  isoSeconds,
  rawParamsOf,
  type ExportContext,
  type ExportUrl,
  type ExportSource,
  type Translate,
} from './pages-export'
import { dynamicTranslator } from './dynamic-translator'
import { parseDetailQuery, unappliedFilters, exportHref, listingOf } from './pages-query'

const translatorFor = (messages: typeof en | typeof es): Translate => {
  return dynamicTranslator(createTranslator({ locale: 'en', messages, onError: () => undefined }))
}

const SITE = 'https://example.com'

function crawlUrl(path: string, overrides: Partial<CrawlUrl> = {}): CrawlUrl {
  const url = `${SITE}${path}`
  return {
    crawlId: 'crawl-1',
    url,
    urlHash: crawlUrlHash(url),
    scope: 'internal',
    source: 'link',
    depth: 1,
    state: 'done',
    fetchedAt: new Date('2026-11-05T09:00:00Z'),
    kind: 'page',
    statusCode: 200,
    contentType: 'text/html',
    redirectTo: null,
    title: 'Home',
    metaRobots: null,
    xRobotsTag: null,
    canonical: null,
    responseTimeMs: 20,
    bytes: 100,
    error: null,
    data: null,
    ...overrides,
  } as CrawlUrl
}

const audit = (url: CrawlUrl, overrides: Partial<CrawlUrlAudit> = {}): CrawlUrlAudit => ({
  urlHash: url.urlHash,
  participation: 'audited',
  participationRule: null,
  intent: 'indexable',
  intentRule: null,
  conditions: {},
  indexability: 'indexable',
  blockers: [],
  ...overrides,
})

const issue = (url: CrawlUrl, id: string, rest: Partial<CrawlUrlIssue> = {}): CrawlUrlIssue => ({
  urlHash: url.urlHash,
  issue: id,
  ...rest,
})

const context = (overrides: Partial<ExportContext> = {}): ExportContext => ({
  host: 'example.com',
  crawlId: 'crawl-1',
  crawlDate: new Date('2026-11-05T09:30:12.345Z'),
  filters: 'View: Pages',
  analysed: true,
  translate: translatorFor(en),
  ...overrides,
})

/** Reads one record back into cells with the header as keys. */
function parse(text: string): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const char = text[i]!
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"'
        i++
      } else if (char === '"') quoted = false
      else field += char
    } else if (char === '"') quoted = true
    else if (char === ',') {
      row.push(field)
      field = ''
    } else if (char === '\r' && text[i + 1] === '\n') {
      row.push(field)
      rows.push(row)
      row = []
      field = ''
      i++
    } else field += char
  }
  return rows
}

/** The records of a file as objects keyed by their translated header. */
const asObjects = (kind: 'pages' | 'findings', records: string, c = context()) => {
  const [header, ...rows] = parse(exportHeader(kind, c) + records)
  return rows.map((cells) => Object.fromEntries(header!.map((name, i) => [name, cells[i]])))
}

describe('file name', () => {
  const date = new Date('2026-11-05T23:59:59Z')

  it('has the host, the kind and the date of the crawl', () => {
    expect(exportFileName('example.com', 'findings', date)).toBe(
      'example.com-findings-2026-11-05.csv',
    )
    expect(exportFileName('shop.example.co.uk', 'pages', date)).toBe(
      'shop.example.co.uk-pages-2026-11-05.csv',
    )
  })

  it('uses the day in UTC, whatever the time zone of the server', () => {
    expect(exportFileName('a.com', 'pages', new Date('2026-11-05T00:00:00Z'))).toContain(
      '2026-11-05',
    )
    expect(exportFileName('a.com', 'pages', new Date('2026-11-04T23:59:59Z'))).toContain(
      '2026-11-04',
    )
  })

  it.each([
    ['evil"\r\nX-Injected: 1.com', 'evil-x-injected-1.com'],
    ['../../etc/passwd', 'etc-passwd'],
    ['a b/c\\d;e.com', 'a-b-c-d-e.com'],
    ['ünï.com', 'n-.com'],
    ['', 'domain'],
    ['...', 'domain'],
  ])('builds a safe name from %j', (host, safe) => {
    const name = exportFileName(host, 'pages', date)
    expect(name).toBe(`${safe}-pages-2026-11-05.csv`)
    expect(name).toMatch(/^[a-z0-9][a-z0-9.-]*\.csv$/)
  })

  it('keeps a long host from making a long name', () => {
    expect(exportFileName('a'.repeat(500) + '.com', 'pages', date).length).toBeLessThan(140)
  })

  it('writes an attachment header with nothing that can end the value', () => {
    expect(contentDisposition('example.com-pages-2026-11-05.csv')).toBe(
      'attachment; filename="example.com-pages-2026-11-05.csv"',
    )
    expect(contentDisposition('a"\r\nSet-Cookie: x.csv')).toBe(
      'attachment; filename="a___Set-Cookie__x.csv"',
    )
  })

  it('dates a crawl by when it ended, or else started, or else was created', () => {
    const createdAt = new Date('2026-11-01T00:00:00Z')
    const startedAt = new Date('2026-11-02T00:00:00Z')
    const finishedAt = new Date('2026-11-03T00:00:00Z')
    expect(crawlMoment({ createdAt, startedAt, finishedAt })).toBe(finishedAt)
    expect(crawlMoment({ createdAt, startedAt, finishedAt: null })).toBe(startedAt)
    expect(crawlMoment({ createdAt, startedAt: null, finishedAt: null })).toBe(createdAt)
    expect(isoSeconds(new Date('2026-11-05T09:30:12.345Z'))).toBe('2026-11-05T09:30:12Z')
  })
})

describe('what cannot be exported', () => {
  const crawl = { pruned: false, pagesByWorstIssue: { issue: 0, warning: 0, opportunity: 0 } }

  it('answers an error, not an empty file', () => {
    expect(exportRefusal({ kind: 'empty' }, 'pages')).toMatchObject({ status: 409 })
    expect(exportRefusal({ kind: 'missing' }, 'pages')).toMatchObject({ status: 404 })
    expect(exportRefusal({ kind: 'selected', crawl: { ...crawl, pruned: true } }, 'pages')).toEqual(
      { status: 409, message: 'Export.errors.pruned' },
    )
  })

  it('exports a crawl that has its results', () => {
    expect(exportRefusal({ kind: 'selected', crawl }, 'pages')).toBeNull()
    expect(exportRefusal({ kind: 'selected', crawl }, 'findings')).toBeNull()
  })

  it('exports the pages of a crawl that was never checked for findings, but not its findings', () => {
    const unchecked = { pruned: false, pagesByWorstIssue: null }
    expect(exportRefusal({ kind: 'selected', crawl: unchecked }, 'pages')).toBeNull()
    expect(exportRefusal({ kind: 'selected', crawl: unchecked }, 'findings')).toEqual({
      status: 409,
      message: 'Export.errors.notAnalysed',
    })
  })
})

describe('the pages file', () => {
  it('says where each row comes from, whatever screen it was made on', () => {
    const url = crawlUrl('/')
    const [row] = asObjects(
      'pages',
      exportRecords('pages', { url, issues: [], audit: audit(url) }, context()).join(''),
    )
    expect(row).toMatchObject({
      Domain: 'example.com',
      'Crawl date (UTC)': '2026-11-05T09:30:12Z',
      'Crawl ID': 'crawl-1',
      Filters: 'View: Pages',
      URL: `${SITE}/`,
      Site: 'This site',
      Type: 'Page',
      'HTTP status': '200',
      Title: 'Home',
    })
  })

  it('says what rendering observed of each page, and that a page without a render has none', () => {
    const rendering = (render?: Parameters<typeof exportRecords>[1]['render']) => {
      const url = crawlUrl('/p')
      const [row] = asObjects(
        'pages',
        exportRecords('pages', { url, issues: [], audit: audit(url), render }, context()).join(''),
      )
      return row?.Rendering
    }
    expect(rendering('complete')).toBe('Complete')
    expect(rendering('redirect')).toBe('Redirected by JavaScript')
    expect(rendering('truncated')).toBe('Cut at the size limit')
    expect(rendering('failed')).toBe('Failed')
    expect(rendering()).toBe('Not rendered')
  })

  it('describes the state of a page in words and counts its findings per type', () => {
    const url = crawlUrl('/blocked', { statusCode: 200 })
    const text = exportRecords(
      'pages',
      {
        url,
        issues: [
          issue(url, 'no-response'),
          issue(url, 'redirect-chain'),
          issue(url, 'redirect-3xx'),
          issue(url, 'title-missing'),
        ],
        audit: audit(url, {
          indexability: 'not-indexable',
          blockers: ['noindex', 'robots'],
          intent: 'not-indexable',
          intentRule: 'rule-1',
        }),
      },
      context(),
    ).join('')
    const [row] = asObjects('pages', text)
    expect(row).toMatchObject({
      'Technical state': 'Not indexable',
      Blockers: 'noindex directive; Blocked by robots.txt',
      Audit: 'Audited',
      'Expected indexing': 'Expected not indexable',
    })
    // One issue (no-response) and three warnings, as the catalog classifies them.
    expect(row).toMatchObject({
      'Number of issues': '1',
      'Number of warnings': '3',
      'Number of opportunities': '0',
    })
  })

  it('leaves findings empty for a URL that was excluded or a crawl that was not checked', () => {
    const url = crawlUrl('/private')
    const excluded = asObjects(
      'pages',
      exportRecords(
        'pages',
        { url, issues: [], audit: audit(url, { participation: 'excluded' }) },
        context(),
      ).join(''),
    )[0]!
    expect(excluded['Audit']).toBe('Excluded from audit')
    expect([excluded['Number of issues'], excluded['Number of warnings']]).toEqual(['', ''])

    const unchecked = asObjects(
      'pages',
      exportRecords(
        'pages',
        { url, issues: [], audit: undefined },
        context({ analysed: false }),
      ).join(''),
    )[0]!
    expect(unchecked['Number of issues']).toBe('')
    expect(unchecked['Technical state']).toBe('')

    // Checked and clean is a zero, which is not the same.
    const clean = asObjects(
      'pages',
      exportRecords('pages', { url, issues: [], audit: audit(url) }, context()).join(''),
    )[0]!
    expect([
      clean['Number of issues'],
      clean['Number of warnings'],
      clean['Number of opportunities'],
    ]).toEqual(['0', '0', '0'])
  })

  it('does not type an external URL, and keeps a status that is missing empty', () => {
    const url = crawlUrl('/x', {
      url: 'https://other.org/x',
      scope: 'external',
      kind: 'unknown',
      statusCode: null,
      error: 'timeout',
      title: null,
    })
    const [row] = asObjects(
      'pages',
      exportRecords('pages', { url, issues: [], audit: undefined }, context()).join(''),
    )
    expect(row).toMatchObject({
      Site: 'External',
      Type: '',
      'HTTP status': '',
      'Request error': 'timeout',
      Title: '',
      'Expected indexing': '',
    })
  })

  it('says an expectation nobody stated is the default one', () => {
    const url = crawlUrl('/')
    const [row] = asObjects(
      'pages',
      exportRecords('pages', { url, issues: [], audit: audit(url) }, context()).join(''),
    )
    expect(row!['Expected indexing']).toBe('Expected indexable (default)')
    const resource = crawlUrl('/logo.png', { kind: 'resource' })
    const [other] = asObjects(
      'pages',
      exportRecords('pages', { url: resource, issues: [], audit: audit(resource) }, context()).join(
        '',
      ),
    )
    expect(other!['Expected indexing']).toBe('')
  })

  it('neutralises what the site wrote and keeps accents, commas and quotes', () => {
    const url = crawlUrl('/a,b?q="x"', {
      title: '=HYPERLINK("http://evil.example","Gana, ñandú")',
      error: '@cmd',
    })
    const text = exportRecords('pages', { url, issues: [], audit: audit(url) }, context()).join('')
    const [row] = asObjects('pages', text)
    expect(row!.Title).toBe(`'=HYPERLINK("http://evil.example","Gana, ñandú")`)
    expect(row!['Request error']).toBe("'@cmd")
    expect(row!.URL).toBe(`${SITE}/a,b?q="x"`)
    // The status stays a number in the file, not text.
    expect(text).toMatch(/,200,/)
  })

  it('writes the social tags and the language of the page, empty where the crawl did not store them', () => {
    const facts = {
      social: {
        openGraphTags: 3,
        title: '=SUM(1+1)',
        description: 'Shared, with a comma',
        image: 'https://cdn.example.net/a.png',
        twitterCard: 'summary',
      },
      document: { lang: 'es', viewport: null, charset: null },
    }
    const url = crawlUrl('/', { data: { facts } as unknown as CrawlUrl['data'] })
    const [row] = asObjects(
      'pages',
      exportRecords('pages', { url, issues: [], audit: audit(url) }, context()).join(''),
    )
    expect(row).toMatchObject({
      'og:title': "'=SUM(1+1)",
      'og:description': 'Shared, with a comma',
      'og:image': 'https://cdn.example.net/a.png',
      'twitter:card': 'summary',
      'HTML lang': 'es',
    })
    const older = crawlUrl('/old')
    const [empty] = asObjects(
      'pages',
      exportRecords('pages', { url: older, issues: [], audit: audit(older) }, context()).join(''),
    )
    expect(empty).toMatchObject({
      'og:title': '',
      'og:description': '',
      'og:image': '',
      'twitter:card': '',
      'HTML lang': '',
    })
  })

  it('keeps the HTTP status a bare number, even a negative-looking one is not text', () => {
    const url = crawlUrl('/')
    const record = exportRecords('pages', { url, issues: [], audit: undefined }, context()).join('')
    expect(record).not.toContain('"200"')
    expect(record).not.toContain("'200")
  })
})

describe('the findings file', () => {
  const url = crawlUrl('/page')

  it('has one row per finding, the worst first', () => {
    const records = exportRecords(
      'findings',
      {
        url,
        issues: [
          issue(url, 'redirect-3xx'),
          issue(url, 'no-response'),
          issue(url, 'redirect-chain'),
        ],
        audit: audit(url),
      },
      context(),
    )
    expect(records).toHaveLength(3)
    const rows = asObjects('findings', records.join(''))
    expect(rows.map((row) => row.Finding)).toEqual([
      en.PageIssues['no-response'].name,
      en.PageIssues['redirect-chain'].name,
      en.PageIssues['redirect-3xx'].name,
    ])
    expect(rows[0]).toMatchObject({
      Domain: 'example.com',
      'Crawl date (UTC)': '2026-11-05T09:30:12Z',
      'Crawl ID': 'crawl-1',
      URL: `${SITE}/page`,
      'Finding ID': 'no-response',
      'Finding type': 'Issue',
      Importance: 'High',
      'HTTP status': '200',
      'Technical state': 'Technically indexable',
    })
  })

  it('writes only the finding the list is filtered by, and not the others of the same URL', () => {
    const row = {
      url,
      issues: [issue(url, 'client-error'), issue(url, 'redirect-3xx')],
      audit: audit(url),
    }
    expect(exportRecords('findings', row, context())).toHaveLength(2)
    const only = exportRecords('findings', row, context({ onlyIssue: 'client-error' }))
    expect(asObjects('findings', only.join('')).map((r) => r['Finding ID'])).toEqual([
      'client-error',
    ])
    // A URL that does not have it writes nothing.
    expect(
      exportRecords(
        'findings',
        { ...row, issues: [issue(url, 'redirect-3xx')] },
        context({ onlyIssue: 'client-error' }),
      ),
    ).toEqual([])
    // The pages file is one row per URL whatever the issue: it still describes the URL whole.
    expect(exportRecords('pages', row, context({ onlyIssue: 'client-error' }))).toHaveLength(1)
  })

  it('writes nothing for a URL without findings', () => {
    expect(exportRecords('findings', { url, issues: [], audit: audit(url) }, context())).toEqual([])
  })

  it('does not make up the name, type or importance of a finding the code no longer defines', () => {
    const [row] = asObjects(
      'findings',
      exportRecords(
        'findings',
        { url, issues: [issue(url, 'retired-check')], audit: audit(url) },
        context(),
      ).join(''),
    )
    expect(row).toMatchObject({
      'Finding ID': 'retired-check',
      Finding: 'retired-check',
      Category: '',
      'Finding type': '',
      Importance: '',
    })
  })

  it('orders findings that tie in a fixed way, and the unknown ones last', () => {
    const order = findingsOf({
      url,
      issues: [
        issue(url, 'zzz-old'),
        issue(url, 'redirect-3xx'),
        issue(url, 'broken-external-link'),
      ],
      audit: undefined,
    }).map((finding) => finding.issue.issue)
    expect(order).toEqual(['broken-external-link', 'redirect-3xx', 'zzz-old'])
  })

  it('writes what a finding stores: what keeps a page out, where a hreflang came from', () => {
    const detailsOf = (id: string, details: string[]) =>
      asObjects(
        'findings',
        exportRecords(
          'findings',
          { url, issues: [issue(url, id, { details })], audit: audit(url) },
          context(),
        ).join(''),
      )[0]!.Details
    const withDetail = (kind: string) =>
      PAGE_ISSUE_IDS.find((id) => (PAGE_ISSUES[id] as { detail?: string }).detail === kind)!
    expect(detailsOf(withDetail('indexability-blocker'), ['noindex', 'robots'])).toBe(
      'noindex directive; Blocked by robots.txt',
    )
    expect(detailsOf(withDetail('hreflang-source'), ['html', 'sitemap'])).toBe('HTML; Sitemap')
    // Names of headers are what they are in any language.
    expect(detailsOf(withDetail('security-header'), ['X-Frame-Options', 'Referrer-Policy'])).toBe(
      'X-Frame-Options; Referrer-Policy',
    )
    // A finding that stores nothing has nothing to say.
    expect(detailsOf('client-error', [])).toBe('')
  })

  describe('evidence', () => {
    const evidenceIssue = 'img-no-alt'

    it('writes the addresses through evidenceTarget and the total', () => {
      const [row] = asObjects(
        'findings',
        exportRecords(
          'findings',
          {
            url,
            issues: [
              issue(url, evidenceIssue, {
                evidence: {
                  kind: 'images',
                  total: 7,
                  items: [
                    { src: '/a.png', url: `${SITE}/a.png#frag` },
                    { src: 'javascript:alert(1)', url: null },
                    { src: '', url: null },
                  ],
                },
              }),
            ],
            audit: audit(url),
          },
          context(),
        ).join(''),
      )
      expect(row!['Evidence found']).toBe('7')
      // Normalized as the crawler does; what is not an address stays what the site wrote; blanks go.
      expect(row!['Evidence samples']).toBe(`${SITE}/a.png\njavascript:alert(1)`)
    })

    it('neutralises a sample that a spreadsheet would run', () => {
      const [row] = asObjects(
        'findings',
        exportRecords(
          'findings',
          {
            url,
            issues: [
              issue(url, 'canonical-relative', {
                evidence: {
                  kind: 'canonicals',
                  total: 1,
                  items: [{ raw: '=1+1', url: null, inHead: true, source: 'html' }],
                },
              }),
            ],
            audit: audit(url),
          },
          context(),
        ).join(''),
      )
      expect(row!['Evidence samples']).toBe("'=1+1")
    })

    it('says a lower bound is one', () => {
      const [row] = asObjects(
        'findings',
        exportRecords(
          'findings',
          {
            url,
            issues: [
              issue(url, 'title-duplicate', {
                evidence: {
                  kind: 'related-urls',
                  total: 100,
                  atLeast: true,
                  urls: [`${SITE}/b`, `${SITE}/c`],
                },
              }),
            ],
            audit: audit(url),
          },
          context(),
        ).join(''),
      )
      expect(row!['Evidence found']).toBe('At least 100')
      expect(row!['Evidence samples']).toBe(`${SITE}/b\n${SITE}/c`)
    })

    it('does not make up examples for a crawl from before evidence was kept', () => {
      const [row] = asObjects(
        'findings',
        exportRecords(
          'findings',
          { url, issues: [issue(url, evidenceIssue)], audit: audit(url) },
          context(),
        ).join(''),
      )
      expect(row!['Evidence found']).toBe('')
      expect(row!['Evidence samples']).toBe('Not stored in this crawl')
    })

    it('leaves both empty for a finding that has no evidence to give', () => {
      expect(evidenceIssue in ISSUE_EVIDENCE).toBe(true)
      expect('client-error' in ISSUE_EVIDENCE).toBe(false)
      const [row] = asObjects(
        'findings',
        exportRecords(
          'findings',
          { url, issues: [issue(url, 'client-error')], audit: audit(url) },
          context(),
        ).join(''),
      )
      expect([row!['Evidence found'], row!['Evidence samples']]).toEqual(['', ''])
    })
  })
})

describe('the columns', () => {
  it.each([
    ['en', en],
    ['es', es],
  ] as const)(
    'are all translated in %s, with different headers for different columns',
    (_, catalog) => {
      for (const columns of [PAGES_COLUMNS, FINDINGS_COLUMNS, LINKS_COLUMNS, REDIRECTS_COLUMNS]) {
        const headers = columns.map((column) => column.header)
        expect(new Set(headers).size).toBe(headers.length)
        for (const header of headers) {
          expect(catalog.Export.columns, header).toHaveProperty(header)
        }
      }
      const all = [...PAGES_COLUMNS, ...FINDINGS_COLUMNS, ...LINKS_COLUMNS, ...REDIRECTS_COLUMNS]
      const translated = all.map(
        (column) => (catalog.Export.columns as Record<string, string>)[column.header],
      )
      expect(translated.every(Boolean)).toBe(true)
      // What is in the catalog and used by no file is a leftover.
      const used = new Set(all.map((column) => column.header))
      expect(Object.keys(catalog.Export.columns).filter((key) => !used.has(key))).toEqual([])
    },
  )

  it('starts both files with where the rows come from', () => {
    for (const columns of [PAGES_COLUMNS, FINDINGS_COLUMNS]) {
      expect(columns.slice(0, 4).map((column) => column.header)).toEqual([
        'domain',
        'crawlDate',
        'crawlId',
        'filters',
      ])
    }
  })

  it.each(['en', 'es'] as const)('writes the header in %s without a missing message', (locale) => {
    const missing: string[] = []
    const t = createTranslator({
      locale,
      messages: locale === 'en' ? en : es,
      onError: (error) => missing.push(error.message),
    })
    const translate: Translate = dynamicTranslator(t)
    for (const kind of EXPORT_KINDS) {
      const header = exportHeader(kind, context({ translate }))
      expect(header.endsWith('\r\n')).toBe(true)
    }
    expect(missing).toEqual([])
  })

  it.each(['en', 'es'] as const)('finds every message a row can need in %s', (locale) => {
    const missing: string[] = []
    const t = createTranslator({
      locale,
      messages: locale === 'en' ? en : es,
      onError: (error) => missing.push(error.message),
    })
    const translate: Translate = dynamicTranslator(t)
    const c = context({ translate })
    for (const id of PAGE_ISSUE_IDS) {
      const url = crawlUrl('/')
      exportRecords(
        'findings',
        { url, issues: [issue(url, id, { details: ['noindex', 'html'] })], audit: audit(url) },
        c,
      )
    }
    for (const kind of ['page', 'redirect', 'resource', 'unknown'] as const) {
      for (const intent of ['indexable', 'not-indexable', 'none'] as const) {
        for (const indexability of ['indexable', 'not-indexable', 'unknown'] as const) {
          const url = crawlUrl('/', { kind })
          exportRecords(
            'pages',
            {
              url,
              issues: [],
              audit: audit(url, {
                intent,
                indexability,
                blockers: ['noindex', 'canonical', 'robots', 'redirect', 'http-error'],
              }),
            },
            c,
          )
        }
      }
    }
    expect(missing).toEqual([])
  })
})

describe('the filters of the file', () => {
  const t = translatorFor(en)
  const query = (search: string) =>
    parseDetailQuery(Object.fromEntries(new URLSearchParams(search)))
  const describeAddress = (search: string, auditData = true) => {
    const parsed = query(search)
    return describeListing(parsed, unappliedFilters(parsed, { auditData, rendered: false }), t)
  }

  it('names the view when there are no filters', () => {
    expect(describeAddress('')).toBe('View: Pages')
    expect(describeAddress('view=external')).toBe('View: External')
  })

  it('says every filter that narrows the list', () => {
    expect(describeAddress('view=all&status=4xx&q=shop&type=redirect&audit=excluded')).toBe(
      'View: All; Search: shop; Status: 4xx client error; Type: Redirect; Audit: Excluded',
    )
  })

  it('says the issue by its name, in every view', () => {
    expect(describeAddress('issue=client-error')).toBe(
      `View: All; Issue: ${en.PageIssues['client-error'].name}`,
    )
  })

  it('does not claim a filter that did not apply', () => {
    // An audit filter on external URLs, or on a crawl with no audit data, narrows nothing.
    expect(describeAddress('view=external&audit=audited&indexability=indexable')).toBe(
      'View: External',
    )
    expect(describeAddress('audit=audited', false)).toBe('View: Pages')
  })

  it('is written in the language of the request', () => {
    const parsed = query('status=4xx')
    expect(describeListing(parsed, {}, translatorFor(es))).toBe(
      'Vista: Páginas; Estado: 4xx error del cliente',
    )
  })
})

describe('the address of an export', () => {
  const query = parseDetailQuery({
    crawl: '0e0a6c1a-1111-4222-8333-444455556666',
    view: 'all',
    q: 'sh op',
    status: '4xx',
    sort: 'status',
    dir: 'desc',
    page: '7',
    url: 'a'.repeat(32),
  })

  it('carries what the table lists and not the page or the drawer', () => {
    const href = exportHref('example.com', query, 'findings')
    const [path, search] = href.split('?')
    expect(path).toBe('/domains/example.com/urls/export/findings')
    const back = parseDetailQuery(rawParamsOf(new URLSearchParams(search)))
    expect(back).toEqual({ ...query, page: 1, url: null })
  })

  it('reads back as the same listing the table asks the database for', () => {
    const context = { auditData: true, rendered: false }
    const back = parseDetailQuery(
      rawParamsOf(new URLSearchParams(exportHref('example.com', query, 'pages').split('?')[1])),
    )
    expect(listingOf(back, unappliedFilters(back, context))).toEqual(
      listingOf(query, unappliedFilters(query, context)),
    )
  })

  it('has no query for the default table', () => {
    expect(exportHref('example.com', parseDetailQuery({}), 'pages')).toBe(
      '/domains/example.com/urls/export/pages',
    )
  })
})

describe('walking the crawl', () => {
  const urls = Array.from({ length: 1205 }, (_, i) => crawlUrl(`/p${String(i).padStart(4, '0')}`))

  function source(overrides: Partial<ExportSource> = {}) {
    const listUrls = vi.fn(async ({ limit, offset }: { limit: number; offset: number }) =>
      urls.slice(offset, offset + limit),
    )
    const issuesOf = vi.fn(async (_crawlId: string, hashes: string[]) =>
      hashes.flatMap((urlHash) => [{ urlHash, issue: 'client-error' }]),
    )
    const auditOf = vi.fn(async (_crawlId: string, hashes: string[]) =>
      hashes.map((urlHash) => audit({ urlHash } as CrawlUrl)),
    )
    return {
      listUrls: listUrls as unknown as ExportSource['listUrls'],
      issuesOf: issuesOf as unknown as ExportSource['issuesOf'],
      acceptedOf: vi.fn(async () => []) as unknown as ExportSource['acceptedOf'],
      auditOf: auditOf as unknown as ExportSource['auditOf'],
      outlinksOf: vi.fn(async () => ({
        links: [],
        next: null,
      })) as unknown as ExportSource['outlinksOf'],
      urlsOf: vi.fn(async () => []) as unknown as ExportSource['urlsOf'],
      renderStatesOf: vi.fn(async () => new Map()) as unknown as ExportSource['renderStatesOf'],
      calls: { listUrls, issuesOf, auditOf },
      ...overrides,
    }
  }

  const collect = async (pieces: AsyncGenerator<string>) => {
    const chunks: string[] = []
    for await (const piece of pieces) chunks.push(piece)
    return chunks
  }

  const run = (
    kind: 'pages' | 'findings',
    s: ExportSource,
    extra: Partial<Parameters<typeof exportCsv>[0]> = {},
  ) =>
    exportCsv({
      kind,
      source: s,
      listing: { crawlId: 'crawl-1', view: 'pages', status: '4xx' },
      context: context(),
      expected: urls.length,
      ...extra,
    })

  it('writes every URL, a batch at a time, with the header and the byte order mark first', async () => {
    const s = source()
    const chunks = await collect(run('pages', s))
    expect(chunks[0]!.startsWith(CSV_BOM)).toBe(true)
    // Header, then 500 + 500 + 205.
    expect(chunks).toHaveLength(4)
    const rows = parse(chunks.join('').replace(CSV_BOM, ''))
    expect(rows).toHaveLength(urls.length + 1)
    expect(rows.slice(1).map((row) => row[4])).toEqual(urls.map((u) => u.url))
    expect(s.calls.listUrls.mock.calls.map(([q]) => [q.limit, q.offset])).toEqual([
      [500, 0],
      [500, 500],
      [500, 1000],
    ])
  })

  it('asks the database for the filters and the order of the table, within the crawl', async () => {
    const s = source()
    await collect(run('pages', s, { sort: { sort: 'status', direction: 'desc' } }))
    expect(s.calls.listUrls.mock.calls[0]![0]).toEqual({
      crawlId: 'crawl-1',
      view: 'pages',
      status: '4xx',
      sort: 'status',
      direction: 'desc',
      limit: 500,
      offset: 0,
    })
    for (const [crawlId] of s.calls.issuesOf.mock.calls) expect(crawlId).toBe('crawl-1')
    for (const [crawlId] of s.calls.auditOf.mock.calls) expect(crawlId).toBe('crawl-1')
  })

  it('reads the findings of a batch of URLs at once, never one query per URL', async () => {
    const s = source()
    const chunks = await collect(run('findings', s))
    expect(s.calls.issuesOf).toHaveBeenCalledTimes(3)
    expect(s.calls.issuesOf.mock.calls[0]![1]).toHaveLength(500)
    expect(parse(chunks.join('').replace(CSV_BOM, ''))).toHaveLength(urls.length + 1)
  })

  it('does not read findings for the pages file of a crawl that has none', async () => {
    const s = source()
    await collect(run('pages', s, { context: context({ analysed: false }) }))
    expect(s.calls.issuesOf).not.toHaveBeenCalled()
  })

  it('holds one batch at a time, not the crawl', async () => {
    const s = source()
    const pieces = run('findings', s)
    await pieces.next() // header
    await pieces.next() // first batch
    expect(s.calls.listUrls).toHaveBeenCalledTimes(1)
  })

  it('stops reading when the client goes away', async () => {
    const s = source()
    const controller = new AbortController()
    const pieces = run('pages', s, { signal: controller.signal })
    await pieces.next()
    await pieces.next()
    controller.abort()
    expect((await pieces.next()).done).toBe(true)
    expect(s.calls.listUrls).toHaveBeenCalledTimes(1)
  })

  it('does not write a batch that was read when the client was already gone', async () => {
    const controller = new AbortController()
    const s = source()
    s.calls.listUrls.mockImplementationOnce(async () => {
      controller.abort()
      return urls.slice(0, 500)
    })
    const chunks = await collect(run('pages', s, { signal: controller.signal }))
    expect(chunks).toHaveLength(1)
    expect(s.calls.issuesOf).not.toHaveBeenCalled()
  })

  it('fails instead of ending a file that does not hold what the list did', async () => {
    const s = source()
    await expect(collect(run('pages', s, { expected: urls.length + 10 }))).rejects.toBeInstanceOf(
      ExportInconsistentError,
    )
    const gone = source()
    gone.calls.listUrls.mockImplementation(async ({ offset }: { offset: number }) =>
      offset === 0 ? urls.slice(0, 500) : [],
    )
    await expect(collect(run('pages', gone))).rejects.toBeInstanceOf(ExportInconsistentError)
  })

  it('writes just the header when the filters leave nothing', async () => {
    const empty = source()
    empty.calls.listUrls.mockResolvedValue([])
    const chunks = await collect(run('findings', empty, { expected: 0 }))
    expect(chunks).toHaveLength(1)
    expect(parse(chunks[0]!.replace(CSV_BOM, ''))).toHaveLength(1)
  })

  it('ends exactly at a multiple of the batch size without a repeated or lost URL', async () => {
    const some = urls.slice(0, 1000)
    const s = source()
    s.calls.listUrls.mockImplementation(
      async ({ limit, offset }: { limit: number; offset: number }) =>
        some.slice(offset, offset + limit),
    )
    const chunks = await collect(run('pages', s, { expected: 1000 }))
    expect(parse(chunks.join('').replace(CSV_BOM, ''))).toHaveLength(1001)
  })
})

describe('the response body', () => {
  async function* pieces(...texts: string[]) {
    for (const text of texts) yield text
  }

  const read = async (stream: ReadableStream<Uint8Array>) => {
    const decoder = new TextDecoder()
    let out = ''
    const reader = stream.getReader()
    for (;;) {
      const { done, value } = await reader.read()
      if (done) return out
      out += decoder.decode(value, { stream: true })
    }
  }

  it('encodes the pieces as UTF-8, with the byte order mark as the first bytes', async () => {
    const stream = csvStream(pieces(`${CSV_BOM}ñ,€\r\n`, 'a\r\n'))
    const reader = stream.getReader()
    const first = await reader.read()
    expect([...first.value!.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    expect(new TextDecoder().decode(first.value!.slice(3))).toBe('ñ,€\r\n')
  })

  it('carries the pieces in order', async () => {
    expect(await read(csvStream(pieces('a', 'b', 'c')))).toBe('abc')
  })

  it('reads nothing more from the database once the client cancels', async () => {
    let produced = 0
    let finished = false
    async function* endless() {
      try {
        for (;;) {
          produced++
          yield 'row\r\n'
        }
      } finally {
        finished = true
      }
    }
    const stream = csvStream(endless())
    const reader = stream.getReader()
    await reader.read()
    await reader.read()
    const before = produced
    await reader.cancel()
    await new Promise((resolve) => setTimeout(resolve))
    expect(finished).toBe(true)
    expect(produced).toBe(before)
  })

  it('does not run ahead of a client that is not reading', async () => {
    let produced = 0
    async function* endless() {
      for (;;) {
        produced++
        yield 'row\r\n'
      }
    }
    csvStream(endless())
    await new Promise((resolve) => setTimeout(resolve, 20))
    expect(produced).toBe(0)
  })

  it('stops when the request is aborted', async () => {
    const controller = new AbortController()
    let finished = false
    async function* endless() {
      try {
        for (;;) yield 'row\r\n'
      } finally {
        finished = true
      }
    }
    const stream = csvStream(endless(), controller.signal)
    await stream.getReader().read()
    controller.abort()
    await new Promise((resolve) => setTimeout(resolve))
    expect(finished).toBe(true)
  })

  it('fails the download when the walk fails, so the file is not taken for a whole one', async () => {
    async function* broken() {
      yield 'header\r\n'
      throw new Error('database went away')
    }
    await expect(read(csvStream(broken()))).rejects.toThrow('database went away')
  })
})

describe('what a rule accepts', () => {
  const url = crawlUrl('/s')
  const accepted = {
    urlHash: url.urlHash,
    issue: 'hreflang-noindex',
    acceptedBy: 'b'.repeat(32),
    acceptance: {
      kind: 'relation' as const,
      end: 'destination' as const,
      blockers: ['noindex' as const],
      rules: ['r1'],
    },
    evidence: { kind: 'related-urls' as const, total: 1, urls: ['https://example.com/t'] },
  }
  const row = {
    url,
    issues: [issue(url, 'client-error')],
    accepted: [accepted],
    audit: audit(url),
  }

  it('stays out of the findings file unless the list asks for it', () => {
    const rows = asObjects('findings', exportRecords('findings', row, context()).join(''))
    expect(rows.map((r) => r['Finding ID'])).toEqual(['client-error'])
    expect(rows[0]).toMatchObject({ State: 'Pending', 'Accepted because': '' })
  })

  it('says it is accepted, why, and what it is about, and is never told as pending', () => {
    const rows = asObjects(
      'findings',
      exportRecords('findings', row, context({ onlyAccepted: 'all' })).join(''),
    )
    expect(rows.map((r) => r['Finding ID'])).toEqual(['hreflang-noindex'])
    expect(rows[0]!.State).toBe('Accepted by a rule')
    expect(rows[0]!['Accepted because']).toContain('points at')
    expect(rows[0]!['Evidence samples']).toBe('https://example.com/t')
  })

  it('narrows to one finding when the list does', () => {
    expect(exportRecords('findings', row, context({ onlyAccepted: 'noindex' }))).toEqual([])
  })

  it('counts on the pages file apart from what is pending', () => {
    const [record] = asObjects('pages', exportRecords('pages', row, context()).join(''))
    expect(record!['Accepted or dismissed']).toBe('1')
    expect(record!['Number of issues']).toBe('1')
  })
})

describe('the links and redirects files', () => {
  const context = {
    host: 'example.com',
    crawlId: 'c1',
    crawlDate: new Date('2026-11-06T10:00:00Z'),
    filters: '',
    onlyIssue: null,
    onlyAccepted: null,
    analysed: true,
    translate: (key: string) => key,
  } as unknown as Parameters<typeof exportRecords>[2]

  it('writes one row per link leaving a URL, with where it sits', () => {
    const row = {
      url: crawlUrl('/a'),
      issues: [],
      audit: undefined,
      links: [
        {
          sourceHash: 'h',
          url: 'https://example.com/b',
          urlHash: 'b',
          kind: 'anchor' as const,
          scope: 'internal' as const,
          urlKind: 'page' as const,
          state: 'done' as const,
          statusCode: 404,
          error: null,
          context: { text: 'B', element: 'a.menu', region: 'nav' as const },
        },
      ],
    }
    const [line] = exportRecords('links', row, context)
    expect(line).toContain('https://example.com/b')
    expect(line).toContain('LinkKinds.anchor')
    expect(line).toContain('404')
    expect(line).toContain('a.menu')
    expect(line).toContain('LinkRegions.nav')
  })

  it('reads the links of a URL a bounded page at a time, every link once', async () => {
    const total = EXPORT_LINKS_PAGE_SIZE * 2 + 7
    const outlinksOf = vi.fn(
      async (
        _id: string,
        sourceHash: string,
        { after, limit }: { after: { target: number; kind: string } | null; limit: number },
      ) => {
        const start = after ? after.target + 1 : 0
        const end = Math.min(start + limit, total)
        const links = Array.from({ length: end - start }, (_, i) => ({
          sourceHash,
          url: `https://example.com/t${start + i}`,
          urlHash: `t${start + i}`,
          kind: 'anchor' as const,
          scope: 'internal' as const,
          urlKind: 'page' as const,
          state: 'done' as const,
          statusCode: 200,
          error: null,
          context: null,
        }))
        return { links, next: end < total ? { target: end - 1, kind: 'anchor' } : null }
      },
    )
    const source = {
      listUrls: vi.fn(async ({ offset }: { offset: number }) =>
        offset === 0 ? [crawlUrl('/a')] : [],
      ),
      issuesOf: vi.fn(async () => []),
      acceptedOf: vi.fn(async () => []),
      auditOf: vi.fn(async () => []),
      outlinksOf,
      urlsOf: vi.fn(async () => []),
    } as unknown as ExportSource
    const chunks: string[] = []
    for await (const piece of exportCsv({
      kind: 'links',
      source,
      listing: { crawlId: 'c1', view: 'pages' },
      context,
      expected: 1,
    })) {
      chunks.push(piece)
    }
    const lines = chunks.join('').trim().split('\r\n').slice(1)
    expect(lines).toHaveLength(total)
    expect(new Set(lines).size).toBe(total)
    expect(outlinksOf).toHaveBeenCalledTimes(3)
    for (const [, , page] of outlinksOf.mock.calls) {
      expect(page.limit).toBe(EXPORT_LINKS_PAGE_SIZE)
    }
  })

  it.each([{ ignoredParameters: [] as string[] }, { ignoredParameters: ['updatedAt'] }])(
    'follows redirect chains with snapshot %j and tells a loop',
    async ({ ignoredParameters }) => {
      const hop = (path: string, to: string | null, status = 301): CrawlUrl => ({
        ...crawlUrl(path),
        kind: to ? 'redirect' : 'page',
        statusCode: to ? status : 200,
        redirectTo: to ? `${SITE}${to}${ignoredParameters.length ? '?updatedAt=1' : ''}` : null,
      })
      const known = [hop('/b', '/c'), hop('/c', null), hop('/x', '/y'), hop('/y', '/x')]
      const byHash = new Map(known.map((url) => [url.urlHash, url]))
      const start = [hop('/a', '/b'), hop('/x', '/y')]
      const source = {
        listUrls: vi.fn(async ({ offset }: { offset: number }) => (offset === 0 ? start : [])),
        issuesOf: vi.fn(async () => []),
        acceptedOf: vi.fn(async () => []),
        auditOf: vi.fn(async () => []),
        outlinksOf: vi.fn(async () => ({ links: [], next: null })),
        urlsOf: vi.fn(async (_id: string, hashes: string[]) =>
          hashes.flatMap((hash) => byHash.get(hash) ?? []),
        ),
      } as unknown as ExportSource
      const chunks: string[] = []
      for await (const piece of exportCsv({
        kind: 'redirects',
        source,
        listing: { crawlId: 'c1', view: 'redirects' },
        context: { ...context, ignoredParameters },
        expected: 2,
      })) {
        chunks.push(piece)
      }
      const [, a, x] = chunks.join('').trim().split('\r\n')
      expect(a).toContain(`${SITE}/c`)
      expect(a).toContain(',2,')
      expect(x).toContain('Export.values.yes')
    },
  )
})

it('exports dismissed state and neutralises a member note as a CSV cell', () => {
  const url = crawlUrl('/a')
  const c = context({ onlyAccepted: 'all', onlyState: 'dismissed' })
  const text = exportRecords(
    'findings',
    {
      url,
      issues: [],
      audit: audit(url),
      accepted: [
        {
          ...issue(url, 'title-missing'),
          acceptedBy: url.urlHash,
          acceptance: {
            kind: 'dismissal',
            state: 'dismissed',
            scope: 'url',
            id: 'd',
            setBy: 'alice',
            setAt: '2026-11-12T00:00:00.000Z',
          },
        },
      ],
      findingStates: [
        {
          id: 'd',
          domainId: 'domain',
          issue: 'title-missing',
          urlHash: url.urlHash,
          targetKey: url.urlHash,
          state: 'dismissed',
          note: '=HYPERLINK("untrusted")',
          setBy: null,
          setAt: new Date('2026-11-12T00:00:00.000Z'),
        },
      ],
    },
    c,
  ).join('')
  expect(asObjects('findings', text, c)[0]).toMatchObject({
    State: 'Dismissed',
    'Decision note': '\'=HYPERLINK("untrusted")',
  })
})

it('labels a pending finding a person marked in progress, with its note', () => {
  const url = crawlUrl('/a')
  const c = context()
  const text = exportRecords(
    'findings',
    {
      url,
      issues: [issue(url, 'title-missing')],
      audit: audit(url),
      findingStates: [
        {
          id: 'p',
          domainId: 'domain',
          issue: 'title-missing',
          urlHash: null,
          targetKey: '*',
          state: 'in-progress',
          note: 'Template fix next sprint',
          setBy: null,
          setAt: new Date(),
        },
      ],
    },
    c,
  ).join('')
  expect(asObjects('findings', text, c)[0]).toMatchObject({
    State: 'In progress',
    'Decision note': 'Template fix next sprint',
  })
})

const decisionRow = (
  url: CrawlUrl,
  patch: Partial<FindingStateRecord> = {},
): FindingStateRecord => ({
  id: 'd',
  domainId: 'domain',
  issue: 'title-missing',
  urlHash: url.urlHash,
  targetKey: url.urlHash,
  state: 'dismissed',
  note: 'Alice note',
  setBy: 'alice',
  setAt: new Date('2026-11-12T00:00:00Z'),
  ...patch,
})

it('keeps historical CSV attribution and suppresses a changed or removed decision note', () => {
  const url = crawlUrl('/a')
  const acceptance = {
    kind: 'dismissal' as const,
    state: 'dismissed' as const,
    scope: 'url' as const,
    id: 'd',
    setBy: 'alice',
    setAt: '2026-11-12T00:00:00.000Z',
  }
  const c = context({
    onlyAccepted: 'all',
    decisionNames: new Map([
      ['alice', 'Alice'],
      ['bob', 'Bob'],
    ]),
  })
  for (const findingStates of [
    [decisionRow(url, { state: 'in-progress', setBy: 'bob', note: 'Bob note' })],
    [decisionRow(url, { setBy: 'bob', note: 'Bob note', setAt: new Date('2026-11-13T00:00:00Z') })],
    [],
  ]) {
    const row = {
      url,
      issues: [],
      audit: audit(url),
      findingStates,
      accepted: [{ ...issue(url, 'title-missing'), acceptedBy: url.urlHash, acceptance }],
    }
    const text = exportRecords('findings', row, c).join('')
    expect(asObjects('findings', text, c)[0]).toMatchObject({
      'Dismissed by': 'Alice',
      'Dismissed at': acceptance.setAt,
      'Decision note': 'The decision has changed since this analysis.',
    })
    expect(text).not.toContain('Bob note')
    expect(
      asObjects(
        'findings',
        exportRecords('findings', row, { ...c, decisionNames: new Map() }).join(''),
        c,
      )[0]?.['Dismissed by'],
    ).toBe('a former member')
  }
})

it('filters each finding by state and resolves URL progress overrides before domain labels', () => {
  const url = crawlUrl('/a')
  const row: ExportUrl = {
    url,
    audit: audit(url),
    issues: [issue(url, 'title-missing'), issue(url, 'description-missing')],
    findingStates: [decisionRow(url, { state: 'in-progress' })],
  }
  const ids = (state: 'pending' | 'in-progress') => {
    const c = context({ onlyState: state })
    return asObjects('findings', exportRecords('findings', row, c).join(''), c).map(
      (r) => r['Finding ID'],
    )
  }
  expect(ids('in-progress')).toEqual(['title-missing'])
  expect(ids('pending')).toEqual(['description-missing'])
  row.findingStates = [
    decisionRow(url, { id: 'domain', urlHash: null, targetKey: '*', state: 'in-progress' }),
    decisionRow(url, { state: 'pending' }),
  ]
  expect(ids('in-progress')).toEqual([])
  expect(ids('pending')).toEqual(expect.arrayContaining(['title-missing', 'description-missing']))
  row.findingStates = [
    decisionRow(url, { urlHash: null, targetKey: '*', state: 'pending' }),
    decisionRow(url, { state: 'in-progress' }),
  ]
  expect(ids('in-progress')).toEqual(['title-missing'])
})

it('exports rule and dismissal acceptances separately even on the same URL and issue', () => {
  const url = crawlUrl('/a')
  const row: ExportUrl = {
    url,
    audit: audit(url),
    issues: [],
    accepted: [
      {
        ...issue(url, 'title-missing'),
        acceptedBy: url.urlHash,
        acceptance: { kind: 'expectation', rule: null },
      },
      {
        ...issue(url, 'title-missing'),
        acceptedBy: 'other',
        acceptance: { kind: 'dismissal', state: 'dismissed', scope: 'url', id: 'd' },
      },
    ],
  }
  for (const onlyAcceptedKind of ['rule', 'dismissal'] as const) {
    const c = context({ onlyAccepted: 'title-missing', onlyAcceptedKind })
    const rows = asObjects('findings', exportRecords('findings', row, c).join(''), c)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.State).toBe(onlyAcceptedKind === 'rule' ? 'Accepted by a rule' : 'Dismissed')
  }
})
