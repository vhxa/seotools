# Core — Agent Guide

Shared logic: env validation, logger, job types, settings encryption, mail, crawl types and URL rules. Repo-wide rules are in the root `AGENTS.md`. Before changing findings, rules, comparison, crawl history, the pages table or exports, read `packages/core/src/crawl/AGENTS.md`.

## Structure

```
packages/core/       # Shared logic: env validation, logger, job types, settings encryption, mail (SMTP + Resend), crawl types and URL rules
```

## Main third-party packages

| Package                | Used in | Description                         |
| ---------------------- | ------- | ----------------------------------- |
| `zod`                  | core    | Environment validation              |
| `pino`                 | core    | Structured logging                  |
| `nodemailer`, `resend` | core    | Email delivery (SMTP or Resend API) |

## Rules

- An instance has administrators (everything) and members, who only have grants: `editor` or `viewer` on a company (all its domains, also future ones) or on a domain, where the most specific wins (`@seotools/core/access`, the only place that decides it). Nothing is implicit: without a grant a domain is a 404.
- Email copy that the worker writes lives in `@seotools/core` in both languages (`access-email.ts`, `alert-email.ts`, a test keeps the keys equal), as plain text: what a site wrote is cut and put on one line (`alertLine`).
- Client components may only import types from `@seotools/core`: its entry point pulls in Node-only code, which breaks `next build` but not `pnpm typecheck`. For values, add a subpath export of a pure module (e.g. `@seotools/core/crawl/settings`).
- Secrets saved from the admin panel (SMTP password, Resend key, Google vitals key) go through the `settings` repository with `encrypted: true` (AES-256-GCM, key `SETTINGS_ENCRYPTION_KEY` or `BETTER_AUTH_SECRET`). Never log them.
- Read configuration through the parsed env objects (`packages/core/src/env.ts`): see the root `AGENTS.md` for who may read `process.env`.
