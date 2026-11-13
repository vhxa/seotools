# Optional JavaScript rendering browser

The worker supplies every HTTP response to a fresh browser context using request interception.
The browser belongs only to an internal Docker network; the worker belongs to that network and
its ordinary outbound network. Rendering is disabled unless `RENDER_BROWSER_URL` is configured.
Crawl integration follows in a separate work package.

The browser container is the sandbox: Chrome runs with `--no-sandbox`, as an unprivileged user,
with a read-only filesystem, writable `/tmp`, no capabilities, no new privileges, and bounded
memory and processes. Never expose its DevTools port or attach it to an outbound network.

Implementation and deployment validation are in progress.
