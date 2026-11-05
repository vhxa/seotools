import {
  JOB_TYPES,
  createLogger,
  type AlertKind,
  type AlertLocale,
  type Job,
  type MailMessage,
  type Mailer,
  type NewAuditRule,
} from '@seotools/core'
import { createCompany, createFirstAdmin } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { recomputeAudit } from '../crawl/audit-recompute'
import { runCrawl } from '../crawl/engine'
import { fakeSite, type Answer } from '../crawl/fake-site'
import { reanalyseOutdatedCrawls } from '../crawl/reanalysis'
import { SITE, page, sitemapOf, xml } from '../crawl/test-site'
import { createCrawlAlertsHandler } from '../handlers/crawl-alerts'
import { JobDeferredError, PermanentJobError, type HandlerContext } from '../types'
import { ANALYSIS_WAIT_MS, runCrawlAlerts } from './run'

const log = createLogger('test', 'silent')
const PUBLIC_URL = 'https://seo.example.com'

let db: Database
let domainId: string
let sent: MailMessage[]
let failNext: Error | null
let mailer: Mailer | null

beforeEach(async () => {
  db = await createTestDatabase()
  const created = await createCompany(db, { name: 'Acme', domain: 'example.com' })
  if (!created.ok) throw new Error('setup failed')
  domainId = created.domain.id
  await db.crawls.saveSettings(domainId, {
    ...(await db.crawls.settings(domainId)),
    requestsPerSecond: 100,
    maxRetries: 0,
  })
  sent = []
  failNext = null
  mailer = {
    async send(message) {
      if (failNext) {
        const error = failNext
        failNext = null
        throw error
      }
      sent.push(message)
      return { id: `m${sent.length}` }
    },
    async verify() {},
  }
})
afterEach(async () => {
  await db.close()
})

// --- people -----------------------------------------------------------------------------------------

let counter = 0
async function member(
  options: { grant?: 'viewer' | 'editor' | null; domain?: string } = {},
): Promise<string> {
  const user = await db.users.create({
    email: `person${++counter}@acme.com`,
    name: `Person ${counter}`,
    role: 'member',
  })
  if (options.grant !== null) {
    await db.users.setGrants(user.id, [
      { role: options.grant ?? 'viewer', companyId: null, domainId: options.domain ?? domainId },
    ])
  }
  return user.id
}
const subscribe = (
  userId: string,
  kinds: AlertKind[],
  locale: AlertLocale = 'en',
  domain = domainId,
) => db.alerts.save({ userId, locale, domains: [{ domainId: domain, kinds }] })
const emailOf = async (userId: string) => (await db.users.get(userId))!.email
const to = (message: MailMessage) => message.to

// --- sites ------------------------------------------------------------------------------------------

const absolute = (path: string) => (path.startsWith('http') ? path : `${SITE}${path}`)
const NOINDEX = '<meta name="robots" content="noindex">'

/** A small site with nothing wrong. `overrides` replace pages by path. */
function site(overrides: Record<string, Answer> = {}) {
  const pages: Record<string, Answer> = {
    '/': page('/', {
      links: '<a href="/about">About</a><a href="/product">Product</a><a href="/team">Team</a>',
    }),
    '/about': page('/about'),
    '/product': page('/product'),
    '/team': page('/team'),
    ...overrides,
  }
  const answers: Record<string, Answer> = {
    [`${SITE}/sitemap.xml`]: xml(sitemapOf(Object.keys(pages))),
  }
  for (const [path, answer] of Object.entries(pages)) answers[absolute(path)] = answer
  return answers
}

const later = () => new Promise((resolve) => setTimeout(resolve, 5))

async function crawl(answers: Record<string, Answer>) {
  await later()
  const started = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
  if (!started) throw new Error('crawl did not start')
  await runCrawl(started.id, {
    db,
    log,
    signal: new AbortController().signal,
    createFetcher: fakeSite(answers, 0).createFetcher,
    retryBaseMs: 1,
  })
  return started.id
}

const alertJobs = async () =>
  (await db.jobs.list({ limit: 100 })).filter((job) => job.type === JOB_TYPES.crawlAlerts)

function run(crawlId: string, overrides: Partial<Parameters<typeof runCrawlAlerts>[0]> = {}) {
  return runCrawlAlerts({
    db,
    log,
    signal: new AbortController().signal,
    crawlId,
    publicUrl: PUBLIC_URL,
    getMailer: async () => mailer,
    ...overrides,
  })
}

// --- what is worth sending ----------------------------------------------------------------------------

describe('a new important finding', () => {
  it('is reported once per person, grouped by issue with a few URLs, never one email per URL', async () => {
    const ana = await member()
    await subscribe(ana, ['important-findings'])
    const first = await crawl(site())
    expect(await run(first)).toEqual({ sent: 0, left: 1 })
    // Four pages go noindex between crawls.
    const second = await crawl(
      site({
        '/about': page('/about', { head: NOINDEX }),
        '/product': page('/product', { head: NOINDEX }),
        '/team': page('/team', { head: NOINDEX }),
        '/': page('/', {
          head: NOINDEX,
          links: '<a href="/about">a</a><a href="/product">p</a><a href="/team">t</a>',
        }),
      }),
    )

    expect(await run(second)).toEqual({ sent: 1, left: 0 })
    expect(sent).toHaveLength(1)
    const [message] = sent
    expect(to(message!)).toBe(await emailOf(ana))
    expect(message!.subject).toBe('example.com: new important findings')
    const text = message!.text!
    expect(text).toContain('4 (4 new, 0 back)')
    // Three samples of the four, as plain URLs of the site.
    expect(text.match(/^ {4}https:\/\/example\.com\/\S*$/gm)).toHaveLength(3)
    // Where to look, through the public address of the app.
    expect(text).toContain(
      `${PUBLIC_URL}/domains/example.com/pages/details?crawl=${second}&issue=noindex`,
    )
    expect(text).toContain(
      `${PUBLIC_URL}/domains/example.com/pages/compare?from=${first}&to=${second}&change=gained`,
    )
    expect(text).not.toContain('\n\n\n')
  })

  it('is reported again when it comes back, as back and not as new', async () => {
    const ana = await member()
    await subscribe(ana, ['important-findings'])
    await crawl(site())
    await crawl(site({ '/about': page('/about', { head: NOINDEX }) }))
    const third = await crawl(site())
    const fourth = await crawl(site({ '/about': page('/about', { head: NOINDEX }) }))

    await run(third)
    sent.length = 0
    await run(fourth)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.text).toContain('1 (0 new, 1 back)')
  })

  it('is not sent for a finding that was already there', async () => {
    const ana = await member()
    await subscribe(ana, ['important-findings'])
    await crawl(site({ '/about': page('/about', { head: NOINDEX }) }))
    const second = await crawl(site({ '/about': page('/about', { head: NOINDEX }) }))
    expect(await run(second)).toMatchObject({ left: 1 })
    expect(sent).toEqual([])
  })

  it('is not a regression when only the audit rules changed', async () => {
    const ana = await member()
    const bea = await member()
    await subscribe(ana, ['important-findings'])
    await subscribe(bea, ['change-summary'])
    await crawl(site())
    // The rule asks for a noindex on /about, which it does not have: a new finding, caused by the rule.
    const rule: NewAuditRule = {
      dimension: 'noindex',
      value: 'required',
      selector: { kind: 'path', path: '/about', query: { mode: 'any' }, scope: 'literal' },
      reason: null,
      enabled: true,
    }
    const saved = await db.audit.saveRule({ domainId, rule })
    expect(saved.ok).toBe(true)
    const second = await crawl(site())
    const required = await db.crawls.issuesOf(second, [
      (await db.crawls.listUrls({ crawlId: second, view: 'pages', limit: 50, offset: 0 })).find(
        (url) => url.url === absolute('/about'),
      )!.urlHash,
    ])
    expect(required.map((row) => row.issue)).toContain('noindex-required-missing')

    await run(second)

    // Nobody who wants regressions hears of it; the summary says it cannot tell.
    expect(sent).toHaveLength(1)
    expect(to(sent[0]!)).toBe(await emailOf(bea))
    const text = sent[0]!.text!
    expect(text).toContain('Findings: 0 new, 0 back, 0 resolved, 1 unverified.')
    expect(text).toContain('audit rules changed between the two crawls')
    expect(text).not.toContain('Important')
  })

  it('is not sent to a person who asked for a different kind', async () => {
    const ana = await member()
    await subscribe(ana, ['crawl-problem'])
    await crawl(site())
    const second = await crawl(site({ '/about': page('/about', { head: NOINDEX }) }))
    expect(await run(second)).toMatchObject({ skipped: 'nobody' })
    expect(sent).toEqual([])
  })
})

describe('the change summary', () => {
  it('says plainly that it is the first crawl, with no comparison', async () => {
    const ana = await member()
    await subscribe(ana, ['change-summary'])
    const first = await crawl(site())
    await run(first)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.subject).toBe('example.com: changes since the previous crawl')
    expect(sent[0]!.text).toContain('first crawl of example.com')
    expect(sent[0]!.text).not.toContain('New')
  })

  it('counts what changed with the same words as the comparison, and links to it', async () => {
    const ana = await member()
    await subscribe(ana, ['change-summary'], 'es')
    const first = await crawl(site())
    const second = await crawl(
      site({
        '/about': page('/about', { head: NOINDEX }),
        '/extra': page('/extra'),
        '/': page('/', {
          links: '<a href="/about">a</a><a href="/product">p</a><a href="/extra">e</a>',
        }),
      }),
    )
    await run(second)
    const { subject, text } = sent[0]!
    expect(subject).toBe('example.com: cambios desde el rastreo anterior')
    expect(text).toContain('URLs nuevas: 1.')
    expect(text).toMatch(/Hallazgos: \d+ nuevos, 0 de vuelta, 0 resueltos, 0 sin verificar\./)
    expect(text).toContain(`from=${first}&to=${second}`)
  })

  it('says it cannot compare when no earlier crawl completed with its results', async () => {
    const ana = await member()
    await subscribe(ana, ['change-summary'])
    const first = await crawl(site())
    await db.crawls.settings(domainId)
    // The earlier crawl lost its results to retention.
    await db.crawls.saveSettings(domainId, {
      ...(await db.crawls.settings(domainId)),
      retainCrawls: 1,
    })
    const second = await crawl(site())
    expect((await db.crawls.get(first))?.pruned).toBe(true)
    await run(second)
    expect(sent[0]!.text).toContain('cannot be compared')
    expect(sent[0]!.text).not.toContain('URLs added')
  })
})

describe('a crawl that did not go well', () => {
  it('tells of a failed crawl, with the reason, and only those who asked for it', async () => {
    const ana = await member()
    const bea = await member()
    await subscribe(ana, ['crawl-problem'])
    await subscribe(bea, ['change-summary'])
    const started = await db.crawls.start({ domainId, type: 'full', trigger: 'schedule' })
    const [job] = await db.jobs.claim({ workerId: 'w', limit: 1 })
    await db.jobs.fail({ id: job!.id, workerId: 'w', error: 'The site did not answer\nat all' })
    expect(await db.crawls.failOrphaned()).toBe(1)

    expect(await run(started!.id)).toMatchObject({ sent: 1 })
    expect(sent).toHaveLength(1)
    expect(to(sent[0]!)).toBe(await emailOf(ana))
    expect(sent[0]!.subject).toBe('example.com: the crawl failed')
    expect(sent[0]!.text).toContain('Reason: The site did not answer at all')
    expect(sent[0]!.text).toContain(`${PUBLIC_URL}/domains/example.com/pages/history`)
  })

  it('tells of a crawl that stopped at its limit', async () => {
    const ana = await member()
    await subscribe(ana, ['crawl-problem'])
    await db.crawls.saveSettings(domainId, { ...(await db.crawls.settings(domainId)), maxUrls: 2 })
    const id = await crawl(site())
    expect((await db.crawls.get(id))?.status).toBe('incomplete')
    await run(id)
    expect(sent[0]!.subject).toBe('example.com: the crawl is incomplete')
    expect(sent[0]!.text).toContain('settings/crawl')
  })

  it('says nothing of a crawl that ended well to someone who asked about problems', async () => {
    const ana = await member()
    await subscribe(ana, ['crawl-problem'])
    expect(await run(await crawl(site()))).toMatchObject({ skipped: 'nobody' })
    expect(sent).toEqual([])
  })
})

// --- one email, once ------------------------------------------------------------------------------------

describe('grouping and not repeating', () => {
  it('puts every kind a person has for a crawl in one email', async () => {
    const ana = await member()
    await subscribe(ana, ['crawl-problem', 'important-findings', 'change-summary'])
    await db.crawls.saveSettings(domainId, { ...(await db.crawls.settings(domainId)), maxUrls: 2 })
    const id = await crawl(site())
    await run(id)
    // Incomplete: a problem and a summary (findings only come from a completed crawl).
    expect(sent).toHaveLength(1)
    expect(sent[0]!.subject).toBe('example.com: crawl problem, changes')
    expect(sent[0]!.text!.indexOf('Crawl problem')).toBeLessThan(
      sent[0]!.text!.indexOf('first crawl'),
    )

    sent.length = 0
    await db.crawls.saveSettings(domainId, {
      ...(await db.crawls.settings(domainId)),
      maxUrls: null,
    })
    await crawl(site())
    const regressed = await crawl(site({ '/about': page('/about', { head: NOINDEX }) }))
    await run(regressed)
    expect(sent).toHaveLength(1)
    expect(sent[0]!.subject).toBe('example.com: new important findings, changes')
  })

  it('sends a crawl once however often the job runs, and again to nobody', async () => {
    const ana = await member()
    await subscribe(ana, ['change-summary'])
    const id = await crawl(site())
    expect(await run(id)).toEqual({ sent: 1, left: 0 })
    expect(await run(id)).toEqual({ sent: 0, left: 1 })
    // Two workers at once.
    const bea = await member()
    await subscribe(bea, ['change-summary'])
    const results = await Promise.all([run(id), run(id)])
    expect(results.reduce((total, r) => total + (r.sent ?? 0), 0)).toBe(1)
    expect(sent).toHaveLength(2)
  })

  it('sends again after a failed attempt, once, and records both', async () => {
    const ana = await member()
    await subscribe(ana, ['change-summary'])
    const id = await crawl(site())
    failNext = new Error('connection refused')
    await expect(run(id)).rejects.toThrow('connection refused')
    expect(sent).toEqual([])
    expect(await run(id)).toEqual({ sent: 1, left: 0 })
    expect(await run(id)).toEqual({ sent: 0, left: 1 })
    expect(sent).toHaveLength(1)
    const deliveries = await db.mail.recent({ limit: 10 })
    expect(deliveries.map((d) => [d.kind, d.status, d.error])).toEqual([
      ['alert', 'sent', null],
      ['alert', 'failed', 'connection refused'],
    ])
    // Only that it went to someone: not what it said.
    expect(JSON.stringify(deliveries)).not.toContain('example.com/')
  })

  it('goes on to the others when one cannot be reached, and fails so the job is retried', async () => {
    const ana = await member()
    const bea = await member()
    await subscribe(ana, ['change-summary'])
    await subscribe(bea, ['change-summary'])
    const id = await crawl(site())
    failNext = new Error('mailbox unavailable')
    await expect(run(id)).rejects.toThrow('mailbox unavailable')
    expect(sent).toHaveLength(1)
    expect(await run(id)).toEqual({ sent: 1, left: 1 })
    expect(sent).toHaveLength(2)
  })
})

// --- who is told, when it is sent ---------------------------------------------------------------------

describe('recipients, at the moment of sending', () => {
  it('leaves out someone whose access was removed since they asked', async () => {
    const ana = await member()
    const bea = await member()
    await subscribe(ana, ['change-summary'])
    await subscribe(bea, ['change-summary'])
    const id = await crawl(site())
    await db.users.setGrants(ana, [])
    expect(await run(id)).toEqual({ sent: 1, left: 0 })
    expect(sent.map(to)).toEqual([await emailOf(bea)])
  })

  it('never sends a member what they cannot see, even with a subscription', async () => {
    const other = await createCompany(db, { name: 'Other', domain: 'other.com' })
    if (!other.ok) throw new Error('setup failed')
    const ana = await member({ domain: other.domain.id })
    // Asked for it when they could see this domain, or by any other means.
    await subscribe(ana, ['change-summary'])
    expect(await run(await crawl(site()))).toMatchObject({ skipped: 'nobody' })
    expect(sent).toEqual([])
  })

  it('keeps sending to someone who sees it through a company grant, and to an administrator', async () => {
    await createFirstAdmin(db, {
      email: 'admin@acme.com',
      name: 'Admin',
      password: 'a-long-password',
    })
    const company = (await db.companies.list())[0]!
    const ana = await member({ grant: null })
    await db.users.setGrants(ana, [{ role: 'viewer', companyId: company.id, domainId: null }])
    const admin = (await db.users.findByEmail('admin@acme.com'))!
    await subscribe(ana, ['change-summary'])
    await subscribe(admin.id, ['change-summary'])
    await run(await crawl(site()))
    expect(sent.map(to).sort()).toEqual(['admin@acme.com', await emailOf(ana)].sort())
  })

  it('leaves out someone who opted out since', async () => {
    const ana = await member()
    await subscribe(ana, ['change-summary'])
    const id = await crawl(site())
    await subscribe(ana, [])
    expect(await run(id)).toMatchObject({ skipped: 'nobody' })
    expect(sent).toEqual([])
  })

  it('leaves out only the kind someone dropped', async () => {
    const ana = await member()
    await subscribe(ana, ['change-summary', 'crawl-problem'])
    const id = await crawl(site())
    await subscribe(ana, ['crawl-problem'])
    expect(await run(id)).toMatchObject({ skipped: 'nobody' })
  })

  it('leaves out a disabled account, and it is no failure', async () => {
    const ana = await member()
    await subscribe(ana, ['change-summary'])
    const id = await crawl(site())
    await db.users.setDisabled(ana, true)
    expect(await run(id)).toMatchObject({ skipped: 'nobody' })
    expect(sent).toEqual([])
    expect(await db.mail.recent({ limit: 10 })).toEqual([])
  })

  it('sends nothing for an archived domain', async () => {
    const ana = await member()
    await subscribe(ana, ['change-summary'])
    const id = await crawl(site())
    await db.domains.archive(domainId)
    expect(await run(id)).toEqual({ skipped: 'archived' })
    expect(sent).toEqual([])
  })

  it('sends nothing for a priority crawl or a crawl that is gone', async () => {
    const ana = await member()
    await subscribe(ana, ['change-summary', 'crawl-problem'])
    const priority = await db.crawls.start({ domainId, type: 'priority', trigger: 'manual' })
    await db.crawls.finish(priority!.id, { status: 'failed', error: 'x' })
    expect(await run(priority!.id)).toEqual({ skipped: 'not-applicable' })
    expect(await run('missing')).toEqual({ skipped: 'gone' })
    expect(sent).toEqual([])
  })

  it('writes in the language the person saved', async () => {
    const ana = await member()
    await subscribe(ana, ['change-summary'], 'es')
    await run(await crawl(site()))
    expect(sent[0]!.subject).toBe('example.com: cambios desde el rastreo anterior')
    expect(sent[0]!.text).toContain('primer rastreo')
  })
})

// --- what must not send anything ------------------------------------------------------------------------

describe('analysing a crawl again', () => {
  it('queues no alert and sends none: only the end of a full crawl does', async () => {
    const ana = await member()
    await subscribe(ana, ['important-findings', 'change-summary'])
    await crawl(site())
    const second = await crawl(site({ '/about': page('/about', { head: NOINDEX }) }))
    await run(second)
    const sentBefore = sent.length
    const jobsBefore = (await alertJobs()).length
    expect(jobsBefore).toBe(2)

    // A rule changes, the latest crawl is analysed again, and so are crawls from an older catalog.
    const saved = await db.audit.saveRule({
      domainId,
      rule: {
        dimension: 'audit',
        value: 'exclude',
        selector: { kind: 'path', path: '/team', query: { mode: 'any' }, scope: 'literal' },
        reason: null,
        enabled: true,
      },
    })
    expect(saved.ok).toBe(true)
    const recompute = (await db.jobs.list({ limit: 50 })).find(
      (job) => job.type === JOB_TYPES.auditRecompute,
    )
    expect(recompute).toBeTruthy()
    await recomputeAudit({
      db,
      domainId,
      log,
      signal: new AbortController().signal,
      finalAttempt: false,
    })
    await reanalyseOutdatedCrawls({ db, log, stopped: () => false })

    expect((await alertJobs()).length).toBe(jobsBefore)
    expect(sent.length).toBe(sentBefore)
  })
})

describe('the job', () => {
  it('is queued by the end of a full crawl and does the whole thing', async () => {
    const ana = await member()
    await subscribe(ana, ['change-summary'])
    const id = await crawl(site())
    const [job] = await alertJobs()
    expect(job!.payload).toEqual({ crawlId: id })

    const handler = createCrawlAlertsHandler({ db, publicUrl: PUBLIC_URL })
    const context: HandlerContext = {
      log,
      signal: new AbortController().signal,
      getMailer: async () => mailer,
    }
    expect(await handler(job as Job, context)).toEqual({ sent: 1, left: 0 })
    expect(sent).toHaveLength(1)
  })

  it('records that something wanted to send when there is no provider, and is retried', async () => {
    const ana = await member()
    await subscribe(ana, ['change-summary'])
    const id = await crawl(site())
    await expect(run(id, { getMailer: async () => null })).rejects.toThrow('No email provider')
    expect(await db.mail.recent({ limit: 5 })).toMatchObject([
      { kind: 'alert', status: 'unconfigured', recipient: await emailOf(ana) },
    ])
    // Once there is one, the same job sends it.
    expect(await run(id)).toEqual({ sent: 1, left: 0 })
  })

  it('needs the address of the app only when there is somebody to write to', async () => {
    const id = await crawl(site())
    expect(await run(id, { publicUrl: undefined })).toEqual({ skipped: 'nobody' })
    const ana = await member()
    await subscribe(ana, ['change-summary'])
    await expect(run(id, { publicUrl: undefined })).rejects.toBeInstanceOf(PermanentJobError)
  })

  it('waits for the analysis of a crawl, then gives up on it', async () => {
    const ana = await member()
    await subscribe(ana, ['change-summary'])
    const started = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
    await db.crawls.finish(started!.id, { status: 'completed' })
    const finishedAt = (await db.crawls.get(started!.id))!.finishedAt!
    await expect(run(started!.id, { now: finishedAt })).rejects.toBeInstanceOf(JobDeferredError)
    expect(sent).toEqual([])
    const late = new Date(finishedAt.getTime() + ANALYSIS_WAIT_MS + 1)
    expect(await run(started!.id, { now: late })).toEqual({ sent: 1, left: 0 })
  })

  it('is handed back when the worker is shutting down, without sending', async () => {
    const ana = await member()
    await subscribe(ana, ['change-summary'])
    const id = await crawl(site())
    const stop = new AbortController()
    stop.abort()
    await expect(run(id, { signal: stop.signal })).rejects.toThrow('Interrupted')
    expect(sent).toEqual([])
    expect(await run(id)).toEqual({ sent: 1, left: 0 })
  })
})
