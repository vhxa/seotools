import type {
  CrawlFileData,
  CrawlFileKind,
  ExtraCrawlFileKind,
  CrawlFrequency,
  CrawlLinkKind,
  CrawlPageData,
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
  EnqueueInput,
  Job,
  JobStatus,
  SettingsStore,
  PagesByWorstIssue,
} from '@seotools/core'

export type Dialect = 'sqlite' | 'pg' | 'mysql'

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
  /** Hands a job back unfinished (worker shutting down): `pending`, not counted as an attempt. */
  release(input: { id: string; workerId: string }): Promise<void>
  /** Recovers jobs whose worker died: back to `pending`, or `failed` if out of attempts. */
  requeueStale(input: { lockedBefore: Date }): Promise<number>
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
  create(input: { name: string; host: string }): Promise<{ company: Company; domain: Domain }>
}

export interface DomainRepository {
  get(id: string): Promise<Domain | null>
  findByHost(host: string): Promise<DomainWithCompany | null>
  /** Rejects if the host is already taken or the company does not exist. */
  add(input: { companyId: string; host: string }): Promise<Domain>
}

export interface Crawl {
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
   * Pages by the worst type of issue they have (`PAGE_ISSUES` in @seotools/core). `null` when the
   * crawl has not been analysed. `pagesWithIssues` says how many count, given a domain's threshold;
   * the rest of `pagesCount` are correct. Survives pruning.
   */
  pagesByWorstIssue: PagesByWorstIssue | null
  robots: CrawlRobotsFiles | null
  /** The results per URL were removed by the domain's retention setting; the counts remain. */
  pruned: boolean
  error: string | null
  createdAt: Date
  startedAt: Date | null
  finishedAt: Date | null
}

export type CrawlCounts = Pick<
  Crawl,
  'pagesCount' | 'urlsCount' | 'urlsDoneCount' | 'externalCount'
>

export interface NewCrawlUrl {
  url: string
  urlHash: string
  scope: CrawlUrlScope
  source: CrawlUrlSource
  depth: number
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

export interface CrawlUrl extends NewCrawlUrl, CrawlUrlResult {
  crawlId: string
  state: CrawlUrlState
  fetchedAt: Date | null
}

export interface CrawlLink {
  sourceHash: string
  targetHash: string
  kind: CrawlLinkKind
}

/** `pages`: URLs of the site that are pages. `other`: the rest of the site. `external`: elsewhere. */
export type CrawlUrlView = 'pages' | 'other' | 'external'

/** What a list of URLs can be ordered by. Without one, shallowest first, then by URL. */
export type CrawlUrlSort = 'url' | 'title' | 'status' | 'depth' | 'responseTime' | 'bytes'

/** Which URLs of a crawl a list shows. */
export interface CrawlUrlQuery {
  crawlId: string
  view: CrawlUrlView
  /** Text the URL or the title contains, whatever its case. */
  search?: string
  /**
   * Only URLs that have this issue (an id from `PAGE_ISSUES`), whichever `view` they are in: issues
   * are not only for pages, and a broken link is not even on this site.
   */
  issue?: string
}

/** An issue found on a URL of a crawl. */
export interface CrawlUrlIssue {
  urlHash: string
  issue: string
  /** What `PAGE_ISSUES` says this issue details. Absent when it details nothing. */
  details?: string[]
}

/** A hreflang alternate that a sitemap declares for a page. */
export interface SitemapHreflang {
  pageHash: string
  lang: string
  url: string
}

export interface CrawlRepository {
  /** The saved settings of a domain, or the defaults if it has none. */
  settings(domainId: string): Promise<CrawlSettings>
  saveSettings(domainId: string, settings: CrawlSettings): Promise<void>
  /** The extra crawl files each domain turned on, by domain id. Domains with none are left out. */
  enabledFiles(): Promise<Map<string, ExtraCrawlFileKind[]>>

  /**
   * Creates a crawl and the job that runs it, together. A domain has one active crawl at most:
   * returns `null`, creating nothing, if it already has one.
   */
  start(input: { domainId: string; type: CrawlType; trigger: CrawlTrigger }): Promise<Crawl | null>
  get(id: string): Promise<Crawl | null>
  active(domainId: string): Promise<Crawl | null>
  /** Newest first. Every type unless told otherwise. */
  list(domainId: string, options?: { limit?: number; type?: CrawlType }): Promise<Crawl[]>
  /** The newest crawl of a type that finished with usable results. */
  latestWithResults(domainId: string, type: CrawlType): Promise<Crawl | null>
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
   */
  prune(input: { domainId: string; type: CrawlType; keep: number | null }): Promise<number>

  /** Adds URLs to a crawl, ignoring those it already has. */
  addUrls(crawlId: string, urls: NewCrawlUrl[]): Promise<void>
  /** URLs waiting to be requested, shallowest first. */
  nextQueued(crawlId: string, limit: number): Promise<NewCrawlUrl[]>
  /** Every URL of the crawl, to pick up where a previous attempt left off. */
  knownUrls(crawlId: string): Promise<{ urlHash: string; scope: CrawlUrlScope }[]>
  /** Stores what a request returned along with the URLs and links found in it, atomically. */
  recordResult(input: {
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
  /** One URL of a crawl, or `null` if the crawl does not have it. */
  getUrl(crawlId: string, urlHash: string): Promise<CrawlUrl | null>
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
   * Replaces the issues of a crawl with these and records how many pages have each type as their
   * worst, which also marks the crawl as analysed.
   */
  saveIssues(input: {
    crawlId: string
    issues: CrawlUrlIssue[]
    pages: PagesByWorstIssue
  }): Promise<void>
  /** For each issue found in a crawl, how many URLs have it. Issues nobody has are left out. */
  issueCounts(crawlId: string): Promise<{ issue: string; pages: number }[]>
  /** The issues of these URLs of a crawl. URLs without issues have no entry. */
  issuesOf(crawlId: string, urlHashes: string[]): Promise<CrawlUrlIssue[]>
  /** For each hash that has one, the most recent result in any retained crawl of the domain. */
  latestResults(domainId: string, urlHashes: string[]): Promise<CrawlUrl[]>
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

/** What a request for a crawl file answered. */
export interface NewCrawlFile {
  url: string
  kind: CrawlFileKind
  /** `null` when it never answered: see `error`. */
  statusCode: number | null
  contentType: string | null
  redirectTo: string | null
  bytes: number | null
  /** The file is larger than what was read or kept of it. */
  truncated: boolean
  body: string | null
  error: string | null
  data: CrawlFileData | null
  /** What requested it. */
  via: 'crawl' | 'refresh'
  fetchedAt: Date
}

export interface CrawlFile extends NewCrawlFile {
  domainId: string
  urlHash: string
}

export type CrawlFileCheckOutcome = 'ok' | 'unreachable'

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
  }): Promise<void>
  /** A check that did not happen (a crawl is taking care of it), so nobody waits for it. */
  deferCheck(input: { domainId: string; nextCheckAt: Date }): Promise<void>
}

export interface Database {
  readonly dialect: Dialect
  readonly jobs: JobRepository
  readonly heartbeats: HeartbeatRepository
  readonly settings: SettingsStore
  readonly admin: AdminRepository
  readonly companies: CompanyRepository
  readonly domains: DomainRepository
  readonly crawls: CrawlRepository
  readonly priorityUrls: PriorityUrlRepository
  readonly crawlSchedules: CrawlScheduleRepository
  readonly favicons: FaviconRepository
  readonly crawlFiles: CrawlFileRepository
  /** Drizzle instance and auth tables, for better-auth's drizzle adapter. */
  readonly orm: { db: unknown; schema: Record<string, unknown> }
  /** Rejects if the database is unreachable. */
  ping(): Promise<void>
  /** Applies pending migrations from `migrationsDir` (default: the bundled ones). */
  migrate(migrationsDir?: string): Promise<void>
  close(): Promise<void>
}
