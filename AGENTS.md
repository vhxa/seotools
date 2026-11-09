# SEO Tools Monorepo — Agent Guide

SEO Tools is an open-source application with a set of features for monitoring and auditing the SEO/GEO of websites.

## Where to read more

| If you touch …                                    | read …                              |
| ------------------------------------------------- | ----------------------------------- |
| UI, actions, auth, i18n, health, updates          | `apps/web/AGENTS.md`                |
| Jobs, crawler, requests, email, alerts            | `apps/worker/AGENTS.md`             |
| Schemas, migrations, contract, archiving          | `packages/db/AGENTS.md`             |
| Env, settings encryption, mail copy, access       | `packages/core/AGENTS.md`           |
| Findings, rules, comparison, pages table, exports | `packages/core/src/crawl/AGENTS.md` |
| The Playwright smoke suite                        | `e2e/AGENTS.md`                     |

## Repository structure

```
apps/web/            # Next.js app: UI, auth, /api/health, server actions
apps/worker/         # Job runner and handlers, crawler, schedulers; bootstrap, `recover` and `migrate-db` CLIs
packages/core/       # Shared logic: env, logger, job types, settings encryption, mail, crawl types and rules
packages/db/         # Drizzle schemas, migrations and repositories for SQLite and PostgreSQL
docker/              # Container entrypoint and healthcheck
docs/                # Guides: updating an installation (docs/updating.md), making a release (docs/releases.md)
scripts/             # Release tooling (`node scripts/release.mjs`; its logic is in packages/core/src/release)
.github/workflows/   # CI and Docker image workflows
e2e/                 # Playwright smoke suite
```

The workspaces are:

| Package            | Description                                                                 |
| ------------------ | --------------------------------------------------------------------------- |
| `@seotools/web`    | Next.js (App Router) web app with shadcn/ui and multi-user, role-based auth |
| `@seotools/worker` | Job processor backed by the database (no Redis); bundled with tsdown        |
| `@seotools/core`   | Env validation (zod), logger (pino), job types, encrypted settings, mail    |
| `@seotools/db`     | Database abstraction (SQLite, PostgreSQL), migrations, first-admin creation |

Each workspace file lists its own main third-party packages.

## Architecture

- **Auth and users:** the app is multi-user with roles. First-run setup creates the first user, who is an admin, but that user is not special: more admins and members can be created, and the first user's admin role can be revoked like anyone else's. Never write code that assumes a single admin or treats the first user differently after setup.

### Versions and releases

Guides: `docs/releases.md` (classify, prepare, publish, check) and `docs/updating.md` (what administrators do; what each Docker tag means). Read the first before touching versions, `CHANGELOG.md`, the Dockerfile build arguments or `docker.yml`.

- **Version:** `MAJOR.MINOR.PATCH`, candidates `X.Y.Z-rc.N`. The root `package.json` is the only source; workspaces and `CHANGELOG.md` mirror it and `pnpm release:check` fails when they diverge. Never edit a `version` by hand or raise it in a feature or fix PR: only a release PR does, with `node scripts/release.mjs prepare <version>`. Docs-only changes need no release. While `0.x`, a breaking change needs a new MINOR.
- **Classify every change** in the PR that makes it, under `## [Unreleased]` in `CHANGELOG.md`: `Breaking` (MAJOR; MINOR while `0.x`), `Added`/`Changed` (MINOR), `Fixed`/`Security` (PATCH). Docs, tests, CI and refactors with no visible change get no entry. State the impact in the PR description. It is breaking if an env var, the `/data` layout, the default `DATABASE_URL`, the port, user or `SEOTOOLS_MODE`, an `/api/health` field, or anything an administrator must do changes; when unsure, breaking, with `### Upgrade notes`. Migrations only move forward and startup refuses migration journal entries unknown to the image (older images predating this guard do not), so a release with one says in its upgrade notes that going back needs the backup.
- **Publishing:** only a pushed `vX.Y.Z` tag on the merge commit of a release PR publishes (`docker.yml`: exact tag, run it, then channel tags, then the GitHub release). Never create or push a tag, publish an image or a release, or run the release workflow unless asked; never move or delete a published tag.
- **Builds:** a release is a build with `SEOTOOLS_BUILD_CHANNEL=release`, which only that workflow sets. Everything else (`main` → `edge`/`sha-*`, PRs, local builds) is `development` and must never present itself as a release: read the version and channel through `getBuildInfo()` (`apps/web/lib/build-info.ts`), never `process.env.APP_VERSION` elsewhere. Tags: `X.Y.Z`, `X.Y`, `X` from 1.0.0 (never `0`), `latest` = newest stable.

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

Vitest only, run from the repo root (it groups `packages/*` and `apps/*` as projects). Test files live next to the code as `*.test.ts`; there is no `__tests__/` folder. There are no frontend component, API integration or CLI suites. The only E2E suite is the Playwright smoke suite in `e2e/AGENTS.md`.

```bash
pnpm test                            # all projects, once
pnpm test:watch
pnpm exec vitest run packages/db     # one workspace
pnpm exec vitest run -t "admin"      # filter by test name
```

### Type checking

```bash
pnpm typecheck   # tsc in every workspace (web runs `next typegen` first)
```

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
- Validate at the boundaries: the environment with the zod schemas in `@seotools/core/env`, job payloads with their schema in `packages/core/src/jobs.ts`, and form input in the server action before touching the database.
- Read configuration through the parsed env objects. The only places allowed to read `process.env` directly are `packages/core/src/env.ts`, the logger level setup and the Docker scripts.

## Maintaining these files

These files hold the rules agents need: this one is read on every task, each workspace file by every agent working there. Keep them all short: every line costs context on every run.

A rule belongs in them only if it meets all three conditions:

1. **Non-obvious:** an agent reading the code would not infer it, or an agent already got it wrong.
2. **Durable:** it will still be true after the current feature is merged.
3. **Broad:** it applies across the repo or a whole workspace, not to a single file. Repo-wide rules go in this file; rules specific to one workspace go in the `AGENTS.md` of that workspace, and a rule that fits two goes in the most specific one, with a pointer in the other. A new `AGENTS.md` comes with a `CLAUDE.md` that contains only `@AGENTS.md` and a row in the table above.

Typical triggers: a new command or script, a new architectural boundary, a new security rule, a pending decision that got settled, or a mistake that CI did not catch and was fixed in review.

Do not add: descriptions of individual features, task status or TODOs, anything already in the README, or rules that lint, types or CI already enforce (unless the reason behind them matters).

### Check it on every task, without being asked

At the end of every change or feature, check on your own whether the work:

- makes anything in these files wrong or outdated;
- introduces something that meets the three conditions above;
- changes or reverses a decision recorded here.

Then act according to the size of the change.

**Minor changes: apply them, then tell the maintainer.** This covers fixing a command, path or package name, clarifying the wording of an existing rule, and adding a new rule that is consistent with everything already here. Edit the file concerned in the same PR and list what you changed in your final summary under an `AGENTS.md updates` heading.

**Major changes: propose first, edit only after an explicit OK.** This covers changing or reversing an architectural, security or product decision, removing a rule, and any rule that would force existing code to change. Describe the change and why under an `AGENTS.md proposals` heading, and wait for approval before touching this file.

When unsure whether a change is minor or major, treat it as major.

### Keep the README current

`README.md` is the presentation of the project, not its documentation: what it does, how to run and
deploy it, the environment variables, and links to `docs/`. Every PR that adds or removes something a
user, an administrator or an operator sees (a feature, an environment variable, a deployment step, a
supported platform) updates it in the same PR, briefly; details belong in `docs/`.

### Writing rules

- Write rules as specific instructions ("Every server action must call `requireSession()`"), not as history ("We had a bug where…").
- Prefer tightening or replacing an existing rule over appending a new one.
