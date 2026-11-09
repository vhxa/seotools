# Database — Agent Guide

Drizzle schemas, migrations and repositories for SQLite and PostgreSQL, plus the first-admin creation. Repo-wide rules are in the root `AGENTS.md`. Before changing findings, rules, comparison, crawl history, the pages table or exports, read `packages/core/src/crawl/AGENTS.md`.

## Structure

```
packages/db/         # Database layer: Drizzle schemas, migrations and repositories for SQLite and PostgreSQL
```

## Main third-party packages

| Package                      | Used in    | Description                                                |
| ---------------------------- | ---------- | ---------------------------------------------------------- |
| `drizzle-orm`, `drizzle-kit` | db         | Query layer and migration generation for both dialects     |
| `better-sqlite3`, `postgres` | db, worker | Database drivers (`better-sqlite3` is the only native one) |

## PostgreSQL for development

```bash
# PostgreSQL: start a database, then set DATABASE_URL in .env
docker run -d --name seotools-pg -e POSTGRES_PASSWORD=test -e POSTGRES_DB=seotools -p 5432:5432 postgres:17
# DATABASE_URL=postgres://postgres:test@localhost:5432/seotools
```

## Schemas and migrations

```bash
pnpm --filter @seotools/db generate --name <what_changed>   # generates sqlite + pg together
pnpm db:check                                               # migration files are consistent
```

Schemas exist once per dialect (`packages/db/src/schema/{sqlite,pg}.ts`): change both, with the same tables and columns (`copySqliteToPostgres` derives what it copies from the schemas and refuses if they differ). Never edit generated migrations by hand.

## Database contract (SQLite, PostgreSQL)

`packages/db/src/test/contract.ts` defines the behaviour every dialect must provide (jobs queue, heartbeats, settings, companies and domains, crawls, audit rules, first admin) and runs once per dialect.

- SQLite always runs, on an in-memory database (`createTestDatabase()` from `@seotools/db/test`).
- PostgreSQL is **skipped** unless you provide a database. CI runs it against a real service.

```bash
TEST_POSTGRES_URL=postgres://postgres:test@localhost:5432/seotools \
pnpm test
```

These tests **wipe the tables** of the database they point to. Use a throwaway database, never your dev data. Each dialect's `reset` (`sqlite.test.ts`, `postgres.test.ts`) lists the tables by hand: add every new table to both.

A change to the database layer is not done until the contract passes on both dialects.

## Companies and domains lifecycle

- `db.users` refuses to leave no administrator who is active and can sign in.
- An **archived** domain (`domains.archived_at`) keeps all data and stays readable but nothing starts, runs or changes for it: `crawls.start` and `verifications.start` throw `DomainArchivedError` inside their transaction, `withArchiveGuard` (`packages/db/src/archive.ts`, applied by `createDatabase`) refuses settings, schedules, priority URLs, rules, languages and crawl file refresh requests, archiving cancels the active crawl and recheck like `cancel` does, and every periodic loop skips it in its `due` query. A new periodic loop must exclude archived domains the same way, a new repository method that changes a domain's settings goes in `withArchiveGuard`, and a new server action that changes a domain starts with `if (domain.archivedAt) return …` (`archivedMessage()`). Every table with data of a domain must cascade from `domains` (directly or through `crawls`/`url_verifications`): `test/lifecycle.ts` derives them from the schema and proves no row survives a delete.

Who may do what with companies and domains in the UI is in `apps/web/AGENTS.md`.

## Retention and compaction

Retention of crawl results and compaction of SQLite are described in `packages/core/src/crawl/AGENTS.md` (History and comparison).

## Raw SQL

- Use Drizzle's operators, which parameterize values. Migration compatibility checks use fixed, read-only journal and table-existence queries. SQLite's `compact()` runs fixed pragmas and `VACUUM` through the driver. The only other raw `sql` in `@seotools/db` is `select 1`, `max()` for the next crawl `ref`, `count(*)`, the attempt decrement in `jobs.release`, the null-safe comparisons (`sqliteDiffers`/`pgDiffers`) and the `sum(case …)` of `compareCounts`, and the URL search (`like … escape '!'`) of `crawlUrlWhere` / `compareSearch` / `crawlLinkWhere` and the `is null` ordering of `crawlUrlOrder` (`mapping.ts`). They interpolate Drizzle columns; the only user text in them, the search, is a bound parameter with `%`, `_` and `!` escaped.
