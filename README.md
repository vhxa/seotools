<img src="assets/icon.svg" width="64" height="64" alt="">

# seotools

Open source, self-hosted SEO toolkit. One container, no Redis, runs anywhere Docker does — from a
Raspberry Pi to a VPS.

> **Status: early.** The platform (web app, background worker, auth, database, deployment) and the
> site crawler are in place. The SEO audits built on top of the crawl come next.

- **Web** — Next.js (App Router) with shadcn/ui, single-admin login via [better-auth](https://better-auth.com).
- **Worker** — processes background jobs stored in your database. No Redis or external queue.
- **Database** — SQLite by default (zero setup), PostgreSQL by changing `DATABASE_URL`.
  Migrations run automatically on startup.
- **Notifications (base)** — email via SMTP ([nodemailer](https://nodemailer.com)) or
  [Resend](https://resend.com). The admin panel to configure them is coming; the encrypted settings
  storage and the `mail.send` job are already in place.
- **Crawler** — full crawls that request every URL of a domain (from the home page, its sitemaps
  and everything linked anywhere, ignoring `robots.txt` and meta robots on purpose, since auditing
  them is the point), crawls of pages marked as priority, and recurring schedules for both.
- **Crawl files** — what a site publishes for crawlers, kept up to date by crawls and a daily check:
  `robots.txt` with the access of each AI bot, sitemaps and `llms.txt`, plus `ads.txt`, `app-ads.txt`,
  `security.txt`, `humans.txt`, feeds, OpenSearch and the IndexNow key when a domain enables them.
- **Multi-arch image** — `linux/amd64` and `linux/arm64`, published to GHCR.

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
client, and you switch between them from the selector in the header. The **System** page shows the
database and worker status and lets you enqueue an example job, so you can see the whole pipeline
working.

Data lives in the `seotools-data` volume (`/data` in the container). To build the image yourself
instead of pulling it, use `docker compose up -d --build`.

This pulls the newest **stable release**. For anything you rely on, pin a version
(`SEOTOOLS_IMAGE` in `.env`) and update it on purpose: see [Updating](#updating).

> **No release has been published yet**, so `latest` does not exist yet. Until the first one, build
> the image from source (`docker compose up -d --build`) or run a development build of `main` with
> `SEOTOOLS_IMAGE=ghcr.io/vhxa/seotools:edge` in `.env`.

## Configuration

All configuration is through environment variables. See [`.env.example`](.env.example) for the
annotated list.

| Variable                         | Default                  | Description                                                              |
| -------------------------------- | ------------------------ | ------------------------------------------------------------------------ |
| `BETTER_AUTH_SECRET`             | —                        | **Required.** 32+ chars. Signs sessions.                                 |
| `BETTER_AUTH_URL`                | `http://localhost:3000`  | Public URL of the app. Must match the browser's address.                 |
| `TRUSTED_ORIGINS`                | —                        | Extra comma-separated origins allowed to call the auth API.              |
| `SETTINGS_ENCRYPTION_KEY`        | `BETTER_AUTH_SECRET`     | Key for secrets saved from the admin panel (SMTP password, Resend key).  |
| `DATABASE_URL`                   | `file:/data/seotools.db` | `file:…` (SQLite) or `postgres://…`.                                     |
| `DATABASE_DIALECT`               | inferred                 | `sqlite` \| `pg`. Only if it can't be inferred from the URL.             |
| `RUN_MIGRATIONS`                 | `true`                   | Apply pending migrations at startup.                                     |
| `PORT`                           | `3000`                   | HTTP port (in Compose: the host port; the container always uses 3000).   |
| `LOG_LEVEL`                      | `info`                   | `fatal` … `trace`, or `silent`.                                          |
| `WORKER_CONCURRENCY`             | `2`                      | Jobs processed in parallel.                                              |
| `WORKER_POLL_INTERVAL_MS`        | `1000`                   | How often an idle worker looks for jobs.                                 |
| `JOB_LOCK_TIMEOUT_MS`            | `300000`                 | A job running longer than this is assumed orphaned and re-queued.        |
| `CRAWL_CONCURRENCY`              | `2`                      | Crawls running in parallel, in slots separate from other jobs.           |
| `CRAWLER_ALLOW_PRIVATE_NETWORKS` | `false`                  | Let the crawler reach private addresses, to audit sites on your network. |
| `SEOTOOLS_MODE`                  | `all`                    | Docker only: `all`, `web`, `worker` or `migrate` (see below).            |

### The admin account

The admin account is never configured through environment variables. The first time the app is
opened it shows a setup page where you register the admin (name, email, password) and signs you in.
From then on that page is closed and every visit goes to the login form. Public sign-up is disabled.

Whoever opens a fresh install first becomes its admin, so register right after deploying — before
you share the URL or open the port to the internet.

There is no password reset yet. While the admin is the only user, you can recover from a lost
password by deleting the row in the `user` table; the setup page comes back on the next visit. Its sessions and credentials are removed with it, but
SQLite only cascades when foreign keys are on, so run `PRAGMA foreign_keys = ON;` first in the
`sqlite3` shell.

### Changing `BETTER_AUTH_SECRET`

Rotating it signs everyone out. It is also the default key that encrypts secrets saved from the
admin panel, so after a rotation those settings can't be decrypted. Set `SETTINGS_ENCRYPTION_KEY` to
the **old** secret first (or to any fixed 32+ char value from the start) to keep them readable.

## Deploying

The image is `ghcr.io/vhxa/seotools`. `1.2.3` is one release, `1.2` follows its patches (and,
from 1.0.0, `1` follows its minor versions), `latest` is the newest stable release, and `edge` and
`sha-<commit>` are development builds of `main`, never releases. What each tag means and which one
to use is in [docs/updating.md](docs/updating.md#image-tags). In production, pin one.

> A package published to GHCR is **private** until you make it public (GitHub → Packages →
> seotools → Package settings → Change visibility). Do that once so anyone can `docker pull`
> without logging in.

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
  "version": "0.1.0",
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

seotools never replaces its own container, and needs no access to Docker to be updated. **System →
Updates** (administrators) shows the installed version, the latest stable release, and when and how
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

### Layout

```
apps/
  web/        Next.js app: UI, /api/health, better-auth routes, server actions
  worker/     Job runner + handlers (example.echo, mail.send); also the bootstrap CLI
packages/
  core/       Env validation, logger, job types, settings encryption, mail (SMTP + Resend)
  db/         Drizzle schemas + migrations for sqlite/pg, repositories, first-run admin
docker/       Container entrypoint and healthcheck
docs/         Guides: updating an installation, making a release
scripts/      Release tooling (`node scripts/release.mjs`)
```

### How it fits together

- **Jobs** are rows in the `jobs` table. The worker claims due rows atomically
  (`FOR UPDATE SKIP LOCKED` on Postgres, an immediate transaction on SQLite), retries failures
  with exponential backoff, recovers jobs left `running` by a crashed worker, and writes a heartbeat
  that `/api/health` reads. To add a job: register its type and payload schema in
  `packages/core/src/jobs.ts` and a handler in `apps/worker/src/handlers/`.
- **One schema per dialect.** Drizzle tables are dialect-specific, so there is a schema file and a
  migrations folder for each of SQLite and PostgreSQL. When you change a schema, change both
  and run `pnpm --filter @seotools/db generate --name <description>`. The shared contract test in
  `packages/db/src/test/contract.ts` runs against both dialects.
- **Email settings** are stored as JSON in the `settings` table, encrypted with AES-256-GCM
  (`SETTINGS_ENCRYPTION_KEY`, or `BETTER_AUTH_SECRET`). `getMailer(settings)` in `@seotools/core`
  builds a nodemailer or Resend client from them; the `mail.send` job uses it.

### Releases

Versions follow `MAJOR.MINOR.PATCH`, and every change says in `CHANGELOG.md` what it does to the next
one. Only a release pull request changes the version, and only a pushed `vX.Y.Z` tag publishes images
and a GitHub release. How to classify a change, when to release and how to validate, publish and check
a release: [docs/releases.md](docs/releases.md).

## License

[GNU AGPL-3.0](LICENSE). If you run a modified version as a network service, you must offer its
source to the users of that service.
