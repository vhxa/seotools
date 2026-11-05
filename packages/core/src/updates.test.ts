import { describe, expect, it, vi } from 'vitest'
import { createSettings, type SettingsStore, type StoredSetting } from './settings'
import {
  DEFAULT_UPDATE_CONFIG,
  EMPTY_UPDATE_STATE,
  LATEST_RELEASE_URL,
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_CONFIG_KEY,
  UPDATE_RETRY_INTERVAL_MS,
  UPDATE_STATE_KEY,
  applyCheck,
  checkForUpdates,
  evaluateUpdate,
  fetchLatestRelease,
  loadUpdateConfig,
  loadUpdateState,
  periodicCheckDue,
  releaseNotesUrl,
  saveUpdateConfig,
  type UpdateFailure,
  type UpdateState,
} from './updates'
import type { BuildInfo } from './version'

const KEY = 'k'.repeat(32)
const now = new Date('2026-11-04T12:00:00.000Z')

function memoryStore() {
  const rows = new Map<string, StoredSetting>()
  const store: SettingsStore = {
    get: async (key) => rows.get(key) ?? null,
    set: async (key, value, encrypted) => void rows.set(key, { value, encrypted }),
    delete: async (key) => void rows.delete(key),
  }
  return { rows, settings: createSettings(store, KEY) }
}

const release = (overrides: Record<string, unknown> = {}) =>
  new Response(
    JSON.stringify({
      tag_name: 'v0.3.1',
      draft: false,
      prerelease: false,
      published_at: '2026-11-01T10:00:00Z',
      html_url: 'https://evil.example/releases/v0.3.1',
      body: 'notes',
      ...overrides,
    }),
    { status: 200 },
  )

describe('fetchLatestRelease', () => {
  it('reads the latest stable release', async () => {
    const fetchImpl = vi.fn(async () => release())
    const result = await fetchLatestRelease(fetchImpl as unknown as typeof fetch)
    expect(result).toEqual({
      ok: true,
      release: { version: '0.3.1', publishedAt: '2026-11-01T10:00:00Z' },
    })
  })

  it('sends nothing but a fixed, anonymous request', async () => {
    const fetchImpl = vi.fn(async (_url: string | URL | Request, _init?: RequestInit) => release())
    await fetchLatestRelease(fetchImpl as unknown as typeof fetch)
    const [url, init] = fetchImpl.mock.calls[0]!
    expect(url).toBe(LATEST_RELEASE_URL)
    expect(init?.method).toBeUndefined()
    expect(init?.body).toBeUndefined()
    const headers = new Headers(init?.headers)
    expect([...headers.keys()].sort()).toEqual(['accept', 'user-agent', 'x-github-api-version'])
    // No version, no host: the User-Agent is the same for every installation.
    expect(headers.get('user-agent')).toBe('seotools-update-check')
  })

  it.each([
    [new Response('', { status: 404 }), 'not-found'],
    [new Response('', { status: 429 }), 'rate-limited'],
    [new Response('', { status: 403, headers: { 'x-ratelimit-remaining': '0' } }), 'rate-limited'],
    [new Response('', { status: 403 }), 'http'],
    [new Response('', { status: 500 }), 'http'],
    [new Response('<html>not json</html>', { status: 200 }), 'invalid-response'],
    [new Response('[]', { status: 200 }), 'invalid-response'],
    [release({ draft: true }), 'invalid-response'],
    [release({ prerelease: true }), 'invalid-response'],
    [release({ tag_name: 'v0.4.0-rc.1' }), 'invalid-response'],
    [release({ tag_name: 'latest' }), 'invalid-response'],
    [release({ tag_name: '0.3.1' }), 'invalid-response'],
    [release({ published_at: 'yesterday' }), 'invalid-response'],
  ] as const)('is a failure, not "up to date", for %#', async (response, failure) => {
    const result = await fetchLatestRelease((async () => response) as unknown as typeof fetch)
    expect(result).toEqual({ ok: false, failure })
  })

  it('tells a timeout from a connection that never happened', async () => {
    const timeout = Object.assign(new Error('timed out'), { name: 'TimeoutError' })
    expect(
      await fetchLatestRelease((async () => {
        throw timeout
      }) as unknown as typeof fetch),
    ).toEqual({ ok: false, failure: 'timeout' })
    expect(
      await fetchLatestRelease((async () => {
        throw new TypeError('fetch failed')
      }) as unknown as typeof fetch),
    ).toEqual({ ok: false, failure: 'network' })
  })

  it('refuses a response that is too big', async () => {
    const big = new Response('x'.repeat(2 * 1024 * 1024), { status: 200 })
    expect(await fetchLatestRelease((async () => big) as unknown as typeof fetch)).toEqual({
      ok: false,
      failure: 'invalid-response',
    })
  })

  it('links release notes to this repository, whatever the response says', () => {
    expect(releaseNotesUrl('0.3.1')).toBe('https://github.com/vhxa/seotools/releases/tag/v0.3.1')
  })
})

describe('checking and storing', () => {
  it('stores the result of a check', async () => {
    const { settings } = memoryStore()
    const state = await checkForUpdates(settings, {
      trigger: 'manual',
      now,
      fetch: (async () => release()) as unknown as typeof fetch,
    })
    expect(state).toEqual({
      attempt: { at: now.toISOString(), trigger: 'manual', failure: null },
      latest: {
        version: '0.3.1',
        publishedAt: '2026-11-01T10:00:00Z',
        checkedAt: now.toISOString(),
      },
    })
    expect(await loadUpdateState(settings)).toEqual(state)
  })

  it('keeps the last release it saw when a check fails', async () => {
    const { settings } = memoryStore()
    await checkForUpdates(settings, {
      trigger: 'periodic',
      now,
      fetch: (async () => release()) as unknown as typeof fetch,
    })
    const later = new Date(now.getTime() + 3_600_000)
    const state = await checkForUpdates(settings, {
      trigger: 'manual',
      now: later,
      fetch: (async () => {
        throw new TypeError('fetch failed')
      }) as unknown as typeof fetch,
    })
    expect(state.attempt).toEqual({
      at: later.toISOString(),
      trigger: 'manual',
      failure: 'network',
    })
    expect(state.latest?.version).toBe('0.3.1')
    expect(state.latest?.checkedAt).toBe(now.toISOString())
  })

  it('does not store anything unencrypted that identifies the instance', async () => {
    const { settings, rows } = memoryStore()
    await checkForUpdates(settings, {
      trigger: 'manual',
      now,
      fetch: (async () => release()) as unknown as typeof fetch,
    })
    expect(rows.get(UPDATE_STATE_KEY)?.encrypted).toBe(false)
    expect(rows.get(UPDATE_STATE_KEY)?.value).not.toContain('evil.example')
  })

  it('treats unreadable settings as unset instead of breaking the page', async () => {
    const { settings, rows } = memoryStore()
    rows.set(UPDATE_CONFIG_KEY, { value: '{"periodicChecks":"yes"}', encrypted: false })
    rows.set(UPDATE_STATE_KEY, { value: 'not json', encrypted: false })
    expect(await loadUpdateConfig(settings)).toEqual(DEFAULT_UPDATE_CONFIG)
    expect(await loadUpdateState(settings)).toEqual(EMPTY_UPDATE_STATE)
  })

  it('is off by default and remembers what the administrator chose', async () => {
    const { settings } = memoryStore()
    expect(await loadUpdateConfig(settings)).toEqual({ periodicChecks: false })
    await saveUpdateConfig(settings, { periodicChecks: true })
    expect(await loadUpdateConfig(settings)).toEqual({ periodicChecks: true })
  })
})

describe('periodicCheckDue', () => {
  const on = { periodicChecks: true }
  const attempt = (ago: number, failure: UpdateFailure | null = null): UpdateState => ({
    attempt: { at: new Date(now.getTime() - ago).toISOString(), trigger: 'periodic', failure },
    latest: null,
  })

  it('never looks when the option is off', () => {
    expect(periodicCheckDue(DEFAULT_UPDATE_CONFIG, EMPTY_UPDATE_STATE, now)).toBe(false)
    expect(
      periodicCheckDue({ periodicChecks: false }, attempt(10 * UPDATE_CHECK_INTERVAL_MS), now),
    ).toBe(false)
  })

  it('looks at once the first time', () => {
    expect(periodicCheckDue(on, EMPTY_UPDATE_STATE, now)).toBe(true)
  })

  it('looks once a day after a good check', () => {
    expect(periodicCheckDue(on, attempt(UPDATE_CHECK_INTERVAL_MS - 1000), now)).toBe(false)
    expect(periodicCheckDue(on, attempt(UPDATE_CHECK_INTERVAL_MS), now)).toBe(true)
  })

  it('retries sooner, but not at once, after a failure', () => {
    expect(periodicCheckDue(on, attempt(60_000, 'network'), now)).toBe(false)
    expect(periodicCheckDue(on, attempt(UPDATE_RETRY_INTERVAL_MS, 'network'), now)).toBe(true)
  })

  it('counts a check made by hand as the last one', () => {
    const manual: UpdateState = {
      attempt: {
        at: new Date(now.getTime() - 1000).toISOString(),
        trigger: 'manual',
        failure: null,
      },
      latest: null,
    }
    expect(periodicCheckDue(on, manual, now)).toBe(false)
  })

  it('does not wait for a clock that went back', () => {
    expect(periodicCheckDue(on, attempt(-5 * UPDATE_CHECK_INTERVAL_MS), now)).toBe(true)
  })
})

describe('evaluateUpdate', () => {
  const build = (version: string, channel: BuildInfo['channel'] = 'release'): BuildInfo => ({
    version,
    channel,
    commit: null,
  })
  const ok = (latest: string): UpdateState =>
    applyCheck(
      EMPTY_UPDATE_STATE,
      { ok: true, release: { version: latest, publishedAt: null } },
      'manual',
      now,
    )
  const failed: UpdateState = applyCheck(
    ok('0.3.1'),
    { ok: false, failure: 'network' },
    'manual',
    now,
  )

  it('says it is up to date only when a check found nothing newer', () => {
    expect(evaluateUpdate(build('0.3.1'), ok('0.3.1')).kind).toBe('up-to-date')
    expect(evaluateUpdate(build('0.3.2'), ok('0.3.1'))).toMatchObject({
      kind: 'up-to-date',
      ahead: true,
    })
  })

  it('announces a newer release and says whether it may break', () => {
    expect(evaluateUpdate(build('0.3.0'), ok('0.3.4'))).toMatchObject({
      kind: 'update-available',
      change: 'patch',
      mayBreak: false,
    })
    expect(evaluateUpdate(build('0.3.4'), ok('0.4.0'))).toMatchObject({
      kind: 'update-available',
      change: 'minor',
      mayBreak: true,
    })
    expect(evaluateUpdate(build('1.4.0'), ok('1.5.0'))).toMatchObject({
      change: 'minor',
      mayBreak: false,
    })
    expect(evaluateUpdate(build('1.4.0'), ok('2.0.0'))).toMatchObject({
      change: 'major',
      mayBreak: true,
    })
  })

  it('offers the stable release to a candidate of it', () => {
    expect(evaluateUpdate(build('0.4.0-rc.2'), ok('0.4.0'))).toMatchObject({
      kind: 'update-available',
      change: 'prerelease',
    })
  })

  it('is never "up to date" when the check failed, and keeps what it knew', () => {
    const status = evaluateUpdate(build('0.3.1'), failed)
    expect(status).toMatchObject({ kind: 'check-failed', failure: 'network' })
    expect(status.latest?.version).toBe('0.3.1')
  })

  it('does not know anything before the first check', () => {
    expect(evaluateUpdate(build('0.3.1'), EMPTY_UPDATE_STATE).kind).toBe('not-checked')
  })

  it('never compares a development build', () => {
    for (const state of [EMPTY_UPDATE_STATE, ok('9.9.9'), failed]) {
      expect(evaluateUpdate(build('0.3.1', 'development'), state).kind).toBe('development')
    }
    expect(evaluateUpdate(build('unknown'), ok('9.9.9')).kind).toBe('development')
  })
})
