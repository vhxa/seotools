# WP4a design note

`runCrawl` already analyses the served response in `response.ts`, then commits the URL and
its discoveries through `recordResult`. Rendering will happen between those steps, using that
same fetched document and requester, one resource cache per crawl, and the crawl's saved robots
observations for Googlebot. All existing page facts and checks keep their served input. Only
internal link-graph checks read the union of served and rendered discoveries; `few-html-links`
keeps separate HTML-only counts. Link identity is target identity plus kind, with no per-link IDs.

`db.crawls.start` will snapshot mode, wait and omitted hosts from `crawl_settings` in its transaction.
A null snapshot means HTML. New domain creation will choose rendered only from a fresh ready
browser status in the web action, never by reading environment in the database. Existing domains
keep HTML. Settings retain `http` and `headless`, and remove the unavailable `both` value without
rewriting data. Only internal HTML pages answering exactly 200 are rendered; other 2xx responses
remain served-only and make rendering observation incomplete for absence-dependent findings.

A new cascade-owned `crawl_url_renders` row stores bounded facts and diagnostics, never HTML,
in the same transaction as each served result. It is retained and pruned with per-URL results.
Rendered-only links are followed at the source depth plus one. A failed render may be retried
once after the site drain, serially, using an in-memory served response capped at 200 pages and
64 MiB total. A resumed crawl leaves committed failures failed: bodies are intentionally not
persisted, and done URLs are never fetched or rendered again. Retry discoveries drain before
external checks; only a successful retry replaces the failed render row.

The worker's single WP3 render service is passed through engine options. An unavailable browser
pauses the drain and all rendered-page commits, including concurrent work, while one shared
recovery check polls every 30 seconds. Ten minutes of recovery budget total is persisted per
crawl so shutdown cannot reset it. Exhaustion ends the crawl with `browser-unavailable`; shutdown
hands the job back and cancellation remains cancellation. There is no fallback to HTML.

The audit keeps HTML and combined anchor counts. Completed, non-limited HTML observations can
prove absence of HTML links. Rendered link absence additionally needs every eligible page render
to have succeeded; failed or missing renders are counted and retained in the audit snapshot.
The JavaScript category is unobserved for HTML/old crawls and, conservatively, when any render is
unobserved. Both new checks are site-scoped for rechecks. `linked-only-by-javascript` requires
complete HTML coverage; `links-only-after-rendering` reads positive page-local evidence.

No new `AUDIT_SEMANTICS` is needed: rules retain their meaning. The mode is observation scope,
recorded in the snapshot and scope key only when rendered. HTML scope keys stay byte-identical.
Graph issues become unverified across modes while existing served-page checks stay comparable.
Catalog reanalysis marks the new category unobserved for old data.

Proof 1 follows the orchestrator's explicit relaxation: findings, accepted rows, counts and scope
key are identical to the base fixtures and HTML fake-site crawl; the only snapshot difference is
the new JavaScript IDs in `unobserved` (and catalog fields if any). Baselines will be captured
from the unchanged base before implementation. Tests also cover three real Chromium crawls,
JavaScript menu discovery, failed renders, browser recovery/exhaustion, and settings validation.
