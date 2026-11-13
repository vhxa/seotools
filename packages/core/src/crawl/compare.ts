/**
 * Reading several retained full crawls of a domain side by side: what each one saw of a URL, what
 * changed between two of them, and which of those changes the evidence lets us call by name.
 *
 * Everything here is pure (no Node imports, no database): the server pages and the tests share it,
 * and client components may import it through `@seotools/core/crawl/compare`.
 *
 * The rule that runs through all of it: a difference between two crawls is a fact, but the reason for
 * it is not always. A URL missing from the later crawl may have been deleted, or may simply not have
 * been reached before the crawl ran out of URL budget; a finding that stopped being reported may have
 * been fixed, or may have gone because the audit rules, the issue catalog, or the crawl itself
 * changed. We only say "new", "resolved" or "reappeared" when nothing but the site itself can
 * explain the difference. Otherwise the change is reported as `unverified`, with the reasons.
 */
import {
  EMPTY_AUDIT_SNAPSHOT,
  NO_LANGUAGES,
  canonicalLanguages,
  conditionsKey,
  reachesRelations,
  selectorKey,
  semanticsOf,
  type AuditParticipation,
  type AuditSnapshot,
  type ConditionStates,
  type RecordedIntent,
} from './audit'
import {
  canonicalThresholds,
  resolveThresholds,
  THRESHOLD_ISSUES,
  type AuditThresholds,
} from './thresholds'
import { compareIssueSeverity, isPageIssueId, type PageIssueId } from './issues'
import type { CrawlStatus, CrawlUrlKind, CrawlUrlState } from './types'

// --- what is compared per URL ----------------------------------------------------------------------

/**
 * How two crawls differ at a URL, or whether they have it at all.
 * - `added`: the later crawl has the URL and the earlier one does not.
 * - `missing`: the earlier crawl has it and the later one does not. Never "deleted": see above.
 * - `status`, `title`, `canonical`, `robots`: both crawls requested it and it answered differently.
 * - `gained`, `lost`: both requested it and the findings reported for it differ: some are reported
 *   by the later crawl only (`gained`) or by the earlier one only (`lost`). What each means is for
 *   `classifyFindings` to say.
 */
export const CRAWL_CHANGES = [
  'added',
  'missing',
  'status',
  'title',
  'canonical',
  'robots',
  'gained',
  'lost',
] as const
export type CrawlChange = (typeof CRAWL_CHANGES)[number]

/** The changes of an answer: what a URL looked like to the crawler, apart from its findings. */
export const FIELD_CHANGES = ['status', 'title', 'canonical', 'robots'] as const
export type FieldChange = (typeof FIELD_CHANGES)[number]

/** `pages`: URLs that are pages. `other`: the rest of the site (redirects, resources, failures). */
export const COMPARE_VIEWS = ['pages', 'other'] as const
export type CompareView = (typeof COMPARE_VIEWS)[number]

/** What a crawl recorded of an internal URL, the part comparisons look at. */
export interface UrlSnapshot {
  state: CrawlUrlState
  kind: CrawlUrlKind
  statusCode: number | null
  redirectTo: string | null
  title: string | null
  canonical: string | null
  metaRobots: string | null
  xRobotsTag: string | null
  error: string | null
  depth: number
}

/**
 * Which parts of an answer differ. Only meaningful when both crawls requested the URL: a URL that
 * one crawl found but did not request has no answer to compare. Exact comparison, nothing is
 * normalized: it must agree with what the database filters by.
 */
export function fieldChanges(base: UrlSnapshot, target: UrlSnapshot): FieldChange[] {
  if (base.state !== 'done' || target.state !== 'done') return []
  const changes: FieldChange[] = []
  if (
    base.statusCode !== target.statusCode ||
    base.kind !== target.kind ||
    base.redirectTo !== target.redirectTo
  ) {
    changes.push('status')
  }
  if (base.title !== target.title) changes.push('title')
  if (base.canonical !== target.canonical) changes.push('canonical')
  if (base.metaRobots !== target.metaRobots || base.xRobotsTag !== target.xRobotsTag) {
    changes.push('robots')
  }
  return changes
}

// --- what a crawl can vouch for ---------------------------------------------------------------------

/** What this module needs of a crawl; `Crawl` in `@seotools/db` satisfies it. */
export interface CrawlLike {
  ignoredParameters?: string[]
  id: string
  status: CrawlStatus
  createdAt: Date
  finishedAt: Date | null
  /** The results per URL were removed by retention. */
  pruned: boolean
  /** Pruned, but what each URL was (answer, findings, audit state) is kept in the compact history. */
  history?: boolean
  /** `null`: the crawl was never analysed, so it has no findings. */
  pagesByWorstIssue: unknown
  /** `null`: analysed before what was concluded about each URL was kept. */
  pagesAudit: unknown
  issueCatalog: string | null
  auditVersion: number | null
  auditSnapshot: AuditSnapshot | null
}

/**
 * Whether a crawl still says what each URL was: its full results, or the compact history that
 * replaces them for a while. Links, evidence and the rest are only in the full results (`!pruned`).
 */
export const keepsUrlHistory = (crawl: Pick<CrawlLike, 'pruned' | 'history'>) =>
  !crawl.pruned || crawl.history === true

/** Crawls that finished with results worth browsing (`completed`, or `incomplete` at the URL limit). */
export const isBrowsableStatus = (status: CrawlStatus) =>
  status === 'completed' || status === 'incomplete'

/**
 * What makes two audit configurations the same: what they mean, the language directories and the
 * rules that were enabled, by what each says rather than by id or reason. A rule deleted and made
 * again, or a version that went up and down, leaves the configuration as it was.
 */
export function auditScopeKey(snapshot: AuditSnapshot): string {
  const rules = snapshot.rules
    .map((rule) =>
      [
        rule.dimension,
        rule.value,
        rule.dimension === 'intent' && rule.acceptNofollow ? 'nofollow' : '',
        selectorKey(rule.selector),
      ].join(' '),
    )
    .sort()
  const thresholds = canonicalThresholds(snapshot.thresholds)
  return JSON.stringify({
    semantics: meaningOf(snapshot),
    languages: canonicalLanguages(snapshot.languages ?? NO_LANGUAGES),
    rules,
    ...(snapshot.rendering === 'rendered' ? { rendering: 'rendered' } : {}),
    // Absent when the defaults applied, so that a key from before thresholds existed is the same.
    ...(Object.keys(thresholds).length > 0 ? { thresholds } : {}),
  })
}

/**
 * What a configuration means, for telling whether two are the same one. Each newer meaning reads a
 * configuration of the one before as it was, as long as it has no rule that the newer one reads
 * another way, so that an upgrade does not make every crawl before it incomparable with the ones
 * after:
 * - 3 reads 2 the same unless a rule accepts `nofollow` through the expectation;
 * - 4 reads 3 the same unless a rule accepts a state that other URLs point at (`reachesRelations`);
 * - 5 reads 4 the same unless it has such a rule: only who accepts it changed.
 */
function meaningOf(snapshot: AuditSnapshot): number {
  let meaning = semanticsOf(snapshot)
  if (
    meaning === 2 &&
    !snapshot.rules.some(
      (rule) => rule.dimension === 'intent' && (rule.acceptNofollow || rule.value === 'inherit'),
    )
  ) {
    meaning = 3
  }
  if (meaning === 3 && !snapshot.rules.some(reachesRelations)) meaning = 4
  if (meaning === 4 && !snapshot.rules.some(reachesRelations)) meaning = 5
  return meaning
}

/**
 * The audit configuration a crawl was analysed with, or `null` when that is not known: it was not
 * analysed, or its snapshot is gone while its version says it had one. A crawl analysed before
 * configuration existed (no version, no snapshot) was analysed with none.
 */
export function crawlAuditScope(crawl: CrawlLike): string | null {
  if (crawl.pagesByWorstIssue === null) return null
  if (crawl.auditSnapshot) return auditScopeKey(crawl.auditSnapshot)
  return crawl.auditVersion === null ? auditScopeKey(EMPTY_AUDIT_SNAPSHOT) : null
}

/** What a crawl can vouch for when its findings are compared with those of another. */
export interface CrawlFacts {
  identity?: string
  /** Its full results per URL are still stored: links, evidence, everything a comparison reads. */
  retained: boolean
  /**
   * What each URL was (answer, findings, audit state) can still be read: its full results or the
   * compact history that replaces them for a while. Enough for the history of a URL, not for a
   * comparison of two crawls.
   */
  observable: boolean
  /** It has findings (it was analysed). */
  analysed: boolean
  /** It requested every URL it found, instead of stopping at the URL limit. */
  complete: boolean
  /** The issue catalog it was analysed with. */
  catalog: string | null
  /** `auditScopeKey` of the configuration it was analysed with. */
  scope: string | null
  /** The analysis kept whether each URL was audited. Without it, nothing says what was left out. */
  perUrlAudit: boolean
  /** The figures it was analysed with (`null` when it was not analysed). */
  thresholds: AuditThresholds | null
  /**
   * The issues whose input it did not record (it was made before a check could read it), so that
   * not reporting them says nothing. Absent: none.
   */
  unobserved?: ReadonlySet<string>
}

export function crawlFactsOf(crawl: CrawlLike): CrawlFacts {
  return {
    identity: JSON.stringify([...new Set(crawl.ignoredParameters ?? [])].sort()),
    retained: !crawl.pruned,
    observable: keepsUrlHistory(crawl),
    analysed: crawl.pagesByWorstIssue !== null,
    complete: crawl.status === 'completed',
    catalog: crawl.issueCatalog,
    scope: crawlAuditScope(crawl),
    perUrlAudit: crawl.pagesAudit !== null,
    // A snapshot without figures used the defaults: they are the values the checks always had.
    thresholds:
      crawl.pagesByWorstIssue === null ? null : resolveThresholds(crawl.auditSnapshot?.thresholds),
    unobserved: new Set(crawl.auditSnapshot?.unobserved),
  }
}

/** Oldest first; the same moment is ordered by id so that the order is always the same. */
export const byAge = (
  a: Pick<CrawlLike, 'id' | 'createdAt'>,
  b: Pick<CrawlLike, 'id' | 'createdAt'>,
) => a.createdAt.getTime() - b.createdAt.getTime() || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)

// --- whether two crawls can be compared at all -----------------------------------------------------

export type PairSide = 'base' | 'target'

/**
 * Why what two crawls show may not be what changed on the site.
 * - `pruned`: the results per URL of a side were removed: only totals can be compared.
 * - `unanalysed`: a side has no findings.
 * - `legacy`: a side was analysed before it kept whether each URL was audited.
 * - `catalog`: they were analysed with different issue catalogs, so a finding that appears or goes
 *   may be a check that changed.
 * - `audit`: they were analysed with different audit configurations: exclusions, expectations or
 *   language directories changed, which can add or remove findings with nothing changing on the site.
 * - `incomplete`: a side stopped at its URL limit: URLs it did not reach are not gone, and findings
 *   that look at other pages are not reliable.
 */
export const PAIR_NOTES = [
  'pruned',
  'ignoredParameters',
  'unanalysed',
  'legacy',
  'catalog',
  'audit',
  'incomplete',
] as const
export type PairNoteCode = (typeof PAIR_NOTES)[number]

export interface PairNote {
  code: PairNoteCode
  /** The sides it is about. `catalog` and `audit` are about the pair, and list both. */
  sides: PairSide[]
}

export interface PairAssessment {
  /** Both sides still have their results per URL: URLs and their answers can be compared. */
  urls: boolean
  /** And both have findings: findings can be compared, with the caveats in `notes`. */
  findings: boolean
  notes: PairNote[]
}

/** Puts two crawls in order, oldest first: the earlier one is the base of a comparison. */
export function orderPair<T extends Pick<CrawlLike, 'id' | 'createdAt'>>(
  a: T,
  b: T,
): { base: T; target: T } {
  return byAge(a, b) <= 0 ? { base: a, target: b } : { base: b, target: a }
}

/** `base` is the earlier crawl and `target` the later one. */
export function assessPair(base: CrawlLike, target: CrawlLike): PairAssessment {
  const facts = { base: crawlFactsOf(base), target: crawlFactsOf(target) }
  const sides = (test: (f: CrawlFacts) => boolean): PairSide[] =>
    (['base', 'target'] as const).filter((side) => test(facts[side]))
  const notes: PairNote[] = []
  const add = (code: PairNoteCode, found: PairSide[]) => {
    if (found.length > 0) notes.push({ code, sides: found })
  }

  const ignoredKey = (crawl: CrawlLike) =>
    JSON.stringify([...new Set(crawl.ignoredParameters ?? [])].sort())
  if (ignoredKey(base) !== ignoredKey(target)) add('ignoredParameters', ['base', 'target'])
  const pruned = sides((f) => !f.retained)
  add('pruned', pruned)
  const urls = pruned.length === 0
  if (!urls) return { urls, findings: false, notes }

  const unanalysed = sides((f) => !f.analysed)
  add('unanalysed', unanalysed)
  add(
    'incomplete',
    sides((f) => !f.complete),
  )
  const findings = unanalysed.length === 0
  if (findings) {
    add(
      'legacy',
      sides((f) => !f.perUrlAudit),
    )
    const { base: b, target: t } = facts
    if (b.catalog === null || t.catalog === null || b.catalog !== t.catalog) {
      add('catalog', ['base', 'target'])
    }
    if (b.scope === null || t.scope === null || b.scope !== t.scope) {
      add('audit', ['base', 'target'])
    }
  }
  return { urls, findings, notes }
}

// --- what findings mean -----------------------------------------------------------------------------

/**
 * Issues that only depend on the URL's own answer (its response, headers and HTML, or its own
 * address). Another URL being left out of the audit, or not being reached because the crawl ran out
 * of budget, cannot make one of them appear or vanish. Anything not listed here may depend on other
 * URLs (duplicates, inbound and outbound links, redirect chains, targets of canonicals and hreflang,
 * sitemaps, click depth, robots.txt) or on when it was analysed (`unavailable-after`), and is
 * treated as such: that is the safe default for an issue added later.
 */
const PAGE_LOCAL_LIST = [
  'text-only-after-rendering',
  'title-only-after-rendering',
  'title-changed-by-javascript',
  'description-only-after-rendering',
  'description-changed-by-javascript',
  'h1-only-after-rendering',
  'h1-changed-by-javascript',
  'canonical-only-after-rendering',
  'canonical-changed-by-javascript',
  'noindex-only-in-html',
  'noindex-added-by-javascript',
  'nofollow-only-in-html',
  'nofollow-added-by-javascript',
  'structured-data-only-after-rendering',
  'hreflang-only-after-rendering',
  'social-tags-only-after-rendering',
  'javascript-redirect',
  'render-resources-blocked-by-robots',
  'render-failed',
  'render-script-errors',

  'html-entities-as-text',
  'few-html-links',
  'no-response',
  'server-error',
  'client-error',
  'soft-404-confirmed',
  'soft-404-possible',
  'refresh-redirect',
  'redirect-3xx',
  'redirect-temporary',
  'slow-response',
  'directive-outside-head',
  'directives-conflict',
  'directives-conflict-snippets',
  'noindex',
  'nofollow',
  // Required directives: the page's own answer, and the conditions its rules state (compared too).
  'noindex-required-missing',
  'nofollow-required-missing',
  'nosnippet',
  'max-snippet-limited',
  'noimageindex',
  'canonical-outside-head',
  'canonical-conflict',
  'canonical-fragment',
  'canonical-missing',
  'canonical-relative',
  'canonical-repeated',
  'title-missing',
  'title-outside-head',
  'title-multiple',
  'title-too-long',
  'title-too-short',
  'description-multiple',
  'description-outside-head',
  'description-missing',
  'description-too-long',
  'description-too-short',
  'h1-missing',
  'h1-multiple',
  'heading-empty',
  'heading-skipped-level',
  'h2-missing',
  'heading-too-long',
  'content-placeholder',
  'content-thin',
  'img-no-alt',
  'img-empty-alt',
  'img-too-heavy',
  'img-no-size',
  'img-long-alt',
  'json-ld-invalid',
  'structured-data-required-missing',
  'structured-data-recommended-missing',
  'no-structured-data',
  'og-missing',
  'og-incomplete',
  'og-url-mismatch',
  'twitter-card-missing',
  'link-to-localhost',
  'uncrawlable-links',
  'anchor-empty',
  'anchor-vague',
  'url-multiple-slashes',
  'url-spaces',
  'url-tracking',
  'url-uppercase',
  'url-repetitive-path',
  'url-internal-search',
  'url-underscores',
  'url-too-long',
  'http-url',
  'mixed-content',
  'insecure-form',
  'missing-security-header',
  'unsafe-cross-origin-links',
  'protocol-relative',
  'invalid-head-elements',
  'html-structure-broken',
  'multiple-head-or-body',
  'document-too-big',
  'content-before-head',
  'html-lang-missing',
  'html-lang-invalid',
  'viewport-missing',
  'charset-missing',
] as const satisfies readonly PageIssueId[]

const PAGE_LOCAL: ReadonlySet<string> = new Set(PAGE_LOCAL_LIST)

/** Whether an issue only depends on the URL's own answer. See `PAGE_LOCAL_LIST`. */
export const isPageLocalIssue = (issue: string) => PAGE_LOCAL.has(issue)

/** Why a crawl cannot say whether a URL has an issue. */
export type UnknownReason =
  | 'dismissed'
  | 'pruned'
  | 'unanalysed'
  | 'not-seen'
  | 'not-requested'
  | 'excluded'
  | 'participation'
  | 'incomplete'
  | 'catalog'
  | 'audit'
  | 'unobserved'

/** What one crawl says about a URL, for the findings it reports. */
export interface UrlEvidence {
  /** The crawl requested it (and so has its answer). */
  requested: boolean
  /** `null`: the analysis did not keep it. */
  participation: AuditParticipation | null
  intent: RecordedIntent | null
  /** The conditions rules stated for it (`conditionsKey`), which decide findings of their own. */
  conditions: string
  /** Ids of the issues reported for it. */
  issues: ReadonlySet<string>
  /** Ids of the issues the crawl saw and a rule accepts: not reported, and not fixed either. */
  dismissed?: ReadonlySet<string>
  accepted?: ReadonlySet<string>
}

/** A crawl and what it has of one URL (`null`: nothing). */
export interface Evidence {
  crawl: CrawlFacts
  url: UrlEvidence | null
}

/** What has to be the same for two observations to be compared. */
interface Basis {
  identity?: string
  catalog: string | null
  intent: string
  conditions: string
  scope: string | null
  thresholds: AuditThresholds | null
}

export type Observation =
  { presence: 'present' | 'absent'; basis: Basis } | { presence: 'unknown'; reason: UnknownReason }

const unknown = (reason: UnknownReason): Observation => ({ presence: 'unknown', reason })

/**
 * Whether one crawl reports an issue for a URL, or why it cannot say. A crawl only says "absent"
 * when it could have said "present": the URL was requested and audited, and (for an issue that looks
 * at other URLs) the crawl reached every URL it found.
 */
export function observe(issue: string, { crawl, url }: Evidence): Observation {
  if (!crawl.observable) return unknown('pruned')
  if (!crawl.analysed) return unknown('unanalysed')
  if (!url) return unknown('not-seen')
  if (!url.requested) return unknown('not-requested')
  if (url.participation === 'excluded') return unknown('excluded')
  if (url.participation === null) return unknown('participation')
  if (url.dismissed?.has(issue)) return unknown('dismissed')
  // A crawl that never recorded what the check reads cannot say the URL does not have the issue.
  if (crawl.unobserved?.has(issue)) return unknown('unobserved')
  // An incomplete crawl lacks pages that others link from, copy or point to: it can report what is
  // not there, and miss what is.
  if (!crawl.complete && !isPageLocalIssue(issue)) return unknown('incomplete')
  return {
    presence: url.issues.has(issue) ? 'present' : 'absent',
    basis: {
      identity: crawl.identity,
      catalog: crawl.catalog,
      intent: url.intent ?? 'unknown',
      conditions: url.conditions,
      scope: crawl.scope,
      thresholds: crawl.thresholds,
    },
  }
}

/** Why two observations cannot be set against each other, or `null` when they can. */
function incomparable(issue: string, a: Basis, b: Basis): UnknownReason | null {
  if ((a.identity ?? '[]') !== (b.identity ?? '[]')) return 'audit'
  if (a.catalog === null || b.catalog === null || a.catalog !== b.catalog) return 'catalog'
  // What the URL is expected to be, and what rules ask of its conditions, change which findings it
  // keeps and which it raises (`applyAuditPolicy`).
  if (a.intent !== b.intent || a.conditions !== b.conditions) return 'audit'
  if (!isPageLocalIssue(issue) && (a.scope === null || a.scope !== b.scope)) return 'audit'
  // A page-local issue decided by a figure the domain sets: a new figure is not a change of the site.
  const figures = THRESHOLD_ISSUES[issue]
  if (
    figures &&
    figures.some((key) => a.thresholds === null || a.thresholds[key] !== b.thresholds?.[key])
  ) {
    return 'audit'
  }
  return null
}

/**
 * What a change of a finding is, as far as the evidence goes.
 * - `new`: reported by the later crawl, not by the earlier one, and nothing but the site can explain it.
 * - `resolved`: the opposite. "No longer reported by a crawl that could have reported it".
 * - `persistent`: reported by both.
 * - `reappeared`: reported, then not by a crawl that could have reported it, then reported again.
 *   Needs the crawl in which it was not reported: it is never inferred from two crawls alone.
 * - `excluded`: reported earlier, and the later crawl no longer audits the URL. Removed by policy, not
 *   resolved in the site.
 * - `accepted`: reported earlier, and the later crawl still sees it but a rule takes it as expected.
 *   Not resolved in the site.
 * - `audited`: reported by the later crawl for a URL the earlier one left out of the audit. Not new.
 * - `unverified`: the findings differ but the evidence does not say why (see `reasons`).
 */
export const FINDING_CHANGES = [
  'new',
  'reappeared',
  'resolved',
  'accepted',
  'dismissed',
  'excluded',
  'audited',
  'unverified',
  'persistent',
] as const
export type FindingChangeKind = (typeof FINDING_CHANGES)[number]

export interface FindingChange {
  issue: string
  kind: FindingChangeKind
  /** Which crawls report it. */
  reportedBy: 'base' | 'target' | 'both'
  /** Why it is `unverified`. */
  reasons: UnknownReason[]
}

const rankOf = (kind: FindingChangeKind) => FINDING_CHANGES.indexOf(kind)

function bySeverity(a: FindingChange, b: FindingChange) {
  if (isPageIssueId(a.issue) && isPageIssueId(b.issue)) {
    return compareIssueSeverity(a.issue, b.issue) || (a.issue < b.issue ? -1 : 1)
  }
  return a.issue < b.issue ? -1 : a.issue > b.issue ? 1 : 0
}

/**
 * Classifies one issue of one URL between two crawls.
 * @param earlier the crawls before `base`, in any order, with what they have of the URL.
 * @param between the crawls after `base` and before `target`.
 */
export function classifyFinding(
  issue: string,
  input: { base: Evidence; target: Evidence; earlier?: Evidence[]; between?: Evidence[] },
): FindingChange | null {
  const a = observe(issue, input.base)
  const b = observe(issue, input.target)
  const change = (
    kind: FindingChangeKind,
    reportedBy: FindingChange['reportedBy'],
    reasons: UnknownReason[] = [],
  ): FindingChange => ({ issue, kind, reportedBy, reasons })

  if (a.presence === 'unknown' && b.presence === 'unknown') return null

  if (a.presence === 'present' && b.presence === 'present') {
    // Reported by both. It only "reappeared" if a crawl in between could have reported it and did
    // not; crawls that cannot say do not count as a gap.
    const gap = (input.between ?? []).some((evidence) => {
      const m = observe(issue, evidence)
      return (
        m.presence === 'absent' &&
        incomparable(issue, m.basis, a.basis) === null &&
        incomparable(issue, m.basis, b.basis) === null
      )
    })
    return change(gap ? 'reappeared' : 'persistent', 'both')
  }

  if (a.presence === 'present') {
    if (b.presence === 'absent') {
      // The later crawl says outright that it is still there, whatever else changed around it.
      if (input.target.url?.accepted?.has(issue)) return change('accepted', 'base')
      const why = incomparable(issue, a.basis, b.basis)
      return why ? change('unverified', 'base', [why]) : change('resolved', 'base')
    }
    // The later crawl cannot say.
    if (b.presence === 'unknown') {
      if (b.reason === 'dismissed') return change('dismissed', 'base')
      return b.reason === 'excluded'
        ? change('excluded', 'base')
        : change('unverified', 'base', [b.reason])
    }
    return null
  }

  if (b.presence === 'present') {
    if (a.presence === 'absent') {
      const why = incomparable(issue, a.basis, b.basis)
      if (why) return change('unverified', 'target', [why])
      const before = (input.earlier ?? []).some(
        (evidence) => observe(issue, evidence).presence === 'present',
      )
      return change(before ? 'reappeared' : 'new', 'target')
    }
    // The earlier crawl cannot say.
    if (a.presence === 'unknown') {
      return a.reason === 'excluded'
        ? change('audited', 'target')
        : change('unverified', 'target', [a.reason])
    }
    return null
  }

  // Nothing reported on either side that could say anything.
  return null
}

/** Every issue either crawl reports for the URL, classified. Issues neither reports are not listed. */
export function classifyFindings(input: {
  base: Evidence
  target: Evidence
  earlier?: Evidence[]
  between?: Evidence[]
}): FindingChange[] {
  const issues = new Set<string>()
  for (const side of [input.base, input.target]) {
    if (side.url && side.url.participation !== 'excluded') {
      for (const issue of side.url.issues) issues.add(issue)
    }
  }
  const changes: FindingChange[] = []
  for (const issue of issues) {
    const change = classifyFinding(issue, input)
    if (change) changes.push(change)
  }
  return changes.sort((x, y) => rankOf(x.kind) - rankOf(y.kind) || bySeverity(x, y))
}

/** The same issue, in a row of crawls from oldest to newest: what each one says and what happened. */
export interface IssueTimeline {
  issue: string
  cells: Observation[]
  /** What happened when each crawl is set against the one before it. `null`: nothing to report. */
  events: (FindingChange | null)[]
}

/**
 * Follows issues of one URL through crawls, oldest first. Each event sets a crawl against the one
 * right before it, with all the ones before that as the history that can make it a `reappeared`.
 * A crawl that cannot say leaves a gap instead of being read as "not reported".
 */
export function issueTimelines(entries: Evidence[], issues: Iterable<string>): IssueTimeline[] {
  return [...issues].map((issue) => ({
    issue,
    cells: entries.map((entry) => observe(issue, entry)),
    events: entries.map((entry, index) => {
      const previous = entries[index - 1]
      if (!previous) return null
      return classifyFinding(issue, {
        base: previous,
        target: entry,
        earlier: entries.slice(0, index - 1),
      })
    }),
  }))
}

/** The issues any of these crawls reports for the URL. */
export function reportedIssues(entries: Evidence[]): Set<string> {
  const issues = new Set<string>()
  for (const { url } of entries) {
    if (url && url.participation !== 'excluded') for (const issue of url.issues) issues.add(issue)
  }
  return issues
}

/** The issues that only depend on the URL's own answer. */
export const PAGE_LOCAL_ISSUES: readonly PageIssueId[] = PAGE_LOCAL_LIST

// --- evidence from what the crawls stored ----------------------------------------------------------

/** What a stored trace of a URL in a crawl has, for the part that findings are judged by. */
export interface TraceLike {
  crawlId: string
  urlHash: string
  snapshot: { state: string }
  issues: readonly { issue: string }[]
  dismissed?: readonly string[] | undefined
  accepted?: readonly string[] | undefined
  audit: {
    participation: AuditParticipation
    intent: RecordedIntent
    conditions: ConditionStates
  } | null
}

/** What a trace says about a URL, in the terms findings are judged by. */
export function urlEvidenceOf(trace: TraceLike): UrlEvidence {
  return {
    requested: trace.snapshot.state === 'done',
    participation: trace.audit?.participation ?? null,
    intent: trace.audit?.intent ?? null,
    conditions: conditionsKey(trace.audit?.conditions ?? {}),
    issues: new Set(trace.issues.map(({ issue }) => issue)),
    accepted: new Set(trace.accepted ?? []),
    dismissed: new Set(trace.dismissed ?? []),
  }
}

/** The traces by crawl and URL. */
export function indexTraces<T extends TraceLike>(traces: readonly T[]): Map<string, T> {
  return new Map(traces.map((trace) => [`${trace.crawlId}:${trace.urlHash}`, trace]))
}

/**
 * What each crawl, oldest first, has of one URL: the crawls that do not have it say so (`url: null`)
 * instead of being left out, because "not there" and "not known" are different things.
 */
export function evidenceOf(
  crawls: readonly CrawlLike[],
  traces: ReadonlyMap<string, TraceLike>,
  urlHash: string,
): Evidence[] {
  return crawls.map((crawl) => {
    const trace = traces.get(`${crawl.id}:${urlHash}`)
    return {
      crawl: crawlFactsOf(crawl),
      url: trace ? urlEvidenceOf(trace) : null,
    }
  })
}

/**
 * How the findings of a URL changed between two of the crawls, with the ones before and between as
 * the history that can make a finding "reappeared". `crawls` is oldest first and `evidence` goes with
 * it. `null` when one of the two is not among the crawls.
 */
export function findingChangesBetween(
  crawls: readonly Pick<CrawlLike, 'id'>[],
  evidence: readonly Evidence[],
  baseId: string,
  targetId: string,
): FindingChange[] | null {
  const baseIndex = crawls.findIndex((crawl) => crawl.id === baseId)
  const targetIndex = crawls.findIndex((crawl) => crawl.id === targetId)
  const base = evidence[baseIndex]
  const target = evidence[targetIndex]
  if (!base || !target || baseIndex >= targetIndex) return null
  return classifyFindings({
    base,
    target,
    earlier: evidence.slice(0, baseIndex),
    between: evidence.slice(baseIndex + 1, targetIndex),
  })
}

/** Pair-wide limits on an issue summary; URL-specific limits still come from classification. */
export function issuePairReasons(notes: readonly PairNoteCode[], issue: string): UnknownReason[] {
  return notes.flatMap((note): UnknownReason[] => {
    // Changed identity can coalesce URLs and alter both page-local and site-wide findings.
    if (note === 'ignoredParameters') return ['audit']
    if ((note === 'audit' || note === 'incomplete') && isPageLocalIssue(issue)) return []
    return [note === 'legacy' ? 'participation' : note]
  })
}
