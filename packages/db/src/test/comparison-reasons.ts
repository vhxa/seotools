import {
  DEFAULT_CRAWL_SETTINGS,
  JOB_TYPES,
  crawlUrlHash,
  type CrawlLinkKind,
  type CrawlSettings,
  type CrawlUrlKind,
  type CrawlUrlSource,
} from '@seotools/core'
import { EXPLANATION_VERSION } from '@seotools/core/crawl/comparison-reasons'
import { describe, expect, it } from 'vitest'
import { compareWithPrevious } from '../changes'
import { ComparisonSupersededError } from '../comparison-errors'
import { NO_CAPTURE_TRUST, explainPair, type ExplainOptions } from '../explain'
import { CAPTURE_DELAY_TOLERANCE_MS, CURRENT_CAPTURE_RULE } from '@seotools/core/crawl/render-state'
import type { AnswerPair } from '@seotools/core/crawl/paired'
import type {
  CrawlLink,
  CrawlUrlRender,
  CrawlUrlResult,
  Database,
  ExplainedUrl,
  NewCrawlUrl,
} from '../types'
import { createCompany } from '../workspace'

const site = 'https://acme.com'
const urlOf = (path: string) => `${site}${path}`
const hashOf = (path: string) => crawlUrlHash(urlOf(path))

type RenderKind =
  | 'complete'
  | 'proven'
  | 'failed-dependency'
  | 'late'
  | 'pending'
  | 'legacy-rule'
  | 'failed'
  | 'truncated'
  | 'unsettled'
  | 'redirect'

interface Link {
  to: string
  kind?: CrawlLinkKind
  rendered?: boolean
  text?: string
}

interface Page {
  links?: (string | Link)[]
  source?: CrawlUrlSource
  /** Found and left for later: the crawl stopped first. */
  queued?: boolean
  notRequested?: 'excluded' | 'depth'
  kind?: CrawlUrlKind
  status?: number | null
  truncated?: boolean
  render?: RenderKind
  /** Overrides how the crawl says it found the page, without a stored link (a missing edge). */
  discoveredFrom?: string
}

interface CrawlSpec {
  ignored?: string[]
  rendered?: boolean
  status?: 'completed' | 'incomplete'
  /** WP3's paired observations, stored when the crawl ends. */
  pairs?: AnswerPair[]
  /** Settings of the crawl besides rendering and ignored parameters (snapshotted at start). */
  settings?: Partial<CrawlSettings>
}

const result = (page: Page): CrawlUrlResult => ({
  kind: page.kind ?? 'page',
  statusCode: page.status === undefined ? 200 : page.status,
  contentType: 'text/html',
  redirectTo: null,
  title: null,
  metaRobots: null,
  xRobotsTag: null,
  canonical: null,
  responseTimeMs: 10,
  bytes: 100,
  error: page.status === null ? 'timeout' : null,
  data: page.truncated ? { truncated: true } : null,
})

function renderOf(path: string, kind: RenderKind): CrawlUrlRender {
  const base: CrawlUrlRender = {
    urlHash: hashOf(path),
    status: 'rendered',
    settled: true,
    truncated: false,
    finalUrl: urlOf(path),
    durationMs: 10,
    failure: null,
    data: {
      facts: null,
      capture: { pending: 0, afterMs: 100 },
      requests: {},
      scriptErrors: { count: 0, first: [] },
    } as unknown as CrawlUrlRender['data'],
  }
  switch (kind) {
    case 'complete':
      return base
    case 'proven':
      // WP1's current capture: on time, nothing pending, no failed dependency. Proves absence.
      return { ...base, data: { ...base.data, ...currentCapture() } } as CrawlUrlRender
    case 'failed-dependency':
      return {
        ...base,
        data: { ...base.data, ...currentCapture(), requests: { failedCount: 1 } },
      } as CrawlUrlRender
    case 'late':
      return {
        ...base,
        data: {
          ...base.data,
          ...currentCapture(),
          capture: { ...currentCapture().capture, delayMs: CAPTURE_DELAY_TOLERANCE_MS + 1 },
        },
      } as CrawlUrlRender
    case 'pending':
      return {
        ...base,
        data: {
          ...base.data,
          ...currentCapture(),
          capture: { ...currentCapture().capture, pending: 2 },
        },
      } as CrawlUrlRender
    case 'legacy-rule':
      return {
        ...base,
        data: {
          ...base.data,
          ...currentCapture(),
          capture: { ...currentCapture().capture, rule: 'v2' },
        },
      } as CrawlUrlRender
    case 'failed':
      return { ...base, status: 'failed', failure: 'crashed' }
    case 'truncated':
      return { ...base, truncated: true }
    case 'unsettled':
      return {
        ...base,
        settled: false,
        data: { ...base.data, capture: { pending: 3, afterMs: 5000 } },
      }
    case 'redirect':
      return { ...base, data: { ...base.data, redirected: true } }
  }
}

/** What WP1 stores of a capture made under its current rule, with nothing that disqualifies it. */
const currentCapture = () => ({
  capture: { rule: CURRENT_CAPTURE_RULE, pending: 0, afterMs: 5000, delayMs: 3 },
  requests: { failedCount: 0 },
})

/** Dedicated PostgreSQL sessions (one connection each), to hold locks while a repository waits. */
export interface RawSessions {
  open: () => Promise<{
    query: (text: string) => Promise<Record<string, unknown>[]>
    close: () => Promise<void>
  }>
}

export function describeComparisonReasons(
  getDb: () => Database,
  getSessions: () => RawSessions | null = () => null,
) {
  describe('why URLs differ between two crawls', () => {
    let seq = 0
    let hostCount = 0

    async function domain() {
      const host = `acme${++hostCount}.com`
      const created = await createCompany(getDb(), { name: host, domain: host })
      if (!created.ok) throw new Error('setup failed')
      return created.domain.id
    }

    /**
     * A finished full crawl with these pages, numbered in order. Links are stored as the crawler
     * stores them (by `seq`), and each URL's `foundFrom` is its first in-link.
     */
    async function crawlOf(domainId: string, pages: Record<string, Page>, spec: CrawlSpec = {}) {
      const db = getDb()
      await db.crawls.saveSettings(domainId, {
        ...DEFAULT_CRAWL_SETTINGS,
        ...spec.settings,
        renderingMode: spec.rendered ? 'headless' : 'http',
        ignoredParameters: spec.ignored ?? [],
      })
      await db.crawls.saveIgnoredParameters(domainId, spec.ignored ?? [])
      const crawl = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
      if (!crawl) throw new Error('crawl did not start')
      const seqs = new Map<string, number>()
      for (const path of Object.keys(pages)) seqs.set(path, ++seq)
      const foundFrom = new Map<string, { from: string; kind: CrawlLinkKind }>()
      const linksOf = (path: string) =>
        (pages[path]!.links ?? []).map((link) => (typeof link === 'string' ? { to: link } : link))
      for (const path of Object.keys(pages)) {
        for (const link of linksOf(path)) {
          if (!foundFrom.has(link.to))
            foundFrom.set(link.to, { from: path, kind: link.kind ?? 'anchor' })
        }
      }
      const urls: NewCrawlUrl[] = Object.entries(pages).map(([path, page]) => {
        const found = page.discoveredFrom
          ? { from: page.discoveredFrom, kind: 'anchor' as const }
          : foundFrom.get(path)
        return {
          url: urlOf(path),
          urlHash: hashOf(path),
          scope: 'internal',
          source: page.source ?? (path === '/' ? 'seed' : 'link'),
          depth: path === '/' ? 0 : 1,
          seq: seqs.get(path)!,
          ...(page.notRequested ? { notRequested: page.notRequested } : {}),
          ...(found ? { foundFrom: seqs.get(found.from)!, foundKind: found.kind } : {}),
        }
      })
      await db.crawls.addUrls(crawl.id, urls)
      for (const [path, page] of Object.entries(pages)) {
        if (page.queued || page.notRequested) continue
        const links: CrawlLink[] = linksOf(path).map((link) => ({
          sourceHash: hashOf(path),
          targetHash: hashOf(link.to),
          sourceSeq: seqs.get(path)!,
          targetSeq: seqs.get(link.to)!,
          kind: link.kind ?? 'anchor',
          ...(link.rendered ? { rendered: 1 } : {}),
          ...(link.text ? { context: { text: link.text } } : {}),
        }))
        await db.crawls.recordResult({
          crawlId: crawl.id,
          urlHash: hashOf(path),
          result: result(page),
          ...(page.render ? { render: renderOf(path, page.render) } : {}),
          links,
        })
      }
      await db.crawls.finish(crawl.id, {
        status: spec.status ?? 'completed',
        ...(spec.pairs
          ? {
              observations: {
                summary: {
                  version: 1 as const,
                  eligible: spec.pairs.length,
                  selected: spec.pairs.length,
                  comparable: spec.pairs.length,
                  different: spec.pairs.filter((pair) => pair.changed.length > 0).length,
                  unknown: {},
                  examples: [],
                },
                pairs: spec.pairs,
              },
            }
          : {}),
      })
      // Ordering by creation time has millisecond resolution.
      await new Promise((resolve) => setTimeout(resolve, 5))
      return crawl
    }

    async function explained(
      basePages: Record<string, Page>,
      targetPages: Record<string, Page>,
      specs: { base?: CrawlSpec; target?: CrawlSpec } = {},
      options: Partial<ExplainOptions> = {},
    ) {
      const db = getDb()
      const domainId = await domain()
      const base = await crawlOf(domainId, basePages, specs.base)
      const target = await crawlOf(domainId, targetPages, specs.target)
      const ids = { domainId, baseId: base.id, targetId: target.id }
      const outcome = await explainPair({
        db,
        baseId: base.id,
        targetId: target.id,
        runner: 'test',
        ...options,
      })
      expect(outcome).toBe('done')
      return { ids, rows: await rowsOf(ids) }
    }

    /** Every stored row of the pair, by path, as the comparison lists them. */
    async function rowsOf(ids: { domainId: string; baseId: string; targetId: string }) {
      const db = getDb()
      const found = new Map<string, ExplainedUrl>()
      const work = db.crawls.comparisonWork
      // Listed through the repository the page uses, for both groups and both sides.
      for (const change of ['missing', 'added', 'configuration'] as const) {
        for (const view of ['pages', 'other'] as const) {
          const listed = await db.crawls.compareUrls({
            ...ids,
            change,
            view,
            limit: 10_000,
            offset: 0,
          })
          for (const row of listed) {
            const explanation = row.explanation
            if (!explanation) continue
            found.set(row.url.slice(site.length), {
              side: explanation.side,
              urlHash: row.urlHash,
              seq: explanation.seq,
              reason: explanation.reason,
              detail: explanation.detail,
              via: explanation.via,
              viaKind: explanation.viaKind,
              viaRendered: explanation.viaRendered,
              through: explanation.through,
              sources: explanation.sources,
              unseen: 0,
              intoHash: explanation.into?.urlHash ?? null,
              intoUrl: explanation.into?.url ?? null,
              intoPresent: explanation.into?.present ?? null,
            })
          }
        }
      }
      expect(await work.pending({ ...ids, after: null, limit: 10 })).toEqual([])
      return found
    }

    const reasonOf = (rows: Map<string, ExplainedUrl>, path: string) => {
      const row = rows.get(path)
      return row && [row.reason, row.detail]
    }

    it('counts 513 pages merged by a newly ignored parameter as merged, never as not seen', async () => {
      const db = getDb()
      const count = 513
      const keys = Array.from({ length: count }, (_, i) => `/e/${i}`)
      const basePages: Record<string, Page> = {
        '/': { links: [...keys.flatMap((key) => [`${key}?duration=60`, key]), '/e/x?duration=60'] },
      }
      for (const key of keys) {
        basePages[`${key}?duration=60`] = {}
        basePages[key] = {}
      }
      basePages['/e/x?duration=60'] = {}
      const targetPages: Record<string, Page> = { '/': { links: keys } }
      for (const key of keys) targetPages[key] = {}

      const { ids, rows } = await explained(basePages, targetPages, {
        target: { ignored: ['duration'] },
      })
      const counts = await db.crawls.compareCounts({ ...ids, view: 'pages' })
      expect(counts).toMatchObject({
        explained: true,
        missing: 0,
        added: 0,
        configuration: count + 1,
        reasons: { base: { merged: count + 1 }, target: {} },
      })
      expect(await db.crawls.countCompared({ ...ids, change: 'missing', view: 'pages' })).toBe(0)
      expect(
        await db.crawls.countCompared({ ...ids, change: 'configuration', view: 'pages' }),
      ).toBe(count + 1)
      expect(rows.get('/e/7?duration=60')).toMatchObject({
        side: 'base',
        reason: 'merged',
        intoUrl: urlOf('/e/7'),
        intoPresent: true,
      })
      // Its address without the parameter is not in the later crawl either: said, never hidden.
      expect(rows.get('/e/x?duration=60')).toMatchObject({
        reason: 'merged',
        intoUrl: urlOf('/e/x'),
        intoPresent: false,
      })

      const comparison = await compareWithPrevious({
        db,
        target: (await db.crawls.get(ids.targetId))!,
        findings: false,
      })
      expect(comparison).toMatchObject({ explained: true })
      expect(comparison.urls).toMatchObject({ missing: 0, added: 0, configuration: count + 1 })
    }, 120_000)

    it('counts every URL as today, and says nothing is explained, until the pair is worked out', async () => {
      const db = getDb()
      const domainId = await domain()
      const base = await crawlOf(domainId, {
        '/': { links: ['/a?duration=1'] },
        '/a?duration=1': {},
      })
      const target = await crawlOf(domainId, { '/': {} }, { ignored: ['duration'] })
      const ids = { domainId, baseId: base.id, targetId: target.id }
      expect(await db.crawls.compareCounts({ ...ids, view: 'pages' })).toMatchObject({
        missing: 1,
        configuration: 0,
        explained: false,
        reasons: { base: {}, target: {} },
      })
      const listed = await db.crawls.compareUrls({
        ...ids,
        change: 'missing',
        view: 'pages',
        limit: 10,
        offset: 0,
      })
      expect(listed.map((row) => row.explanation ?? null)).toEqual([null])
      expect(
        await db.crawls.countCompared({ ...ids, change: 'configuration', view: 'pages' }),
      ).toBe(0)
      const comparison = await compareWithPrevious({ db, target, findings: false })
      expect(comparison.explained).toBe(false)
    })

    it('says a URL is no longer linked when every page that linked it was read whole', async () => {
      const db = getDb()
      const { ids, rows } = await explained(
        { '/': { links: [{ to: '/gone', text: 'Old offer' }] }, '/gone': {} },
        { '/': {} },
      )
      const row = rows.get('/gone')!
      expect([row.reason, row.side, row.sources]).toEqual(['unlinked', 'base', 1])
      const details = await db.crawls.explanationDetails({
        ...ids,
        rows: [{ side: 'base', seq: row.seq, via: row.via, viaKind: row.viaKind, through: null }],
      })
      expect(details.urls.base.get(row.via!)).toBe(urlOf('/'))
      expect(details.links.base.get(row.seq!)).toEqual({
        kind: 'anchor',
        rendered: false,
        context: { text: 'Old offer' },
      })
    })

    it('says a URL appeared because a page read whole by the earlier crawl links it now', async () => {
      const { rows } = await explained({ '/': {} }, { '/': { links: ['/new'] }, '/new': {} })
      expect(reasonOf(rows, '/new')).toEqual(['linked', null])
    })

    it.each([
      // An error page is not the page: what it links proves nothing either way.
      ['a 404', { status: 404 }, 'notReached', 'error-answer'],
      ['a 410', { status: 410 }, 'notReached', 'error-answer'],
      ['a 503', { status: 503 }, 'notReached', 'failed'],
      ['no answer', { status: null }, 'notReached', 'failed'],
      ['a 401', { status: 401 }, 'notReached', 'failed'],
      ['a 403', { status: 403 }, 'notReached', 'failed'],
      ['a 429', { status: 429 }, 'notReached', 'failed'],
      ['a redirect', { status: 301, kind: 'redirect' }, 'notReached', 'redirected'],
      ['cut served HTML', { truncated: true }, 'notReached', 'served-truncated'],
      ['a page left for later', { queued: true }, 'notReached', 'not-requested'],
    ] as const)(
      'reads a linking page that now answers %s',
      async (_name, linking, reason, detail) => {
        const { rows } = await explained(
          { '/': { links: ['/hub'] }, '/hub': { links: ['/leaf'] }, '/leaf': {} },
          { '/': { links: ['/hub'] }, '/hub': linking as Page },
        )
        expect(reasonOf(rows, '/leaf')).toEqual([reason, detail])
      },
    )

    it.each([
      ['missing', undefined, 'render-missing'],
      ['failed', 'failed', 'render-failed'],
      ['cut', 'truncated', 'render-truncated'],
      ['captured while loading', 'unsettled', 'render-unsettled'],
      ['a redirect', 'redirect', 'render-redirected'],
      ['made before captures could prove absence', 'complete', 'render-unreliable'],
    ] as const)(
      'never calls a link found after rendering gone when the later render was %s',
      async (_name, render, detail) => {
        const { rows } = await explained(
          {
            '/': { links: ['/hub'], render: 'complete' },
            '/hub': { links: [{ to: '/js', rendered: true }], render: 'complete' },
            '/js': { render: 'complete' },
          },
          {
            '/': { links: ['/hub'], render: 'complete' },
            '/hub': render ? { render } : {},
          },
          { base: { rendered: true }, target: { rendered: true } },
        )
        expect(reasonOf(rows, '/js')).toEqual(['notReached', detail])
      },
    )

    // The crawl that has the link must hold a trusted render of it too.
    const renderedLink = (render: RenderKind) => ({
      base: {
        '/': { links: ['/hub'], render: 'complete' as const },
        '/hub': { links: [{ to: '/js', rendered: true }], render: 'proven' as const },
        '/js': { render: 'complete' as const },
      },
      target: { '/': { links: ['/hub'], render: 'complete' as const }, '/hub': { render } },
    })
    const both = { base: { rendered: true }, target: { rendered: true } }

    it("calls a link found after rendering gone only from a complete render of WP1's current capture", async () => {
      const proven = renderedLink('proven')
      const { rows } = await explained(proven.base, proven.target, both)
      expect(reasonOf(rows, '/js')).toEqual(['unlinked', null])
      // The same render read without WP1's rule proves nothing.
      const without = await explained(proven.base, proven.target, both, {
        captureTrust: NO_CAPTURE_TRUST,
      })
      expect(reasonOf(without.rows, '/js')).toEqual(['notReached', 'render-unreliable'])
    })

    it.each([
      ['a failed dependency', 'failed-dependency'],
      ['a late capture', 'late'],
      ['pending work', 'pending'],
      ['an older capture rule', 'legacy-rule'],
      ['no capture rule at all', 'complete'],
    ] as const)(
      'never calls a link found after rendering gone from a complete render with %s',
      async (_name, render) => {
        const fixture = renderedLink(render)
        const { rows } = await explained(fixture.base, fixture.target, both)
        expect(reasonOf(rows, '/js')).toEqual(['notReached', 'render-unreliable'])
      },
    )

    it('keeps a served link provable whatever the render did', async () => {
      const { rows } = await explained(
        {
          '/': { links: ['/hub'], render: 'complete' },
          '/hub': { links: ['/served'], render: 'complete' },
          '/served': { render: 'complete' },
        },
        { '/': { links: ['/hub'], render: 'complete' }, '/hub': { render: 'truncated' } },
        { base: { rendered: true }, target: { rendered: true } },
      )
      // The served HTML was read whole; only the render was cut.
      expect(reasonOf(rows, '/served')).toEqual(['unlinked', null])
    })

    it('puts in the configuration group a page left out by the later paths', async () => {
      const db = getDb()
      const { ids, rows } = await explained(
        { '/': { links: ['/shop'] }, '/shop': { links: ['/shop/item'] }, '/shop/item': {} },
        { '/': { links: ['/shop'] }, '/shop': { notRequested: 'excluded' } },
      )
      expect(reasonOf(rows, '/shop/item')).toEqual(['settings', 'excluded'])
      expect(await db.crawls.compareCounts({ ...ids, view: 'pages' })).toMatchObject({
        missing: 0,
        configuration: 1,
      })
    })

    it('says beyond the depth, and configuration only when the snapshots show the setting changed', async () => {
      const pages: Record<'base' | 'target', Record<string, Page>> = {
        base: { '/': { links: ['/deep'] }, '/deep': { links: ['/deeper'] }, '/deeper': {} },
        target: { '/': { links: ['/deep'] }, '/deep': { notRequested: 'depth' } },
      }
      // Both crawls recorded the same maximum depth: the site's links moved the page deeper.
      const same = await explained(pages.base, pages.target)
      expect(reasonOf(same.rows, '/deeper')).toEqual(['depth', 'unchanged'])
      // The later crawl recorded a smaller maximum depth: that setting explains it.
      const changed = await explained(pages.base, pages.target, {
        target: { settings: { maxDepth: 1 } },
      })
      expect(reasonOf(changed.rows, '/deeper')).toEqual(['settings', 'depth'])
    })

    it('says the later crawl stopped at its URL limit, even when a whole page linked the URL', async () => {
      const pages = {
        base: { '/': { links: ['/a'] }, '/a': {} },
        target: { '/': {} },
      }
      const limit = await explained(pages.base, pages.target, { target: { status: 'incomplete' } })
      expect(reasonOf(limit.rows, '/a')).toEqual(['limit', null])
      const lowered = await explained(pages.base, pages.target, {
        target: { status: 'incomplete', settings: { maxUrls: 50 } },
      })
      // Fix round 2, finding 5: a lower limit does not show it is why: the URL stays counted.
      expect(reasonOf(lowered.rows, '/a')).toEqual(['limit', 'narrowed'])
      // Finding 5: a raised limit (100 → 1000) cannot explain a URL the later crawl lacks.
      const raised = await explained(pages.base, pages.target, {
        base: { settings: { maxUrls: 100 } },
        target: { status: 'incomplete', settings: { maxUrls: 1000 } },
      })
      expect(reasonOf(raised.rows, '/a')).toEqual(['limit', null])
    })

    it('puts links found only after rendering in the configuration group when a crawl did not render', async () => {
      const rendered = {
        '/': { links: ['/hub'], render: 'complete' as const },
        '/hub': { links: [{ to: '/js', rendered: true }], render: 'complete' as const },
        '/js': { render: 'complete' as const },
      }
      const html = { '/': { links: ['/hub'] }, '/hub': {} }
      const notSeen = await explained(rendered, html, { base: { rendered: true } })
      expect(reasonOf(notSeen.rows, '/js')).toEqual(['mode', null])
      const discovered = await explained(html, rendered, { target: { rendered: true } })
      expect(reasonOf(discovered.rows, '/js')).toEqual(['mode', null])
      expect(discovered.rows.get('/js')?.side).toBe('target')
    })

    it('says a URL only on the priority list or an optional file came from those settings', async () => {
      const { rows } = await explained(
        { '/': {}, '/listed': { source: 'priority' }, '/ads.txt': { source: 'ads' }, '/lost': {} },
        { '/': {} },
      )
      expect(reasonOf(rows, '/listed')).toEqual(['settings', 'priority'])
      expect(reasonOf(rows, '/ads.txt')).toEqual(['settings', 'files'])
      // Nothing stored says how it was found: unknown, never a guess.
      expect(reasonOf(rows, '/lost')).toEqual(['unknown', 'no-links'])
    })

    it('puts in the configuration group the address a merged URL became, when only the later crawl has it', async () => {
      const db = getDb()
      const { ids, rows } = await explained(
        { '/': { links: ['/offer?duration=60'] }, '/offer?duration=60': {} },
        { '/': { links: ['/offer'] }, '/offer': {} },
        { target: { ignored: ['duration'] } },
      )
      expect(rows.get('/offer?duration=60')).toMatchObject({ side: 'base', reason: 'merged' })
      expect(rows.get('/offer')).toMatchObject({
        side: 'target',
        reason: 'merged',
        detail: 'into',
        intoUrl: urlOf('/offer?duration=60'),
      })
      expect(await db.crawls.compareCounts({ ...ids, view: 'pages' })).toMatchObject({
        missing: 0,
        added: 0,
        configuration: 2,
      })
    })

    it('does not count a page naming itself (canonical, og:url) as a way it was reached', async () => {
      const { rows } = await explained(
        { '/': { links: ['/a'] }, '/a': { links: [{ to: '/a', kind: 'canonical' }] } },
        { '/': {} },
      )
      expect(reasonOf(rows, '/a')).toEqual(['unlinked', null])
      expect(rows.get('/a')?.sources).toBe(1)
    })

    it('splits a URL the earlier crawl merged, naming the address it had there', async () => {
      const { rows } = await explained(
        { '/': { links: ['/e'] }, '/e': {} },
        { '/': { links: ['/e', '/e?utm_source=x'] }, '/e': {}, '/e?utm_source=x': {} },
        { base: { ignored: ['utm_*'] } },
      )
      expect(rows.get('/e?utm_source=x')).toMatchObject({
        side: 'target',
        reason: 'split',
        intoUrl: urlOf('/e'),
        intoPresent: true,
      })
    })

    // Finding 3: a linker read at another address is not the same page.
    it('never compares a linker the other crawl reads at another address', async () => {
      // `/listing?language=es` links `/item`; the later crawl ignores `language` and reads `/listing`.
      const { rows } = await explained(
        {
          '/': { links: ['/listing?language=es'] },
          '/listing?language=es': { links: ['/item'] },
          '/item': {},
        },
        { '/': { links: ['/listing'] }, '/listing': {} },
        { target: { ignored: ['language'] } },
      )
      expect(reasonOf(rows, '/item')).toEqual(['unknown', 'identity'])
    })

    // Finding 3: renders made with different waits are not compared.
    it('never compares renders made with different rendering settings', async () => {
      const proven = renderedLink('proven')
      const { rows } = await explained(proven.base, proven.target, {
        base: { rendered: true, settings: { renderWaitMs: 3000 } },
        target: { rendered: true, settings: { renderWaitMs: 8000 } },
      })
      expect(reasonOf(rows, '/js')).toEqual(['unknown', 'render-settings'])
    })

    it('resolves a group of pages that only link each other through how the group was entered', async () => {
      const cluster = ['/c1', '/c2', '/c3', '/c4', '/c5', '/c6']
      const ring = Object.fromEntries(
        cluster.map((path, i) => [path, { links: [cluster[(i + 1) % cluster.length]!] }]),
      )
      const whole = await explained(
        { '/': { links: ['/hub'] }, '/hub': { links: ['/c1'] }, ...ring },
        { '/': { links: ['/hub'] }, '/hub': {} },
      )
      for (const path of cluster) expect(whole.rows.get(path)?.reason, path).toBe('unlinked')
      expect(whole.rows.get('/c3')).toMatchObject({ detail: 'chain' })
      expect(whole.rows.get('/c3')?.through).not.toBeNull()

      const cut = await explained(
        { '/': { links: ['/hub'] }, '/hub': { links: ['/c1'] }, ...ring },
        { '/': { links: ['/hub'] }, '/hub': { status: 503 } },
      )
      expect(reasonOf(cut.rows, '/c1')).toEqual(['notReached', 'failed'])
      for (const path of cluster.slice(1))
        expect(reasonOf(cut.rows, path), path).toEqual(['notReached', 'not-seen'])
    })

    it('gives up on a chain still moving at the cap as unknown, never as a change of the site', async () => {
      const db = getDb()
      const domainId = await domain()
      const base = await crawlOf(domainId, {
        '/': { links: ['/hub'] },
        '/hub': { links: ['/c1'] },
        '/c1': { links: ['/c2'] },
        '/c2': {},
      })
      const target = await crawlOf(domainId, { '/': { links: ['/hub'] }, '/hub': {} })
      const ids = { domainId, baseId: base.id, targetId: target.id }
      await explainPair({ db, ...ids, runner: 'test', maxChainSteps: 0 })
      const rows = await rowsOf(ids)
      expect(reasonOf(rows, '/c1')).toEqual(['unlinked', null])
      expect(reasonOf(rows, '/c2')).toEqual(['unknown', 'cap'])
    })

    /** A page requested twice by the later crawl: its anchors each time, as WP3 stores them. */
    const pairOf = (path: string, original: string[], repeat: string[]): AnswerPair => {
      const answer = (targets: string[]) => {
        const hashes = targets.map(hashOf).sort()
        return {
          at: new Date().toISOString(),
          status: 200,
          media: 'html',
          location: null,
          html: {
            title: 'Blog',
            titleDigest: 't',
            textDigest: 'x',
            anchors: { digest: hashes.join(','), count: hashes.length, hashes },
          },
        }
      }
      return {
        version: 1,
        sourceHash: hashOf(path),
        original: answer(original),
        repeat: answer(repeat),
        unknown: null,
        changed: original.join() === repeat.join() ? [] : ['anchors'],
        examples: [],
      }
    }
    const blog = {
      '/': { links: ['/blog'] },
      '/blog': { links: ['/page/3', '/other'] },
      '/page/3': {},
      '/other': {},
    }

    it("says the site answered differently only with WP3's witness of the discovering link", async () => {
      // The later crawl read /blog without /page/3, and its repeat had it: the site varied.
      const { rows } = await explained(
        blog,
        { '/': { links: ['/blog'] }, '/blog': {} },
        { target: { pairs: [pairOf('/blog', [], ['/page/3'])] } },
      )
      expect(rows.get('/page/3')).toMatchObject({
        reason: 'unstable',
        via: rows.get('/page/3')?.via,
      })
      // Not in the repeat: no witness for it, so what the stored links prove.
      expect(reasonOf(rows, '/other')).toEqual(['unlinked', null])
    })

    it('never says the site answered differently without a direction-matched witness', async () => {
      const later = { '/': { links: ['/blog'] }, '/blog': {} }
      // The original answer already had the link: the stored crawl did not lack it because of this.
      const had = await explained(blog, later, {
        target: { pairs: [pairOf('/blog', ['/page/3'], ['/page/3'])] },
      })
      expect(reasonOf(had.rows, '/page/3')).toEqual(['unlinked', null])
      // The pair is in the crawl that has the URL, not in the one that lacks it.
      const wrongSide = await explained(blog, later, {
        base: { pairs: [pairOf('/blog', [], ['/page/3'])] },
      })
      expect(reasonOf(wrongSide.rows, '/page/3')).toEqual(['unlinked', null])
      // A crawl that stopped at its URL limit says limit first.
      const cut = await explained(blog, later, {
        target: { status: 'incomplete', pairs: [pairOf('/blog', [], ['/page/3'])] },
      })
      expect(reasonOf(cut.rows, '/page/3')?.[0]).toBe('limit')
    })

    it('never uses the witness when the crawls requested pages differently', async () => {
      const { rows } = await explained(
        blog,
        { '/': { links: ['/blog'] }, '/blog': {} },
        {
          target: {
            settings: { userAgent: 'Another agent/1.0' },
            pairs: [pairOf('/blog', [], ['/page/3'])],
          },
        },
      )
      // Requests made differently: neither a witness nor a change of the site.
      expect(reasonOf(rows, '/page/3')).toEqual(['unknown', 'settings'])
    })

    // Finding 1: a 503 error page's HTML supplied the edge in the crawl that has it.
    it('never reads a link from an error page as one the site removed', async () => {
      const { rows } = await explained(
        { '/': { links: ['/hub'] }, '/hub': { status: 503, links: ['/leaf'] }, '/leaf': {} },
        { '/': { links: ['/hub'] }, '/hub': {} },
      )
      expect(reasonOf(rows, '/leaf')).toEqual(['unknown', 'source-unobserved'])
    })

    // Finding 1: a rendered-only edge whose source now answers 404 was taken as whole.
    it('never calls a rendered link gone from a source that does not answer a page', async () => {
      const fixture = renderedLink('proven')
      const { rows } = await explained(
        fixture.base,
        { '/': { links: ['/hub'], render: 'complete' }, '/hub': { status: 404 } },
        both,
      )
      expect(reasonOf(rows, '/js')).toEqual(['notReached', 'error-answer'])
    })

    // Finding 2: a repeat that failed (a 503 page) is no witness, even when it names the URL.
    it('never takes a failed repeat for a witness', async () => {
      const failedRepeat = pairOf('/blog', [], ['/page/3'])
      failedRepeat.repeat = { ...failedRepeat.repeat!, status: 503 }
      const { rows } = await explained(
        blog,
        { '/': { links: ['/blog'] }, '/blog': {} },
        { target: { pairs: [failedRepeat] } },
      )
      expect(reasonOf(rows, '/page/3')).toEqual(['unlinked', null])
    })

    // Finding 2: a discovering link that is not stored is never read as a served one.
    it('never uses the witness for a discovering link that was not stored', async () => {
      const { rows } = await explained(
        {
          '/': { links: ['/blog', '/other'] },
          '/blog': {},
          // Said to be found from /blog, but /blog stored no link to it.
          '/page/3': { discoveredFrom: '/blog' },
          '/other': { links: ['/page/3'] },
        },
        { '/': { links: ['/blog', '/other'] }, '/blog': {}, '/other': {} },
        { target: { pairs: [pairOf('/blog', [], ['/page/3'])] } },
      )
      expect(rows.get('/page/3')?.reason).not.toBe('unstable')
    })

    // Finding 4: a closed cycle that no observed link enters is not a change of the site.
    it('never calls a closed cycle with no observed entrance a change of the site', async () => {
      const cycle = {
        '/c1': { links: ['/c2'], discoveredFrom: '/c3' },
        '/c2': { links: ['/c3'] },
        '/c3': { links: ['/c1'] },
      }
      const { rows } = await explained({ '/': {}, ...cycle }, { '/': {} })
      for (const path of ['/c1', '/c2', '/c3'])
        expect(reasonOf(rows, path), path).toEqual(['unknown', 'cycle'])
    })

    // Finding 5: a linker that answered 403 is not reached, never a difference of mode.
    it('says not reached before a difference of mode when the linker failed', async () => {
      const { rows } = await explained(
        {
          '/': { links: ['/hub'], render: 'proven' },
          '/hub': { links: [{ to: '/js', rendered: true }], render: 'proven' },
          '/js': { render: 'proven' },
        },
        { '/': { links: ['/hub'] }, '/hub': { status: 403 } },
        { base: { rendered: true } },
      )
      expect(reasonOf(rows, '/js')).toEqual(['notReached', 'failed'])
    })

    // Finding 5: a difference of mode cannot account for a link the other crawl read whole.
    it('keeps a URL out of the configuration group unless a setting explains every link', async () => {
      const db = getDb()
      const { ids, rows } = await explained(
        {
          '/': { links: ['/hub', '/other'], render: 'proven' },
          '/hub': { links: [{ to: '/js', rendered: true }], render: 'proven' },
          '/other': { links: ['/js'], render: 'proven' },
          '/js': { render: 'proven' },
        },
        { '/': { links: ['/hub', '/other'] }, '/hub': {}, '/other': {} },
        { base: { rendered: true } },
      )
      expect(reasonOf(rows, '/js')).toEqual(['unknown', 'partial-configuration'])
      expect(await db.crawls.compareCounts({ ...ids, view: 'pages' })).toMatchObject({
        configuration: 0,
        missing: 1,
      })
    })

    // Finding 11: the edge shown is exactly the one the reason was decided on.
    it('stores and shows the exact link the reason is about', async () => {
      const db = getDb()
      const { ids, rows } = await explained(
        {
          '/': { links: ['/hub'], render: 'proven' },
          '/hub': {
            links: [
              { to: '/x', kind: 'anchor', text: 'Served link' },
              { to: '/x', kind: 'canonical', rendered: true },
            ],
            render: 'proven',
          },
          '/x': { render: 'proven' },
        },
        { '/': { links: ['/hub'], render: 'proven' }, '/hub': { render: 'unsettled' } },
        both,
      )
      const row = rows.get('/x')!
      // The served anchor is gone from whole HTML, but the rendered canonical was not read whole.
      expect([row.reason, row.detail, row.viaKind, row.viaRendered]).toEqual([
        'notReached',
        'render-unsettled',
        'canonical',
        true,
      ])
      const details = await db.crawls.explanationDetails({
        ...ids,
        rows: [{ side: 'base', seq: row.seq, via: row.via, viaKind: row.viaKind, through: null }],
      })
      expect(details.links.base.get(row.seq!)).toMatchObject({ kind: 'canonical', rendered: true })
    })

    // Finding 8: renders are read a bounded group at a time, however many pages link one URL.
    it('reads renders in bounded groups when many rendered pages link one URL', async () => {
      const db = getDb()
      const domainId = await domain()
      const fan = Object.fromEntries(
        Array.from({ length: 450 }, (_, i) => [
          `/p/${i}`,
          { links: [{ to: '/target', rendered: true }], render: 'proven' as const },
        ]),
      )
      const linkers = Object.keys(fan)
      const base = await crawlOf(
        domainId,
        { '/': { links: linkers, render: 'proven' }, ...fan, '/target': { render: 'proven' } },
        { rendered: true },
      )
      const target = await crawlOf(
        domainId,
        {
          '/': { links: linkers, render: 'proven' },
          ...Object.fromEntries(linkers.map((path) => [path, { render: 'proven' as const }])),
        },
        { rendered: true },
      )
      const calls: number[] = []
      const work = db.crawls.comparisonWork
      const spy = {
        ...db,
        crawls: {
          ...db.crawls,
          comparisonWork: {
            ...work,
            renders: (input: Parameters<typeof work.renders>[0]) => {
              calls.push(input.urlHashes.length)
              return work.renders(input)
            },
          },
        },
      }
      await explainPair({ db: spy, baseId: base.id, targetId: target.id, runner: 'test' })
      expect(Math.max(...calls)).toBeLessThanOrEqual(200)
      // Each linking page's render is read once per crawl.
      expect(calls.reduce((sum, n) => sum + n, 0)).toBe(450 * 2)
      const rows = await rowsOf({ domainId, baseId: base.id, targetId: target.id })
      expect(reasonOf(rows, '/target')).toEqual(['unlinked', null])
    }, 120_000)

    it('lists each reason apart and filters by it, in both groups', async () => {
      const db = getDb()
      const { ids } = await explained(
        {
          '/': { links: ['/gone', '/hub', '/a?duration=1'] },
          '/gone': {},
          '/hub': { links: ['/leaf'] },
          '/leaf': {},
          '/a?duration=1': {},
        },
        { '/': { links: ['/hub'] }, '/hub': { status: 503 } },
        { target: { ignored: ['duration'] } },
      )
      const list = (
        change: 'missing' | 'configuration',
        reason?: 'unlinked' | 'notReached' | 'merged',
      ) =>
        db.crawls
          .compareUrls({
            ...ids,
            change,
            view: 'pages',
            limit: 50,
            offset: 0,
            ...(reason ? { reason } : {}),
          })
          .then((rows) => rows.map((row) => row.url.slice(site.length)))
      expect(await list('missing')).toEqual(['/gone', '/leaf'])
      // The crawls ignore different parameters: a missing link is not read as a change of the site.
      expect(await list('missing', 'unlinked')).toEqual([])
      expect(await list('missing', 'notReached')).toEqual(['/leaf'])
      expect(await list('configuration')).toEqual(['/a?duration=1'])
      expect(await list('missing', 'merged')).toEqual([])
      expect(
        await db.crawls.countCompared({
          ...ids,
          change: 'missing',
          view: 'pages',
          reason: 'notReached',
        }),
      ).toBe(1)
      const counts = await db.crawls.compareCounts({ ...ids, view: 'pages' })
      expect(counts?.reasons.base).toEqual({ merged: 1, unknown: 1, notReached: 1 })
      const reasons = await db.crawls.comparisonReasons({
        ...ids,
        urlHashes: [hashOf('/leaf'), hashOf('/a?duration=1'), hashOf('/')],
      })
      expect(new Map(reasons.map((row) => [row.urlHash, [row.side, row.reason]]))).toEqual(
        new Map([
          [hashOf('/leaf'), ['base', 'notReached']],
          [hashOf('/a?duration=1'), ['base', 'merged']],
        ]),
      )
    })

    it('works the pair out again from scratch: the same rows twice, and after a run that stopped', async () => {
      const db = getDb()
      const domainId = await domain()
      const base = await crawlOf(domainId, {
        '/': { links: ['/gone', '/hub', '/a?duration=1'] },
        '/gone': {},
        '/hub': { links: ['/leaf'] },
        '/leaf': {},
        '/a?duration=1': {},
      })
      const target = await crawlOf(
        domainId,
        { '/': { links: ['/hub'] }, '/hub': {} },
        { ignored: ['duration'] },
      )
      const ids = { domainId, baseId: base.id, targetId: target.id }
      await explainPair({ db, ...ids, runner: 'one' })
      const first = await rowsOf(ids)
      await explainPair({ db, ...ids, runner: 'two' })
      expect(await rowsOf(ids)).toEqual(first)

      const stop = new AbortController()
      stop.abort()
      await expect(
        explainPair({ db, ...ids, runner: 'three', signal: stop.signal }),
      ).rejects.toThrow()
      const header = await db.crawls.comparisonHeader(ids)
      expect(header?.state).toBe('failed')
      expect((await db.crawls.compareCounts({ ...ids, view: 'pages' }))?.explained).toBe(false)
      await explainPair({ db, ...ids, runner: 'four' })
      expect(await rowsOf(ids)).toEqual(first)
    })

    it('lets only the latest run mark a pair done', async () => {
      const db = getDb()
      const domainId = await domain()
      const base = await crawlOf(domainId, { '/': { links: ['/a'] }, '/a': {} })
      const target = await crawlOf(domainId, { '/': {} })
      const ids = { domainId, baseId: base.id, targetId: target.id }
      const work = db.crawls.comparisonWork
      await work.begin({ ...ids, runner: 'old', version: EXPLANATION_VERSION })
      await work.begin({ ...ids, runner: 'new', version: EXPLANATION_VERSION })
      expect(await work.finish({ ...ids, runner: 'old', state: 'done' })).toBe(false)
      expect((await db.crawls.comparisonHeader(ids))?.state).toBe('running')
      expect(await work.finish({ ...ids, runner: 'new', state: 'done' })).toBe(true)
    })

    // Finding 9: one pair-level record with its back-off, and never a second job for a pair.
    it('queues one job per pair, never a second while one waits, and a failed one after its back-off', async () => {
      const db = getDb()
      const domainId = await domain()
      const base = await crawlOf(domainId, { '/': { links: ['/a'] }, '/a': {} })
      const target = await crawlOf(domainId, { '/': {} })
      const ids = { domainId, baseId: base.id, targetId: target.id }
      const explainJobs = async () =>
        (await db.jobs.list()).filter((job) => job.type === JOB_TYPES.compareExplain)
      const before = (await explainJobs()).length

      const first = await db.crawls.requestComparison(ids)
      expect(first).toMatchObject({ state: 'queued', version: EXPLANATION_VERSION, failures: 0 })
      expect(await db.crawls.requestComparison(ids)).toMatchObject({ jobId: first?.jobId })
      const job = (await explainJobs()).find((found) => found.id === first?.jobId)
      expect(job?.payload).toEqual({ baseId: base.id, targetId: target.id })
      // Hours later, while its job still waits: still that one job.
      const later = new Date(Date.now() + 7 * 60 * 60_000)
      expect((await db.crawls.requestComparison({ ...ids, now: later }))?.jobId).toBe(first?.jobId)
      expect((await explainJobs()).length).toBe(before + 1)

      // Its job ended without working it out (a crash): the header is an orphan, asked for again.
      const [claimed] = await db.jobs.claim({ workerId: 'w', limit: 1, types: ['compare.explain'] })
      await db.jobs.complete({ id: claimed!.id, workerId: 'w' })
      const renewed = await db.crawls.requestComparison(ids)
      expect(renewed?.jobId).not.toBe(first?.jobId)
      expect((await explainJobs()).length).toBe(before + 2)

      // A failed run: one failure recorded, asked for again only once its back-off has passed.
      const stop = new AbortController()
      stop.abort()
      await expect(
        explainPair({ db, ...ids, runner: 'run', jobId: renewed!.jobId, signal: stop.signal }),
      ).rejects.toThrow()
      const failed = await db.crawls.comparisonHeader(ids)
      expect(failed).toMatchObject({ state: 'failed', failures: 1 })
      expect(failed!.retryAt!.getTime()).toBeGreaterThan(Date.now())
      const [renewedJob] = await db.jobs.claim({
        workerId: 'w',
        limit: 1,
        types: ['compare.explain'],
      })
      await db.jobs.complete({ id: renewedJob!.id, workerId: 'w' })
      expect(await db.crawls.requestComparison(ids)).toMatchObject({ state: 'failed' })
      expect((await explainJobs()).length).toBe(before + 2)
      const afterBackOff = new Date(failed!.retryAt!.getTime() + 1)
      expect(await db.crawls.requestComparison({ ...ids, now: afterBackOff })).toMatchObject({
        state: 'queued',
      })
      expect((await explainJobs()).length).toBe(before + 3)

      // A job attempt that will be retried leaves it queued for that same job, not failed.
      const [third] = await db.jobs.claim({
        workerId: 'w',
        limit: 1,
        types: ['compare.explain'],
        now: afterBackOff,
      })
      await expect(
        explainPair({
          db,
          ...ids,
          runner: 'run',
          jobId: third!.id,
          signal: stop.signal,
          onFailure: { state: 'queued' },
        }),
      ).rejects.toThrow()
      expect(await db.crawls.comparisonHeader(ids)).toMatchObject({ state: 'queued' })
      expect(await db.crawls.requestComparison(ids)).toMatchObject({ jobId: third!.id })

      await explainPair({ db, ...ids, runner: 'test' })
      expect(await db.crawls.comparisonHeader(ids)).toMatchObject({ state: 'done', failures: 0 })

      // Not a pair of the domain, or not two different crawls: nothing.
      expect(await db.crawls.requestComparison({ ...ids, targetId: base.id })).toBeNull()
      expect(await db.crawls.requestComparison({ ...ids, domainId: await domain() })).toBeNull()

      // An archived domain gets nothing new.
      const count = (await explainJobs()).length
      const archived = await domain()
      const a = await crawlOf(archived, { '/': {} })
      const b = await crawlOf(archived, { '/': {} })
      await db.domains.archive(archived)
      expect(
        await db.crawls.requestComparison({ domainId: archived, baseId: a.id, targetId: b.id }),
      ).toBeNull()
      expect((await explainJobs()).length).toBe(count)
    })

    // Finding 6: concurrent runs are fenced, and a pruned crawl never gets a header back.
    it('fences every write by the run that holds the pair, and refuses pruned crawls', async () => {
      const db = getDb()
      const domainId = await domain()
      const base = await crawlOf(domainId, { '/': { links: ['/a'] }, '/a': {} })
      const target = await crawlOf(domainId, { '/': {} })
      const ids = { domainId, baseId: base.id, targetId: target.id }
      const work = db.crawls.comparisonWork
      const row = (urlHash: string): ExplainedUrl => ({
        side: 'base',
        urlHash,
        seq: 1,
        reason: 'unknown',
        detail: null,
        via: null,
        viaKind: null,
        viaRendered: null,
        through: null,
        sources: 0,
        unseen: 0,
        intoHash: null,
        intoUrl: null,
        intoPresent: null,
      })
      expect(await work.begin({ ...ids, runner: 'a', version: EXPLANATION_VERSION })).toBe(true)
      await work.save({ ...ids, runner: 'a', rows: [row('x1')] })
      // Another run takes the pair over: the first one can no longer write anything.
      expect(await work.begin({ ...ids, runner: 'b', version: EXPLANATION_VERSION })).toBe(true)
      await expect(work.save({ ...ids, runner: 'a', rows: [row('x2')] })).rejects.toThrow(
        ComparisonSupersededError,
      )
      await expect(work.resolve({ ...ids, runner: 'a', rows: [row('x2')] })).rejects.toThrow(
        ComparisonSupersededError,
      )
      expect(await work.finish({ ...ids, runner: 'a', state: 'done' })).toBe(false)
      await work.save({ ...ids, runner: 'b', rows: [row('x3')] })
      // Pruned while running: the claim goes with the results, and nothing comes back.
      await crawlOf(domainId, { '/': {} })
      await db.crawls.prune({ domainId, type: 'full', keep: 2 })
      await expect(work.save({ ...ids, runner: 'b', rows: [row('x4')] })).rejects.toThrow(
        ComparisonSupersededError,
      )
      expect(await work.finish({ ...ids, runner: 'b', state: 'done' })).toBe(false)
      expect(await work.begin({ ...ids, runner: 'c', version: EXPLANATION_VERSION })).toBe(false)
      expect(await db.crawls.requestComparison(ids)).toBeNull()
      expect(await db.crawls.comparisonHeader(ids)).toBeNull()
      expect(await explainPair({ db, ...ids, runner: 'd' })).toBe('not-comparable')
    })

    // Fix round 2, finding 1 (probe html-to-pdf): the source now answers a file, not a page.
    it('never calls a link gone from a source that now answers something that is not HTML', async () => {
      const { rows } = await explained(
        { '/': { links: ['/leaf'] }, '/leaf': {} },
        { '/': { kind: 'resource' } },
      )
      expect(reasonOf(rows, '/leaf')).toEqual(['notReached', 'other-answer'])
      // Nor a link read from something that is not an HTML page in the crawl that has it.
      const feed = await explained(
        { '/': { links: ['/feed'] }, '/feed': { kind: 'resource', links: ['/item'] }, '/item': {} },
        { '/': { links: ['/feed'] }, '/feed': { kind: 'resource' } },
      )
      expect(reasonOf(feed.rows, '/item')).toEqual(['unknown', 'source-unobserved'])
    })

    // Fix round 2, finding 1 (probe opposite-redirects): a redirect is not a whole page.
    it('never calls the target of a redirect gone or new because the redirect changed', async () => {
      const { rows } = await explained(
        {
          '/': { status: 302, kind: 'redirect', links: [{ to: '/leaf', kind: 'redirect' }] },
          '/leaf': {},
        },
        {
          '/': { status: 302, kind: 'redirect', links: [{ to: '/new', kind: 'redirect' }] },
          '/new': {},
        },
      )
      expect(reasonOf(rows, '/leaf')).toEqual(['unknown', 'source-unobserved'])
      expect(reasonOf(rows, '/new')).toEqual(['unknown', 'source-unobserved'])
    })

    // Fix round 2, finding 2 (probe witness-discovering-503).
    it('never uses the witness when the discovering page answered an error in its own crawl', async () => {
      const { rows } = await explained(
        { '/': { links: ['/blog'] }, '/blog': { status: 503, links: ['/page/3'] }, '/page/3': {} },
        { '/': { links: ['/blog'] }, '/blog': {} },
        { target: { pairs: [pairOf('/blog', [], ['/page/3'])] } },
      )
      expect(reasonOf(rows, '/page/3')).toEqual(['unknown', 'source-unobserved'])
    })

    // Fix round 2, finding 11 (probe witness-discovering-with-two-edge-kinds).
    it('names the exact discovering link for a witnessed variation, nofollow included', async () => {
      const db = getDb()
      const { ids, rows } = await explained(
        {
          '/': { links: ['/blog'] },
          '/blog': { links: [{ to: '/page/3', kind: 'anchor-nofollow' }, '/page/3'] },
          '/page/3': {},
        },
        { '/': { links: ['/blog'] }, '/blog': {} },
        { target: { pairs: [pairOf('/blog', [], ['/page/3'])] } },
      )
      const row = rows.get('/page/3')!
      expect([row.reason, row.viaKind, row.viaRendered]).toEqual([
        'unstable',
        'anchor-nofollow',
        false,
      ])
      const details = await db.crawls.explanationDetails({
        ...ids,
        rows: [{ side: 'base', seq: row.seq, via: row.via, viaKind: row.viaKind, through: null }],
      })
      expect(details.links.base.get(row.seq!)).toMatchObject({ kind: 'anchor-nofollow' })
    })

    // Fix round 2, finding 5 (probe narrower-limit-with-unexplained-path).
    it('keeps a URL in the counts when a lower limit cannot be shown to be why', async () => {
      const db = getDb()
      const { ids, rows } = await explained(
        { '/': { links: ['/middle', '/leaf'] }, '/middle': { links: ['/leaf'] }, '/leaf': {} },
        { '/': { links: ['/other'] }, '/other': {} },
        {
          base: { settings: { maxUrls: 4 } },
          target: { status: 'incomplete', settings: { maxUrls: 2 } },
        },
      )
      expect(reasonOf(rows, '/leaf')).toEqual(['limit', 'narrowed'])
      expect(await db.crawls.compareCounts({ ...ids, view: 'pages' })).toMatchObject({
        configuration: 0,
        missing: 2,
      })
    })

    // Fix round 2, finding 9 (probes duplicate-retry-sqlite / -pg).
    it('keeps the queued job of a pair when an attempt inside a crawl fails', async () => {
      const db = getDb()
      const domainId = await domain()
      const base = await crawlOf(domainId, { '/': { links: ['/a'] }, '/a': {} })
      const target = await crawlOf(domainId, { '/': {} })
      const ids = { domainId, baseId: base.id, targetId: target.id }
      const work = db.crawls.comparisonWork
      const first = await db.crawls.requestComparison(ids)
      expect(
        await work.begin({ ...ids, runner: 'inline', version: EXPLANATION_VERSION, jobId: null }),
      ).toBe(true)
      expect((await db.crawls.comparisonHeader(ids))?.jobId).toBe(first?.jobId)
      await work.finish({ ...ids, runner: 'inline', state: 'failed', retryAt: new Date(0) })
      const second = await db.crawls.requestComparison(ids)
      expect(second).toMatchObject({ jobId: first?.jobId, state: 'queued' })
      const pending = (await db.jobs.list()).filter(
        (job) =>
          job.type === JOB_TYPES.compareExplain &&
          job.status === 'pending' &&
          (job.payload as { baseId: string }).baseId === base.id,
      )
      expect(pending.map((job) => job.id)).toEqual([first?.jobId])
    })

    describe('PostgreSQL: claims and pruning serialized (fix round 2, finding 6)', () => {
      const waitFor = async (check: () => Promise<boolean>) => {
        for (let i = 0; i < 500; i++) {
          if (await check()) return
          await new Promise((resolve) => setTimeout(resolve, 10))
        }
        throw new Error('timed out')
      }
      /** The statement of `session` waits for the advisory lock `key`. */
      const waitsForAdvisory = (watcher: Awaited<ReturnType<RawSessions['open']>>, key: number) =>
        waitFor(async () => {
          const [row] = await watcher.query(
            `select exists (select 1 from pg_locks where locktype = 'advisory' and objid = ${key} and not granted) as waiting`,
          )
          return row?.waiting === true
        })
      /** Prune either waits for a row lock or is done (the code before the fix never waited). */
      const blockedOrDone = (
        watcher: Awaited<ReturnType<RawSessions['open']>>,
        done: () => boolean,
      ) =>
        waitFor(async () => {
          if (done()) return true
          const [row] = await watcher.query(
            `select count(*)::int as n from pg_stat_activity where wait_event_type = 'Lock' and wait_event <> 'advisory' and datname = current_database()`,
          )
          return Number(row?.n) > 0
        })

      it.each(['begin', 'requestComparison'] as const)(
        'never leaves a header for a crawl pruned while %s claims the pair',
        async (method) => {
          const sessions = getSessions()
          if (!sessions) return
          const db = getDb()
          const domainId = await domain()
          const base = await crawlOf(domainId, { '/': { links: ['/a'] }, '/a': {} })
          const target = await crawlOf(domainId, { '/': {} })
          const ids = { domainId, baseId: base.id, targetId: target.id }
          const holder = await sessions.open()
          const watcher = await sessions.open()
          const key = 853857
          await holder.query(
            `create or replace function wp4_pause_header() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(${key}); return new; end $$`,
          )
          await holder.query(
            `create trigger wp4_pause_header before insert on crawl_comparisons for each row execute function wp4_pause_header()`,
          )
          try {
            await holder.query(`select pg_advisory_lock(${key})`)
            const claim =
              method === 'begin'
                ? db.crawls.comparisonWork.begin({
                    ...ids,
                    runner: 'race',
                    version: EXPLANATION_VERSION,
                  })
                : db.crawls.requestComparison(ids)
            await waitsForAdvisory(watcher, key)
            let pruneDone = false
            const pruning = db.crawls
              .prune({ domainId, type: 'full', keep: 1 })
              .finally(() => (pruneDone = true))
            await blockedOrDone(watcher, () => pruneDone)
            await holder.query(`select pg_advisory_unlock(${key})`)
            await claim
            expect(await pruning).toBe(1)
            expect((await db.crawls.get(base.id))?.pruned).toBe(true)
            expect(await db.crawls.comparisonHeader(ids)).toBeNull()
            const [left] = await watcher.query(
              `select count(*)::int as n from crawl_comparisons c join crawls b on b.ref = c.base_ref where b.id = '${base.id}'`,
            )
            expect(Number(left?.n)).toBe(0)
            if (method === 'begin') {
              await expect(
                db.crawls.comparisonWork.save({ ...ids, runner: 'race', rows: [] }),
              ).rejects.toThrow(ComparisonSupersededError)
            }
            expect(await db.crawls.requestComparison(ids)).toBeNull()
            // Nor a job left waiting for a pair that no longer exists.
            const waiting = (await db.jobs.list()).filter(
              (job) =>
                job.type === JOB_TYPES.compareExplain &&
                job.status === 'pending' &&
                (job.payload as { baseId: string }).baseId === base.id,
            )
            expect(waiting).toEqual([])
          } finally {
            await holder.query(`select pg_advisory_unlock_all()`)
            await holder.query(`drop trigger if exists wp4_pause_header on crawl_comparisons`)
            await holder.query(`drop function if exists wp4_pause_header()`)
            await holder.close()
            await watcher.close()
          }
        },
      )

      it('never leaves reasons behind when a crawl is pruned while a run saves them', async () => {
        const sessions = getSessions()
        if (!sessions) return
        const db = getDb()
        const domainId = await domain()
        const base = await crawlOf(domainId, { '/': { links: ['/a'] }, '/a': {} })
        const target = await crawlOf(domainId, { '/': {} })
        const ids = { domainId, baseId: base.id, targetId: target.id }
        const work = db.crawls.comparisonWork
        expect(await work.begin({ ...ids, runner: 'rows', version: EXPLANATION_VERSION })).toBe(
          true,
        )
        const holder = await sessions.open()
        const watcher = await sessions.open()
        const key = 853858
        await holder.query(
          `create or replace function wp4_pause_row() returns trigger language plpgsql as $$ begin perform pg_advisory_xact_lock(${key}); return new; end $$`,
        )
        await holder.query(
          `create trigger wp4_pause_row before insert on crawl_comparison_urls for each row execute function wp4_pause_row()`,
        )
        try {
          await holder.query(`select pg_advisory_lock(${key})`)
          const row: ExplainedUrl = {
            side: 'base',
            urlHash: 'wp4-row-race',
            seq: 1,
            reason: 'unknown',
            detail: null,
            via: null,
            viaKind: null,
            viaRendered: null,
            through: null,
            sources: 0,
            unseen: 0,
            intoHash: null,
            intoUrl: null,
            intoPresent: null,
          }
          const writing = work.save({ ...ids, runner: 'rows', rows: [row] })
          await waitsForAdvisory(watcher, key)
          let pruneDone = false
          const pruning = db.crawls
            .prune({ domainId, type: 'full', keep: 1 })
            .finally(() => (pruneDone = true))
          await blockedOrDone(watcher, () => pruneDone)
          await holder.query(`select pg_advisory_unlock(${key})`)
          await writing.catch((error) => {
            if (!(error instanceof ComparisonSupersededError)) throw error
          })
          expect(await pruning).toBe(1)
          expect(await db.crawls.comparisonHeader(ids)).toBeNull()
          const [left] = await watcher.query(
            `select count(*)::int as n from crawl_comparison_urls where url_hash = 'wp4-row-race'`,
          )
          expect(Number(left?.n)).toBe(0)
        } finally {
          await holder.query(`select pg_advisory_unlock_all()`)
          await holder.query(`drop trigger if exists wp4_pause_row on crawl_comparison_urls`)
          await holder.query(`drop function if exists wp4_pause_row()`)
          await holder.close()
          await watcher.close()
        }
      })
    })

    it('removes the jobs that explain a pair with the domain', async () => {
      const db = getDb()
      const domainId = await domain()
      const base = await crawlOf(domainId, { '/': { links: ['/a'] }, '/a': {} })
      const target = await crawlOf(domainId, { '/': {} })
      const header = await db.crawls.requestComparison({
        domainId,
        baseId: base.id,
        targetId: target.id,
      })
      expect(await db.jobs.get(header!.jobId!)).not.toBeNull()
      await db.domains.delete(domainId)
      expect(await db.jobs.get(header!.jobId!)).toBeNull()
    })

    it('removes the explanation with the results it explains when a crawl is pruned', async () => {
      const db = getDb()
      const domainId = await domain()
      const base = await crawlOf(domainId, { '/': { links: ['/a'] }, '/a': {} })
      const target = await crawlOf(domainId, { '/': {} })
      const ids = { domainId, baseId: base.id, targetId: target.id }
      await explainPair({ db, ...ids, runner: 'test' })
      expect(await db.crawls.comparisonHeader(ids)).not.toBeNull()
      const queued = await db.crawls.requestComparison(ids)
      await db.crawls.prune({ domainId, type: 'full', keep: 1 })
      expect(await db.crawls.comparisonHeader(ids)).toBeNull()
      expect(await db.crawls.comparisonWork.pending({ ...ids, after: null, limit: 10 })).toEqual([])
      expect(await db.jobs.get(queued!.jobId!)).toBeNull()
    })
  })
}
