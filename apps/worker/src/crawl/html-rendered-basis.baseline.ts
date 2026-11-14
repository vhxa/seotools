/** Capture with the same file on origin/feat/0.6.0; keep the earlier compressed baseline too. */
import { pathToFileURL } from 'node:url'
import { createLogger } from '@seotools/core'
import { createCompany } from '@seotools/db'
import { createTestDatabase } from '@seotools/db/test'
import { runCrawl } from './engine'
import { fakeSite } from './fake-site'
import { htmlBaseline } from './html-baseline'
import { SITE, page, sitemapOf, xml } from './test-site'

export async function captureHtmlBasisBaseline() {
  const db = await createTestDatabase()
  try {
    const created = await createCompany(db, { name: 'HTML baseline', domain: 'example.com' })
    if (!created.ok) throw new Error('setup failed')
    const domainId = created.domain.id
    await db.crawls.saveSettings(domainId, {
      ...(await db.crawls.settings(domainId)),
      renderingMode: 'http',
      requestsPerSecond: 100,
      maxRetries: 0,
    })
    await db.audit.saveRule({
      domainId,
      rule: {
        dimension: 'noindex',
        value: 'allowed',
        selector: { kind: 'path', path: '/accepted', query: { mode: 'any' }, scope: 'literal' },
        reason: null,
        enabled: true,
      },
    })
    const data = {
      [`${SITE}/`]: page('/', {
        links: ['/a', '/b', '/accepted', '/source'].map((p) => `<a href="${p}">${p}</a>`).join(''),
      }),
      [`${SITE}/a`]: page('/a', {
        title: 'X',
        description: null,
        h1: null,
        canonical: null,
        social: null,
        links: '<a href="/b" rel="nofollow">B</a><img src="/missing.png">',
      }),
      [`${SITE}/b`]: page('/b', {
        title: 'Duplicate title long enough for audit',
        head: '<meta name="robots" content="index,noindex"><link rel="alternate" hreflang="en" href="/source">',
      }),
      [`${SITE}/accepted`]: page('/accepted', { head: '<meta name="robots" content="noindex">' }),
      [`${SITE}/source`]: page('/source', {
        title: 'Duplicate title long enough for audit',
        canonical: '/b',
        head: '<script src="/source.js" defer></script>',
        links: '',
      }),
      [`${SITE}/source.js`]: {
        statusCode: 200,
        headers: { 'content-type': 'application/javascript' },
        body: Buffer.from("document.title='A different rendered title';"),
      },
      [`${SITE}/missing.png`]: { statusCode: 404, headers: {}, body: Buffer.from('missing') },
      [`${SITE}/sitemap.xml`]: xml(sitemapOf(['/a', '/b', '/accepted', '/source'])),
    }
    const crawl = (await db.crawls.start({ domainId, type: 'full', trigger: 'manual' }))!
    await runCrawl(crawl.id, {
      db,
      log: createLogger('baseline', 'silent'),
      createFetcher: fakeSite(data, 0).createFetcher,
      signal: new AbortController().signal,
    })
    return htmlBaseline(db, crawl.id)
  } finally {
    await db.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  process.stdout.write(JSON.stringify(await captureHtmlBasisBaseline()) + '\n')
}
