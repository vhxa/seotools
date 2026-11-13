import {
  PAGE_ISSUES,
  PAGE_ISSUE_IDS,
  boundedText,
  normalizeCrawlUrl,
  type AuditThresholds,
  type CrawlPageFacts,
  type IssueEvidence,
} from '@seotools/core'
import type { Check } from './issue-checks'
import { comparable, parseRobotsDirectives, type AuditedUrl, type Site } from './site-audit'

export const RENDER_DIFFERENCE_IDS = PAGE_ISSUE_IDS.filter(
  (id) =>
    PAGE_ISSUES[id].category === 'javascript' &&
    id !== 'linked-only-by-javascript' &&
    id !== 'links-only-after-rendering',
)

/** Both sources must be whole. A missing legacy flag or extracted value proves nothing. */
function complete(url: AuditedUrl, site: Site) {
  const render = url.render
  return site.config.rendering === 'rendered' &&
    url.internal &&
    url.contentPage &&
    url.facts &&
    url.url.data?.truncated !== true &&
    render?.status === 'rendered' &&
    render.settled &&
    render.truncated === false &&
    render.data.facts &&
    render.data.page
    ? { render, html: url.facts, rendered: render.data.facts, page: render.data.page }
    : null
}

function evidence(
  html: string | number | null | undefined,
  rendered: string | number | null | undefined,
) {
  return {
    evidence: {
      kind: 'values',
      total: 2,
      items: [
        { field: 'html', text: boundedText(String(html ?? '')) },
        { field: 'rendered', text: boundedText(String(rendered ?? '')) },
      ],
    } satisfies IssueEvidence,
  }
}

type Observation = NonNullable<ReturnType<typeof complete>>
const onComplete =
  (check: (url: AuditedUrl, observation: Observation, site: Site) => ReturnType<Check>): Check =>
  (url, site) => {
    const observation = complete(url, site)
    return observation ? check(url, observation, site) : false
  }

const valueCheck = (field: 'title' | 'description' | 'h1', only: boolean): Check =>
  onComplete((url, { page }) => {
    const html =
      field === 'title'
        ? url.url.title
        : field === 'description'
          ? url.url.data?.description
          : url.url.data?.h1?.[0]
    const rendered = page[field]
    const before = comparable(html)
    const after = comparable(rendered)
    return !!after && (only ? !before : !!before && before !== after) && evidence(html, rendered)
  })

/** Only HTML declarations: a response header is supplied unchanged to both extractors. */
const canonicals = (facts: CrawlPageFacts) =>
  facts.canonicals.filter((item) => item.source === 'html')
const target = (facts: CrawlPageFacts, site: Site) => {
  const declarations = canonicals(facts)
  if (declarations.some((item) => !item.url)) return null
  const targets = new Set(declarations.map((item) => site.identity?.(item.url!) ?? item.url!))
  return targets.size === 1 ? [...targets][0]! : null
}
const meta = (raw: string | null, botRobots?: Record<string, string>) =>
  parseRobotsDirectives([raw, botRobots?.googlebot])
const directive = (name: 'noindex' | 'nofollow', added: boolean): Check =>
  onComplete((url, { page }) => {
    const before = meta(url.url.metaRobots, url.url.data?.botRobots).has(name)
    const after = meta(page.metaRobots, page.botRobots).has(name)
    return (
      (added ? !before && after : before && !after) &&
      evidence(
        [url.url.metaRobots, url.url.data?.botRobots?.googlebot].filter(Boolean).join(', '),
        [page.metaRobots, page.botRobots.googlebot].filter(Boolean).join(', '),
      )
    )
  })

export function renderDifferenceChecks(figures: (site: Site) => AuditThresholds) {
  return {
    'text-only-after-rendering': onComplete((_, { html, rendered }, site) => {
      const threshold = figures(site).renderedTextSharePct
      const added = rendered.words - html.words
      return (
        threshold > 0 &&
        added >= 50 &&
        added * 100 >= threshold * rendered.words &&
        evidence(html.words, rendered.words)
      )
    }),
    'title-only-after-rendering': valueCheck('title', true),
    'title-changed-by-javascript': valueCheck('title', false),
    'description-only-after-rendering': valueCheck('description', true),
    'description-changed-by-javascript': valueCheck('description', false),
    'h1-only-after-rendering': valueCheck('h1', true),
    'h1-changed-by-javascript': valueCheck('h1', false),
    'canonical-only-after-rendering': onComplete(
      (_, { html, rendered }, site) =>
        canonicals(html).length === 0 &&
        !!target(rendered, site) &&
        evidence('', target(rendered, site)),
    ),
    'canonical-changed-by-javascript': onComplete((_, { html, rendered }, site) => {
      const before = target(html, site)
      const after = target(rendered, site)
      return !!before && !!after && before !== after && evidence(before, after)
    }),
    'noindex-only-in-html': directive('noindex', false),
    'noindex-added-by-javascript': directive('noindex', true),
    'nofollow-only-in-html': directive('nofollow', false),
    'nofollow-added-by-javascript': directive('nofollow', true),
    'structured-data-only-after-rendering': onComplete(
      (_, { html, rendered }) =>
        html.structuredData === 0 &&
        rendered.structuredData > 0 &&
        evidence(html.structuredData, rendered.structuredData),
    ),
    'hreflang-only-after-rendering': onComplete(
      (url, { page }) =>
        (url.url.data?.hreflang?.length ?? 0) === 0 &&
        page.hreflang.length > 0 &&
        evidence(
          '',
          page.hreflang
            .map((entry) => `${entry.lang}: ${entry.url}`)
            .slice(0, 5)
            .join('; '),
        ),
    ),
    // Require both preview essentials before claiming that the rendered preview is present.
    'social-tags-only-after-rendering': onComplete(
      (_, { html, rendered }) =>
        !!html.social &&
        !!rendered.social &&
        !comparable(html.social.title) &&
        !html.social.image &&
        !!comparable(rendered.social.title) &&
        !!rendered.social.image &&
        evidence('', `${rendered.social.title}; ${rendered.social.image}`),
    ),
    'javascript-redirect': onComplete((url, { render }, site) => {
      const before = normalizeCrawlUrl(url.url.url)
      const after = normalizeCrawlUrl(render.finalUrl)
      const identity = site.identity ?? ((value: string) => value)
      return !!before && !!after && identity(before) !== identity(after) && evidence(before, after)
    }),
    'render-resources-blocked-by-robots': onComplete((_, { render }) => {
      const requests = render.data.requests
      const count =
        requests && typeof requests === 'object' && 'blockedByRobotsCount' in requests
          ? requests.blockedByRobotsCount
          : undefined
      return typeof count === 'number' && count > 0 && evidence('', count)
    }),
    'render-failed': ((url, site) =>
      site.config.rendering === 'rendered' &&
      url.render?.status === 'failed' &&
      evidence('', url.render.failure)) satisfies Check,
    'render-script-errors': onComplete(
      (_, { render }) =>
        render.data.scriptErrors.count > 0 &&
        evidence(
          '',
          `${render.data.scriptErrors.count}: ${render.data.scriptErrors.first.slice(0, 5).join('; ')}`,
        ),
    ),
  } satisfies Partial<Record<string, Check>>
}
