/**
 * How long working out why URLs differ takes on a large pair, next to the analysis of the same
 * crawl. Not part of `pnpm test`. Run with a throwaway database (it is wiped):
 *
 *   BENCH_DATABASE_URL=file:/tmp/explain-bench.db pnpm exec tsx apps/worker/src/crawl/explain.benchmark.ts
 *   BENCH_DATABASE_URL=postgres://postgres:test@localhost:55434/c8_wp4 pnpm exec tsx apps/worker/src/crawl/explain.benchmark.ts
 *
 * Filling PostgreSQL through the repository takes hours; for PostgreSQL, build the pair on SQLite and
 * copy it with `copySqliteToPostgres` (`migrate-db`) before timing analysis and explanation there.
 *
 * The pair: two full crawls of `BENCH_URLS` internal URLs each (100,000 by default), half of them in
 * one crawl only. Every page links to the next five pages and to ten script chunks (the chunks
 * differ between the crawls, as after a deploy), the later crawl ignores `duration` (a tenth of the
 * earlier crawl's own URLs carry it), and the rest of each side's own pages are linked from shared
 * pages that the other crawl read whole, partly through chains.
 */
import { crawlUrlHash, type CrawlLinkKind } from '@seotools/core'
import {
  createCompany,
  createDatabase,
  explainPair,
  type CrawlLink,
  type Database,
  type NewCrawlUrl,
} from '@seotools/db'
import { analyseCrawl, currentAuditConfig } from './analysis'

const url = process.env.BENCH_DATABASE_URL
if (!url) throw new Error('Set BENCH_DATABASE_URL to a throwaway database')
const N = Number(process.env.BENCH_URLS ?? 100_000)
const SITE = 'https://bench.example'

const db: Database = await createDatabase({ url })
await db.migrate()
const created = await createCompany(db, { name: 'Bench', domain: `bench${Date.now()}.example` })
if (!created.ok) throw new Error('setup failed')
const domainId = created.domain.id
const host = created.domain.host

const page = (path: string) => `https://${host}${path}`
void SITE

/**
 * One crawl: `shared` pages both have, `own` pages only this one has, chunks of this build. Each
 * shared page `i` links pages i+1..i+5 and ten chunks; own page `k` is linked from shared page `k`
 * (every own page whose number is a multiple of 7 only through the own page before it: a chain).
 */
async function crawlOf(name: 'base' | 'target', ignored: string[]) {
  const shared = N / 2
  const own = N / 2 - 10
  await db.crawls.saveIgnoredParameters(domainId, ignored)
  const crawl = await db.crawls.start({ domainId, type: 'full', trigger: 'manual' })
  if (!crawl) throw new Error('crawl did not start')
  let seq = 0
  const seqOf = new Map<string, number>()
  const urls: NewCrawlUrl[] = []
  const add = (address: string) => {
    seqOf.set(address, ++seq)
    urls.push({
      url: address,
      urlHash: crawlUrlHash(address),
      scope: 'internal',
      source: seq === 1 ? 'seed' : 'link',
      depth: seq === 1 ? 0 : 1,
      seq,
    })
  }
  for (let i = 0; i < shared; i++) add(page(i === 0 ? '/' : `/p/${i}`))
  const chunks = Array.from({ length: 10 }, (_, k) => page(`/_nuxt/${name}-${k}.js`))
  for (const chunk of chunks) add(chunk)
  const ownUrls: string[] = []
  for (let k = 0; k < own; k++) {
    // A tenth of the earlier crawl's own URLs carry a parameter the later crawl ignores.
    const address =
      name === 'base' && k % 10 === 0 ? page(`/p/${k}?duration=60`) : page(`/${name}/${k}`)
    ownUrls.push(address)
    add(address)
  }
  for (let i = 0; i < urls.length; i += 5000)
    await db.crawls.addUrls(crawl.id, urls.slice(i, i + 5000))

  const linksOf = new Map<string, { to: string; kind: CrawlLinkKind }[]>()
  const link = (from: string, to: string, kind: CrawlLinkKind = 'anchor') => {
    const list = linksOf.get(from) ?? []
    list.push({ to, kind })
    linksOf.set(from, list)
  }
  for (let i = 0; i < shared; i++) {
    const from = page(i === 0 ? '/' : `/p/${i}`)
    for (let j = 1; j <= 5 && i + j < shared; j++) link(from, page(`/p/${i + j}`))
    for (const chunk of chunks) link(from, chunk, 'script')
  }
  ownUrls.forEach((address, k) => {
    if (k % 7 === 0 && k > 0) link(ownUrls[k - 1]!, address)
    else link(page(k === 0 ? '/' : `/p/${k % shared}`), address)
  })

  const result = (kind: 'page' | 'resource') => ({
    kind,
    statusCode: 200,
    contentType: kind === 'page' ? 'text/html' : 'text/javascript',
    redirectTo: null,
    title: 'A page',
    metaRobots: null,
    xRobotsTag: null,
    canonical: null,
    responseTimeMs: 10,
    bytes: 1000,
    error: null,
    data: null,
  })
  for (const address of seqOf.keys()) {
    const links: CrawlLink[] = (linksOf.get(address) ?? []).map(({ to, kind }) => ({
      sourceHash: crawlUrlHash(address),
      targetHash: crawlUrlHash(to),
      sourceSeq: seqOf.get(address)!,
      targetSeq: seqOf.get(to)!,
      kind,
    }))
    await db.crawls.recordResult({
      crawlId: crawl.id,
      urlHash: crawlUrlHash(address),
      result: result(address.endsWith('.js') ? 'resource' : 'page'),
      links,
    })
  }
  await db.crawls.finish(crawl.id, { status: 'completed' })
  return crawl.id
}

const time = async <T>(label: string, run: () => Promise<T>) => {
  const started = performance.now()
  const value = await run()
  const ms = Math.round(performance.now() - started)
  console.log(`${label}: ${ms} ms`)
  return { value, ms }
}

await time('build earlier crawl', () => crawlOf('base', []))
const baseId = (await db.crawls.list(domainId, { type: 'full' }))[0]!.id
await new Promise((resolve) => setTimeout(resolve, 5))
const { value: targetId } = await time('build later crawl', () => crawlOf('target', ['duration']))
const analysis = await time('analyse the later crawl', async () =>
  analyseCrawl(db, targetId, await currentAuditConfig(db, domainId)),
)
const explanation = await time('explain the pair', () =>
  explainPair({ db, baseId, targetId, runner: 'bench' }),
)
const ids = { domainId, baseId, targetId }
const page1 = await time('count and list a page (missing)', async () => {
  await db.crawls.compareCounts({ ...ids, view: 'pages' })
  await db.crawls.countCompared({ ...ids, change: 'missing', view: 'pages' })
  return db.crawls.compareUrls({ ...ids, change: 'missing', view: 'pages', limit: 50, offset: 0 })
})
const counts = await db.crawls.compareCounts({ ...ids, view: 'pages' })
const other = await db.crawls.compareCounts({ ...ids, view: 'other' })
console.log(
  JSON.stringify(
    {
      dialect: db.dialect,
      urlsPerCrawl: N,
      outcome: explanation.value,
      explainMs: explanation.ms,
      analysisMs: analysis.ms,
      share: `${((explanation.ms / analysis.ms) * 100).toFixed(1)} %`,
      pageMs: page1.ms,
      pages: {
        missing: counts?.missing,
        added: counts?.added,
        configuration: counts?.configuration,
        reasons: counts?.reasons,
      },
      other: {
        missing: other?.missing,
        added: other?.added,
        configuration: other?.configuration,
        reasons: other?.reasons,
      },
    },
    null,
    2,
  ),
)
await db.close()
