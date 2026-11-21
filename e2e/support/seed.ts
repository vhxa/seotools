import { createLogger, ISSUE_CATALOG_VERSION } from '@seotools/core'
import { createCompany, createDatabase, type Database } from '@seotools/db'
import { currentAuditConfig } from '../../apps/worker/src/crawl/analysis'
import { runCrawl } from '../../apps/worker/src/crawl/engine'
import { fakeSite, moved, type Answer } from '../../apps/worker/src/crawl/fake-site'
import { SITE, page, sitemapOf } from '../../apps/worker/src/crawl/test-site'
import {
  DATABASE_URL,
  HOST,
  OTHER_HOST,
  RENDERED_HOST,
  RENDERED_PAGES,
  RENDERED_UNOBSERVED,
} from './env'

const xml = (body: string): Answer => ({
  statusCode: 200,
  headers: { 'content-type': 'application/xml' },
  body: Buffer.from(body),
})

/** A small site the real crawler walks: nothing is requested over the network. */
const website: Record<string, Answer> = {
  [`${SITE}/`]: page('/', {
    links: `<nav><a href="/about">About us</a> <a href="/products">Products</a> <a href="/old">Old page</a></nav>
      <p><a href="/missing">A page that is gone</a></p>`,
  }),
  [`${SITE}/about`]: page('/about', { title: null }),
  [`${SITE}/products`]: page('/products', {
    links: `<a href="/">Home</a><main><p>Sorted <a href="/products?sort=price">by price</a>.
      See the <a href="/products/widget">widget</a>.</p></main>`,
  }),
  [`${SITE}/products/widget`]: page('/products/widget'),
  [`${SITE}/products?sort=price`]: page('/products?sort=price', {
    canonical: `${SITE}/products`,
  }),
  [`${SITE}/old`]: moved(`${SITE}/about`),
  [`${SITE}/sitemap.xml`]: xml(sitemapOf(['/', '/about', '/products'])),
}

/** Creates a company with one domain and a finished full crawl, analysed by the real worker code. */
export async function seed(): Promise<Database> {
  const db = await createDatabase({ url: DATABASE_URL, dialect: 'sqlite' })
  await db.migrate()
  const created = await createCompany(db, { name: 'Acme', domain: HOST })
  if (!created.ok) throw new Error('could not create the seed company')
  const other = await createCompany(db, { name: 'Elsewhere', domain: OTHER_HOST })
  if (!other.ok) throw new Error('could not create the second company')
  await seedRenderedCrawl(db)
  const started = await db.crawls.start({
    domainId: created.domain.id,
    type: 'full',
    trigger: 'manual',
  })
  if (!started) throw new Error('the seed crawl did not start')
  let draws = 0
  await runCrawl(started.id, {
    db,
    log: createLogger('e2e-seed', 'silent'),
    signal: new AbortController().signal,
    createFetcher: fakeSite(
      {
        ...website,
        [`${SITE}/products?sort=price`]: () =>
          page('/products?sort=price', {
            canonical: `${SITE}/products`,
            ...(draws++
              ? {
                  title: 'A different product listing',
                  links: '<a href="/special">Special offer</a>',
                }
              : {}),
          }),
      },
      0,
    ).createFetcher,
    retryBaseMs: 1,
  })
  const crawl = await db.crawls.get(started.id)
  if (crawl?.status !== 'completed') throw new Error(`the seed crawl ended ${crawl?.status}`)
  await settleJobs(db)
  return db
}

/**
 * The seed crawls run without a worker, so their jobs would stay queued and the interface would say
 * the crawl is still being processed. Completes them as a worker would have.
 */
async function settleJobs(db: Database) {
  const workerId = 'e2e-seed'
  const jobs = await db.jobs.claim({ workerId, limit: 100 })
  for (const job of jobs) await db.jobs.complete({ id: job.id, workerId })
}

/**
 * A rendered crawl that left more than a thousand pages unobserved, analysed with a snapshot that
 * records it: only that coverage is made up, so that the lists and the dashboard can show it. No
 * page is stored.
 */
async function seedRenderedCrawl(db: Database) {
  const company = await createCompany(db, { name: 'Browser Ltd', domain: RENDERED_HOST })
  if (!company.ok) throw new Error('could not create the rendered company')
  const domainId = company.domain.id
  const older = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
  if (!older) throw new Error('could not start the retention fixture')
  await runCrawl(older.id, {
    db,
    log: createLogger('e2e-seed', 'silent'),
    signal: new AbortController().signal,
    createFetcher: fakeSite({ [`https://${RENDERED_HOST}/`]: page('/') }).createFetcher,
  })
  await db.crawls.saveSettings(domainId, {
    ...(await db.crawls.settings(domainId)),
    renderingMode: 'headless',
  })
  const crawl = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
  if (!crawl) throw new Error('the rendered crawl did not start')
  await db.crawls.finish(crawl.id, { status: 'completed' })
  await db.crawls.prune({ domainId, type: 'full', keep: 1 })
  const config = await currentAuditConfig(db, domainId)
  await db.crawls.saveAnalysis({
    crawlId: crawl.id,
    issues: [],
    pages: { issue: 0, warning: 0, opportunity: 0 },
    withType: { issue: 0, warning: 0, opportunity: 0 },
    catalog: ISSUE_CATALOG_VERSION,
    audit: {
      snapshot: {
        ...config,
        rendering: 'rendered',
        documentBasis: 'rendered-v1',
        rendersUnobserved: RENDERED_UNOBSERVED,
        renderCoverage: { failedOrMissing: 0, truncated: 0, unsettled: RENDERED_UNOBSERVED },
      },
      pages: {
        audited: RENDERED_PAGES,
        excluded: 0,
        indexable: RENDERED_PAGES,
        notIndexable: 0,
        unknownIndexability: 0,
      },
      urls: [],
    },
  })
}
