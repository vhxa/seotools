import { expect, it, vi } from 'vitest'
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
it('preserves outcomes and crash retries when release throws', async () => {
  const outcome = { status: 'rendered', html: 'retained' } as RenderOutcome
  const service = createRenderService({ concurrency: 1, writeStatus: async () => {} })
  mocks.release.mockRejectedValue(new Error('Target.attachToTarget: No target with given id found'))
  mocks.render.mockResolvedValueOnce(outcome)
  expect(await service.render({ signal: new AbortController().signal } as RenderInput)).toBe(
    outcome,
  )
  mocks.render
    .mockRejectedValueOnce(new RenderInterruptedError('crash'))
    .mockResolvedValueOnce(outcome)
  expect(await service.render({ signal: new AbortController().signal } as RenderInput)).toBe(
    outcome,
  )
  expect(mocks.render).toHaveBeenCalledTimes(3)
})
it('rejects concurrency above four', () => {
  expect(() => createRenderService({ concurrency: 5, writeStatus: async () => {} })).toThrow(
    'Invalid render concurrency',
  )
})
