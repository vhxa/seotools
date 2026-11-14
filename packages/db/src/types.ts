import type { AcceptanceKind } from '@seotools/core/crawl/acceptance'
import type { BotAnswer, BotVerdict } from '@seotools/core/bot-access'
import type { RuleEditing, RuleSelectors } from './audit'
import type { CrawlFileObservation, CrawlFileRecord } from '@seotools/core/crawl/files'
import type { IncidentKind, IncidentStage } from '@seotools/core/incidents'
import type { VitalMetrics } from '@seotools/core'
import type { FindingAcceptance } from '@seotools/core/crawl/acceptance'
import type {
  AccessGrant,
  AlertKind,
  AlertLocale,
  MailKind,
  MailStatus,
  UserRole,
  AuditCondition,
  AuditRule,
  CompareView,
  CrawlChange,
  UrlSnapshot,
  AuditSnapshot,
  AuditValue,
  IndexabilityState,
  IndexIntent,
  IntentRuleValue,
  LanguageConfig,
  NewAuditRule,
  PagesAudit,
  Requirement,
  UrlAuditState,
  CrawlFileKind,
  ExtraCrawlFileKind,
  CrawlFrequency,
  CrawlLinkKind,
  LinkContext,
  ThresholdOverrides,
  CrawlPageData,
  CrawlPageFacts,
  CrawlRecurrence,
  CrawlRobotsFiles,
  CrawlSettings,
  CrawlStatus,
  CrawlTrigger,
  CrawlType,
  CrawlUrlKind,
  CrawlUrlScope,
  CrawlUrlSource,
  CrawlUrlState,
  CrawlUrlView,
  EnqueueInput,
  IssueEvidence,
  Job,
  JobStatus,
  LinkDirection,
  SettingsStore,
  StatusFilter,
  PagesByWorstIssue,
  PagesWithType,
  VerificationOutcome,
  VerificationStatus,
  VerificationUrlState,
} from '@seotools/core'

export type Dialect = 'sqlite' | 'pg'

export interface ListJobsOptions {
  limit?: number
  status?: JobStatus
}

export interface JobRepository {
  enqueue(input: EnqueueInput): Promise<Job>
  get(id: string): Promise<Job | null>
  list(options?: ListJobsOptions): Promise<Job[]>
  countByStatus(): Promise<Record<JobStatus, number>>
  /** Atomically moves up to `limit` due jobs to `running` for this worker (attempts += 1). */
  claim(input: {
    workerId: string
    limit: number
    now?: Date
    /** Only claim these types. */
    types?: readonly string[]
    /** Claim anything but these types. */
    excludeTypes?: readonly string[]
  }): Promise<Job[]>
  complete(input: { id: string; workerId: string; result?: unknown }): Promise<void>
  /** With `retryAt` the job goes back to `pending`; without it, it's marked `failed`. */
  fail(input: { id: string; workerId: string; error: string; retryAt?: Date }): Promise<void>
  /** Tells the queue the job is still being worked on, so it isn't taken for orphaned. */
  renewLock(input: { id: string; workerId: string; now?: Date }): Promise<void>
  /**
   * Hands a job back unfinished (worker shutting down): `pending`, not counted as an attempt. With
   * `runAt` it is not picked up again before then, for a job that has to wait for something.
   */
  release(input: { id: string; workerId: string; runAt?: Date }): Promise<void>
  /** Recovers jobs whose worker died: back to `pending`, or `failed` if out of attempts. */
  requeueStale(input: { lockedBefore: Date }): Promise<number>
  /**
   * Deletes finished jobs: `completed` ones last updated before `finishedBefore`, `failed` ones
   * before `failedBefore`. Never `pending` or `running`, nor a job an active crawl or recheck still
   * points at (`failOrphaned` reads it). Returns how many were deleted.
   */
  prune(input: { finishedBefore: Date; failedBefore: Date }): Promise<number>
}

export interface Heartbeat {
  workerId: string
  startedAt: Date
  lastSeenAt: Date
}

export interface HeartbeatRepository {
  beat(input: { workerId: string; startedAt: Date; now?: Date }): Promise<void>
  latest(): Promise<Heartbeat | null>
}

export interface AdminAccount {
  id: string
  email: string
  /** Hash of the credential account, if there is one. */
  passwordHash: string | null
}

export interface AdminRepository {
  /** Whether any user exists. While none does, the app offers the first-run setup. */
  exists(): Promise<boolean>
  findByEmail(email: string): Promise<AdminAccount | null>
  /** Creates the user and its credential account together. Rejects if the id or email is taken. */
  create(input: { id: string; email: string; name: string; passwordHash: string }): Promise<void>
}

/** An account, as the people who manage them see it. */
export interface UserRecord {
  id: string
  name: string
  email: string
  role: UserRole
  disabledAt: Date | null
  /** It has a password: `false` is someone invited who has not accepted yet. */
  hasPassword: boolean
  resetRequestedAt: Date | null
  createdAt: Date
}

export const USER_TOKEN_KINDS = ['invite', 'reset'] as const
export type UserTokenKind = (typeof USER_TOKEN_KINDS)[number]

/** What refuses a change that would leave nobody able to administer the instance. */
export type UserChange = 'ok' | 'not-found' | 'last-admin'

export interface UserRepository {
  /** Every account, by name. */
  list(): Promise<UserRecord[]>
  get(id: string): Promise<UserRecord | null>
  findByEmail(email: string): Promise<UserRecord | null>
  /** Creates an account with no password. Rejects if the email is taken. */
  create(input: { email: string; name: string; role: UserRole }): Promise<UserRecord>
  /** Refuses to leave no administrator who is active and can sign in. */
  setRole(id: string, role: UserRole): Promise<UserChange>
  /** Disabling removes the sessions and links of the account, and refuses like `setRole`. */
  setDisabled(id: string, disabled: boolean): Promise<UserChange>
  /** What a member was given. An administrator keeps theirs, unused, in case the role goes. */
  grantsOf(userId: string): Promise<AccessGrant[]>
  /** The grants of every account, for those who manage them. */
  allGrants(): Promise<Map<string, AccessGrant[]>>
  /** Replaces what a member was given. `false`: the account, a company or a domain do not exist. */
  setGrants(userId: string, grants: readonly AccessGrant[]): Promise<boolean>
  addToken(input: {
    tokenHash: string
    userId: string
    kind: UserTokenKind
    expiresAt: Date
  }): Promise<void>
  /** Whose a link is while it works: not expired, and the account not disabled. */
  findToken(tokenHash: string, now: Date): Promise<{ kind: UserTokenKind; user: UserRecord } | null>
  /**
   * Uses a link: sets the password, verifies the email, and removes every link and session of the
   * account, all or nothing. `false`: the link does not work (any more), and nothing changed.
   */
  redeemToken(input: { tokenHash: string; passwordHash: string; now: Date }): Promise<boolean>
  markResetRequested(id: string, at: Date): Promise<void>
}

/** One attempt to send an email. No subject, body or link is ever kept. */
export interface MailDelivery {
  id: string
  kind: MailKind
  recipient: string
  status: MailStatus
  /** What the provider answered, bounded. `null` when it was sent. */
  error: string | null
  createdAt: Date
}

export interface MailRepository {
  /** Records an attempt. `error` is cut to `MAX_DELIVERY_ERROR_LENGTH`. */
  record(input: {
    kind: MailKind
    recipient: string
    status: MailStatus
    error?: string | null
  }): Promise<void>
  /** Newest first. `problems`: only the attempts that did not send. */
  recent(options: { limit: number; outcome?: 'sent' | 'problems' }): Promise<MailDelivery[]>
  /**
   * Removes attempts older than `before`, and all but the newest `keep` of the rest. Returns how
   * many went.
   */
  prune(input: { before: Date; keep: number }): Promise<number>
}

/** What a person asked to be told about a domain. */
export interface AlertSubscription {
  userId: string
  domainId: string
  /** At least one: a person who wants none has no subscription. */
  kinds: AlertKind[]
  /** The language of the emails, as the person had it when they saved. */
  locale: AlertLocale
  updatedAt: Date
}

export interface AlertRepository {
  /** Everything a person asked for. */
  forUser(userId: string): Promise<AlertSubscription[]>
  /** Everyone who asked for something about a domain: not yet checked for access or an active account. */
  forDomain(domainId: string): Promise<AlertSubscription[]>
  /**
   * Replaces what a person asked for in these domains, all or nothing. A domain with no kinds loses
   * its subscription. Domains not listed are left as they are.
   */
  save(input: {
    userId: string
    locale: AlertLocale
    domains: { domainId: string; kinds: readonly AlertKind[] }[]
  }): Promise<void>
  /**
   * Takes the right to send these kinds of a crawl to a person. Returns the ones this call took:
   * a kind already taken, by anyone, is not returned, so that two attempts never send the same
   * notice. Taking is atomic per kind.
   */
  claim(input: {
    crawlId: string
    userId: string
    kinds: readonly AlertKind[]
  }): Promise<AlertKind[]>
  /** Gives back what `claim` took when sending failed, so that a retry can send it. */
  release(input: { crawlId: string; userId: string; kinds: readonly AlertKind[] }): Promise<void>
}

export interface Company {
  id: string
  name: string
  createdAt: Date
}

export interface Domain {
  id: string
  companyId: string
  /** Normalized host, e.g. `example.com` (see `normalizeDomain` in @seotools/core). */
  host: string
  createdAt: Date
  /**
   * When the domain was archived, `null` while it is active. An archived domain keeps all its
   * data and stays readable, but nothing automatic runs for it and nothing can be started or
   * changed (`DomainArchivedError`).
   */
  archivedAt: Date | null
}

/** What deleting a domain removes, in rows a person can recognise. Counted by the database. */
export interface DomainUsage {
  crawls: number
  /** URLs with their results, over the crawls that still keep them. */
  urls: number
  /** Audit rules and exceptions. */
  rules: number
  rechecks: number
  schedules: number
  priorityUrls: number
  crawlFiles: number
}

export interface CompanyWithDomains extends Company {
  domains: Domain[]
}

export interface DomainWithCompany extends Domain {
  company: Company
}

export interface CompanyRepository {
  /** Every company with its domains. Companies are sorted by name, domains by host. */
  list(): Promise<CompanyWithDomains[]>
  get(id: string): Promise<Company | null>
  /** Creates a company together with its first domain. Rejects if the host is already taken. */
  create(input: {
    name: string
    host: string
    crawlSettings?: CrawlSettings
  }): Promise<{ company: Company; domain: Domain }>
  /** `null` when the company does not exist. */
  rename(id: string, name: string): Promise<Company | null>
  /**
   * Deletes the company with its domains and everything stored for them (crawls, results, rules,
   * rechecks, schedules, files, icons) and the queued or running jobs that work on them, in one
   * transaction. `false` when the company does not exist.
   */
  delete(id: string): Promise<boolean>
}

export interface DomainRepository {
  get(id: string): Promise<Domain | null>
  findByHost(host: string): Promise<DomainWithCompany | null>
  /** Rejects if the host is already taken or the company does not exist. */
  add(input: { companyId: string; host: string; crawlSettings?: CrawlSettings }): Promise<Domain>
  /**
   * Archives a domain, and in the same transaction cancels its active crawl and recheck: the jobs
   * notice at their next check and stop requesting. Archiving twice keeps the first date. `null`
   * when the domain does not exist.
   */
  archive(id: string): Promise<Domain | null>
  /**
   * Makes an archived domain active again. Its schedules move to their next run from now, so that
   * coming back does not start a crawl for every run it missed. `null` when it does not exist.
   */
  unarchive(id: string): Promise<Domain | null>
  /**
   * Moves a domain to another company. Only `company_id` changes: the id is the same, so every
   * result, rule and schedule stays with it. `null` when the domain or the company does not exist.
   */
  move(input: { id: string; companyId: string }): Promise<Domain | null>
  /**
   * Deletes the domain and everything stored for it, and the jobs that work on it, in one
   * transaction. `false` when it does not exist.
   */
  delete(id: string): Promise<boolean>
  /** What each domain would lose if deleted, by domain id. Domains with nothing are included. */
  usage(): Promise<Map<string, DomainUsage>>
}

export interface CrawlRendering {
  mode: 'html' | 'rendered'
  waitMs: number
  omittedHosts: string[]
}

export interface CrawlUrlRender {
  urlHash: string
  status: 'rendered' | 'failed'
  settled: boolean
  /** Null for observations made before truncation was recorded: completeness is unknown. */
  truncated: boolean | null
  finalUrl: string
  durationMs: number
  failure: string | null
  data: {
    facts: CrawlPageFacts | null
    /** Absent on older rows. A redirect observes the target, not the abandoned DOM. */
    redirected?: boolean
    /** Absent on older render rows: these extracted values were not retained. */
    page?: {
      canonical?: string | null
      title: string | null
      description: string | null
      h1: string | null
      metaRobots: string | null
      botRobots: Record<string, string>
      hreflang: NonNullable<CrawlPageData['hreflang']>
    }
    documentLinks?: {
      internal: number
      nofollow: number
      embeds: string[]
      embedsComplete: boolean
    }
    requests: unknown
    scriptErrors: { count: number; first: string[] }
  }
}

export interface Crawl {
  rendering: CrawlRendering | null
  browserWaitMs: number
  ignoredParameters?: string[]
  seedUrls?: string[] | null
  id: string
  domainId: string
  type: CrawlType
  status: CrawlStatus
  trigger: CrawlTrigger
  jobId: string
  /** URLs of the site that answered with HTML. */
  pagesCount: number
  /** URLs of the site found so far: pages, redirects, resources and failures. */
  urlsCount: number
  urlsDoneCount: number
  externalCount: number
  /**
   * Pages by the worst type of finding they have (`PAGE_ISSUES` in @seotools/core). `null` when the
   * crawl has not been analysed. The rest of `pagesCount` have none and are correct. Survives
   * pruning.
   */
  pagesByWorstIssue: PagesByWorstIssue | null
  /** Pages with at least one finding of each type, or `null` as above. Survives pruning. */
  pagesWithType: PagesWithType | null
  /**
   * The version of the issue catalog (`ISSUE_CATALOG_VERSION`) that `pagesByWorstIssue` and the
   * issues of the crawl were worked out with. `null`: not analysed, or analysed before this was kept.
   */
  issueCatalog: string | null
  /**
   * How the pages split by audit participation and technical indexability. `null` when the crawl was
   * analysed before these were kept and its results are gone, so they cannot be worked out: they are
   * never made up. Survives pruning.
   */
  pagesAudit: PagesAudit | null
  /**
   * The version of the domain's audit configuration the analysis used. `null`: analysed before the
   * configuration existed (no rules, the same as version 0), or not analysed.
   */
  auditVersion: number | null
  /** The rules that analysis used: what it takes to read it, or repeat it, as it was. */
  auditSnapshot: AuditSnapshot | null
  robots: CrawlRobotsFiles | null
  /** The results per URL were removed by the domain's retention setting; the counts remain. */
  pruned: boolean
  /** Pruned, and what each URL was is still kept in the compact history (`urlHistory`). */
  history: boolean
  /** The crawl's number, unique: what its rows of links refer to. `null` only before 0019. */
  ref: number | null
  error: string | null
  createdAt: Date
  startedAt: Date | null
  finishedAt: Date | null
}

/** A domain's recent crawls and whether one is active, for the portfolio home. */
export interface PortfolioEntry {
  /** Finished full crawls (completed, incomplete, failed or cancelled), newest first. */
  crawls: Crawl[]
  /** A crawl of any type is pending or running. */
  running: boolean
}

/** What the structure of a site needs to know of one URL. */
export interface StructureUrl {
  urlHash: string
  url: string
  kind: CrawlUrlKind
  statusCode: number | null
  state: 'queued' | 'done' | 'skipped'
}

export type CrawlCounts = Pick<
  Crawl,
  'pagesCount' | 'urlsCount' | 'urlsDoneCount' | 'externalCount'
>

export interface NewCrawlUrl {
  notRequested?: 'excluded' | 'depth'
  url: string
  urlHash: string
  scope: CrawlUrlScope
  source: CrawlUrlSource
  depth: number
  /** Its number in the crawl, unique, given in the order it was found. */
  seq: number
  /** `seq` of the URL whose response it was first found in, and how. Absent: not found in one. */
  foundFrom?: number | null
  foundKind?: CrawlLinkKind | null
}

export interface CrawlUrlResult {
  kind: CrawlUrlKind
  statusCode: number | null
  contentType: string | null
  redirectTo: string | null
  title: string | null
  metaRobots: string | null
  xRobotsTag: string | null
  canonical: string | null
  responseTimeMs: number | null
  bytes: number | null
  error: string | null
  data: CrawlPageData | null
}

export interface CrawlUrl
  extends Omit<NewCrawlUrl, 'seq' | 'foundFrom' | 'foundKind'>, CrawlUrlResult {
  /** `null` only for a URL stored before migration 0019 that it could not number. */
  seq: number | null
  foundFrom: number | null
  foundKind: CrawlLinkKind | null
  crawlId: string
  state: CrawlUrlState
  fetchedAt: Date | null
  referencedBy?: { total: number; kinds: Record<string, number> }
}

export interface CrawlLink {
  rendered?: number | null
  sourceHash: string
  targetHash: string
  kind: CrawlLinkKind
  /** Where in the source page it was found. Kept for the first occurrence only. */
  context?: LinkContext
  /**
   * The `seq` of each end, when the writer knows them (the crawler does). Then the link is stored
   * whether or not the other end's row is stored yet: concurrent results can commit in any order.
   */
  sourceSeq?: number
  targetSeq?: number
}

/**
 * Which URLs of a crawl a list starts from (`URL_VIEWS` in @seotools/core says what each one is):
 * `pages`, `resources`, `redirects`, `external` and `all`, plus `other`, the URLs of the site that
 * are not pages.
 */
export type { CrawlUrlView }

/** What a list of URLs can be ordered by. Without one, shallowest first, then by URL. */
export type CrawlUrlSort =
  'referencedBy' | 'url' | 'title' | 'status' | 'depth' | 'responseTime' | 'bytes'

/** Which URLs of a crawl a list shows. */
export interface CrawlUrlQuery {
  state?: 'pending' | 'in-progress' | 'dismissed'
  crawlId: string
  view: CrawlUrlView
  /** Text the URL or the title contains, whatever its case. */
  search?: string
  /**
   * Only URLs that have this issue (an id from `PAGE_ISSUES`), whichever `view` they are in: issues
   * are not only for pages, and a broken link is not even on this site. The `view` is ignored, which
   * is the same as listing `all`.
   */
  issue?: string
  /**
   * Only URLs with a finding a rule accepts: this issue, or any (`ANY_ACCEPTED`). Like `issue`, the
   * `view` is ignored.
   */
  accepted?: string
  acceptanceKind?: AcceptanceKind
  /**
   * Only URLs whose last request got a status of this class, or `none`: no status at all, because
   * the URL was never requested or the request failed. Within the `view`.
   */
  status?: StatusFilter
  /**
   * Only URLs of the site that turned out to be this: external URLs are recorded, never typed, so
   * they are left out. `unknown` is a URL of the site that was not requested or never answered.
   * Within the `view`: a type the view cannot hold lists nothing, so pages only offer the choice
   * where the view has more than one (`viewHasTypes`).
   */
  type?: CrawlUrlKind
  /**
   * Only URLs with this technical indexability, as the analysis saw it. Only URLs of the site have
   * one: external URLs and crawls analysed before it was kept list nothing. Within the `view`.
   */
  indexability?: IndexabilityState
  /** Only URLs the analysis audited, or only those it left out. Within the `view`. */
  participation?: 'audited' | 'excluded'
  /** Only URLs the analysis found this expectation for. Within the `view`. */
  intent?: IndexIntent
  /** Only URLs the analysis applied this rule to, for either dimension. Within the `view`. */
  rule?: string
}

/** The URLs of a crawl in each view. `all` is the sum of `internal` and `external`. */
export type CrawlViewCounts = Record<CrawlUrlView, number>
/** Which links of one URL of a crawl a list shows. */
export interface CrawlLinkQuery {
  crawlId: string
  /** The URL the list is about. */
  urlHash: string
  /** `in`: the links that arrive at it, listed by where they start. `out`: those that leave it. */
  direction: LinkDirection
  /** Only these types of link. Absent: every type. Empty: none, so nothing is listed. */
  kinds?: readonly CrawlLinkKind[]
  /** Text the address at the other end contains, whatever its case. */
  search?: string
}

/**
 * One link of a URL, seen from it: the URL at the other end (where an incoming link starts, where
 * an outgoing one points), the type of the link, where it sits in the page that has it, and what
 * the crawl knows of that URL. It is what was stored and nothing more: crawls before the context
 * was kept have none, and it is never made up. Several links of the same type between two URLs are
 * one, with the context of the first.
 */
export interface CrawlLinkRow {
  url: string
  urlHash: string
  kind: CrawlLinkKind
  /** Where the link is in the page that has it. `null`: not kept (an older crawl, a header…). */
  context: LinkContext | null
  /** Of the URL at the other end. */
  scope: CrawlUrlScope
  /** `unknown` when it was not requested, never answered, or is external: never a verdict. */
  urlKind: CrawlUrlKind
  state: CrawlUrlState
  statusCode: number | null
  error: string | null
}

/** A link leaving a URL, for an export of links. */
export interface OutLink extends CrawlLinkRow {
  sourceHash: string
}

/** Where a page of the links leaving a URL ended: the next page starts after it. */
export interface OutLinkCursor {
  target: number
  kind: string
}

/** A link where query parameters enter the site. */
export interface ParameterEntry {
  sourceUrl: string
  sourceHash: string
  url: string
  urlHash: string
  kind: CrawlLinkKind
  context: LinkContext | null
}

/** A step of how the crawler got to a URL. */
export interface DiscoveryStep {
  url: string
  urlHash: string
  /** How this URL was found from the step before. `null` for the first (a seed, a file). */
  foundKind: CrawlLinkKind | null
  /** What the crawl stored of that link on the step before: its text, element, region. */
  context: LinkContext | null
}

/** An issue found on a URL of a crawl. */
export interface CrawlUrlIssue {
  urlHash: string
  issue: string
  /** What `PAGE_ISSUES` says this issue details. Absent when it details nothing. */
  details?: string[]
  /**
   * What the crawl saw that makes the URL have the issue (`ISSUE_EVIDENCE` says which issues have
   * it), bounded: a total and the first few samples. Absent when the issue has none, or when the
   * crawl cannot say, which is never filled in with guesses.
   */
  evidence?: IssueEvidence
}

/**
 * A finding a rule accepts (see `@seotools/core/crawl/acceptance`): what the crawl saw, with its
 * evidence, kept apart from what is pending.
 */
export interface CrawlUrlAcceptedIssue extends CrawlUrlIssue {
  /** The URL whose declaration accepts it: this one, or the one the finding is about. */
  acceptedBy: string
  acceptance: FindingAcceptance
}

/** What an analysis concluded about a URL of a crawl. */
export interface CrawlUrlAudit extends UrlAuditState {
  urlHash: string
}

/** The lightest description of a URL of a crawl, for work that only needs to look at addresses. */
export interface CrawlUrlBrief {
  urlHash: string
  url: string
  kind: CrawlUrlKind
  state: CrawlUrlState
}

/** What an analysis stores about a crawl (see `CrawlRepository.saveAnalysis`). */
export interface CrawlAuditAnalysis {
  /** The configuration it used, as it was when the analysis started. */
  snapshot: AuditSnapshot
  pages: PagesAudit
  urls: CrawlUrlAudit[]
}

/** A hreflang alternate that a sitemap declares for a page. */
export interface SitemapHreflang {
  pageHash: string
  lang: string
  url: string
}

export interface CrawlRepository {
  /** The saved settings of a domain, or the defaults if it has none. */
  requestSecrets(domainId: string): Promise<string | null>
  saveRequestSecrets(domainId: string, encrypted: string | null): Promise<void>
  settings(domainId: string): Promise<CrawlSettings>
  saveIgnoredParameters(domainId: string, patterns: string[]): Promise<void>
  saveSettings(domainId: string, settings: CrawlSettings): Promise<void>
  /** The extra crawl files each domain turned on, by domain id. Domains with none are left out. */
  enabledFiles(): Promise<Map<string, ExtraCrawlFileKind[]>>

  /**
   * Creates a crawl and the job that runs it, together. A domain has one active crawl at most:
   * returns `null`, creating nothing, if it already has one.
   */
  start(input: {
    domainId: string
    type: CrawlType
    trigger: CrawlTrigger
    seedUrls?: string[]
  }): Promise<Crawl | null>
  get(id: string): Promise<Crawl | null>
  /** The crawl with this id if it belongs to the domain; `null` for any other domain's, or none. */
  getInDomain(domainId: string, id: string): Promise<Crawl | null>
  active(domainId: string): Promise<Crawl | null>
  /** Newest first. Every type unless told otherwise. */
  list(domainId: string, options?: { limit?: number; type?: CrawlType }): Promise<Crawl[]>
  /** The newest crawl of a type that finished with usable results. */
  latestWithResults(domainId: string, type: CrawlType): Promise<Crawl | null>
  /**
   * What the portfolio home needs of every domain at once, in a fixed number of queries whatever the
   * number of domains: its last `recent` (8 by default) finished full crawls and whether a crawl is
   * active. Domains with neither are not in the map. Reads no results per URL; the crawls come
   * without `robots`, `seedUrls` and `auditSnapshot` (always `null` here).
   */
  portfolio(options?: { recent?: number }): Promise<Map<string, PortfolioEntry>>
  /**
   * The URLs of the site (not external ones) of a crawl, a bounded page at a time, ordered by hash:
   * `after` is the hash the previous page ended with, `null` for the first. What the structure of a
   * domain is worked out from, without ever holding the whole crawl.
   */
  listStructureUrls(
    crawlId: string,
    page: { after: string | null; limit: number },
  ): Promise<StructureUrl[]>
  /** Moves an active crawl to `running`. `null` when it is no longer active (e.g. cancelled). */
  markRunning(id: string): Promise<Crawl | null>
  updateCounts(id: string, counts: CrawlCounts): Promise<void>
  saveRobots(id: string, robots: CrawlRobotsFiles): Promise<void>
  /** Ends an active crawl, recounting its URLs. `false` if it had already ended. */
  finish(
    id: string,
    input: { status: 'completed' | 'incomplete' | 'failed'; error?: string },
  ): Promise<boolean>
  /** `false` if the crawl had already ended. */
  cancel(id: string): Promise<boolean>
  /** Ends active crawls whose job can no longer run them (out of attempts). Returns how many. */
  failOrphaned(): Promise<number>
  /**
   * Removes the results per URL of old crawls of a type, keeping the newest `keep` usable ones
   * (`null`: all of them). Results of failed or cancelled crawls are partial, so they always go.
   * What each URL of a usable full crawl was stays in the compact history (`history`), until
   * `expireHistory` removes it.
   */
  prune(input: { domainId: string; type: CrawlType; keep: number | null }): Promise<number>
  /**
   * Removes the compact history of crawls that finished more than their domain's `historyDays`
   * ago (the default when the domain saved no settings; never when it chose to keep it). Returns
   * how many crawls lost it. Their totals stay.
   */
  expireHistory(input: { now: Date; defaultDays: number }): Promise<number>

  /** Adds URLs to a crawl, ignoring those it already has. */
  addUrls(crawlId: string, urls: NewCrawlUrl[]): Promise<void>
  /** URLs waiting to be requested, shallowest first. */
  nextQueued(crawlId: string, limit: number): Promise<NewCrawlUrl[]>
  /** Every URL of the crawl, to pick up where a previous attempt left off. */
  knownUrls(
    crawlId: string,
  ): Promise<{ urlHash: string; scope: CrawlUrlScope; seq: number | null }[]>
  /** Stores what a request returned along with the URLs and links found in it, atomically. */
  renders(crawlId: string): Promise<CrawlUrlRender[]>
  renderOf(crawlId: string, urlHash: string): Promise<CrawlUrlRender | null>
  saveBrowserWait(crawlId: string, milliseconds: number): Promise<void>
  recordResult(input: {
    render?: CrawlUrlRender
    crawlId: string
    urlHash: string
    result: CrawlUrlResult
    urls?: NewCrawlUrl[]
    links?: CrawlLink[]
  }): Promise<void>
  countUrls(crawlId: string): Promise<CrawlCounts>
  listUrls(
    input: CrawlUrlQuery & {
      limit: number
      offset: number
      sort?: CrawlUrlSort
      direction?: 'asc' | 'desc'
    },
  ): Promise<CrawlUrl[]>
  /** How many URLs `listUrls` would list for the same query, ignoring the page. */
  countListed(query: CrawlUrlQuery): Promise<number>
  /** How many URLs each view starts from, with no other filter: what the crawl recorded. */
  viewCounts(crawlId: string): Promise<CrawlViewCounts>
  /** One URL of a crawl, or `null` if the crawl does not have it. */
  getUrl(crawlId: string, urlHash: string): Promise<CrawlUrl | null>
  /** These URLs of a crawl that it has, in no particular order. */
  urlsOf(crawlId: string, urlHashes: string[]): Promise<CrawlUrl[]>
  /**
   * A page of the links that leave one URL of a crawl, with what is known of where they go, in the
   * order the crawler numbered their targets. Paged by a cursor on the links' own key, so a URL with
   * any number of links is read a bounded page at a time. `next` is `null` after the last page.
   */
  outlinksOf(
    crawlId: string,
    sourceHash: string,
    page: { after: OutLinkCursor | null; limit: number },
  ): Promise<{ links: OutLink[]; next: OutLinkCursor | null }>
  /**
   * The addresses of internal URLs of a crawl that have a query string, in the order the crawler
   * numbered them, a page at a time: `next` is where the following page starts, `null` after the last.
   */
  queryUrls(
    crawlId: string,
    page: { after: number | null; limit: number },
  ): Promise<{
    urls: string[]
    observations?: { url: string; canonical: string | null }[]
    next: number | null
  }>
  /**
   * The links that bring query parameters their page does not have (they kept the tag as read,
   * `LinkContext.snippet`): where parameters enter the site. Ordered by target, then source.
   */
  parameterEntries(
    crawlId: string,
    page: { limit: number; offset: number },
  ): Promise<{ entries: ParameterEntry[]; total: number }>
  /**
   * How the crawler got to a URL: from the first URL it found it through, up to the URL itself,
   * each with the kind of link that led on (`foundKind` of the next one). Empty: not found in the
   * crawl. A URL found before this was recorded has only itself.
   */
  discoveryPath(crawlId: string, urlHash: string): Promise<DiscoveryStep[]>
  /** The URLs of a crawl that link to `targetHash`, sorted by URL. A home page has thousands. */
  linkSources(
    crawlId: string,
    targetHash: string,
    options?: { limit?: number },
  ): Promise<{ url: string; kind: CrawlLinkKind }[]>
  /** The URLs that `sourceHash` links to, external ones included, sorted by URL. */
  linkTargets(
    crawlId: string,
    sourceHash: string,
    options?: { limit?: number },
  ): Promise<{ url: string; kind: CrawlLinkKind }[]>
  /**
   * The links of one URL in one direction (external URLs included), sorted by the address at the
   * other end and then by type, so that pages of it follow each other with no gap or repeat.
   * Another crawl's URLs are never mixed in: everything is read within `query.crawlId`.
   */
  listLinks(query: CrawlLinkQuery & { limit: number; offset: number }): Promise<CrawlLinkRow[]>
  /** How many links `listLinks` would list for the same query, ignoring the page. */
  countLinks(query: CrawlLinkQuery): Promise<number>
  /**
   * How many links a URL has of each type in one direction, whatever the types and search of a
   * list: types without links are left out.
   */
  linkKindCounts(
    crawlId: string,
    urlHash: string,
    direction: LinkDirection,
  ): Promise<{ kind: CrawlLinkKind; count: number }[]>

  /** The links going out of these URLs of a crawl. */
  linksFrom(crawlId: string, sourceHashes: string[]): Promise<CrawlLink[]>
  /** Saves hreflang alternates sitemaps declared, ignoring those the crawl already has. */
  addSitemapHreflang(crawlId: string, entries: SitemapHreflang[]): Promise<void>
  /** The hreflang alternates sitemaps declare for these pages of a crawl. */
  sitemapHreflangOf(crawlId: string, pageHashes: string[]): Promise<SitemapHreflang[]>
  /**
   * External URLs that anchors link to and were not requested yet. They only stop being returned
   * once `recordResult` stores what they answered.
   */
  pendingExternalLinks(crawlId: string, limit: number): Promise<NewCrawlUrl[]>

  /**
   * Replaces the analysis of a crawl: its issues, what was concluded about each URL, and the totals
   * of both, which also marks the crawl as analysed. All or nothing.
   *
   * An analysis made with an older configuration never replaces one made with a newer: returns
   * `false`, writing nothing, if the crawl already has the result of a later `audit.snapshot.version`
   * (or its results were pruned meanwhile). The same version again replaces it, so repeating an
   * analysis is safe.
   */
  saveAnalysis(input: {
    crawlId: string
    issues: CrawlUrlIssue[]
    /** What rules accept, which is not in `issues` and so counts for nothing that is pending. */
    accepted?: CrawlUrlAcceptedIssue[]
    /** Audited pages by the worst type of finding they have. */
    pages: PagesByWorstIssue
    withType: PagesWithType
    /** `ISSUE_CATALOG_VERSION`, to find the analyses a later catalog leaves out of date. */
    catalog: string
    audit: CrawlAuditAnalysis
  }): Promise<boolean>
  /**
   * Crawls that were analysed with another version of the catalog than `catalog`, and still have
   * the results per URL to analyse them again. Oldest first.
   */
  outdatedAnalyses(catalog: string, limit: number): Promise<Crawl[]>
  /** For each issue found in a crawl, how many URLs have it. Issues nobody has are left out. */
  /**
   * URLs with each issue. `pages` leaves out the secondary ones (`isSecondaryFinding`: a
   * search-result finding on a URL the crawl saw as not indexable), counted apart in `secondary`.
   */
  issueCounts(crawlId: string): Promise<{ issue: string; pages: number; secondary: number }[]>
  /** The issues of these URLs of a crawl. URLs without issues have no entry. */
  issuesOf(crawlId: string, urlHashes: string[]): Promise<CrawlUrlIssue[]>
  /** For each issue a rule accepts in a crawl, how many URLs it accepts it on. */
  acceptedCounts(
    crawlId: string,
    kind?: 'dismissal' | 'rule',
  ): Promise<{ issue: string; pages: number }[]>
  /** The findings rules accept on these URLs of a crawl. */
  acceptedOf(crawlId: string, urlHashes: string[]): Promise<CrawlUrlAcceptedIssue[]>
  /**
   * The findings of other URLs that what is declared of this one accepts, in a stable order: what a
   * rule of this URL does beyond it.
   */
  acceptedBecauseOf(
    crawlId: string,
    urlHash: string,
    options: { limit: number },
  ): Promise<{ total: number; findings: { urlHash: string; url: string; issue: string }[] }>
  /**
   * What the analysis of the crawl concluded about these URLs. Internal URLs of a crawl analysed
   * with this feature have an entry; the rest do not, and neither do the URLs of older analyses.
   */
  auditOf(crawlId: string, urlHashes: string[]): Promise<CrawlUrlAudit[]>
  /** For each rule the analysis applied, how many URLs it decided (for either dimension). */
  auditRuleCounts(crawlId: string): Promise<Map<string, number>>
  /**
   * The internal URLs of a crawl in a stable order, in the lightest form there is. Page through it
   * to match addresses against rules without loading the data of each page.
   */
  urlBriefs(crawlId: string, options: { limit: number; offset: number }): Promise<CrawlUrlBrief[]>
  /** For each hash that has one, the most recent result in any retained crawl of the domain. */
  latestResults(domainId: string, urlHashes: string[]): Promise<CrawlUrl[]>

  /**
   * Comparing two full crawls of a domain, `baseId` the earlier one and `targetId` the later one.
   * Both must be full crawls of `domainId` that finished with results (`completed` or `incomplete`)
   * and still have them (not pruned), and be two different crawls: otherwise there is nothing to
   * compare and these return `null`, `0` or `[]`, whatever the ids. Only URLs of the site are
   * compared (never external ones), and nothing is requested: it reads what the crawls stored.
   *
   * Every query is a join on the primary key (`crawl_id`, `url_hash`) and pages on the server, so a
   * comparison of two crawls of 100,000 URLs answers in well under two seconds on each dialect
   * (measured with 100,000 URLs per crawl). That relies on the planner's statistics, which
   * autovacuum / the engine keep current: on a table PostgreSQL has never analysed (a first crawl
   * read within the minute after it ended) it can choose a nested loop and take minutes.
   */
  compareCounts(input: {
    domainId: string
    baseId: string
    targetId: string
    view: CompareView
  }): Promise<CrawlComparisonCounts | null>
  /** The URLs that changed in the way `query.change` says, sorted by URL, a page at a time. */
  compareUrls(
    query: CrawlComparisonQuery & { limit: number; offset: number },
  ): Promise<CrawlUrlComparison[]>
  /** How many URLs `compareUrls` would list for the same query, ignoring the page. */
  countCompared(query: CrawlComparisonQuery): Promise<number>
  /**
   * What the crawls of the domain recorded of these URLs: for each crawl that has a URL, one entry.
   * Crawls that are not full crawls of the domain (or that were pruned, and so have nothing) give
   * none. Page through `urlHashes` for more than a few hundred.
   */
  urlHistory(input: {
    domainId: string
    crawlIds: string[]
    urlHashes: string[]
  }): Promise<CrawlUrlTrace[]>
}

/** Which URLs a comparison of two crawls lists. */
export interface CrawlComparisonQuery {
  domainId: string
  baseId: string
  targetId: string
  change: CrawlChange
  view: CompareView
  /** Text the URL or the title (of the later crawl, or the earlier one for `missing`) contains. */
  search?: string
  /** Only for `gained` and `lost`: those that are about this issue (an id from `PAGE_ISSUES`). */
  issue?: string
}

/** A URL in a comparison, as each crawl recorded it. `null`: that crawl does not have the URL. */
export interface CrawlUrlComparison {
  urlHash: string
  url: string
  base: UrlSnapshot | null
  target: UrlSnapshot | null
}

/**
 * How many URLs of the site changed in each way between two crawls. The view only narrows what is
 * counted for `added`, `missing` and the ones below `compared`.
 */
export interface CrawlComparisonCounts {
  /** In the later crawl and not in the earlier one. */
  added: number
  /** In the earlier crawl and not in the later one. */
  missing: number
  /** In both, but at least one of the crawls found the URL and did not request it. Every view. */
  unrequested: number
  /** In both and requested by both, which is what the rest are among. */
  compared: number
  status: number
  title: number
  canonical: number
  robots: number
  gained: number
  lost: number
}

/** What one crawl recorded of a URL, with its findings and what the analysis concluded about it. */
export interface CrawlUrlTrace {
  crawlId: string
  urlHash: string
  url: string
  snapshot: UrlSnapshot
  issues: CrawlUrlIssue[]
  /** Ids of the issues a rule accepts on the URL in this crawl. */
  dismissed?: string[]
  accepted?: string[]
  /** `null`: the crawl was analysed before the audit state per URL was kept, or not analysed. */
  audit: CrawlUrlAudit | null
}

/** A rule as stored: with the domain it belongs to and when it was made. */
export type AuditRuleRecord = AuditRule & { domainId: string; createdAt: Date; updatedAt: Date }

export interface FindingStateRecord {
  id: string
  domainId: string
  issue: string
  urlHash: string | null
  targetKey: string
  state: 'in-progress' | 'dismissed' | 'pending'
  note: string
  setBy: string | null
  setAt: Date
}

export interface SetFindingStates {
  domainId: string
  issue: string
  urlHashes: (string | null)[]
  state: 'in-progress' | 'dismissed' | 'pending'
  note: string
  setBy: string
}

export interface AuditConfig {
  findingStates: FindingStateRecord[]
  /** Grows with every change to the rules. `0`: the domain never had any. */
  version: number
  /** Every rule of the domain, enabled or not, oldest first. */
  rules: AuditRuleRecord[]
  /** The language directories shared rules look at. None until the domain declares some. */
  languages: LanguageConfig
  /** The figures the domain set for its checks, where they differ from the defaults. */
  thresholds: ThresholdOverrides
  /** The last recalculation that gave up, if no change has been made since. */
  recomputeError: { message: string; version: number } | null
}

export type AuditMutation =
  | { ok: true; version: number; changed: boolean; rule?: AuditRuleRecord }
  | {
      ok: false
      /**
       * `conflict`: an enabled rule of that dimension already has that selector. `limit`: too many
       * rules. `not-found`: no such rule in the domain.
       */
      error: 'conflict' | 'not-found' | 'limit'
      key?: string
    }

/** What to do with the audit of a URL: leave it to the rules, or set it. */
export type UrlAuditChoice = 'inherit' | AuditValue
export type UrlIntentChoice = 'inherit' | IndexIntent
/** The same for each condition. A condition left out of the object is not touched. */
export type UrlConditionChoices = Partial<Record<AuditCondition, 'inherit' | Requirement>>

/**
 * What a rule says, statement by statement, as the editor shows it. A statement that is absent is
 * not made by the rule.
 */
export interface RuleStatements {
  /** Whether the URLs it covers take part in the audit. */
  audit?: AuditValue
  /** The expectation of indexing as a whole, an advanced concept apart from the conditions. */
  intent?: IntentRuleValue
  conditions?: Partial<Record<AuditCondition, Requirement>>
}

export interface AuditRepository {
  setFindingStates(input: SetFindingStates): Promise<AuditMutation>
  /**
   * The rules of a domain and the version they are at, read together: the version is read before
   * and after the rules, and the read repeats if it moved, so a version never labels other rules.
   */
  config(domainId: string): Promise<AuditConfig>

  /**
   * Every change below runs in one transaction that writes the rules, moves the version up (only if
   * something changed) and asks the worker to analyse the latest full crawl again (only if there is
   * one with results, and a request is not already waiting). Changes to one domain take turns.
   */

  /** Creates a rule, or replaces the one with `id`. */
  saveRule(input: { domainId: string; id?: string; rule: NewAuditRule }): Promise<AuditMutation>
  setRuleEnabled(input: { domainId: string; id: string; enabled: boolean }): Promise<AuditMutation>
  deleteRule(input: { domainId: string; id: string }): Promise<AuditMutation>
  /**
   * Sets what is declared for exact URLs, the one model behind the table, the detail and the
   * settings. `inherit` removes the statement about that URL (the rule that says it), and with it
   * the URL goes back to what the broader rules say for that statement alone. A statement left out
   * is not touched: the participation, the expectation and each condition are independent, and
   * saving never resets what was not edited. A `reason` left out keeps the one each exception has
   * (`planUrlConfig`). The URLs must be normalized and internal: the caller checked.
   */
  setUrlConfig(input: {
    domainId: string
    host: string
    urls: string[]
    audit?: UrlAuditChoice
    intent?: UrlIntentChoice
    conditions?: UrlConditionChoices
    reason?: string | null
  }): Promise<AuditMutation>
  /**
   * Saves one rule across its selectors, with one row per statement and selector. `editing` is a
   * set id or the selector of a legacy group; without it, creates a new rule. Kept selectors retain
   * row ids and removed selectors disappear (see `planSaveRuleSet`).
   */
  saveRuleSet(
    input: {
      domainId: string
      statements: RuleStatements
      reason: string | null
      enabled: boolean
      editing?: RuleEditing
    } & RuleSelectors,
  ): Promise<AuditMutation>
  /** Turns the rows of one rule on or off together: all or none. */
  setRulesEnabled(input: {
    domainId: string
    ids: string[]
    enabled: boolean
  }): Promise<AuditMutation>
  /** Removes the rows of one rule together: all or none. */
  deleteRules(input: { domainId: string; ids: string[] }): Promise<AuditMutation>
  /**
   * Declares the language directories shared rules look at. Moves the version only if they are not
   * these already.
   */
  setLanguages(input: { domainId: string; languages: LanguageConfig }): Promise<AuditMutation>
  /**
   * Sets the figures checks compare with (only those that differ from the defaults are kept). Like
   * a change of rules: the version moves and the latest crawl is analysed again.
   */
  setThresholds(input: { domainId: string; thresholds: ThresholdOverrides }): Promise<AuditMutation>
  /**
   * Brings the rules of every domain to the current meaning of a configuration (`AUDIT_SEMANTICS`)
   * from the one they have (`planUpgradeSemantics`): the rules that said `none` go, accepting
   * `nofollow` becomes the `nofollow` condition, and the version of each domain whose rules changed
   * moves, so that its latest crawl is analysed again. Runs once per meaning, when migrations are
   * applied; safe to repeat.
   */
  upgradeSemantics(): Promise<void>

  /** Asks again for the recalculation that failed: forgets the failure and queues the job. */
  retryRecompute(domainId: string): Promise<void>
  /** Records that the recalculation for `version` gave up. Ignored if the rules moved on since. */
  failRecompute(input: { domainId: string; version: number; error: string }): Promise<void>
  /** Forgets a failure of `version` or older: a recalculation for that version has succeeded. */
  clearRecomputeFailure(input: { domainId: string; version: number }): Promise<void>
}

/**
 * A recheck of some URLs of a domain, without a crawl (`url.verify` job). It never touches a crawl:
 * the last full crawl keeps what it found, and a recheck keeps what it found next to it.
 */
export interface Verification {
  id: string
  domainId: string
  status: VerificationStatus
  jobId: string
  /**
   * The full crawl the URLs were picked from, which is the one a recheck is compared with. Not a
   * reference: results per URL are pruned, the crawl remains.
   */
  baseCrawlId: string
  urlsCount: number
  urlsDoneCount: number
  error: string | null
  createdAt: Date
  startedAt: Date | null
  finishedAt: Date | null
}

/** A URL to recheck. `source` is how the full crawl found it, which a recheck keeps. */
export interface NewVerificationUrl {
  url: string
  urlHash: string
  source: CrawlUrlSource
}

/** What a rechecked URL answered: what a crawl keeps of an answer, except what is extracted. */
export type VerificationAnswer = Omit<CrawlUrlResult, 'data'>

export interface VerifiedUrl extends NewVerificationUrl, VerificationAnswer {
  verificationId: string
  state: VerificationUrlState
  /** The audit configuration the outcome was concluded under. `null` while queued. */
  auditVersion: number | null
  outcome: VerificationOutcome | null
  fetchedAt: Date | null
}

export interface VerificationRepository {
  /**
   * Creates a recheck, its URLs and the job that runs it, together. A domain has one active recheck
   * at most: returns `null`, creating nothing, if it already has one. Takes between 1 and
   * `MAX_VERIFICATION_URLS` URLs, once each, and rejects anything else.
   */
  start(input: {
    domainId: string
    baseCrawlId: string
    urls: NewVerificationUrl[]
  }): Promise<Verification | null>
  get(id: string): Promise<Verification | null>
  active(domainId: string): Promise<Verification | null>
  /** Newest first. */
  list(domainId: string, options?: { limit?: number }): Promise<Verification[]>
  /** Moves an active recheck to `running`. `null` when it is no longer active (e.g. cancelled). */
  markRunning(id: string): Promise<Verification | null>
  /** URLs still to be requested. */
  queued(verificationId: string, limit: number): Promise<NewVerificationUrl[]>
  /**
   * Stores what a URL answered and what was concluded from it, atomically, and counts it as done.
   * Writing it again replaces it. `false`, writing nothing, if the recheck is no longer active.
   */
  recordResult(input: {
    verificationId: string
    urlHash: string
    answer: VerificationAnswer
    auditVersion: number
    outcome: VerificationOutcome
  }): Promise<boolean>
  /** Every URL of a recheck, queued or done, sorted by URL. */
  urlsOf(verificationId: string): Promise<VerifiedUrl[]>
  /** Ends an active recheck. `false` if it had already ended. */
  finish(id: string, input: { status: 'completed' | 'failed'; error?: string }): Promise<boolean>
  /** `false` if the recheck had already ended. */
  cancel(id: string): Promise<boolean>
  /** Ends active rechecks whose job can no longer run them (out of attempts). Returns how many. */
  failOrphaned(): Promise<number>
  /**
   * For each of these URLs, its most recent finished result in any recheck of the domain. Another
   * domain's rechecks are never looked at, whatever the hashes.
   */
  latestFor(domainId: string, urlHashes: string[]): Promise<VerifiedUrl[]>
  /** Newest result of one URL from an ended recheck of this domain; reads at most one row. */
  latestFinishedFor(domainId: string, urlHash: string): Promise<VerifiedUrl | null>
  /** Removes the oldest ended rechecks of a domain beyond the newest `keep`, with their URLs. */
  prune(input: { domainId: string; keep: number }): Promise<number>
}

export interface PriorityUrl {
  domainId: string
  urlHash: string
  url: string
  createdAt: Date
}

export interface PriorityUrlRepository {
  /** Oldest first. */
  list(domainId: string): Promise<PriorityUrl[]>
  /** Adding a URL twice changes nothing. */
  add(input: { domainId: string; url: string }): Promise<void>
  remove(input: { domainId: string; urlHash: string }): Promise<void>
}

export type CrawlScheduleOutcome = 'started' | 'skipped-active' | 'skipped-empty'

export interface CrawlSchedule extends CrawlRecurrence {
  id: string
  domainId: string
  type: CrawlType
  enabled: boolean
  frequency: CrawlFrequency
  nextRunAt: Date
  lastRunAt: Date | null
  lastOutcome: CrawlScheduleOutcome | null
}

export interface CrawlScheduleRepository {
  list(domainId: string): Promise<CrawlSchedule[]>
  /** A domain has one schedule per crawl type: saving again replaces it. */
  save(
    input: CrawlRecurrence & {
      domainId: string
      type: CrawlType
      enabled: boolean
      nextRunAt: Date
    },
  ): Promise<void>
  due(input: { now: Date; limit: number }): Promise<CrawlSchedule[]>
  /** Moves a due schedule to its next run. Only one of several workers gets `true` for a run. */
  advance(input: {
    id: string
    expectedNextRunAt: Date
    nextRunAt: Date
    now: Date
  }): Promise<boolean>
  recordOutcome(input: { id: string; outcome: CrawlScheduleOutcome }): Promise<void>
}

/** An icon as the worker found it on the site. */
export interface FaviconImage {
  /** Sniffed from the bytes, not taken from the server's header. */
  contentType: string
  data: Buffer
  /** Where it was fetched from: a URL, or `data:` for an icon embedded in the page. */
  sourceUrl: string
}

export interface DomainFavicon extends FaviconImage {
  domainId: string
  /** Changes when the image does: it versions the URL the browser caches the icon under. */
  hash: string
}

export interface FaviconRepository {
  /** The icon of a domain, or `null` when it has none (or has not been checked yet). */
  get(domainId: string): Promise<DomainFavicon | null>
  /** The `hash` of the icon of every domain that has one, by domain id. */
  versions(): Promise<Map<string, string>>
  /** Domains never checked, or whose next check is due. Oldest domains first. */
  due(input: { now: Date; limit: number }): Promise<{ id: string; host: string }[]>
  /** Stores the outcome of a check. `icon: null` means the site has none. */
  save(input: { domainId: string; icon: FaviconImage | null; nextCheckAt: Date }): Promise<void>
  /** A check that could not tell (the site was unreachable): keeps the icon and tries again later. */
  defer(input: { domainId: string; nextCheckAt: Date }): Promise<void>
}

export type NewCrawlFile = CrawlFileObservation
export type CrawlFile = CrawlFileRecord

export type CrawlFileCheckOutcome = 'ok' | 'unreachable' | 'tls-error'

export interface CrawlFileCheck {
  domainId: string
  nextCheckAt: Date
  /** Someone asked for a refresh and it has not finished yet. */
  requestedAt: Date | null
  checkedAt: Date | null
  outcome: CrawlFileCheckOutcome | null
}

export interface CrawlFileRepository {
  /** Sorted by URL. All kinds unless told otherwise. */
  list(domainId: string, kinds?: readonly CrawlFileKind[]): Promise<CrawlFile[]>
  /** Each file replaces the row of its URL, if there is one. */
  save(domainId: string, files: NewCrawlFile[]): Promise<void>
  /** Removes the files no request reached since `before`: they are gone from the site. */
  prune(input: {
    domainId: string
    before: Date
    keepKinds?: readonly CrawlFileKind[]
  }): Promise<number>
  getCheck(domainId: string): Promise<CrawlFileCheck | null>
  /** Makes a domain due now, and flags that someone is waiting for the outcome. */
  requestCheck(input: { domainId: string; now: Date }): Promise<void>
  /** Domains never checked, or whose next check is due. Oldest domains first. */
  dueChecks(input: { now: Date; limit: number }): Promise<{ id: string; host: string }[]>
  /**
   * Takes a due check, moving it to `retryAt` in case this worker dies halfway. Only one of several
   * workers gets `true` for a check.
   */
  claimCheck(input: { domainId: string; now: Date; retryAt: Date }): Promise<boolean>
  /** Stores how a check went, and when the next one is due. */
  finishCheck(input: {
    domainId: string
    outcome: CrawlFileCheckOutcome
    checkedAt: Date
    nextCheckAt: Date
    files?: NewCrawlFile[]
  }): Promise<void>
  /** A check that did not happen (a crawl is taking care of it), so nobody waits for it. */
  deferCheck(input: { domainId: string; nextCheckAt: Date }): Promise<void>
}

export interface VitalsRecord extends VitalMetrics {
  crawlId: string
  formFactor: string
  status: string
  error: string | null
  collectedAt: Date
}
export interface UrlVitalsRecord extends VitalsRecord {
  urlHash: string
  source: string
}
export interface VitalsRepository {
  queueAlerts(crawlId: string): Promise<void>
  /** Latest finished full crawl with origin rows, including retained origin-only history. */
  latestCrawl(domainId: string, before?: Date): Promise<Crawl | null>
  origins(crawlId: string): Promise<VitalsRecord[]>
  urls(crawlId: string): Promise<UrlVitalsRecord[]>
  saveOrigin(row: VitalsRecord): Promise<void>
  saveUrl(row: UrlVitalsRecord): Promise<void>
}
export interface UserPreferencesRepository {
  favouriteDomainId(userId: string): Promise<string | null>
  setFavouriteDomain(userId: string, domainId: string | null): Promise<void>
  /** The saved interface language, or null to follow the browser. */
  locale(userId: string): Promise<string | null>
  setLocale(userId: string, locale: string | null): Promise<void>
}

export interface SiteIncident {
  id: string
  domainId: string
  kind: IncidentKind
  subject: string
  stage: IncidentStage
  activeKey: string | null
  openedAt: Date
  lastSeenAt: Date
  resolvedAt: Date | null
  details: string
}
export interface IncidentRepository {
  list(domainId: string, since?: Date): Promise<SiteIncident[]>
  get(id: string): Promise<SiteIncident | null>
  claim(incidentId: string, userId: string, stage: IncidentStage): Promise<boolean>
  release(incidentId: string, userId: string, stage: IncidentStage): Promise<void>
  prune(before: Date): Promise<void>
}
export interface Database {
  readonly incidents: IncidentRepository
  readonly userPreferences: UserPreferencesRepository
  readonly vitals: VitalsRepository
  readonly dialect: Dialect
  readonly jobs: JobRepository
  readonly heartbeats: HeartbeatRepository
  readonly settings: SettingsStore
  readonly admin: AdminRepository
  readonly users: UserRepository
  readonly mail: MailRepository
  readonly alerts: AlertRepository
  readonly companies: CompanyRepository
  readonly domains: DomainRepository
  readonly crawls: CrawlRepository
  readonly audit: AuditRepository
  readonly botTests: BotTestRepository
  readonly verifications: VerificationRepository
  readonly priorityUrls: PriorityUrlRepository
  readonly crawlSchedules: CrawlScheduleRepository
  readonly favicons: FaviconRepository
  readonly crawlFiles: CrawlFileRepository
  /** Drizzle instance and auth tables, for better-auth's drizzle adapter. */
  readonly orm: { db: unknown; schema: Record<string, unknown> }
  /** Rejects if the database is unreachable. */
  ping(): Promise<void>
  /** Rejects if the database has a migration `migrationsDir` does not know (default: the bundled ones). */
  checkMigrations(migrationsDir?: string): Promise<void>
  /**
   * Gives back to the disk the space a large removal left unused (old crawl results pruned): in
   * SQLite, a `VACUUM` when at least a quarter of the file and 64 MB are free; nothing in
   * PostgreSQL, whose autovacuum does it. Returns the bytes freed, or `null` when nothing was done.
   * Only while nothing else uses the database: bootstrap runs it before web and worker start.
   */
  compact(): Promise<number | null>
  /** Applies pending migrations from `migrationsDir` (default: the bundled ones). */
  migrate(migrationsDir?: string): Promise<void>
  close(): Promise<void>
}

export interface BotTestRun {
  id: string
  domainId: string
  jobId: string
  requestedBy: string
  activeKey: string | null
  status: 'queued' | 'running' | 'done' | 'failed' | 'cancelled'
  createdAt: Date
  startedAt: Date | null
  finishedAt: Date | null
}
export interface BotTestResult extends BotAnswer, BotVerdict {
  runId: string
  botToken: string
  responseTimeMs: number | null
  bytes: number | null
}
export interface BotTestRepository {
  start(input: { domainId: string; requestedBy: string }): Promise<BotTestRun | null>
  get(id: string): Promise<BotTestRun | null>
  active(domainId: string): Promise<BotTestRun | null>
  list(domainId: string): Promise<BotTestRun[]>
  markRunning(id: string): Promise<void>
  results(id: string): Promise<BotTestResult[]>
  record(input: BotTestResult): Promise<void>
  finish(id: string, status: 'done' | 'failed' | 'cancelled'): Promise<void>
}
