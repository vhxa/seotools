# Deploy on Dokploy with JavaScript rendering

This guide runs seotools and its rendering browser as one Dokploy **Docker Compose** service, with
[`deploy/dokploy/docker-compose.yml`](../deploy/dokploy/docker-compose.yml). Without rendering, a
Dokploy _Application_ from the image is enough: see the README and
[updating.md](updating.md#update-with-dokploy).

**What has been tested:** the maintainer's VPS ran `0.6.0-rc.2` with the same services pasted as
Raw (PostgreSQL in another Dokploy service, 4 rendered pages at once on 8 GB). Using this file from
the repository with a Compose Path has not been tested yet.

## Why not the repository's `docker-compose.yml`

That file is for a server with only Docker. On Dokploy it fails or does the wrong thing:

- it publishes port 3000 on the server, which Dokploy does not need (Traefik reaches the container
  on `dokploy-network`), and the deployment fails when anything else holds that port;
- it can build the image from source, which is a development build, not the release;
- it replaces `DATABASE_URL` with `DATABASE_URL_DOCKER`, or SQLite when that is not set, so a
  PostgreSQL `DATABASE_URL` set in Dokploy would be ignored and seotools would start on an empty
  database.

`deploy/dokploy/docker-compose.yml` has none of these. Its browser service is the same as in the
repository's file, which a test checks.

## Set it up

1. **Create a Docker Compose service** (Compose, not Stack).
2. **Source**: either
   - **GitHub** (or Git): repository `vhxa/seotools`, branch `main`, **Compose Path**
     `./deploy/dokploy/docker-compose.yml`; or
   - **Raw**: paste the file.
3. **Auto Deploy: off.** It would redeploy on every push to `main`, which restarts seotools and
   uses a compose file that is not part of a release. How to update is below.
4. **Isolated Deployments: off.** With it on, Dokploy attaches every service, the browser included,
   to a network of its own, which may give the browser a way out.
5. **Environment** (Dokploy writes it to `.env` next to the compose file):

   ```bash
   SEOTOOLS_IMAGE=ghcr.io/vhxa/seotools:0.6   # a version (0.6.0) or a line of patches (0.6)
   BETTER_AUTH_SECRET=…                       # openssl rand -base64 32
   BETTER_AUTH_URL=https://seo.example.com
   DATABASE_URL=postgres://…                  # leave it out for SQLite in the seotools-data volume
   # JavaScript rendering
   COMPOSE_PROFILES=rendering
   RENDER_BROWSER_URL=http://browser:9222
   # Compose defaults. On a 2 GiB Raspberry Pi use 1536m and 256m.
   RENDER_BROWSER_MEMORY=3g
   RENDER_BROWSER_SHM=1g
   ```

   Never use `latest`, `edge` or a candidate here unless you mean to: each deployment pulls the tag
   again.

6. **Domain**: on the `seotools` service, container port **3000**. Never a domain for `browser`.
7. **Deploy**, then open **System → Integrations** in seotools: the browser must say **Ready**.
   Use **Administration → Capacity** to review the worker’s recommended crawl and render limits.
   Also check on the server that the browser is attached only to the internal network:
   `docker inspect <browser container> --format '{{json .NetworkSettings.Networks}}'` must list one
   network, the one whose name ends in `_render`.

Moving from a Dokploy Application: the new service does not see the old one's data volume. With
PostgreSQL, set the same `DATABASE_URL` and stop the old Application before the first deployment
(two instances must never run on one database). With SQLite, take a backup and restore it
([updating.md](updating.md#backups-and-restore)).

## Updating

Take a backup first ([updating.md](updating.md#backups-and-restore)); Dokploy can schedule backups
of its PostgreSQL services.

- **By hand**: set `SEOTOOLS_IMAGE` to the new version and press **Deploy**. With a line of
  patches such as `0.6`, pressing Deploy is enough to get its latest patch: the compose file pulls
  the image again on every deployment. Moving to the next line (`0.7`) is a decision you make after
  reading the release notes.
- **Automatically**: [`docs/examples/dokploy-auto-update.sh`](examples/dokploy-auto-update.sh) with
  `DOKPLOY_COMPOSE_ID`, from a cron job on the server, following a line of patches
  ([updating.md](updating.md#automatic-updates-with-dokploy-optional)). It deploys only once the new
  image is published, after your backup command and when the running instance is healthy, then
  waits until the new version is healthy.

Do not use a deployment on Git tags or pushes to follow releases: a release's tag is pushed
**before** its image is built (about ten minutes), so the deployment would pull the previous image,
and it would also fire for candidates.
