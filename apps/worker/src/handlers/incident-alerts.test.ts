import { createLogger, emptyVitals, type MailMessage } from '@seotools/core'
import { createCompany } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { afterEach, beforeEach, expect, it } from 'vitest'
import { createIncidentAlertsHandler, createVitalsAlertsHandler } from './incident-alerts'
let db: Database, domainId: string, userId: string, sent: MailMessage[], fail: boolean
const log = createLogger('test', 'silent')
const ctx = {
  log,
  signal: new AbortController().signal,
  getMailer: async () => ({
    send: async (message: MailMessage) => {
      if (fail) throw new Error('offline')
      sent.push(message)
      return {}
    },
    verify: async () => {},
  }),
}
beforeEach(async () => {
  db = await createTestDatabase()
  const site = await createCompany(db, { name: 'Site', domain: 'example.com' })
  if (!site.ok) throw new Error('setup')
  domainId = site.domain.id
  const user = await db.users.create({
    email: 'viewer@example.com',
    name: 'Viewer',
    role: 'member',
  })
  userId = user.id
  await db.users.setGrants(userId, [{ role: 'viewer', domainId, companyId: null }])
  await db.alerts.save({
    userId,
    locale: 'es',
    domains: [{ domainId, kinds: ['site-availability', 'vitals-regression'] }],
  })
  sent = []
  fail = false
})
afterEach(async () => {
  await db.close()
})
async function incidentJob() {
  const now = new Date()
  await db.crawlFiles.finishCheck({
    domainId,
    outcome: 'unreachable',
    checkedAt: new Date(now.getTime() - 3600000),
    nextCheckAt: now,
  })
  await db.crawlFiles.finishCheck({
    domainId,
    outcome: 'unreachable',
    checkedAt: now,
    nextCheckAt: now,
  })
  return (await db.jobs.list()).find((j) => j.type === 'incident.alerts')!
}
it('sends once to an opted-in viewer, records delivery, releases only on failure', async () => {
  const job = await incidentJob(),
    handler = createIncidentAlertsHandler({ db, publicUrl: 'https://seo.example.com' })
  fail = true
  await expect(handler(job, ctx)).rejects.toThrow('offline')
  fail = false
  await handler(job, ctx)
  await handler(job, ctx)
  expect(sent).toHaveLength(1)
  expect(sent[0]?.text).toContain('aproximadamente una vez al día')
  expect(sent[0]?.text).toContain('/domains/example.com/issues')
  expect((await db.mail.recent({ limit: 10 })).map((m) => m.status).sort()).toEqual([
    'failed',
    'sent',
  ])
})
it.each(['unsubscribed', 'disabled', 'no-access', 'archived'] as const)(
  're-resolves recipients: %s receives nothing',
  async (reason) => {
    const job = await incidentJob()
    if (reason === 'unsubscribed')
      await db.alerts.save({ userId, locale: 'en', domains: [{ domainId, kinds: [] }] })
    if (reason === 'disabled') await db.users.setDisabled(userId, true)
    if (reason === 'no-access') await db.users.setGrants(userId, [])
    if (reason === 'archived') await db.domains.archive(domainId)
    await createIncidentAlertsHandler({ db, publicUrl: 'https://seo.example.com' })(job, ctx)
    expect(sent).toEqual([])
  },
)
it('sends a vitals regression once and skips missing data', async () => {
  const make = async (lcp: number | null) => {
    const crawl = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
    await db.crawls.finish(crawl!.id, { status: 'completed' })
    await db.vitals.saveOrigin({
      ...emptyVitals(),
      crawlId: crawl!.id,
      formFactor: 'PHONE',
      lcp,
      status: 'collected',
      error: null,
      collectedAt: new Date(),
    })
    await db.vitals.queueAlerts(crawl!.id)
    return (await db.jobs.list()).find(
      (j) => j.type === 'vitals.alerts' && (j.payload as { crawlId: string }).crawlId === crawl!.id,
    )!
  }
  await make(2000)
  const job = await make(5000),
    handler = createVitalsAlertsHandler({ db, publicUrl: 'https://seo.example.com' })
  await handler(job, ctx)
  await handler(job, ctx)
  expect(sent).toHaveLength(1)
  expect(sent[0]?.text).toContain('LCP')
  const noData = await make(null)
  await handler(noData, ctx)
  expect(sent).toHaveLength(1)
})

it('keeps the original observation time when an alert is delivered after recovery', async () => {
  const job = await incidentJob()
  const observedAt = (job.payload as { observedAt: string }).observedAt
  const later = new Date(new Date(observedAt).getTime() + 86400000)
  await db.crawlFiles.finishCheck({ domainId, outcome: 'ok', checkedAt: later, nextCheckAt: later })
  await createIncidentAlertsHandler({ db, publicUrl: 'https://seo.example.com' })(job, ctx)
  expect(sent[0]?.text).toContain(observedAt)
  expect(sent[0]?.text).not.toContain(later.toISOString())
})
