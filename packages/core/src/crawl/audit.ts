/**
 * What takes part in the audit and what a URL is expected to be, decided by rules and exceptions per
 * domain. Two independent dimensions, each resolved on its own:
 * - `audit`: a URL is audited (the default) or excluded: it is still crawled and its data is kept,
 *   but it has no findings of its own.
 * - `intent`: what the user expects of its indexation. It is a statement of intent, never evidence
 *   that a search engine indexed (or did not index) anything.
 *
 * - `conditions`: six facts about a URL (a `noindex`, a `nofollow`, a block in robots.txt, being in a
 *   sitemap, declaring another canonical URL or having no internal links), each resolved on its own as `required`, `allowed` or `forbidden`. They are about one
 *   observed state each: never about whether the URL as a whole can be indexed, which is the
 *   `intent`, and a block in robots.txt is never read as the URL being out of the index.
 *
 * Everything here is pure and has no Node imports: the worker (analysis), the server actions
 * (validation, previews) and the client components (labels) share this one resolution, so what the
 * settings page says is what the worker applies. Reach it from client components through
 * `@seotools/core/crawl/audit`.
 *
 * What a configuration means is versioned (`AUDIT_SEMANTICS`) and every analysis keeps the version it
 * was made with, so an analysis from before a change in meaning is still read, and repeated, as it
 * was.
 */
import { z } from '../zod'
import {
  canonicalThresholds,
  thresholdOverridesSchema,
  type ThresholdOverrides,
} from './thresholds'
import { isInternalUrl, normalizeCrawlUrl } from './normalize'

/**
 * The facts a rule can ask for or rule out on a URL. Each is one observed state, kept apart from
 * the indexability of the URL as a whole (`intent`):
 * - `noindex`: the page declares `noindex` (robots meta tag or `X-Robots-Tag`).
 * - `nofollow`: the page declares `nofollow` for itself. Links marked `rel="nofollow"` are other issues.
 * - `robots`: robots.txt blocks the URL for the bot the audit follows. That is a crawling rule: it says
 *   nothing about whether the URL is, or stays, out of a search engine's index.
 * - `sitemap`: a sitemap lists the URL.
 * - `canonical`: the page declares another URL as canonical.
 * - `unlinked`: no internal anchor link points at the URL.
 */
export const AUDIT_CONDITIONS = [
  'noindex',
  'nofollow',
  'robots',
  'sitemap',
  'canonical',
  'unlinked',
] as const
export type AuditCondition = (typeof AUDIT_CONDITIONS)[number]

/**
 * What a rule asks of a condition.
 * - `required`: the URL has to have it; a finding is raised when it provably does not.
 * - `allowed`: either way is fine; the generic finding for the condition is not raised.
 * - `forbidden`: the URL must not have it; a finding is raised when it provably does.
 * What cannot be told (not requested, a request that failed, a file that could not be read) is
 * neither: no finding is raised, and it is never read as the requirement being met.
 */
export const REQUIREMENTS = ['required', 'allowed', 'forbidden'] as const
export type Requirement = (typeof REQUIREMENTS)[number]

export const AUDIT_DIMENSIONS = ['audit', 'intent', ...AUDIT_CONDITIONS] as const
export type AuditDimension = (typeof AUDIT_DIMENSIONS)[number]

export const isAuditCondition = (value: unknown): value is AuditCondition =>
  (AUDIT_CONDITIONS as readonly unknown[]).includes(value)

/** What a rule says about the audit: leave the URLs out, or bring back those a broader rule left out. */
export const AUDIT_VALUES = ['exclude', 'include'] as const
export type AuditValue = (typeof AUDIT_VALUES)[number]

/**
 * What a configuration means. It changes when the same rules would be read another way, so that an
 * analysis can be repeated with the meaning it had.
 * - 1: a URL with no rule had no declared intent (`none`), and a rule could say `none` to cancel
 *   a broader one. Selectors were literal paths. This is what an analysis without a version used.
 * - 2: a URL with no rule is expected to be indexable. A rule or exception says `indexable` or
 *   `not-indexable`, can accept the page's own `nofollow` (an exception can do only that, leaving the
 *   expectation to the other rules), and a path rule can be shared between the language
 *   directories of the domain.
 * - 3: nothing about a URL's own directives hangs off the expectation any more. The four conditions
 *   (`AUDIT_CONDITIONS`) are rules of their own, each inherited on its own; accepting the page's
 *   `nofollow` is the `nofollow` condition set to `allowed` (an intent rule's `acceptNofollow` and
 *   the `inherit` intent value are retired, and ignored when read). A condition no rule states
 *   behaves as it always did.
 * - 4: what a URL declares of its own indexation also reaches the findings of the URLs that point at
 *   it, and of the URLs it points at (`relationsOf` in the worker): a canonical or an hreflang to a
 *   URL whose `noindex` (or robots.txt block) a rule requires or allows, or whose expectation is
 *   `not-indexable` for a noindex or a canonical elsewhere, is not reported for it, and neither are
 *   the alternates of a URL that is deliberately out of the index. Before, a rule only replaced the
 *   generic finding of the URL itself and never what other pages said of it. Rules do not change;
 *   what they accept does, so an analysis of an older meaning is read as it was.
 * - 5: only what the URL that points declares excuses what it points at. A destination declared
 *   out of the index (a `noindex` it requires or allows, an expectation of `not-indexable`) no longer
 *   excuses a canonical or hreflang to it from a URL expected to be indexable: pointing an indexable
 *   page at a URL meant to stay out is the problem. A URL that is itself expected out still excuses
 *   the indexing blockers of what it points at, and its own inbound findings. A failing or
 *   redirecting destination is never excused.
 */
export const AUDIT_SEMANTICS = 5

/** The first meaning (`AUDIT_SEMANTICS`) in which the declared state of a URL reaches the URLs that point at it. */
export const RELATIONS_SEMANTICS = 4

/**
 * The first meaning in which only the URL that points (the origin) can make a finding about the URL
 * it points at expected: a destination declared out of the index no longer excuses an origin that
 * is expected to be indexable.
 */
export const ORIGIN_RELATIONS_SEMANTICS = 5

/**
 * Whether a rule is read differently from semantics 4 on (see `AUDIT_SEMANTICS`): the ones that
 * accept a state of a URL for the findings of the URLs that point at it. A configuration without any
 * is read the same by 3 and 4.
 */
export const reachesRelations = (rule: { dimension: string; value: string }) =>
  (rule.dimension === 'intent' && rule.value === 'not-indexable') ||
  ((rule.dimension === 'noindex' ||
    rule.dimension === 'robots' ||
    rule.dimension === 'canonical') &&
    (rule.value === 'required' || rule.value === 'allowed'))

/** What a URL can be expected to be, which is what a rule or an exception can say. */
export const INDEX_INTENTS = ['indexable', 'not-indexable'] as const
export type IndexIntent = (typeof INDEX_INTENTS)[number]

/**
 * An expectation as an analysis stored it. `none` (no declared intent) only exists in analyses and
 * snapshots from before semantics 2, and is never offered for a new configuration.
 */
export type RecordedIntent = IndexIntent | 'none'

/**
 * What an intent rule says about the expectation. `inherit` only exists in rules and snapshots from
 * semantics 2, where an exception on one URL could leave the expectation to the other rules and only
 * accept the page's own `nofollow`. Semantics 3 does not read it: that is the `nofollow` condition.
 */
export type IntentRuleValue = RecordedIntent | 'inherit'

export const AUDIT_PARTICIPATIONS = ['audited', 'excluded'] as const
export type AuditParticipation = (typeof AUDIT_PARTICIPATIONS)[number]

export const AUDIT_LIMITS = {
  /** Characters of the reason a rule is given. */
  reason: 500,
  /** Characters of a path or a query typed into a selector. */
  selector: 2048,
  /** Statement rows a domain can have, enabled or not: every crawl keeps an enabled snapshot. */
  rulesPerDomain: 500,
  /** Selectors one path rule can cover. */
  pathsPerRule: 20,
  /** URLs one action configures at a time: a page of the pages table is far below it. */
  bulkUrls: 200,
} as const

/** The query of a URL a path rule applies to. */
export type QuerySelector = { mode: 'any' } | { mode: 'exact'; value: string }

/**
 * Where a path rule looks for its path.
 * - `literal`: in the path of the URL as it is.
 * - `shared`: in the path once the directory of a language the domain declared is taken off, and in
 *   the path as it is when the domain has pages of its default language without a directory. Only
 *   declared directories count, and at most one is taken off.
 */
export const SELECTOR_SCOPES = ['literal', 'shared'] as const
export type SelectorScope = (typeof SELECTOR_SCOPES)[number]

/**
 * Which URLs a rule covers. Always internal ones: the host of the domain and its `www.` variant over
 * HTTP and HTTPS, as the crawler scopes them.
 * - `url`: exactly this normalized URL, scheme, host, path and query. Always literal.
 * - `path`: this path and no other (`/cuenta` is not `/cuenta/`), with any query or one in particular.
 * - `prefix`: this path and what is below it by segments: `/cuenta` covers `/cuenta`, `/cuenta/` and
 *   `/cuenta/pedidos`, but not `/cuentame`.
 */
export type AuditSelector =
  | { kind: 'url'; url: string }
  | { kind: 'path'; path: string; query: QuerySelector; scope: SelectorScope }
  | { kind: 'prefix'; path: string; query: QuerySelector; scope: SelectorScope }

export const SELECTOR_KINDS = ['url', 'path', 'prefix'] as const
export type SelectorKind = (typeof SELECTOR_KINDS)[number]

interface RuleBase {
  /** Optional grouping only: never changes resolution or comparison scope. */
  set?: string | null
  id: string
  selector: AuditSelector
  /** Why the user set it. Shown wherever the rule is the reason for what a URL is. */
  reason: string | null
  enabled: boolean
}

export type AuditRule =
  | (RuleBase & { dimension: 'audit'; value: AuditValue })
  | (RuleBase & {
      dimension: 'intent'
      value: IntentRuleValue
      /**
       * Retired with semantics 3, where accepting a `nofollow` is the `nofollow` condition. It is read
       * only from rules and snapshots of semantics 2: the page's own `nofollow` was accepted as
       * intended by the rule that decided its expectation. New rules always say `false`.
       */
      acceptNofollow: boolean
    })
  | (RuleBase & { dimension: AuditCondition; value: Requirement })

export type ConditionRule = Extract<AuditRule, { dimension: AuditCondition }>
export const isConditionRule = (rule: AuditRule): rule is ConditionRule =>
  isAuditCondition(rule.dimension)

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** What it takes to create a rule: the rest is given when it is stored. */
export type NewAuditRule = DistributiveOmit<AuditRule, 'id' | 'acceptNofollow'>

// --- language directories ------------------------------------------------------------------------

/**
 * The language directories a domain declares (`/es`, `/pt-br`), and whether it also has pages of its
 * default language without one. Nothing is deduced from the first segment of a path: only these
 * count, and only for the rules whose scope is `shared`.
 */
export interface LanguageConfig {
  /** Normalized (`/es`, one segment, no trailing slash) and sorted. */
  prefixes: string[]
  unprefixed: boolean
}

export const NO_LANGUAGES: LanguageConfig = { prefixes: [], unprefixed: false }

export const LANGUAGE_LIMITS = { prefixes: 50 } as const

const LANGUAGE_PREFIX = /^\/[A-Za-z0-9][A-Za-z0-9_-]{0,31}$/

/** `es`, `/es` and `/es/` are the directory `/es`. `null` if it is not one segment of letters, digits, `-` or `_`. */
export function normalizeLanguagePrefix(input: string): string | null {
  const value = input.trim()
  const withSlash = value.startsWith('/') ? value : `/${value}`
  const bare = withSlash.length > 1 && withSlash.endsWith('/') ? withSlash.slice(0, -1) : withSlash
  return LANGUAGE_PREFIX.test(bare) ? bare : null
}

/** A list typed with commas, spaces or one per line, as the directories it names. */
export function parseLanguagePrefixes(
  input: string,
): { ok: true; prefixes: string[] } | { ok: false; error: 'prefix' | 'limit' } {
  const found = new Set<string>()
  for (const word of input.split(/[\s,;]+/)) {
    if (word === '') continue
    const prefix = normalizeLanguagePrefix(word)
    if (prefix === null) return { ok: false, error: 'prefix' }
    found.add(prefix)
  }
  if (found.size > LANGUAGE_LIMITS.prefixes) return { ok: false, error: 'limit' }
  return { ok: true, prefixes: [...found].sort() }
}

/** The same configuration, in the one form that compares and stores the same whatever came in. */
export function canonicalLanguages(languages: LanguageConfig): LanguageConfig {
  return { prefixes: [...new Set(languages.prefixes)].sort(), unprefixed: languages.unprefixed }
}

export function sameLanguages(a: LanguageConfig, b: LanguageConfig): boolean {
  const x = canonicalLanguages(a)
  const y = canonicalLanguages(b)
  return (
    x.unprefixed === y.unprefixed &&
    x.prefixes.length === y.prefixes.length &&
    x.prefixes.every((prefix, index) => prefix === y.prefixes[index])
  )
}

// --- identity ------------------------------------------------------------------------------------

/**
 * What makes two selectors the same one: kind, scope, path or URL, and the query it asks for. Two enabled
 * rules of one dimension cannot share it, so no URL ever has a tie to break.
 */
export function selectorKey(selector: AuditSelector): string {
  if (selector.kind === 'url') return `url ${selector.url}`
  const query = selector.query.mode === 'any' ? '*' : `=${selector.query.value}`
  // Literal selectors keep the key they always had: it is stored.
  const scope = selector.scope === 'shared' ? ' @shared' : ''
  return `${selector.kind} ${selector.path} ${query}${scope}`
}

// --- validation of what a user typed --------------------------------------------------------------

export type SelectorError = 'url' | 'external' | 'path' | 'query'

export type SelectorInput =
  | { kind: 'url'; value: string }
  | {
      kind: 'path' | 'prefix'
      value: string
      query: 'any' | 'exact'
      queryValue?: string
      /** Literal when left out. */
      scope?: SelectorScope
    }

// eslint-disable-next-line no-control-regex -- refusing control characters is the point
const CONTROL = /[\u0000-\u001f\u007f]/
/** A host that can never be real, to let the URL parser do the percent-encoding of paths. */
const PARSER_ORIGIN = 'https://selector.invalid'

function stripTrailingSlashes(path: string): string {
  let end = path.length
  while (end > 1 && path.charCodeAt(end - 1) === 47) end--
  return path.slice(0, end)
}

/**
 * A path as the crawler stores it in a URL: percent-encoded by the URL parser, with its case kept
 * and no separator decoded (`%2F` stays `%2F`). `null` if it is not a path: it has to start with
 * `/` and carry no query, fragment, backslash (the URL parser would take it for a slash) or control
 * character.
 */
function normalizePath(input: string): string | null {
  const value = input.trim()
  if (!value.startsWith('/') || value.length > AUDIT_LIMITS.selector) return null
  if (/[?#\\]/.test(value) || CONTROL.test(value)) return null
  try {
    return new URL(`${PARSER_ORIGIN}${value}`).pathname
  } catch {
    return null
  }
}

/**
 * A query as the URL parser serializes it, without the `?`: the form the crawler stores. The order
 * and repetition of parameters are kept, so `a=1&b=2` and `b=2&a=1` stay different, as they are
 * different URLs. The empty query is `''`. `null` if it cannot be one.
 */
function normalizeQuery(input: string): string | null {
  const value = input.startsWith('?') ? input.slice(1) : input
  if (value.length > AUDIT_LIMITS.selector || value.includes('#') || CONTROL.test(value))
    return null
  try {
    return new URL(`${PARSER_ORIGIN}/?${value}`).search.slice(1)
  } catch {
    return null
  }
}

/** The selector a user's input stands for, or why it is not one. */
export function parseAuditSelector(
  input: SelectorInput,
  host: string,
): { ok: true; selector: AuditSelector } | { ok: false; error: SelectorError } {
  if (input.kind === 'url') {
    const value = input.value.trim()
    // A bare path or host is assumed to be HTTPS on the tracked host, as for priority URLs.
    const withScheme = /^[a-z][a-z0-9+.-]*:/i.test(value)
      ? value
      : value.startsWith('/')
        ? `https://${host}${value}`
        : `https://${value}`
    const url = value ? normalizeCrawlUrl(withScheme) : null
    if (!url) return { ok: false, error: 'url' }
    if (!isInternalUrl(url, host)) return { ok: false, error: 'external' }
    return { ok: true, selector: { kind: 'url', url } }
  }

  const path = normalizePath(input.value)
  if (path === null) return { ok: false, error: 'path' }
  let query: QuerySelector = { mode: 'any' }
  if (input.query === 'exact') {
    const value = normalizeQuery(input.queryValue ?? '')
    if (value === null) return { ok: false, error: 'query' }
    query = { mode: 'exact', value }
  }
  return {
    ok: true,
    selector: {
      kind: input.kind,
      path: input.kind === 'prefix' ? stripTrailingSlashes(path) : path,
      query,
      scope: input.scope === 'shared' ? 'shared' : 'literal',
    },
  }
}

/** The reason a user gave, trimmed; `null` when there is none. `undefined` if it is too long. */
export function parseAuditReason(input: string | null | undefined): string | null | undefined {
  const reason = (input ?? '').trim()
  if (reason.length > AUDIT_LIMITS.reason) return undefined
  return reason === '' ? null : reason
}

// --- matching ------------------------------------------------------------------------------------

/** The parts of a normalized URL that selectors look at. `null` if it is not a URL of the domain. */
export interface UrlParts {
  href: string
  pathname: string
  /** As the URL parser serializes it, with the `?`: `''` when there is no query. */
  search: string
  /** The declared language directory the path starts with (`/es`), or `''`. At most one is taken. */
  language: string
  /**
   * The path that `shared` rules look at: the path without its language directory, or as it is when
   * it has none and the domain has pages of its default language without one. `null`: no shared rule
   * can cover this URL. It is for resolving rules only; the URL itself is never changed.
   */
  shared: string | null
}

/** The declared language directory a path starts with, by whole segments and keeping its case. */
function languageOf(pathname: string, languages: LanguageConfig): string {
  for (const prefix of languages.prefixes) {
    if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return prefix
  }
  return ''
}

export function urlPartsOf(
  url: string,
  host: string,
  languages: LanguageConfig = NO_LANGUAGES,
): UrlParts | null {
  let parsed: URL
  try {
    parsed = new URL(url)
  } catch {
    return null
  }
  if (!isInternalUrl(parsed.href, host)) return null
  const { pathname } = parsed
  const language = languageOf(pathname, languages)
  return {
    href: parsed.href,
    pathname,
    search: parsed.search,
    language,
    shared: language
      ? pathname === language
        ? '/'
        : pathname.slice(language.length)
      : languages.unprefixed
        ? pathname
        : null,
  }
}

const queryMatches = (query: QuerySelector, search: string) =>
  query.mode === 'any' || search === (query.value === '' ? '' : `?${query.value}`)

const prefixCovers = (prefix: string, pathname: string) =>
  prefix === '/' || pathname === prefix || pathname.startsWith(`${prefix}/`)

/** The path a selector is compared with: the one of the URL, or the one shared rules look at. */
const pathFor = (selector: AuditSelector & { kind: 'path' | 'prefix' }, parts: UrlParts) =>
  selector.scope === 'shared' ? parts.shared : parts.pathname

/** Whether a selector covers a URL. This defines the semantics; the resolver below is its index. */
export function selectorMatches(selector: AuditSelector, parts: UrlParts): boolean {
  if (selector.kind === 'url') return parts.href === selector.url
  const path = pathFor(selector, parts)
  if (path === null || !queryMatches(selector.query, parts.search)) return false
  return selector.kind === 'path' ? path === selector.path : prefixCovers(selector.path, path)
}

/**
 * How specific a selector is, to compare those that cover the same URL:
 * 1. an exact URL;
 * 2. an exact literal path;
 * 3. an exact path shared between languages;
 * 4. a prefix, the one that covers more of this URL's path first, whether literal or shared (a
 *    shared `/account` covers `/es/account` of `/es/account/orders`);
 * and within the same path or the same extent, a query that is asked for beats one that is ignored,
 * and then a literal selector beats a shared one. So a shared rule for `/cart` and a literal one for
 * `/es/cart` can live together.
 */
type Rank = readonly [tier: number, covered: number, query: number, literal: number]

function rankOf(selector: AuditSelector, parts: UrlParts): Rank {
  if (selector.kind === 'url') return [4, 0, 0, 1]
  const query = selector.query.mode === 'exact' ? 1 : 0
  const shared = selector.scope === 'shared'
  if (selector.kind === 'path') return [shared ? 2 : 3, 0, query, shared ? 0 : 1]
  const covered = (shared ? parts.language.length : 0) + selector.path.length
  return [1, covered, query, shared ? 0 : 1]
}

function compareRank(a: Rank, b: Rank): number {
  return a[0] - b[0] || a[1] - b[1] || a[2] - b[2] || a[3] - b[3]
}

/**
 * Whether `a` beats `b` for a URL both cover. Equal specificity cannot happen between enabled rules
 * of one dimension (their selectors would be the same one); if it did, the lowest id wins, so the
 * answer never depends on the order the rules came in.
 */
function beats(a: AuditRule, b: AuditRule, parts: UrlParts): boolean {
  const order = compareRank(rankOf(a.selector, parts), rankOf(b.selector, parts))
  return order > 0 || (order === 0 && a.id < b.id)
}

/** The same specificity: only the selector says, never the URL. Used to settle ties while indexing. */
function tie(a: AuditRule, b: AuditRule): boolean {
  return selectorKey(a.selector) === selectorKey(b.selector) && a.id < b.id
}

export interface Resolved<V> {
  value: V
  /** The rule that decided it, or `null` when nothing did and the default applies. */
  rule: AuditRule | null
}

/** What a rule asks of one condition of a URL. `null`: no rule does, and the generic findings apply. */
export interface ResolvedCondition {
  requirement: Requirement | null
  /** The rule that decided it. `null` when nothing did. */
  rule: AuditRule | null
}

export type ResolvedConditions = Record<AuditCondition, ResolvedCondition>

export interface AuditResolution {
  audit: Resolved<AuditParticipation>
  intent: Resolved<RecordedIntent>
  /**
   * Each condition on its own: the most specific rule for that condition decides it, whatever the
   * rules for the others or for the expectation say.
   */
  conditions: ResolvedConditions
}

const noConditions = (): ResolvedConditions => ({
  noindex: { requirement: null, rule: null },
  nofollow: { requirement: null, rule: null },
  robots: { requirement: null, rule: null },
  sitemap: { requirement: null, rule: null },
  canonical: { requirement: null, rule: null },
  unlinked: { requirement: null, rule: null },
})

/** What a URL is when no rule covers it, which is what semantics say. */
export function defaultResolution(semantics: number = AUDIT_SEMANTICS): AuditResolution {
  return {
    audit: { value: 'audited', rule: null },
    intent: { value: semantics >= 2 ? 'indexable' : 'none', rule: null },
    conditions: noConditions(),
  }
}

export interface AuditResolver {
  /** What a normalized URL is, audit-wise and intent-wise. Anything outside the domain is default. */
  resolve(url: string): AuditResolution
  /** The enabled rules that cover a URL, whether or not they decide it, most specific first. */
  covering(url: string): AuditRule[]
}

interface Bucket {
  any: AuditRule | null
  exact: Map<string, AuditRule>
}

interface Found {
  rule: AuditRule
  /** How many characters of the path the matched prefix covers, before the language is added. */
  level: number
}

const newBucket = (): Bucket => ({ any: null, exact: new Map() })

/** The expectation a rule states, if it states one. */
const statedIntent = (rule: AuditRule | null): RecordedIntent | null =>
  rule && rule.dimension === 'intent' && rule.value !== 'inherit' ? rule.value : null

/** What a rule asks of a condition, if it is a rule about one. */
const statedRequirement = (rule: AuditRule | null): Requirement | null =>
  rule && isConditionRule(rule) ? rule.value : null

/** The rules of one dimension, indexed so that a URL is resolved in a few lookups. */
class DimensionIndex {
  private readonly urls = new Map<string, AuditRule>()
  private readonly paths = new Map<string, Bucket>()
  private readonly sharedPaths = new Map<string, Bucket>()
  private readonly prefixes = new Map<string, Bucket>()
  private readonly sharedPrefixes = new Map<string, Bucket>()

  constructor(rules: readonly AuditRule[]) {
    for (const rule of rules) {
      const { selector } = rule
      if (selector.kind === 'url') {
        const current = this.urls.get(selector.url)
        if (!current || tie(rule, current)) this.urls.set(selector.url, rule)
        continue
      }
      const shared = selector.scope === 'shared'
      const buckets =
        selector.kind === 'path'
          ? shared
            ? this.sharedPaths
            : this.paths
          : shared
            ? this.sharedPrefixes
            : this.prefixes
      let bucket = buckets.get(selector.path)
      if (!bucket) buckets.set(selector.path, (bucket = newBucket()))
      if (selector.query.mode === 'any') {
        if (!bucket.any || tie(rule, bucket.any)) bucket.any = rule
      } else {
        const current = bucket.exact.get(selector.query.value)
        if (!current || tie(rule, current)) bucket.exact.set(selector.query.value, rule)
      }
    }
  }

  private static pick(bucket: Bucket | undefined, search: string): AuditRule | null {
    if (!bucket) return null
    return bucket.exact.get(search.slice(1)) ?? bucket.any
  }

  /** The longest prefix of a path that has a rule for this query, going up one segment at a time. */
  private static scan(
    buckets: ReadonlyMap<string, Bucket>,
    pathname: string,
    search: string,
  ): Found | null {
    if (buckets.size === 0) return null
    let path = stripTrailingSlashes(pathname)
    for (;;) {
      const rule = DimensionIndex.pick(buckets.get(path), search)
      if (rule) return { rule, level: path.length }
      if (path === '/' || path === '') return null
      const cut = path.lastIndexOf('/')
      path = cut <= 0 ? '/' : path.slice(0, cut)
    }
  }

  find(parts: UrlParts): AuditRule | null {
    const byUrl = this.urls.get(parts.href)
    if (byUrl) return byUrl
    const byPath = DimensionIndex.pick(this.paths.get(parts.pathname), parts.search)
    if (byPath) return byPath
    if (parts.shared !== null) {
      const bySharedPath = DimensionIndex.pick(this.sharedPaths.get(parts.shared), parts.search)
      if (bySharedPath) return bySharedPath
    }
    // The best of each scope, then the one that covers more of this URL's path.
    const literal = DimensionIndex.scan(this.prefixes, parts.pathname, parts.search)
    const shared =
      parts.shared === null
        ? null
        : DimensionIndex.scan(this.sharedPrefixes, parts.shared, parts.search)
    if (!literal || !shared) return (literal ?? shared)?.rule ?? null
    return beats(shared.rule, literal.rule, parts) ? shared.rule : literal.rule
  }
}

export interface CompileOptions {
  /** The language directories of the domain. None when left out. */
  languages?: LanguageConfig
  /** What the rules mean: `AUDIT_SEMANTICS` when left out. */
  semantics?: number
}

/**
 * Compiles the rules of a domain. Disabled rules are ignored. Resolution is deterministic and the
 * same wherever it runs: preview, worker and pages.
 *
 * Precedence, for each dimension on its own, is that of `rankOf`: an exact URL, an exact literal
 * path, an exact path shared between languages, then the prefix that covers more of the URL's path
 * (a literal one wins a tie), and finally the default. A rule that asks for the URL's query beats one
 * that ignores it.
 *
 * Every condition is resolved like that on its own, so a rule about one never decides another one,
 * and a URL can take `noindex` from a broad rule and `sitemap` from an exception.
 *
 * `semantics` is what the configuration meant when it was made. Under 2 there are no condition
 * rules, and accepting the page's `nofollow` hangs off the intent rule that wins (read here as the
 * `nofollow` condition being `allowed`); under 1, nothing was expected by default, a rule could say
 * `none`, and neither shared selectors nor accepting `nofollow` existed.
 */
export function compileAuditRules(
  rules: readonly AuditRule[],
  host: string,
  options: CompileOptions = {},
): AuditResolver {
  const semantics = options.semantics ?? AUDIT_SEMANTICS
  const languages = canonicalLanguages(options.languages ?? NO_LANGUAGES)
  const usable = (rule: AuditRule) => {
    if (isConditionRule(rule)) return semantics >= 3
    if (rule.dimension === 'intent') {
      if (rule.value === 'none') return semantics < 2
      if (rule.value === 'inherit') return semantics === 2
    }
    return semantics >= 2 || rule.selector.kind === 'url' || rule.selector.scope !== 'shared'
  }
  const enabled = rules.filter((rule) => rule.enabled && usable(rule))
  const audit = new DimensionIndex(enabled.filter((rule) => rule.dimension === 'audit'))
  const intentRules = enabled.filter((rule) => rule.dimension === 'intent')
  const intent = new DimensionIndex(intentRules.filter((rule) => rule.value !== 'inherit'))
  // Semantics 2: every intent rule said whether it accepts `nofollow`, so the most specific one decides
  // it, and one that only accepts it (`inherit`) decides it alone.
  const legacyAccepting =
    semantics === 2
      ? intentRules.some((rule) => rule.value === 'inherit')
        ? new DimensionIndex(intentRules)
        : intent
      : null
  const byCondition = new Map(
    AUDIT_CONDITIONS.map((condition) => [
      condition,
      new DimensionIndex(enabled.filter((rule) => rule.dimension === condition)),
    ]),
  )
  const fallback = defaultResolution(semantics)
  return {
    resolve(url) {
      const parts = urlPartsOf(url, host, languages)
      if (!parts) return fallback
      const byAudit = audit.find(parts)
      const byIntent = intent.find(parts)
      const conditions = noConditions()
      for (const condition of AUDIT_CONDITIONS) {
        const rule = byCondition.get(condition)?.find(parts) ?? null
        if (rule) conditions[condition] = { requirement: statedRequirement(rule), rule }
      }
      if (legacyAccepting) {
        const decided = legacyAccepting === intent ? byIntent : legacyAccepting.find(parts)
        if (decided && decided.dimension === 'intent' && decided.acceptNofollow) {
          conditions.nofollow = { requirement: 'allowed', rule: decided }
        }
      }
      return {
        audit: byAudit
          ? { value: byAudit.value === 'exclude' ? 'excluded' : 'audited', rule: byAudit }
          : fallback.audit,
        intent: { value: statedIntent(byIntent) ?? fallback.intent.value, rule: byIntent },
        conditions,
      }
    },
    covering(url) {
      const parts = urlPartsOf(url, host, languages)
      if (!parts) return []
      return enabled
        .filter((rule) => selectorMatches(rule.selector, parts))
        .sort((a, b) => (beats(a, b, parts) ? -1 : 1))
    },
  }
}

// --- the configuration an analysis used ------------------------------------------------------------

const querySchema = z.discriminatedUnion('mode', [
  z.object({ mode: z.literal('any') }),
  z.object({ mode: z.literal('exact'), value: z.string() }),
])

// What was stored before scopes existed has none, and was literal.
const scopeSchema = z.enum(SELECTOR_SCOPES).default('literal')

const selectorSchema = z.discriminatedUnion('kind', [
  z.object({ kind: z.literal('url'), url: z.string() }),
  z.object({
    kind: z.literal('path'),
    path: z.string(),
    query: querySchema,
    scope: scopeSchema,
  }),
  z.object({
    kind: z.literal('prefix'),
    path: z.string(),
    query: querySchema,
    scope: scopeSchema,
  }),
])

const ruleBase = {
  set: z.string().nullable().optional(),
  id: z.string(),
  selector: selectorSchema,
  reason: z.string().nullable(),
  enabled: z.boolean(),
}

const ruleSchema = z.discriminatedUnion('dimension', [
  z.object({ ...ruleBase, dimension: z.literal('audit'), value: z.enum(AUDIT_VALUES) }),
  z.object({
    ...ruleBase,
    dimension: z.literal('intent'),
    // `none` is what rules said before it was retired.
    value: z.enum(['none', 'inherit', ...INDEX_INTENTS]),
    acceptNofollow: z.boolean().default(false),
  }),
  z.object({ ...ruleBase, dimension: z.enum(AUDIT_CONDITIONS), value: z.enum(REQUIREMENTS) }),
])

/**
 * The configuration of a domain at one version: what it takes to resolve every URL as it was. Every
 * analysis keeps the one it was made with, so that it can be read, and made again, as it was.
 */
export interface FindingDismissal {
  /** Absent only in snapshots written before attribution was recorded. */
  setBy?: string | null
  setAt?: string
  id: string
  issue: string
  urlHash: string | null
  state: 'dismissed' | 'pending'
}

export interface AuditSnapshot {
  dismissals?: FindingDismissal[]
  /** Grows with every change to the rules of the domain. `0`: never configured. */
  version: number
  /** Enabled rules only. */
  rules: AuditRule[]
  /** What the configuration meant (`AUDIT_SEMANTICS`). Absent in what was stored before it: 1. */
  semantics?: number
  /** The language directories shared rules looked at. Absent: there were none. */
  languages?: LanguageConfig
  /** The figures the checks compared with, where they differed from the defaults. Absent: none did. */
  thresholds?: ThresholdOverrides
  /** Present only for rendered crawls; changes the comparison scope of site-dependent findings. */
  rendering?: 'rendered'
  documentBasis?: 'rendered-v1'
  documentCoverage?: {
    complete: number
    redirected: number
    unobserved: number
    legacyMissing: number
  }
  /** Pages without a whole, settled render and whole served HTML; link absence is unknown. */
  rendersUnobserved?: number
  /** Counts can overlap; failedOrMissing includes legacy renders without truncation metadata. */
  renderCoverage?: { failedOrMissing: number; truncated: number; unsettled: number }
  /**
   * Issues this analysis could not see, sorted: their input was not recorded for some page, because
   * the crawl was made before a check could read it (`unobservedIssues`, in the worker). Absent: none,
   * as in every snapshot stored before this. It describes what the crawl kept, not a configuration:
   * `auditScopeKey` never reads it, and a comparison reads those issues as unknown (`unobserved`).
   */
  unobserved?: string[]
}

/**
 * The configuration of an analysis made before configuration existed: no rules, and the meaning
 * that had then. Never use it as the configuration of a new analysis.
 */
export const EMPTY_AUDIT_SNAPSHOT: AuditSnapshot = { version: 0, rules: [] }

export const semanticsOf = (snapshot: Pick<AuditSnapshot, 'semantics'>) => snapshot.semantics ?? 1

const snapshotSchema = z.object({
  version: z.number().int().min(0),
  rules: z.array(ruleSchema),
  semantics: z.number().int().min(1).optional(),
  languages: z.object({ prefixes: z.array(z.string()), unprefixed: z.boolean() }).optional(),
  thresholds: thresholdOverridesSchema.optional(),
  rendering: z.literal('rendered').optional(),
  documentBasis: z.literal('rendered-v1').optional(),
  documentCoverage: z
    .object({
      complete: z.number().int().min(0),
      redirected: z.number().int().min(0),
      unobserved: z.number().int().min(0),
      legacyMissing: z.number().int().min(0),
    })
    .optional(),
  rendersUnobserved: z.number().int().min(0).optional(),
  renderCoverage: z
    .object({
      failedOrMissing: z.number().int().min(0),
      truncated: z.number().int().min(0),
      unsettled: z.number().int().min(0),
    })
    .optional(),
  unobserved: z.array(z.string()).optional(),
  dismissals: z
    .array(
      z.object({
        id: z.string(),
        issue: z.string(),
        urlHash: z.string().nullable(),
        state: z.enum(['dismissed', 'pending']),
        setBy: z.string().nullable().optional(),
        setAt: z.string().datetime().optional(),
      }),
    )
    .optional(),
})

/** The configuration in force now: what a new analysis, and a recalculation, use. */
export function auditSnapshotOf(
  version: number,
  rules: readonly AuditRule[],
  languages: LanguageConfig = NO_LANGUAGES,
  thresholds?: ThresholdOverrides,
  states: readonly {
    id: string
    issue: string
    urlHash: string | null
    state: string
    setBy?: string | null
    setAt?: Date
  }[] = [],
): AuditSnapshot {
  const figures = canonicalThresholds(thresholds)
  const dismissals = findingDismissalsOf(states)
  return {
    ...(dismissals.length ? { dismissals } : {}),
    version,
    semantics: AUDIT_SEMANTICS,
    languages: canonicalLanguages(languages),
    ...(Object.keys(figures).length > 0 ? { thresholds: figures } : {}),
    rules: rules
      .filter((rule) => rule.enabled)
      .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)),
  }
}

/** What resolves a URL the way the analysis that kept this snapshot did. */
export function compileAuditSnapshot(snapshot: AuditSnapshot, host: string): AuditResolver {
  return compileAuditRules(snapshot.rules, host, {
    ...(snapshot.languages ? { languages: snapshot.languages } : {}),
    semantics: semanticsOf(snapshot),
  })
}

export const serializeAuditSnapshot = (snapshot: AuditSnapshot) => JSON.stringify(snapshot)

/** What was stored, or `null` when there is nothing or it is not a snapshot. */
export function parseAuditSnapshot(raw: string | null): AuditSnapshot | null {
  if (raw === null) return null
  try {
    const parsed = snapshotSchema.safeParse(JSON.parse(raw))
    return parsed.success ? (parsed.data as AuditSnapshot) : null
  } catch {
    return null
  }
}

// --- expectation against observation ---------------------------------------------------------------

/**
 * How what is expected of a URL compares with what the crawl saw of it. It is about the crawl, never
 * about the index: no outcome says a search engine has, or has not, indexed anything.
 * - `none`: nothing was declared, which only analyses from before semantics 2 can say.
 * - `met`: the crawl saw what was expected.
 * - `robots-only`: expected not to be indexable, and the only thing in the way is robots.txt. That
 *   keeps crawlers from reading the page but not from listing the URL, so it proves nothing.
 * - `unmet`: the crawl saw the opposite.
 * - `unknown`: there is not enough data to say (not requested, request failed, not a page). Never
 *   read as `met`.
 */
export type IntentOutcome = 'none' | 'met' | 'robots-only' | 'unmet' | 'unknown'

export function intentOutcome(
  intent: RecordedIntent,
  indexability: 'indexable' | 'not-indexable' | 'unknown',
  blockers: readonly string[] = [],
): IntentOutcome {
  if (intent === 'none') return 'none'
  if (indexability === 'unknown') return 'unknown'
  if (intent === 'indexable') return indexability === 'indexable' ? 'met' : 'unmet'
  if (indexability === 'indexable') return 'unmet'
  return blockers.length > 0 && blockers.every((blocker) => blocker === 'robots')
    ? 'robots-only'
    : 'met'
}

/** Why the results of a crawl may not say what the configuration says. */
export type AuditResultsState =
  | { kind: 'none' }
  | { kind: 'unanalysed' }
  | { kind: 'current' }
  | { kind: 'pending' }
  | { kind: 'failed'; message: string }

/**
 * Whether the analysis of a crawl reflects the configuration in force. A crawl analysed with an
 * older version is not shown as if it were up to date: it is pending, or its recalculation failed.
 */
export function auditResultsState(
  crawl: { pagesByWorstIssue: unknown; auditVersion: number | null } | null,
  config: { version: number; recomputeError: { message: string } | null },
): AuditResultsState {
  if (!crawl) return { kind: 'none' }
  const behind = (crawl.auditVersion ?? 0) < config.version
  if (behind) {
    return config.recomputeError
      ? { kind: 'failed', message: config.recomputeError.message }
      : { kind: 'pending' }
  }
  return crawl.pagesByWorstIssue === null ? { kind: 'unanalysed' } : { kind: 'current' }
}

// --- what an analysis stores per URL and per crawl ---------------------------------------------------

/** How a crawl's pages split by audit participation and technical indexability. */
export interface PagesAudit {
  /** The pages the crawl found: audited and excluded. */
  audited: number
  excluded: number
  /** Over every page, excluded or not: indexability is a fact about the page, not about the audit. */
  indexable: number
  notIndexable: number
  /** Pages the crawl has too little data on to say: not requested, or the request failed. */
  unknownIndexability: number
}

/**
 * What the crawl saw of a condition on a URL.
 * - `present` / `absent`: the crawl could tell. Absence is only claimed when the input was complete
 *   (a page parsed whole, a robots.txt that answered, every sitemap read).
 * - `unknown`: it could not (not requested, a request that failed, a file that could not be read, not
 *   a page). Never read as the requirement being met or missed.
 */
export type ConditionObservation = 'present' | 'absent' | 'unknown'

/** A condition a rule stated for a URL, with what the crawl saw. */
export interface ConditionState {
  requirement: Requirement
  /** The rule that decided it. `null` only for what an analysis of semantics 2 kept without one. */
  rule: string | null
  /** `null`: not looked at by this analysis (a recheck cannot read the sitemaps). */
  observed: ConditionObservation | null
}

/** The conditions that a rule stated for a URL. A condition no rule states is not here. */
export type ConditionStates = Partial<Record<AuditCondition, ConditionState>>

/** What an analysis concluded about one URL of the site. */
export interface UrlAuditState {
  /** Absent on HTML and legacy analyses. Unknown input is retained per URL. */
  documentObservation?: 'complete' | 'redirected' | 'unobserved'
  documentUnobserved?: string[]
  participation: AuditParticipation
  /** The rule that decided it. `null`: the default. */
  participationRule: string | null
  /** What was expected. With no rule it is `indexable`, except in analyses from before semantics 2. */
  intent: RecordedIntent
  /** The rule that decided it. `null`: the default. */
  intentRule: string | null
  /** The conditions a rule stated, each with the rule that did and what the crawl saw. */
  conditions: ConditionStates
  indexability: 'indexable' | 'not-indexable' | 'unknown'
  /** What stands in the way when it is not indexable. */
  blockers: string[]
}

/**
 * A state as an older analysis stored it: before conditions, the page's own `nofollow` was accepted
 * by the rule that decided the expectation (`acceptNofollow`). That is the `nofollow` condition being
 * `allowed`. Use it for anything that was stored (rows, the outcome of a recheck), never for a new
 * analysis.
 */
export function readUrlAuditState<
  T extends Omit<UrlAuditState, 'conditions'> & {
    conditions?: ConditionStates | null
    acceptNofollow?: boolean
  },
>(stored: T): Omit<T, 'acceptNofollow' | 'conditions'> & { conditions: ConditionStates } {
  const { acceptNofollow, conditions, ...rest } = stored
  const read: ConditionStates = { ...conditions }
  if (acceptNofollow && !read.nofollow) {
    read.nofollow = { requirement: 'allowed', rule: stored.intentRule, observed: null }
  }
  return { ...rest, conditions: read }
}

/**
 * Whether what a rule asked of a condition came true.
 * - `unknown` when the crawl could not tell, or did not look.
 * - `allowed` when the rule asks for nothing either way.
 * - `met` / `unmet` against `required` and `forbidden`.
 */
export type ConditionOutcome = 'met' | 'unmet' | 'allowed' | 'unknown'

export function conditionOutcome(
  requirement: Requirement,
  observed: ConditionObservation | null,
): ConditionOutcome {
  if (requirement === 'allowed') return 'allowed'
  if (observed === null || observed === 'unknown') return 'unknown'
  const wanted = requirement === 'required' ? 'present' : 'absent'
  return observed === wanted ? 'met' : 'unmet'
}

/** The conditions of a URL as one stable string: what has to match for two analyses to be comparable. */
export function conditionsKey(conditions: ConditionStates): string {
  return AUDIT_CONDITIONS.flatMap((condition) => {
    const state = conditions[condition]
    return state ? [`${condition}=${state.requirement}`] : []
  }).join(',')
}

/** New path rules share declared language directories unless none have been declared. */
export const defaultScope = (languages: LanguageConfig): SelectorScope =>
  languages.prefixes.length > 0 ? 'shared' : 'literal'

export type InheritedSource =
  { source: 'default' } | { source: 'rule'; key: string; selector: AuditSelector }

export interface InheritedStatement {
  value: AuditParticipation | RecordedIntent | Requirement | null
  from: InheritedSource
}

/**
 * What each selector inherits when the edited rule says nothing. Resolution, including language
 * scopes, is delegated to the same compiler as the worker. Shared selectors use a declared
 * language directory (or the unprefixed path when enabled) as their representative address.
 */
export function inheritedStatements(input: {
  selectors: readonly AuditSelector[]
  ids: readonly string[]
  set?: string | null
  rules: readonly AuditRule[]
  host: string
  languages: LanguageConfig
}): { selector: AuditSelector; statements: Record<AuditDimension, InheritedStatement> }[] {
  const resolver = compileAuditRules(
    input.rules.filter(
      (rule) => !input.ids.includes(rule.id) && (!input.set || rule.set !== input.set),
    ),
    input.host,
    { languages: input.languages },
  )
  const inherited = (
    value: InheritedStatement['value'],
    rule: AuditRule | null,
  ): InheritedStatement => ({
    value,
    from: rule
      ? { source: 'rule', key: rule.set ?? selectorKey(rule.selector), selector: rule.selector }
      : { source: 'default' },
  })
  return input.selectors.map((selector) => {
    let url: string
    if (selector.kind === 'url') url = selector.url
    else {
      const language =
        selector.scope === 'shared' && !input.languages.unprefixed
          ? (canonicalLanguages(input.languages).prefixes[0] ?? '')
          : ''
      const query = selector.query.mode === 'exact' ? selector.query.value : ''
      url = `https://${input.host}${language}${selector.path}${query ? `?${query}` : ''}`
    }
    const result = resolver.resolve(url)
    return {
      selector,
      statements: {
        audit: inherited(result.audit.value, result.audit.rule),
        intent: inherited(result.intent.value, result.intent.rule),
        ...Object.fromEntries(
          AUDIT_CONDITIONS.map((condition) => [
            condition,
            inherited(result.conditions[condition].requirement, result.conditions[condition].rule),
          ]),
        ),
      } as Record<AuditDimension, InheritedStatement>,
    }
  })
}

/**
 * The rows of `audit_rules` as the settings page shows them: one rule per set (or legacy selector), with the
 * statements it makes. A statement is a row of its own on each selector; grouping does not affect resolution.
 */
export interface RuleGroup<R extends AuditRule = AuditRule> {
  /** What identifies the selector. */
  key: string
  selector: AuditSelector
  selectors: AuditSelector[]
  /** The row that acts for each statement the rule makes: the enabled one, or the first. */
  statements: Partial<Record<AuditDimension, R>>
  /** Every row of the rule, to turn them on, off or away together. */
  ids: string[]
  /** Every row that acts is enabled. A rule with some rows off (from before rules were edited as one) is off. */
  enabled: boolean
  reason: string | null
}

export function groupRules<R extends AuditRule>(rules: readonly R[]): RuleGroup<R>[] {
  const groups = new Map<string, RuleGroup<R>>()
  for (const rule of rules) {
    const key = rule.set ?? selectorKey(rule.selector)
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        selector: rule.selector,
        selectors: [],
        statements: {},
        ids: [],
        enabled: true,
        reason: null,
      }
      groups.set(key, group)
    }
    if (!group.selectors.some((s) => selectorKey(s) === selectorKey(rule.selector)))
      group.selectors.push(rule.selector)
    group.ids.push(rule.id)
    const statement = rule.dimension as AuditDimension
    const current = group.statements[statement]
    // A disabled duplicate never takes the place of the row that acts.
    if (!current || (!current.enabled && rule.enabled)) group.statements[statement] = rule
  }
  for (const group of groups.values()) {
    const acting = Object.values(group.statements)
    group.enabled = acting.length > 0 && acting.every((rule) => rule.enabled)
    group.reason = acting.find((rule) => rule.reason !== null)?.reason ?? null
  }
  return [...groups.values()]
}

/** Only decisions that affect pending findings; progress is a label, with a pending URL override. */
export function findingDismissalsOf(
  states: readonly {
    id: string
    issue: string
    urlHash: string | null
    state: string
    setBy?: string | null
    setAt?: Date
  }[],
): FindingDismissal[] {
  const domain = new Set(
    states.filter((r) => r.urlHash === null && r.state === 'dismissed').map((r) => r.issue),
  )
  return states
    .flatMap((row): FindingDismissal[] => {
      if (row.issue.startsWith('expected-')) return []
      if (row.state === 'dismissed')
        return [
          {
            id: row.id,
            issue: row.issue,
            urlHash: row.urlHash,
            state: 'dismissed',
            ...(row.setBy !== undefined ? { setBy: row.setBy } : {}),
            ...(row.setAt ? { setAt: row.setAt.toISOString() } : {}),
          },
        ]
      if (row.urlHash !== null && domain.has(row.issue))
        return [{ id: row.id, issue: row.issue, urlHash: row.urlHash, state: 'pending' }]
      return []
    })
    .sort(
      (a, b) =>
        a.issue.localeCompare(b.issue) || (a.urlHash ?? '*').localeCompare(b.urlHash ?? '*'),
    )
}
