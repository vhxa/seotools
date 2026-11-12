import { describe, expect, it } from 'vitest'
import { detectIncidents, type ActiveIncident } from './incidents'
import { vitalsRegressions } from './vitals-regression'
const now = new Date('2026-06-15T12:00:00Z')
const file = (body = 'User-agent: *\nDisallow:') => ({
  url: 'https://example.com/robots.txt',
  kind: 'robots' as const,
  statusCode: 200,
  contentType: 'text/plain',
  redirectTo: null,
  bytes: 10,
  truncated: false,
  body,
  error: null,
  data: null,
  fetchedAt: now,
})
const observe = (patch: Partial<Parameters<typeof detectIncidents>[0]>) =>
  detectIncidents({
    origin: 'https://example.com/',
    previous: [file()],
    files: [file()],
    active: [],
    previousCheck: null,
    now,
    ...patch,
  })
describe('incident detection', () => {
  it('establishes a baseline without reporting pre-existing file problems', () => {
    expect(observe({ previous: [], files: [file('User-agent: *\nDisallow: /')] }).open).toEqual([])
  })
  it('detects a whole-site block and a bounded robots change', () => {
    const result = observe({
      files: [file('User-agent: *\nDisallow: /\nSitemap: https://example.com/map.xml')],
    })
    expect(result.open.map((i) => i.kind)).toEqual(['robots-blocks-site', 'robots-changed'])
    expect(result.open[1]?.details).toContain('sitemapsAdded')
    expect(result.open[1]!.details.length).toBeLessThanOrEqual(4000)
  })
  it('ignores whitespace and comment-only edits', () => {
    expect(
      observe({ files: [file(' # hello\nUser-agent : * # comment\n Disallow:   ')] }).open,
    ).toEqual([])
  })
  it('treats 404 as a change rather than a break', () => {
    expect(
      observe({ files: [{ ...file(), statusCode: 404, body: null }] }).open.map((i) => i.kind),
    ).toEqual(['robots-changed'])
  })
  it('reports unreachable robots only if another request answered', () => {
    const broken = { ...file(), statusCode: null, error: 'TIMEOUT: failed', body: null }
    expect(observe({ files: [broken] }).open).toEqual([])
    expect(
      observe({ files: [broken, { ...file(), url: 'https://example.com/llms.txt', kind: 'llms' }] })
        .open[0]?.kind,
    ).toBe('robots-unreachable')
  })
  it('reports previously populated sitemaps that become empty', () => {
    const sitemap = {
      ...file(),
      url: 'https://example.com/sitemap.xml',
      kind: 'sitemap' as const,
      data: { sitemap: { format: 'urlset' as const, entries: 4, lastModified: null } },
    }
    expect(
      observe({ previous: [sitemap], files: [{ ...sitemap, data: null }] }).open[0]?.kind,
    ).toBe('sitemap-broken')
  })
  it('requires failed checks at least an hour apart and excludes TLS failures', () => {
    const check = { outcome: 'unreachable', checkedAt: now }
    const previousCheck = { ...check, checkedAt: new Date(now.getTime() - 3600000) }
    expect(observe({ files: [], previousCheck, check }).open[0]?.kind).toBe('site-down')
    expect(
      observe({
        files: [],
        previousCheck: { ...previousCheck, checkedAt: new Date(now.getTime() - 3599999) },
        check,
      }).open,
    ).toEqual([])
    expect(
      observe({
        files: [{ ...file(), statusCode: null, error: 'CERT_HAS_EXPIRED: expired' }],
        previousCheck,
        check,
      }).open.map((i) => i.kind),
    ).toEqual(['certificate'])
  })
  it.each([
    [14, 'warn-14'],
    [3, 'warn-3'],
    [-1, 'expired'],
  ] as const)('detects certificate threshold %s days without a baseline', (days, stage) => {
    expect(
      observe({
        previous: [],
        files: [
          {
            ...file(),
            data: { tls: { validTo: new Date(now.getTime() + days * 86400000).toISOString() } },
          },
        ],
      }).open[0]?.stage,
    ).toBe(stage)
  })
  it('escalates the same incident and resolves after renewal', () => {
    const active: ActiveIncident[] = [
      {
        id: 'id',
        kind: 'certificate',
        subject: 'https://example.com/',
        stage: 'warn-14',
        details: '{}',
      },
    ]
    const files = [
      { ...file(), data: { tls: { validTo: new Date(now.getTime() + 86400000).toISOString() } } },
    ]
    expect(observe({ active, files }).escalate[0]).toMatchObject({ id: 'id', stage: 'warn-3' })
    files[0]!.data.tls.validTo = new Date(now.getTime() + 30 * 86400000).toISOString()
    expect(observe({ active, files }).resolve).toEqual(active)
  })
  it('resolves on a reachable check and on unblocked robots', () => {
    const active: ActiveIncident[] = [
      {
        id: 'down',
        kind: 'site-down',
        subject: 'https://example.com/',
        stage: 'open',
        details: '{}',
      },
      {
        id: 'block',
        kind: 'robots-blocks-site',
        subject: file().url,
        stage: 'open',
        details: '{}',
      },
    ]
    expect(observe({ active, check: { outcome: 'ok', checkedAt: now } }).resolve).toHaveLength(2)
  })
})
it('vitals regress only from known non-poor field data to poor, per form factor', () => {
  const row = { formFactor: 'PHONE', status: 'collected', lcp: 2500, inp: 200, cls: 0.1 }
  expect(vitalsRegressions([row], [{ ...row, lcp: 4100, inp: 501, cls: 0.26 }])).toHaveLength(3)
  expect(vitalsRegressions([{ ...row, lcp: null }], [{ ...row, lcp: 4100 }])).toEqual([])
  expect(vitalsRegressions([row], [{ ...row, formFactor: 'DESKTOP', lcp: 4100 }])).toEqual([])
})
