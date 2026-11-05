# SEO Tools Monorepo — Agent Guide

SEO Tools is an open-source application with a set of features for monitoring and auditing the SEO/GEO of websites.

## Repository structure

```
apps/web/            # Next.js app: UI, login + first-run setup + onboarding, /api/health, better-auth routes, server actions
apps/worker/         # Background job runner + handlers (example.echo, mail.send, crawl.run, audit.recompute), crawler, crawl scheduler, favicon and crawl file refreshers; also the bootstrap CLI (migrations)
packages/core/       # Shared logic: env validation, logger, job types, settings encryption, mail (SMTP + Resend), crawl types and URL rules
packages/db/         # Database layer: Drizzle schemas, migrations and repositories for SQLite, PostgreSQL and MySQL
docker/              # Container entrypoint and healthcheck
docs/                # Guides: updating an installation (docs/updating.md), making a release (docs/releases.md)
scripts/             # Release tooling (`node scripts/release.mjs`; its logic is in packages/core/src/release)
.github/workflows/   # CI and Docker image workflows
```

The workspaces are:

| Package            | Description                                                                        |
| ------------------ | ---------------------------------------------------------------------------------- |
| `@seotools/web`    | Next.js (App Router) web app with shadcn/ui and multi-user, role-based auth        |
| `@seotools/worker` | Job processor backed by the database (no Redis); bundled with tsdown               |
| `@seotools/core`   | Env validation (zod), logger (pino), job types, encrypted settings, mail           |
| `@seotools/db`     | Database abstraction (SQLite, PostgreSQL, MySQL), migrations, first-admin creation |

The most important third-party packages are:

| Package                                | Used in      | Description                                                 |
| -------------------------------------- | ------------ | ----------------------------------------------------------- |
| `next`, `react`                        | web          | Web framework and UI runtime                                |
| `better-auth`                          | web, db      | Email/password sessions, sign-up disabled                   |
| `shadcn`, `@base-ui/react`             | web          | UI components                                               |
| `next-intl`                            | web          | i18n (messages in `apps/web/messages`)                      |
| `tailwindcss`                          | web          | Styling                                                     |
| `drizzle-orm`, `drizzle-kit`           | db           | Query layer and migration generation for all three dialects |
| `better-sqlite3`, `postgres`, `mysql2` | db, worker   | Database drivers (`better-sqlite3` is the only native one)  |
| `zod`                                  | core         | Environment validation                                      |
| `pino`                                 | core         | Structured logging                                          |
| `htmlparser2`                          | worker       | HTML and sitemap parsing in the crawler                     |
| `nodemailer`, `resend`                 | core         | Email delivery (SMTP or Resend API)                         |
| `turbo`, `vitest`, `tsdown`            | root, worker | Task orchestration, tests, worker bundling                  |

## Architecture

- **Auth and users:** the app is multi-user with roles. First-run setup creates the first user, who is an admin, but that user is not special: more admins and users with other roles can be created, and the first user's admin role can be revoked like anyone else's. Never write code that assumes a single admin or treats the first user differently after setup. Users can reset their password from within the app.
- **UI:** use shadcn by default whenever an existing component or primitive covers the need. Pages are capped at `max-w-5xl` by the protected layout; one that needs the whole screen (the pages table) marks its `<main data-wide>`.
- **Forms with a switch or checkbox** submit through `useFormActionState` (`apps/web/hooks`), never `<form action>`: React resets the form after the action, which leaves the switch looking on while its checkbox is off, so the next click does nothing and the next submit sends the wrong value.
- **Companies and domains:** domains are grouped by company (an agency's client) and each feature works on one domain at a time. The active domain is the `/domains/[host]` route segment, never a cookie or global state. Every page and server action scoped to a domain starts with `requireDomain(host)` (`apps/web/lib/workspace.ts`) and its tables reference `domains.id`; that function is the single place where per-company/per-domain permissions will be enforced. Hosts are stored normalized by `normalizeDomain` (`@seotools/core`): `example.com`, no scheme, no `www.`, no path, always with a dot. Only instance-wide pages (`/system`) live outside a domain. A domain's settings go in a section of `/domains/[host]/settings` (`components/settings-nav.tsx`), never in the page of the feature they configure.
- **i18n:** the UI is internationalized (`next-intl`, locale from `Accept-Language`, no URL prefix). Every user-facing string must be translatable; never hardcode copy in components. Add each message to **both** `apps/web/messages/en.json` and `es.json` (a test fails if their keys or ICU arguments differ) and read it with `useTranslations` / `getTranslations`, including error messages returned by server actions. Data stored in the database (job payloads, etc.) is not UI copy. shadcn components that ship English copy are patched to read `next-intl` (`components/ui/sidebar.tsx` → `Sidebar` messages; `hooks/use-mobile.ts` also differs from upstream to pass lint): re-apply those patches after `shadcn add --overwrite`.

### Outbound requests (crawling)

- The crawler **does not obey `robots.txt`, meta robots or `nofollow` when deciding what to fetch**: it must be able to request every URL of the site being audited.
- It **does record** `robots.txt`, meta robots and `X-Robots-Tag`, so that a later feature can report per URL and per bot whether crawling/indexing would be allowed. That data is for the audit, never a reason to skip a request.
- A site is the tracked host and its `www.` variant, over HTTP and HTTPS on default ports. Other subdomains are domains of their own. External URLs are recorded with who links to them and never count as pages; the only ones requested are those `<a>` links point at, once each at the end of a full crawl and only on default ports, to find broken links (`checkExternalLink`).
- Crawl settings are per domain (`DEFAULT_CRAWL_SETTINGS` in `@seotools/core`): User-Agent, 2 simultaneous requests, 5 per second, 30 s timeout, 2 retries, 100,000 URLs (past it, the crawl ends `incomplete`).
- Every outbound request goes through `createHttpFetcher` (`apps/worker/src/crawl/fetcher.ts`), which refuses non-public addresses when connecting, unless `CRAWLER_ALLOW_PRIVATE_NETWORKS` is set. Never fetch a user-controlled URL any other way. (The only other request is the update check, to a constant URL: see Versions and releases.)
- Crawl files (robots.txt, sitemaps, llms.txt and the optional ones) live in `crawl_files`, one row per URL with what the last request answered, written by both full crawls and the daily refresher (`createCrawlFileRefresher`). Add a new kind in `crawlFileRequests` (`@seotools/core`), so both request it; an optional one also goes in `OPTIONAL_CRAWL_FILES`, which gives it a settings switch, a sidebar entry and a page under `crawl-files/[kind]`.
- What these files contain is untrusted: parse it without backtracking regexes, and link a URL taken from one only after `normalizeCrawlUrl`, which refuses `javascript:` and the like.

### Pages and issues

- Listed in a sitemap is a `<loc>` or a line of a text sitemap (link type `sitemap`, `AuditedUrl.sitemaps`). An alternate, image or video an entry names is requested but has its own link type (`hreflang`, `image`, `media`). A sitemap parsed since then records `data.sitemapSize.references` (even `0`); one without it stored every URL as `sitemap`, so `loadSite` puts a URL that a sitemap also declared as an alternate in `sitemapsAmbiguous`: neither listed nor absent (`presenceOf` is `unknown`, no sitemap finding). Analysing such a crawl again does not repair it; only a new crawl records the origin. Never infer it otherwise.
- Which issues exist, their order, group, type (`issue`, `warning`, `opportunity`) and importance live in `ISSUE_CATALOG` (`@seotools/core/crawl/issues`, pure so client components can import it); how each is detected lives in `CHECKS` (`apps/worker/src/crawl/issue-checks.ts`). Each issue needs `PageIssues.<id>.name` and `.description` in both message catalogs (a test fails otherwise) and a scenario in `issue-checks.test.ts` (likewise). An issue whose input does not exist yet (`indexed-not-in-sitemap` needs a source that confirms indexing) keeps its check and stays silent until it does.
- Issues belong to any URL of a crawl, not only pages: an issue filter ignores the view (`crawlUrlWhere`), which the pages table states by listing it as the `all` view. URLs the crawler only tried on its own (`isGuess`: other schemes and `www` of the home page, well-known files) are not blamed for failing.
- Checks read what the crawl stored, never the HTML: anything new a check needs goes in `CrawlPageFacts`, gathered by `PageFactsCollector`, and only shows from the next crawl. Its input is untrusted, so bound what it keeps and what it runs regexes on. The worker stores issues when a **full** crawl ends (`analyseCrawl` → `crawl_url_issues`); crawls from before a check existed show as not checked.
- Type is about the finding, importance about how much it matters, and they are independent: `issue` is for crawling and indexing problems, `warning` for what needs review (a serious security problem is a high-importance warning), `opportunity` for improvements. Lists of priorities order by importance, then type (`compareIssueSeverity`), so a type never buries something serious. There is no setting for what counts as "with issues": the overview counts the **audited** pages that have something of each type (`pagesWithType`, a page can be in several). Crawls store the `ISSUE_CATALOG_VERSION` they were analysed with and the worker analyses the others again at startup, so a catalog change reaches earlier crawls; bump `CHECKS_REVISION` when a check changes without the catalog changing.
- Indexability is a technical fact, never inferred from findings: `assessIndexability` (`@seotools/core/crawl/indexability`) says `indexable`, `not-indexable` (with its blockers) or `unknown` (not requested, request failed, not a page: never read as "expectation met"). "Indexable pages" count over every crawled page, excluded or not. Keep three things apart everywhere: what the crawl saw (indexability), what the user expects (`IndexIntent`), and whether a search engine indexed the URL (unknown). A robots.txt block is a blocker but never proof that a URL is out of the index.
- Rules and exceptions (`@seotools/core/crawl/audit`, table `audit_rules`, one row per statement, per domain and independent of crawls) make statements about the URLs a selector covers, each decided on its own with the same precedence: `audit` (participation: excluded URLs are crawled and keep their data but get no findings, and are not audited pages), four conditions (`noindex`, `nofollow`, `robots` for a robots.txt block, `sitemap` for being listed in one), each `required` (a finding when it provably is not there), `allowed` (its generic finding is not raised either way) or `forbidden` (a finding when it provably is), and, as an advanced concept apart from the conditions, `intent` (what is expected of the URL's indexation as a whole: `indexable` by default, or `not-indexable`). A condition is about one directive or file: never read a `not-indexable` intent as a required `noindex`, a `noindex` as the URL's indexability, or a robots.txt block as the URL being out of the index. In the UI a rule is the rows that share a selector (`groupRules`; `planSaveRuleSet` saves them together) and one editor (`AuditStatements`) serves rules and URL exceptions. Selectors are exact URL, exact path or path prefix by segments, never regexes. A path or prefix is `literal` or `shared` between the language directories the domain declares (`domain_audit_config`; nothing is deduced from paths; at most one declared directory is taken off, only to resolve rules, never in URLs). Precedence: exact URL, literal exact path, shared exact path, the prefix that covers more of the URL (literal wins a tie), default; a rule for a query beats one that ignores it. An exception on one URL is a rule whose selector is that URL: tables, details and settings all edit the same rules, and "according to the rules" (`inherit`) in the UI means deleting that statement of the exception, which is not "no change" (a statement left out of the request, which `planUrlConfig` never touches: a multi-URL change sends only what the user chose). Each statement inherits on its own: an exception for one condition never states, resets or copies another. Resolution lives only in `compileAuditRules`: do not re-implement it. Exclusion and conditions are applied once, in `applyAuditPolicy` (`issue-checks.ts`), after every check ran, so the other URLs keep judging an excluded one as it really is; only the comparison sets for duplicates leave it out. Never put an exclusion inside a check. A condition a rule states replaces only its own generic findings (`GENERIC_OF`): never a conflict of directives or a `rel="nofollow"` link. What other pages say of the URL (an inbound canonical or hreflang) is decided by the origin × destination policy below, not here. Disabled exceptions do not act: pages never show them as what a URL has.
- The default expectation (`indexable`) raises no finding of its own: the generic findings (`noindex`, canonical, robots) already say so. Only an expectation a rule states is judged (`expected-*` issues), only on pages that answered and were not merely tried by the crawler (`judgeable`), never on resources, redirects, failures or unknown data. `nofollow` never counts as `noindex`. A condition no rule states behaves as it always did (generic findings, with the expectation dropping `noindex`, `canonicalised` and `indexable-not-in-sitemap` for a `not-indexable` URL); one a rule states decides its own findings instead. Conditions are judged only on `judgeable` pages and only when the crawl could tell (`presenceOf`, `conditions.ts`): presence is proven by what was read, absence only by whole input (a page parsed whole, a robots.txt that answered or is a 4xx, every sitemap read in a `completed` crawl: `Site.sitemapCoverage`); anything else is `unknown`, which is never met nor missed and raises no finding. Sitemap conditions are `site`-scoped: a recheck neither judges nor observes them.
- Origin × destination (`apps/worker/src/crawl/relations.ts`, the one place): when a URL points at another (canonical, hreflang) the finding sits on the origin and is about the destination, and what the user declared of either end excuses what only repeats it. The destination accepts each blocker of its indexation on its own: `noindex` by the `noindex` condition `required`/`allowed` (or, unstated, by a `not-indexable` expectation; `forbidden` never), `canonical` by `not-indexable`, `robots` only by the `robots` condition (a block is no proof of being out of the index), `redirect`/`http-error` never. An intentionally non-indexable origin (`isExpectedOut`: every observed blocker is accepted by its rules, never proof of search-engine index status) excuses every indexing blocker and the missing return; a URL expected out has no `only-*-inlinks`. Never excused: redirecting or failing destinations, the declaration-internal hreflang issues, `sitemap-not-indexable`. App policy, not SEO fact; nothing is excused under a configuration older than `RELATIONS_SEMANTICS`; an excluded destination is accepted only by what is declared of it, and its technical state never changes. Route a new relation finding through `excusedBlockers`, never skip it inside a check.
- Every change to the rules or the language directories bumps `domain_audit_config.version` and queues one `audit.recompute` job in the same transaction. `analyseCrawl` takes the configuration to use, whole, and `saveAnalysis` refuses an analysis made with an older version than the crawl already has. Each crawl keeps the version, the rules, the languages and the meaning (`AUDIT_SEMANTICS`) it was analysed with (`auditSnapshot`): the catalog reanalysis uses those, never the current ones; only the latest full crawl follows the current ones. A snapshot without `semantics` is semantics 1 (default intent `none`, `none` rules, literal paths): never read it with today's defaults. Semantics 2 accepted the page's own `nofollow` through the intent rule (`acceptNofollow`, `inherit`); `compileAuditRules` and `readUrlAuditState` read that as the `nofollow` condition being `allowed`, and semantics 3 ignores both. Semantics 4 is the first that lets what a URL declares reach the findings of the URLs that point at it (`relations.ts`); an analysis of semantics 3 or older accepts none of it, so repeating it gives what it gave. Changing what a configuration means needs a new `AUDIT_SEMANTICS` and an idempotent upgrade of existing rules (`upgradeSemantics` with `planUpgradeSemantics(rows, context, from)`, run by `migrate()`: it deletes the `none` rules, which can bring back a broader rule they were holding off, writes accepted `nofollow` as condition rules without turning any expectation into a `noindex`, and, from 3, writes nothing but moves the version of a domain whose enabled rules `reachesRelations`, so its latest crawl is analysed again). `auditScopeKey` reads 3 as 4 only for a configuration without such a rule. Pages must say when results are behind the configuration (`auditResultsState`), never show them as current.
- A finding a rule takes as expected is **accepted**, never fixed: it goes in `crawl_url_accepted_issues` (`detectFindings`), not in `crawl_url_issues`, so nothing pending counts it, with what accepts it (`FindingAcceptance`, `@seotools/core/crawl/acceptance`) and the URL whose declaration does (`acceptedBy`), which tells when a rule of one URL acts on others. Whatever `applyAuditPolicy` or `relations.ts` keeps from being reported is recorded there, except an excluded URL (which has no findings) and what `expected-indexable-blocked` reports in other words. Keep three things apart everywhere: fixed (the crawl no longer sees it), accepted (it does, and a rule expects it), unknown (it could not tell).
- History and comparison read what retained full crawls stored and never request anything. `?crawl=<id>` on `/pages/details` and `/pages/details/[hash]` browses any `completed`/`incomplete` full crawl (the latest without it): resolve it only with `selectCrawl`/`findCrawl` (`lib/crawl-history.ts`), which ask the database with the domain, so another domain's crawl is a 404; a pruned crawl has only its totals, and is never shown as empty. A comparison (`/pages/compare`: `compareCounts`/`compareUrls`/`countCompared`) and a URL's history (`urlHistory`) page on the server and refuse crawls that are not full, retained crawls of the domain. What a change is called lives only in `@seotools/core/crawl/compare`: a URL missing from the later crawl is "not seen", never "deleted"; a finding is `new`/`resolved`/`reappeared` only when every crawl involved could have reported it under the same issue catalog, the same expectation and conditions for the URL and, for an issue that looks at other URLs (anything not in `PAGE_LOCAL_ISSUES`), the same audit configuration and a crawl that was not cut at its URL limit; `reappeared` needs the crawl in between (or before) that shows the absence. Otherwise it is `unverified` (with reasons), `excluded` (removed by policy) or `audited`. Add an issue to `PAGE_LOCAL_ISSUES` only if it depends solely on the URL's own answer. Older crawls keep their snapshot: pages show their date, coverage and audit configuration, never recalculate them.
- The pages table (`/pages/details`) filters, sorts and pages on the server: its state is the address (`lib/pages-query.ts`), never client state, except row selection and table preferences (visible columns and widths, in `localStorage`). Share view and filter definitions through `@seotools/core/crawl/listing`; preserve `other` for old links and worker site loading. Mark inapplicable filters as not applied and omit them from queries (`unappliedFilters`, `listingOf`); changing views clears the issue and incompatible filters while retaining search and order (`detailHref`). Distinguish filtered counts from view totals. The URL detail drawer opens client-side with a skeleton while the server renders `?url=<hash>`.
- Paginate URL links from stored crawl data and resolve requests within the domain (`findCrawl`); pruned results must not appear empty. Group link kinds through `@seotools/core/crawl/links`. Never invent anchor text or attributes that were not stored, and treat outgoing links from unread URLs as unknown.
- Findings of the issues in `ISSUE_EVIDENCE` (`@seotools/core/crawl/evidence`) carry bounded evidence: which images, links, canonical declarations or other pages make the URL have it. It is gathered while parsing (`PageFactsCollector` keeps the total in the counters of `CrawlPageFacts` and only the first `MAX_EVIDENCE_ITEMS` samples, with text cut) or from the comparison sets of `loadSite` (which never hold excluded URLs), and stored inside `crawl_url_issues.details` (`serializeIssueDetails`: rows without evidence keep the old array). A finding of such an issue without evidence means the crawl predates it: the UI says so and never invents examples. Show evidence addresses only through `evidenceTarget`, never as raw `href`s or HTML.

### Jobs

- Jobs that may outlast `JOB_LOCK_TIMEOUT_MS` are safe: the runner renews the locks of what it is running. Handlers must still be resumable, since a job can be retried after a crash; throw `JobInterruptedError` to hand one back on shutdown without spending an attempt.
- Crawls run in their own lane (`CRAWL_CONCURRENCY`, `crawl.run` jobs), so that they cannot hold up other jobs.
- `audit.recompute` jobs (default lane) analyse a domain's latest full crawl again from what it stored, with no requests; they are safe to repeat and to run concurrently. Change rules with `db.audit.*`, which queues the job together with the change.
- A domain has one active crawl at most, enforced by the unique `crawls.active_key`. Start crawls with `db.crawls.start`, which creates the crawl and its job together; never enqueue `crawl.run` directly.
- A recheck of some URLs (`url.verify`, `runVerification`) is not a crawl: it has its own tables and one active recheck per domain, never changes a crawl, and is started with `db.verifications.start`, never by enqueueing the job. It runs in the crawl lane, steps aside for a crawl of its domain (`JobDeferredError`), and requests only URLs of the domain plus their `robots.txt`, through `createRequester` and `createHttpFetcher`. It runs only the issues classified `url` in `@seotools/core/crawl/verification` (TypeScript fails until a new issue is classified), with the rest of the site unreadable (`SiteContextError`): an issue that needs other pages, links or sitemaps is `site`, and a recheck never reports it fixed or new, nor compares it with a crawl analysed under other audit rules.

### Versions and releases

Guides: `docs/releases.md` (classify, prepare, publish, check) and `docs/updating.md` (what administrators do; what each Docker tag means). Read the first before touching versions, `CHANGELOG.md`, the Dockerfile build arguments or `docker.yml`.

- **Version:** `MAJOR.MINOR.PATCH`, candidates `X.Y.Z-rc.N`. The root `package.json` is the only source; workspaces and `CHANGELOG.md` mirror it and `pnpm release:check` fails when they diverge. Never edit a `version` by hand or raise it in a feature or fix PR: only a release PR does, with `node scripts/release.mjs prepare <version>`. Docs-only changes need no release. While `0.x`, a breaking change needs a new MINOR.
- **Classify every change** in the PR that makes it, under `## [Unreleased]` in `CHANGELOG.md`: `Breaking` (MAJOR; MINOR while `0.x`), `Added`/`Changed` (MINOR), `Fixed`/`Security` (PATCH). Docs, tests, CI and refactors with no visible change get no entry. State the impact in the PR description. It is breaking if an env var, the `/data` layout, the default `DATABASE_URL`, the port, user or `SEOTOOLS_MODE`, an `/api/health` field, or anything an administrator must do changes; when unsure, breaking, with `### Upgrade notes`. Migrations only move forward and an older image does not refuse a newer database, so a release with one says in its upgrade notes that going back needs the backup.
- **Publishing:** only a pushed `vX.Y.Z` tag on the merge commit of a release PR publishes (`docker.yml`: exact tag, run it, then channel tags, then the GitHub release). Never create or push a tag, publish an image or a release, or run the release workflow unless asked; never move or delete a published tag.
- **Builds:** a release is a build with `SEOTOOLS_BUILD_CHANNEL=release`, which only that workflow sets. Everything else (`main` → `edge`/`sha-*`, PRs, local builds) is `development` and must never present itself as a release: read the version and channel through `getBuildInfo()` (`apps/web/lib/build-info.ts`), never `process.env.APP_VERSION` elsewhere. Tags: `X.Y.Z`, `X.Y`, `X` from 1.0.0 (never `0`), `latest` = newest stable.
- **Update check** (System → Updates, behind `requireAdmin()`): `checkForUpdates` (`@seotools/core`) reads the GitHub releases feed on request or, if an administrator enabled it, from the worker once a day; never while rendering a page. It sends nothing about domains or the installation. A failure is `check-failed`, never "up to date", and a development build is never compared. The app never replaces its container or touches the Docker socket: Docker or Dokploy does.

## Development

```bash
pnpm install   # pnpm 12 fails on dependencies with build scripts until they are listed in `allowBuilds` (pnpm-workspace.yaml)
cp .env.example .env
# edit .env: set BETTER_AUTH_SECRET (openssl rand -base64 32) and uncomment
# DATABASE_URL=file:../../data/seotools.db so web and worker share one SQLite file
pnpm dev   # applies migrations, then web (:3000) + worker with hot reload
```

Open <http://localhost:3000>: a fresh database redirects to `/setup` to register the admin.

```bash
# Run one side only
pnpm --filter @seotools/web dev
pnpm --filter @seotools/worker dev

# Apply migrations without starting anything
pnpm db:bootstrap

# PostgreSQL / MySQL: start a database, then set DATABASE_URL in .env
docker run -d --name seotools-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=seotools -p 5432:5432 postgres:17
docker run -d --name seotools-mysql -e MYSQL_ROOT_PASSWORD=test -e MYSQL_DATABASE=seotools -p 3306:3306 mysql:8.4
# DATABASE_URL=postgres://postgres:test@localhost:5432/seotools
# DATABASE_URL=mysql://root:test@localhost:3306/seotools

# Run the production image locally
docker compose up -d --build
```

## Build

```bash
pnpm build                          # everything: Next standalone + worker bundle (tsdown)
pnpm --filter @seotools/web build   # single workspace
docker build .                      # the image CI publishes (amd64 + arm64)
```

## Testing

Vitest only, run from the repo root (it groups `packages/*` and `apps/*` as projects). Test files live next to the code as `*.test.ts`; there is no `__tests__/` folder. There are no frontend component, API integration, CLI or E2E suites yet.

### Unit and contract tests

```bash
pnpm test                            # all projects, once
pnpm test:watch
pnpm exec vitest run packages/db     # one workspace
pnpm exec vitest run -t "admin"      # filter by test name
```

### Database contract (SQLite, PostgreSQL, MySQL)

`packages/db/src/test/contract.ts` defines the behaviour every dialect must provide (jobs queue, heartbeats, settings, companies and domains, crawls, audit rules, first admin) and runs once per dialect.

- SQLite always runs, on an in-memory database (`createTestDatabase()` from `@seotools/db/test`).
- PostgreSQL and MySQL are **skipped** unless you provide a database. CI runs them against real services.

```bash
TEST_POSTGRES_URL=postgres://postgres:test@localhost:5432/seotools \
TEST_MYSQL_URL=mysql://root:test@localhost:3306/seotools \
pnpm test
```

These tests **wipe the tables** of the database they point to. Use a throwaway database, never your dev data. Each dialect's `reset` (`sqlite.test.ts`, `postgres.test.ts`, `mysql.test.ts`) lists the tables by hand: add every new table to all three.

A change to the database layer is not done until the contract passes on all three dialects.

### Type checking

```bash
pnpm typecheck   # tsc in every workspace (web runs `next typegen` first)
```

### Migrations

```bash
pnpm --filter @seotools/db generate --name <what_changed>   # generates sqlite + pg + mysql together
pnpm db:check                                               # migration files are consistent
```

Schemas exist once per dialect (`packages/db/src/schema/{sqlite,pg,mysql}.ts`): change all three. Never edit generated migrations by hand.

### Pre-PR checklist

This is exactly what CI (`.github/workflows/ci.yml`) runs. All of it must pass:

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm db:check && pnpm release:check && pnpm test && pnpm build
```

`docker.yml` also builds the image on every PR (it only publishes development builds from `main` and releases from `v*.*.*` tags).

## Quality gates

### Language

Code, identifiers, comments, commit messages, PR descriptions and docs are always written in English. User-facing text goes through i18n.

### Commits

Conventional Commits (`feat:`, `fix:`, `chore:`, `docs:`, `test:`…), squash-merged with the PR number, e.g. `feat: project skeleton (web, worker, db, core, Docker, CI) (#1)`. No hook or CI check enforces it yet.

### TypeScript

- `strict`, plus `noUncheckedIndexedAccess`, `noImplicitOverride` and `verbatimModuleSyntax` (`tsconfig.base.json`).
- Import shared types from `@seotools/core` (env, jobs) and `@seotools/db` (repositories) instead of redeclaring them.
- Client components may only import types from `@seotools/core`: its entry point pulls in Node-only code, which breaks `next build` but not `pnpm typecheck`. For values, add a subpath export of a pure module (e.g. `@seotools/core/crawl/settings`).
- Never use `any`: `@typescript-eslint/no-explicit-any` is an error. Prefer `unknown` and narrow it.
- Type-only imports are inline: `import { x, type Y } from '…'` (enforced).
- Unused variables and arguments are errors unless prefixed with `_`.

### Linting and formatting

```bash
pnpm lint           # ESLint in every workspace
pnpm format         # Prettier, write
pnpm format:check   # Prettier, check only
```

Prettier: no semicolons, single quotes, trailing commas everywhere, 100-char width, Tailwind classes sorted (also inside `cn()` and `cva()`). EditorConfig: 2 spaces, LF, final newline.

ESLint ignores `packages/db/migrations/**` and `apps/web/components/ui/**` (generated by the shadcn CLI).

## Security

- Never commit secrets. `.env` and `.env.*` are gitignored (only `.env.example` is tracked), and so are `/data` and `/apps/*/data` (a process started without `DATABASE_URL` creates `./data/seotools.db` in its own cwd). Never `git add` a SQLite file.
- Admin credentials never come from environment variables. The first admin is registered on `/setup` through `createFirstAdmin`, which refuses to run once any user exists. Never re-enable better-auth sign-up.
- `proxy.ts` only checks that a session cookie exists. Every protected page and **every server action** must call `requireSession()` itself; a layout does not protect actions.
- A valid session is not authorization. Pages and server actions restricted to a role (e.g. admin) must also check the user's role on the server. Instance-wide ones (`/system/*`) call `requireAdmin()` (`lib/session.ts`), the single place that checks it.
- Use Drizzle's operators, which parameterize values. The only raw `sql` in `@seotools/db` is `select 1`, `count(*)`, the attempt decrement in `jobs.release`, the MySQL job-claim query, the null-safe comparisons (`sqliteDiffers`/`pgDiffers`/`mysqlDiffers`) and the `sum(case …)` of `compareCounts`, and the URL search (`like … escape '!'`) of `crawlUrlWhere` / `compareSearch` / `crawlLinkWhere` and the `is null` ordering of `crawlUrlOrder` (`mapping.ts`). They interpolate Drizzle columns; the only user text in them, the search, is a bound parameter with `%`, `_` and `!` escaped.
- Validate at the boundaries: the environment with the zod schemas in `@seotools/core/env`, job payloads with their schema in `packages/core/src/jobs.ts`, and form input in the server action before touching the database.
- Secrets saved from the admin panel (SMTP password, Resend key) go through the `settings` repository with `encrypted: true` (AES-256-GCM, key `SETTINGS_ENCRYPTION_KEY` or `BETTER_AUTH_SECRET`). Never log them.
- `GET /api/health` is public: it reports status, version and channel only. Error details stay in the server logs.
- Read configuration through the parsed env objects. The only places allowed to read `process.env` directly are `packages/core/src/env.ts`, the logger level setup and the Docker scripts.

## Maintaining this file

This file holds the rules every agent needs on every task. Keep it short: every line costs context on every run.

A rule belongs here only if it meets all three conditions:

1. **Non-obvious:** an agent reading the code would not infer it, or an agent already got it wrong.
2. **Durable:** it will still be true after the current feature is merged.
3. **Broad:** it applies across the repo or a whole workspace, not to a single file. Rules specific to one workspace go in an `AGENTS.md` inside that workspace.

Typical triggers: a new command or script, a new architectural boundary, a new security rule, a pending decision that got settled, or a mistake that CI did not catch and was fixed in review.

Do not add: descriptions of individual features, task status or TODOs, anything already in the README, or rules that lint, types or CI already enforce (unless the reason behind them matters).

### Check it on every task, without being asked

At the end of every change or feature, check on your own whether the work:

- makes anything in this file wrong or outdated;
- introduces something that meets the three conditions above;
- changes or reverses a decision recorded here.

Then act according to the size of the change.

**Minor changes: apply them, then tell the maintainer.** This covers fixing a command, path or package name, clarifying the wording of an existing rule, and adding a new rule that is consistent with everything already here. Edit this file in the same PR and list what you changed in your final summary under an `AGENTS.md updates` heading.

**Major changes: propose first, edit only after an explicit OK.** This covers changing or reversing an architectural, security or product decision, removing a rule, and any rule that would force existing code to change. Describe the change and why under an `AGENTS.md proposals` heading, and wait for approval before touching this file.

When unsure whether a change is minor or major, treat it as major.

### Writing rules

- Write rules as specific instructions ("Every server action must call `requireSession()`"), not as history ("We had a bug where…").
- Prefer tightening or replacing an existing rule over appending a new one.
