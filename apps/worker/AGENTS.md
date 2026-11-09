# Worker — Agent Guide

Job runner and handlers, crawler, crawl scheduler, refreshers and the CLIs. Repo-wide rules are in the root `AGENTS.md`. Before changing findings, rules, comparison, crawl history, the pages table or exports, read `packages/core/src/crawl/AGENTS.md`.

## Structure

```
apps/worker/         # Background job runner + handlers (example.echo, mail.send, access.email, crawl.alerts, crawl.run, audit.recompute), crawler, crawl scheduler, favicon and crawl file refreshers; also the bootstrap CLI (migrations), `recover` and `migrate-db` (SQLite → PostgreSQL copy, `copySqliteToPostgres`)
```

## Main third-party packages

| Package                     | Used in      | Description                                |
| --------------------------- | ------------ | ------------------------------------------ |
| `htmlparser2`               | worker       | HTML and sitemap parsing in the crawler    |
| `turbo`, `vitest`, `tsdown` | root, worker | Task orchestration, tests, worker bundling |

## Outbound requests (crawling)

- The crawler **does not obey `robots.txt`, meta robots or `nofollow` when deciding what to fetch**: it must be able to request every URL of the site being audited.
- It **does record** `robots.txt`, meta robots and `X-Robots-Tag`, so that a later feature can report per URL and per bot whether crawling/indexing would be allowed. That data is for the audit, never a reason to skip a request.
- A site is the tracked host and its `www.` variant, over HTTP and HTTPS on default ports. Other subdomains are domains of their own. External URLs are recorded with who links to them and never count as pages; the only ones requested are those `<a>` links point at, once each at the end of a full crawl and only on default ports, to find broken links (`checkExternalLink`).
- Crawl settings are per domain (`DEFAULT_CRAWL_SETTINGS` in `@seotools/core`): User-Agent, 2 simultaneous requests, 5 per second, 30 s timeout, 2 retries, 100,000 URLs (past it, the crawl ends `incomplete`), optional path scope and maximum depth; seeds bypass scope and depth. Request credentials use settings encryption and only accompany requests to the tracked site.
- Every outbound request goes through `createHttpFetcher` (`apps/worker/src/crawl/fetcher.ts`), which refuses non-public addresses when connecting, unless `CRAWLER_ALLOW_PRIVATE_NETWORKS` is set. Never fetch a user-controlled URL any other way. (The only other request is the update check, to a constant URL: see Update check in `apps/web/AGENTS.md`.)
- Crawl files (robots.txt, sitemaps, llms.txt and the optional ones) live in `crawl_files`, one row per URL with what the last request answered, written by both full crawls and the daily refresher (`createCrawlFileRefresher`). Add a new kind in `crawlFileRequests` (`@seotools/core`), so both request it; an optional one also goes in `OPTIONAL_CRAWL_FILES`, which gives it a settings switch, a sidebar entry and a page under `crawl-files/[kind]`.
- What these files contain is untrusted: parse it without backtracking regexes, and link a URL taken from one only after `normalizeCrawlUrl`, which refuses `javascript:` and the like.

## Jobs

- Jobs that may outlast `JOB_LOCK_TIMEOUT_MS` are safe: the runner renews the locks of what it is running. Handlers must still be resumable, since a job can be retried after a crash; throw `JobInterruptedError` to hand one back on shutdown without spending an attempt.
- Crawls run in their own lane (`CRAWL_CONCURRENCY`, `crawl.run` jobs), so that they cannot hold up other jobs.
- `audit.recompute` jobs (default lane) analyse a domain's latest full crawl again from what it stored, with no requests; they are safe to repeat and to run concurrently. Change rules with `db.audit.*`, which queues the job together with the change.
- A domain has one active crawl at most, enforced by the unique `crawls.active_key`. Start crawls with `db.crawls.start`, which creates the crawl and its job together; never enqueue `crawl.run` directly.
- A recheck of some URLs (`url.verify`, `runVerification`) is not a crawl: it has its own tables and one active recheck per domain, never changes a crawl, and is started with `db.verifications.start`, never by enqueueing the job. It runs in the crawl lane, steps aside for a crawl of its domain (`JobDeferredError`), and requests only URLs of the domain plus their `robots.txt`, through `createRequester` and `createHttpFetcher`. It runs only the issues classified `url` in `@seotools/core/crawl/verification` (TypeScript fails until a new issue is classified), with the rest of the site unreadable (`SiteContextError`): an issue that needs other pages, links or sitemaps is `site`, and a recheck never reports it fixed or new, nor compares it with a crawl analysed under other audit rules. What the rules accept among the `url` issues is kept apart in the outcome (`accepted`, absent in older rechecks: say nothing then) and shown as accepted, never as fixed (`compareWithCrawl`'s `nowAccepted`).

## Email and alerts

- **Email and alerts:** every email the worker sends goes through `deliver` (`apps/worker/src/mail`), which records the attempt in `mail_deliveries` (kind, recipient, result, bounded error with secrets, links and tokens taken out by `safeMailError`; never a subject, body or link) and rethrows, so a failure is retried and seen in System → Email; the test send of that page records too.
- Alerts are opt-in per person and domain (`alert_subscriptions`, chosen in `/account`, never implied).
- Only `db.crawls.finish` of a **full** crawl queues `crawl.alerts` (job id from `alertJobId(crawlId)`, so `removeJobsOf` finds it); rules, `audit.recompute`, catalog reanalysis and priority crawls never do. The job re-resolves recipients when it sends (`domainRoleOf`, `disabledAt`, the subscription, an archived domain sends nothing), claims `alert_notices` (primary key: one per person, crawl and kind; released only when sending throws) and sends one email per person with all their kinds. What changed is named only by `classifyFindings` through `compareWithPrevious`: a change a rule or a new catalog explains is `unverified`, never a regression.
- A new alert kind goes in `ALERT_KINDS`, `alertEmail`, the account form and both message catalogs.

## Recovery

- Recovery without email is a link an administrator generates, or `node worker/dist/recover.mjs <email>` on the installation's command line.

## Periodic loops

- An archived domain stays out of every periodic loop: see "Companies and domains lifecycle" in `packages/db/AGENTS.md`.
