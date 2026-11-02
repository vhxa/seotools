import { index, integer, primaryKey, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core'

const ts = (name: string) => integer(name, { mode: 'timestamp_ms' })
const now = () => new Date()

// --- better-auth ---------------------------------------------------------
export const user = sqliteTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: integer('email_verified', { mode: 'boolean' }).notNull().default(false),
  image: text('image'),
  createdAt: ts('created_at').notNull().$defaultFn(now),
  updatedAt: ts('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
})

export const session = sqliteTable(
  'session',
  {
    id: text('id').primaryKey(),
    expiresAt: ts('expires_at').notNull(),
    token: text('token').notNull().unique(),
    createdAt: ts('created_at').notNull().$defaultFn(now),
    updatedAt: ts('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
    ipAddress: text('ip_address'),
    userAgent: text('user_agent'),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
  },
  (t) => [index('session_user_id_idx').on(t.userId)],
)

export const account = sqliteTable(
  'account',
  {
    id: text('id').primaryKey(),
    accountId: text('account_id').notNull(),
    providerId: text('provider_id').notNull(),
    userId: text('user_id')
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

export const verification = sqliteTable(
  'verification',
  {
    id: text('id').primaryKey(),
    identifier: text('identifier').notNull(),
    value: text('value').notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull().$defaultFn(now),
    updatedAt: ts('updated_at').notNull().$defaultFn(now).$onUpdateFn(now),
  },
  (t) => [index('verification_identifier_idx').on(t.identifier)],
)

// --- app -----------------------------------------------------------------
export const jobs = sqliteTable(
  'jobs',
  {
    id: text('id').primaryKey(),
    type: text('type').notNull(),
    payload: text('payload').notNull().default('{}'),
    status: text('status', { enum: ['pending', 'running', 'completed', 'failed'] })
      .notNull()
      .default('pending'),
    attempts: integer('attempts').notNull().default(0),
    maxAttempts: integer('max_attempts').notNull().default(3),
    runAt: ts('run_at').notNull().$defaultFn(now),
    lockedAt: ts('locked_at'),
    lockedBy: text('locked_by'),
    lastError: text('last_error'),
    result: text('result'),
    createdAt: ts('created_at').notNull().$defaultFn(now),
    updatedAt: ts('updated_at').notNull().$defaultFn(now),
  },
  (t) => [
    index('jobs_claim_idx').on(t.status, t.runAt, t.createdAt),
    index('jobs_created_idx').on(t.createdAt),
  ],
)

export const workerHeartbeats = sqliteTable('worker_heartbeats', {
  workerId: text('worker_id').primaryKey(),
  startedAt: ts('started_at').notNull(),
  lastSeenAt: ts('last_seen_at').notNull(),
})

export const settings = sqliteTable('settings', {
  key: text('key').primaryKey(),
  value: text('value').notNull(),
  encrypted: integer('encrypted', { mode: 'boolean' }).notNull().default(false),
  updatedAt: ts('updated_at').notNull().$defaultFn(now),
})

export const companies = sqliteTable('companies', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  createdAt: ts('created_at').notNull().$defaultFn(now),
})

export const domains = sqliteTable(
  'domains',
  {
    id: text('id').primaryKey(),
    companyId: text('company_id')
      .notNull()
      .references(() => companies.id, { onDelete: 'cascade' }),
    /** Normalized by `normalizeDomain` in @seotools/core: `example.com`, never a URL. */
    host: text('host').notNull().unique(),
    createdAt: ts('created_at').notNull().$defaultFn(now),
  },
  (t) => [index('domains_company_id_idx').on(t.companyId)],
)

/**
 * The icon of a domain, fetched by the worker from the site itself. A row exists once the domain
 * has been checked: `data` is `null` when the site has no icon. `data` is base64 so the three
 * dialects store it as plain text.
 */
export const domainFavicons = sqliteTable(
  'domain_favicons',
  {
    domainId: text('domain_id')
      .primaryKey()
      .references(() => domains.id, { onDelete: 'cascade' }),
    contentType: text('content_type'),
    data: text('data'),
    /** Changes when the image does: it versions the URL the browser caches the icon under. */
    hash: text('hash'),
    sourceUrl: text('source_url'),
    nextCheckAt: ts('next_check_at').notNull(),
  },
  (t) => [index('domain_favicons_due_idx').on(t.nextCheckAt)],
)

/** One row per domain once its crawl settings have been saved; until then, the defaults apply. */
export const crawlSettings = sqliteTable('crawl_settings', {
  domainId: text('domain_id')
    .primaryKey()
    .references(() => domains.id, { onDelete: 'cascade' }),
  renderingMode: text('rendering_mode', { enum: ['http', 'headless', 'both'] })
    .notNull()
    .default('http'),
  userAgent: text('user_agent'),
  concurrency: integer('concurrency').notNull(),
  requestsPerSecond: integer('requests_per_second').notNull(),
  timeoutMs: integer('timeout_ms').notNull(),
  maxRetries: integer('max_retries').notNull(),
  /** `null` means no limit. */
  maxUrls: integer('max_urls'),
  /** `null` keeps the results of every crawl. */
  retainCrawls: integer('retain_crawls'),
  /** JSON array of `OptionalCrawlFile`. `null`: none. */
  optionalFiles: text('optional_files'),
  indexNowKey: text('index_now_key'),
  updatedAt: ts('updated_at').notNull().$defaultFn(now),
})

export const crawlSchedules = sqliteTable(
  'crawl_schedules',
  {
    id: text('id').primaryKey(),
    domainId: text('domain_id')
      .notNull()
      .references(() => domains.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['full', 'priority'] }).notNull(),
    enabled: integer('enabled', { mode: 'boolean' }).notNull(),
    frequency: text('frequency', { enum: ['hourly', 'daily', 'weekly', 'monthly'] }).notNull(),
    hour: integer('hour').notNull(),
    minute: integer('minute').notNull(),
    dayOfWeek: integer('day_of_week').notNull(),
    dayOfMonth: integer('day_of_month').notNull(),
    timeZone: text('time_zone').notNull(),
    nextRunAt: ts('next_run_at').notNull(),
    lastRunAt: ts('last_run_at'),
    lastOutcome: text('last_outcome', { enum: ['started', 'skipped-active', 'skipped-empty'] }),
    updatedAt: ts('updated_at').notNull().$defaultFn(now),
  },
  (t) => [
    uniqueIndex('crawl_schedules_domain_type_idx').on(t.domainId, t.type),
    index('crawl_schedules_due_idx').on(t.enabled, t.nextRunAt),
  ],
)

export const crawls = sqliteTable(
  'crawls',
  {
    id: text('id').primaryKey(),
    domainId: text('domain_id')
      .notNull()
      .references(() => domains.id, { onDelete: 'cascade' }),
    type: text('type', { enum: ['full', 'priority'] }).notNull(),
    status: text('status', {
      enum: ['pending', 'running', 'completed', 'incomplete', 'failed', 'cancelled'],
    })
      .notNull()
      .default('pending'),
    trigger: text('trigger', { enum: ['manual', 'schedule'] }).notNull(),
    jobId: text('job_id').notNull(),
    /** The domain id while the crawl is active, `null` after: unique, so one per domain at most. */
    activeKey: text('active_key').unique(),
    pagesCount: integer('pages_count').notNull().default(0),
    urlsCount: integer('urls_count').notNull().default(0),
    urlsDoneCount: integer('urls_done_count').notNull().default(0),
    externalCount: integer('external_count').notNull().default(0),
    robots: text('robots'),
    /**
     * Pages by the worst type of issue they have, so that what counts as "with issues" can change
     * without analysing again. `null`: the crawl was not analysed (yet).
     */
    pagesWorstIssueCount: integer('pages_worst_issue_count'),
    pagesWorstWarningCount: integer('pages_worst_warning_count'),
    pagesWorstOpportunityCount: integer('pages_worst_opportunity_count'),
    pagesWithIssueCount: integer('pages_with_issue_count'),
    pagesWithWarningCount: integer('pages_with_warning_count'),
    pagesWithOpportunityCount: integer('pages_with_opportunity_count'),
    /** `ISSUE_CATALOG_VERSION` the issues were found with. `null`: not analysed. */
    issueCatalog: text('issue_catalog'),
    /** Whether the results per URL were pruned by the domain's retention setting. */
    pruned: integer('pruned', { mode: 'boolean' }).notNull().default(false),
    error: text('error'),
    createdAt: ts('created_at').notNull().$defaultFn(now),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
  },
  (t) => [index('crawls_domain_created_idx').on(t.domainId, t.type, t.createdAt)],
)

/** Every URL of a crawl: the queue of what is left to fetch, and the result of what was. */
export const crawlUrls = sqliteTable(
  'crawl_urls',
  {
    crawlId: text('crawl_id')
      .notNull()
      .references(() => crawls.id, { onDelete: 'cascade' }),
    urlHash: text('url_hash').notNull(),
    url: text('url').notNull(),
    scope: text('scope', { enum: ['internal', 'external'] }).notNull(),
    state: text('state', { enum: ['queued', 'done', 'skipped'] }).notNull(),
    kind: text('kind', { enum: ['page', 'redirect', 'resource', 'unknown'] })
      .notNull()
      .default('unknown'),
    source: text('source').notNull(),
    depth: integer('depth').notNull(),
    statusCode: integer('status_code'),
    contentType: text('content_type'),
    redirectTo: text('redirect_to'),
    title: text('title'),
    metaRobots: text('meta_robots'),
    xRobotsTag: text('x_robots_tag'),
    canonical: text('canonical'),
    responseTimeMs: integer('response_time_ms'),
    bytes: integer('bytes'),
    error: text('error'),
    /** JSON (`CrawlPageData`): everything extracted that has no column of its own. */
    data: text('data'),
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
export const crawlLinks = sqliteTable(
  'crawl_links',
  {
    crawlId: text('crawl_id')
      .notNull()
      .references(() => crawls.id, { onDelete: 'cascade' }),
    sourceHash: text('source_hash').notNull(),
    targetHash: text('target_hash').notNull(),
    kind: text('kind').notNull(),
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
export const crawlUrlIssues = sqliteTable(
  'crawl_url_issues',
  {
    crawlId: text('crawl_id')
      .notNull()
      .references(() => crawls.id, { onDelete: 'cascade' }),
    urlHash: text('url_hash').notNull(),
    issue: text('issue').notNull(),
    /** JSON array of what `PAGE_ISSUES` says the issue details, e.g. which headers are missing. */
    details: text('details'),
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
export const crawlSitemapHreflang = sqliteTable(
  'crawl_sitemap_hreflang',
  {
    crawlId: text('crawl_id')
      .notNull()
      .references(() => crawls.id, { onDelete: 'cascade' }),
    pageHash: text('page_hash').notNull(),
    lang: text('lang').notNull(),
    targetHash: text('target_hash').notNull(),
    url: text('url').notNull(),
  },
  (t) => [primaryKey({ columns: [t.crawlId, t.pageHash, t.lang, t.targetHash] })],
)

/** The URLs marked as priority from the panel. They survive crawls, so they hang off the domain. */
export const priorityUrls = sqliteTable(
  'priority_urls',
  {
    domainId: text('domain_id')
      .notNull()
      .references(() => domains.id, { onDelete: 'cascade' }),
    urlHash: text('url_hash').notNull(),
    url: text('url').notNull(),
    createdAt: ts('created_at').notNull().$defaultFn(now),
  },
  (t) => [primaryKey({ columns: [t.domainId, t.urlHash] })],
)

/**
 * What a domain's files for crawlers answered the last time they were requested, by a crawl or a
 * refresh. There is no history: each request replaces the row of its URL.
 */
export const crawlFiles = sqliteTable(
  'crawl_files',
  {
    domainId: text('domain_id')
      .notNull()
      .references(() => domains.id, { onDelete: 'cascade' }),
    urlHash: text('url_hash').notNull(),
    url: text('url').notNull(),
    kind: text('kind').notNull(),
    statusCode: integer('status_code'),
    contentType: text('content_type'),
    redirectTo: text('redirect_to'),
    bytes: integer('bytes'),
    /** The file is larger than what was read or kept of it. */
    truncated: integer('truncated', { mode: 'boolean' }).notNull().default(false),
    /** Sitemaps have no body here: they can be huge, and `data` says what matters of them. */
    body: text('body'),
    error: text('error'),
    /** JSON (`CrawlFileData`). */
    data: text('data'),
    via: text('via', { enum: ['crawl', 'refresh'] }).notNull(),
    fetchedAt: ts('fetched_at').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.domainId, t.urlHash] }),
    index('crawl_files_kind_idx').on(t.domainId, t.kind),
  ],
)

/** When a domain's files are next refreshed. A domain without a row is due at once. */
export const crawlFileChecks = sqliteTable(
  'crawl_file_checks',
  {
    domainId: text('domain_id')
      .primaryKey()
      .references(() => domains.id, { onDelete: 'cascade' }),
    nextCheckAt: ts('next_check_at').notNull(),
    /** Someone asked for a refresh and it has not finished yet. */
    requestedAt: ts('requested_at'),
    checkedAt: ts('checked_at'),
    /** How the last refresh went. */
    outcome: text('outcome', { enum: ['ok', 'unreachable'] }),
  },
  (t) => [index('crawl_file_checks_due_idx').on(t.nextCheckAt)],
)
