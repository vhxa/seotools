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
only `render`, whose `internal: true` prevents external routing. The Compose entrypoint reproduces
the pinned image's `run.sh`: socat forwards port 9222 to Chrome's loopback DevTools listener on
9223, with the same five built-in Chrome flags. It fixes upstream's unquoted `$@`, which splits
and globs the resolver rule. Keep this override when updating the image and compare its
`run.sh` for changes.

The network boundary is only one layer: browsers can otherwise reach their own loopback and
the app on `render`. The browser service therefore passes all four required flags through the
quoted-argument entrypoint:

```text
--proxy-server=http://127.0.0.1:9
--proxy-bypass-list=<-loopback>
--host-resolver-rules=MAP * ~NOTFOUND
--force-webrtc-ip-handling-policy=disable_non_proxied_udp
```

Unintercepted HTTP/WebSocket traffic goes to a dead proxy, including loopback and names (with an
HTTP proxy, Chromium hands names to the proxy); WebRTC cannot send non-proxied UDP. The resolver
rule is a further layer for any path that does not use the proxy; the check below does not try to
prove it. Intercepted responses are supplied by the worker and still render. These flags apply to
**headless-shell**: full Chrome does not implement the same WebRTC command-line override. An
external/Dokploy browser must retain the internal network boundary **and** pass exactly these
flags, with no other proxy exception. A browser started without them is refused, and so is one
whose `--proxy-bypass-list` adds an exception covering a sampled destination (`[::1]`, a worker
address, one of the sampled ports…); see below for what sampling cannot see.
Forward arguments with quoted `"$@"` in shell wrappers; keep the resolver rule as one argument,
including its spaces and literal `*`. Do not rely on permissions or HTTP interception alone.

Open **System → Integrations**, check the browser, and refresh for the worker's result. **Ready**
means the worker connected, accepted the Chrome version and obtained positive proof that the dead
proxy applies. In a context without interception the browser fetches (HTTP and HTTPS), opens
WebSockets to and navigates to a fixed sample of destinations: IPv4 and IPv6 loopback and every
address of every worker network interface on ports 80, 443, 3000, 5432, 9222 and 9223, one address
in each private range, public address literals, `example.com` and `localhost`. **Every** probe must
fail with exactly `net::ERR_PROXY_CONNECTION_FAILED`. Any other outcome (an answer, a refusal, a
reset, a timeout, a certificate error, a not-resolved error, any other net error) means some
destination does not go through the dead proxy, and the browser is refused as **unsafe
configuration**. WebRTC must gather no candidate at all (no TURN server is configured, so any
candidate is a direct socket). As a second signal the worker binds live TCP and UDP listeners on the
address the browser sees it at (its CDP socket's local address) and on its loopback; the probes
include them, and any byte or datagram they receive, or any answer, refuses the browser as **has
network**.

Sampling is a safeguard against misconfiguration **on top of** the internal network, not a proof
for arbitrary configurations: a bypass rule for a destination outside the sample (another port, an
address the worker does not have) would not be seen. Keep the browser on the internal network and
use the flags exactly as above.

A passed check is bound to the browser **instance**: Chrome publishes a random identifier for its
DevTools server in `/json/version`, refuses connections that name another one, and draws a new one
when it restarts. Every render compares the identifier of the connection it actually holds with the
one that passed; a different or unknown identifier (a restarted or replaced browser) runs the full
check on that connection before any page, and a failure refuses the render. A failed connection or
an unexpected disconnection forgets the result. Status expires after 15 minutes. Checks run at
connection and every five minutes; `SEOTOOLS_PAUSE_AUTOMATION` stops periodic checks, while the
administrator's **Check now** still runs. WP4 callers must call `check()` before a crawl.

The pinned image supports amd64 and arm64. The minimum accepted Chrome major is 157, the version
listed for Puppeteer 25.17.0; open-shadow-root `getHTML` support predates that minimum. The Compose
image is Chrome 158.0.8127.18, verified against the same protocol library. Security updates require
updating the exact browser image tag to the maintained version, then `docker compose pull browser`
and `docker compose --profile rendering up -d`. Pulling an unchanged version tag does not select a
newer Chrome version.

## What the worker requests

The caller supplies the already-fetched document. Only GET, HEAD, OPTIONS and POST are requested; POST is sent at most once. Only HTTP(S) documents (subframes), scripts,
stylesheets, fetch/XHR and CORS preflight requests are eligible. The worker uses the caller's crawl
requester and guarded fetcher: pacing, safe-method retries, User-Agent, connect-time public-address validation,
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
Permissions and downloads are denied; dialogs dismissed; popups and worker targets closed. There is no clicking,
scrolling or other simulated interaction. Open shadow roots are included in the DOM snapshot.
Client redirects record the target and stop; they never audit the target's content here.

Determinism means two renders of the same served document with the same resources give the
same outcome (excluding duration), except output depending on the real clock, `crypto` randomness
or answers that change between requests. `Math.random()` uses a PRNG seeded from the page URL,
installed before document scripts in every frame, including cross-site out-of-process frames.
`Date.now()` remains real so pages can display dates. Fresh contexts and sorted diagnostics
complement that contract; they cannot make a changing API answer deterministic.

The default wait is five seconds (at most thirty). A loaded page with no worker request in flight
for 500 ms is settled; reaching the wait limit gives a rendered, unsettled snapshot. Failure to
load has an additional 25-second hard cap; crashes/disconnections are retried only once.
Limits in `apps/worker/src/render/limits.ts` bound requests (300), resource bytes (5 MiB), page
bytes (30 MiB), request bodies (1 MiB), serialized DOM (10 MiB), script errors (count and five
200-character samples) and resource lists (count and fifty sorted samples). A 64 MiB LRU cache
created per crawl shares GET scripts/styles, including failures. API calls and documents are
never cached. Every decoded download byte, including partial/error/truncated responses and retries,
counts toward the page budget. Resource loads are serialized per page so concurrent loads cannot
race that budget. A cacheable script/style is fetched with its full 5 MiB resource cap even when
less page budget remains, cached independently of that page, then omitted if it does not fit.
This allows at most one resource's bounded overread before the page stops requesting resources.

Each render and each status check owns a separate CDP connection. The `ws` transport rejects
messages above 64 MiB **before** parsing JSON or Puppeteer's eager POST decoding: a 10 MiB DOM
can expand up to 60 MiB with JSON escaping, leaving room for its protocol envelope. A larger
message severs only that render; it is retried once then failed. Per-request POST bodies are
limited to 1 MiB and cumulative page POST bytes to 5 MiB. Name resolution, discovery and the
WS/CDP handshake share one ten-second deadline. The browser's name is resolved like any other
client does (the system resolver: `/etc/hosts`, then DNS, including Docker's), trying each address
in order; that lookup cannot be cancelled, so the worker stops waiting at the deadline and ignores
a late answer. Discovery and the socket are closed on expiry.

Omitted or unread content is unknown, never proof that a declaration is absent.

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
- [Versioned headless-shell WebRTC override](https://github.com/chromium/chromium/blob/158.0.8127.18/headless/lib/browser/headless_web_contents_impl.cc#L462-L467)
- [Versioned WebRTC policy effect](https://github.com/chromium/chromium/blob/158.0.8127.18/third_party/blink/renderer/modules/peerconnection/peer_connection_dependency_factory.cc#L1091-L1111)
- [Versioned net error list (`PROXY_CONNECTION_FAILED`, -130)](https://github.com/chromium/chromium/blob/158.0.8127.18/net/base/net_error_list.h#L256)
- [Versioned restricted ports (the probe ports are not among them)](https://github.com/chromium/chromium/blob/158.0.8127.18/net/base/port_util.cc)
- [Versioned DevTools browser identifier: drawn per process, required on upgrade](https://github.com/chromium/chromium/blob/158.0.8127.18/content/browser/devtools/devtools_http_handler.cc#L949-L954)
- [Versioned proxy and loopback bypass semantics](https://github.com/chromium/chromium/blob/158.0.8127.18/net/docs/proxy.md)
- [Compose process limit](https://docs.docker.com/reference/compose-file/services/#pids_limit)
- [Compose memory limit](https://docs.docker.com/reference/compose-file/services/#mem_limit)
- [ws message limit](https://github.com/websockets/ws/blob/8.22.1/doc/ws.md#new-websocketaddress-protocols-options)
- [Puppeteer supported browsers](https://pptr.dev/supported-browsers)

## Raspberry Pi and verification

`RENDER_CONCURRENCY` accepts **1–4**, default **2**. Use `1` on a small Pi. The browser image
is approximately 540 MB uncompressed on arm64. Compose sets a ceiling of **1,536 MiB** and
**256 processes/threads**, with **256 MiB** shared memory. Keep spare memory for the app, database
and operating system. A memory-exhausted page is a failed render, never a successful audit of an
empty page; no finite limit guarantees every hostile page succeeds.

Round 4 measurements use the pinned Chrome 158.0.8127.18 image on Docker Desktop arm64. Each
concurrency starts a fresh hardened container, renders one polling page per slot with a
fifteen-second wait limit,
and runs the full isolation check after every page has started polling. Throughout the workload,
`docker exec` samples cgroup `pids.current`, `memory.current` and the sum of `/proc/*/status`
`VmRSS` (including shared mappings repeatedly). The sampler itself adds a few tasks. These are
workload observations, not worst-case bounds. The isolation check opens at most one probe context
at a time. All cgroup PID/memory limit-hit and OOM counters stayed at zero.

| Concurrent renders + one check | Peak tasks | Peak summed RSS (MiB) | Peak cgroup memory (MiB) |
| ------------------------------ | ---------: | --------------------: | -----------------------: |
| 1                              |        105 |                 622.1 |                    199.4 |
| 2                              |        117 |                 717.6 |                    225.0 |
| 3                              |        130 |                 755.3 |                    243.4 |
| 4                              |        133 |                 864.7 |                    269.2 |

An initial measurement pass used a temporary ceiling of 512 tasks / 2 GiB. The table is the
repeat under the shipped 256-task / 1,536-MiB ceilings, exceeding its four-render task peak by
92% and conservative summed-RSS peak by 78%. RSS and cgroup peaks occur at different instants;
cgroup memory accounts shared
pages once. Size a Pi using the row for its concurrency and at least 50% headroom, and measure
its real pages before reducing limits. Earlier original-spike hostile-page runs peaked at 340.4
MiB RSS for one render and 440.5 MiB for two (without a simultaneous check); the polling/check
measurements above are the more conservative sizing reference.

The Docker regression runs every supported concurrency, requires each render and concurrent
check to succeed under the **shipped** limits, and asserts zero PID/memory limit hits. It skips
when Docker or the pinned browser image is unavailable (it never pulls images). Its test bridge
publishes CDP only on host loopback so the host test runner can drive it; production Compose
keeps the browser on the internal-only network with no published port. Run it explicitly with:

```bash
pnpm exec vitest run apps/worker/src/render/budget.integration.test.ts --silent=false
```

Connection failures and unexpected disconnections of a verified browser persist `unreachable`
with a bounded, generic detail; a fresh `ready` status cannot survive a known failed connection.
Cleanup of sessions, targets, contexts and CDP connections is best-effort, preserving the render
outcome and its single crash retry even when a target has already disappeared.

The Chromium integration suite runs automatically when Playwright's Chromium is installed, skips
otherwise, and runs in CI's e2e job after Chromium installation:

```bash
pnpm exec playwright install chromium
pnpm exec vitest run apps/worker/src/render/render.integration.test.ts
```

It uses Chromium's [proxy switches](https://chromium.googlesource.com/chromium/src/+/main/net/base/net_switches.cc)
and [host resolver rules](https://chromium.googlesource.com/chromium/src/+/main/net/dns/host_resolver_manager.cc)
to deny direct network access during local tests. These same flags are required in production as well as the
container network boundary. Negative fixtures (no flags, a missing WebRTC flag, and proxy bypasses
for `[::1]`, another worker address and one loopback port, each with and without the resolver
rule) must be refused; they disable Chromium's local-network access checks solely so the live
canaries can receive actual traffic; render contexts deny permissions.
