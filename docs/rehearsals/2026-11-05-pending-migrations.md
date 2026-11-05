# Pending-migration rehearsal evidence

Run date: 2026-11-05. Previous source: `a651c7a`. Updated source:
`3e67bc5c9b2bf5e4a5df65d1fc9d77982ef2dd98`. Local ARM64 Docker images only.

The [runbook validation](../updating.md#what-has-been-validated) describes procedures and limits.
This records the baseline used to check the update and fresh restores. PostgreSQL keeps its
migration journal in the `drizzle` schema; it is included below. Counts were taken after the
first full crawl completed and before the live backups. Session counts include test logins.

## Baseline row counts

| Table                  | SQLite | PostgreSQL 17 | MySQL 8.4 |
| ---------------------- | -----: | ------------: | --------: |
| __drizzle_migrations   |     14 |            14 |        14 |
| account                |      1 |             1 |         1 |
| audit_rules            |      1 |             1 |         1 |
| companies              |      1 |             1 |         1 |
| crawl_file_checks      |      1 |             1 |         1 |
| crawl_files            |     13 |            13 |        13 |
| crawl_links            |      9 |             9 |         9 |
| crawl_schedules        |      0 |             0 |         0 |
| crawl_settings         |      0 |             0 |         0 |
| crawl_sitemap_hreflang |      0 |             0 |         0 |
| crawl_url_audit        |     19 |            19 |        19 |
| crawl_url_issues       |     19 |            19 |        19 |
| crawl_urls             |     19 |            19 |        19 |
| crawls                 |      1 |             1 |         1 |
| domain_audit_config    |      1 |             1 |         1 |
| domain_favicons        |      1 |             1 |         1 |
| domains                |      1 |             1 |         1 |
| jobs                   |      1 |             1 |         1 |
| priority_urls          |      0 |             0 |         0 |
| session                |      6 |             3 |         3 |
| settings               |      2 |             2 |         2 |
| url_verification_urls  |      0 |             0 |         0 |
| url_verifications      |      0 |             0 |         0 |
| user                   |      1 |             1 |         1 |
| verification           |      0 |             0 |         0 |
| worker_heartbeats      |      1 |             1 |         1 |

Each restored database matched these counts before the next login, except for the additional
worker heartbeat written by starting a new worker. Settings include the encrypted probe and
an application setting. No post-update member or second crawl survived the restore.

## Baseline pending findings

The same distribution was stored on all three databases and survived startup reanalysis and
fresh restore. The rule already suppressed the private page’s generic `noindex` finding in the
old version; the update additionally persisted that acceptance.

| Issue                   | Count |
| ----------------------- | ----: |
| canonical-missing       |     1 |
| client-error            |     1 |
| content-thin            |     2 |
| description-missing     |     2 |
| http-url                |     2 |
| img-no-alt              |     2 |
| img-no-size             |     2 |
| missing-security-header |     2 |
| no-structured-data      |     2 |
| sitemap-not-indexable   |     1 |
| title-too-short         |     2 |

## Migration and failure evidence

All 19 journal timestamp/hash pairs were compared with the corresponding dialect’s image-source
`meta/_journal.json` timestamps and SHA-256 hashes of its SQL files. All matched. Newly applied:

- `0014_accepted_findings`
- `0015_domain_archiving`
- `0016_users_and_access`
- `0017_existing_users_are_admins`
- `0018_email_and_alerts`

The future-history probes exited 1 with:

> The database is newer than this image or has an unknown migration history. Refusing to start.
> Going back requires restoring the backup taken before updating, together with the previous image.

The failed-migration probes deliberately precreated `user_tokens (probe integer)` on separate
old-data copies. Migration 0016 failed on its own `CREATE TABLE user_tokens`. The precreated
probe table survived on every dialect. SQLite and PostgreSQL retained 14 journal entries and
neither `crawl_url_accepted_issues` nor `user_access`. SQLite also had no `domains.archived_at`.
MySQL retained 16 entries and both newly created tables, including the unjournaled
`user_access` from the failed 0016. Recovery used the original backup, never the probe database.

Two harness mistakes were corrected before accepting results: a stopped SQLite scratch copy
needed UID 1000 ownership, and the MySQL restore inspector initially enumerated tables from
the upgraded database instead of the restored one. Neither was a runbook or application defect.

## Repository checks

`pnpm format:check && pnpm lint && pnpm typecheck && pnpm db:check && pnpm release:check && pnpm test && pnpm build`
passed. Unit tests: **2,062 passed, 464 skipped**; external database contract tests were not enabled
in this command. All three dialects were exercised by the separate live container rehearsal above.
No product bug or incorrect documented command was found, so no product fix, regression test,
version change or changelog entry was needed. `AGENTS.md` was unchanged.
