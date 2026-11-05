import { UPDATE_GUIDE_URL, IMAGE_REPOSITORY } from '../repository.ts'
import {
  compareCore,
  compareVersions,
  formatVersion,
  isPrerelease,
  meetsImpact,
  minimumVersionFor,
  parseTag,
  parseVersion,
} from '../version.ts'
import {
  UNRELEASED,
  UPGRADE_NOTES_HEADING,
  entriesImpact,
  entryCount,
  mergeBlocks,
  parseChangelog,
  renderSection,
  sectionBody,
  type Changelog,
  type ChangelogSection,
} from './changelog.ts'
import { planPublish } from './plan.ts'

/**
 * `node scripts/release.mjs <command>`: the checks and the steps of a release that must not depend
 * on anyone's memory. All the file and Git access goes through `ReleaseIO`, so it is tested without
 * touching either.
 */

export interface ReleaseIO {
  /** A file of the repository, or `null` if it does not exist. */
  read(path: string): string | null
  write(path: string, text: string): void
  /** Every `package.json` of the repository, the root one included. */
  packageFiles(): string[]
  /** Every Git tag. */
  tags(): string[]
  /** Today as `YYYY-MM-DD`. */
  today(): string
  out(text: string): void
  err(text: string): void
}

const CHANGELOG = 'CHANGELOG.md'
const VERSION_LINE = /^(\s{2}"version":\s*")[^"]*(")/m

export const USAGE = `Usage: node scripts/release.mjs <command>

  check [--tag vX.Y.Z]   Versions, CHANGELOG.md and (with --tag) the release a tag publishes
  next                   The version the entries under [Unreleased] ask for
  prepare <version>      Set the version everywhere and close [Unreleased] as that release
  notes <version>        The notes published with a release
  plan --event <event> --ref <ref> --sha <sha>
                         What the Docker workflow publishes (KEY=value lines)`

class ReleaseError extends Error {}

const fail = (message: string): never => {
  throw new ReleaseError(message)
}

function option(args: readonly string[], name: string): string | undefined {
  const index = args.indexOf(name)
  return index === -1 ? undefined : args[index + 1]
}

function readPackageVersions(io: ReleaseIO): { versions: Map<string, string>; problems: string[] } {
  const versions = new Map<string, string>()
  const problems: string[] = []
  for (const path of io.packageFiles()) {
    try {
      const version = (JSON.parse(io.read(path) ?? '') as { version?: unknown }).version
      if (typeof version === 'string') versions.set(path, version)
      else problems.push(`${path}: no "version"`)
    } catch {
      problems.push(`${path}: not readable as JSON`)
    }
  }
  return { versions, problems }
}

function readChangelog(io: ReleaseIO): Changelog {
  const text = io.read(CHANGELOG)
  if (text === null) return fail(`${CHANGELOG} is missing`)
  return parseChangelog(text)
}

/** The newest release that is not a candidate: what the next version is counted from. */
const newestStable = (sections: readonly ChangelogSection[]) =>
  sections.find((section) => section.version && !isPrerelease(section.version))

/** Everything wrong with the versions and the changelog; empty when they agree. */
export function checkRelease(io: ReleaseIO, tag?: string): string[] {
  const { versions, problems } = readPackageVersions(io)
  const root = versions.get('package.json')
  const version = root ? parseVersion(root) : null
  if (!root || !version) {
    return [...problems, `package.json: "${root ?? ''}" is not a version like 1.2.3 or 1.2.3-rc.1`]
  }
  for (const [path, other] of versions) {
    if (other !== root) problems.push(`${path}: version ${other}, but package.json says ${root}`)
  }

  const changelog = readChangelog(io)
  problems.push(...changelog.problems)
  const releases = changelog.sections.filter((section) => section.version)
  const unreleased = changelog.sections.find((section) => section.name === UNRELEASED)
  const newest = releases[0]

  // Bumping the version and closing the changelog section are one step: neither can be alone.
  if (newest && newest.name !== root) {
    problems.push(
      `package.json is ${root}, but the newest release in ${CHANGELOG} is ${newest.name}. ` +
        'Use "node scripts/release.mjs prepare" to change the version.',
    )
  }
  // The newest release has to be big enough for what it says it changes.
  if (newest?.version) {
    const previous = newestStable(releases.slice(1))
    const impact = entriesImpact(newest)
    if (
      previous?.version &&
      impact !== 'none' &&
      !meetsImpact(previous.version, newest.version, impact)
    ) {
      problems.push(
        `${newest.name} is too small for its entries (${impact}) after ${previous.name}: ` +
          `it has to be at least ${formatVersion(minimumVersionFor(previous.version, impact))}`,
      )
    }
    if (entryCount(newest, 'Breaking') > 0 && !newest.blocks.get(UPGRADE_NOTES_HEADING)?.length) {
      problems.push(`${newest.name} has breaking changes: add "### ${UPGRADE_NOTES_HEADING}"`)
    }
  }

  if (tag !== undefined) {
    const tagged = parseTag(tag)
    if (!tagged) problems.push(`The tag "${tag}" is not a version like v1.2.3 or v1.2.3-rc.1`)
    else if (formatVersion(tagged) !== root) {
      problems.push(`The tag ${tag} does not match the version in package.json (${root})`)
    }
    if (!newest || newest.name !== root) {
      problems.push(`${CHANGELOG} has no release ${root} to publish`)
    }
    if (unreleased && entryCount(unreleased) > 0) {
      problems.push(
        `${CHANGELOG} still has entries under [${UNRELEASED}]: they are not in ${tag}. ` +
          'Tag the commit of the release pull request, not a later one.',
      )
    }
  }
  return problems
}

function setPackageVersions(io: ReleaseIO, version: string) {
  for (const path of io.packageFiles()) {
    const text = io.read(path) ?? ''
    if (!VERSION_LINE.test(text)) fail(`${path}: no "version" line to change`)
    io.write(path, text.replace(VERSION_LINE, `$1${version}$2`))
  }
}

function next(io: ReleaseIO) {
  const changelog = readChangelog(io)
  if (changelog.problems.length > 0) return fail(changelog.problems.join('\n'))
  const unreleased = changelog.sections.find((section) => section.name === UNRELEASED)
  const impact = unreleased ? entriesImpact(unreleased) : 'none'
  const previous = newestStable(changelog.sections)
  io.out(`impact: ${impact}`)
  io.out(`previous release: ${previous?.name ?? 'none'}`)
  if (impact === 'none') {
    io.out('next version: none (nothing under [Unreleased] asks for a release)')
  } else if (!previous?.version) {
    io.out('next version: any (no release has been published yet)')
  } else {
    io.out(`next version: ${formatVersion(minimumVersionFor(previous.version, impact))} or later`)
  }
}

function prepare(io: ReleaseIO, argument: string | undefined) {
  const version = argument ? parseVersion(argument) : null
  if (!argument || !version) {
    return fail('Give the version to prepare, like 0.3.0 or 0.3.0-rc.1 (no leading "v")')
  }
  const changelog = readChangelog(io)
  if (changelog.problems.length > 0) return fail(changelog.problems.join('\n'))
  const [unreleased, ...releases] = changelog.sections
  if (!unreleased || unreleased.name !== UNRELEASED) return fail(`${CHANGELOG} has no [Unreleased]`)

  const newest = releases.find((section) => section.version)
  if (newest?.version && compareVersions(version, newest.version) <= 0) {
    return fail(`${argument} must be newer than the newest release, ${newest.name}`)
  }

  // The stable release replaces its candidates: their entries are part of it.
  const candidates = isPrerelease(version)
    ? []
    : releases.filter(
        (section) =>
          section.version &&
          isPrerelease(section.version) &&
          compareCore(section.version, version) === 0,
      )
  const merged = mergeBlocks([...candidates.reverse(), unreleased])
  const impact = entriesImpact(merged)
  if (impact === 'none') return fail(`There is nothing to release under [${UNRELEASED}]`)

  const previous = newestStable(releases)
  if (previous?.version && !meetsImpact(previous.version, version, impact)) {
    const minimum = formatVersion(minimumVersionFor(previous.version, impact))
    return fail(
      `${argument} is too small: the entries are ${impact} changes after ${previous.name}, ` +
        `so the version has to be at least ${minimum}`,
    )
  }
  if (entryCount(merged, 'Breaking') > 0 && !merged.get(UPGRADE_NOTES_HEADING)?.length) {
    return fail(
      `There are breaking changes: add "### ${UPGRADE_NOTES_HEADING}" under [${UNRELEASED}]`,
    )
  }

  const kept = releases.filter((section) => !candidates.includes(section))
  const text = [
    changelog.preamble.trimEnd(),
    renderSection(UNRELEASED, null, new Map()),
    renderSection(argument, io.today(), merged),
    ...kept.map((section) => section.raw),
  ].join('\n\n')
  io.write(CHANGELOG, `${text}\n`)
  setPackageVersions(io, argument)
  io.out(`Prepared ${argument} (${impact}).`)
  io.out('Review the diff, commit it in a pull request, merge it and tag the merge commit.')
}

function notes(io: ReleaseIO, argument: string | undefined) {
  const changelog = readChangelog(io)
  const section = changelog.sections.find((candidate) => candidate.name === argument)
  const version = argument ? parseVersion(argument) : null
  if (!section || !version) return fail(`${CHANGELOG} has no release ${argument ?? ''}`)

  const footer = [
    '---',
    '',
    `**Image:** \`${IMAGE_REPOSITORY}:${argument}\``,
    '',
    isPrerelease(version)
      ? '**This is a release candidate**, for testing. It is not a stable release: ' +
        'the in-app update check and the `latest` and `X.Y` image tags ignore it.'
      : `**Updating:** take a backup first, then follow the [update guide](${UPDATE_GUIDE_URL}). ` +
        'Going back to an earlier image can require restoring that backup.',
  ]
  io.out([sectionBody(section), '', ...footer].join('\n'))
}

function plan(io: ReleaseIO, args: readonly string[]) {
  const event = option(args, '--event')
  const ref = option(args, '--ref')
  const sha = option(args, '--sha')
  if (!event || !ref || !sha) return fail('plan needs --event, --ref and --sha')

  const root = readPackageVersions(io).versions.get('package.json') ?? ''
  // A release is only published if everything about it agrees.
  const problems = ref.startsWith('refs/tags/')
    ? checkRelease(io, ref.slice('refs/tags/'.length))
    : checkRelease(io)
  if (problems.length > 0) return fail(problems.join('\n'))

  const result = planPublish({ event, ref, sha, version: root, tags: io.tags() })
  io.out(`publish=${result.publish}`)
  io.out(`channel=${result.channel}`)
  io.out(`version=${result.version}`)
  io.out(`prerelease=${result.prerelease}`)
  io.out(`latest=${result.latest}`)
  io.out(`exact_tags=${result.exactTags.join(' ')}`)
  io.out(`channel_tags=${result.channelTags.join(' ')}`)
}

/** Runs one command. Returns the exit code. */
export async function run(args: readonly string[], io: ReleaseIO): Promise<number> {
  const [command, ...rest] = args
  try {
    switch (command) {
      case 'check': {
        const problems = checkRelease(io, option(rest, '--tag'))
        if (problems.length > 0) {
          for (const problem of problems) io.err(`✗ ${problem}`)
          return 1
        }
        const version = readPackageVersions(io).versions.get('package.json')
        io.out(`✓ ${version}: package versions and ${CHANGELOG} agree`)
        return 0
      }
      case 'next':
        next(io)
        return 0
      case 'prepare':
        prepare(io, rest[0])
        return 0
      case 'notes':
        notes(io, rest[0])
        return 0
      case 'plan':
        plan(io, rest)
        return 0
      default:
        io.err(USAGE)
        return command ? 2 : 0
    }
  } catch (error) {
    if (!(error instanceof ReleaseError)) throw error
    io.err(`✗ ${error.message}`)
    return 1
  }
}
