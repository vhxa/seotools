import { JOB_TYPES, createLogger } from '@seotools/core'
import { createCompany } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { runCrawl } from './engine'
import { requestLatestExplanations } from './explain'
import { fakeSite, type Answer } from './fake-site'
import { SITE, page } from './test-site'

const log = createLogger('test', 'silent')
let db: Database
let domainId: string

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
})
afterEach(async () => {
  await db.close()
})

const site = (links: string[]) => ({
  [`${SITE}/`]: page('/', { links: links.map((path) => `<a href="${path}">x</a>`).join('') }),
  ...Object.fromEntries(links.map((path) => [`${SITE}${path}`, page(path)])),
})

async function crawl(answers: Record<string, Answer>) {
  await new Promise((resolve) => setTimeout(resolve, 5))
  const started = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
  if (!started) throw new Error('crawl did not start')
  await runCrawl(started.id, {
    db,
    log,
    signal: new AbortController().signal,
    createFetcher: fakeSite(answers, 0).createFetcher,
    retryBaseMs: 1,
    secondPassWaitMs: 0,
  })
  return started.id
}

const explainJobs = async () =>
  (await db.jobs.list({ limit: 100 })).filter((job) => job.type === JOB_TYPES.compareExplain)

describe('explaining the pair of a crawl that ends', () => {
  it('treats a recovered source as a whole observation of a removed link', async () => {
    const first = await crawl(site(['/a', '/b']))
    let calls = 0
    const second = await crawl({
      ...site(['/a']),
      [SITE + '/']: () =>
        ++calls === 1
          ? { statusCode: 502, headers: {} }
          : page('/', { links: '<a href="/a">x</a>' }),
    })
    const [row] = await db.crawls.compareUrls({
      domainId,
      baseId: first,
      targetId: second,
      change: 'missing',
      view: 'pages',
      limit: 10,
      offset: 0,
    })
    expect(calls).toBe(2)
    expect(row).toMatchObject({ url: SITE + '/b', explanation: { reason: 'unlinked' } })
  })

  it('works out the reasons inside the crawl job, after the analysis', async () => {
    const first = await crawl(site(['/a', '/b']))
    const second = await crawl(site(['/a']))
    const pair = { domainId, baseId: first, targetId: second }
    expect((await db.crawls.comparisonHeader(pair))?.state).toBe('done')
    const [row] = await db.crawls.compareUrls({
      ...pair,
      change: 'missing',
      view: 'pages',
      limit: 10,
      offset: 0,
    })
    expect(row).toMatchObject({ url: `${SITE}/b`, explanation: { reason: 'unlinked' } })
    expect(await explainJobs()).toEqual([])
  })
})

describe('asking at startup for the latest pairs to be explained', () => {
  it('queues exactly one job for the latest pair that has none, and none once it is current', async () => {
    const first = await crawl(site(['/a', '/b']))
    const second = await crawl(site(['/a']))
    const pair = { domainId, baseId: first, targetId: second }
    // As a pair crawled before this version: no explanation at all.
    await db.crawls.prune({ domainId, type: 'full', keep: 2 })
    expect(await requestLatestExplanations({ db, log })).toBe(0)
    await db.crawls.comparisonWork.begin({ ...pair, runner: 'old', version: 0 })
    await db.crawls.comparisonWork.finish({ ...pair, runner: 'old', state: 'done' })
    expect(await requestLatestExplanations({ db, log })).toBe(1)
    expect(await requestLatestExplanations({ db, log })).toBe(0)
    const jobs = await explainJobs()
    expect(jobs).toHaveLength(1)
    expect(jobs[0]?.payload).toEqual({ baseId: first, targetId: second })
  })

  it('leaves archived domains alone', async () => {
    const first = await crawl(site(['/a', '/b']))
    const second = await crawl(site(['/a']))
    const pair = { domainId, baseId: first, targetId: second }
    await db.crawls.comparisonWork.begin({ ...pair, runner: 'old', version: 0 })
    await db.domains.archive(domainId)
    expect(await requestLatestExplanations({ db, log })).toBe(0)
    expect(await explainJobs()).toEqual([])
  })
})
