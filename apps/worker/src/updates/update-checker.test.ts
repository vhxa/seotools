import {
  UPDATE_CHECK_INTERVAL_MS,
  UPDATE_RETRY_INTERVAL_MS,
  createSettings,
  loadUpdateState,
  saveUpdateConfig,
  type Logger,
  type SettingsStore,
  type StoredSetting,
} from '@seotools/core'
import { describe, expect, it, vi } from 'vitest'
import { createUpdateChecker } from './update-checker'

const now = new Date('2026-11-04T12:00:00.000Z')

function setup(fetchImpl: typeof fetch) {
  const rows = new Map<string, StoredSetting>()
  const store: SettingsStore = {
    get: async (key) => rows.get(key) ?? null,
    set: async (key, value, encrypted) => void rows.set(key, { value, encrypted }),
    delete: async (key) => void rows.delete(key),
  }
  const settings = createSettings(store, 'k'.repeat(32))
  const log = { info: vi.fn(), error: vi.fn() } as unknown as Logger
  let clock = now
  const checker = createUpdateChecker({ settings, log, fetch: fetchImpl, now: () => clock })
  return {
    settings,
    log,
    checker,
    advance: (ms: number) => void (clock = new Date(clock.getTime() + ms)),
  }
}

const latest = () =>
  new Response(
    JSON.stringify({
      tag_name: 'v0.3.0',
      draft: false,
      prerelease: false,
      published_at: '2026-11-01T00:00:00Z',
    }),
  )

describe('createUpdateChecker', () => {
  it('does not contact anyone until periodic checks are turned on', async () => {
    const fetchImpl = vi.fn(async () => latest())
    const { checker, settings } = setup(fetchImpl as unknown as typeof fetch)

    await checker.tick()
    expect(fetchImpl).not.toHaveBeenCalled()
    expect((await loadUpdateState(settings)).attempt).toBeNull()
  })

  it('looks at once when turned on, then once a day', async () => {
    const fetchImpl = vi.fn(async () => latest())
    const { checker, settings, advance } = setup(fetchImpl as unknown as typeof fetch)
    await saveUpdateConfig(settings, { periodicChecks: true })

    await checker.tick()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    expect((await loadUpdateState(settings)).attempt).toMatchObject({
      trigger: 'periodic',
      failure: null,
    })

    // The worker ticks every 30 seconds; almost all of them do nothing.
    advance(30_000)
    await checker.tick()
    advance(UPDATE_CHECK_INTERVAL_MS - 60_000)
    await checker.tick()
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    advance(60_000)
    await checker.tick()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('stores a failure as one and retries sooner', async () => {
    const fetchImpl = vi.fn(async () => {
      throw new TypeError('fetch failed')
    })
    const { checker, settings, advance, log } = setup(fetchImpl as unknown as typeof fetch)
    await saveUpdateConfig(settings, { periodicChecks: true })

    await checker.tick()
    expect((await loadUpdateState(settings)).attempt).toMatchObject({ failure: 'network' })
    expect(log.error).not.toHaveBeenCalled()

    advance(UPDATE_RETRY_INTERVAL_MS - 1000)
    await checker.tick()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
    advance(1000)
    await checker.tick()
    expect(fetchImpl).toHaveBeenCalledTimes(2)
  })

  it('does not start a check twice at once, nor after being stopped', async () => {
    let release!: () => void
    const gate = new Promise<void>((resolve) => (release = resolve))
    const fetchImpl = vi.fn(async () => {
      await gate
      return latest()
    })
    const { checker, settings } = setup(fetchImpl as unknown as typeof fetch)
    await saveUpdateConfig(settings, { periodicChecks: true })

    const first = checker.tick()
    const second = checker.tick()
    release()
    await Promise.all([first, second])
    expect(fetchImpl).toHaveBeenCalledTimes(1)

    await checker.stop()
    await checker.tick()
    expect(fetchImpl).toHaveBeenCalledTimes(1)
  })
})

describe('createUpdateChecker when automation is paused', () => {
  it('never contacts anyone, even when a check is due', async () => {
    const fetchImpl = vi.fn(async () => latest())
    const rows = new Map<string, StoredSetting>()
    const settings = createSettings(
      {
        get: async (key) => rows.get(key) ?? null,
        set: async (key, value, encrypted) => void rows.set(key, { value, encrypted }),
        delete: async (key) => void rows.delete(key),
      },
      'k'.repeat(32),
    )
    await saveUpdateConfig(settings, { periodicChecks: true })
    const checker = createUpdateChecker({
      settings,
      log: { info: vi.fn(), error: vi.fn() } as unknown as Logger,
      fetch: fetchImpl as unknown as typeof fetch,
      now: () => now,
      paused: true,
    })
    await checker.tick()
    expect(fetchImpl).not.toHaveBeenCalled()
  })
})
