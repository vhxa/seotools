# syntax=docker/dockerfile:1

# Debian (glibc) rather than Alpine: better-sqlite3 ships prebuilt binaries for linux-arm64-glibc,
# so Raspberry Pi / ARM VPS builds don't need a compiler.
ARG NODE_VERSION=24

# ---- base: Node + pnpm ----------------------------------------------------------------------
FROM node:${NODE_VERSION}-trixie-slim AS base
ENV PNPM_HOME=/pnpm \
    npm_config_store_dir=/pnpm/store \
    PATH=/pnpm:$PATH \
    NEXT_TELEMETRY_DISABLED=1 \
    TURBO_TELEMETRY_DISABLED=1 \
    CI=true
RUN npm install -g pnpm@12.11.2
WORKDIR /repo

# ---- deps: download packages into the store (cached while the lockfile is unchanged) --------
FROM base AS deps
COPY pnpm-lock.yaml pnpm-workspace.yaml ./
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store pnpm fetch

# ---- build: compile web (Next standalone) and worker, then extract the worker's runtime deps -
FROM deps AS build
COPY . .
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm install --offline --frozen-lockfile
RUN pnpm build
# Worker bundle + only its runtime dependency (native better-sqlite3).
RUN --mount=type=cache,id=pnpm-store,target=/pnpm/store \
    pnpm --filter @seotools/worker deploy --prod /out/worker

# ---- runtime ------------------------------------------------------------------------------
FROM node:${NODE_VERSION}-trixie-slim AS runtime
RUN apt-get update \
    && apt-get install -y --no-install-recommends tini \
    && rm -rf /var/lib/apt/lists/*

ENV NODE_ENV=production \
    SEOTOOLS_MODE=all \
    PORT=3000 \
    DATABASE_URL=file:/data/seotools.db \
    MIGRATIONS_DIR=/app/migrations

WORKDIR /app
COPY --from=build --chown=node:node /repo/apps/web/.next/standalone ./web
COPY --from=build --chown=node:node /repo/apps/web/.next/static ./web/apps/web/.next/static
COPY --from=build --chown=node:node /repo/apps/web/public ./web/apps/web/public
COPY --from=build --chown=node:node /out/worker ./worker
COPY --from=build --chown=node:node /repo/packages/db/migrations ./migrations
COPY --chown=node:node docker/entrypoint.mjs docker/healthcheck.mjs ./

# SQLite database lives here. A named volume inherits this ownership on first use.
RUN mkdir /data && chown node:node /data
VOLUME /data

USER node
EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=40s --retries=3 \
    CMD ["node", "/app/healthcheck.mjs"]

ENTRYPOINT ["/usr/bin/tini", "--", "node", "/app/entrypoint.mjs"]
