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
export const EXPLANATION_VERSION = 1

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
 * What one source of U was in the other crawl, for one link (§1.2 of the design). The first that
 * applies wins:
 * - `mode`: the link was found only after rendering and the other crawl did not render.
 * - `not-seen`: the other crawl does not have the source either.
 * - `excluded` / `depth`: the other crawl found the source and left it out for its paths or depth.
 * - `not-requested`: the other crawl found the source and stopped before requesting it.
 * - `failed`: no answer, 401, 403, 408, 429 or 5xx (an answer that is not the page).
 * - `redirected`: it now redirects, and the link was not the redirect itself.
 * - `served-truncated`: its served response was cut at the size limit.
 * - `render-*`: the link was found only after rendering and the other crawl's render of the page was
 *   missing, failed, cut, captured while still loading, a redirect, or made before captures could
 *   prove a link absent (`render-unreliable`).
 * - `whole`: it was read whole: had the link been there, the other crawl would have it.
 */
export const LINK_CLASSES = [
  'whole',
  'not-seen',
  'mode',
  'excluded',
  'depth',
  'not-requested',
  'failed',
  'redirected',
  'served-truncated',
  'render-missing',
  'render-failed',
  'render-truncated',
  'render-unsettled',
  'render-redirected',
  'render-unreliable',
] as const
export type LinkClass = (typeof LINK_CLASSES)[number]

/** Which source a "not reached" names: the first class in this order, then the lowest `seq`. */
export const NOT_REACHED_ORDER = [
  'failed',
  'served-truncated',
  'redirected',
  'render-failed',
  'render-truncated',
  'render-unsettled',
  'render-redirected',
  'render-missing',
  'render-unreliable',
  'not-requested',
  'depth',
  'excluded',
  'mode',
] as const satisfies readonly LinkClass[]

/** What the other crawl stored of a source of U (its counterpart), as far as links depend on it. */
export interface SourceCounterpart {
  state: 'queued' | 'done' | 'skipped'
  kind: 'page' | 'redirect' | 'resource' | 'unknown'
  statusCode: number | null
  /** `data.notRequested` */
  notRequested: 'excluded' | 'depth' | null
  /** `data.truncated`: the served body was cut at the size limit. */
  servedTruncated: boolean
  /** `null`: the other crawl has no render of it. */
  renderState: RenderState | null
  /**
   * The render was captured by a rule under which a link missing from it proves it was not there
   * (WP1's capture marker). Only read for links found after rendering.
   */
  captureProvesAbsence: boolean
}

export interface LinkObservation {
  /** The link was found only after rendering (`crawl_url_links.rendered = 1`). */
  rendered: boolean
  kind: CrawlLinkKind | string
  /** The other crawl rendered its pages. */
  otherRendered: boolean
  /** `null`: the other crawl does not have the source. */
  counterpart: SourceCounterpart | null
}

/** 401 and 403 are often a block of the crawler; 408 and 429 a refusal to answer now. */
const NOT_AN_ANSWER = new Set([401, 403, 408, 429])

export function classifyLink(link: LinkObservation): LinkClass {
  if (link.rendered && !link.otherRendered) return 'mode'
  const other = link.counterpart
  if (!other) return 'not-seen'
  if (other.state === 'skipped' && other.notRequested) return other.notRequested
  if (other.state !== 'done') return 'not-requested'
  const status = other.statusCode
  if (status === null || status >= 500 || NOT_AN_ANSWER.has(status)) return 'failed'
  if (status >= 300 && status < 400 && link.kind !== 'redirect') return 'redirected'
  if (other.servedTruncated) return 'served-truncated'
  if (link.rendered && other.kind === 'page' && status >= 200 && status < 300) {
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
        return other.captureProvesAbsence ? 'whole' : 'render-unreliable'
    }
  }
  // Any other answer (2xx, a 404 or 410, a redirect for the redirect itself) was observed.
  return 'whole'
}

/** Of the in-links of U of one class: how many, and the lowest `seq` of their sources. */
export interface ClassTally {
  count: number
  via: number
}

/** Whether the other crawl's discovery settings that decide reach changed. `null`: not recorded. */
export interface ReachSettingsChanges {
  maxDepth: boolean | null
  maxUrls: boolean | null
}

export const UNRECORDED_REACH: ReachSettingsChanges = { maxDepth: null, maxUrls: null }

/**
 * The reach settings from WP2's comparison of two crawls' discovery snapshots (`compareCrawlDiscovery`):
 * a setting it lists as `different` changed, `unknown` was not recorded by a side, absent is the same.
 */
export function reachChanges(
  differences: readonly CrawlDiscoveryDifference[],
): ReachSettingsChanges {
  const of = (setting: 'maxDepth' | 'maxUrls') => {
    const found = differences.find((difference) => difference.setting === setting)
    return found === undefined ? false : found.status === 'different' ? true : null
  }
  return { maxDepth: of('maxDepth'), maxUrls: of('maxUrls') }
}

/**
 * Settings under which a page requested in both crawls answered under comparable conditions, which
 * WP3's witness needs (`discoveryLinkVaried`'s `comparableCompletedCrawls`): any of them differing,
 * or not recorded by a side, and the witness is not used.
 */
export const WITNESS_SETTINGS = [
  'userAgent',
  'requestCredentialsSet',
  'ignoredParameters',
  'includePrefixes',
  'excludePrefixes',
  'timeoutMs',
] as const satisfies readonly CrawlDiscoveryDifference['setting'][]

/** What `classifyDifference` needs of a URL that is not merged or split. */
export interface DifferenceInput {
  side: ComparisonSide
  /** How U was first put in its crawl (`crawl_urls.source`). */
  source: CrawlUrlSource | string
  /** The in-links of U in the own crawl, by class. Empty: it has none stored. */
  classes: Partial<Record<LinkClass, ClassTally>>
  /** The other crawl stopped at its URL limit (`incomplete`). */
  otherIncomplete: boolean
  reach: ReachSettingsChanges
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
 *   `chain`, `cap`); for `limit`, `unrecorded` when whether the limit changed was not recorded.
 */
export interface Explanation {
  reason: ComparisonReason | 'pending'
  detail: string | null
  via: number | null
  through: number | null
  /** How many pages linked it in the own crawl (distinct sources over every class). */
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
  let via: number | null = null
  for (const tally of tallies) if (tally && (via === null || tally.via < via)) via = tally.via
  return via
}

/**
 * The reason of a URL that is not merged or split (§1.3). `pending` when only whole sources and
 * sources the other crawl did not see either link it: a chain, decided by `chainStep`.
 */
export function classifyDifference(input: DifferenceInput): Explanation {
  const entries = Object.entries(input.classes) as [LinkClass, ClassTally][]
  const sources = entries.reduce((sum, [, tally]) => sum + tally.count, 0)
  const result = (
    reason: Explanation['reason'],
    detail: string | null,
    via: number | null = null,
  ): Explanation => ({ reason, detail, via, through: null, sources })

  if (!input.numbered) return result('unknown', 'legacy')
  if (sources === 0) {
    if (SETTING_SOURCES.has(input.source))
      return result('settings', input.source === 'priority' ? 'priority' : 'files')
    return result('unknown', 'no-links')
  }
  // A whole page may have linked it: past the limit nothing is recorded, link or URL.
  if (input.otherIncomplete) {
    if (input.reach.maxUrls === true) return result('settings', 'limit')
    return result('limit', input.reach.maxUrls === null ? 'unrecorded' : null)
  }
  if (input.varied !== null) return result('unstable', null, input.varied)

  const blocking = entries.filter(([name]) => name !== 'whole' && name !== 'not-seen')
  if (blocking.length === 0) {
    if (!input.classes['not-seen']) {
      return result(
        input.side === 'base' ? 'unlinked' : 'linked',
        null,
        lowest([input.classes.whole]),
      )
    }
    return result('pending', null, lowest([input.classes.whole]))
  }
  const only = (allowed: readonly LinkClass[]) => blocking.every(([name]) => allowed.includes(name))
  const depthIsSetting = input.reach.maxDepth === true
  if (only(['mode'])) return result('mode', null, lowest([input.classes.mode]))
  if (only(depthIsSetting ? ['mode', 'excluded', 'depth'] : ['mode', 'excluded'])) {
    const name = input.classes.excluded ? 'excluded' : input.classes.depth ? 'depth' : 'mode'
    return result('settings', name, lowest([input.classes[name]]))
  }
  if (only(['depth'])) {
    return result(
      'depth',
      input.reach.maxDepth === null ? 'unrecorded' : 'unchanged',
      lowest([input.classes.depth]),
    )
  }
  for (const name of NOT_REACHED_ORDER) {
    const tally = input.classes[name]
    if (tally) return result('notReached', name, tally.via)
  }
  return result('unknown', null)
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
