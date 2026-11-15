import {
  assessIndexability,
  ISSUE_BASIS,
  PAGE_ISSUE_IDS,
  type CrawlPageFacts,
} from '@seotools/core'
import type { CrawlUrlRender } from '@seotools/db'
import { parseRobotsDirectives, type AuditedUrl } from './site-audit'
import { INPUT_RECORDED } from './observed-inputs'
import { RENDER_DIFFERENCE_IDS } from './render-differences'

/**
 * What a page's JavaScript findings need beyond a captured document: not observed on a redirect.
 * A function: `render-differences` imports `site-audit`, which imports this module.
 */
const documentDifferences = () =>
  RENDER_DIFFERENCE_IDS.filter((id) => id !== 'render-failed' && id !== 'javascript-redirect')

/** Select once, before any graph or duplicate metadata is derived. Never modify the served row. */
export function selectDocument(
  url: AuditedUrl,
  render: CrawlUrlRender | undefined,
  identity: (url: string) => string,
) {
  url.render = render
  if (!url.contentPage) return
  url.served = { ...url, hreflang: [...url.hreflang] }
  // A DOM captured at the end of the window, still loading, is an observation like a settled one:
  // what it shows is reported, and only what it lacks stays unverified (`documentLoading`).
  const whole =
    url.contentPage &&
    url.url.data?.truncated !== true &&
    render?.status === 'rendered' &&
    render.truncated === false
  const complete = whole && !render.data.redirected && !!render.data.facts && !!render.data.page
  url.documentLoading = complete && !render.settled
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
  // A JavaScript redirect abandons its rendered DOM, but the links its served HTML has stay in the
  // graph, and so does what its served meta robots says of them.
  url.nofollow =
    url.directives.has('nofollow') ||
    url.directives.has('none') ||
    (url.documentObservation === 'redirected' && url.served.nofollow)
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
  // JavaScript findings are unknown only for this page: a failed, cut, unrecorded or missing render
  // says nothing of it (`render-failed` excepted, which is what it is), a JavaScript redirect
  // abandons its document, and an older row without extracted values cannot be compared.
  if (!whole)
    url.documentUnobserved.push(...RENDER_DIFFERENCE_IDS.filter((id) => id !== 'render-failed'))
  else if (!complete) url.documentUnobserved.push(...documentDifferences())
  else if (!url.served.facts?.social || !render.data.facts?.social)
    url.documentUnobserved.push('social-tags-only-after-rendering')
  // What an unknown canonical leaves unknown is derived from the checks themselves, once the site
  // is read (`unknownIssuesOf`), and crawl-wide for what reads other pages (`loadSite`).
}
