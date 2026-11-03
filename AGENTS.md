# SEO Tools Monorepo — Agent Guide

SEO Tools is an open-source application with a set of features for monitoring and auditing the SEO/GEO of websites.

## Repository structure

```
apps/web/            # Next.js app: UI, login + first-run setup + onboarding, /api/health, better-auth routes, server actions
apps/worker/         # Background job runner + handlers (example.echo, mail.send, crawl.run, audit.recompute), crawler, crawl scheduler, favicon and crawl file refreshers; also the bootstrap CLI (migrations)
packages/core/       # Shared logic: env validation, logger, job types, settings encryption, mail (SMTP + Resend), crawl types and URL rules
packages/db/         # Database layer: Drizzle schemas, migrations and repositories for SQLite, PostgreSQL and MySQL
docker/              # Container entrypoint and healthcheck
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
- Every outbound request goes through `createHttpFetcher` (`apps/worker/src/crawl/fetcher.ts`), which refuses non-public addresses when connecting, unless `CRAWLER_ALLOW_PRIVATE_NETWORKS` is set. Never fetch a user-controlled URL any other way.
- Crawl files (robots.txt, sitemaps, llms.txt and the optional ones) live in `crawl_files`, one row per URL with what the last request answered, written by both full crawls and the daily refresher (`createCrawlFileRefresher`). Add a new kind in `crawlFileRequests` (`@seotools/core`), so both request it; an optional one also goes in `OPTIONAL_CRAWL_FILES`, which gives it a settings switch, a sidebar entry and a page under `crawl-files/[kind]`.
- What these files contain is untrusted: parse it without backtracking regexes, and link a URL taken from one only after `normalizeCrawlUrl`, which refuses `javascript:` and the like.

### Pages and issues

- Which issues exist, their order, group, type (`issue`, `warning`, `opportunity`) and importance live in `ISSUE_CATALOG` (`@seotools/core/crawl/issues`, pure so client components can import it); how each is detected lives in `CHECKS` (`apps/worker/src/crawl/issue-checks.ts`). Each issue needs `PageIssues.<id>.name` and `.description` in both message catalogs (a test fails otherwise) and a scenario in `issue-checks.test.ts` (likewise). An issue whose input does not exist yet (`indexed-not-in-sitemap` needs a source that confirms indexing) keeps its check and stays silent until it does.
- Issues belong to any URL of a crawl, not only pages: an issue filter ignores the view (`crawlUrlWhere`). URLs the crawler only tried on its own (`isGuess`: other schemes and `www` of the home page, well-known files) are not blamed for failing.
- Checks read what the crawl stored, never the HTML: anything new a check needs goes in `CrawlPageFacts`, gathered by `PageFactsCollector`, and only shows from the next crawl. Its input is untrusted, so bound what it keeps and what it runs regexes on. The worker stores issues when a **full** crawl ends (`analyseCrawl` → `crawl_url_issues`); crawls from before a check existed show as not checked.
- Type is about the finding, importance about how much it matters, and they are independent: `issue` is for crawling and indexing problems, `warning` for what needs review (a serious security problem is a high-importance warning), `opportunity` for improvements. There is no setting for what counts as "with issues": the overview counts the **audited** pages that have something of each type (`pagesWithType`, a page can be in several). Crawls store the `ISSUE_CATALOG_VERSION` they were analysed with and the worker analyses the others again at startup, so a catalog change reaches earlier crawls; bump `CHECKS_REVISION` when a check changes without the catalog changing.
- Indexability is a technical fact, never inferred from findings: `assessIndexability` (`@seotools/core/crawl/indexability`) says `indexable`, `not-indexable` (with its blockers) or `unknown` (not requested, request failed, not a page: never read as "expectation met"). "Indexable pages" count over every crawled page, excluded or not. Keep three things apart everywhere: what the crawl saw (indexability), what the user expects (`IndexIntent`), and whether a search engine indexed the URL (unknown). A robots.txt block is a blocker but never proof that a URL is out of the index.
- Rules and exceptions (`@seotools/core/crawl/audit`, table `audit_rules`, per domain and independent of crawls) decide two dimensions on their own: `audit` (excluded URLs are crawled and keep their data but get no findings, and are not audited pages) and `intent` (what is expected of indexation: `indexable` by default, or `not-indexable`, optionally accepting the page's own `nofollow`). Selectors are exact URL, exact path or path prefix by segments, never regexes. A path or prefix is `literal` or `shared` between the language directories the domain declares (`domain_audit_config`; nothing is deduced from paths; at most one declared directory is taken off, only to resolve rules, never in URLs). Precedence: exact URL, literal exact path, shared exact path, the prefix that covers more of the URL (literal wins a tie), default; a rule for a query beats one that ignores it. An exception on one URL is a rule whose selector is that URL: tables, details and settings all edit the same rules, and "according to the rules" in the UI means deleting that exception. Resolution lives only in `compileAuditRules`: do not re-implement it. Exclusion and accepted `nofollow` are applied once, in `applyAuditPolicy` (`issue-checks.ts`), after every check ran, so the other URLs keep judging an excluded one as it really is; only the comparison sets for duplicates leave it out. Never put an exclusion inside a check. A multi-URL change sends only the dimensions the user chose (`planUrlConfig`): never reset what was not edited. The expectation and accepting `nofollow` are independent: an exception that only accepts `nofollow` has the value `inherit`, leaves the expectation to the other rules and is kept only while it differs from them (the rule that wins decides `nofollow`, except that an `inherit` one decides it alone). Disabled exceptions do not act: pages never show them as what a URL has.
- The default expectation (`indexable`) raises no finding of its own: the generic findings (`noindex`, canonical, robots) already say so. Only an expectation a rule states is judged (`expected-*` issues), only on pages that answered and were not merely tried by the crawler (`judgeable`), never on resources, redirects, failures or unknown data. `nofollow` never counts as `noindex`: accepting it does not meet "not indexable", and does not hide directive conflicts, `rel="nofollow"` links or other pages' findings.
- Every change to the rules or the language directories bumps `domain_audit_config.version` and queues one `audit.recompute` job in the same transaction. `analyseCrawl` takes the configuration to use, whole, and `saveAnalysis` refuses an analysis made with an older version than the crawl already has. Each crawl keeps the version, the rules, the languages and the meaning (`AUDIT_SEMANTICS`) it was analysed with (`auditSnapshot`): the catalog reanalysis uses those, never the current ones; only the latest full crawl follows the current ones. A snapshot without `semantics` is semantics 1 (default intent `none`, `none` rules, literal paths): never read it with today's defaults. Changing what a configuration means needs a new `AUDIT_SEMANTICS` and an idempotent upgrade of existing rules (`upgradeSemantics`, run by `migrate()`; it deleted the `none` rules, which can bring back a broader rule they were holding off). Pages must say when results are behind the configuration (`auditResultsState`), never show them as current.
- The pages table (`/pages/details`) filters, sorts and pages on the server: its state is the address (`lib/pages-query.ts`), never client state, except the row selection and the visible columns (kept in `localStorage`). The drawer with a URL's detail opens client-side first, with a skeleton, while the server renders the detail for `?url=<hash>`.
- Findings of the issues in `ISSUE_EVIDENCE` (`@seotools/core/crawl/evidence`) carry bounded evidence: which images, links, canonical declarations or other pages make the URL have it. It is gathered while parsing (`PageFactsCollector` keeps the total in the counters of `CrawlPageFacts` and only the first `MAX_EVIDENCE_ITEMS` samples, with text cut) or from the comparison sets of `loadSite` (which never hold excluded URLs), and stored inside `crawl_url_issues.details` (`serializeIssueDetails`: rows without evidence keep the old array). A finding of such an issue without evidence means the crawl predates it: the UI says so and never invents examples. Show evidence addresses only through `evidenceTarget`, never as raw `href`s or HTML.

### Jobs

- Jobs that may outlast `JOB_LOCK_TIMEOUT_MS` are safe: the runner renews the locks of what it is running. Handlers must still be resumable, since a job can be retried after a crash; throw `JobInterruptedError` to hand one back on shutdown without spending an attempt.
- Crawls run in their own lane (`CRAWL_CONCURRENCY`, `crawl.run` jobs), so that they cannot hold up other jobs.
- `audit.recompute` jobs (default lane) analyse a domain's latest full crawl again from what it stored, with no requests; they are safe to repeat and to run concurrently. Change rules with `db.audit.*`, which queues the job together with the change.
- A domain has one active crawl at most, enforced by the unique `crawls.active_key`. Start crawls with `db.crawls.start`, which creates the crawl and its job together; never enqueue `crawl.run` directly.

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
pnpm format:check && pnpm lint && pnpm typecheck && pnpm db:check && pnpm test && pnpm build
```

`docker.yml` also builds the image on every PR (it only publishes from `main` and `v*.*.*` tags).

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
- A valid session is not authorization. Pages and server actions restricted to a role (e.g. admin) must also check the user's role on the server.
- Use Drizzle's operators, which parameterize values. The only raw `sql` in `@seotools/db` is `select 1`, `count(*)`, the attempt decrement in `jobs.release`, the MySQL job-claim query, and the URL search (`like … escape '!'`) and `is null` ordering of `crawlUrlWhere` / `crawlUrlOrder` (`mapping.ts`). They interpolate Drizzle columns; the only user text in them, the search, is a bound parameter with `%`, `_` and `!` escaped.
- Validate at the boundaries: the environment with the zod schemas in `@seotools/core/env`, job payloads with their schema in `packages/core/src/jobs.ts`, and form input in the server action before touching the database.
- Secrets saved from the admin panel (SMTP password, Resend key) go through the `settings` repository with `encrypted: true` (AES-256-GCM, key `SETTINGS_ENCRYPTION_KEY` or `BETTER_AUTH_SECRET`). Never log them.
- `GET /api/health` is public: it reports status only. Error details stay in the server logs.
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
