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
- [If nobody can sign in](#if-nobody-can-sign-in)
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
`api.github.com/repos/vhxa/seotools/releases/latest` with a fixed `User-Agent`. It sends
nothing about your domains, your data or your installation, not even the version you run; GitHub
sees the address your server connects from, like any website would. Visiting the page never makes
a request: it shows what was stored. A failed check is stored as a failure and retried after an
hour.

GitHub limits anonymous requests to 60 an hour per address. On a server whose address is shared
with many others the check can answer "rate limited"; it says so and tries again later.

The same information is public without logging in: `GET /api/health` returns `version` and
`channel` (`release` or `development`).

## Image tags

The image is `ghcr.io/vhxa/seotools`, for `linux/amd64` and `linux/arm64`.

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
   [GitHub releases](https://github.com/vhxa/seotools/releases) or
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
- **Startup refuses unknown migrations.** Images with the compatibility guard stop before
  migrating when the database journal contains a timestamp/hash pair absent from the image.
  This includes migrations-disabled and worker-only startup. An unknown or edited history is
  also refused. It is a compatibility check, not a schema-integrity checker.
  **Images predating the guard still start unsafely on newer databases.**

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
#    SEOTOOLS_IMAGE=ghcr.io/vhxa/seotools:0.2.1   # exactly this release
#    SEOTOOLS_IMAGE=ghcr.io/vhxa/seotools:0.2     # the newest 0.2.x
docker compose pull
docker compose up -d          # recreates the container only if the image changed
docker compose logs -f seotools   # look for: migrations applied, started in "all" mode
curl -s http://localhost:3000/api/health
```

`docker compose pull` followed by `up -d` with an exact tag does nothing new: to move to another
release, change the tag. With a channel tag (`0.2`) it brings the new patches.

## Update with Dokploy

Dokploy runs the image as a Docker Swarm service. Set the application up once:

- **Source**: Docker. **Docker Image**: `ghcr.io/vhxa/seotools:<tag>`. **Registry URL**:
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

A bootstrap error exits the container before the web app or worker starts. Read the first error
in the logs; a restart policy may repeat it. Stop the service before diagnosis. Preserve the
failed database and logs separately, without overwriting the pre-update backup.

- **SQLite and PostgreSQL:** Drizzle creates its journal table outside the migration transaction,
  then runs the pending migration SQL and journal inserts in one transaction. Failed migration
  SQL rolls back that batch, including its DDL. Journal-table creation can remain.
  Post-migration audit semantics upgrades run separately, so a later bootstrap failure does not
  prove that migrations rolled back.
- **MySQL:** Drizzle opens a transaction, but [DDL implicitly commits](https://dev.mysql.com/doc/refman/8.4/en/implicit-commit.html). A failure can leave tables
  or columns changed without the matching journal entry. Re-running may fail on an already
  existing object. Restore the pre-update dump into an empty database before retrying.
- **Unknown migration history:** the guard reports that the database is newer than the image
  and that going back requires restoring the backup. Use the matching newer image or restore;
  never delete journal rows to bypass it.

If the failure is a connection, permissions or environment error, correct it and retry the same
image after establishing what committed. Do not manually mark failed migrations as applied.
For SQL failures, preserve diagnostics and use a fixed image; restoring the pre-update backup
first is the conservative recovery procedure on every dialect.

**Precise rollback rule:** restoring is required if the target image does not understand any
committed schema migration or stored-data conversion from the newer image. Restore also whenever
you cannot establish compatibility, including a partially applied MySQL migration. A missing
`migrations applied` log does not prove nothing changed. An image-only rollback is appropriate
only when no incompatible database change committed (for example a connection failure before
migration), and the target supports the stored data. A successful startup of an old image is
not evidence of compatibility.

Stop every app/worker instance, restore the pre-update database and original keys, select the
previous image, then start and verify login, settings and a known crawl. Writes since the backup
are lost. Dokploy's image rollback does not restore the database.

## If nobody can sign in

Someone who forgot their password can ask for a link from the sign-in page if email is configured. If
email does not work, another administrator can get them a recovery link in System → Users. When no
administrator can sign in, run this on the installation, with the email of an existing account:

```bash
# Docker Compose
docker compose exec seotools node /app/worker/dist/recover.mjs person@example.com
# Dokploy, or a plain container: the same command in a terminal of the container
node /app/worker/dist/recover.mjs person@example.com
```

It makes that account an active administrator and prints a link to choose a password, which works
once and for 24 hours. It deletes nobody, does not change the password until the link is used, and
does not open registration. The link is printed to your terminal and not to the logs of the app, so
treat it as a password. Setting the password signs that account out everywhere.

## Backups and restore

Back up **the database and your secrets** (`BETTER_AUTH_SECRET`, `SETTINGS_ENCRYPTION_KEY`, and the
`.env` or the environment of the Dokploy application). Keep a protected copy outside the container and outside the database backup.

- Losing the SQLite volume or external database loses users, domains, rules, crawls and settings.
- Changing/losing `BETTER_AUTH_SECRET` invalidates sessions. Unless an explicit
  `SETTINGS_ENCRYPTION_KEY` was set, it also makes encrypted settings unreadable.
- Losing/changing the effective encryption key makes saved SMTP/Resend credentials unreadable:
  settings use AES-256-GCM with a key derived from that secret. A database restore cannot
  recover the key. Re-enter credentials if the original key cannot be recovered.
- If introducing `SETTINGS_ENCRYPTION_KEY` on an existing installation, initially set it to the
  old effective key (usually `BETTER_AUTH_SECRET`); choosing a new random value does not
  re-encrypt existing settings.

For Compose, external database selection is `DATABASE_URL_DOCKER` in `.env`; direct Docker
and Dokploy Docker applications use `DATABASE_URL`. The startup `database selected` log records
only `sqlite`, `pg` or `mysql`. Verify it before relying on a backup procedure.

### SQLite (the default)

SQLite uses WAL mode. Copying only the main file while running can omit committed writes.
The image has no `sqlite3` CLI; its installed `better-sqlite3` module provides an online backup.
This command works while the app runs and produces a consistent snapshot including WAL writes.
Use a new destination name for each backup:

```bash
docker compose exec -T seotools node --input-type=module -e '
import Database from "/app/worker/node_modules/better-sqlite3/lib/index.js";
const db = new Database("/data/seotools.db");
try { await db.backup("/data/pre-update.db"); } finally { db.close(); }
'
docker compose cp seotools:/data/pre-update.db ./pre-update.db
# Store this file off the application volume, together with a protected copy of the keys.
```

For a custom SQLite path, replace both paths. To back up by copying instead, stop **all**
writers first and copy the whole directory, including any `-wal` and `-shm` files.
For Dokploy, run the online command with `docker exec <container>` on the node hosting the volume,
then `docker cp <container>:/data/pre-update.db ./pre-update.db`. Its Volume Backups can instead
copy the stopped application's entire volume; verify the stop occurred and rehearse a restore.
Also back up the application's Environment values securely.

Restore into a fresh volume, with all writers stopped. Replace the volume name below with your
Compose project's or Dokploy application's actual volume. Never overlay an old WAL:

```bash
docker compose stop seotools
docker volume create seotools-restored
docker run --rm -u 0 --entrypoint node \
  -v seotools-restored:/data -v "$PWD":/backup \
  seotools-recovery-image --input-type=module -e '
import { copyFileSync, chownSync } from "node:fs";
copyFileSync("/backup/pre-update.db", "/data/seotools.db");
chownSync("/data/seotools.db", 1000, 1000);
chownSync("/data", 1000, 1000);
'
```

Replace `seotools-recovery-image` with your saved image reference. Point the deployment's
`/data` mount at `seotools-restored`, restore its original keys and select the previous image
before starting. Keep the failed volume intact until recovery has been verified.

### PostgreSQL and MySQL

Use matching database client versions. The following examples run clients in database
containers named `postgres` and `mysql`; adapt user/database/container names. Configure passwords
through protected client credentials (`PGPASSFILE` / MySQL option file), never command arguments.
Stop the app and worker for the update after the dump completes.

```bash
docker exec postgres pg_dump -U seotools -d seotools -Fc > pre-update.dump
docker exec mysql mysqldump --defaults-extra-file=/run/secrets/mysql-backup.cnf \
  --single-transaction --routines --triggers --events --no-tablespaces seotools > pre-update.sql
```

PostgreSQL dumps provide a consistent snapshot. MySQL's `--single-transaction` requires InnoDB
(the application tables use it); do not run schema changes during either dump.
Check the dump command's exit status before treating the file as a backup.

Restore with seotools stopped, into a **new empty database**, not over existing tables:

```bash
docker exec postgres createdb -U seotools seotools_restored
docker exec -i postgres pg_restore -U seotools -d seotools_restored --exit-on-error < pre-update.dump
docker exec mysql mysql --defaults-extra-file=/run/secrets/mysql-backup.cnf \
  -e 'CREATE DATABASE seotools_restored'
docker exec -i mysql mysql --defaults-extra-file=/run/secrets/mysql-backup.cnf \
  seotools_restored < pre-update.sql
```

Point the deployment at the restored database, preserve the original keys, select the previous
image, start and verify. Dokploy's `/data` backup does not back up an external database; arrange
a database dump separately.

## History and evidence retention

The default `retainCrawls` is **10 per crawl type per domain**, not permanent evidence storage.
After a full crawl ends, pruning keeps the latest completed/incomplete runs up to that limit;
ended failed/cancelled runs lose details too. Active crawls are not pruned. Older crawl rows
retain their status, dates, totals and audit snapshot, and are marked pruned. Their URL records
(including collected facts and samples), links, findings with evidence, URL audit records and
sitemap hreflang declarations are deleted. History and comparisons cannot recover those details.
“All” keeps usable crawl details indefinitely, but still prunes failed/cancelled runs.

Rechecks independently keep the latest **50 ended rechecks per domain**, deleting both older
recheck headers and their URL results/evidence; active rechecks remain. Priority URLs and audit
rules are configuration and are not removed by crawl retention.

Crawl files are a separate latest-response store, one row per URL, overwritten when fetched.
A reachable daily refresh removes older rows not refreshed (a capped sitemap discovery preserves
older sitemap rows); a wholly unreachable refresh preserves existing rows. A completed,
uncapped full crawl also removes stale rows older than that crawl's start. These are not
versioned file archives. Backups preserve only data that existed when taken, never evidence
already pruned.

## What has been validated

Rehearsed on **2026-11-05**, Docker Desktop (Linux ARM64 containers on macOS), with locally
built images of **a651c7a** (14 migrations) and **3e67bc5c9b2bf5e4a5df65d1fc9d77982ef2dd98**
(19 migrations). Neither image was published. This supersedes the earlier same-schema rehearsal:
**real pending migrations 0014–0018 ran**, including the existing-users-to-administrators data
migration. These are development builds, not published releases.

| Procedure                                                         | SQLite                                | PostgreSQL 17                         | MySQL 8.4                                 |
| ----------------------------------------------------------------- | ------------------------------------- | ------------------------------------- | ----------------------------------------- |
| Representative data and completed crawl in old image              | Passed                                | Passed                                | Passed                                    |
| Consistent backup while app was running                           | Installed-module online backup        | `pg_dump -Fc`                         | `mysqldump --single-transaction`          |
| Apply pending migrations, verify exact timestamp/hash pairs       | 14 → 19                               | 14 → 19                               | 14 → 19                                   |
| Existing session, admin login and `/system/users`                 | Passed                                | Passed                                | Passed                                    |
| Preserved rules, findings and decryptable setting                 | Passed                                | Passed                                | Passed                                    |
| Startup reanalysis backfills accepted findings                    | 1 accepted finding                    | 1 accepted finding                    | 1 accepted finding                        |
| New full crawl on upgraded data                                   | Completed                             | Completed                             | Completed                                 |
| Member invitation, password link, login, ungranted-domain 404     | Passed                                | Passed                                | Passed                                    |
| Real recovery CLI, password link and subsequent admin login       | Passed                                | Passed                                | Passed                                    |
| Wrong-email CLI fails without changing table counts               | Passed                                | Passed                                | Passed                                    |
| Worker sends `access.email` through local SMTP                    | Passed                                | Passed                                | Passed                                    |
| Old image starts on migrated database (unsafe rollback)           | Yes                                   | Yes                                   | Yes                                       |
| New image refuses artificial future history on a scratch copy     | Exit 1                                | Exit 1                                | Exit 1                                    |
| Restore original backup into fresh volume/database with old image | Passed                                | Passed                                | Passed                                    |
| Failed migration 0016 on independent old-data copy                | Batch rolled back; 14 journal entries | Batch rolled back; 14 journal entries | Partial DDL persisted; 16 journal entries |
| Recover from that failure using untouched backup and old image    | Passed                                | Passed                                | Passed                                    |

The old app's actual HTTP forms/server actions created the first administrator through `/setup`,
a company/domain, an enabled rule allowing `noindex` on `/private`, and a full crawl. Its worker
requested a small HTTP fixture container on the same Docker network, with
`CRAWLER_ALLOW_PRIVATE_NETWORKS=true`. Each database held **19 URL records, 9 links and 19
pending findings**, with collected facts/evidence, before updating. Guessed HTTPS/www requests
failed: the fixture serves HTTP only. The old image has no email-settings UI; the encrypted
test setting was written through its settings API in a separate probe, not through a UI form.
The original `BETTER_AUTH_SECRET` and explicit `SETTINGS_ENCRYPTION_KEY` were kept unchanged.

After updating, the original crawl, links and rule retained their counts and pending-finding
distribution. The worker logged startup reanalysis and recorded the accepted `noindex` finding
from the existing rule. A second full crawl completed on every dialect. Health answered
successfully. The session issued before updating still opened `/system/users`; fresh password
login also worked and the existing user's stored role was `admin`.

On upgraded data, System → Users actions invited a member without grants. Both its invitation
link and the exact documented `node /app/worker/dist/recover.mjs <email>` command's link were
redeemed through the app, followed by successful password login. The member received 404 on the
ungranted domain. Recovery invalidated the administrator's sessions and left unrelated table
counts unchanged; a nonexistent email exited nonzero without changing counts. The recovery
token was absent from container logs before and after redemption. Each worker delivered an
invitation to a local SMTP capture server and recorded `invite/sent`, exercising its bundled
mail dependencies, public URL and settings configuration. This was not delivery to an external
email provider.

The old image predates the migration guard: on **all three newer databases** it started, allowed
login and displayed the domain's pages despite 19 journal entries. The rollback warning above
therefore remains essential. On independent copies, the new image rejected an artificial future
journal entry before starting services.

The documented restore commands recovered the original 14-entry journal, all original table
counts (apart from a new worker heartbeat), the original findings distribution, rule, decryptable
setting and password login. SQLite used a fresh volume and UID 1000 ownership; PostgreSQL and
MySQL used new empty databases. The post-update member and second crawl were gone, as expected.

For the failure rehearsal, a scratch copy of each pre-update backup was given a conflicting
`user_tokens` table before starting the new image in migration mode. Bootstrap exited 1 at 0016. SQLite and PostgreSQL rolled back 0014–0016: neither the accepted-findings table nor
`user_access` remained, and the journal still had 14 entries. MySQL retained 0014–0015 (16
entries), the accepted-findings table and the unjournaled `user_access` table from 0016.
Following the runbook—preserve diagnostics, restore the untouched backup into another fresh
volume/database, select the previous image and original keys—returned each to a working login
and known crawl. No journal entries were deleted or manually marked applied.

Per-table baseline counts and findings are recorded in the
[rehearsal evidence](rehearsals/2026-11-05-pending-migrations.md). All rehearsal containers,
including their anonymous volumes, named volumes, network and application images were removed.

**Not exercised:** Dokploy (no instance available), published images/tags or a release-to-release
deployment, public-site/TLS crawling, external email delivery, alert subscriptions/delivery,
24-hour token expiry, a browser UI walkthrough, or every possible migration failure. App
interactions used real HTTP endpoints and rendered forms/server actions rather than browser
automation. The separate earlier worker-only/migrations-disabled compatibility tests were not
repeated in this run. No owner database, port 3000, version fields, tags or releases were changed.
