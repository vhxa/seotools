<img src="assets/icon.svg" width="64" height="64" alt="">

# seotools

Open source, self-hosted SEO auditing: a site crawler and the checks a technical SEO needs, for an
agency's clients or your own sites. One container, no Redis, runs anywhere Docker does — from a
Raspberry Pi to a VPS.

## What it does

- **Renders JavaScript when enabled** with an isolated optional browser, follows menu links absent
  from served HTML, and reports JavaScript-only links. Choose HTML or Rendered in domain crawl
  settings; new domains use Rendered only when the browser is ready. See [rendering](docs/rendering.md).
- **Crawls whole sites** from the home page, sitemaps and every link, including what `robots.txt`
  blocks (auditing it is the point), with per-domain scope, depth, rate limits, request headers and
  Basic Auth for staging sites and lists of URLs. The Crawls area brings runs, comparison and
  rechecks together; schedules, in your time zone, live in Settings → Schedules.
- **161 checks** for indexation (noindex, robots.txt, canonicals, sitemaps, hreflang), broken
  references, and page quality (titles, descriptions, headings, content, images, structured data
  against Google's rich result requirements, Open Graph and Twitter tags, accessibility, security
  and HTML), including entities shown as text and very few internal links in the served HTML. Findings explain why they matter and show the evidence. Each URL has a search-result
  and share-card preview; a later recheck refreshes it while keeping the crawl's preview available.
- **Your own rules**: declare which URLs should be indexed, require or forbid directives, sitemap
  membership, a canonical to another URL or the absence of internal links, and leave URLs out of
  the audit. One rule can cover several paths and start from a template. Compact controls show
  every condition and what an unstated one inherits; crawl comparisons say whether their rules
  match. Expected findings appear as accepted. Set conventional thresholds (title length, thin
  content…) per domain.
- **HTML/render differences**: rendered crawls report text, metadata, directives and declarations
  added or changed by JavaScript, render redirects, blocked resources, failures and script errors.
  Client redirects preserve graph completeness and leave their abandoned content unknown; partial
  renders keep differences unknown.
- **Finding states and changes**: mark findings in progress or dismiss them for one URL or a whole
  domain, with a note and attribution. Dismissals stay separate from fixes and rule acceptances.
  Filter findings, spot template-wide problems, inspect current site files and crawl differences,
  and see who references broken or redirected targets.
- **Links and parameters**: inspect each link's text, element and part of the page, how the crawler
  found each URL, and where query parameters enter the site. Ignore selected parameter names or
  prefixes from the next crawl; review volatile/canonical suggestions, separately marked tracking
  names and currently ignored names on the Parameters page ([details](docs/ignored-parameters.md)).
- **History and exports**: compare crawls, follow a URL's history, recheck individual URLs and
  export pages, findings, links and redirects as CSV.
- **Crawl files and bot access**: inspect `robots.txt` with each AI bot's access, sitemaps, `llms.txt`
  and optional `ads.txt`, `security.txt`, feeds, OpenSearch and IndexNow. From robots.txt, compare
  homepage responses to published bot User-Agent strings on demand; simulated requests cannot
  prove whether real bots can access the site.
- **Core Web Vitals** from Google CrUX (field) and PageSpeed Insights (lab), with trends and URL
  findings. Paused, archived, disabled or keyless runs collect nothing and are not caught up later.
- **Opt-in email alerts** for changes between crawls and Core Web Vitals regressions after full
  crawls. Daily site-file, availability and certificate checks record incidents, show open ones on
  the dashboard and keep a 30-day history in Issues; they are not an uptime monitor.
- **Optional JavaScript rendering**: crawls can run each page in a browser container that has no
  network of its own (every request goes through the crawler), report links and pages that only
  exist after JavaScript, and never mix rendered and HTML results in comparisons;
  [setup guide](docs/rendering.md).
- **Custom extraction** of values with CSS selectors.
- **Portfolio and structure**: see every domain by company with its last crawl, figures and trend,
  and explore a domain by directory with pages, errors and findings. Star a favourite domain to
  open it automatically, and reach all domains from the switcher.
- **Teams and personal preferences**: administrators and per-company or per-domain editors and
  viewers; each person can edit their name and choose English, Spanish or the browser's language
  on their account. The choice also applies to their alert and access emails.
- **Self-hosted** with SQLite or PostgreSQL and `linux/amd64` and `linux/arm64` images on GHCR.

A look at the demo site: dashboard, findings, URL inventory and share preview.

| Dashboard                                           | Issues                                                           |
| --------------------------------------------------- | ---------------------------------------------------------------- |
| ![Domain dashboard](docs/screenshots/dashboard.png) | ![Issues grouped by importance](docs/screenshots/issues.png)     |
| URLs                                                | Share preview                                                    |
| ![URL inventory](docs/screenshots/urls.png)         | ![Search and social preview](docs/screenshots/share-preview.png) |

## Quick start (Docker Compose)

```bash
git clone https://github.com/vhxa/seotools.git && cd seotools
cp .env.example .env
```

Edit `.env` and set at least:

| Variable             | What to put                                                          |
| -------------------- | -------------------------------------------------------------------- |
| `BETTER_AUTH_SECRET` | Random secret, 32+ chars: `openssl rand -base64 32`                  |
| `BETTER_AUTH_URL`    | The URL you will open in the browser, e.g. `https://seo.example.com` |

```bash
docker compose up -d
```

Open <http://localhost:3000>. The first time, it asks you to create the admin account (name,
email and password), signs you in, and then asks for your first company and domain (`example.com`,
without `https://` or `www.`). Domains are grouped by company, like an agency groups them by
client, and you switch between them from the domain selector in the header; the search box next to
it finds any URL of the domain. Run a full crawl from the domain's overview; **Administration →
Status** shows whether the database and the worker are healthy.

Data lives in the `seotools-data` volume (`/data` in the container). To build the image yourself
instead of pulling it, use `docker compose up -d --build`.

This pulls the newest **stable release**. For anything you rely on, pin a version
(`SEOTOOLS_IMAGE` in `.env`) and update it on purpose: see [Updating](#updating).

## Configuration

Administrators can save an encrypted Google API key in **Administration → Integrations**. With collection enabled in a domain’s Crawling settings, its page addresses and origin are sent to Google after each full crawl. The key's Google Cloud project needs the **Chrome UX Report API** (field data) and the **PageSpeed Insights API** (lab data) enabled, and a key restricted to APIs must allow both. Data is collected after the next full crawl; earlier crawls are not filled in.

All configuration is through environment variables. See [`.env.example`](.env.example) for the
annotated list.

| Variable                         | Default                                                                                                             | Description                                                              |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ |
| `BETTER_AUTH_SECRET`             | —                                                                                                                   | **Required.** 32+ chars. Signs sessions.                                 |
| `BETTER_AUTH_URL`                | `http://localhost:3000`                                                                                             | Public URL of the app. Must match the browser's address.                 |
| `TRUSTED_ORIGINS`                | —                                                                                                                   | Extra comma-separated origins allowed to call the auth API.              |
| `SETTINGS_ENCRYPTION_KEY`        | `BETTER_AUTH_SECRET`                                                                                                | Key for secrets saved from the admin panel (SMTP password, Resend key).  |
| `DATABASE_URL`                   | `file:/data/seotools.db`                                                                                            | `file:…` (SQLite) or `postgres://…`.                                     |
| `DATABASE_DIALECT`               | inferred                                                                                                            | `sqlite` \| `pg`. Only if it can't be inferred from the URL.             |
| `RUN_MIGRATIONS`                 | `true`                                                                                                              | Apply pending migrations at startup.                                     |
| `PORT`                           | `3000`                                                                                                              | HTTP port (in Compose: the host port; the container always uses 3000).   |
| `LOG_LEVEL`                      | `info`                                                                                                              | `fatal` … `trace`, or `silent`.                                          |
| `WORKER_CONCURRENCY`             | `2`                                                                                                                 | Jobs processed in parallel.                                              |
| `WORKER_POLL_INTERVAL_MS`        | `1000`                                                                                                              | How often an idle worker looks for jobs.                                 |
| `JOB_LOCK_TIMEOUT_MS`            | `300000`                                                                                                            | A job running longer than this is assumed orphaned and re-queued.        |
| `CRAWL_CONCURRENCY`              | `2`                                                                                                                 | Crawls running in parallel, in slots separate from other jobs.           |
| `RENDER_BROWSER_URL`             | Optional worker DevTools URL (`http://browser:9222`); unset disables rendering. See [the guide](docs/rendering.md). |
| `RENDER_CONCURRENCY`             | Simultaneous rendered pages per worker (default `2`, range `1–4`; use `1` on Raspberry Pi).                         |
| `CRAWLER_ALLOW_PRIVATE_NETWORKS` | `false`                                                                                                             | Let the crawler reach private addresses, to audit sites on your network. |
| `SEOTOOLS_PAUSE_AUTOMATION`      | `false`                                                                                                             | Staging copies: no scheduled crawls, refreshes, update checks or email.  |
| `SEOTOOLS_MODE`                  | `all`                                                                                                               | Docker only: `all`, `web`, `worker` or `migrate` (see below).            |

### Accounts

Accounts never come from environment variables. The first time the app is opened it asks for the
first administrator (name, email, password); from then on that page is closed and there is no public
sign-up. Register right after deploying, before you share the URL.

Administrators invite more people from **Administration → Users**, as administrators or members
with access to some companies or domains. Forgotten passwords are reset by email when email is set
up (Administration → Email), with a link an administrator generates, or, if nobody can sign in, with
`node worker/dist/recover.mjs <email>` in the container.

### Changing `BETTER_AUTH_SECRET`

Rotating it signs everyone out. It is also the default key that encrypts secrets saved from the
admin panel, so after a rotation those settings can't be decrypted. Set `SETTINGS_ENCRYPTION_KEY` to
the **old** secret first (or to any fixed 32+ char value from the start) to keep them readable.

## Deploying

The image is `ghcr.io/vhxa/seotools`. `1.2.3` is one release, `1.2` follows its patches (and,
from 1.0.0, `1` follows its minor versions), `latest` is the newest stable release, and `edge` and
`sha-<commit>` are development builds of `main`, never releases. What each tag means and which one
to use is in [docs/updating.md](docs/updating.md#image-tags). In production, pin one.

### VPS with Docker Compose

Follow the quick start, then put a reverse proxy with HTTPS in front of port 3000 (Caddy, Traefik,
nginx…). Set `BETTER_AUTH_URL` to the public `https://` URL — login fails if it doesn't match.

Caddy example:

```
seo.example.com {
    reverse_proxy localhost:3000
}
```

### Dokploy / Coolify

Both can deploy either the prebuilt image or this repository's `Dockerfile` (or `docker-compose.yml`).

1. Create an application from the image `ghcr.io/vhxa/seotools:<version>` (or from this Git
   repo), with a version or a patch channel such as `0.2`, not `latest`.
2. Set the environment variables: `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL` = the domain you
   assign to the app (with `https://`).
3. Add a **persistent volume** mounted at `/data` (this is where SQLite lives — without it you lose
   your data on every redeploy).
4. Expose container port **3000** and attach your domain.

The image has a built-in health check (`/api/health`), which both platforms pick up. Dokploy
re-pulls the image you saved when you press **Deploy**, so it does not move to a newer version
unless the image reference points at one: [docs/updating.md](docs/updating.md#update-with-dokploy)
says when Deploy is enough.

### Raspberry Pi (arm64)

Use a 64-bit OS (Raspberry Pi OS 64-bit or Ubuntu Server) with Docker installed, then follow the quick
start. Docker pulls the `arm64` variant automatically; nothing is compiled on the device. SQLite is
the right choice here. Keep the volume on reliable storage (an SSD, or a good SD card).

### PostgreSQL

Set `DATABASE_URL_DOCKER` in `.env` for Docker Compose. Compose overrides
`DATABASE_URL` (reserved here for local development) with this value, defaulting to SQLite.

```bash
# PostgreSQL (tested on 17)
DATABASE_URL_DOCKER=postgres://seotools:secret@db:5432/seotools
```

For direct `docker run` or a Dokploy Docker application, use the same URL in `DATABASE_URL`
instead.

Create the (empty) database first; migrations create the tables. The `/data` volume is then unused.

Already running on SQLite? A one-off command copies your data to PostgreSQL:
[Move from SQLite to PostgreSQL](docs/updating.md#move-from-sqlite-to-postgresql). MySQL is not
supported.

### Running web and worker separately

By default one container runs both, so the UI and the job processor always live and die together
(if either process crashes, the container exits and your orchestrator restarts it).

With PostgreSQL you can scale them independently using the same image:

```yaml
services:
  web:
    image: ghcr.io/vhxa/seotools:latest
    environment: { SEOTOOLS_MODE: web } # migrates, then serves the UI
    env_file: .env
    ports: ['3000:3000']
  worker:
    image: ghcr.io/vhxa/seotools:latest
    environment: { SEOTOOLS_MODE: worker } # processes jobs; does not migrate
    env_file: .env
    depends_on: { web: { condition: service_healthy } }
```

### Backups

A backup is the database plus your secrets (`BETTER_AUTH_SECRET`, `SETTINGS_ENCRYPTION_KEY`). With
SQLite, copy the **whole** `/data` directory with the container stopped, not only `seotools.db`: recent
writes live in `seotools.db-wal`. With PostgreSQL, use `pg_dump`. The
commands, and how to restore, are in [docs/updating.md](docs/updating.md#backups-and-restore).

### Health check

`GET /api/health` is public and returns:

```json
{
  "status": "ok",
  "version": "0.2.0",
  "channel": "release",
  "db": { "ok": true, "dialect": "sqlite" },
  "worker": { "ok": true, "lastSeen": "…" }
}
```

`channel` is `release` for an image the release workflow published and `development` for anything
else (`edge`, `sha-…`, a local build): the version of a development build is the last release it
descends from. `status` is `ok`, `degraded` (database fine, worker hasn't checked in for 30 s; still HTTP 200) or
`down` (database unreachable; HTTP 503). Add `?require=worker` to also get a 503 when the worker is
missing — the Docker health check does this in `all` mode.

## Updating

seotools never replaces its own container, and needs no access to Docker to be updated. **Administration
→ Updates** shows the installed version, the latest stable release, and when and how
the last check ended; you check by hand or let the worker check once a day (off by default; it sends
nothing about your domains). An update is then **your** decision: read the release notes, take a
backup, change the image tag if needed and redeploy. Docker Compose, Dokploy (manual and
automatic), migrations, keys, rollback and what has been validated are in
[docs/updating.md](docs/updating.md). Changes are listed in [CHANGELOG.md](CHANGELOG.md).

## Development

Requirements: Node.js 24 and [pnpm](https://pnpm.io) 12 (`corepack enable` or `npm i -g pnpm`).

```bash
pnpm install
cp .env.example .env
# edit .env: set BETTER_AUTH_SECRET, and uncomment
#   DATABASE_URL=file:../../data/seotools.db
# so that web and worker share one SQLite file
pnpm dev          # applies migrations, then runs web (:3000) and worker with hot reload
```

| Command                                                     | What it does                                       |
| ----------------------------------------------------------- | -------------------------------------------------- |
| `pnpm dev`                                                  | Migrate, then run web + worker in watch mode       |
| `pnpm build`                                                | Build everything (Next standalone + worker bundle) |
| `pnpm lint` / `pnpm typecheck`                              | ESLint / TypeScript                                |
| `pnpm format` / `pnpm format:check`                         | Prettier                                           |
| `pnpm test`                                                 | Vitest                                             |
| `pnpm --filter @seotools/db generate --name <what_changed>` | Generate Drizzle migrations for **both** dialects  |
| `pnpm db:check`                                             | Verify the migration files are consistent          |
| `pnpm release:check`                                        | Package versions and `CHANGELOG.md` agree          |

PostgreSQL tests are skipped unless you provide a database:

```bash
TEST_POSTGRES_URL=postgres://postgres:test@localhost:5432/seotools \
pnpm test
```

CI runs them against a real Postgres service.

### Where things are

`apps/web` is the Next.js app, `apps/worker` the job runner and crawler (and the `bootstrap`,
`recover` and `migrate-db` commands), `packages/core` the shared logic and `packages/db` the schemas,
migrations and repositories for both databases. The rules that keep them consistent are in
[AGENTS.md](AGENTS.md).

### Releases

Versions follow `MAJOR.MINOR.PATCH`, and every change says in `CHANGELOG.md` what it does to the next
one. Only a release pull request changes the version, and only a pushed `vX.Y.Z` tag publishes images
and a GitHub release. How to classify a change, when to release and how to validate, publish and check
a release: [docs/releases.md](docs/releases.md).

## License

[GNU AGPL-3.0](LICENSE). If you run a modified version as a network service, you must offer its
source to the users of that service.
