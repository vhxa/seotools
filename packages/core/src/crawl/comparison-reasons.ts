/**
 * Why a URL is in one crawl of a comparison and not in the other, from what the two crawls stored,
 * claiming only what that data proves. Pure (no Node imports, no database), so the worker that
 * works the reasons out, the database that stores them and the pages that show them (client
 * components included, through `@seotools/core/crawl/comparison-reasons`) share one definition.
 *
 * Words used here:
 * - **U** is the URL being explained. Its **own** crawl has it; the **other** crawl does not. For a
 *   URL "not seen", own is the earlier crawl; for one "discovered", the later one.
 * - A **source** of U is a URL whose response, in the own crawl, linked to U (a row of
 *   `crawl_url_links` of any kind: anchors, canonicals, sitemaps, redirects, scripts…).
 * - The source is **observed whole** by the other crawl when the other crawl read the part of it
 *   the link was found in completely: the served HTML for a link found in it, the rendered page for
 *   a link found only after rendering. Then that crawl would have recorded the link had it been
 *   there, so its absence is a fact about the site. Anything less leaves the URL "not reached".
 *
 * The principle: a change of the site (`unlinked`/`linked`) is claimed only when nothing seotools
 * did, or failed to do, can explain the difference. Otherwise the reason says what seotools did not
 * see, and when nothing stored explains it, it is `unknown`, never a guess.
 */
import { matchesIgnoredParameter, stripIgnoredParameters } from './normalize'
import type { CrawlDiscoveryDifference } from './discovery'
import type { RenderState } from './render-state'
import type { CrawlLinkKind, CrawlUrlSource } from './types'

/**
 * Bumped whenever the rules here change what a URL is given, so that stored explanations made
 * with older rules are worked out again instead of being shown.
 */
export const EXPLANATION_VERSION = 2

/**
 * - `merged`: the later crawl ignores a parameter, so two addresses of the earlier crawl are one
 *   there. Not seen: this URL has the parameter and became `into`. Discovered (`detail: 'into'`):
 *   this is the address `into` (and maybe others) became, which the earlier crawl did not have.
 * - `split`: the earlier crawl ignored a parameter the later one keeps; the same two cases the other
 *   way round.
 * - `settings`: a crawl setting left it out: the page that linked it was outside the other crawl's
 *   paths, it was only on the priority list or an optional crawl file, or a depth or URL limit that
 *   changed (`detail` says which).
 * - `mode`: linked only in a rendered page, and the other crawl did not render.
 * - `unlinked` (not seen) / `linked` (discovered): every page that linked it was read whole by the
 *   other crawl and did not link it. A change of the site.
 * - `notReached`: a page that linked it was not read whole by the other crawl. Never "gone".
 * - `limit`: the other crawl stopped at its URL limit, so what it found afterwards was not kept.
 * - `depth`: the page that linked it was beyond the other crawl's maximum depth, and the setting
 *   did not change (or whether it did was not recorded).
 * - `unstable`: the site answered differently to repeated requests for the page that linked it.
 * - `unknown`: nothing stored explains it.
 */
export const COMPARISON_REASONS = [
  'merged',
  'split',
  'settings',
  'mode',
  'unlinked',
  'linked',
  'notReached',
  'limit',
  'depth',
  'unstable',
  'unknown',
] as const
export type ComparisonReason = (typeof COMPARISON_REASONS)[number]

export const isComparisonReason = (value: unknown): value is ComparisonReason =>
  (COMPARISON_REASONS as readonly unknown[]).includes(value)

/** Reasons that are certain and fully explained by a setting: never counted as not seen or found. */
export const CONFIGURATION_REASONS = [
  'merged',
  'split',
  'settings',
  'mode',
] as const satisfies readonly ComparisonReason[]

export const isConfigurationReason = (reason: ComparisonReason) =>
  (CONFIGURATION_REASONS as readonly string[]).includes(reason)

/** Which crawl has the URL: `base` (the earlier: "not seen") or `target` (the later: "discovered"). */
export type ComparisonSide = 'base' | 'target'

/** The reasons a URL of each side can be given, in the order the page lists them. */
export const SIDE_REASONS = {
  base: [
    'merged',
    'split',
    'settings',
    'mode',
    'unlinked',
    'notReached',
    'limit',
    'depth',
    'unstable',
    'unknown',
  ],
  target: [
    'split',
    'merged',
    'settings',
    'mode',
    'linked',
    'notReached',
    'limit',
    'depth',
    'unstable',
    'unknown',
  ],
} as const satisfies Record<ComparisonSide, readonly ComparisonReason[]>

/**
 * What one in-link of U says, compared across the two crawls. One rule decides it: a link proves a
 * change of the site (`whole`) only when **both** crawls observed its source **the same way** and
 * the observation is whole. Everything else says what was not observed, and the first that applies
 * wins, in this order:
 *
 * 1. Own side (the crawl that has the link): the source did not answer whole, so the link may come
 *    from an error page or a cut response.
 *    - `source-unobserved`: not 2xx and whole (3xx for a redirect link).
 * 2. Identity: the source is at another address in the other crawl, because the crawls ignore
 *    different query parameters.
 *    - `identity`: not the same page; unknown, never a change of the site.
 * 3. The other crawl's answer for the same address.
 *    - `not-seen`: it does not have the source (a chain, see `chainStep`).
 *    - `excluded`: it left the source out for its paths (a setting).
 *    - `depth-setting`: it left the source out for its depth, and its maximum depth is narrower.
 *    - `depth`: the same, with a maximum depth not narrower or not recorded.
 *    - `not-requested`: it found the source and stopped before requesting it.
 *    - `failed`: no answer, 401, 403, 408, 429 or 5xx.
 *    - `error-answer`: another 4xx: an error page is not the page.
 *    - `redirected`: it now redirects (and the link was not a redirect).
 *    - `other-answer`: the link was a redirect and the source now answers a page.
 *    - `served-truncated`: its served response was cut at the size limit.
 * 4. A link found only after rendering.
 *    - `mode`: the other crawl did not render (a setting; only after the failures above).
 *    - `render-settings`: both rendered, with different rendering settings (wait, omitted hosts).
 *    - `render-missing`, `render-failed`, `render-truncated`, `render-unsettled`,
 *      `render-redirected`, `render-unreliable`: the other crawl's render does not prove a link
 *      absent (WP1's `captureProvesAbsence`).
 *    - `render-own`: the render that has the link is not a trusted capture either.
 * 5. `settings`: the request settings that decide what a page answers (`WITNESS_SETTINGS`) differ
 *    or were not recorded by a side.
 * 6. `whole`: observed the same way, whole: the link is gone (or new). A change of the site.
 */
export const LINK_CLASSES = [
  'whole',
  'not-seen',
  'mode',
  'excluded',
  'depth-setting',
  'depth',
  'not-requested',
  'failed',
  'error-answer',
  'redirected',
  'other-answer',
  'served-truncated',
  'render-missing',
  'render-failed',
  'render-truncated',
  'render-unsettled',
  'render-redirected',
  'render-unreliable',
  'source-unobserved',
  'identity',
  'render-settings',
  'render-own',
  'settings',
] as const
export type LinkClass = (typeof LINK_CLASSES)[number]

/** The other crawl did not read the source whole: "not reached", in this order of naming. */
export const NOT_REACHED_ORDER = [
  'failed',
  'error-answer',
  'served-truncated',
  'redirected',
  'other-answer',
  'render-failed',
  'render-truncated',
  'render-unsettled',
  'render-redirected',
  'render-missing',
  'render-unreliable',
  'not-requested',
] as const satisfies readonly LinkClass[]

/** Neither crawl's observation can decide: "unknown", in this order of naming. */
export const UNKNOWN_ORDER = [
  'source-unobserved',
  'identity',
  'render-own',
  'render-settings',
  'settings',
] as const satisfies readonly LinkClass[]

/** Explained by a setting of the other crawl, in the direction of the difference. */
export const CONFIGURATION_CLASSES = [
  'mode',
  'excluded',
  'depth-setting',
] as const satisfies readonly LinkClass[]

/** What one crawl stored of a source of U. */
export interface PageObservation {
  state: 'queued' | 'done' | 'skipped'
  kind: 'page' | 'redirect' | 'resource' | 'unknown'
  statusCode: number | null
  /** `data.notRequested` */
  notRequested: 'excluded' | 'depth' | null
  /** `data.truncated`: the served body was cut at the size limit. */
  servedTruncated: boolean
  /** Read only for links found after rendering. `null`: the crawl has no render of it. */
  renderState: RenderState | null
  /** WP1's `captureProvesAbsence` holds for that render. */
  renderTrusted: boolean
}

/** What the two crawls of a pair allow to compare, worked out once per pair and side. */
export interface PairConditions {
  /** The other crawl rendered its pages. */
  otherRendered: boolean
  /** `WITNESS_SETTINGS` recorded by both crawls and equal. */
  requestsComparable: boolean
  /** Both crawls rendered, with the same wait and omitted hosts. */
  rendersComparable: boolean
  /** The other crawl's maximum depth is narrower than the own crawl's. `null`: not recorded. */
  depthNarrowed: boolean | null
}

export interface LinkObservation {
  /** The link was found only after rendering (`crawl_url_links.rendered = 1`). */
  rendered: boolean
  kind: CrawlLinkKind | string
  /** The source in the crawl that has the link. */
  own: PageObservation
  /** The source at the same address in the other crawl. `null`: it does not have it. */
  other: PageObservation | null
  /** The source is at another address in the other crawl (different ignored parameters). */
  identityChanged: boolean
  conditions: PairConditions
}

/** 401 and 403 are often a block of the crawler; 408 and 429 a refusal to answer now. */
const NOT_AN_ANSWER = new Set([401, 403, 408, 429])
const isRedirect = (status: number) => status >= 300 && status < 400
const isSuccess = (status: number) => status >= 200 && status < 300 && status !== 206

/** The source answered the way a link of this kind is observed, whole. */
function answeredWhole(page: PageObservation, redirectLink: boolean): boolean {
  if (page.state !== 'done' || page.statusCode === null) return false
  if (redirectLink) return isRedirect(page.statusCode)
  return isSuccess(page.statusCode) && !page.servedTruncated
}

export function classifyLink(link: LinkObservation): LinkClass {
  const redirectLink = link.kind === 'redirect'
  if (!answeredWhole(link.own, redirectLink)) return 'source-unobserved'
  if (link.identityChanged) return 'identity'
  const other = link.other
  if (!other) return 'not-seen'
  if (other.state === 'skipped' && other.notRequested === 'excluded') return 'excluded'
  if (other.state === 'skipped' && other.notRequested === 'depth')
    return link.conditions.depthNarrowed === true ? 'depth-setting' : 'depth'
  if (other.state !== 'done') return 'not-requested'
  const status = other.statusCode
  if (status === null || status >= 500 || NOT_AN_ANSWER.has(status)) return 'failed'
  if (status >= 400) return 'error-answer'
  if (redirectLink) {
    if (!isRedirect(status)) return 'other-answer'
  } else {
    if (isRedirect(status)) return 'redirected'
    if (!isSuccess(status)) return 'error-answer'
    if (other.servedTruncated) return 'served-truncated'
  }
  if (link.rendered) {
    if (!link.conditions.otherRendered) return 'mode'
    if (!link.conditions.rendersComparable) return 'render-settings'
    switch (other.renderState) {
      case null:
        return 'render-missing'
      case 'failed':
        return 'render-failed'
      case 'truncated':
        return 'render-truncated'
      case 'unsettled':
        return 'render-unsettled'
      case 'redirect':
        return 'render-redirected'
      case 'unknown':
        return 'render-unreliable'
      case 'complete':
        if (!other.renderTrusted) return 'render-unreliable'
    }
    if (!link.own.renderTrusted) return 'render-own'
  }
  if (!link.conditions.requestsComparable) return 'settings'
  return 'whole'
}

/** Of the in-links of U of one class: how many, and the link with the lowest source `seq`. */
export interface ClassTally {
  count: number
  via: number
  /** The kind of that link and whether it was found after rendering: the edge the reason names. */
  kind: string
  rendered: boolean
}

/**
 * Settings under which a page requested in both crawls answered under comparable conditions: a
 * change of the site is claimed only when they were recorded by both crawls and are equal, and WP3's
 * witness needs them too (`discoveryLinkVaried`'s `comparableCompletedCrawls`).
 */
export const WITNESS_SETTINGS = [
  'userAgent',
  'requestCredentialsSet',
  'ignoredParameters',
  'includePrefixes',
  'excludePrefixes',
  'timeoutMs',
] as const satisfies readonly CrawlDiscoveryDifference['setting'][]

/** Rendering settings two renders must share to be compared. */
export const RENDER_SETTINGS = [
  'renderingMode',
  'renderWaitMs',
  'renderOmittedHosts',
] as const satisfies readonly CrawlDiscoveryDifference['setting'][]

/**
 * Whether the other crawl's limit is narrower than the own crawl's (`null` is no limit). `null`
 * when a side did not record it: a wider or equal limit can never explain a URL it lacks.
 */
export function narrower(
  own: number | null | undefined,
  other: number | null | undefined,
): boolean | null {
  if (own === undefined || other === undefined) return null
  if (other === null) return false
  return own === null || other < own
}

/** What `classifyDifference` needs of a URL that is not merged or split. */
export interface DifferenceInput {
  side: ComparisonSide
  /** How U was first put in its crawl (`crawl_urls.source`). */
  source: CrawlUrlSource | string
  /** The in-links of U in the own crawl, by class. Empty: it has none stored. */
  classes: Partial<Record<LinkClass, ClassTally>>
  /** The other crawl stopped at its URL limit (`incomplete`). */
  otherIncomplete: boolean
  /** The other crawl's URL limit is narrower than the own crawl's (`narrower`). */
  limitNarrowed: boolean | null
  /** Whether the other crawl's maximum depth is narrower, said for a `depth` reason. */
  depthNarrowed: boolean | null
  /**
   * WP3: `seq` of the source whose link to U varied between two requests of it in the other crawl
   * (`discoveryLinkVaried`). `null`: no such witness.
   */
  varied: number | null
  /** The own crawl numbers its URLs and links (made after migration 0019). */
  numbered: boolean
}

/**
 * The explanation of one URL, as stored. `via`, `through` are `seq`s of the own crawl.
 * - `detail`: for `settings`, which setting (`priority`, `files`, `excluded`, `depth`, `limit`);
 *   for `notReached`, the class of `via` (or `not-seen` for a chain); for `depth`, whether the
 *   setting was recorded (`unrecorded`/`unchanged`); for `unknown`, why (`legacy`, `no-links`,
 *   an unknown link class, `partial-configuration`, `cycle`, `cap`); for `limit`, `unrecorded`
 *   when whether the limit changed was not recorded.
 * - `viaKind`, `viaRendered`: the link from `via` the reason is about, exactly.
 */
export interface Explanation {
  reason: ComparisonReason | 'pending'
  detail: string | null
  via: number | null
  viaKind: string | null
  viaRendered: boolean | null
  through: number | null
  /** How many links to it the own crawl stored (over every class). */
  sources: number
}

/** The optional crawl files a domain can turn on, as `crawl_urls.source`. */
const SETTING_SOURCES = new Set<string>([
  'priority',
  'ads',
  'app-ads',
  'security',
  'humans',
  'feed',
  'opensearch',
  'indexnow',
])

const lowest = (tallies: (ClassTally | undefined)[]) => {
  let found: ClassTally | null = null
  for (const tally of tallies) if (tally && (found === null || tally.via < found.via)) found = tally
  return found
}

/**
 * The reason of a URL that is not merged or split. The weaker reason always wins:
 * 1. a link the other crawl did not read whole: `notReached` (before any setting);
 * 2. the other crawl stopped at its URL limit: `limit`, or `settings` when its limit is narrower;
 * 3. WP3's witness: `unstable`;
 * 4. a link neither observation can decide: `unknown`;
 * 5. beyond the other crawl's depth, which is not narrower: `depth`;
 * 6. every link explained by a setting of the other crawl: `mode` or `settings`; a setting that
 *    explains only some of them leaves it `unknown`;
 * 7. every link observed whole: `unlinked` / `linked`; with links from URLs the other crawl did not
 *    see either: `pending`, a chain (`chainStep`).
 */
export function classifyDifference(input: DifferenceInput): Explanation {
  const entries = Object.entries(input.classes) as [LinkClass, ClassTally][]
  const sources = entries.reduce((sum, [, tally]) => sum + tally.count, 0)
  const result = (
    reason: Explanation['reason'],
    detail: string | null,
    via: ClassTally | null = null,
  ): Explanation => ({
    reason,
    detail,
    via: via?.via ?? null,
    viaKind: via?.kind ?? null,
    viaRendered: via ? via.rendered : null,
    through: null,
    sources,
  })
  const has = (name: LinkClass) => input.classes[name] !== undefined

  if (!input.numbered) return result('unknown', 'legacy')
  if (sources === 0) {
    if (SETTING_SOURCES.has(input.source))
      return result('settings', input.source === 'priority' ? 'priority' : 'files')
    return result('unknown', 'no-links')
  }
  for (const name of NOT_REACHED_ORDER) {
    if (has(name)) return result('notReached', name, input.classes[name]!)
  }
  // A whole page may have linked it: past the limit nothing is recorded, link or URL.
  if (input.otherIncomplete) {
    if (input.limitNarrowed === true) return result('settings', 'limit')
    return result('limit', input.limitNarrowed === null ? 'unrecorded' : null)
  }
  if (input.varied !== null) {
    const tally = entries.find(([, found]) => found.via === input.varied)?.[1] ?? null
    return { ...result('unstable', null, tally), via: input.varied }
  }
  for (const name of UNKNOWN_ORDER) {
    if (has(name)) return result('unknown', name, input.classes[name]!)
  }
  if (has('depth')) {
    return result(
      'depth',
      input.depthNarrowed === null ? 'unrecorded' : 'unchanged',
      input.classes.depth!,
    )
  }
  const configured = entries.filter(([name]) =>
    (CONFIGURATION_CLASSES as readonly string[]).includes(name),
  )
  if (configured.length > 0) {
    // A setting takes a URL out of the counts only when it explains every way it was linked.
    if (configured.length !== entries.length) return result('unknown', 'partial-configuration')
    if (configured.every(([name]) => name === 'mode'))
      return result('mode', null, input.classes.mode!)
    const name = has('excluded') ? 'excluded' : has('depth-setting') ? 'depth-setting' : 'mode'
    return result('settings', name === 'depth-setting' ? 'depth' : name, input.classes[name]!)
  }
  if (!has('not-seen')) {
    return result(
      input.side === 'base' ? 'unlinked' : 'linked',
      null,
      lowest([input.classes.whole]),
    )
  }
  // An entrance: a link observed whole into the group (`via`), which chains need.
  return result('pending', null, lowest([input.classes.whole]))
}

/** How many times chains are followed before what is left is given up on as `unknown`. */
export const MAX_CHAIN_STEPS = 100

/**
 * One step of resolving a `pending` URL (§1.4). Its sources the other crawl did not see are URLs of
 * the same side, with their own reason (`null`: not explained at all, e.g. a source outside the
 * site). A source with any reason but `pending` or a change of the site means U was not reached
 * through it; a source without one leaves U unknown; otherwise it stays pending. After the last
 * step, a URL still pending is a change of the site: every way into its group was read whole.
 */
export function chainStep(
  side: ComparisonSide,
  unseen: { reason: ComparisonReason | 'pending' | null; seq: number }[],
): { reason: 'notReached' | 'unknown' | 'pending'; through: number | null } {
  const change = side === 'base' ? 'unlinked' : 'linked'
  let through: number | null = null
  let unexplained = false
  for (const source of unseen) {
    if (source.reason === null) unexplained = true
    else if (source.reason !== 'pending' && source.reason !== change) {
      if (through === null || source.seq < through) through = source.seq
    }
  }
  if (through !== null) return { reason: 'notReached', through }
  if (unexplained) return { reason: 'unknown', through: null }
  return { reason: 'pending', through: null }
}

/**
 * Whether a URL still pending once chains settle is reached from an **observed entrance**: a link
 * into its group that the other crawl read whole (`hasEntrance`, the row's `via`), directly or
 * through another URL of the group that is (`entered` on its sources, or already a change of the
 * site). A closed group that no observed link enters says nothing about the site: it stays unknown.
 */
export function entersChain(
  side: ComparisonSide,
  hasEntrance: boolean,
  unseen: { reason: ComparisonReason | 'pending' | null; entered: boolean }[],
): boolean {
  if (hasEntrance) return true
  const change = side === 'base' ? 'unlinked' : 'linked'
  return unseen.some(
    (source) => source.reason === change || (source.reason === 'pending' && source.entered),
  )
}

/**
 * The address an internal URL U has in the other crawl, when the two crawls ignore different query
 * parameters and U carries one the other ignores. `null`: the same address. Exactly as the crawler
 * strips them (only internal URLs are ever stripped, and only internal URLs are compared).
 */
export function identityChange(
  url: string,
  otherIgnoredParameters: readonly string[],
): string | null {
  const other = stripIgnoredParameters(url, otherIgnoredParameters)
  return other === url ? null : other
}

/** Query parameters U carries that the other crawl ignores: what the sentence names. */
export function ignoredParametersOf(url: string, patterns: readonly string[]): string[] {
  const question = url.indexOf('?')
  if (question < 0 || patterns.length === 0) return []
  const names = new Set<string>()
  for (const part of url.slice(question + 1).split('&')) {
    const name = new URLSearchParams(part).keys().next().value
    if (name !== undefined && matchesIgnoredParameter(name, patterns)) names.add(name)
  }
  return [...names]
}
