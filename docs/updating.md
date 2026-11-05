# Updating seotools

For whoever runs an installation. For how releases are made, see [releases.md](releases.md).

- [What is installed, and what is new](#what-is-installed-and-what-is-new)
- [Image tags](#image-tags)
- [Before updating](#before-updating)
- [What an update does](#what-an-update-does)
- [Update with Docker Compose](#update-with-docker-compose)
- [Update with Dokploy](#update-with-dokploy)
- [Automatic updates with Dokploy (optional)](#automatic-updates-with-dokploy-optional)
- [Check the result](#check-the-result)
- [When something goes wrong](#when-something-goes-wrong)
- [Backups and restore](#backups-and-restore)
- [What has been validated](#what-has-been-validated)

seotools never updates itself. The container is replaced by Docker or Dokploy, with the version
you choose. The app does not need, and never asks for, access to the Docker socket. What it does
is tell you whether a newer release exists, and that is only a message: **looking for updates and
installing them are two separate things.**

## What is installed, and what is new

**System → Updates** (administrators) shows:

- the installed version and what kind of build it is: a release, a release candidate or a
  development build;
- the latest stable release, when the last check ran and how it ended;
- links to the release notes and to this guide.

It tells four situations apart, and the first two are the only ones that say anything about the
version:

| It says                     | It means                                                                                                     |
| --------------------------- | ------------------------------------------------------------------------------------------------------------ |
| You are up to date          | The last check succeeded and found nothing newer than what you run.                                          |
| Version X is available      | A stable release newer than yours exists. It also says whether the update can include breaking changes.      |
| Could not check for updates | The last attempt failed (no network, GitHub limiting requests…). **That is not "up to date": nobody knows.** |
| Development build           | The image was not built from a release (`edge`, a `sha-…` tag, or built from source). It is never compared.  |

(Before the first check it says "Not checked yet".)

**Checking** is done by hand with **Check now**, or once a day by the worker if you turn on
**Periodic checks**. They are off by default. A check is one request to
`api.github.com/repos/botaroikawa/seotools/releases/latest` with a fixed `User-Agent`. It sends
nothing about your domains, your data or your installation, not even the version you run; GitHub
sees the address your server connects from, like any website would. Visiting the page never makes
a request: it shows what was stored. A failed check is stored as a failure and retried after an
hour.

GitHub limits anonymous requests to 60 an hour per address. On a server whose address is shared
with many others the check can answer "rate limited"; it says so and tries again later.

The same information is public without logging in: `GET /api/health` returns `version` and
`channel` (`release` or `development`).

## Image tags

The image is `ghcr.io/botaroikawa/seotools`, for `linux/amd64` and `linux/arm64`.

| Tag           | What it is                                                                                | Moves?                     | Use it for                                        |
| ------------- | ----------------------------------------------------------------------------------------- | -------------------------- | ------------------------------------------------- |
| `0.2.1`       | Exactly that release.                                                                     | Never.                     | Production, when you choose each update.          |
| `0.2`         | The newest patch of 0.2: bug fixes and compatible changes only.                           | With each 0.2.x release.   | Production, to receive compatible updates.        |
| `1`           | The newest release of major version 1 (from 1.0.0 on; there is no `0` tag, see below).    | With each 1.x release.     | Production, to receive features without breaking. |
| `latest`      | The newest **stable** release, whatever its number. It can jump to a version that breaks. | With every stable release. | A first install or trying it out. Not unattended. |
| `0.3.0-rc.1`  | A release candidate: for testing before a release.                                        | Never.                     | A staging copy. Never your only copy of the data. |
| `edge`        | The last commit of `main`. **A development build, not a release.**                        | With every merge.          | Developing seotools.                              |
| `sha-a651c7a` | The build of one commit of `main`. Also a development build.                              | Never.                     | Reproducing a problem of a development build.     |

How to read a version, `MAJOR.MINOR.PATCH`:

- **PATCH**: compatible fixes. Safe to follow with the `X.Y` tag.
- **MINOR**: new features. From 1.0.0 they are compatible. **While the major version is 0, a
  minor release can include breaking changes**, announced in its release notes with upgrade
  instructions. That is why `0.2` follows patches only, and why there is no `0` tag.
- **MAJOR** (from 1.0.0): breaking changes.

A release candidate is older than the release it precedes (`0.3.0-rc.1` < `0.3.0`), never becomes
`latest`, and is never offered by the Updates page.

A development build reports itself as one everywhere: in the sidebar (`v0.2.0 · development`), in
`/api/health` (`"channel": "development"`) and on the Updates page. Its version number is the last
release it descends from, not a release.

## Before updating

1. **Read the release notes** of every version between yours and the target: the
   [GitHub releases](https://github.com/botaroikawa/seotools/releases) or
   [`CHANGELOG.md`](../CHANGELOG.md). Look for **Breaking** and **Upgrade notes**. Say no to an
   update you have not read.
2. **Take a backup** and check you can read it ([Backups and restore](#backups-and-restore)). It
   is the only way back once the new version has migrated your database.
3. **Keep your secrets**: `BETTER_AUTH_SECRET` and, if you set it, `SETTINGS_ENCRYPTION_KEY` must be
   the same after the update.
4. Note what runs now (`curl http://localhost:3000/api/health`).
5. Pick a quiet moment. The container restarts: the interface is unavailable for the time it takes
   to stop, migrate and start (usually under a minute), and a crawl in progress is interrupted and
   resumes from its stored queue.

## What an update does

- **The container is replaced.** Everything inside it is lost except what is stored outside: the
  `/data` volume (SQLite, the default) or your PostgreSQL/MySQL server. seotools keeps nothing
  else.
- **Migrations run by themselves**, on every start, before the web app and the worker start
  (`RUN_MIGRATIONS=true`). They apply in order and only forward: there is no "down". Some releases
  also convert stored data or analyse earlier crawls again in the background after starting; the
  release notes say so.
- **Nothing stops an older image from opening a newer database.** It starts, says "migrations
  applied", and runs on a schema it does not know. With luck it works (it did when the only new
  migrations added tables and nullable columns); with a migration that changes what an old column
  means it will misbehave without saying so. **Going back to an older image can require restoring
  the database** — plan for that, not for luck.
- **Keys must not change.** `BETTER_AUTH_SECRET` signs sessions (changing it signs everyone out) and,
  unless `SETTINGS_ENCRYPTION_KEY` is set, encrypts the SMTP and Resend secrets (changing it makes
  them unreadable). Both go in the environment of the new container exactly as before.
- **Health.** The image declares its own health check (`/api/health?require=worker`, 40 s of grace
  at start). Once healthy it reports the new `version`.
- **Never two copies at once.** One container per SQLite database. Do not run the old and the new
  version side by side (no "start the new one before stopping the old one", no replicas above 1).
- **Split web and worker** (PostgreSQL/MySQL only): use the same tag for both, and update `web`
  first, because only `web` migrates.

## Update with Docker Compose

```bash
# 1. Back up (see below). Then choose the version in .env:
#    SEOTOOLS_IMAGE=ghcr.io/botaroikawa/seotools:0.2.1   # exactly this release
#    SEOTOOLS_IMAGE=ghcr.io/botaroikawa/seotools:0.2     # the newest 0.2.x
docker compose pull
docker compose up -d          # recreates the container only if the image changed
docker compose logs -f seotools   # look for: migrations applied, started in "all" mode
curl -s http://localhost:3000/api/health
```

`docker compose pull` followed by `up -d` with an exact tag does nothing new: to move to another
release, change the tag. With a channel tag (`0.2`) it brings the new patches.

## Update with Dokploy

Dokploy runs the image as a Docker Swarm service. Set the application up once:

- **Source**: Docker. **Docker Image**: `ghcr.io/botaroikawa/seotools:<tag>`. **Registry URL**:
  `ghcr.io`. Username and password only if the package is private.
- **Environment**: `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL` (the public `https://` URL) and anything
  else from the README. They survive a Deploy; do not change the two keys.
- **Volume Mount** at `/data` (SQLite). Without it every Deploy erases your data.
- **Replicas**: 1. Keep Swarm's update order at its default, which stops the old container
  before starting the new one: never start the new one beside the old one on the same SQLite file.
  Dokploy's zero-downtime guide describes waiting for the new container's health check before
  switching traffic: that is for stateless applications. With SQLite accept the short pause, and if
  your version offers "start first" ordering, do not use it.
- **Stop Grace Period**: at least 40 s, so that the worker can finish what it is doing. Dokploy
  stores it with the Swarm settings of the application (`stopGracePeriod`); its documentation does
  not describe it, so look for it in the Advanced tab of your version.
- **Health check**: leave the one the image declares. If you set Dokploy's own, do not use `curl`
  (the image does not have it): use `node /app/healthcheck.mjs`.
- **Auto Deploy**: leave it off unless you build [automatic updates](#automatic-updates-with-dokploy-optional).

To update by hand:

1. **Back up.** With Dokploy's _Volume Backups_ (S3 destination, cron; leave "turn off container"
   on, because it is the only way a SQLite file is copied consistently) or by hand on the server
   ([Backups and restore](#backups-and-restore)).
2. **Choose the version** (next section) and, if needed, change **Docker Image**. Save.
3. **Deploy**, and follow the deployment logs until the new container is healthy.
4. [Check the result](#check-the-result).

### When "Deploy" is enough, and when to change the image first

Dokploy pulls the image reference you saved every time you press **Deploy** (it runs
`docker pull <image>` before replacing the service; read in its source on 2026-11-04). So what
Deploy brings depends on what the reference points at:

| The application's image is | Deploy brings                                   | To get a newer release                                                     |
| -------------------------- | ----------------------------------------------- | -------------------------------------------------------------------------- |
| `…seotools:0.2.1` (exact)  | **The same image again. Nothing changes.**      | Change it to `…:0.2.2` (or newer), Save, Deploy.                           |
| `…seotools:0.2` (channel)  | The newest 0.2.x: new patches.                  | Deploy for patches. For 0.3, change it to `…:0.3` after reading the notes. |
| `…seotools:latest`         | The newest stable release, wherever it is.      | Deploy — and accept that it can cross a version that breaks.               |
| `…seotools:edge`           | The last commit of `main`: a development build. | Not for production.                                                        |

Redeploying a pinned version never selects a newer one; the Updates page saying "Version 0.2.2 is
available" changes nothing by itself.

## Automatic updates with Dokploy (optional)

**Off by default**, and nothing in seotools turns it on. Do this only if you accept that an
update can happen while nobody is watching.

### What Dokploy gives, and what it does not

- Publishing an image to GHCR **does not update any installation.** No registry tells your Dokploy
  that a tag moved.
- Dokploy's documented automatic deployments are _webhooks_ — for Git providers and, for images,
  **Docker Hub only** — and its _API_: `POST /api/application.deploy` with an `x-api-key` header and
  `{"applicationId": "…"}` (the Auto Deploy page of its documentation; `application.redeploy` and
  `application.saveDockerProvider`, which changes the image, are in its OpenAPI specification).
- Dokploy's code also recognises GitHub `registry_package` events for GHCR images and compares the
  image and tag with the application's. That is not documented, and it needs a webhook in the
  GitHub repository or organisation **that owns the package**: the maintainers of seotools, not
  you. It is not a way for an installation to follow releases.

So automatic updates are **your own trigger calling Dokploy's API**. The rest of this section is
that trigger, with the checks it should make before it acts.

### The channel it may follow

Let it follow a **compatibility line**: `0.2` (patches of 0.2) while the major version is 0, `1`
or `1.4` after. Never `latest`, never `edge`, never a candidate: a channel tag cannot jump to a
version that breaks, and moving to the next line stays a decision you make by hand
(change the image, after reading the notes).

### The trigger

[`docs/examples/dokploy-auto-update.sh`](examples/dokploy-auto-update.sh) is a script for a cron job
or a scheduled workflow **outside** the seotools container (nothing of this runs inside it). With
`DOKPLOY_URL`, `DOKPLOY_API_KEY`, `DOKPLOY_APPLICATION_ID` and `SEOTOOLS_URL` set, once a day:

```cron
17 4 * * *  DOKPLOY_URL=https://dokploy.example.com DOKPLOY_API_KEY=… DOKPLOY_APPLICATION_ID=… \
            SEOTOOLS_URL=https://seo.example.com SEOTOOLS_TAG=0.2 /opt/seotools/dokploy-auto-update.sh
```

Before it calls Dokploy, it checks, and stops (with a non-zero exit code, so cron or the workflow
tells you) when any of these fails:

1. The tag it follows is a compatibility line (`X.Y` or `X`): not `latest`, `edge`, `sha-…` or a
   candidate.
2. The image behind that tag really changed since the last deployment it made (it compares
   digests: it does not restart a healthy application to run the same image).
3. The instance answers `/api/health` with `status: ok` and `channel: release`: it does not update
   something that is already broken, or a development build.
4. Your own pre-update step succeeds (`PRE_UPDATE_COMMAND`: a command that takes a backup and
   fails if it could not; there is no default, because only you know how yours is made).

After calling Dokploy it waits for the instance to report a **different version** and `status: ok`,
and fails if it does not within ten minutes.

What it does **not** do: read the release notes (a patch can still have an upgrade note), and roll
back. If the new version fails to start Dokploy's Swarm rollback may put the previous image back
when the health check fails during the deployment, but a database the new version already migrated
needs the backup ([When something goes wrong](#when-something-goes-wrong)).

An API key of Dokploy can do much more than this. Keep it where only the trigger can read it.

## Check the result

- `curl -s http://localhost:3000/api/health` → `"status": "ok"`, the `version` you expected and
  `"channel": "release"` (it is `development` for `edge` and `sha-…`).
- **System → Updates** shows the same version, and "up to date" after a new check.
- The log of the container has `migrations applied` and `started in "all" mode`.
- Open a domain and a crawl you know: your data is there.

## When something goes wrong

**The new container does not become healthy.** Read its log. The usual causes are a missing or
changed environment variable (`BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`), a volume that was not mounted
(an empty database opens the setup page: do not register an admin on it; stop and mount the
volume), or a migration that failed (the container exits right after the error). If it never said
`migrations applied`, fix the cause and deploy again; if you are not sure, restore the backup.

**You want the previous version back.**

- If the new version **never ran migrations** (it failed before `migrations applied`): put the
  previous image back and deploy.
- If it **did** (even if it then crashed): put the previous image back **and restore the backup you
  took before updating**. Whatever was written since — crawls, rules, rechecks — is lost with it.
  An older image started on a newer database does not refuse to, and cannot promise to work.
  Dokploy's registry-based rollback restores the image only; its documentation does not say it
  restores data.

Restore the backup with the container stopped, then start the older image
([Backups and restore](#backups-and-restore)). Then write down what failed, and wait for the fixed
release before trying again.

## Backups and restore

Back up **the database and your secrets** (`BETTER_AUTH_SECRET`, `SETTINGS_ENCRYPTION_KEY`, and the
`.env` or the environment of the Dokploy application). Without the secrets a restored database
signs everyone out and its saved SMTP/Resend settings cannot be read.

### SQLite (the default)

SQLite keeps recent writes in `seotools.db-wal` next to `seotools.db`, and they stay there after a
stop. **Copy the whole directory, never only `seotools.db`.** Stop the container first (or use
`sqlite3 seotools.db ".backup 'copy.db'"`, which is safe while it runs):

```bash
docker compose stop seotools
docker run --rm -v seotools_seotools-data:/data -v "$PWD":/backup debian:trixie-slim \
  cp -a /data /backup/seotools-data-$(date +%F)
docker compose start seotools
```

(`seotools_seotools-data` is `<compose project>_seotools-data`: check with `docker volume ls`. On
Dokploy, use the name of the volume of the application.)

To restore, with the container stopped. The files must belong to the user the app runs as (`1000`),
or the app starts and then fails with "attempt to write a readonly database":

```bash
docker compose stop seotools
docker run --rm -v seotools_seotools-data:/data -v "$PWD":/backup debian:trixie-slim sh -c \
  'find /data -mindepth 1 -delete && cp -a /backup/seotools-data-2026-11-04/. /data/ && chown -R 1000:1000 /data'
# put the image you want back (SEOTOOLS_IMAGE in .env), then:
docker compose up -d
```

### PostgreSQL and MySQL

Use `pg_dump` / `mysqldump` as usual, before updating, and keep the dump with the secrets. Restore
into an empty database, with seotools stopped. If a migration fails on MySQL, its tables can be
left half-changed (it cannot roll back schema changes): restore the dump.

## What has been validated

The procedure above was run on 2026-11-04 with two images built from this repository, on Docker
Desktop and a SQLite volume: one from the commit that introduced this policy, and an older one
whose database has two fewer migrations.

- **Update with data.** The old image created an admin, a company and a domain. A backup of the
  volume was taken as above. The new image started on the same volume with the same secrets,
  applied the two pending migrations by itself (12 → 14), reported `status: ok`, and every record
  was there. The session of the administrator kept working.
- **Rolling back the image only.** The old image started on the migrated database, said
  `migrations applied` and reported `status: ok`, without noticing that the database was newer.
- **Restoring.** Restoring the backup as above brought the old image back to its 12 migrations
  and its data. Restoring without `chown` left a database the app could read but not write.
- **The Updates page** in the container, for each situation (up to date, patch, minor/breaking,
  failed with a known release, not checked, development build), manual check, the daily check by
  the worker, and the sidebar and `/api/health` reporting the channel.
- **A real failure.** GitHub answered "rate limit exceeded" to the check; the page stored and showed
  a failure, not "up to date".

What has **not** been tested here, and is described from documentation and source code only:

- Dokploy itself (no instance was available): how Deploy pulls, its API, its webhooks and its
  rollbacks are from its documentation, its OpenAPI specification and its source code as of
  2026-11-04. Check them on your version.
- Updates of PostgreSQL and MySQL installations with data (the migrations run on both in the
  project's tests, but this procedure was not rehearsed on them).
- The published images and the tags in this guide, because no release has been published yet: the
  release workflow runs for the first time with the first tag.
