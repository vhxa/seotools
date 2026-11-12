import { describe, expect, it } from 'vitest'
import { DomainArchivedError } from '../archive'
import type { Database } from '../types'
import { createCompany } from '../workspace'

export function describeBotAccess(getDb: () => Database) {
  describe('bot test runs', () => {
    it('starts atomically, deduplicates, resumes, prunes and removes domain jobs', async () => {
      const db = getDb()
      const made = await createCompany(db, { name: 'Acme', domain: 'example.com' })
      if (!made.ok) throw new Error('setup failed')
      const input = { domainId: made.domain.id, requestedBy: 'editor' }
      const [a, b] = await Promise.all([db.botTests.start(input), db.botTests.start(input)])
      const run = a ?? b
      expect([a, b].filter(Boolean)).toHaveLength(1)
      expect((await db.jobs.get(run!.jobId))?.payload).toEqual({ runId: run!.id })
      await db.botTests.markRunning(run!.id)
      const result = {
        runId: run!.id,
        botToken: 'baseline',
        statusCode: 200,
        finalUrl: 'https://example.com/',
        responseTimeMs: 15,
        bytes: 20,
        errorCode: null,
        verdict: 'unknown' as const,
        reasons: [],
      }
      await db.botTests.record(result)
      await db.botTests.record({ ...result, statusCode: 403 })
      expect(await db.botTests.results(run!.id)).toEqual([result])
      await db.botTests.finish(run!.id, 'done')
      const next = await db.botTests.start(input)
      expect(await db.botTests.list(input.domainId)).toHaveLength(2)
      await db.botTests.finish(next!.id, 'failed')
      expect((await db.botTests.list(input.domainId)).map((row) => row.id)).toEqual([next!.id])
      expect(await db.botTests.results(run!.id)).toEqual([])
      const active = await db.botTests.start(input)
      await db.domains.archive(input.domainId)
      expect((await db.botTests.get(active!.id))?.status).toBe('cancelled')
      await expect(db.botTests.start(input)).rejects.toBeInstanceOf(DomainArchivedError)
      await db.domains.delete(input.domainId)
      expect(await db.jobs.get(active!.jobId)).toBeNull()
      expect(await db.botTests.list(input.domainId)).toEqual([])
    })
  })
}
