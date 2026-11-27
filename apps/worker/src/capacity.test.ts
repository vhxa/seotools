import { parseWorkerEnv } from '@seotools/core'
import { expect, it, vi } from 'vitest'
import { warnLegacyCapacity } from './capacity'

it('warns once about both obsolete variables regardless of their values', () => {
  const warn = vi.fn()
  const env = parseWorkerEnv({
    BETTER_AUTH_SECRET: 'x'.repeat(32),
    RENDER_CONCURRENCY: 'not a number',
    CRAWL_CONCURRENCY: '0',
  })
  warnLegacyCapacity({ warn }, [])
  warnLegacyCapacity({ warn }, env.legacyCapacityVariables)
  expect(warn).toHaveBeenCalledExactlyOnceWith(
    'RENDER_CONCURRENCY and CRAWL_CONCURRENCY have moved to Administration → Capacity and are ignored',
  )
})
