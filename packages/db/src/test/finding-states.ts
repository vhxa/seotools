import { describe, expect, it } from 'vitest'
import { crawlUrlHash } from '@seotools/core'
import { createCompany } from '../workspace'
import type { Database, SetFindingStates } from '../types'

export function describeFindingStates(get: () => Database) {
  describe('finding states', () => {
    async function fixture() {
      const db = get()
      const created = await createCompany(db, { name: 'States', domain: 'states.example' })
      if (!created.ok) throw new Error('fixture')
      const user = await db.users.create({
        name: 'Editor',
        email: 'states@example.com',
        role: 'member',
      })
      const input: SetFindingStates = {
        domainId: created.domain.id,
        setBy: user.id,
        issue: 'title-missing',
        urlHashes: [null],
        state: 'dismissed',
        note: '  intentional  ',
      }
      return { db, input }
    }
    it('upserts uniquely, trims notes, bumps only dismissal changes, and restores overrides', async () => {
      const { db, input } = await fixture()
      expect(await db.audit.setFindingStates(input)).toMatchObject({ ok: true, version: 1 })
      const hash = crawlUrlHash('https://states.example/a')
      await db.audit.setFindingStates({ ...input, note: 'updated' })
      expect(await db.audit.config(input.domainId)).toMatchObject({
        version: 1,
        findingStates: [{ note: 'updated' }],
      })
      await db.audit.setFindingStates({ ...input, state: 'pending', urlHashes: [hash] })
      expect((await db.audit.config(input.domainId)).version).toBe(2)
      await db.audit.setFindingStates({ ...input, state: 'pending' })
      expect((await db.audit.config(input.domainId)).findingStates).toEqual([])
      await db.audit.setFindingStates({ ...input, state: 'in-progress', urlHashes: [hash] })
      await db.audit.setFindingStates({
        ...input,
        state: 'in-progress',
        note: 'another note',
        urlHashes: [hash],
      })
      const config = await db.audit.config(input.domainId)
      expect(config.version).toBe(3)
      expect(config.findingStates).toHaveLength(1)
      await db.audit.setFindingStates({ ...input, state: 'pending', urlHashes: [hash] })
      expect((await db.audit.config(input.domainId)).version).toBe(3)
    })

    it('queues one recompute for a bulk dismissal, but none for progress or notes', async () => {
      const { db, input } = await fixture()
      const crawl = await db.crawls.start({
        domainId: input.domainId,
        type: 'full',
        trigger: 'manual',
      })
      if (!crawl) throw new Error('crawl fixture')
      await db.crawls.finish(crawl.id, { status: 'completed' })
      const jobs = async () => (await db.jobs.list()).filter((j) => j.type === 'audit.recompute')
      await db.audit.setFindingStates({ ...input, state: 'in-progress' })
      expect(await jobs()).toHaveLength(0)
      await db.audit.setFindingStates({ ...input, urlHashes: ['a', 'b'] })
      expect(await jobs()).toHaveLength(1)
      expect((await db.audit.config(input.domainId)).version).toBe(1)
      await db.audit.setFindingStates({ ...input, urlHashes: ['a', 'b'], note: 'changed' })
      expect((await db.audit.config(input.domainId)).version).toBe(1)
      expect(await jobs()).toHaveLength(1)
      await db.domains.archive(input.domainId)
      await expect(db.audit.setFindingStates(input)).rejects.toThrow()
    })
    it('caps rows atomically and refuses expected findings', async () => {
      const { db, input } = await fixture()
      for (let n = 0; n < 20; n++)
        await db.audit.setFindingStates({
          ...input,
          urlHashes: Array.from({ length: 100 }, (_, i) => crawlUrlHash(String(n * 100 + i))),
        })
      expect((await db.audit.config(input.domainId)).findingStates).toHaveLength(2000)
      expect(await db.audit.setFindingStates(input)).toEqual({ ok: false, error: 'limit' })
      expect(
        await db.audit.setFindingStates({ ...input, issue: 'expected-indexable-blocked' }),
      ).toEqual({ ok: false, error: 'limit' })
    })
  })
}
