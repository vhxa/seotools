# Changelog

What changed in each release of seotools. It follows [Keep a Changelog](https://keepachangelog.com)
and [Semantic Versioning](https://semver.org), with the rules of
[docs/releases.md](docs/releases.md): every change that reaches users, administrators or operators
adds an entry under `## [Unreleased]` in the pull request that makes it, under the heading that
names its impact:

| Heading    | Impact on the next version               |
| ---------- | ---------------------------------------- |
| `Breaking` | MAJOR (MINOR while the version is `0.x`) |
| `Added`    | MINOR                                    |
| `Changed`  | MINOR                                    |
| `Fixed`    | PATCH                                    |
| `Security` | PATCH                                    |

Documentation, tests, CI and refactors that change nothing visible have no entry and, by
themselves, no release. Releases are prepared with `node scripts/release.mjs prepare <version>`,
which moves the entries of `[Unreleased]` into the new version.

## [Unreleased]

### Breaking

- Startup refuses a database with migrations unknown to the image, reversing the previous
  documented behaviour of allowing older images to start on newer databases. This also applies
  with migrations disabled and in worker-only containers.

### Upgrade notes

- Accounts that already exist become administrators, which is what they could do until now. New
  accounts have nothing until they are given it.
- With `SEOTOOLS_MODE=worker`, set `BETTER_AUTH_URL` in the worker too, or the emails with password
  links and the crawl alerts fail: they need the address of the app. A single container already has it.
- Keep the pre-update database backup and both secret keys. To go back after any schema or
  stored-data conversion, stop the app and restore that backup with the previous image.
  Older images predating this guard still allow unsafe downgrades; their starting successfully
  does not mean the database is compatible.
- Docker Compose uses `DATABASE_URL_DOCKER` in `.env`; `DATABASE_URL` is for local development,
  direct Docker runs and Dokploy Docker applications. If you followed the previous README and
  set only `DATABASE_URL` for Compose, the installation used SQLite. Back up that SQLite volume
  before changing configuration: pointing at another database does not transfer your data.
- This version adds migrations (`crawl_url_accepted_issues`, `domains.archived_at`, empty for every
  existing domain, users' roles and access, and the record of sent email and the alerts people
  choose, empty at first: nobody receives an alert until they turn it on). Migrations only move forward: going back to an earlier version needs the
  backup taken before updating.

### Fixed

- A viewer no longer sees anything that writes: settings, schedules, rules, languages, priority URLs
  and cancel buttons are not shown, and the fields that show a current value are disabled instead
  of looking active. The pages table has no selection checkboxes for them; Export stays.
- The README and example environment now document Compose's existing database override
  accurately, preserving `DATABASE_URL_DOCKER`. Startup logs the selected dialect without the URL.
- Crawl retention settings explain that older crawls lose URL results, links and evidence.

### Added

- **Email, alerts and delivery problems.** System → Email sets how the instance sends email (SMTP or
  Resend; a saved password or key is never shown again and is kept when left blank), sends a test
  email and shows the provider's answer right there. Every attempt to send an email (invitations,
  password links, alerts, tests) is recorded, without its text or links, and kept for a while; a
  warning in System shows while the latest one failed or something wanted to send and nothing is
  configured. Each person chooses, in their account (also linked from a domain's Settings → Alerts),
  which alerts they want per domain: a **crawl problem** (a full crawl failed or stopped at its URL
  limit), **new important findings** (findings of high importance that are new or back since the
  previous completed crawl, grouped by issue with a few URLs) and a **change summary** for each
  finished crawl. Nobody receives anything until they choose it. At most one email per person and
  crawl, with every kind they chose in it, however often a job is retried; access, an active account
  and the choice are checked again when sending. Changing audit rules or the checks never sends an
  alert, and a change that only a rule explains is not presented as a regression.
- **Users and permissions.** Administrators invite users from System → Users, without opening
  registration. A member only reaches what they are given: **editor** (runs crawls, changes rules and
  settings) or **viewer** (reads and exports), on a company, which covers all its domains, or on a
  domain, whose role replaces the company's there. Everything else answers as if it did not exist,
  including direct links and exports. Accounts can be disabled, which signs them out at once. The
  instance cannot be left without an administrator who can sign in.
- **Password recovery:** an email link from the sign-in page when email is configured, a recovery link
  an administrator can hand over when it is not, and, if nobody can sign in,
  `node worker/dist/recover.mjs <email>` on the command line of the installation. Everyone can change
  their own password from their account.
- **CSV export** of the pages table (Export, in its toolbar): the pages, or their findings. Each file
  holds every row the address lists (the same view, filters, search, order and crawl), not only the
  page on screen, and carries the domain, the crawl date and id, and the filters on every row. Headers
  are in the language of the request, text opens correctly in Excel (UTF-8 with a byte order mark,
  RFC 4180) and what a site wrote cannot run as a spreadsheet formula. A crawl with no results, with
  its results removed, or never checked for findings answers an error instead of an empty file.
- **Companies** page (Instance → Companies, or _Manage companies_ in the domain selector) to manage
  a client's lifecycle without touching the database: rename a company, add domains, **archive**
  and restore a domain, move it to another company, and delete a domain or a company. Deleting
  lists what will disappear (crawls, retained URL results, rules, rechecks, schedules, priority
  URLs and crawl files) and requires typing the host or the company name. Moving keeps every
  result: only the company changes. A domain's address cannot be edited; a new site is a new
  domain, and the old one can be archived.
- An archived domain keeps all of its data and stays readable, but nothing automatic runs for it
  (scheduled crawls, icon and crawl file refreshes), crawls and rechecks cannot start, its settings,
  rules and priority URLs cannot change, and a crawl or recheck in progress is cancelled when it is
  archived. Archived domains are listed apart in the domain selector. Restoring one moves its
  schedules to their next run instead of catching up on what it missed.
- **Updates** page (System → Updates) for administrators: the installed version and kind of build,
  the latest stable release, when the last check ran and how it ended, and links to the release
  notes and the update guide. It tells _up to date_, _update available_, _could not check_ and
  _development build_ apart; a failed check is never shown as up to date.
- Looking for updates by hand, or once a day in the background if an administrator turns it on
  (off by default). A check only asks GitHub for the latest release: it sends nothing about the
  domains audited or the installation. Installing an update stays with Docker or Dokploy.
- `GET /api/health` reports `channel` (`release` or `development`) next to `version`.
- A guide to [releases](docs/releases.md) for maintainers and to [updating](docs/updating.md) for
  administrators: tags, backups, migrations, rollback, Docker Compose and Dokploy (manual and
  automatic).
- `node scripts/release.mjs` and a CI check that the versions of all packages agree with this file.

### Changed

- Priorities are ordered by importance first, and only then by type: a serious warning no longer
  sits below a minor issue. The pages overview groups findings by importance.
- A finding a rule accepts is no longer silently gone: it stays visible as **Accepted by a rule**,
  out of what is pending, with its evidence and the rule that accepts it, on the pages overview, in
  the pages table and in the detail of the URL. When a rule of one URL accepts findings of the URLs
  that point at it (canonical, hreflang), that URL says so, and comparisons of crawls call those
  findings accepted instead of resolved. Crawls still stored are analysed again at startup to show
  this, with no requests.

- Docker tags now say what they are. `latest` is the newest **stable release** (it used to follow
  `main`), `X.Y.Z` is one release, `X.Y` follows the patches of a minor version, and from 1.0.0
  `X` follows a major version. Builds of `main` are published as `edge` and `sha-<commit>`, and
  report themselves as development builds in the sidebar, in `/api/health` and on the Updates
  page. There is no `0` tag: while the major version is 0 a minor release can break things.
- The container image is checked (it starts and reports the version it was published as) before the
  tags that follow releases move and before a GitHub release is created.
