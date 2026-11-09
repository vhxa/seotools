# Web — Agent Guide

Next.js app: UI, login, first-run setup, onboarding, `/api/health`, better-auth routes and server actions. Repo-wide rules are in the root `AGENTS.md`. Before changing findings, rules, comparison, crawl history, the pages table or exports, read `packages/core/src/crawl/AGENTS.md`. Its UI rules (pages table, CSV exports, URL detail drawer) are in that file.

## Structure

```
apps/web/            # Next.js app: UI, login + first-run setup + onboarding, /api/health, better-auth routes, server actions
```

## Main third-party packages

| Package                    | Used in | Description                               |
| -------------------------- | ------- | ----------------------------------------- |
| `next`, `react`            | web     | Web framework and UI runtime              |
| `better-auth`              | web, db | Email/password sessions, sign-up disabled |
| `shadcn`, `@base-ui/react` | web     | UI components                             |
| `next-intl`                | web     | i18n (messages in `apps/web/messages`)    |
| `tailwindcss`              | web     | Styling                                   |

## Architecture

- Accounts have no public sign-up: they are invited (`inviteUser`, `/system/users`) and set their password with a single-use link (`user_tokens` keeps only the hash; `access.email` jobs make the link when sending, so no job holds one).
- **UI:** the header (`AppHeader`) holds the way home, the domain selector, the URL search (`searchUrlsAction`, read-only, latest full crawl) and the user menu; the sidebar only navigates, exists only inside a domain (`/domains/[host]`; System and the account have none and are centred pages with their own tabs or links) and is always open on desktop (a sheet on mobile). The version and channel are shown only in System → Updates and `/api/health`, never in the shell. Use shadcn by default whenever an existing component or primitive covers the need. Pages are capped at `max-w-5xl` by the protected layout; one that needs the whole screen (the pages table) marks its `<main data-wide>`.
- **Forms with a switch or checkbox** submit through `useFormActionState` (`apps/web/hooks`), never `<form action>`: React resets the form after the action, which leaves the switch looking on while its checkbox is off, so the next click does nothing and the next submit sends the wrong value.
- **Companies and domains:** domains are grouped by company (an agency's client) and each feature works on one domain at a time. The active domain is the `/domains/[host]` route segment, never a cookie or global state. Every page and route scoped to a domain starts with `requireDomain(host)` (`apps/web/lib/workspace.ts`), every server action that changes something or spends requests with `requireDomainEditor(host)` (`lib/authorization.test.ts` fails otherwise), and its tables reference `domains.id`; those are the only places that check per-company/per-domain permissions. What lists companies or domains for someone goes through `visibleCompanies`. Client components that offer a change read `useCanEdit()` (`components/domain-access.tsx`): that is courtesy, the action decides. A viewer sees no button that writes (not rendered) and fields that show a value are disabled, never merely inert; `lib/authorization.test.ts` fails for a component using these actions without `useCanEdit`/`EditorsOnly`. Hosts are stored normalized by `normalizeDomain` (`@seotools/core`): `example.com`, no scheme, no `www.`, no path, always with a dot. Only instance-wide pages (`/system`) live outside a domain. A domain's settings go in a section of `/domains/[host]/settings` (`components/settings-nav.tsx`), never in the page of the feature they configure; sections that change the domain live in the `(config)` route group, whose layout makes them inert for viewers, and a personal one (alerts) lives outside it so anyone who can see the domain can use it.
- **Companies and domains lifecycle:** `/system/companies` (admin only: every action calls `requireAdmin()`) renames companies, archives/restores, moves and deletes domains, and deletes companies, via `@seotools/db` (`workspace.ts`). A domain's host is never edited: a new site is a new domain. Moving a domain changes only `company_id`, so every result stays (`accessAfterMove` in `@seotools/core/access` says who gains and loses it, and the dialog names them). Deleting needs the typed host or name, re-checked on the server against the stored value, and removes the jobs of the domain's crawls and rechecks in the same transaction.
- **i18n:** the UI is internationalized (`next-intl`, locale from `Accept-Language`, no URL prefix). Every user-facing string must be translatable; never hardcode copy in components. Add each message to **both** `apps/web/messages/en.json` and `es.json` (a test fails if their keys or ICU arguments differ) and read it with `useTranslations` / `getTranslations`, including error messages returned by server actions. Data stored in the database (job payloads, etc.) is not UI copy. shadcn components that ship English copy are patched to read `next-intl` (`components/ui/sidebar.tsx` → `Sidebar` messages; `hooks/use-mobile.ts` also differs from upstream to pass lint): re-apply those patches after `shadcn add --overwrite`.

Client components may only import pure subpath exports of `@seotools/core`: see `packages/core/AGENTS.md`. The version and channel come only from `getBuildInfo()`: see Builds in the root `AGENTS.md`.

## Security

- Admin credentials never come from environment variables. The first admin is registered on `/setup` through `createFirstAdmin`, which refuses to run once any user exists. Never re-enable better-auth sign-up.
- `proxy.ts` only checks that a session cookie exists. Every protected page and **every server action** must call `requireSession()` (or what builds on it: `requireViewer`, `requireAdmin`, `requireDomain`, `requireDomainEditor`) itself; a layout does not protect actions. `lib/authorization.test.ts` reads the code and fails on an action or a page that does not.
- A valid session is not authorization. Pages and server actions restricted to a role (e.g. admin) must also check the user's role on the server. Instance-wide ones (`/system/*`) call `requireAdmin()` (`lib/session.ts`), the single place that checks it.
- `GET /api/health` is public: it reports the status, the version and channel, the database (`db: { ok, dialect }`) and the worker (`worker: { ok, lastSeen }`). Error details stay in the server logs.

## Versions and releases

- **Update check** (System → Updates, behind `requireAdmin()`): `checkForUpdates` (`@seotools/core`) reads the GitHub releases feed on request or, if an administrator enabled it, from the worker once a day; never while rendering a page. It sends nothing about domains or the installation. A failure is `check-failed`, never "up to date", and a development build is never compared. The app never replaces its container or touches the Docker socket: Docker or Dokploy does.
