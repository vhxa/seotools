import { renderedOutcome } from '../crawl/render-fixture'
import { createSlots } from './slots'
import { beforeEach, expect, it, vi } from 'vitest'
import type { RenderInput, RenderOutcome } from './types'
import { RenderInterruptedError } from './types'
import { createRenderService } from './service'
const mocks = vi.hoisted(() => ({ render: vi.fn(), release: vi.fn() }))
vi.mock('./page', () => ({ renderPage: mocks.render }))
vi.mock('./connection', () => ({
  createBrowserConnection: () => ({
    get: async () => ({ browser: {}, context: {} }),
    release: mocks.release,
  }),
}))
beforeEach(() => {
  mocks.render.mockReset()
  mocks.release.mockReset().mockResolvedValue(undefined)
})

it('preserves outcomes and crash retries when release throws', async () => {
  const outcome = { status: 'rendered', html: 'retained', renderSlots: 1 } as RenderOutcome
  const service = createRenderService({ concurrency: 1, writeStatus: async () => {} })
  mocks.release.mockRejectedValue(new Error('Target.attachToTarget: No target with given id found'))
  mocks.render.mockResolvedValueOnce(outcome)
  expect(await service.render({ signal: new AbortController().signal } as RenderInput)).toEqual(
    outcome,
  )
  mocks.render
    .mockRejectedValueOnce(new RenderInterruptedError('crash'))
    .mockResolvedValueOnce(outcome)
  expect(await service.render({ signal: new AbortController().signal } as RenderInput)).toEqual(
    outcome,
  )
  expect(mocks.render).toHaveBeenCalledTimes(3)
})
it('rejects concurrency above eight', () => {
  expect(() => createRenderService({ concurrency: 9, writeStatus: async () => {} })).toThrow(
    'Invalid render concurrency',
  )
})

it('admits queued renders when limits grow, and drains in-flight renders when limits shrink', async () => {
  const gates: (() => void)[] = []
  mocks.render.mockImplementation(async (_browser: unknown, input: RenderInput) => {
    await new Promise<void>((resolve) => gates.push(resolve))
    return renderedOutcome(input)
  })
  const service = createRenderService({ concurrency: 1, writeStatus: async () => {} })
  const signal = new AbortController().signal
  const resources = createSlots(1)
  const untrack = service.trackResources(resources)
  const input = {
    url: 'https://example.test/',
    signal,
    document: { body: Buffer.from('<html></html>') },
  } as RenderInput

  const renders = Array.from({ length: 3 }, () => service.render(input))
  await vi.waitFor(() => expect(gates).toHaveLength(1))
  service.resize(2)
  await vi.waitFor(() => expect(gates).toHaveLength(2))
  await Promise.all(Array.from({ length: 12 }, () => resources.acquire(signal)))
  expect(resources.active).toBe(12)

  service.resize(1)
  const resource = resources.acquire(signal)
  expect(resources.waiting).toBe(1)
  for (let i = 0; i < 6; i++) resources.release()
  expect(resources.waiting).toBe(1)
  resources.release()
  await resource
  expect(resources.active).toBe(6)

  gates[0]!()
  expect((await renders[0])?.renderSlots).toBe(1)
  expect(gates).toHaveLength(2)
  gates[1]!()
  expect((await renders[1])?.renderSlots).toBe(2)
  await vi.waitFor(() => expect(gates).toHaveLength(3))
  gates[2]!()
  expect((await renders[2])?.renderSlots).toBe(1)
  expect(mocks.release).toHaveBeenCalledTimes(3)
  untrack()
})
