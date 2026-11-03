import { createLogger, crawlUrlHash, type Job } from '@seotools/core'
import { createCompany } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { runVerification } from '../crawl/verification'
import { createRunner } from '../runner'
import { JobDeferredError, PermanentJobError } from '../types'
import { createUrlVerifyHandler } from './url-verify'

// The real thing requests URLs; the tests that need a failure replace it for one call.
vi.mock('../crawl/verification', async (importOriginal) => {
  const original = await importOriginal<{ runVerification: typeof runVerification }>()
  return { ...original, runVerification: vi.fn(original.runVerification) }
})

const log = createLogger('test', 'silent')

let db: Database
let domainId: string
beforeEach(async () => {
  db = await createTestDatabase()
  const created = await createCompany(db, { name: 'Acme', domain: 'example.com' })
  if (!created.ok) throw new Error('setup failed')
  domainId = created.domain.id
})
afterEach(async () => {
  await db.close()
})

const handler = () => createUrlVerifyHandler({ db, allowPrivateNetworks: false })
const context = { log, signal: new AbortController().signal, getMailer: async () => null }
const jobWith = (payload: unknown, overrides: Partial<Job> = {}) =>
  ({ id: 'j', type: 'url.verify', payload, attempts: 1, maxAttempts: 3, ...overrides }) as Job

describe('the url.verify job', () => {
  it('refuses a payload that is not a recheck, without retries', async () => {
    await expect(handler()(jobWith({}), context)).rejects.toBeInstanceOf(PermanentJobError)
    await expect(handler()(jobWith({ verificationId: 3 }), context)).rejects.toBeInstanceOf(
      PermanentJobError,
    )
  })

  it('does nothing for a recheck that does not exist', async () => {
    expect(await handler()(jobWith({ verificationId: 'nope' }), context)).toBeNull()
  })

  it('runs in the crawl lane, and stays out of the default one', async () => {
    const verification = await db.verifications.start({
      domainId,
      baseCrawlId: 'a-crawl',
      urls: [
        {
          url: 'https://example.com/a',
          urlHash: crawlUrlHash('https://example.com/a'),
          source: 'link',
        },
      ],
    })
    const lane = (options: { types?: string[]; excludeTypes?: string[] }) =>
      createRunner({
        db,
        handlers: { 'url.verify': async () => 'ran' },
        workerId: 'w',
        log,
        getMailer: async () => null,
        concurrency: 1,
        pollIntervalMs: 20,
        lockTimeoutMs: 60_000,
        ...options,
      })
    expect(await lane({ excludeTypes: ['crawl.run', 'url.verify'] }).tick()).toBe(0)
    expect(await lane({ types: ['crawl.run', 'url.verify'] }).tick()).toBe(1)
    expect(verification).not.toBeNull()
  })

  describe('when it fails', () => {
    const aRecheck = () =>
      db.verifications.start({
        domainId,
        baseCrawlId: 'a-crawl',
        urls: [
          {
            url: 'https://example.com/a',
            urlHash: crawlUrlHash('https://example.com/a'),
            source: 'link',
          },
        ],
      })

    it('keeps the recheck going while the queue will try again', async () => {
      const verification = (await aRecheck())!
      vi.mocked(runVerification).mockRejectedValueOnce(new Error('the database blinked'))
      await expect(
        handler()(jobWith({ verificationId: verification.id }, { attempts: 1 }), context),
      ).rejects.toThrow('the database blinked')
      expect((await db.verifications.get(verification.id))?.status).toBe('pending')
    })

    it('says so on the last attempt, since nothing will try again', async () => {
      const verification = (await aRecheck())!
      vi.mocked(runVerification).mockRejectedValueOnce(new Error('the database is gone'))
      await expect(
        handler()(jobWith({ verificationId: verification.id }, { attempts: 3 }), context),
      ).rejects.toThrow('the database is gone')
      expect(await db.verifications.get(verification.id)).toMatchObject({
        status: 'failed',
        error: 'the database is gone',
      })
      expect(await db.verifications.active(domainId)).toBeNull()
    })

    it('is not a failure to wait for a crawl, even on the last attempt', async () => {
      const verification = (await aRecheck())!
      vi.mocked(runVerification).mockRejectedValueOnce(new JobDeferredError(1000))
      await expect(
        handler()(jobWith({ verificationId: verification.id }, { attempts: 3 }), context),
      ).rejects.toBeInstanceOf(JobDeferredError)
      expect((await db.verifications.get(verification.id))?.status).toBe('pending')
    })
  })
})
