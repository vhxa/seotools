import { crawlUrlHash } from '@seotools/core'
import { createCompany } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { answerLinksRequest, parseLinksRequest } from './link-request'

const A_HOME = 'https://acme.com/'
const A_ABOUT = 'https://acme.com/about'
const B_HOME = 'https://other.org/'
const B_ABOUT = 'https://other.org/about'
const CRAWL_ID = '123e4567-e89b-12d3-a456-426614174000'

let db: Database

const hashOf = (url: string) => crawlUrlHash(url)
const outcome = {
  kind: 'page' as const,
  statusCode: 200,
  contentType: null,
  redirectTo: null,
  title: null,
  metaRobots: null,
  xRobotsTag: null,
  canonical: null,
  responseTimeMs: null,
  bytes: null,
  error: null,
  data: null,
}

/** A finished full crawl of a new domain, whose home links to its own `/about`. */
async function finishedCrawl(host: string, home: string, about: string) {
  const created = await createCompany(db, { name: host, domain: host })
  if (!created.ok) throw new Error('setup failed')
  const domainId = created.domain.id
  const crawl = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
  if (!crawl) throw new Error('crawl did not start')
  const entry = (url: string) => ({
    url,
    urlHash: hashOf(url),
    scope: 'internal' as const,
    source: 'link' as const,
    depth: 1,
  })
  await db.crawls.addUrls(crawl.id, [entry(home), entry(about)])
  await db.crawls.recordResult({
    crawlId: crawl.id,
    urlHash: hashOf(home),
    result: outcome,
    links: [{ sourceHash: hashOf(home), targetHash: hashOf(about), kind: 'anchor' }],
  })
  await db.crawls.recordResult({ crawlId: crawl.id, urlHash: hashOf(about), result: outcome })
  await db.crawls.finish(crawl.id, { status: 'completed' })
  return { domainId, crawlId: crawl.id }
}

beforeEach(async () => {
  db = await createTestDatabase()
})
afterEach(async () => {
  await db.close()
})

const ask = (crawlId: string, urlHash: string, extra: Record<string, unknown> = {}) => ({
  crawlId,
  urlHash,
  direction: 'in',
  filter: { group: 'all' },
  page: 1,
  ...extra,
})

describe('answerLinksRequest', () => {
  it('answers with the links of a crawl of the domain', async () => {
    const a = await finishedCrawl('acme.com', A_HOME, A_ABOUT)
    const answer = await answerLinksRequest(db.crawls, a.domainId, ask(a.crawlId, hashOf(A_ABOUT)))
    expect(answer.kind).toBe('ok')
    if (answer.kind !== 'ok') return
    expect(answer.links.items.map((item) => item.url)).toEqual([A_HOME])
    expect(answer.links.direction).toBe('in')
  })

  it('treats a crawl of another domain as one that does not exist', async () => {
    const a = await finishedCrawl('acme.com', A_HOME, A_ABOUT)
    const b = await finishedCrawl('other.org', B_HOME, B_ABOUT)
    // Asking as domain A for B's crawl, with a URL of either: nothing of B is revealed.
    for (const urlHash of [hashOf(B_ABOUT), hashOf(A_ABOUT)]) {
      expect(await answerLinksRequest(db.crawls, a.domainId, ask(b.crawlId, urlHash))).toEqual({
        kind: 'unavailable',
      })
    }
    // And a crawl that is not anyone's.
    expect(await answerLinksRequest(db.crawls, a.domainId, ask(CRAWL_ID, hashOf(A_ABOUT)))).toEqual(
      { kind: 'unavailable' },
    )
  })

  it('does not let a URL of one domain be read through the crawl of another', async () => {
    const a = await finishedCrawl('acme.com', A_HOME, A_ABOUT)
    await finishedCrawl('other.org', B_HOME, B_ABOUT)
    // Domain A's own crawl has no such URL: an empty page, never B's links.
    const answer = await answerLinksRequest(db.crawls, a.domainId, ask(a.crawlId, hashOf(B_ABOUT)))
    expect(answer).toMatchObject({ kind: 'ok', links: { total: 0, items: [] } })
  })

  it('says so when the results of the crawl were pruned, rather than listing nothing', async () => {
    const first = await finishedCrawl('acme.com', A_HOME, A_ABOUT)
    // A newer full crawl in the same domain; keeping one prunes the older.
    const second = await db.crawls.start({
      domainId: first.domainId,
      type: 'full',
      trigger: 'manual',
    })
    if (!second) throw new Error('crawl did not start')
    await db.crawls.finish(second.id, { status: 'completed' })
    await db.crawls.prune({ domainId: first.domainId, type: 'full', keep: 1 })
    expect((await db.crawls.getInDomain(first.domainId, first.crawlId))?.pruned).toBe(true)
    expect(
      await answerLinksRequest(db.crawls, first.domainId, ask(first.crawlId, hashOf(A_ABOUT))),
    ).toEqual({ kind: 'pruned' })
  })

  it('refuses a crawl that is not a full crawl with results', async () => {
    const created = await createCompany(db, { name: 'acme.com', domain: 'acme.com' })
    if (!created.ok) throw new Error('setup failed')
    const priority = await db.crawls.start({
      domainId: created.domain.id,
      type: 'priority',
      trigger: 'manual',
    })
    if (!priority) throw new Error('crawl did not start')
    await db.crawls.finish(priority.id, { status: 'completed' })
    expect(
      await answerLinksRequest(db.crawls, created.domain.id, ask(priority.id, hashOf(A_HOME))),
    ).toEqual({ kind: 'unavailable' })
  })

  it('refuses what is not a request', async () => {
    const a = await finishedCrawl('acme.com', A_HOME, A_ABOUT)
    for (const input of [
      null,
      'x',
      {},
      ask(a.crawlId, 'not-a-hash'),
      ask(a.crawlId, hashOf(A_HOME), { direction: 'up' }),
    ]) {
      expect(await answerLinksRequest(db.crawls, a.domainId, input)).toEqual({
        kind: 'unavailable',
      })
    }
  })
})

describe('parseLinksRequest', () => {
  const valid = {
    crawlId: CRAWL_ID,
    urlHash: hashOf(A_HOME),
    direction: 'in',
    filter: { group: 'resources', kind: 'image', search: ' logo ' },
    page: 3,
  }

  it('accepts a request that checks out, reading its filter leniently', () => {
    expect(parseLinksRequest(valid)).toEqual({
      ...valid,
      filter: { group: 'resources', kind: 'image', search: 'logo' },
    })
    expect(parseLinksRequest({ ...valid, filter: 'nonsense', page: 'x' })).toMatchObject({
      filter: { group: 'navigation', kind: null, search: '' },
      page: 1,
    })
    expect(parseLinksRequest({ ...valid, page: -4 })?.page).toBe(1)
    expect(parseLinksRequest({ ...valid, page: 2.9 })?.page).toBe(2)
  })

  it('refuses what is not a request', () => {
    for (const input of [
      null,
      undefined,
      'x',
      42,
      {},
      { ...valid, crawlId: 'not-an-id' },
      { ...valid, crawlId: 7 },
      { ...valid, urlHash: 'xyz' },
      { ...valid, urlHash: `${hashOf(A_HOME)}0` },
      { ...valid, direction: 'sideways' },
      { ...valid, direction: undefined },
    ]) {
      expect(parseLinksRequest(input)).toBeNull()
    }
  })
})
