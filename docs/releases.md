# Releases

For maintainers, and for the agents that work on the code. For whoever runs an installation, see
[updating.md](updating.md), which also defines what each Docker tag means.

- [The policy](#the-policy)
- [One source of truth](#one-source-of-truth)
- [Classifying a change](#classifying-a-change)
- [When to release](#when-to-release)
- [Making a release](#making-a-release)
- [What the workflow does](#what-the-workflow-does)
- [Checking what was published](#checking-what-was-published)
- [When a release is wrong](#when-a-release-is-wrong)
- [Before the first release](#before-the-first-release)

## The policy

- **`MAJOR.MINOR.PATCH`** ([Semantic Versioning](https://semver.org)). Increment **PATCH** for
  compatible fixes and **MINOR** for new features. From `1.0.0`, an incompatible change requires
  **MAJOR**.
- **While the project is `0.x`**, an incompatible change requires a **new minor version**, an
  explicit **Breaking** entry in the changelog, and **upgrade notes** that tell an administrator
  what to do. (`0.2.3` → `0.3.0`, never `0.2.4`.)
- **The version is increased when a release is prepared**, not by each commit or pull request.
  Between releases, `main` holds the version of the last release.
- **Documentation alone does not need a new version** of the application. A release of only
  documentation is not made; it reaches the next one.
- **Release candidates** are `X.Y.Z-rc.N` (`0.3.0-rc.1`). They are different from stable
  versions in everything that follows releases: they are older than `X.Y.Z`, they never become
  `latest`, they move no channel tag, the in-app update check never offers them, and their GitHub
  release is marked as a pre-release.

## One source of truth

The version is the `version` of the **root `package.json`**. Everything else is derived from it, or
checked against it:

| Where                                           | How it gets there                                                                                                                    |
| ----------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `package.json` of each workspace                | Written by `node scripts/release.mjs prepare`; CI (`pnpm release:check`) fails when one differs.                                     |
| The UI, `/api/health`, the crawler's User-Agent | Read from the code at build time (`APP_VERSION`). Never typed anywhere else.                                                         |
| `CHANGELOG.md`                                  | `prepare` closes `[Unreleased]` as `## [X.Y.Z] - date`. `check` fails if its newest release is not the package version.              |
| Git tag `vX.Y.Z`                                | Made by hand on the merge commit of the release pull request. The Docker workflow refuses it if it is not `v` + the package version. |
| Docker tags                                     | Decided by `node scripts/release.mjs plan` from the tag: see [updating.md](updating.md#image-tags).                                  |
| Image label `org.opencontainers.image.version`  | The version; `X.Y.Z+dev.<commit>` for a development build.                                                                           |
| GitHub release and its notes                    | Created by the workflow from the `CHANGELOG.md` section (`node scripts/release.mjs notes X.Y.Z`).                                    |

What tells a release from a development build is not the number but the **channel**
(`SEOTOOLS_BUILD_CHANNEL`, an argument of the Dockerfile): only the release workflow, for a tag,
passes `release`. The image from `main`, a pull request, or `docker build` on a machine are
`development` and show as such in the sidebar, `/api/health` and **System → Updates**.

Never edit a `version` by hand, and never raise it in a feature or fix pull request: `check` fails
if it disagrees with `CHANGELOG.md`.

## Classifying a change

Every pull request says what it does to the **next release**, in two places: an entry under
`## [Unreleased]` of `CHANGELOG.md` in the same pull request, under the heading that names the
impact, and the "Release impact" line of the pull request description.

| Impact       | Heading in `CHANGELOG.md` | Next version                 | Examples                                                        |
| ------------ | ------------------------- | ---------------------------- | --------------------------------------------------------------- |
| **none**     | no entry                  | none by itself               | documentation, tests, CI, refactoring with no visible change    |
| **patch**    | `Fixed`, `Security`       | PATCH                        | a bug, a security fix, a compatible dependency update           |
| **minor**    | `Added`, `Changed`        | MINOR                        | a feature, a page, a new setting with a default, a better check |
| **breaking** | `Breaking`                | MAJOR; **MINOR while `0.x`** | see below                                                       |

The next version is the highest impact among the entries. `node scripts/release.mjs next` says
which one the file asks for, and `prepare` refuses a smaller one.

A change is **breaking** when an installation that updates cannot just keep running as it was:

- an environment variable is removed, renamed, becomes required, or changes its meaning or default;
- the layout of `/data`, the default `DATABASE_URL`, the port, the user the container runs as, the
  `SEOTOOLS_MODE` values, or the `/api/health` fields change or disappear;
- a supported database or a platform stops being supported, or its minimum version rises;
- a migration or a data conversion cannot be recovered from by restoring a backup, needs a manual
  step, or changes what stored data means (a new `AUDIT_SEMANTICS` is one);
- a feature, a page or an image tag people rely on is removed or renamed;
- an administrator has to do anything for the update to work.

When in doubt, it is breaking. A breaking entry **must** be followed by an `### Upgrade notes`
section with the steps; `check` fails without it.

**Migrations are not breaking by themselves, but they are never silent.** Every migration moves
the database forward only, and images with the migration compatibility guard refuse unknown migration journal entries
(older images predating the guard do not)
([updating.md](updating.md#what-an-update-does)). When a release adds migrations, its upgrade
notes say so and say that going back needs the backup. A release that converts data or analyses
earlier crawls again says that too.

Write an entry for the person who updates, in the present tense, saying what they will notice:
"The Updates page tells…", not "refactor `evaluateUpdate`".

## When to release

Release when something is worth installing — not on a schedule, and not for every merge:

- **A security fix**: now, as a PATCH, from `main` (or from the last release line with a backport,
  see below).
- **Fixes that people hit**: a PATCH when enough have gathered that someone would want to update
  for them.
- **A feature that is done and usable**, or a set of them: a MINOR. Publish a release candidate
  first when the change is large or touches data (`prepare 0.3.0-rc.1`), and give it time on a
  copy of real data.
- **Breaking changes**: a MINOR (`0.x`) or MAJOR, and never together with unrelated fixes the
  administrator might want without the break.
- **Do not release** for documentation, tests, CI or refactors alone, nor with `main` red, nor
  with entries under `[Unreleased]` nobody has read.

## Making a release

A release is a pull request and a tag. Nothing is published until the tag is pushed.

1. **Decide the version.** `node scripts/release.mjs next`. Take that, or a bigger one if you want
   to (a candidate, `1.0.0`), never a smaller one.
2. **Prepare it** on a branch from an up-to-date `main`:
   ```bash
   git switch -c release/0.3.0 origin/main
   node scripts/release.mjs prepare 0.3.0      # versions everywhere + CHANGELOG.md
   ```
   Then read `CHANGELOG.md`: it is what administrators read. Fix what is unclear, add the
   `### Upgrade notes` the release needs (migrations? conversions? things to do?), and check it
   again with `node scripts/release.mjs check`. Commit as `chore(release): 0.3.0`.
   For a stable release that follows candidates, `prepare` folds their entries in.
3. **Open the pull request.** CI must pass in full, including the Docker build:
   ```bash
   pnpm format:check && pnpm lint && pnpm typecheck && pnpm db:check && pnpm test && pnpm build
   ```
4. **Validate it as an installation would receive it** (this is the part nobody else does):
   - Build the image and update **a copy of real data** from the previous release, as in
     [updating.md](updating.md#update-with-docker-compose): the migrations apply, the data is
     there, `/api/health` is `ok`, the Updates page and the sidebar say what they should.
   - If it has migrations, read the diff of `packages/db/migrations/*` for what could hurt data on
     the three dialects, and run the database contract on PostgreSQL and MySQL
     (`TEST_POSTGRES_URL`, `TEST_MYSQL_URL`).
   - Walk through the release notes as if you had never seen the code.
5. **Merge** (squash). `main` now builds `edge` with the new version number, as a development
   build: it is not the release yet.
6. **Tag the merge commit and push the tag. This is what publishes.**
   ```bash
   git switch main && git pull
   git tag -a v0.3.0 -m "v0.3.0"     # the commit of the release pull request, not a later one
   git push origin v0.3.0
   ```
   The tag is checked against the package version and the changelog; a mistake fails the workflow
   before anything is published. **Never move or delete a pushed tag**: if something is wrong, make
   a new version.
7. **Check what was published** (next section).

### Release candidates

`node scripts/release.mjs prepare 0.3.0-rc.1`, merge, tag `v0.3.0-rc.1`. It publishes only the
image `0.3.0-rc.1`, and a GitHub pre-release. Install it on a staging copy, fix what it shows
under `[Unreleased]`, and prepare `0.3.0-rc.2` or `0.3.0`. The stable release replaces the
candidates in the changelog.

## What the workflow does

`.github/workflows/docker.yml`, on a pushed `vX.Y.Z[-pre]` tag:

1. **plan**: refuses a tag that is not on `main` (or a `maintenance/*` branch), that is not `v` + the
   package version, or whose `CHANGELOG.md` is missing or inconsistent. Decides the tags.
2. **build**: the image for `linux/amd64` and `linux/arm64`, with `SEOTOOLS_BUILD_CHANNEL=release`
   and the commit.
3. **publish**, in this order:
   1. refuses to continue if `ghcr.io/<owner>/seotools:X.Y.Z` already exists;
   2. publishes the exact tag `X.Y.Z` (both architectures in one manifest);
   3. **runs the published image** and checks that `/api/health` is `ok`, with the version of the
      tag and `channel: release`;
   4. only then moves the channel tags (`X.Y`, `X` from 1.0.0, `latest` if it is the newest stable
      release), and
   5. creates the **GitHub release** with the notes of the changelog, marked pre-release for a
      candidate and "latest" only if it is the newest stable one.

Installations learn about a version from the GitHub release, so it is created last: an
announced version always has a checked image. If the image fails the check, nothing after it
happens; fix it with a **new** version.

A push to `main` runs the same workflow for a development build: `sha-<commit>`, checked, then
`edge`. A pull request only builds.

## Checking what was published

The workflow checked the image. Check the rest, from outside:

```bash
V=0.3.0
docker buildx imagetools inspect ghcr.io/vhxa/seotools:$V      # linux/amd64 and linux/arm64
docker buildx imagetools inspect ghcr.io/vhxa/seotools:0.3     # the same digest as $V
docker buildx imagetools inspect ghcr.io/vhxa/seotools:latest  # the same digest, if it is the newest
docker run --rm -d --name rc -p 3000:3000 -e BETTER_AUTH_SECRET="$(openssl rand -base64 32)" \
  ghcr.io/vhxa/seotools:$V && sleep 30 && curl -s localhost:3000/api/health; docker rm -f rc
```

- `/api/health` says the version and `"channel": "release"`.
- `gh release view v$V` shows the notes, and "Latest" only on the newest stable release.
- `git tag --list 'v*'` and `docker buildx imagetools inspect …:edge` still say what they should.
- On an installation (yours, or a copy), **System → Updates → Check now** reports the new version
  as available, and — after updating it — as up to date.
- The notes mention every migration and conversion in the release.

## When a release is wrong

- **The workflow failed before publishing**: fix the cause. If it was the tag (wrong commit, wrong
  version), delete the **tag that never published anything** and tag again; check on GHCR that no
  image with that version exists first. Otherwise re-run the failed job.
- **A published version has a problem**: do not delete or move anything. Publish a fixed PATCH (or
  candidate) with an entry that says what was wrong. If people should not install the broken one,
  edit its GitHub release to say so at the top. Installations on `X.Y` get the fix by themselves.
- **An older line needs a fix** (`0.2.4` after `0.3.0` exists): branch `maintenance/0.2` from the
  last tag of that line, cherry-pick the fix, `prepare 0.2.4` there, merge it into that branch and
  tag it. The workflow accepts tags on `main` and on `maintenance/*` branches only. It moves `0.2`,
  leaves `latest` on `0.3.0`, and creates the GitHub release with `--latest=false`. Port the
  changelog entry to `main` by hand.

## Before the first release

Nothing has been published yet: there are no tags, no release and no `latest` image. Before the
first tag:

- [ ] **The repository is public**, or the update check cannot work for anyone but you: it reads
      the GitHub releases anonymously and reports "not found" for a private repository.
- [ ] **The container package is public** (GitHub → Packages → seotools → Package settings →
      visibility), or nobody can pull it without a token.
- [ ] **Tags `v*` are protected** (Settings → Rules → Rulesets → tag ruleset: restrict
      deletion and updates). The policy depends on a published tag never moving; the repository
      does not enforce it by itself.
- [ ] `main` is protected and requires CI (`CI` and `Docker`).
- [ ] Decide the first version. The current `0.1.0` was never published, so the first release can
      be `0.1.0` (`prepare 0.1.0`) or whatever the entries ask for.
- [ ] Rehearse once on a throwaway fork or with a candidate (`0.1.0-rc.1`): the workflow, the
      image, the release and the Updates page have only been tested in pieces.
- [ ] After it is published, delete the notes in `README.md` and `docs/updating.md` that say no
      release exists yet.
