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

## [0.9.0] - 2026-11-27

### Breaking

- Set simultaneous renders and crawls in **Administration → Capacity**. The worker ignores
  `RENDER_CONCURRENCY` and `CRAWL_CONCURRENCY` and warns once at startup if either is still set.

### Added

- Capacity and domain crawl settings use sliders with live estimates for server memory, crawl duration,
  and site load. Rendered crawls record the render slots they used and the JavaScript heap at capture.

### Changed

- Domains start with four simultaneous requests. Worker capacity defaults to the detected server’s
  recommendation. Docker Compose gives the browser a `3g` memory ceiling and `1g` of shared memory.
- The overview tiles show no difference when the crawl before did not measure the same thing (a different rendering mode, ignored parameters, crawl settings, issue checks or audit rules): they say "Not comparable", with what changed in the tooltip, in the same words as the trend, and link to the comparison of both crawls.
- On the Issues page, when none of the issues can be compared with the previous crawl for the same reason, one notice above the list says why instead of repeating "Cannot be compared" on every row; with different reasons, only the rows affected keep the label.
- The category badges of the issue list on the URLs page count the URLs that have at least one issue of the category, not the sum of its issues, so a URL with several counts once.
- URL columns (pages table, comparison, links of a URL, rechecks) show the path and query of a URL on the site's `https://<host>` address and keep the full address for any other variant (`http`, `www`, other hosts); the tooltip and the links keep the full URL. In the URLs table, the URL column takes the width the other columns leave free.

### Fixed

- A page that fails briefly no longer makes the pages it links to look unlinked. Crawls retry temporary failures and show the outcome in the crawl and URL details. Like Google, the crawler ignores the content and links of 429 and 5xx error responses.
- "Pages with too little data to tell if they are indexable" reads correctly in both languages for one page and for several, and the findings about `robots.txt`, `llms.txt` and `security.txt` name their file ("llms.txt has no summary").

### Upgrade notes

- This version adds migrations for crawl retry outcomes and capacity. Going back requires restoring
  the backup taken before updating.
- On its first startup after an update, the worker sets both capacity limits to the recommendation
  for its server and resets simultaneous requests to four for every existing domain. Administrators
  can review the changes in **Administration → Capacity** and customize both sets of limits again.
  For a domain whose pace changed, the first new crawl can show “Not comparable” against the
  previous one because simultaneous requests are part of the comparison basis.
- With rendering, take the Compose file of this version again (`docker-compose.yml`, or
  `deploy/dokploy/docker-compose.yml`; on Dokploy with **Raw**, paste it again). It gives the
  browser `3g` of memory and `1g` of shared memory, and tells seotools the browser's limits. With
  an older file, **Administration → Capacity** shows the browser's memory limit as unknown and
  recommends renders from the server's memory alone, which can be more than the browser holds:
  lower the renders there, or set `RENDER_BROWSER_MEMORY` and `RENDER_BROWSER_SHM` on the
  seotools service too.
- On small servers such as a 2 GiB Raspberry Pi, set `RENDER_BROWSER_MEMORY=1536m` and
  `RENDER_BROWSER_SHM=256m` in Compose.

## [0.8.0] - 2026-11-22

### Added

- Completed full crawls check up to 24 HTML pages twice and show the measured differences in crawl and URL details.
- Crawls record their discovery settings and the builds that queued, ran and analysed them. Administration flags workers on mixed builds and workers or web apps that do not recognize the database's migrations.
- The crawl comparison says why each URL is in one crawl only, from what the two crawls stored: no longer linked by a page the other crawl read whole (a change of the site), not reached because that page was not read whole (it answered an error, its render was cut, it failed, it was captured while loading…), the URL limit, the depth, the site answering differently when a page was requested twice, or unknown when nothing stored says. A change of the site is only claimed when both crawls read the same address the same way: a whole 2xx HTML page (never a redirect, an error page or a file), comparable settings, renders that can be trusted on both sides and, for a chain of new pages, a way in that the crawl observed; anything else is not reached or unknown, with the reason. The page shows the figure of each kind of change as a card that opens its list (URLs, answers and findings are tabs in groups), one line of chips says which recorded settings and builds differ (the full summary, the crawls and the totals are one click away), and the list is a table with the URL, its response and a short reason with a filter per reason; a drawer holds the whole explanation, naming the page the URL was linked from and the exact link that decided its reason. "Check now" (editors) rechecks those URLs to see what they answer today, without changing why the crawls differ.
- The links of a URL that other URLs redirect to: below its incoming links, "Through redirects" lists the URLs that redirect to it and the links that point at each of them, and says that those links point to the redirecting URL, not to this one.

### Changed

- URLs that only one crawl has because of your own settings (ignored query parameters that merge or split addresses, paths left out, the priority list, optional files, a depth recorded as narrower, links found only after rendering when a crawl did not render) are listed under "By your configuration", with the address they have in the other crawl, and are no longer counted as not seen or discovered, in the comparison and in the change summary email. A URL a lower URL limit may have left out stays counted, since nothing stored shows the limit is why. Until a comparison is worked out, the email leaves the added and not seen figures out.
- The trend charts on the overview no longer draw one line through crawls that did not measure the same thing. When the rendering mode, the ignored parameters, the crawl settings, the issue checks or the audit rules differ from the crawl before, the line breaks and the first point after the change is ringed, with what changed in its tooltip.
- The list of crawls is a bordered table with one row per crawl (date, who started it, HTML or rendered, state, pages, pages with issues and warnings); everything else about a crawl (when it ran, the version that ran it, URLs and external URLs, opportunities, the rules it was analysed with, retained results, rendering coverage, paired requests, errors) opens at once in a side drawer, from "Details" or by clicking the row.
- "How it was found" in the detail of a URL is a numbered list of sentences ("/sitemap.xml lists /a", "that URL links to /b/", "that URL redirects to /b") instead of a list of labels, and says "not recorded" for what the crawl did not keep.
- Structure names its columns for what they count: "Pages" (HTML that answered 2xx) and, apart and last, "Failing URLs" (every URL of the directory that failed, references such as hreflang targets included), each with its explanation. The Directory column keeps room for ordinary names and only shortens very long ones.

### Fixed

- A worker left running through a database update stops claiming jobs when it detects migrations its image does not recognize.
- A crawl that was cancelled reads "Cancelled — not analysed" instead of "Coverage not analysed yet".
- On a crawl that did not render pages, the JavaScript category of the issues says "Not looked for: this crawl did not render pages" instead of showing nothing, which read as "no problems".
- Images and other requests the browser intentionally skips no longer cause a page render to be cut short.
- Rendered crawls give scripts more time to build navigation and page content. History URL changes preserve observed links, and a capture with late activity or failed dependencies leaves missing rendered links unverified.
- Tracking and experiment resources injected by JavaScript no longer inflate the list of external URLs when the browser blocks them.

### Upgrade notes

- This version adds database migrations for crawl provenance, paired observations and comparison reasons. Going back requires restoring the backup taken before updating, together with the previous image. Stop older deployments when updating, especially workers from versions that only check migrations at startup.
- At startup the worker works out, for every domain that is not archived, why URLs differ between its latest two crawls. It reads what they stored and requests nothing from the sites.
- Crawls made before this version did not record their settings, and their rendered pages could be cut short, so a comparison with one of them says more often "not reached" or "unknown" instead of naming a cause. Two crawls made with this version give the full reasons.

## [0.7.1] - 2026-11-20

### Fixed

- The JavaScript rendering block of the overview is a card like the rest of the dashboard; its long explanations are folded under "What this leaves unknown".
- The trend charts (overview and Core Web Vitals) draw one point per day, the last crawl of that day, so a week or more of history is no longer full of repeated points.
- Pages already visited open at once: the browser keeps them for a minute and drops them as soon as a crawl, an analysis, a recheck or a change of rules finishes.
- The list of settings sections no longer moves a few pixels when the page loads, and the loading skeletons of the overview, Issues, URLs, Crawls and the comparison match the pages they stand for.
- The domain selector shows the favicon of the selected domain, and the search box reads "Inspect any URL in" followed by the domain.

## [0.7.0] - 2026-11-20

### Added

- The sidebar has the crawl controls: a Full Crawl button that shows the crawl live (Starting, then pages crawled out of pages found, then Processing with a spinner while the findings are analysed) and a menu for the other crawl actions. Both are disabled while a crawl runs. The overview and the crawl list say Processing too, instead of staying at 100%.
- The overview trend charts have a period switch (week, month, quarter) and open on the narrowest period that has a line to draw.
- The URLs page has a secondary sidebar with every issue (count and criticality per issue, grouped by category, with the analysis picker on top) that folds with a button in the header; the search by URL or title is inside Filters.
- The Issues page opens with summary cards.

### Changed

- Redesign: inside a domain the navigation is an inset sidebar that holds the domain selector (larger rows and favicons, opening downward at the width of its button), the administration link and the user menu, and that can be folded (button in the page header or Ctrl/Cmd+B). The page header keeps the URL search. Pages use a full-width layout with the same cards, figures and sidebar-like lists: overview, Issues, URLs, crawls and comparison, structure, settings, System, account and portfolio.
- Core Web Vitals show a state dot and a threshold bar per metric, including FCP and TTFB.

## [0.6.0] - 2026-11-19

### Added

- JavaScript rendering in the interface: the crawl settings say what each mode costs and why
  Rendered is unavailable; a URL's detail has a JavaScript tab that compares the served HTML with
  the rendered page, or says it was not rendered, redirected by JavaScript or incomplete; the URLs
  table and its CSV export have a Rendering column and filter; the overview, the crawl list and the
  crawl comparison say which mode a crawl ran in, how many pages could not be observed completely and
  what that leaves unknown.
- Rendered crawls report text, titles, descriptions, H1s, canonical URLs, meta robots directives,
  structured data, hreflang and social tags added or changed by JavaScript, along with render
  redirects, robots-blocked resources, failures and uncaught script errors. Only complete
  observations establish differences; a stopped client redirect reports its target without
  treating its abandoned content as observed or making links elsewhere unknown. The text share
  threshold is configurable per domain.
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

- Rendered crawls judge document findings, indexability and rules on the completely observed
  rendered page. Served noindex restrictions persist; response and source diagnostics and social
  previews keep the served response. An incomplete document or a conflicting canonical leaves
  the checks that read it, and the findings that depend on them, unknown for that URL (and
  crawl-wide for checks involving other pages). Between an HTML and a rendered crawl
  only findings about the server's answer are compared; the others are unverified, never new or
  fixed, and HTML-only rechecks cannot settle rendered document findings.
- Sitemap orphan findings describe the links observed in either HTML or rendered crawls. Rendered
  crawls pause when the browser is unavailable and fail after their recovery allowance, without
  falling back to HTML. In a rendered crawl, a page that was neither rendered whole and settled nor
  completely observed redirecting makes every link-dependent finding unknown for that crawl, so
  comparisons and alerts never report it as new or fixed.
- Pages load less translation text: the browser receives only the messages the interactive parts of each page use, not the whole catalog.
- Earlier crawls are analysed again from their stored text and links for the two new checks. The
  few-internal-links check is unknown, never fixed or new, for a crawl in which a page's HTML was
  cut at the size limit.
- Rendered pages are captured like a search engine snapshots them: the domain's wait setting is now
  a capture window that starts once the page's HTML is parsed, and the page is captured as it is at
  the end of the window, or earlier once its network is quiet. A page captured while still loading
  is an observation: its findings are reported (in rc.1 they were all unknown, so a slow site
  reported no JavaScript finding at all), the URL detail, the pages table filter, the overview and
  exports say "Captured while loading" with the requests still pending, and what such a capture
  does not show is never reported as fixed in comparisons or alerts. Rendered crawls analysed under
  rc.1 are analysed again at startup; older unsettled rows without capture metadata stay unknown
  and are counted separately as "did not settle", rather than failed or not rendered.
- A page's JavaScript findings are unknown only for that page when its render failed, was cut or is
  missing, instead of for the whole crawl. Findings that depend on links between pages stay unknown
  for the whole crawl in that case. Captures while loading keep positive graph findings, but an
  absent finding about links between pages or comparisons of their documents is unverified across the whole crawl, never new or resolved.
- Rendered pages load their scripts, stylesheets and data in parallel, up to six at a time per page
  and six per rendered page slot (`RENDER_CONCURRENCY`) for the whole crawl, and two pages needing
  the same file share one request. The domain's requests per second now limits only the crawl's own
  URLs, not what a rendered page loads; a server that asks to slow down still holds both.
- A render that reaches its request or byte budget is now incomplete (unknown, "Cut at a limit"),
  whichever request crossed it, so that the order in which parallel requests finish never changes a
  finding.
- The browser's memory ceiling and shared memory are set with `RENDER_BROWSER_MEMORY` and
  `RENDER_BROWSER_SHM` in `.env` (defaults unchanged: `1536m` and `256m`), to render more pages at
  once on a larger server; see the rendering guide for what to set on an 8 GB server and on a
  Raspberry Pi.

### Fixed

- A completed rendered crawl could keep internal pages that answered 200 without a render ("Not
  rendered by this crawl", reason missing). A rendered crawl now crawls such a page again before it
  ends and, if it still has no render, records it as a failed render, so its findings are unknown
  instead of read from the HTML.
- A URL that finished while the crawler was reading its next batch could be crawled twice.
- The overview of a rendered crawl showed "NaN pages rendered in a browser" (and a broken count of
  pages not observed completely) from 1,000 pages on: it now prints the number.
- The overview and the crawl list said that the coverage of a rendered crawl "has not been analysed"
  even when it had been. The coverage is now read from the analysis on its own, and when an analysed
  crawl did not record it the interface says so, instead of claiming it was never analysed.
- In a rendered crawl whose coverage is not known, the overview's groups (links, text and tags that
  appear only after rendering) said "None"; they now say it is not known.

### Upgrade notes

- Two forward-only database migrations, `0034_rendered_crawls` and `0035_render_truncation`, add
  render settings, crawl snapshots and per-URL render observations. Take a backup before updating:
  going back requires restoring that backup together with the previous image, which refuses to
  start on the upgraded database.
- Nothing changes for an installation that does not connect a browser. Updating the image,
  including `latest`, keeps every domain on HTML; rendering is offered only once a browser is
  connected and passes its safety check.
- Earlier retained crawls are analysed again from stored observations after the update;
  JavaScript findings remain unknown for crawls that did not render.
- To add the optional browser, follow [the rendering guide](docs/rendering.md) (the `rendering`
  Compose profile and `RENDER_BROWSER_URL`).

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
