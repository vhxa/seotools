import { compareWithCrawl, createLogger, crawlUrlHash } from '@seotools/core'
import { createCompany } from '@seotools/db'
import { createTestDatabase } from '@seotools/db/test'
import { expect, it } from 'vitest'
import { runCrawl } from './engine'
import { fakeSite } from './fake-site'
import { renderedOutcome } from './render-fixture'
import { SITE, page } from './test-site'
import { runVerification } from './verification'

/** Blocking WP4a regression: the design must decide how these two existing checks are scoped. */
it('does not report an unchanged rendered page as changed after an HTML-only recheck', async () => {
  const db = await createTestDatabase()
  try {
    const created = await createCompany(db, { name: 'Recheck', domain: 'example.com' })
    if (!created.ok) throw new Error('setup failed')
    const domainId = created.domain.id
    await db.crawls.saveSettings(domainId, {
      ...(await db.crawls.settings(domainId)),
      renderingMode: 'headless',
      requestsPerSecond: 100,
      maxRetries: 0,
    })
    const log = createLogger('test', 'silent')
    const signal = new AbortController().signal
    // Exactly the same served responses are used by both runs. Only the full crawl renders.
    const site = fakeSite(
      { [`${SITE}/`]: page('/', { links: '' }), [`${SITE}/menu`]: page('/menu') },
      0,
    )
    const crawl = (await db.crawls.start({ domainId, type: 'full', trigger: 'manual' }))!
    await runCrawl(crawl.id, {
      db,
      log,
      signal,
      createFetcher: site.createFetcher,
      renderService: {
        check: async () => ({ state: 'ready', checkedAt: new Date().toISOString() }),
        render: async (input) =>
          renderedOutcome(
            input,
            input.url === `${SITE}/` ? '<a href="/menu" rel="nofollow">Menu</a>' : '',
          ),
      },
    })
    const urlHash = crawlUrlHash(`${SITE}/`)
    const before = (await db.crawls.issuesOf(crawl.id, [urlHash])).map((row) => row.issue)
    const verification = (await db.verifications.start({
      domainId,
      baseCrawlId: crawl.id,
      urls: [{ url: `${SITE}/`, urlHash, source: 'seed' }],
    }))!
    await runVerification(verification.id, { db, log, signal, createFetcher: site.createFetcher })
    const verified = (await db.verifications.urlsOf(verification.id))[0]!
    const comparison = compareWithCrawl({
      crawl: before,
      recheck: verified.outcome!.findings.map((finding) => finding.issue),
      unchecked: verified.outcome!.unchecked,
    })
    expect({
      appeared: comparison.appeared.filter((id) => id === 'no-outgoing-links'),
      fixed: comparison.fixed.filter((id) => id === 'internal-nofollow-links'),
    }).toEqual({ appeared: [], fixed: [] })
  } finally {
    await db.close()
  }
})
