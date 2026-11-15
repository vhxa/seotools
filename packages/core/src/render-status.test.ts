import { describe, expect, it } from 'vitest'
import { readRenderStatus, renderStatusSchema, RENDER_STATUS_STALE_MS } from './render-status'
import { parseWorkerEnv } from './env'

const now = Date.parse('2026-11-13T12:00:00Z')
const status = {
  state: 'ready',
  checkedAt: new Date(now).toISOString(),
  version: 'Chrome/158.0.8127.18',
}
describe('render browser contract', () => {
  it('accepts the states and rejects malformed, future and stale observations', () => {
    for (const state of [
      'ready',
      'not-configured',
      'unreachable',
      'has-network',
      'unsafe-configuration',
      'too-old',
    ])
      expect(readRenderStatus({ ...status, state }, now)?.state).toBe(state)
    for (const bad of [
      null,
      {},
      { ...status, state: 'connected' },
      { ...status, detail: 'x'.repeat(201) },
    ])
      expect(readRenderStatus(bad, now)).toBeNull()
    expect(readRenderStatus(status, now + RENDER_STATUS_STALE_MS)).toBeNull()
    expect(readRenderStatus(status, now - 1)).toBeNull()
    expect(renderStatusSchema.safeParse({ ...status, version: 'x'.repeat(101) }).success).toBe(
      false,
    )
  })
  it('defaults to no browser and two pages, and bounds endpoint and concurrency', () => {
    const base = { BETTER_AUTH_SECRET: 'x'.repeat(32) }
    expect(parseWorkerEnv(base)).toMatchObject({ RENDER_CONCURRENCY: 2 })
    expect(parseWorkerEnv(base).RENDER_BROWSER_URL).toBeUndefined()
    for (const RENDER_BROWSER_URL of ['http://browser:9222', 'https://browser:9222/'])
      expect(parseWorkerEnv({ ...base, RENDER_BROWSER_URL }).RENDER_BROWSER_URL).toBe(
        RENDER_BROWSER_URL,
      )
    for (const RENDER_BROWSER_URL of [
      'ws://browser:9222',
      'file:///tmp/a',
      'http://user:secret@browser:9222',
      'http://browser:9222/path',
      'http://browser:9222?token=x',
    ])
      expect(() => parseWorkerEnv({ ...base, RENDER_BROWSER_URL })).toThrow()
    for (const RENDER_CONCURRENCY of ['0', '9', '-1', '1.5'])
      expect(() => parseWorkerEnv({ ...base, RENDER_CONCURRENCY })).toThrow()
  })
})
