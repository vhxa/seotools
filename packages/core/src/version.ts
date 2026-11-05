/**
 * The version policy of SEO Tools (`docs/releases.md`). This file imports nothing on purpose: the
 * app, its tests and `scripts/release.mjs` (which Node runs without a build step) all use it.
 */

export interface ParsedVersion {
  major: number
  minor: number
  patch: number
  /** The dot-separated identifiers after the hyphen; empty for a stable version. */
  prerelease: string[]
}

const MAX_VERSION_LENGTH = 64
const NUMBER = /^(?:0|[1-9][0-9]{0,8})$/
const IDENTIFIER = /^[0-9A-Za-z-]+$/
const DIGITS = /^[0-9]+$/
const NUMERIC_IDENTIFIER = /^(?:0|[1-9][0-9]*)$/

function isIdentifier(value: string) {
  if (!IDENTIFIER.test(value)) return false
  // A number without leading zeros, like semver says; `rc`, `rc-1` and `x7` are words.
  return !DIGITS.test(value) || NUMERIC_IDENTIFIER.test(value)
}

/**
 * Reads `MAJOR.MINOR.PATCH` or `MAJOR.MINOR.PATCH-prerelease` (`0.2.0-rc.1`). Anything else is
 * `null`: no leading `v`, no build metadata, no missing parts. Input is bounded and read without
 * backtracking, because release data comes from outside.
 */
export function parseVersion(input: string): ParsedVersion | null {
  if (input.length === 0 || input.length > MAX_VERSION_LENGTH) return null
  const hyphen = input.indexOf('-')
  const numbers = (hyphen === -1 ? input : input.slice(0, hyphen)).split('.')
  if (numbers.length !== 3 || !numbers.every((part) => NUMBER.test(part))) return null
  const [major, minor, patch] = numbers.map(Number)
  if (major === undefined || minor === undefined || patch === undefined) return null

  let prerelease: string[] = []
  if (hyphen !== -1) {
    prerelease = input.slice(hyphen + 1).split('.')
    if (!prerelease.every(isIdentifier)) return null
  }
  return { major, minor, patch, prerelease }
}

/** Reads a Git tag: `v` followed by a version. */
export function parseTag(tag: string): ParsedVersion | null {
  return tag.startsWith('v') ? parseVersion(tag.slice(1)) : null
}

export function formatVersion(version: ParsedVersion): string {
  const core = `${version.major}.${version.minor}.${version.patch}`
  return version.prerelease.length > 0 ? `${core}-${version.prerelease.join('.')}` : core
}

/** A candidate (`0.2.0-rc.1`): not a stable release, and older than `0.2.0`. */
export const isPrerelease = (version: ParsedVersion) => version.prerelease.length > 0

const sign = (n: number) => (n < 0 ? -1 : n > 0 ? 1 : 0)

function compareIdentifiers(a: string, b: string): number {
  const aNumeric = DIGITS.test(a)
  const bNumeric = DIGITS.test(b)
  if (aNumeric && bNumeric) return sign(a.length - b.length) || sign(a < b ? -1 : a > b ? 1 : 0)
  // Numbers come before words.
  if (aNumeric !== bNumeric) return aNumeric ? -1 : 1
  return a < b ? -1 : a > b ? 1 : 0
}

/** Only `MAJOR.MINOR.PATCH`, ignoring any prerelease. */
export function compareCore(a: ParsedVersion, b: ParsedVersion): number {
  return sign(a.major - b.major) || sign(a.minor - b.minor) || sign(a.patch - b.patch)
}

/** Semantic Versioning precedence: negative when `a` is older than `b`. */
export function compareVersions(a: ParsedVersion, b: ParsedVersion): number {
  const core = compareCore(a, b)
  if (core !== 0) return core
  if (!isPrerelease(a) || !isPrerelease(b)) {
    // A stable release comes after its own candidates.
    return sign(Number(!isPrerelease(a)) - Number(!isPrerelease(b)))
  }
  const length = Math.max(a.prerelease.length, b.prerelease.length)
  for (let i = 0; i < length; i++) {
    const left = a.prerelease[i]
    const right = b.prerelease[i]
    if (left === undefined) return -1
    if (right === undefined) return 1
    const order = compareIdentifiers(left, right)
    if (order !== 0) return order
  }
  return 0
}

/** Compares two version strings. `null` when either is not a version. */
export function compareVersionStrings(a: string, b: string): number | null {
  const left = parseVersion(a)
  const right = parseVersion(b)
  return left && right ? compareVersions(left, right) : null
}

export type VersionChange = 'major' | 'minor' | 'patch' | 'prerelease'

/** The biggest part that differs between two versions. */
export function versionChange(from: ParsedVersion, to: ParsedVersion): VersionChange {
  if (from.major !== to.major) return 'major'
  if (from.minor !== to.minor) return 'minor'
  if (from.patch !== to.patch) return 'patch'
  return 'prerelease'
}

/**
 * Versions of one line promise to be updates of each other that do not break anything: `0.Y`
 * while the major version is 0 (a minor release may break), `X` from 1.0.0 on.
 */
export function compatibilityLine(version: ParsedVersion): string {
  return version.major === 0 ? `0.${version.minor}` : String(version.major)
}

/** Whether moving from one version to the other leaves the line that promises compatibility. */
export function crossesCompatibilityLine(from: ParsedVersion, to: ParsedVersion): boolean {
  return compatibilityLine(from) !== compatibilityLine(to)
}

// --- What a build says it is ---------------------------------------------------------------------

export const BUILD_CHANNELS = ['release', 'development'] as const
/**
 * `release`: built by the release workflow from a `vX.Y.Z` tag. `development`: everything else
 * (`main`, a pull request, a local build). It is the only way to tell them apart: the version of
 * a development build is that of the last release it descends from.
 */
export type BuildChannel = (typeof BUILD_CHANNELS)[number]

export interface BuildInfo {
  version: string
  channel: BuildChannel
  /** The commit the build was made from, when the build says so. */
  commit: string | null
}

export type BuildKind = 'release' | 'candidate' | 'development'

/** A release, a release candidate or a development build; a version nobody published is the last. */
export function buildKind(build: BuildInfo): BuildKind {
  const version = parseVersion(build.version)
  if (build.channel === 'development' || !version) return 'development'
  return isPrerelease(version) ? 'candidate' : 'release'
}

// --- What a change does to the next version ------------------------------------------------------

export const RELEASE_IMPACTS = ['none', 'patch', 'minor', 'breaking'] as const
/** `none`: not worth a release by itself (docs, tests, CI, refactors without visible change). */
export type ReleaseImpact = (typeof RELEASE_IMPACTS)[number]

export const maxImpact = (impacts: readonly ReleaseImpact[]): ReleaseImpact =>
  impacts.reduce<ReleaseImpact>(
    (highest, impact) =>
      RELEASE_IMPACTS.indexOf(impact) > RELEASE_IMPACTS.indexOf(highest) ? impact : highest,
    'none',
  )

/**
 * The oldest version a release with this impact can have after `previous`: a breaking change is a
 * major release from 1.0.0, and a minor one while the major version is 0.
 */
export function minimumVersionFor(
  previous: ParsedVersion,
  impact: Exclude<ReleaseImpact, 'none'>,
): ParsedVersion {
  const { major, minor, patch } = previous
  switch (impact) {
    case 'patch':
      return { major, minor, patch: patch + 1, prerelease: [] }
    case 'minor':
      return { major, minor: minor + 1, patch: 0, prerelease: [] }
    case 'breaking':
      return major === 0
        ? { major, minor: minor + 1, patch: 0, prerelease: [] }
        : { major: major + 1, minor: 0, patch: 0, prerelease: [] }
  }
}

/** Whether `next` is big enough for what changed since `previous` (a candidate of it counts). */
export function meetsImpact(
  previous: ParsedVersion,
  next: ParsedVersion,
  impact: Exclude<ReleaseImpact, 'none'>,
): boolean {
  return compareCore(next, minimumVersionFor(previous, impact)) >= 0
}
