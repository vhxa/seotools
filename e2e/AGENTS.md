# End-to-end smoke tests — Agent Guide

`e2e/` (Playwright, Chromium only, `playwright.config.ts`) drives the production build in a browser: first-run setup and sign-in, the admin's domain pages and CSV export, and a viewer's restricted access. Vitest does not run it.

```bash
pnpm build && pnpm exec playwright install chromium   # once
pnpm test:e2e
```

`e2e/support/start.ts` makes a fresh SQLite file in the OS temp dir (never `/data`), seeds a company, a domain and one finished crawl through the real crawler against a fake site, and serves the Next standalone build on port 3210 (`E2E_PORT` picks another one, with its own database folder, when it is taken). The specs run in file order and depend on each other (the first creates the administrator); the sign-in endpoint is rate limited, so later specs reuse a saved session instead of signing in again.
