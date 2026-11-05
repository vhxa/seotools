import {
  compareVersions,
  formatVersion,
  isPrerelease,
  parseTag,
  type BuildChannel,
  type ParsedVersion,
} from '../version.ts'

/**
 * What the Docker workflow publishes for a push. The meaning of each tag is in
 * `docs/updating.md`; this decides them, and `docker.yml` only does what it is told.
 */

export interface ImageTags {
  /** Published first, checked, and never moved afterwards. */
  exact: string[]
  /** Moved to the checked image once it passes: the channels that follow releases. */
  channels: string[]
}

/**
 * - `X.Y.Z`: that release, forever.
 * - `X.Y`: the newest patch of a minor version.
 * - `X`: the newest release of a major version, from 1.0.0 on. There is no `0`: while the major
 *   version is 0 a minor release can break things, so no tag may promise to follow them.
 * - `latest`: the newest stable release of all.
 *
 * A channel only moves to a release that is the newest of its own scope, so publishing 0.1.5
 * after 0.2.0 does not take `latest` back. Candidates (`0.2.0-rc.1`) get their exact tag only.
 */
export function imageTagsFor(version: ParsedVersion, known: readonly ParsedVersion[]): ImageTags {
  const exact = [formatVersion(version)]
  if (isPrerelease(version)) return { exact, channels: [] }

  const others = known.filter(
    (other) => !isPrerelease(other) && compareVersions(other, version) !== 0,
  )
  const newestIn = (scope: (other: ParsedVersion) => boolean) =>
    !others.some((other) => scope(other) && compareVersions(other, version) > 0)

  const channels: string[] = []
  if (newestIn((o) => o.major === version.major && o.minor === version.minor)) {
    channels.push(`${version.major}.${version.minor}`)
  }
  if (version.major >= 1 && newestIn((o) => o.major === version.major)) {
    channels.push(String(version.major))
  }
  if (newestIn(() => true)) channels.push('latest')
  return { exact, channels }
}

export interface PublishPlan {
  /** Whether the images are pushed to the registry. A pull request only builds. */
  publish: boolean
  channel: BuildChannel
  version: string
  /** The tag was a candidate, so the GitHub release is marked as a pre-release. */
  prerelease: boolean
  /** The GitHub release is the one marked "latest". */
  latest: boolean
  exactTags: string[]
  channelTags: string[]
}

export interface PlanInput {
  event: string
  ref: string
  sha: string
  /** The version in `package.json`. */
  version: string
  /** Every tag of the repository (`v0.2.0`…), the one being published included. */
  tags: readonly string[]
}

const SHORT_SHA = 7

/**
 * - a `vX.Y.Z` tag publishes a release, and its tag has to be the version of the code;
 * - `main` publishes a development build (`edge` and `sha-…`), never a release tag;
 * - anything else (a pull request, another branch) only builds.
 */
export function planPublish(input: PlanInput): PublishPlan {
  const known = input.tags.flatMap((tag) => parseTag(tag) ?? [])

  if (input.ref.startsWith('refs/tags/')) {
    const name = input.ref.slice('refs/tags/'.length)
    const tagged = parseTag(name)
    if (!tagged) throw new Error(`The tag "${name}" is not a version like v1.2.3 or v1.2.3-rc.1`)
    if (`v${input.version}` !== name) {
      throw new Error(
        `The tag ${name} does not match the version in package.json (${input.version}). ` +
          'Run "node scripts/release.mjs prepare" in a pull request, merge it, and tag that commit.',
      )
    }
    const tags = imageTagsFor(tagged, known)
    return {
      publish: true,
      channel: 'release',
      version: input.version,
      prerelease: isPrerelease(tagged),
      latest: tags.channels.includes('latest'),
      exactTags: tags.exact,
      channelTags: tags.channels,
    }
  }

  const onMain = input.ref === 'refs/heads/main' && input.event !== 'pull_request'
  return {
    publish: onMain,
    channel: 'development',
    version: input.version,
    prerelease: false,
    latest: false,
    exactTags: onMain ? [`sha-${input.sha.slice(0, SHORT_SHA)}`] : [],
    channelTags: onMain ? ['edge'] : [],
  }
}
