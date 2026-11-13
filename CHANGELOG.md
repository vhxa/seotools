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

### Added

- Rendered crawls run JavaScript on each internal HTML page answering 200, follow links found only
  after rendering, and report pages linked only by JavaScript and pages whose internal links appear
  after rendering. Per-domain settings control the mode, wait limit and omitted hosts.
- An optional browser container with layered network isolation, a safety check that refuses any
  browser whose own traffic does not all fail at its blocking proxy (rechecked whenever the browser
  is replaced), and its connection status in System → Integrations.
- Two low-importance opportunities flag HTML character references shown as text in titles,
  descriptions or H1s, and indexable pages with very few internal links in the served HTML
  (default: fewer than 5; configurable per domain, with 0 disabling the check).

### Changed

- Sitemap orphan findings describe the links observed in either HTML or rendered crawls. Rendered
  crawls pause when the browser is unavailable and fail after their recovery allowance, without
  falling back to HTML. In a rendered crawl, a page that could not be rendered whole and settled
  makes every link-dependent finding unknown for that crawl, so comparisons and alerts never report
  it as new or fixed.
- Pages load less translation text: the browser receives only the messages the interactive parts of each page use, not the whole catalog.
- Earlier crawls are analysed again from their stored text and links for the two new checks. The
  few-internal-links check is unknown, never fixed or new, for a crawl in which a page's HTML was
  cut at the size limit.

### Fixed

- Rendered-only embeds do not affect served-HTML resource findings, so an incomplete render cannot
  make an unchanged broken resource appear resolved or back.

### Upgrade notes

This update adds forward-only database migrations for render settings, crawl snapshots and
per-URL observations. Going back to an earlier image requires restoring the pre-update backup.
Earlier retained crawls are analysed again from stored observations; JavaScript findings remain
unknown for crawls that did not render.

## [0.5.0] - 2026-11-12

### Added

- Findings can be marked in progress or dismissed per URL or across a domain, with notes, attribution, state filters and CSV exports. Dismissed findings no longer count as pending and are never reported as fixed.
- The robots.txt page offers an on-demand Bot access test comparing homepage responses to published bot User-Agent strings, with explicit limits on what simulated requests can prove.
- Audit rules can require, allow or forbid a canonical to another URL and the absence of internal
  links. One rule can cover up to 20 paths, and new rules can start from one of five templates
  (private area, search and filters, campaign landing, must be indexed, leave out of the audit).
- The account can edit its own name and choose the interface language (follow the browser, English
  or Español). The chosen language also applies to the alert and access emails sent to that person.
  The email address stays read-only.
- Opt-in alerts between crawls for robots.txt changes and problems, broken sitemaps, repeated
  availability failures, recovery and expiring certificates. Open incidents appear on the domain
  dashboard, with a 30-day history in Issues. Checks run about once a day, not as an uptime monitor.
- Opt-in Core Web Vitals regression alerts when origin field metrics become poor between full
  crawls; vitals now participate in alerts, unlike 0.4.0.

### Changed

- The audit rules editor shows every condition at once, in compact rows with two buttons
  (Required, Forbidden) and a "Don't warn either way" checkbox for what was called Indifferent. A
  condition the rule does not state shows, muted, what applies to its URLs and where that comes
  from (by default, from another rule, or "varies by path"), and can go back to it after being
  stated; the long explanations are in help buttons. The form asks where the rule applies first (one
  or more paths, "also in each language" on by default when the domain declared language
  directories, and "URL parameters" under Advanced), then the conditions. The list of rules shows
  one row per rule with its paths and a summary in plain words, and the preview counts the URLs of
  each path. The exceptions of one or several URLs use the same controls, where "No change" stays
  apart from "Follow the rules".
- Crawls say whether they were analysed "with the current rules" or "with rules that have changed
  since", and a comparison says whether both crawls used the same rules, instead of showing
  configuration numbers.
- Custom extraction uses newer CSS selector libraries: `:enabled` now matches only form elements
  (inputs, buttons, selects, text areas and the like), as browsers do.
- A recheck of a URL now refreshes its search and social preview: in the detail of the latest
  crawl, when a later recheck read the page, the preview shows what the recheck saw (with the
  crawl's preview one tab away), and if the URL no longer answers as a page it says how it answered
  instead. Older crawls and rechecks made before this are shown as they were.

- The orphan URL finding says that the crawl reads the HTML the server sends, so a link that only
  appears after JavaScript runs (a menu or footer built in the browser) is not seen.

### Security

- Next.js 16.4.5 and other dependency updates with upstream security fixes.

### Upgrade notes

- Migrations 0029–0033 add bot access tests, optional audit rule grouping, saved user language,
  site incidents and finding states. Existing audit rules are unchanged. Going back requires
  restoring the backup taken before updating together with the previous image, as described in
  `docs/updating.md`.
- Nothing is dismissed after updating.
- On first start, retained crawls are analysed again because the issue catalog changed, using each
  crawl's own configuration. Existing configurations keep the same findings and accepted rows.
- The first observation of each file after updating is a baseline and does not report an existing
  problem; certificate and availability thresholds still apply.

## [0.4.0] - 2026-11-12

### Added

- Each user can star one favourite domain, which `/` then opens. Inside a domain the header logo
  leads to its overview, and the domain switcher has an "All domains" entry (`/domains`).
- Issues filters, per-issue crawl changes and template badges; current site-file findings; dashboard differences and comparison links; distinct referring-URL counts in Errors and Redirects and CSV exports.
- Core Web Vitals: field data from the Chrome UX Report (origin trend on the dashboard and per
  URL) and PageSpeed Insights lab measurements for priority URLs, CSV columns, and warnings for
  poor mobile field LCP, INP and CLS (Google's thresholds). Administration → Integrations stores an
  encrypted Google API key with a test; each domain can turn collection off in its Crawling
  settings. No request is made without a key, while automation is paused, or for archived domains.
  Vitals do not trigger alerts yet.
- Per-domain ignored query parameters (exact names or trailing `*` prefixes), applied to internal
  URL identity from the next crawl, with comparison caveats when the setting changes. Parameters
  suggests volatile or canonical-redundant names and separately highlights tracking parameters,
  never suggesting that tracking names be ignored. Defaults preserve existing crawl behavior.
- The user menu has an Administration entry for administrators.
- An error page and a loading skeleton for the signed-in app, so a failing page offers to try again instead of a blank screen.
- A domain that has never been crawled shows a prompt on its overview to run the first full crawl.
- Twelve new checks: Open Graph and Twitter Card tags (missing, incomplete, `og:url` that differs
  from the canonical, a share image that fails or redirects), `lang`, viewport and charset of the
  document, temporary redirects (302/307), slow responses and broken resources a page loads. The
  slowest response a page may have is a new threshold per domain (Settings → Audit → Thresholds,
  1000 ms by default). The checks that read the HTML show from the next full crawl; temporary
  redirects, slow responses and broken resources also appear in retained crawls when they are
  analysed again, and a crawl from before the tags were kept is never reported as lacking them.
- The URL detail previews how a page appears in search results and when it is shared (Open Graph
  image, title and description), and the pages CSV has `og:title`, `og:description`, `og:image`,
  `twitter:card` and HTML lang columns.
- A portfolio of every domain at `/domains`, which is also the home (`/`) for anyone who can see two
  or more domains and has no favourite: every domain grouped by company (last full crawl, pages crawled, indexable pages, issues, warnings, opportunities, a small
  trend of the last full crawls and whether a crawl is running); archived domains are in a collapsed
  list. With one domain or none, `/` still goes straight to it (or to the companies, onboarding or
  the no-access page).
- A Structure page per domain (sidebar): the directories of the latest full crawl with their pages,
  errors and pages with issues, warnings and opportunities, each figure leading to the URLs table
  searched by that directory's address, plus a breakdown by the language directories declared in the audit
  configuration. A directory opens through the address (`?path=/blog/`).

### Changed

- One Crawls area replaces the three overlapping pages "Run and schedule", "History" and "Compare": a single sidebar entry opens the list of every crawl (with its type, status, results, audit configuration and findings, and the run actions "Run full crawl", "Run priority crawl" and "Crawl a URL list", now in a dialog), with Compare and Rechecks as tabs.
- Crawl schedules moved from the Crawls page to a new Schedules section of the domain's settings, after Crawling. The Crawls page shows when each crawl is scheduled and links to it.
- Pages of a domain have addresses named after the interface: `/urls` (was `/pages/details`), `/urls/parameters`, `/urls/export/…`, `/crawls` (was `/jobs` and `/pages/history`), `/crawls/compare` and `/crawls/rechecks/…`. The old addresses redirect, query string included, so bookmarks and alert emails already sent keep working.
- The URLs table fits more at 1280 px: Status comes before Title, the URL column is narrower, and the issues panel beside the table can be folded away (the choice is remembered in the browser).
- Crawl settings are grouped in titled sections (Requests, Scope, Extraction, Retention, Request credentials, Other crawl files) with a save bar that stays in view.
- The "Query parameters" link on the URLs page is a button with an icon.

### Fixed

- A broken image, script or stylesheet is now reported on the page that loads it (`resources-broken`).
- Comparing with a crawl made before a check could see its input (structured data before 0.2.0,
  Open Graph and the document language before this version) no longer reports those findings as new
  or resolved: they show as not verifiable.
- The record of finished jobs no longer grows forever: the worker deletes completed jobs after 30
  days and failed ones after 90, checking every hour. Pending and running jobs are never touched.
- The Crawls and Crawl files sections of the sidebar open, and mark the current page, when you navigate into them.
- Query parameters now marks URLs as the current section in the sidebar.
- Some messages still called the URLs list "Pages".
- The trend charts no longer repeat a date when several crawls ran the same day, and their legend follows the order of the figures above.

### Security

- The app sends the security headers it checks for on the sites it audits: a Content-Security-Policy
  that lets only its own scripts run and keeps it out of frames, `X-Frame-Options`,
  `X-Content-Type-Options`, `Referrer-Policy`, a `Permissions-Policy`, and HSTS when
  `BETTER_AUTH_URL` is an `https://` address.
- Search engines are told not to index the app: every response says `noindex`, and `/robots.txt`
  disallows everything. A sign-in page of a public installation no longer ends up in search results.

### Upgrade notes

- Three migrations (0026–0028): 0026 adds the Core Web Vitals tables, 0027 the ignored query
  parameters (settings and a per-crawl snapshot; link rows are not rebuilt), and 0028 personal
  favourite domain preferences. Take the backup in `docs/updating.md` first: an older image refuses
  to start on the updated database, so going back needs that backup together with the previous
  image.
- On the first start, earlier crawls are analysed again under the new checks. Checks that read
  something older crawls did not keep (Open Graph and Twitter tags, the document language,
  viewport and charset) show as not verifiable on them, never as fixed or new.
- Core Web Vitals sends nothing until an administrator saves a Google API key in
  Administration → Integrations. From then on, after each full crawl of a domain with collection
  on (the default), its origin and page addresses are sent to Google's Chrome UX Report and
  PageSpeed Insights APIs; the key's Google Cloud project must have both enabled and allowed.
- With Docker Desktop (macOS, Windows), `/data` must be a named Docker volume, as in the supplied
  Compose file, not a bind-mounted host directory: SQLite shared by the web app and the worker can
  crash there (SIGBUS). This also affects earlier versions.

## [0.3.0] - 2026-11-08

### Changed

- The app has a new header across the top: the domain selector and the user menu moved there from
  the sidebar, and a new search finds any URL of the domain by address or title and opens its
  detail.
- The sidebar only holds the navigation of the domain you are in and is always open on wide
  screens: it no longer folds, and it does not appear in System, the account or when adding a
  domain. On narrow screens the sidebar opens from a button in the header, and the search becomes
  an icon.
- The account page is centred like System and split into tabs: profile, alerts and password.
- The version and build channel are no longer shown in the sidebar. They are in **System → Updates**
  and `/api/health`.

## [0.2.0] - 2026-11-08

### Breaking

- Startup refuses a database with migrations unknown to the image, reversing the previous
  documented behaviour of allowing older images to start on newer databases. This also applies
  with migrations disabled and in worker-only containers.
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
- **Query parameters** (URLs → Parameters): every parameter the crawl found, with how many URLs
  carry it, and where each one enters the site: the link from a URL without it to one with it.
- Light and dark themes, or the system's, chosen in the account menu.
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
- **Crawl scope, depth and staging access** (Settings → Crawling): paths to include or leave out,
  a maximum depth, and request headers or Basic Auth (kept encrypted, sent only to the domain's own
  URLs) to crawl a staging site. URLs outside the scope are listed as not requested.
- **List mode**: editors can crawl a list of up to 1,000 URLs without following their links.
- **Schedule time zones**: each crawl schedule runs in the time zone you choose. When a daylight
  saving change skips the chosen time, the run moves forward; when it repeats it, the run happens
  once, the first time. Hourly schedules run every real hour.
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
- `SEOTOOLS_PAUSE_AUTOMATION` (default `false`) for a staging copy of a production database: the
  worker starts no scheduled crawls, runs no periodic refreshes or update checks and sends no email
  (each attempt is recorded as not sent, "automation paused"). Crawls and rechecks started from the
  UI still run, and System shows a notice while it is on.
- **noindex or canonical hidden by robots.txt**: a page blocked by robots.txt that declares a
  noindex or a canonical elsewhere, which search engines cannot read.

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
- Domain navigation now brings Overview, Issues and URLs together, with separate crawl trends
  and a Crawls section. Administration groups status, companies, users, email and updates; old
  company and pages-overview addresses redirect to their new locations. Status describes worker
  health and job results in words, with the queue under Technical details.
- The detail of a URL shows its key facts first and the rest in tabs, with how the crawler
  reached it and, for each link, its text, element and page region. The URLs table counts
  findings by type in less space, apart from those on non-indexable pages.
- Links take much less space: on a real site the database went from 1.1 GB to 134 MB after the
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

### Fixed

- A recheck of a URL shows what an audit rule accepts (for example a `noindex` the rules allow) as
  seen and accepted, not as fixed and not as absent. Rechecks made before this say nothing about it.
- A viewer no longer sees anything that writes: settings, schedules, rules, languages, priority URLs
  and cancel buttons are not shown, and the fields that show a current value are disabled instead
  of looking active. The pages table has no selection checkboxes for them; Export stays.
- The README and example environment now document Compose's existing database override
  accurately, preserving `DATABASE_URL_DOCKER`. Startup logs the selected dialect without the URL.
- Crawl retention settings explain that older crawls lose URL results, links and evidence.
- Secondary text has enough contrast in light and dark themes.
- A script, stylesheet or image that answers with an HTML error page (a missing `.js` on many
  sites) is a broken resource, no longer counted as a page.

### Upgrade notes

- **Take a backup first**, of the database and of `BETTER_AUTH_SECRET` and
  `SETTINGS_ENCRYPTION_KEY` if you set it (see docs/updating.md). This version adds migrations,
  which only move forward: to go back, stop the app and restore that backup with the previous
  image. This image refuses a database with migrations it does not know; images older than
  0.2.0-rc.1 do not check, so their starting does not mean the database is compatible.
- The first start moves the results of older crawls to the compact history and, with SQLite,
  compacts the file: on a real 1.1 GB database the container was healthy after 16 seconds and the
  file was 134 MB. The worker then analyses the crawls that still have their results again, with no
  requests to any site, which takes a few seconds per crawl; their findings change as described
  above.
- Accounts that already exist become administrators, which is what they could do until now. New
  accounts have nothing until they are given it.
- Nobody receives an alert until they choose it in their account, and email has to be set up in
  System → Email first.
- With `SEOTOOLS_MODE=worker`, set `BETTER_AUTH_URL` in the worker too, or the emails with password
  links and the crawl alerts fail: they need the address of the app. A single container already has
  it.
- Docker Compose uses `DATABASE_URL_DOCKER` in `.env`; `DATABASE_URL` is for local development,
  direct Docker runs and Dokploy Docker applications. If you followed the previous README and set
  only `DATABASE_URL` for Compose, the installation used SQLite. Back up that SQLite volume before
  changing configuration: pointing at another database does not transfer your data.
- `latest` now follows stable releases only. To keep following `main`, use `edge`.
- MySQL was never in a stable release. An installation on MySQL (a build of `main` or 0.2.0-rc.1)
  must stay where it is or move its data to PostgreSQL itself: there is no tool for that.
