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
  /** `admin` or `member`. A new user has what they are given, never more (`@seotools/core/access`). */
  role: varchar('role', { length: 16 }).notNull().default('member'),
  /** Set while the account cannot sign in. Its sessions are removed when that happens. */
  disabledAt: ts('disabled_at'),
  /** The last time a password email was asked for, to answer only one in a while. */
  resetRequestedAt: ts('reset_requested_at'),
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
    /**
     * Set while the domain is archived: it keeps all its data and stays readable, but nothing
     * automatic runs for it and nothing can start or change.
     */
    archivedAt: ts('archived_at'),
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
    /**
     * What the audit looks like in this crawl, by pages. `null`: the crawl was analysed before
     * these existed (or not at all) and they are not made up: see `pagesWithType` for what it has.
     * `pagesAuditedCount` and `pagesExcludedCount` add up to the pages of the crawl; the other three
     * are over every page, excluded or not.
     */
    pagesAuditedCount: int('pages_audited_count'),
    pagesExcludedCount: int('pages_excluded_count'),
    pagesIndexableCount: int('pages_indexable_count'),
    pagesNotIndexableCount: int('pages_not_indexable_count'),
    pagesUnknownIndexabilityCount: int('pages_unknown_indexability_count'),
    /**
     * The version of the domain's audit configuration (`domain_audit_config`) the analysis used.
     * `null`: analysed before configuration existed, which is the same as version 0 (no rules).
     */
    auditVersion: int('audit_version'),
    /** JSON (`AuditSnapshot`): the rules that analysis used, to read and repeat it as it was. */
    auditSnapshot: longtext('audit_snapshot'),
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
 * ends or is analysed again. Only audited URLs have rows: an excluded one has no findings of its own. Removed along with the results per URL of old crawls.
 */
export const crawlUrlIssues = mysqlTable(
  'crawl_url_issues',
  {
    crawlId: id('crawl_id')
      .notNull()
      .references(() => crawls.id, { onDelete: 'cascade' }),
    urlHash: varchar('url_hash', { length: 32 }).notNull(),
    issue: varchar('issue', { length: 64 }).notNull(),
    /**
     * What the issue says about the URL, as JSON: an array of strings (what `PAGE_ISSUES` says the
     * issue details, e.g. which headers are missing), or, for a finding with evidence, an object
     * `{ details?, evidence }` (`serializeIssueDetails`).
     */
    details: longtext('details'),
  },
  (t) => [
    primaryKey({ columns: [t.crawlId, t.urlHash, t.issue] }),
    index('crawl_url_issues_issue_idx').on(t.crawlId, t.issue),
  ],
)

/**
 * Findings a rule accepts: the crawl saw them, and they are not pending, so nothing that reads
 * `crawl_url_issues` counts them. One row per URL, issue and URL whose declaration accepts it, which
 * is the URL itself or, for a finding about another URL, the one that says it is expected: that
 * tells when a rule of one URL acts on the findings of others.
 */
export const crawlUrlAcceptedIssues = mysqlTable(
  'crawl_url_accepted_issues',
  {
    crawlId: id('crawl_id')
      .notNull()
      .references(() => crawls.id, { onDelete: 'cascade' }),
    urlHash: varchar('url_hash', { length: 32 }).notNull(),
    issue: varchar('issue', { length: 64 }).notNull(),
    acceptedBy: varchar('accepted_by', { length: 32 }).notNull(),
    /** As JSON: `{ acceptance, details?, evidence? }` (`crawlAcceptedRows`). */
    details: longtext('details').notNull(),
  },
  (t) => [
    primaryKey({ columns: [t.crawlId, t.urlHash, t.issue, t.acceptedBy] }),
    index('crawl_url_accepted_issues_issue_idx').on(t.crawlId, t.issue),
    index('crawl_url_accepted_issues_by_idx').on(t.crawlId, t.acceptedBy),
  ],
)

/**
 * The version of a domain's audit configuration, which grows with every change to its rules, and
 * how the recalculation that follows a change is going. A domain without a row is at version 0.
 */
export const domainAuditConfig = mysqlTable('domain_audit_config', {
  domainId: id('domain_id')
    .primaryKey()
    .references(() => domains.id, { onDelete: 'cascade' }),
  version: int('version').notNull().default(0),
  /** Why the last recalculation gave up, and for which version. `null`: nothing has failed. */
  recomputeError: text('recompute_error'),
  recomputeErrorVersion: int('recompute_error_version'),
  /**
   * The language directories shared rules look at (`LanguageConfig` in @seotools/core): a JSON array
   * of directories such as `/es`, or `null` for none. They are part of the configuration: changing
   * them moves the version.
   */
  languagePrefixes: text('language_prefixes'),
  /** The domain has pages of its default language without a language directory. */
  languageUnprefixed: boolean('language_unprefixed').notNull().default(false),
  updatedAt: ts('updated_at').notNull().$defaultFn(now),
})

/**
 * Rules and exceptions that say which URLs of a domain are audited and which are expected to be
 * indexable (`@seotools/core/crawl/audit`). They hang off the domain, not off a crawl: they outlive
 * every crawl and every pruning of results. An exception for one URL is a rule whose selector is
 * that URL.
 */
export const auditRules = mysqlTable(
  'audit_rules',
  {
    id: id('id').primaryKey(),
    domainId: id('domain_id')
      .notNull()
      .references(() => domains.id, { onDelete: 'cascade' }),
    dimension: varchar('dimension', {
      length: 16,
      enum: ['audit', 'intent', 'noindex', 'nofollow', 'robots', 'sitemap'],
    }).notNull(),
    /**
     * `exclude` or `include` for `audit`; `indexable` or `not-indexable` for `intent` (`none` and
     * `inherit` only in rules from before semantics 3); `required`, `allowed` or `forbidden` for a
     * condition (`noindex`, `nofollow`, `robots`, `sitemap`).
     */
    value: varchar('value', { length: 16 }).notNull(),
    selectorKind: varchar('selector_kind', {
      length: 16,
      enum: ['url', 'path', 'prefix'],
    }).notNull(),
    /** The normalized URL, or the path. */
    selector: text('selector').notNull(),
    queryMode: varchar('query_mode', { length: 16, enum: ['any', 'exact'] }).notNull(),
    /** The query asked for, without the `?`. Empty is a query too. `null` when it is ignored. */
    queryValue: text('query_value'),
    /** Where a path or prefix rule looks for its path: as it is, or shared between languages. */
    scope: varchar('scope', { length: 16, enum: ['literal', 'shared'] })
      .notNull()
      .default('literal'),
    /** Retired with semantics 3 (a `nofollow` condition rule is `allowed`): always `false` in new rules. */
    acceptNofollow: boolean('accept_nofollow').notNull().default(false),
    /** Hash of `selectorKey`: two selectors with the same one are the same selector. */
    selectorHash: varchar('selector_hash', { length: 32 }).notNull(),
    /** `selector_hash` while the rule is enabled, `null` after: unique per domain and dimension. */
    activeKey: varchar('active_key', { length: 32 }),
    reason: text('reason'),
    enabled: boolean('enabled').notNull(),
    createdAt: ts('created_at').notNull().$defaultFn(now),
    updatedAt: ts('updated_at').notNull().$defaultFn(now),
  },
  (t) => [
    index('audit_rules_domain_idx').on(t.domainId),
    uniqueIndex('audit_rules_active_idx').on(t.domainId, t.dimension, t.activeKey),
  ],
)

/**
 * What an analysis concluded about each internal URL of a crawl: whether it was audited, what was
 * expected of its indexation, and what the crawl saw. A crawl analysed before this existed has no
 * rows. Removed along with the results per URL of old crawls.
 */
export const crawlUrlAudit = mysqlTable(
  'crawl_url_audit',
  {
    crawlId: id('crawl_id')
      .notNull()
      .references(() => crawls.id, { onDelete: 'cascade' }),
    urlHash: varchar('url_hash', { length: 32 }).notNull(),
    participation: varchar('participation', {
      length: 16,
      enum: ['audited', 'excluded'],
    }).notNull(),
    /** The rule that decided it. `null`: the default, or a rule that was deleted since. */
    participationRule: id('participation_rule'),
    intent: varchar('intent', {
      length: 16,
      enum: ['none', 'indexable', 'not-indexable'],
    }).notNull(),
    intentRule: id('intent_rule'),
    /** Retired with semantics 3 (the `nofollow` condition is `allowed`): only analyses of semantics 2 have it. */
    acceptNofollow: boolean('accept_nofollow').notNull().default(false),
    /**
     * What rules asked of each condition of the URL (`AUDIT_CONDITIONS` in @seotools/core), the rule that
     * did, and what the crawl saw. Only the conditions a rule stated have a value: `null` is the default.
     * An analysis before conditions has none; its accepted `nofollow` is `accept_nofollow` above.
     */
    noindexRequirement: varchar('noindex_requirement', {
      length: 16,
      enum: ['required', 'allowed', 'forbidden'],
    }),
    noindexRule: id('noindex_rule'),
    noindexObserved: varchar('noindex_observed', {
      length: 16,
      enum: ['present', 'absent', 'unknown'],
    }),
    nofollowRequirement: varchar('nofollow_requirement', {
      length: 16,
      enum: ['required', 'allowed', 'forbidden'],
    }),
    nofollowRule: id('nofollow_rule'),
    nofollowObserved: varchar('nofollow_observed', {
      length: 16,
      enum: ['present', 'absent', 'unknown'],
    }),
    robotsRequirement: varchar('robots_requirement', {
      length: 16,
      enum: ['required', 'allowed', 'forbidden'],
    }),
    robotsRule: id('robots_rule'),
    robotsObserved: varchar('robots_observed', {
      length: 16,
      enum: ['present', 'absent', 'unknown'],
    }),
    sitemapRequirement: varchar('sitemap_requirement', {
      length: 16,
      enum: ['required', 'allowed', 'forbidden'],
    }),
    sitemapRule: id('sitemap_rule'),
    sitemapObserved: varchar('sitemap_observed', {
      length: 16,
      enum: ['present', 'absent', 'unknown'],
    }),
    /** What the crawl saw, whatever was expected and whether or not it was audited. */
    indexability: varchar('indexability', {
      length: 16,
      enum: ['indexable', 'not-indexable', 'unknown'],
    }).notNull(),
    /** JSON array of `INDEXABILITY_BLOCKERS`. `null` when nothing stands in the way. */
    blockers: text('blockers'),
  },
  (t) => [
    primaryKey({ columns: [t.crawlId, t.urlHash] }),
    index('crawl_url_audit_participation_idx').on(t.crawlId, t.participation),
    index('crawl_url_audit_intent_idx').on(t.crawlId, t.intent),
    index('crawl_url_audit_participation_rule_idx').on(t.crawlId, t.participationRule),
    index('crawl_url_audit_intent_rule_idx').on(t.crawlId, t.intentRule),
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
 * A recheck of some URLs of a domain, without a crawl: what asked for it, how it is going and what
 * ran it. It hangs off the domain and never changes a crawl. A domain has one active recheck at most.
 */
export const urlVerifications = mysqlTable(
  'url_verifications',
  {
    id: id('id').primaryKey(),
    domainId: id('domain_id')
      .notNull()
      .references(() => domains.id, { onDelete: 'cascade' }),
    status: varchar('status', {
      length: 16,
      enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
    })
      .notNull()
      .default('pending'),
    jobId: id('job_id').notNull(),
    /** The domain id while the recheck is active, `null` after: unique, so one per domain at most. */
    activeKey: id('active_key').unique(),
    /** The full crawl the URLs were picked from. Not a reference: it outlives its results. */
    baseCrawlId: id('base_crawl_id').notNull(),
    urlsCount: int('urls_count').notNull().default(0),
    urlsDoneCount: int('urls_done_count').notNull().default(0),
    error: text('error'),
    createdAt: ts('created_at').notNull().$defaultFn(now),
    startedAt: ts('started_at'),
    finishedAt: ts('finished_at'),
  },
  (t) => [index('url_verifications_domain_created_idx').on(t.domainId, t.createdAt)],
)

/**
 * The URLs of a recheck: the queue of what is left to request, and what each one answered and
 * concluded. Removed with the recheck.
 */
export const urlVerificationUrls = mysqlTable(
  'url_verification_urls',
  {
    verificationId: id('verification_id')
      .notNull()
      .references(() => urlVerifications.id, { onDelete: 'cascade' }),
    urlHash: varchar('url_hash', { length: 32 }).notNull(),
    url: text('url').notNull(),
    source: varchar('source', { length: 16 }).notNull(),
    state: varchar('state', { length: 16, enum: ['queued', 'done'] }).notNull(),
    kind: varchar('kind', { length: 16, enum: ['page', 'redirect', 'resource', 'unknown'] })
      .notNull()
      .default('unknown'),
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
    /** The version of the audit configuration `outcome` was concluded under. */
    auditVersion: int('audit_version'),
    /** JSON (`VerificationOutcome`): what was concluded about the URL. */
    outcome: longtext('outcome'),
    fetchedAt: ts('fetched_at'),
  },
  (t) => [
    primaryKey({ columns: [t.verificationId, t.urlHash] }),
    index('url_verification_urls_queue_idx').on(t.verificationId, t.state),
    index('url_verification_urls_hash_idx').on(t.urlHash),
  ],
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

/**
 * What a member was given: a role on a company or on a domain, exactly one of the two
 * (`AccessGrant` in `@seotools/core/access`). It goes with what it is about.
 */
export const userAccess = mysqlTable(
  'user_access',
  {
    id: id('id').primaryKey(),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: varchar('role', { length: 16 }).notNull(),
    companyId: id('company_id').references(() => companies.id, { onDelete: 'cascade' }),
    domainId: id('domain_id').references(() => domains.id, { onDelete: 'cascade' }),
    createdAt: ts('created_at').notNull().$defaultFn(now),
  },
  (t) => [
    uniqueIndex('user_access_company_idx').on(t.userId, t.companyId),
    uniqueIndex('user_access_domain_idx').on(t.userId, t.domainId),
  ],
)

/**
 * Links that let someone set a password: an invitation, or a recovery. Only the hash of the token is
 * kept, so reading the database gives nobody a working link. All of a user's go when one is used.
 */
export const userTokens = mysqlTable(
  'user_tokens',
  {
    tokenHash: varchar('token_hash', { length: 64 }).primaryKey(),
    userId: varchar('user_id', { length: 36 })
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: varchar('kind', { length: 16 }).notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull().$defaultFn(now),
  },
  (t) => [index('user_tokens_user_idx').on(t.userId)],
)
