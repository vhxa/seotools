import { compareWithCrawl, createLogger, crawlUrlHash } from '@seotools/core'
import { createCompany } from '@seotools/db'
import { createTestDatabase } from '@seotools/db/test'
import { isUrlScopedIssue } from '@seotools/core/crawl/verification'
import { expect, it } from 'vitest'
import { detectFindings } from './issue-checks'
import { loadSite, type Site } from './site-audit'
import { runCrawl } from './engine'
import { fakeSite } from './fake-site'
import { renderedOutcome } from './render-fixture'
import { SITE, page } from './test-site'
import { runVerification } from './verification'

/** Rendered document findings are never settled by an HTML-only recheck. */
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
      {
        [`${SITE}/`]: page('/', { links: '' }),
        [`${SITE}/menu`]: page('/menu', { links: '<a href="/" rel="nofollow">Home</a>' }),
        [`${SITE}/followed`]: page('/followed'),
      },
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
            input.url === `${SITE}/`
              ? '<a href="/menu" rel="nofollow">Menu</a><a href="/followed">Followed</a>'
              : '',
          ),
      },
    })
    const stored = (await db.crawls.get(crawl.id))!
    const combined = await loadSite(db, stored, stored.auditSnapshot!)
    const linksFrom = db.crawls.linksFrom
    db.crawls.linksFrom = async (...args) =>
      (await linksFrom(...args)).filter((link) => !link.rendered)
    let htmlOnly: Site
    try {
      htmlOnly = await loadSite(db, stored, stored.auditSnapshot!)
    } finally {
      db.crawls.linksFrom = linksFrom
    }
    const urlFindings = (site: Site) =>
      site.urls.map((url) => {
        const { found, accepted } = detectFindings(url, site)
        return {
          url: url.url.url,
          found: found.filter(({ issue }) => isUrlScopedIssue(issue)),
          accepted: accepted.filter(({ issue }) => isUrlScopedIssue(issue)),
        }
      })
    expect(urlFindings(combined)).toEqual(urlFindings(htmlOnly))
    const home = combined.get(`${SITE}/`)!
    expect(home.internalAnchorsOut).toBe(2)
    expect(home.nofollowAnchorsOut).toBe(1)
    expect(home.linksTo).toHaveLength(2)
    expect(combined.get(`${SITE}/menu`)?.followedAnchorsIn).toBe(0)
    expect(combined.get(`${SITE}/followed`)?.followedAnchorsIn).toBe(1)
    expect(combined.get(`${SITE}/followed`)?.clickDepth).toBe(1)
    const urlHash = crawlUrlHash(`${SITE}/`)
    const before = (await db.crawls.issuesOf(crawl.id, [urlHash])).map((row) => row.issue)
    // Current domain settings cannot change the base crawl's document basis.
    await db.crawls.saveSettings(domainId, {
      ...(await db.crawls.settings(domainId)),
      renderingMode: 'http',
    })
    const verification = (await db.verifications.start({
      domainId,
      baseCrawlId: crawl.id,
      urls: [{ url: `${SITE}/`, urlHash, source: 'seed' }],
    }))!
    await runVerification(verification.id, { db, log, signal, createFetcher: site.createFetcher })
    const verified = (await db.verifications.urlsOf(verification.id))[0]!
    const comparison = compareWithCrawl({
      renderedBase: true,
      crawl: before,
      recheck: verified.outcome!.findings.map((finding) => finding.issue),
      unchecked: verified.outcome!.unchecked,
    })
    expect({
      appeared: comparison.appeared,
      fixed: comparison.fixed,
    }).toEqual({ appeared: [], fixed: [] })
  } finally {
    await db.close()
  }
})
