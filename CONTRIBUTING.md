# Contributing

Thanks for helping. Bugs and ideas go in [issues](../../issues); for a vulnerability, follow
[SECURITY.md](SECURITY.md) instead.

## Set up

Requirements, commands and how to run PostgreSQL tests are in the **Development** section of the
[README](README.md#development). The rules that keep the code consistent are in
[AGENTS.md](AGENTS.md); read the one of the workspace you change.

## Before opening a pull request

All of this must pass (it is what CI runs):

```bash
pnpm format:check && pnpm lint && pnpm typecheck && pnpm db:check && pnpm release:check && pnpm test && pnpm build
```

A change to the database layer also needs the contract tests on PostgreSQL (`TEST_POSTGRES_URL`,
see the README).

## Conventions

- **Commits and PR titles:** [Conventional Commits](https://www.conventionalcommits.org) (`feat:`,
  `fix:`, `docs:`, `chore:`, `test:`…). PRs are squash-merged.
- **Changelog:** every change a user, administrator or operator can see adds an entry under
  `## [Unreleased]` in `CHANGELOG.md`, in the same PR, under the heading that names its impact
  (`Added`, `Changed`, `Fixed`, `Security`, `Breaking`). Never change a version by hand. Details:
  [docs/releases.md](docs/releases.md).
- **Language:** code, comments, commits and docs are in English. UI text goes through i18n: add
  every message to both `apps/web/messages/en.json` and `es.json`.
- **Docs:** if you add something people see or configure, update the README briefly.
