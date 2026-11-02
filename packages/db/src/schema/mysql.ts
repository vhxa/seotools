import {
  boolean,
  datetime,
  index,
  int,
  longtext,
  mysqlTable,
  primaryKey,
  text,
  uniqueIndex,
  varchar,
} from 'drizzle-orm/mysql-core'

const ts = (name: string) => datetime(name, { mode: 'date', fsp: 3 })
const id = (name: string) => varchar(name, { length: 36 })
const now = () => new Date()

// --- better-auth ---------------------------------------------------------
export const user = mysqlTable('user', {
  id: id('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  email: varchar('email', { length: 255 }).notNull().unique(),
  emailVerified: boolean('email_verified').notNull().default(false),
  image: text('image'),
  createdAt: ts('created_at').notNull().$defaultFn(now),
  updatedAt: ts('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
})

export const session = mysqlTable(
  'session',
  {
    id: id('id').primaryKey(),
    expiresAt: ts('expires_at').notNull(),
    token: varchar('token', { length: 255 }).notNull().unique(),
    createdAt: ts('created_at').notNull().$defaultFn(now),
    updatedAt: ts('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
    ipAddress: varchar('ip_address', { length: 255 }),
    userAgent: text('user_agent'),
    userId: id('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('session_user_id_idx').on(t.userId)],
)

export const account = mysqlTable(
  'account',
  {
    id: id('id').primaryKey(),
    accountId: varchar('account_id', { length: 255 }).notNull(),
    providerId: varchar('provider_id', { length: 255 }).notNull(),
    userId: id('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    accessToken: text('access_token'),
    refreshToken: text('refresh_token'),
    idToken: text('id_token'),
    accessTokenExpiresAt: ts('access_token_expires_at'),
    refreshTokenExpiresAt: ts('refresh_token_expires_at'),
    scope: text('scope'),
    password: text('password'),
    createdAt: ts('created_at').notNull().$defaultFn(now),
    updatedAt: ts('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
  },
  (t) => [index('account_user_id_idx').on(t.userId)],
)

export const verification = mysqlTable(
  'verification',
  {
    id: id('id').primaryKey(),
    identifier: varchar('identifier', { length: 255 }).notNull(),
    value: text('value').notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull().$defaultFn(now),
    updatedAt: ts('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
)

// --- app -----------------------------------------------------------------
export const jobs = mysqlTable(
  'jobs',
  {
    id: id('id').primaryKey(),
    type: varchar('type', { length: 191 }).notNull(),
    payload: longtext('payload').notNull(),
    status: varchar('status', { length: 16, enum: ['pending', 'running', 'completed', 'failed'] })
      .notNull()
      .default('pending'),
    attempts: int('attempts').notNull().default(0),
    maxAttempts: int('max_attempts').notNull().default(3),
    runAt: ts('run_at').notNull().$defaultFn(now),
    lockedAt: ts('locked_at'),
    lockedBy: varchar('locked_by', { length: 191 }),
    lastError: text('last_error'),
    result: longtext('result'),
    createdAt: ts('created_at').notNull().$defaultFn(now),
    updatedAt: ts('updated_at').notNull().$defaultFn(now),
  },
  (t) => [
    index('jobs_claim_idx').on(t.status, t.runAt, t.createdAt),
    index('jobs_created_idx').on(t.createdAt),
  ],
)

export const workerHeartbeats = mysqlTable('worker_heartbeats', {
  workerId: varchar('worker_id', { length: 191 }).primaryKey(),
  startedAt: ts('started_at').notNull(),
  lastSeenAt: ts('last_seen_at').notNull(),
})

export const settings = mysqlTable('settings', {
  key: varchar('key', { length: 191 }).primaryKey(),
  value: longtext('value').notNull(),
  encrypted: boolean('encrypted').notNull().default(false),
  updatedAt: ts('updated_at').notNull().$defaultFn(now),
})

export const companies = mysqlTable('companies', {
  id: id('id').primaryKey(),
  name: varchar('name', { length: 255 }).notNull(),
  createdAt: ts('created_at').notNull().$defaultFn(now),
})

export const domains = mysqlTable(
  'domains',
  {
    id: id('id').primaryKey(),
    companyId: id('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    /** Normalized by `normalizeDomain` in @seotools/core: `example.com`, never a URL. */
    host: varchar('host', { length: 253 }).notNull().unique(),
    createdAt: ts('created_at').notNull().$defaultFn(now),
  },
  (t) => [index('domains_company_id_idx').on(t.companyId)],
)

/**
 * The icon of a domain, fetched by the worker from the site itself. A row exists once the domain
 * has been checked: `data` is `null` when the site has no icon. `data` is base64 so the three
 * dialects store it as plain text.
 */
export const domainFavicons = mysqlTable(
  'domain_favicons',
  {
    domainId: id('domain_id')
      .primaryKey()
      .references(() => domains.id, { onDelete: 'cascade' }),
    contentType: varchar('content_type', { length: 100 }),
    data: longtext('data'),
    /** Changes when the image does: it versions the URL the browser caches the icon under. */
    hash: varchar('hash', { length: 64 }),
    sourceUrl: text('source_url'),
    nextCheckAt: ts('next_check_at').notNull(),
  },
  (t) => [index('domain_favicons_due_idx').on(t.nextCheckAt)],
)

/** One row per domain once its crawl settings have been saved; until then, the defaults apply. */
export const crawlSettings = mysqlTable('crawl_settings', {
  domainId: id('domain_id')
    .primaryKey()
    .references(() => domains.id, { onDelete: 'cascade' }),
  renderingMode: varchar('rendering_mode', { length: 16, enum: ['http', 'headless', 'both'] })
    .notNull()
    .default('http'),
  userAgent: varchar('user_agent', { length: 255 }),
  concurrency: int('concurrency').notNull(),
  requestsPerSecond: int('requests_per_second').notNull(),
  timeoutMs: int('timeout_ms').notNull(),
  maxRetries: int('max_retries').notNull(),
  /** `null` means no limit. */
  maxUrls: int('max_urls'),
  /** `null` keeps the results of every crawl. */
  retainCrawls: int('retain_crawls'),
  /** JSON array of `OptionalCrawlFile`. `null`: none. */
  optionalFiles: longtext('optional_files'),
  indexNowKey: varchar('index_now_key', { length: 128 }),
  updatedAt: ts('updated_at').notNull().$defaultFn(now),
})

export const crawlSchedules = mysqlTable(
  'crawl_schedules',
  {
    id: id('id').primaryKey(),
    domainId: id('domain_id')
      .notNull()
      .references(() => domains.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 16, enum: ['full', 'priority'] }).notNull(),
    enabled: boolean('enabled').notNull(),
    frequency: varchar('frequency', {
      length: 16,
      enum: ['hourly', 'daily', 'weekly', 'monthly'],
    }).notNull(),
    hour: int('hour').notNull(),
    minute: int('minute').notNull(),
    dayOfWeek: int('day_of_week').notNull(),
    dayOfMonth: int('day_of_month').notNull(),
    timeZone: varchar('time_zone', { length: 100 }).notNull(),
    nextRunAt: ts('next_run_at').notNull(),
    lastRunAt: ts('last_run_at'),
    lastOutcome: varchar('last_outcome', {
      length: 16,
      enum: ['started', 'skipped-active', 'skipped-empty'],
    }),
    updatedAt: ts('updated_at').notNull().$defaultFn(now),
  },
  (t) => [
    uniqueIndex('crawl_schedules_domain_type_idx').on(t.domainId, t.type),
    index('crawl_schedules_due_idx').on(t.enabled, t.nextRunAt),
  ],
)

export const crawls = mysqlTable(
  'crawls',
  {
    id: id('id').primaryKey(),
    domainId: id('domain_id')
      .notNull()
      .references(() => domains.id, { onDelete: 'cascade' }),
    type: varchar('type', { length: 16, enum: ['full', 'priority'] }).notNull(),
    status: varchar('status', {
      length: 16,
      enum: ['pending', 'running', 'completed', 'incomplete', 'failed', 'cancelled'],
    })
      .notNull()
      .default('pending'),
    trigger: varchar('trigger', { length: 16, enum: ['manual', 'schedule'] }).notNull(),
    jobId: id('job_id').notNull(),
    /** The domain id while the crawl is active, `null` after: unique, so one per domain at most. */
    activeKey: id('active_key').unique(),
    pagesCount: int('pages_count').notNull().default(0),
    urlsCount: int('urls_count').notNull().default(0),
    urlsDoneCount: int('urls_done_count').notNull().default(0),
    externalCount: int('external_count').notNull().default(0),
    robots: longtext('robots'),
    /**
     * Pages by the worst type of issue they have, so that what counts as "with issues" can change
     * without analysing again. `null`: the crawl was not analysed (yet).
     */
    pagesWorstIssueCount: int('pages_worst_issue_count'),
    pagesWorstWarningCount: int('pages_worst_warning_count'),
    pagesWorstOpportunityCount: int('pages_worst_opportunity_count'),
    pagesWithIssueCount: int('pages_with_issue_count'),
    pagesWithWarningCount: int('pages_with_warning_count'),
    pagesWithOpportunityCount: int('pages_with_opportunity_count'),
    /** `ISSUE_CATALOG_VERSION` the issues were found with. `null`: not analysed. */
    issueCatalog: varchar('issue_catalog', { length: 64 }),
    /** Whether the results per URL were pruned by the domain's retention setting. */
    pruned: boolean('pruned').notNull().default(false),
    error: text('error'),
    createdAt: ts('created_at').notNull().$defaultFn(now),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
  },
  (t) => [index('crawls_domain_created_idx').on(t.domainId, t.type, t.createdAt)],
)

/** Every URL of a crawl: the queue of what is left to fetch, and the result of what was. */
export const crawlUrls = mysqlTable(
  'crawl_urls',
  {
    crawlId: id('crawl_id')
      .notNull()
      .references(() => crawls.id, { onDelete: 'cascade' }),
    urlHash: varchar('url_hash', { length: 32 }).notNull(),
    url: text('url').notNull(),
    scope: varchar('scope', { length: 16, enum: ['internal', 'external'] }).notNull(),
    state: varchar('state', { length: 16, enum: ['queued', 'done', 'skipped'] }).notNull(),
    kind: varchar('kind', { length: 16, enum: ['page', 'redirect', 'resource', 'unknown'] })
      .notNull()
      .default('unknown'),
    source: varchar('source', { length: 16 }).notNull(),
    depth: int('depth').notNull(),
    statusCode: int('status_code'),
    contentType: varchar('content_type', { length: 255 }),
    redirectTo: text('redirect_to'),
    title: text('title'),
    metaRobots: text('meta_robots'),
    xRobotsTag: text('x_robots_tag'),
    canonical: text('canonical'),
    responseTimeMs: int('response_time_ms'),
    bytes: int('bytes'),
    error: text('error'),
    /** JSON (`CrawlPageData`): everything extracted that has no column of its own. */
    data: longtext('data'),
    fetchedAt: ts('fetched_at'),
  },
  (t) => [
    primaryKey({ columns: [t.crawlId, t.urlHash] }),
    index('crawl_urls_queue_idx').on(t.crawlId, t.state, t.depth),
    index('crawl_urls_view_idx').on(t.crawlId, t.scope, t.kind, t.depth),
    index('crawl_urls_hash_idx').on(t.urlHash),
  ],
)

/** Which URL of a crawl links to which, and how. External targets are recorded here too. */
export const crawlLinks = mysqlTable(
  'crawl_links',
  {
    crawlId: id('crawl_id')
      .notNull()
      .references(() => crawls.id, { onDelete: 'cascade' }),
    sourceHash: varchar('source_hash', { length: 32 }).notNull(),
    targetHash: varchar('target_hash', { length: 32 }).notNull(),
    kind: varchar('kind', { length: 16 }).notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.crawlId, t.sourceHash, t.targetHash, t.kind] }),
    index('crawl_links_target_idx').on(t.crawlId, t.targetHash),
  ],
)

/**
 * The issues each page of a crawl had (`PAGE_ISSUES` in @seotools/core), written when the crawl
 * ends. A page without a row is correct. Removed along with the results per URL of old crawls.
 */
export const crawlUrlIssues = mysqlTable(
  'crawl_url_issues',
  {
    crawlId: id('crawl_id')
      .notNull()
      .references(() => crawls.id, { onDelete: 'cascade' }),
    urlHash: varchar('url_hash', { length: 32 }).notNull(),
    issue: varchar('issue', { length: 64 }).notNull(),
    /** JSON array of what `PAGE_ISSUES` says the issue details, e.g. which headers are missing. */
    details: longtext('details'),
  },
  (t) => [
    primaryKey({ columns: [t.crawlId, t.urlHash, t.issue] }),
    index('crawl_url_issues_issue_idx').on(t.crawlId, t.issue),
  ],
)

/**
 * The hreflang alternates sitemaps declare for each page. A sitemap holds up to 50,000 pages with
 * several alternates each, too much for the JSON of the sitemap's own row.
 */
export const crawlSitemapHreflang = mysqlTable(
  'crawl_sitemap_hreflang',
  {
    crawlId: id('crawl_id')
      .notNull()
      .references(() => crawls.id, { onDelete: 'cascade' }),
    pageHash: varchar('page_hash', { length: 32 }).notNull(),
    lang: varchar('lang', { length: 35 }).notNull(),
    targetHash: varchar('target_hash', { length: 32 }).notNull(),
    url: text('url').notNull(),
  },
  (t) => [primaryKey({ columns: [t.crawlId, t.pageHash, t.lang, t.targetHash] })],
)

/** The URLs marked as priority from the panel. They survive crawls, so they hang off the domain. */
export const priorityUrls = mysqlTable(
  'priority_urls',
  {
    domainId: id('domain_id')
      .notNull()
      .references(() => domains.id, { onDelete: 'cascade' }),
    urlHash: varchar('url_hash', { length: 32 }).notNull(),
    url: text('url').notNull(),
    createdAt: ts('created_at').notNull().$defaultFn(now),
  },
  (t) => [primaryKey({ columns: [t.domainId, t.urlHash] })],
)

/**
 * What a domain's files for crawlers answered the last time they were requested, by a crawl or a
 * refresh. There is no history: each request replaces the row of its URL.
 */
export const crawlFiles = mysqlTable(
  'crawl_files',
  {
    domainId: id('domain_id')
      .notNull()
      .references(() => domains.id, { onDelete: 'cascade' }),
    urlHash: varchar('url_hash', { length: 32 }).notNull(),
    url: text('url').notNull(),
    kind: varchar('kind', { length: 32 }).notNull(),
    statusCode: int('status_code'),
    contentType: varchar('content_type', { length: 255 }),
    redirectTo: text('redirect_to'),
    bytes: int('bytes'),
    /** The file is larger than what was read or kept of it. */
    truncated: boolean('truncated').notNull().default(false),
    /** Sitemaps have no body here: they can be huge, and `data` says what matters of them. */
    body: longtext('body'),
    error: text('error'),
    /** JSON (`CrawlFileData`). */
    data: longtext('data'),
    via: varchar('via', { length: 16, enum: ['crawl', 'refresh'] }).notNull(),
    fetchedAt: ts('fetched_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.domainId, t.urlHash] }),
    index('crawl_files_kind_idx').on(t.domainId, t.kind),
  ],
)

/** When a domain's files are next refreshed. A domain without a row is due at once. */
export const crawlFileChecks = mysqlTable(
  'crawl_file_checks',
  {
    domainId: id('domain_id')
      .primaryKey()
      .references(() => domains.id, { onDelete: 'cascade' }),
    nextCheckAt: ts('next_check_at').notNull(),
    /** Someone asked for a refresh and it has not finished yet. */
    requestedAt: ts('requested_at'),
    checkedAt: ts('checked_at'),
    /** How the last refresh went. */
    outcome: varchar('outcome', { length: 16, enum: ['ok', 'unreachable'] }),
  },
  (t) => [index('crawl_file_checks_due_idx').on(t.nextCheckAt)],
)
