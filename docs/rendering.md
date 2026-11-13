# Optional JavaScript rendering browser

The worker supplies every HTTP response to a fresh browser context using request interception.
The browser belongs only to an internal Docker network; the worker belongs to that network and
its ordinary outbound network. Rendering is disabled unless `RENDER_BROWSER_URL` is configured.
Crawl integration follows in a separate work package.

The browser container is the sandbox: Chrome runs with `--no-sandbox`, as an unprivileged user,
with a read-only filesystem, writable `/tmp`, no capabilities, no new privileges, and bounded
memory and processes. Never expose its DevTools port or attach it to an outbound network.

## Enable with Docker Compose

In `.env`, set:

```dotenv
COMPOSE_PROFILES=rendering
RENDER_BROWSER_URL=http://browser:9222
RENDER_CONCURRENCY=2
```

Run `docker compose --profile rendering up -d`. Without this profile the browser is not started;
without the URL the worker loads no browser library and attempts no connection. The application
keeps its ordinary outbound network in either case. The browser has no published ports and joins
only `render`, whose `internal: true` prevents external routing. Do not change its entrypoint:
`run.sh` forwards port 9222 to Chrome's loopback DevTools listener on 9223.

Open **System → Integrations**, check the browser, and refresh for the worker's result. Ready
means the worker connected, accepted the Chrome version and observed failures for all three
constant network probes (hostname, public IP and cloud metadata IP), without interception.
A networked browser is refused even if it would otherwise work. Status expires after 15 minutes.
Checks run at connection and every five minutes; `SEOTOOLS_PAUSE_AUTOMATION` stops periodic checks,
while the administrator's **Check now** still runs. WP4 callers must call `check()` before a crawl.

The pinned image supports amd64 and arm64. The minimum accepted Chrome major is 157, the version
listed for Puppeteer 25.17.0; open-shadow-root `getHTML` support predates that minimum. The Compose
image is Chrome 158.0.8127.18, verified against the same protocol library. Security updates require
updating the exact browser image tag to the maintained version, then `docker compose pull browser`
and `docker compose --profile rendering up -d`. Pulling an unchanged version tag does not select a
newer Chrome version.

## What the worker requests

The caller supplies the already-fetched document. Only HTTP(S) documents (subframes), scripts,
stylesheets, fetch/XHR and CORS preflight requests are eligible. The worker uses the caller's crawl
requester and guarded fetcher: pacing, retries, User-Agent, connect-time public-address validation,
`CRAWLER_ALLOW_PRIVATE_NETWORKS`, and credentials only to the tracked host apply as usual. Site
robots rules block render resources when explicitly disallowed; unknown is not treated as absent.
This never makes robots rules a reason to skip pages being audited.

Images, media, fonts, WebSockets, event streams, beacons/pings, CSP reports, manifests, prefetch,
text tracks, signed exchanges, FedCM and unknown resource types are omitted. Some protocols
(WebSockets and DNS hints in particular) bypass HTTP interception; network isolation and denied
permissions are therefore essential, even when the page appears to work without them.

Measurement is omitted by host suffix: Google Analytics, Google Ads/DoubleClick, Meta's pixel
loader, Clarity and UET, Hotjar, Plausible, Mixpanel, Segment, Amplitude and Heap. VWO/Wingify,
Optimizely, AB Tasty, Kameleoon, Convert, Adobe Target, Dynamic Yield and Monetate are omitted as
experiments/personalisation. Google `gtag/js`, Facebook `/tr`, and Matomo/Piwik tracking scripts and
endpoints are omitted by path. The exact short lists and their vendor sources live in
[`render-policy.ts`](../packages/core/src/crawl/render-policy.ts). GTM's `gtm.js` is allowed:
its individual tags are checked separately. The caller can add domain-specific omitted hosts.

Only `accept`, `accept-language`, `content-type`, `origin`, `referer`,
`access-control-request-method`, `access-control-request-headers` and `x-requested-with` browser
headers reach the worker fetcher. Browser cookies, authorization and transport headers never do.
Responses lose `set-cookie`, `content-encoding`, `content-length` and `transfer-encoding` because
bodies are already decompressed. Redirects are answered as redirects so each hop is checked.

Each page uses a fresh context, a 412×2400 mobile/touch viewport and the crawl's User-Agent.
Permissions and downloads are denied; dialogs dismissed; popups closed. There is no clicking,
scrolling or other simulated interaction. Open shadow roots are included in the DOM snapshot.
Client redirects record the target and stop; they never audit the target's content here.

The default wait is five seconds (at most thirty). A loaded page with no worker request in flight
for 500 ms is settled; reaching the wait limit gives a rendered, unsettled snapshot. Failure to
load has an additional 25-second hard cap; crashes/disconnections are retried only once.
Limits in `apps/worker/src/render/limits.ts` bound requests (300), resource bytes (5 MiB), page
bytes (30 MiB), request bodies (1 MiB), serialized DOM (10 MiB), script errors (count and five
200-character samples) and resource lists (count and fifty sorted samples). A 64 MiB LRU cache
created per crawl shares GET scripts/styles, including failures. API calls and documents are
never cached. Omitted or unread content is unknown, never proof that a declaration is absent.

## Dokploy

**Deployment on Dokploy is untested.** An existing Dokploy _Application_ using
`ghcr.io/vhxa/seotools` is a single service. The current documentation does not establish a safe
recipe for attaching a second browser to that Application while preserving this internal-only
network boundary. Do not place the browser on `dokploy-network` or expose its CDP port.

Use a separate Dokploy **Docker Compose** deployment of this repository's compose file for a
trial, retaining the image-based `seotools` service and `.env` injection. Dokploy documents Compose
(and separately Swarm Stack), environment files and custom deployment commands. Use Compose,
not Stack, and enable the rendering profile explicitly in that command. Migrate a backup of the
existing data volume deliberately; a new deployment's named volume does not automatically contain
the old Application's data.

Dokploy's **Isolated Deployments** is not the same thing as Docker's `internal: true`: it creates a
stack-specific network and attaches **each service**. Attaching the browser to an extra network
may give it an outbound route. Before enabling a real crawl, inspect the deployed browser's
networks, verify only the internal render network remains, and verify the worker reports ready.
How to prevent Dokploy's network injection for this browser remains untested and must be confirmed
with the operator; the isolation probe refuses a reachable external endpoint rather than silently
accepting such a deployment. Configure a public domain only for `seotools`, never `browser`.

Sources checked for this guide:

- [Dokploy Applications](https://docs.dokploy.com/docs/core/applications)
- [Dokploy Compose, environment and custom commands](https://docs.dokploy.com/docs/core/docker-compose)
- [Dokploy Isolated Deployments](https://docs.dokploy.com/docs/core/docker-compose/utilities)
- [Dokploy Compose domains](https://docs.dokploy.com/docs/core/docker-compose/domains)
- [Docker internal networks](https://docs.docker.com/reference/compose-file/networks/#internal)
- [Compose profiles](https://docs.docker.com/compose/how-tos/profiles/)
- [headless-shell README and entrypoint](https://github.com/chromedp/docker-headless-shell)
- [Puppeteer supported browsers](https://pptr.dev/supported-browsers)

## Raspberry Pi and verification

Use `RENDER_CONCURRENCY=1` on a small Pi. The browser image is approximately 540 MB uncompressed
on arm64; Compose limits its memory to 512 MiB and processes to 128. Memory exhaustion can crash a
page; it must remain a failed render, never a successful audit of an empty page. Increase the
container's `mem_limit` only if the host has sufficient spare memory for the app and database.

The Chromium integration suite runs automatically when Playwright's Chromium is installed, skips
otherwise, and runs in CI's e2e job after Chromium installation:

```bash
pnpm exec playwright install chromium
pnpm exec vitest run apps/worker/src/render/render.integration.test.ts
```

It uses Chromium's [proxy switches](https://chromium.googlesource.com/chromium/src/+/main/net/base/net_switches.cc)
and [host resolver rules](https://chromium.googlesource.com/chromium/src/+/main/net/dns/host_resolver_manager.cc)
to deny direct network access during local tests. These test flags do not replace the production
container network boundary.
