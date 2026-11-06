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

- **Old crawls keep a compact history instead of everything.** The full results (links, evidence,
  page data) are kept for the latest crawl and the one before it, which is what a comparison
  needs; for older crawls, what each URL was (its answer, findings and audit state) is kept for 30
  days by default (Settings → Crawling, "Days of URL history"; empty keeps it always), then only
  their totals. Domains still on the old default of 10 crawls move to 2. A domain that chose
  another number keeps it.

- MySQL is no longer supported: seotools runs on SQLite (the default) or PostgreSQL. A `mysql://`
  `DATABASE_URL` (or `DATABASE_DIALECT=mysql`) now fails at startup with a message saying so.
- **What counts as a page changed.** A page is a URL that answered with HTML and a 2xx. A page,
  script or image that answers 4xx/5xx or does not answer is an **error**, listed in a new
  **Errors** view of the pages table, and is no longer counted among the pages. Totals of earlier
  crawls keep what they counted then, so comparing with them can show fewer pages.
- **Relation findings follow only what the pointing page declares** (audit semantics 5). A
  canonical or hreflang from a page expected to be indexable to a URL you declared out of the index
  is reported again: pointing an indexable page at a URL meant to stay out is the problem. A page
  that is itself expected out still excuses what it points at. Domains with such rules have their
  latest crawl analysed again on upgrade; earlier analyses keep the meaning they had.

### Changed

- Domain navigation now brings Overview, Issues and URLs together, with separate crawl trends
  and a Crawls section. Administration groups status, companies, users, email and updates; old
  company and pages-overview addresses redirect to their new locations. Status describes worker
  health and job results in words, with the queue under Technical details.

- Links take much less space: on a real site the database went from 1.1 GB to 133 MB after the
  first start. SQLite files are compacted on start when a removal left them mostly empty.
- Where a canonical or a sitemap entry leads is told apart: **a broken URL** (4xx/5xx), **a
  redirect**, or **a URL that cannot be indexed**. Only the last one follows the audit rules; a
  broken or redirecting target is always reported.
- "Canonicalised to another URL" is no longer a finding: it is a state of the URL's indexability.
  What a page links to is reported on that page instead: **links to broken URLs**, **to redirects**,
  **to canonicalised URLs** and **internal links with tracking parameters**.
- Search-result findings (title, description, headings, thin or duplicate content, hreflang, URL
  form) on a page that cannot be indexed are shown as secondary and no longer count among the pages
  with findings. Accessibility, security, HTML and broken references always count.
- Importance reviewed: a robots.txt block is a warning of medium importance (usually deliberate),
  and so are a missing `alt`, `nosnippet` and a possible soft 404; `noimageindex` is a low warning.

### Added

- **Custom extraction** (Settings → Crawling): up to 10 values read from every page with a CSS
  selector, as text or from an attribute (a price, an author, a product id). They show in the
  detail of each URL and as columns of the pages CSV, from the next crawl.
- **Export links and redirects** from the URLs table (Export menu): one row per link leaving the
  listed URLs (with its text, element and part of the page), and one row per redirect with where
  its chain ends, how many hops it has and whether it loops.
- **Structured data checked against Google's rich result requirements**: for Product, Article,
  BreadcrumbList, FAQPage, LocalBusiness (and common kinds), Event, Recipe, VideoObject,
  JobPosting, Organization, SoftwareApplication, Review and AggregateRating, the JSON-LD of a page
  is checked for the properties Google requires (a warning) and recommends (an opportunity), naming
  what is missing. From the next crawl.
- **Crawl scope, depth and staging access**: crawl settings support path scope, maximum depth, encrypted request headers and Basic Auth. URLs outside the scope remain visible as not requested.
- **List mode**: editors can crawl an ad hoc list of up to 1000 URLs without following links.
- **Schedule time zones**: crawl schedules offer editable IANA time zones; daily, weekly and monthly runs shift missing DST times forward and use the earlier instant for repeated times. Hourly schedules run in each real hour.
- **Thresholds per domain** (Settings → Audit → Thresholds): the figures some checks compare with
  (title and meta description length, words for thin content, URL length, click depth, image
  weight) can be set per domain; empty fields keep the recommended ones. Changing them analyses the
  latest crawl again, and each analysis keeps the figures it used.
- **Where each link is**: the text of the link, the element that holds it and the part of the page
  (menu, header, footer, main content, sidebar), and, where a link brings in query parameters the
  page does not have, the tag as the crawler read it. Each URL also records the page and the kind
  of link it was first found through. Only crawls from now on have it.
- `node /app/worker/dist/migrate-db.mjs --from file:… --to postgres://…` copies an installation from
  SQLite to an empty PostgreSQL database, keeping people signed in. See
  [Move from SQLite to PostgreSQL](docs/updating.md#move-from-sqlite-to-postgresql).
- `SEOTOOLS_PAUSE_AUTOMATION` (default `false`) for staging copies of a production database: the worker fires no scheduled crawls, runs no periodic refreshes or update checks and sends no email (each attempt is recorded as not sent, "automation paused"). Crawls and rechecks you start from the UI still run, and System shows a notice while it is on.
- **noindex or canonical hidden by robots.txt**: a page blocked by robots.txt that declares a
  noindex or a canonical elsewhere, which search engines cannot read.

### Fixed

- A script, stylesheet or image that answers with an HTML error page (a missing `.js` on many
  sites) is a broken resource, no longer counted as a page.
- Running the bundled worker scripts (`node apps/worker/dist/recover.mjs <email>`, `bootstrap.mjs`) outside Docker no longer needs `MIGRATIONS_DIR`: the migrations are found next to the repository, and when they are not, the error names the folders it looked in and says to set `MIGRATIONS_DIR`.
- Crawl alerts no longer compare a crawl whose findings were never analysed (after waiting two hours for the analysis): only a crawl problem is reported if it applies, otherwise nothing is sent, and the worker logs a warning.
- Every page under System answered with an error when the saved email settings could not be decrypted (the encryption key changed after saving them). They now render, System → Email and the warning in System say that the settings must be entered again, and the worker records the email as not sent instead of failing.

### Upgrade notes

- This update adds crawl configuration migrations. Going back requires restoring the database backup.

- The first start after the update moves the results of older crawls to the compact history and,
  with SQLite, compacts the file: about 20 seconds for a 1 GB database. Take a backup first (see
  docs/updating.md): going back to 0.2.0-rc.1 needs it.
- MySQL was never in a stable release and nobody should be affected. An installation on MySQL must
  stay on 0.2.0-rc.1 or move to PostgreSQL by exporting its data itself: there is no tool for that.

## [0.2.0-rc.1] - 2026-11-05

### Breaking

- Startup refuses a database with migrations unknown to the image, reversing the previous
  documented behaviour of allowing older images to start on newer databases. This also applies
  with migrations disabled and in worker-only containers.

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

### Fixed

- A recheck of a URL shows what an audit rule accepts (for example a `noindex` the rules allow) as
  seen and accepted, not as fixed and not as absent. Rechecks made before this say nothing about it.
- A viewer no longer sees anything that writes: settings, schedules, rules, languages, priority URLs
  and cancel buttons are not shown, and the fields that show a current value are disabled instead
  of looking active. The pages table has no selection checkboxes for them; Export stays.
- The README and example environment now document Compose's existing database override
  accurately, preserving `DATABASE_URL_DOCKER`. Startup logs the selected dialect without the URL.
- Crawl retention settings explain that older crawls lose URL results, links and evidence.

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
  choose, empty at first: nobody receives an alert until they turn it on). Migrations only move
  forward: going back to an earlier version needs the backup taken before updating.
- At the first start, the worker analyses the crawls that still have their results again, with no
  requests to any site. It may take a while on a large installation.
