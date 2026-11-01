# SEO Tools Monorepo — Agent Guide

SEO Tools is an open-source application with a set of features for monitoring and auditing the SEO/GEO of websites.

## Repository structure

```
apps/web/            # Next.js app: UI, login + first-run setup + onboarding, /api/health, better-auth routes, server actions
apps/worker/         # Background job runner + handlers (example.echo, mail.send); also the bootstrap CLI (migrations)
packages/core/       # Shared logic: env validation, logger, job types, settings encryption, mail (SMTP + Resend)
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
| `nodemailer`, `resend`                 | core         | Email delivery (SMTP or Resend API)                         |
| `turbo`, `vitest`, `tsdown`            | root, worker | Task orchestration, tests, worker bundling                  |

## Architecture

- **Auth and users:** the app is multi-user with roles. First-run setup creates the first user, who is an admin, but that user is not special: more admins and users with other roles can be created, and the first user's admin role can be revoked like anyone else's. Never write code that assumes a single admin or treats the first user differently after setup. Users can reset their password from within the app.
- **UI:** use shadcn by default whenever an existing component or primitive covers the need.
- **Companies and domains:** domains are grouped by company (an agency's client) and each feature works on one domain at a time. The active domain is the `/domains/[host]` route segment, never a cookie or global state. Every page and server action scoped to a domain starts with `requireDomain(host)` (`apps/web/lib/workspace.ts`) and its tables reference `domains.id`; that function is the single place where per-company/per-domain permissions will be enforced. Hosts are stored normalized by `normalizeDomain` (`@seotools/core`): `example.com`, no scheme, no `www.`, no path, always with a dot. Only instance-wide pages (`/system`) live outside a domain.
- **i18n:** the UI is internationalized (`next-intl`, locale from `Accept-Language`, no URL prefix). Every user-facing string must be translatable; never hardcode copy in components. Add each message to **both** `apps/web/messages/en.json` and `es.json` (a test fails if their keys or ICU arguments differ) and read it with `useTranslations` / `getTranslations`, including error messages returned by server actions. Data stored in the database (job payloads, etc.) is not UI copy.

### Outbound requests (crawling)

- The crawler **does not obey `robots.txt` when deciding what to fetch**: it must be able to request every URL of the site being audited.
- It **does evaluate `robots.txt`** and reports, per URL, whether crawling/indexing would be allowed. That result is audit data, never a reason to skip a request.
- User-agent, timeouts, concurrency, per-domain rate limits and SSRF protection are not decided yet. Do not pick defaults on your own; ask first.

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

`packages/db/src/test/contract.ts` defines the behaviour every dialect must provide (jobs queue, heartbeats, settings, first admin) and runs once per dialect.

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
- Use Drizzle's operators, which parameterize values. The only raw `sql` in `@seotools/db` is `select 1` and the MySQL job-claim query, which interpolate Drizzle columns, never user input.
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
