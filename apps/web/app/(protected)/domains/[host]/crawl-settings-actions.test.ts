import { DEFAULT_CRAWL_SETTINGS, RENDER_STATUS_KEY } from '@seotools/core'
import { createCompany } from '@seotools/db'
import { createTestDatabase } from '@seotools/db/test'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { newDomainCrawlSettings } from '@/lib/render-browser'
import { saveCrawlSettingsAction } from './actions'

const mocks = vi.hoisted(() => ({ getDb: vi.fn(), editor: vi.fn() }))
vi.mock('@/lib/db', () => ({ getDb: mocks.getDb }))
vi.mock('@/lib/env', () => ({ getEnv: () => ({ BETTER_AUTH_SECRET: 'test-render-settings' }) }))
vi.mock('@/lib/workspace', () => ({ requireDomainEditor: mocks.editor }))
vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))
vi.mock('next-intl/server', () => ({ getTranslations: async () => (key: string) => key }))

let db: Awaited<ReturnType<typeof createTestDatabase>>
let domainId: string
beforeEach(async () => {
  db = await createTestDatabase()
  mocks.getDb.mockResolvedValue(db)
  const created = await createCompany(db, { name: 'Settings', domain: 'example.com' })
  if (!created.ok) throw new Error('setup failed')
  domainId = created.domain.id
  mocks.editor.mockResolvedValue({ domain: created.domain })
})
afterEach(async () => db.close())

function form(mode: 'http' | 'headless') {
  const data = new FormData()
  for (const [key, value] of Object.entries({
    renderingMode: mode,
    concurrency: '2',
    requestsPerSecond: '5',
    timeoutSeconds: '30',
    maxRetries: '2',
    maxUrls: '100000',
    retention: 'latest',
    retainCrawls: '2',
    historyDays: '30',
    collectVitals: 'on',
  }))
    data.set(key, value)
  return data
}

it.each(['missing', 'unreachable', 'stale', 'future', 'malformed', 'not-configured'])(
  'refuses rendered settings with %s browser evidence; HTML remains available',
  async (state) => {
    if (state !== 'missing') {
      await db.settings.set(
        RENDER_STATUS_KEY,
        JSON.stringify({
          state: ['stale', 'future', 'malformed'].includes(state) ? 'ready' : state,
          checkedAt:
            state === 'malformed'
              ? 'invalid'
              : new Date(
                  Date.now() + (state === 'stale' ? -16 * 60_000 : state === 'future' ? 60_000 : 0),
                ).toISOString(),
        }),
        false,
      )
    }
    expect(await saveCrawlSettingsAction('example.com', {}, form('headless'))).toEqual({
      error: 'renderingUnavailable',
    })
    expect(await db.crawls.settings(domainId)).toEqual(DEFAULT_CRAWL_SETTINGS)
    expect((await newDomainCrawlSettings()).renderingMode).toBe('http')
    expect(await saveCrawlSettingsAction('example.com', {}, form('http'))).toEqual({ saved: true })
    expect(mocks.editor).toHaveBeenCalledWith('example.com')
  },
)
it('allows rendered settings and new-domain defaults only from fresh ready evidence', async () => {
  await db.settings.set(
    RENDER_STATUS_KEY,
    JSON.stringify({
      state: 'ready',
      checkedAt: new Date().toISOString(),
    }),
    false,
  )
  expect((await newDomainCrawlSettings()).renderingMode).toBe('headless')
  expect(await saveCrawlSettingsAction('example.com', {}, form('headless'))).toEqual({
    saved: true,
  })
  expect((await db.crawls.settings(domainId)).renderingMode).toBe('headless')
})
