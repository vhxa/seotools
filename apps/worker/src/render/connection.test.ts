import { EventEmitter } from 'node:events'
import { beforeEach, expect, it, vi } from 'vitest'
import type { RenderStatus } from '@seotools/core'
import { createBrowserConnection } from './connection'

const mocks = vi.hoisted(() => ({ connect: vi.fn(), isolation: vi.fn() }))
vi.mock('./transport', () => ({ connectBrowser: mocks.connect }))
vi.mock('./isolation', () => ({ checkIsolation: mocks.isolation }))
beforeEach(() => vi.resetAllMocks())

function fixture() {
  const browser = Object.assign(new EventEmitter(), {
    connected: true,
    createBrowserContext: vi.fn().mockResolvedValue({ close: vi.fn() }),
    disconnect: vi.fn(),
  })
  mocks.connect.mockResolvedValue({ browser, identity: 'instance', localAddress: '127.0.0.1' })
  mocks.isolation.mockImplementation(async () => ({
    state: 'ready',
    checkedAt: new Date().toISOString(),
  }))
  const statuses: RenderStatus[] = []
  const connection = createBrowserConnection('http://browser:9222', async (status) => {
    statuses.push(status)
  })
  return { browser, statuses, connection }
}

it('persists unreachable before a failed connection returns to the caller', async () => {
  const { connection, statuses } = fixture()
  await connection.check()
  mocks.connect.mockRejectedValue(new Error('secret endpoint error'))
  await expect(connection.get()).rejects.toThrow('secret endpoint error')
  expect(statuses.at(-1)).toMatchObject({ state: 'unreachable' })
  expect(statuses.at(-1)?.detail).not.toContain('secret')
})

it('persists unreachable on an unexpected disconnection of a verified lease', async () => {
  const { connection, statuses, browser } = fixture()
  await connection.get()
  browser.emit('disconnected')
  await vi.waitFor(() => expect(statuses.at(-1)?.state).toBe('unreachable'))
  await connection.get()
  expect(mocks.isolation).toHaveBeenCalledTimes(2)
  await connection.release(browser as never)
  expect(statuses.at(-1)?.state).toBe('ready')
})

it('ignores missing targets and throwing disconnects while releasing a severed lease', async () => {
  const { connection, browser } = fixture()
  browser.createBrowserContext.mockResolvedValue({ id: 'owned-context', close: vi.fn() })
  await connection.get()
  browser.connected = false
  const disconnect = vi.fn().mockRejectedValue(new Error('disconnect failed'))
  mocks.connect.mockResolvedValue({
    browser: {
      target: () => ({
        createCDPSession: () => {
          throw new Error('No target with given id found')
        },
      }),
      disconnect,
    },
  })
  browser.disconnect.mockRejectedValue(new Error('already disconnected'))
  await expect(connection.release(browser as never)).resolves.toBeUndefined()
  expect(disconnect).toHaveBeenCalledOnce()
  expect(browser.disconnect).toHaveBeenCalledOnce()
})
