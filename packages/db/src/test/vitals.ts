import { emptyVitals, DEFAULT_CRAWL_SETTINGS } from '@seotools/core'
import { describe, expect, it } from 'vitest'
import type { Database } from '../types'
import { createCompany } from '../workspace'
export function describeVitals(getDb: () => Database) {
  describe('Core Web Vitals storage and lifecycle', () => {
    it('queues only enabled full crawls with a key, upserts measurements, prunes URL rows and preserves origin trends', async () => {
      const db = getDb()
      const created = await createCompany(db, { name: 'Vitals', domain: 'vitals.example.com' })
      if (!created.ok) throw new Error('setup failed')
      const domainId = created.domain.id
      const start = async () => {
        const crawl = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
        if (!crawl) throw new Error('not started')
        await db.crawls.finish(crawl.id, { status: 'completed' })
        return crawl.id
      }
      await start()
      expect((await db.jobs.list()).filter((job) => job.type === 'cwv.collect')).toHaveLength(0)
      await db.settings.set('integrations.google-vitals-key', 'encrypted', true)
      expect(await db.vitals.latestCrawl(domainId)).toBeNull()
      const first = await start()
      expect((await db.jobs.list()).filter((job) => job.type === 'cwv.collect')).toHaveLength(1)
      const row = {
        ...emptyVitals(),
        lcp: 2500,
        crawlId: first,
        formFactor: 'PHONE',
        status: 'collected',
        error: null,
        collectedAt: new Date(),
      }
      await db.vitals.saveOrigin(row)
      await db.vitals.saveOrigin({ ...row, lcp: 4001 })
      await db.vitals.saveUrl({ ...row, urlHash: 'abc', source: 'field' })
      await db.vitals.saveUrl({ ...row, urlHash: 'abc', source: 'lab', tbt: 20 })
      expect(await db.vitals.origins(first)).toMatchObject([{ lcp: 4001 }])
      expect(await db.vitals.urls(first)).toHaveLength(2)
      await db.crawls.saveSettings(domainId, { ...DEFAULT_CRAWL_SETTINGS, collectVitals: false })
      await start()
      expect((await db.jobs.list()).filter((job) => job.type === 'cwv.collect')).toHaveLength(1)
      expect((await db.vitals.latestCrawl(domainId))?.id).toBe(first)
      const running = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
      if (!running) throw new Error('not started')
      await db.vitals.saveOrigin({ ...row, crawlId: running.id })
      expect((await db.vitals.latestCrawl(domainId))?.id).toBe(first)
      await db.crawls.finish(running.id, { status: 'failed' })
      expect((await db.vitals.latestCrawl(domainId))?.id).toBe(first)
      await db.crawls.prune({ domainId, type: 'full', keep: 1 })
      expect(await db.vitals.urls(first)).toEqual([])
      expect(await db.vitals.origins(first)).toMatchObject([{ lcp: 4001 }])
      expect((await db.vitals.latestCrawl(domainId))?.id).toBe(first)
      await db.domains.delete(domainId)
      expect(await db.vitals.origins(first)).toEqual([])
      expect((await db.jobs.list()).filter((job) => job.type === 'cwv.collect')).toEqual([])
    })
  })
}
