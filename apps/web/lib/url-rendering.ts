import type { CrawlPageFacts } from '@seotools/core'
import { renderStateOf, type RenderState } from '@seotools/core/crawl/render-state'
import type { Crawl, CrawlUrl, CrawlUrlRender } from '@seotools/db'

/** How many addresses of each kind (failed, blocked, left out, links) the detail lists. */
export const RENDER_DETAIL_SAMPLE = 10

/**
 * What one side of a comparison says. `unknown` is a value the crawl did not record (an older
 * crawl, or a render stored before this was kept): it is never "none", and it never makes a
 * difference or a likeness.
 */
export type Shown = { kind: 'value'; text: string } | { kind: 'none' } | { kind: 'unknown' }

export const COMPARED_FIELDS = [
  'title',
  'description',
  'h1',
  'canonical',
  'robots',
  'words',
  'structuredData',
  'hreflang',
  'ogTitle',
  'ogImage',
] as const
export type ComparedField = (typeof COMPARED_FIELDS)[number]

export interface ComparisonRow {
  field: ComparedField
  served: Shown
  rendered: Shown
  /** `unknown` as soon as one side is: a difference is only claimed from two observed values. */
  outcome: 'same' | 'differs' | 'unknown'
}

const unknown: Shown = { kind: 'unknown' }
const none: Shown = { kind: 'none' }
const clean = (value: string) => value.replace(/\s+/g, ' ').trim()
const text = (value: string | number | null | undefined): Shown => {
  if (value === null || value === undefined) return none
  const shown = clean(String(value))
  return shown === '' ? none : { kind: 'value', text: shown }
}
const directives = (parts: readonly (string | null | undefined)[]) =>
  [
    ...new Set(
      parts
        .flatMap((part) => (part ?? '').toLowerCase().split(/[\s,]+/))
        .filter((token) => token !== ''),
    ),
  ].sort()
const robotsShown = (parts: readonly (string | null | undefined)[]): Shown =>
  text(directives(parts).join(', '))

/** HTML declarations only: a response header reaches both extractors unchanged. */
const canonicalShown = (facts: CrawlPageFacts | null | undefined): Shown =>
  facts
    ? text(
        facts.canonicals
          .filter((item) => item.source === 'html')
          .map((item) => item.url ?? item.raw)
          .join(', '),
      )
    : unknown

const structuredShown = (facts: CrawlPageFacts | null | undefined): Shown => {
  if (!facts) return unknown
  if (facts.structuredDataTypes) {
    return text([...new Set(facts.structuredDataTypes)].sort().join(', ') || null)
  }
  // A crawl that did not keep the types still counted the blocks.
  return facts.structuredData === 0 ? none : text(String(facts.structuredData))
}

/** The same value on both sides is "same", a different one "differs", anything unknown is not claimed. */
function compare(field: ComparedField, served: Shown, rendered: Shown): ComparisonRow {
  const outcome =
    served.kind === 'unknown' || rendered.kind === 'unknown'
      ? 'unknown'
      : (served.kind === 'value' ? served.text : '') ===
          (rendered.kind === 'value' ? rendered.text : '')
        ? 'same'
        : 'differs'
  return { field, served, rendered, outcome }
}

/** The served and the rendered values of what the JavaScript findings compare, side by side. */
export function comparisonRows(url: CrawlUrl, render: CrawlUrlRender): ComparisonRow[] {
  const facts = url.data?.facts
  const after = render.data.facts
  const page = render.data.page
  const served = {
    title: text(url.title),
    description: text(url.data?.description),
    h1: text(url.data?.h1?.[0]),
    canonical: canonicalShown(facts),
    robots: robotsShown([url.metaRobots, url.data?.botRobots?.googlebot]),
    words: facts ? text(facts.words) : unknown,
    structuredData: structuredShown(facts),
    hreflang: text(url.data?.hreflang?.length ?? 0),
    ogTitle: facts?.social ? text(facts.social.title) : unknown,
    ogImage: facts?.social ? text(facts.social.image) : unknown,
  } satisfies Record<ComparedField, Shown>
  // A render stored before its values were kept has none of the page's tags: unknown, not "none".
  const rendered = {
    title: page ? text(page.title) : unknown,
    description: page ? text(page.description) : unknown,
    h1: page ? text(page.h1) : unknown,
    canonical: canonicalShown(after),
    robots: page ? robotsShown([page.metaRobots, page.botRobots.googlebot]) : unknown,
    words: after ? text(after.words) : unknown,
    structuredData: structuredShown(after),
    hreflang: page ? text(page.hreflang.length) : unknown,
    ogTitle: after?.social ? text(after.social.title) : unknown,
    ogImage: after?.social ? text(after.social.image) : unknown,
  } satisfies Record<ComparedField, Shown>
  return COMPARED_FIELDS.map((field) => compare(field, served[field], rendered[field]))
}

/** What the browser did with the requests of the page, as the render stored it (bounded samples). */
export interface RenderRequests {
  failed: { count: number; items: { url: string; code: string }[] }
  blockedByRobots: { count: number; items: string[] }
  omitted: { count: number; items: { url: string; reason: string }[] }
  refused: { count: number; items: string[] }
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null
const strings = (value: unknown): string[] =>
  Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : []
const countOf = (value: unknown, fallback: number) =>
  typeof value === 'number' && Number.isFinite(value) && value >= 0 ? value : fallback

/** Reads the stored requests defensively: it is JSON written by an older or newer worker. */
export function requestsOf(value: unknown): RenderRequests | null {
  if (!isRecord(value)) return null
  const list = (key: string) => (Array.isArray(value[key]) ? (value[key] as unknown[]) : [])
  const failed = list('failed').flatMap((item) =>
    isRecord(item) && typeof item.url === 'string' && typeof item.code === 'string'
      ? [{ url: item.url, code: item.code }]
      : [],
  )
  const omitted = list('omitted').flatMap((item) =>
    isRecord(item) && typeof item.url === 'string' && typeof item.reason === 'string'
      ? [{ url: item.url, reason: item.reason }]
      : [],
  )
  const blocked = strings(value.blockedByRobots)
  const refused = strings(value.refused)
  return {
    failed: { count: countOf(value.failedCount, failed.length), items: failed },
    blockedByRobots: { count: countOf(value.blockedByRobotsCount, blocked.length), items: blocked },
    omitted: { count: countOf(value.omittedCount, omitted.length), items: omitted },
    refused: { count: countOf(value.refusedCount, refused.length), items: refused },
  }
}

export type NotRenderedReason =
  /** The crawl ran in HTML mode, or before rendering existed. */
  | 'html-crawl'
  | 'external'
  /** Only HTML pages are rendered. */
  | 'not-page'
  /** Only pages that answered exactly 200 are rendered. */
  | 'status'
  /** A rendered crawl, a page it should have rendered, and no observation. Its findings are unknown. */
  | 'missing'

export type IncompleteState = Exclude<RenderState, 'complete' | 'redirect'>

export type RenderView =
  | { kind: 'not-rendered'; reason: NotRenderedReason; statusCode: number | null }
  | {
      kind: 'incomplete'
      state: IncompleteState
      /** Which document was cut: the one the browser built, the served HTML, or both. */
      cut: { rendered: boolean; served: boolean }
      failure: string | null
      durationMs: number
      waitMs: number | null
    }
  | { kind: 'redirect'; target: string; durationMs: number }
  | {
      kind: 'complete'
      rows: ComparisonRow[]
      durationMs: number
      requests: RenderRequests | null
      scriptErrors: { count: number; first: string[] }
    }

/** What the detail of a URL says about its JavaScript, for the crawl shown. */
export function renderViewOf(input: {
  crawl: Pick<Crawl, 'rendering'>
  url: CrawlUrl
  render: CrawlUrlRender | null
}): RenderView {
  const { crawl, url, render } = input
  if (crawl.rendering?.mode !== 'rendered') {
    return { kind: 'not-rendered', reason: 'html-crawl', statusCode: url.statusCode }
  }
  if (!render) {
    const reason: NotRenderedReason =
      url.scope !== 'internal'
        ? 'external'
        : url.kind !== 'page'
          ? 'not-page'
          : url.statusCode !== 200
            ? 'status'
            : 'missing'
    return { kind: 'not-rendered', reason, statusCode: url.statusCode }
  }
  const servedTruncated = url.data?.truncated === true
  const state = renderStateOf({
    status: render.status,
    settled: render.settled,
    truncated: render.truncated,
    redirected: render.data.redirected === true,
    servedTruncated,
  })
  if (state === 'redirect') {
    return { kind: 'redirect', target: render.finalUrl, durationMs: render.durationMs }
  }
  if (state === 'complete') {
    const scriptErrors = render.data.scriptErrors
    return {
      kind: 'complete',
      rows: comparisonRows(url, render),
      durationMs: render.durationMs,
      requests: requestsOf(render.data.requests),
      scriptErrors: {
        count: countOf(scriptErrors?.count, 0),
        first: strings(scriptErrors?.first),
      },
    }
  }
  return {
    kind: 'incomplete',
    state,
    cut: { rendered: render.truncated === true, served: servedTruncated },
    failure: render.failure,
    durationMs: render.durationMs,
    waitMs: crawl.rendering.waitMs,
  }
}
