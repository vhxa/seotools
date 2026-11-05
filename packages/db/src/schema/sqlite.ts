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
  /** `admin` or `member`. A new user has what they are given, never more (`@seotools/core/access`). */
  role: text('role').notNull().default('member'),
  /** Set while the account cannot sign in. Its sessions are removed when that happens. */
  disabledAt: ts('disabled_at'),
  /** The last time a password email was asked for, to answer only one in a while. */
  resetRequestedAt: ts('reset_requested_at'),
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
    /**
     * What the audit looks like in this crawl, by pages. `null`: the crawl was analysed before
     * these existed (or not at all) and they are not made up: see `pagesWithType` for what it has.
     * `pagesAuditedCount` and `pagesExcludedCount` add up to the pages of the crawl; the other three
     * are over every page, excluded or not.
     */
    pagesAuditedCount: integer('pages_audited_count'),
    pagesExcludedCount: integer('pages_excluded_count'),
    pagesIndexableCount: integer('pages_indexable_count'),
    pagesNotIndexableCount: integer('pages_not_indexable_count'),
    pagesUnknownIndexabilityCount: integer('pages_unknown_indexability_count'),
    /**
     * The version of the domain's audit configuration (`domain_audit_config`) the analysis used.
     * `null`: analysed before configuration existed, which is the same as version 0 (no rules).
     */
    auditVersion: integer('audit_version'),
    /** JSON (`AuditSnapshot`): the rules that analysis used, to read and repeat it as it was. */
    auditSnapshot: text('audit_snapshot'),
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
 * ends or is analysed again. Only audited URLs have rows: an excluded one has no findings of its own. Removed along with the results per URL of old crawls.
 */
export const crawlUrlIssues = sqliteTable(
  'crawl_url_issues',
  {
    crawlId: text('crawl_id')
      .notNull()
      .references(() => crawls.id, { onDelete: 'cascade' }),
    urlHash: text('url_hash').notNull(),
    issue: text('issue').notNull(),
    /**
     * What the issue says about the URL, as JSON: an array of strings (what `PAGE_ISSUES` says the
     * issue details, e.g. which headers are missing), or, for a finding with evidence, an object
     * `{ details?, evidence }` (`serializeIssueDetails`).
     */
    details: text('details'),
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
export const crawlUrlAcceptedIssues = sqliteTable(
  'crawl_url_accepted_issues',
  {
    crawlId: text('crawl_id')
      .notNull()
      .references(() => crawls.id, { onDelete: 'cascade' }),
    urlHash: text('url_hash').notNull(),
    issue: text('issue').notNull(),
    acceptedBy: text('accepted_by').notNull(),
    /** As JSON: `{ acceptance, details?, evidence? }` (`crawlAcceptedRows`). */
    details: text('details').notNull(),
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
export const domainAuditConfig = sqliteTable('domain_audit_config', {
  domainId: text('domain_id')
    .primaryKey()
    .references(() => domains.id, { onDelete: 'cascade' }),
  version: integer('version').notNull().default(0),
  /** Why the last recalculation gave up, and for which version. `null`: nothing has failed. */
  recomputeError: text('recompute_error'),
  recomputeErrorVersion: integer('recompute_error_version'),
  /**
   * The language directories shared rules look at (`LanguageConfig` in @seotools/core): a JSON array
   * of directories such as `/es`, or `null` for none. They are part of the configuration: changing
   * them moves the version.
   */
  languagePrefixes: text('language_prefixes'),
  /** The domain has pages of its default language without a language directory. */
  languageUnprefixed: integer('language_unprefixed', { mode: 'boolean' }).notNull().default(false),
  updatedAt: ts('updated_at').notNull().$defaultFn(now),
})

/**
 * Rules and exceptions that say which URLs of a domain are audited and which are expected to be
 * indexable (`@seotools/core/crawl/audit`). They hang off the domain, not off a crawl: they outlive
 * every crawl and every pruning of results. An exception for one URL is a rule whose selector is
 * that URL.
 */
export const auditRules = sqliteTable(
  'audit_rules',
  {
    id: text('id').primaryKey(),
    domainId: text('domain_id')
      .notNull()
      .references(() => domains.id, { onDelete: 'cascade' }),
    dimension: text('dimension', {
      enum: ['audit', 'intent', 'noindex', 'nofollow', 'robots', 'sitemap'],
    }).notNull(),
    /**
     * `exclude` or `include` for `audit`; `indexable` or `not-indexable` for `intent` (`none` and
     * `inherit` only in rules from before semantics 3); `required`, `allowed` or `forbidden` for a
     * condition (`noindex`, `nofollow`, `robots`, `sitemap`).
     */
    value: text('value').notNull(),
    selectorKind: text('selector_kind', { enum: ['url', 'path', 'prefix'] }).notNull(),
    /** The normalized URL, or the path. */
    selector: text('selector').notNull(),
    queryMode: text('query_mode', { enum: ['any', 'exact'] }).notNull(),
    /** The query asked for, without the `?`. Empty is a query too. `null` when it is ignored. */
    queryValue: text('query_value'),
    /** Where a path or prefix rule looks for its path: as it is, or shared between languages. */
    scope: text('scope', { enum: ['literal', 'shared'] })
      .notNull()
      .default('literal'),
    /** Retired with semantics 3 (a `nofollow` condition rule is `allowed`): always `false` in new rules. */
    acceptNofollow: integer('accept_nofollow', { mode: 'boolean' }).notNull().default(false),
    /** Hash of `selectorKey`: two selectors with the same one are the same selector. */
    selectorHash: text('selector_hash').notNull(),
    /** `selector_hash` while the rule is enabled, `null` after: unique per domain and dimension. */
    activeKey: text('active_key'),
    reason: text('reason'),
    enabled: integer('enabled', { mode: 'boolean' }).notNull(),
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
export const crawlUrlAudit = sqliteTable(
  'crawl_url_audit',
  {
    crawlId: text('crawl_id')
      .notNull()
      .references(() => crawls.id, { onDelete: 'cascade' }),
    urlHash: text('url_hash').notNull(),
    participation: text('participation', { enum: ['audited', 'excluded'] }).notNull(),
    /** The rule that decided it. `null`: the default, or a rule that was deleted since. */
    participationRule: text('participation_rule'),
    intent: text('intent', { enum: ['none', 'indexable', 'not-indexable'] }).notNull(),
    intentRule: text('intent_rule'),
    /** Retired with semantics 3 (the `nofollow` condition is `allowed`): only analyses of semantics 2 have it. */
    acceptNofollow: integer('accept_nofollow', { mode: 'boolean' }).notNull().default(false),
    /**
     * What rules asked of each condition of the URL (`AUDIT_CONDITIONS` in @seotools/core), the rule that
     * did, and what the crawl saw. Only the conditions a rule stated have a value: `null` is the default.
     * An analysis before conditions has none; its accepted `nofollow` is `accept_nofollow` above.
     */
    noindexRequirement: text('noindex_requirement', { enum: ['required', 'allowed', 'forbidden'] }),
    noindexRule: text('noindex_rule'),
    noindexObserved: text('noindex_observed', { enum: ['present', 'absent', 'unknown'] }),
    nofollowRequirement: text('nofollow_requirement', {
      enum: ['required', 'allowed', 'forbidden'],
    }),
    nofollowRule: text('nofollow_rule'),
    nofollowObserved: text('nofollow_observed', { enum: ['present', 'absent', 'unknown'] }),
    robotsRequirement: text('robots_requirement', { enum: ['required', 'allowed', 'forbidden'] }),
    robotsRule: text('robots_rule'),
    robotsObserved: text('robots_observed', { enum: ['present', 'absent', 'unknown'] }),
    sitemapRequirement: text('sitemap_requirement', { enum: ['required', 'allowed', 'forbidden'] }),
    sitemapRule: text('sitemap_rule'),
    sitemapObserved: text('sitemap_observed', { enum: ['present', 'absent', 'unknown'] }),
    /** What the crawl saw, whatever was expected and whether or not it was audited. */
    indexability: text('indexability', {
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
 * A recheck of some URLs of a domain, without a crawl: what asked for it, how it is going and what
 * ran it. It hangs off the domain and never changes a crawl. A domain has one active recheck at most.
 */
export const urlVerifications = sqliteTable(
  'url_verifications',
  {
    id: text('id').primaryKey(),
    domainId: text('domain_id')
      .notNull()
      .references(() => domains.id, { onDelete: 'cascade' }),
    status: text('status', {
      enum: ['pending', 'running', 'completed', 'failed', 'cancelled'],
    })
      .notNull()
      .default('pending'),
    jobId: text('job_id').notNull(),
    /** The domain id while the recheck is active, `null` after: unique, so one per domain at most. */
    activeKey: text('active_key').unique(),
    /** The full crawl the URLs were picked from. Not a reference: it outlives its results. */
    baseCrawlId: text('base_crawl_id').notNull(),
    urlsCount: integer('urls_count').notNull().default(0),
    urlsDoneCount: integer('urls_done_count').notNull().default(0),
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
export const urlVerificationUrls = sqliteTable(
  'url_verification_urls',
  {
    verificationId: text('verification_id')
      .notNull()
      .references(() => urlVerifications.id, { onDelete: 'cascade' }),
    urlHash: text('url_hash').notNull(),
    url: text('url').notNull(),
    source: text('source').notNull(),
    state: text('state', { enum: ['queued', 'done'] }).notNull(),
    kind: text('kind', { enum: ['page', 'redirect', 'resource', 'unknown'] })
      .notNull()
      .default('unknown'),
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
    /** The version of the audit configuration `outcome` was concluded under. */
    auditVersion: integer('audit_version'),
    /** JSON (`VerificationOutcome`): what was concluded about the URL. */
    outcome: text('outcome'),
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

/**
 * What a member was given: a role on a company or on a domain, exactly one of the two
 * (`AccessGrant` in `@seotools/core/access`). It goes with what it is about.
 */
export const userAccess = sqliteTable(
  'user_access',
  {
    id: text('id').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    role: text('role').notNull(),
    companyId: text('company_id').references(() => companies.id, { onDelete: 'cascade' }),
    domainId: text('domain_id').references(() => domains.id, { onDelete: 'cascade' }),
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
export const userTokens = sqliteTable(
  'user_tokens',
  {
    tokenHash: text('token_hash').primaryKey(),
    userId: text('user_id')
      .notNull()
      .references(() => user.id, { onDelete: 'cascade' }),
    kind: text('kind').notNull(),
    expiresAt: ts('expires_at').notNull(),
    createdAt: ts('created_at').notNull().$defaultFn(now),
  },
  (t) => [index('user_tokens_user_idx').on(t.userId)],
)
