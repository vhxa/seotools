import { z } from 'zod'
import { RELEASES_REPOSITORY } from './repository'
import type { Settings } from './settings'
import {
  buildKind,
  compareVersions,
  crossesCompatibilityLine,
  parseTag,
  parseVersion,
  versionChange,
  type BuildInfo,
  type VersionChange,
} from './version'

/**
 * Looking for a new version of SEO Tools. It only asks where releases are announced; installing
 * one is up to whoever runs the container (docs/updating.md), never up to the app.
 *
 * The request carries nothing about the instance: no domains, no installed version, no
 * identifier, and a fixed User-Agent. The release feed sees the address the server connects from,
 * like any other website would.
 */

export const LATEST_RELEASE_URL = `https://api.github.com/repos/${RELEASES_REPOSITORY}/releases/latest`

/** Built from the version, never taken from the response, so that only this repository is linked. */
export const releaseNotesUrl = (version: string) =>
  `https://github.com/${RELEASES_REPOSITORY}/releases/tag/v${version}`

const USER_AGENT = 'seotools-update-check'
export const UPDATE_CHECK_TIMEOUT_MS = 10_000
const MAX_RESPONSE_BYTES = 1024 * 1024

/** Looked for again this long after the last attempt, when periodic checks are on. */
export const UPDATE_CHECK_INTERVAL_MS = 24 * 60 * 60_000
/** After a failed attempt: soon enough to recover, not so often that an outage becomes traffic. */
export const UPDATE_RETRY_INTERVAL_MS = 60 * 60_000

export const UPDATE_CONFIG_KEY = 'updates.config'
export const UPDATE_STATE_KEY = 'updates.state'

// --- What is stored -------------------------------------------------------------------------------

/**
 * Off until an administrator turns it on: an instance does not contact anyone it was not told to.
 * (Checking by hand is always possible.)
 */
export const DEFAULT_UPDATE_CONFIG = { periodicChecks: false }
export const updateConfigSchema = z.object({ periodicChecks: z.boolean() })
export type UpdateConfig = z.infer<typeof updateConfigSchema>

/** Why a check failed. Codes, not text: they are shown translated. */
export const UPDATE_FAILURES = [
  'network',
  'timeout',
  'rate-limited',
  'not-found',
  'http',
  'invalid-response',
] as const
export type UpdateFailure = (typeof UPDATE_FAILURES)[number]

export type UpdateTrigger = 'manual' | 'periodic'

const timestamp = z.string().refine((value) => !Number.isNaN(Date.parse(value)))
const stableVersion = z.string().refine((value) => {
  const parsed = parseVersion(value)
  return parsed !== null && parsed.prerelease.length === 0
})

export const updateStateSchema = z.object({
  /** The last time anyone looked, and whether it worked. */
  attempt: z
    .object({
      at: timestamp,
      trigger: z.enum(['manual', 'periodic']),
      failure: z.enum(UPDATE_FAILURES).nullable(),
    })
    .nullable(),
  /** The newest stable release the last *successful* check saw. A failure does not erase it. */
  latest: z
    .object({
      version: stableVersion,
      publishedAt: timestamp.nullable(),
      checkedAt: timestamp,
    })
    .nullable(),
})
export type UpdateState = z.infer<typeof updateStateSchema>

export const EMPTY_UPDATE_STATE: UpdateState = { attempt: null, latest: null }

export async function loadUpdateConfig(settings: Settings): Promise<UpdateConfig> {
  try {
    return (await settings.getJson(UPDATE_CONFIG_KEY, updateConfigSchema)) ?? DEFAULT_UPDATE_CONFIG
  } catch {
    // Unreadable settings count as unset: this is never a reason to break a page.
    return DEFAULT_UPDATE_CONFIG
  }
}

export function saveUpdateConfig(settings: Settings, config: UpdateConfig) {
  return settings.setJson(UPDATE_CONFIG_KEY, config)
}

export async function loadUpdateState(settings: Settings): Promise<UpdateState> {
  try {
    return (await settings.getJson(UPDATE_STATE_KEY, updateStateSchema)) ?? EMPTY_UPDATE_STATE
  } catch {
    return EMPTY_UPDATE_STATE
  }
}

// --- Asking ---------------------------------------------------------------------------------------

export interface LatestRelease {
  version: string
  publishedAt: string | null
}

export type LatestReleaseResult =
  { ok: true; release: LatestRelease } | { ok: false; failure: UpdateFailure }

const releaseSchema = z.object({
  tag_name: z.string(),
  draft: z.boolean(),
  prerelease: z.boolean(),
  published_at: z.string().nullable(),
})

/** Reads at most `limit` bytes; `null` when the body is bigger. */
async function readLimited(response: Response, limit: number): Promise<string | null> {
  const declared = Number(response.headers.get('content-length'))
  if (Number.isFinite(declared) && declared > limit) return null
  if (!response.body) return null
  const reader = response.body.getReader()
  const chunks: Uint8Array[] = []
  let size = 0
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    size += value.byteLength
    if (size > limit) {
      await reader.cancel()
      return null
    }
    chunks.push(value)
  }
  return Buffer.concat(chunks).toString('utf8')
}

/**
 * Asks GitHub for the latest stable release: published, not a draft, not a candidate. Never
 * throws; a failure comes back as a code.
 */
export async function fetchLatestRelease(
  fetchImpl: typeof fetch = fetch,
): Promise<LatestReleaseResult> {
  let response: Response
  try {
    response = await fetchImpl(LATEST_RELEASE_URL, {
      headers: {
        accept: 'application/vnd.github+json',
        'user-agent': USER_AGENT,
        'x-github-api-version': '2022-11-28',
      },
      signal: AbortSignal.timeout(UPDATE_CHECK_TIMEOUT_MS),
    })
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    return {
      ok: false,
      failure: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network',
    }
  }

  if (response.status === 404) return { ok: false, failure: 'not-found' }
  if (response.status === 429) return { ok: false, failure: 'rate-limited' }
  if (response.status === 403 && response.headers.get('x-ratelimit-remaining') === '0') {
    return { ok: false, failure: 'rate-limited' }
  }
  if (!response.ok) return { ok: false, failure: 'http' }

  let payload: unknown
  try {
    const text = await readLimited(response, MAX_RESPONSE_BYTES)
    if (text === null) return { ok: false, failure: 'invalid-response' }
    payload = JSON.parse(text)
  } catch (error) {
    const name = error instanceof Error ? error.name : ''
    return {
      ok: false,
      failure: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'invalid-response',
    }
  }

  const parsed = releaseSchema.safeParse(payload)
  if (!parsed.success || parsed.data.draft || parsed.data.prerelease) {
    return { ok: false, failure: 'invalid-response' }
  }
  const version = parseTag(parsed.data.tag_name)
  const publishedAt = parsed.data.published_at
  if (!version || version.prerelease.length > 0) return { ok: false, failure: 'invalid-response' }
  if (publishedAt !== null && Number.isNaN(Date.parse(publishedAt))) {
    return { ok: false, failure: 'invalid-response' }
  }
  return {
    ok: true,
    release: { version: parsed.data.tag_name.slice(1), publishedAt },
  }
}

/** What the state is after an attempt: a failure keeps the last release that was seen. */
export function applyCheck(
  previous: UpdateState,
  result: LatestReleaseResult,
  trigger: UpdateTrigger,
  now: Date,
): UpdateState {
  const at = now.toISOString()
  if (!result.ok) {
    return { attempt: { at, trigger, failure: result.failure }, latest: previous.latest }
  }
  return {
    attempt: { at, trigger, failure: null },
    latest: { ...result.release, checkedAt: at },
  }
}

/** Asks and stores what it learnt. The one place that does both, for the web app and the worker. */
export async function checkForUpdates(
  settings: Settings,
  options: { trigger: UpdateTrigger; now?: Date; fetch?: typeof fetch },
): Promise<UpdateState> {
  const previous = await loadUpdateState(settings)
  const result = await fetchLatestRelease(options.fetch)
  const next = applyCheck(previous, result, options.trigger, options.now ?? new Date())
  await settings.setJson(UPDATE_STATE_KEY, next)
  return next
}

/** Whether the worker should look now. A check made by hand also counts as the last one. */
export function periodicCheckDue(config: UpdateConfig, state: UpdateState, now: Date): boolean {
  if (!config.periodicChecks) return false
  if (!state.attempt) return true
  const elapsed = now.getTime() - Date.parse(state.attempt.at)
  // A clock that went back must not silence the checks until it catches up.
  if (elapsed < 0) return true
  return elapsed >= (state.attempt.failure ? UPDATE_RETRY_INTERVAL_MS : UPDATE_CHECK_INTERVAL_MS)
}

// --- Telling what it means ------------------------------------------------------------------------

export type UpdateStatusKind =
  'development' | 'not-checked' | 'check-failed' | 'update-available' | 'up-to-date'

export interface UpdateStatus {
  kind: UpdateStatusKind
  /** The newest stable release known, even if the last attempt failed. */
  latest: NonNullable<UpdateState['latest']> | null
  failure: UpdateFailure | null
  /** For `update-available`: the biggest part of the version that changes. */
  change: VersionChange | null
  /** For `update-available`: the update leaves the line that promises to be compatible. */
  mayBreak: boolean
  /** For `up-to-date`: the installed version is newer than the latest stable (a candidate). */
  ahead: boolean
}

/**
 * Decides what to tell the administrator. Not being able to check is never "up to date", and a
 * development build is never compared: its version is that of the release it descends from.
 */
export function evaluateUpdate(build: BuildInfo, state: UpdateState): UpdateStatus {
  const base = { latest: state.latest, failure: null, change: null, mayBreak: false, ahead: false }
  if (buildKind(build) === 'development') return { ...base, kind: 'development' }
  if (!state.attempt) return { ...base, kind: 'not-checked' }
  if (state.attempt.failure) {
    return { ...base, kind: 'check-failed', failure: state.attempt.failure }
  }

  const installed = parseVersion(build.version)
  const latest = state.latest ? parseVersion(state.latest.version) : null
  if (!installed || !latest) return { ...base, kind: 'not-checked' }

  const order = compareVersions(installed, latest)
  if (order < 0) {
    return {
      ...base,
      kind: 'update-available',
      change: versionChange(installed, latest),
      mayBreak: crossesCompatibilityLine(installed, latest),
    }
  }
  return { ...base, kind: 'up-to-date', ahead: order > 0 }
}
