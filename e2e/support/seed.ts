import { createLogger } from '@seotools/core'
import { createCompany, createDatabase, type Database } from '@seotools/db'
import { runCrawl } from '../../apps/worker/src/crawl/engine'
import { fakeSite, moved, type Answer } from '../../apps/worker/src/crawl/fake-site'
import { SITE, page, sitemapOf } from '../../apps/worker/src/crawl/test-site'
import { DATABASE_URL, HOST, OTHER_HOST } from './env'

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
  const started = await db.crawls.start({
    domainId: created.domain.id,
    type: 'full',
    trigger: 'manual',
  })
  if (!started) throw new Error('the seed crawl did not start')
  await runCrawl(started.id, {
    db,
    log: createLogger('e2e-seed', 'silent'),
    signal: new AbortController().signal,
    createFetcher: fakeSite(website, 0).createFetcher,
    retryBaseMs: 1,
  })
  const crawl = await db.crawls.get(started.id)
  if (crawl?.status !== 'completed') throw new Error(`the seed crawl ended ${crawl?.status}`)
  return db
}
