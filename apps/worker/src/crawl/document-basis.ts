import {
  assessIndexability,
  ISSUE_BASIS,
  PAGE_ISSUE_IDS,
  type CrawlPageFacts,
} from '@seotools/core'
import type { CrawlUrlRender } from '@seotools/db'
import { parseRobotsDirectives, type AuditedUrl } from './site-audit'
import { INPUT_RECORDED } from './observed-inputs'

/** Select once, before any graph or duplicate metadata is derived. Never modify the served row. */
export function selectDocument(
  url: AuditedUrl,
  render: CrawlUrlRender | undefined,
  identity: (url: string) => string,
) {
  url.render = render
  if (!url.contentPage) return
  url.served = { ...url, hreflang: [...url.hreflang] }
  const whole =
    url.contentPage &&
    url.url.data?.truncated !== true &&
    render?.status === 'rendered' &&
    render.truncated === false &&
    (render.settled || render.data.redirected === true)
  const complete = whole && !render.data.redirected && !!render.data.facts && !!render.data.page
  url.documentObservation = complete
    ? 'complete'
    : whole && render.data.redirected
      ? 'redirected'
      : 'unobserved'
  const page = complete ? render.data.page! : null
  const facts: CrawlPageFacts | null = complete ? render.data.facts : null
  url.facts = facts
  url.hreflang = page ? [...page.hreflang] : []
  url.directives = parseRobotsDirectives([
    page?.metaRobots,
    page?.botRobots.googlebot,
    url.url.xRobotsTag,
  ])
  url.noindex = url.served.noindex || url.directives.has('noindex') || url.directives.has('none')
  url.nofollow = url.directives.has('nofollow') || url.directives.has('none')
  const targets = new Set(
    facts?.canonicals.flatMap((entry) => (entry.url ? [identity(entry.url)] : [])) ?? [],
  )
  url.canonicalKnown =
    complete && !facts!.canonicals.some((entry) => !entry.url) && targets.size <= 1
  const canonical = url.canonicalKnown ? (page?.canonical ?? [...targets][0] ?? null) : null
  url.url = {
    ...url.url,
    title: page?.title ?? null,
    canonical,
    metaRobots: page?.metaRobots ?? null,
    data: {
      ...url.url.data,
      facts: facts ?? undefined,
      description: page?.description ?? undefined,
      h1: page?.h1 ? [page.h1] : [],
      botRobots: page?.botRobots,
      hreflang: page?.hreflang,
    },
  }
  url.canonicalised = canonical !== null && identity(canonical) !== identity(url.url.url)
  url.directivesKnown = !!complete
  url.blockersKnown = !!complete && url.canonicalKnown
  url.indexability = assessIndexability({
    state: url.url.state,
    kind: url.url.kind,
    statusCode: url.url.statusCode,
    noindex: url.noindex,
    canonicalised: url.canonicalised,
    robotsBlocked: url.robotsBlocked,
    documentKnown: url.blockersKnown,
    clientRedirect: url.documentObservation === 'redirected',
  })
  url.indexable = url.indexability.state === 'indexable'
  url.documentUnobserved = PAGE_ISSUE_IDS.filter(
    (id) =>
      ISSUE_BASIS[id] === 'document' &&
      (!complete || (facts && INPUT_RECORDED[id]?.(facts) === false)),
  )
  if (complete && !render.data.documentLinks)
    url.documentUnobserved.push('no-outgoing-links', 'internal-nofollow-links', 'resources-broken')
  else if (complete && !render.data.documentLinks?.embedsComplete)
    url.documentUnobserved.push('resources-broken')
  if (!url.canonicalKnown)
    url.documentUnobserved.push('canonical-required-missing', 'canonical-forbidden-present')
}
