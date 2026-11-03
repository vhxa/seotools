/**
 * What takes part in the audit and what a URL is expected to be, decided by rules and exceptions per
 * domain. Two independent dimensions, each resolved on its own:
 * - `audit`: a URL is audited (the default) or excluded: it is still crawled and its data is kept,
 *   but it has no findings of its own.
 * - `intent`: what the user expects of its indexation. It is a statement of intent, never evidence
 *   that a search engine indexed (or did not index) anything.
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
import { z } from 'zod'
import { isInternalUrl, normalizeCrawlUrl } from './normalize'

export const AUDIT_DIMENSIONS = ['audit', 'intent'] as const
export type AuditDimension = (typeof AUDIT_DIMENSIONS)[number]

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
 */
export const AUDIT_SEMANTICS = 2

/** What a URL can be expected to be, which is what a rule or an exception can say. */
export const INDEX_INTENTS = ['indexable', 'not-indexable'] as const
export type IndexIntent = (typeof INDEX_INTENTS)[number]

/**
 * An expectation as an analysis stored it. `none` (no declared intent) only exists in analyses and
 * snapshots from before semantics 2, and is never offered for a new configuration.
 */
export type RecordedIntent = IndexIntent | 'none'

/**
 * What an intent rule says about the expectation. An exception on one URL can also say `inherit`:
 * the expectation is left to the other rules, and the exception only says whether the page's own
 * `nofollow` is accepted. That way accepting `nofollow` never pins the expectation the URL had when
 * it was done.
 */
export type IntentRuleValue = RecordedIntent | 'inherit'

export const AUDIT_PARTICIPATIONS = ['audited', 'excluded'] as const
export type AuditParticipation = (typeof AUDIT_PARTICIPATIONS)[number]

export const AUDIT_LIMITS = {
  /** Characters of the reason a rule is given. */
  reason: 500,
  /** Characters of a path or a query typed into a selector. */
  selector: 2048,
  /** Rules a domain can have, enabled or not: the analysis of a crawl keeps a copy of them. */
  rulesPerDomain: 200,
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
       * The page's own `nofollow` is accepted as intended: its generic finding is not raised. It says
       * nothing about `noindex`, and does not need a `nofollow` to be there. Every intent rule says
       * it, so the rule that wins decides it; only a rule with the value `inherit` leaves the
       * expectation to another one, and decides this alone.
       */
      acceptNofollow: boolean
    })

type DistributiveOmit<T, K extends PropertyKey> = T extends unknown ? Omit<T, K> : never

/** What it takes to create a rule: the rest is given when it is stored. */
export type NewAuditRule = DistributiveOmit<AuditRule, 'id'>

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

export interface AuditResolution {
  audit: Resolved<AuditParticipation>
  intent: Resolved<RecordedIntent> & {
    /** The page's own `nofollow` is accepted. */
    acceptNofollow: boolean
    /**
     * The rule that decided it: the one that decides the intent, unless an exception that leaves the
     * intent to others says about `nofollow`. `null` when nothing did.
     */
    acceptRule: AuditRule | null
  }
}

/** What a URL is when no rule covers it, which is what semantics say. */
export function defaultResolution(semantics: number = AUDIT_SEMANTICS): AuditResolution {
  return {
    audit: { value: 'audited', rule: null },
    intent: {
      value: semantics >= 2 ? 'indexable' : 'none',
      rule: null,
      acceptNofollow: false,
      acceptRule: null,
    },
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
 * `semantics` is what the configuration meant when it was made. Under 2, nothing was expected by
 * default, a rule could say `none`, and neither shared selectors nor accepting `nofollow` existed.
 */
export function compileAuditRules(
  rules: readonly AuditRule[],
  host: string,
  options: CompileOptions = {},
): AuditResolver {
  const semantics = options.semantics ?? AUDIT_SEMANTICS
  const languages = canonicalLanguages(options.languages ?? NO_LANGUAGES)
  const enabled = rules.filter(
    (rule) =>
      rule.enabled &&
      (semantics >= 2
        ? !(rule.dimension === 'intent' && rule.value === 'none')
        : (rule.selector.kind === 'url' || rule.selector.scope !== 'shared') &&
          !(rule.dimension === 'intent' && rule.value === 'inherit')),
  )
  const audit = new DimensionIndex(enabled.filter((rule) => rule.dimension === 'audit'))
  const intentRules = enabled.filter((rule) => rule.dimension === 'intent')
  // The expectation is decided by the rules that state one; `nofollow`, by every intent rule, since
  // each says it. They are the same rules unless an exception leaves the expectation to others.
  const intent = new DimensionIndex(intentRules.filter((rule) => rule.value !== 'inherit'))
  const nofollow = intentRules.some((rule) => rule.value === 'inherit')
    ? new DimensionIndex(intentRules)
    : intent
  const fallback = defaultResolution(semantics)
  return {
    resolve(url) {
      const parts = urlPartsOf(url, host, languages)
      if (!parts) return fallback
      const byAudit = audit.find(parts)
      const byIntent = intent.find(parts)
      const byNofollow = nofollow === intent ? byIntent : nofollow.find(parts)
      const accepting = byNofollow && byNofollow.dimension === 'intent' ? byNofollow : null
      return {
        audit: byAudit
          ? { value: byAudit.value === 'exclude' ? 'excluded' : 'audited', rule: byAudit }
          : fallback.audit,
        intent: {
          value: statedIntent(byIntent) ?? fallback.intent.value,
          rule: byIntent,
          acceptNofollow: semantics >= 2 && accepting !== null && accepting.acceptNofollow,
          acceptRule: semantics >= 2 ? accepting : null,
        },
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
])

/**
 * The configuration of a domain at one version: what it takes to resolve every URL as it was. Every
 * analysis keeps the one it was made with, so that it can be read, and made again, as it was.
 */
export interface AuditSnapshot {
  /** Grows with every change to the rules of the domain. `0`: never configured. */
  version: number
  /** Enabled rules only. */
  rules: AuditRule[]
  /** What the configuration meant (`AUDIT_SEMANTICS`). Absent in what was stored before it: 1. */
  semantics?: number
  /** The language directories shared rules looked at. Absent: there were none. */
  languages?: LanguageConfig
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
})

/** The configuration in force now: what a new analysis, and a recalculation, use. */
export function auditSnapshotOf(
  version: number,
  rules: readonly AuditRule[],
  languages: LanguageConfig = NO_LANGUAGES,
): AuditSnapshot {
  return {
    version,
    semantics: AUDIT_SEMANTICS,
    languages: canonicalLanguages(languages),
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

/** What an analysis concluded about one URL of the site. */
export interface UrlAuditState {
  participation: AuditParticipation
  /** The rule that decided it. `null`: the default. */
  participationRule: string | null
  /** What was expected. With no rule it is `indexable`, except in analyses from before semantics 2. */
  intent: RecordedIntent
  /** The rule that decided it. `null`: the default. */
  intentRule: string | null
  /** The page's own `nofollow` was accepted, by the rule that decided the intent. */
  acceptNofollow: boolean
  indexability: 'indexable' | 'not-indexable' | 'unknown'
  /** What stands in the way when it is not indexable. */
  blockers: string[]
}
