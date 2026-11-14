/** Capture with the same file on origin/feat/0.6.0; keep the earlier compressed baseline too. */
import { pathToFileURL } from 'node:url'
import {
  classifyFindings,
  crawlUrlHash,
  createLogger,
  evidenceOf,
  indexTraces,
} from '@seotools/core'
import { compareWithPrevious, createCompany, type Crawl } from '@seotools/db'
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
    return await htmlBaseline(db, crawl.id)
  } finally {
    await db.close()
  }
}

/**
 * What comparisons and alerts say between HTML crawls: three crawls of a site that fixes a title,
 * gains a finding, changes a rule and then goes back, so that `new`, `resolved`, `persistent`,
 * `reappeared` (with an earlier crawl under other rules) and `unverified` all occur. Every ordered
 * pair, with the crawls before and in between, and `compareWithPrevious` for each crawl.
 */
export async function captureHtmlComparisonBaseline() {
  const db = await createTestDatabase()
  try {
    const created = await createCompany(db, { name: 'HTML comparison', domain: 'example.com' })
    if (!created.ok) throw new Error('setup failed')
    const domainId = created.domain.id
    await db.crawls.saveSettings(domainId, {
      ...(await db.crawls.settings(domainId)),
      renderingMode: 'http',
      requestsPerSecond: 100,
      maxRetries: 0,
      retainCrawls: null,
    })
    const paths = ['/', '/a', '/b', '/c']
    const site = (variant: 0 | 1) => ({
      [`${SITE}/`]: page('/', {
        links: ['/a', '/b', '/c'].map((p) => `<a href="${p}">${p}</a>`).join(''),
      }),
      [`${SITE}/a`]: page('/a', variant === 0 ? { title: 'X', h1: null } : {}),
      [`${SITE}/b`]: page('/b', {
        title: 'Duplicate title long enough for audit',
        ...(variant === 1
          ? { description: null, head: '<meta name="robots" content="noindex">' }
          : {}),
      }),
      [`${SITE}/c`]: page('/c', {
        title: 'Duplicate title long enough for audit',
        ...(variant === 1 ? { canonical: '/b' } : {}),
      }),
      [`${SITE}/sitemap.xml`]: xml(sitemapOf(['/a', '/b'])),
    })
    const crawls: Crawl[] = []
    for (const [index, variant] of ([0, 1, 0] as const).entries()) {
      if (index === 1) {
        await db.audit.saveRule({
          domainId,
          rule: {
            dimension: 'intent',
            value: 'not-indexable',
            selector: { kind: 'path', path: '/b', query: { mode: 'any' }, scope: 'literal' },
            reason: null,
            enabled: true,
          },
        })
      }
      const started = (await db.crawls.start({ domainId, type: 'full', trigger: 'manual' }))!
      await runCrawl(started.id, {
        db,
        log: createLogger('baseline', 'silent'),
        createFetcher: fakeSite(site(variant), 0).createFetcher,
        signal: new AbortController().signal,
      })
      crawls.push((await db.crawls.get(started.id))!)
    }
    const hashes = paths.map((path) => crawlUrlHash(`${SITE}${path}`))
    const traces = indexTraces(
      await db.crawls.urlHistory({
        domainId,
        crawlIds: crawls.map((c) => c.id),
        urlHashes: hashes,
      }),
    )
    const pairs: unknown[] = []
    for (const [index, hash] of hashes.entries()) {
      const evidence = evidenceOf(crawls, traces, hash)
      for (let a = 0; a < crawls.length; a++)
        for (let b = 0; b < crawls.length; b++) {
          if (a === b) continue
          const [low, high] = a < b ? [a, b] : [b, a]
          pairs.push({
            url: paths[index],
            pair: [a, b],
            changes: classifyFindings({
              base: evidence[a]!,
              target: evidence[b]!,
              earlier: evidence.slice(0, low),
              between: evidence.slice(low + 1, high),
            }),
          })
        }
    }
    const alerts: unknown[] = []
    for (const target of crawls.slice(1)) {
      const comparison = await compareWithPrevious({ db, target, exact: true })
      alerts.push({
        findings: comparison.findings,
        important: comparison.important,
        byIssue: [...comparison.byIssue.entries()].sort(([x], [y]) => (x < y ? -1 : 1)),
        notes: comparison.notes,
      })
    }
    return { pairs, alerts }
  } finally {
    await db.close()
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const which =
    process.argv[2] === 'comparison' ? captureHtmlComparisonBaseline : captureHtmlBasisBaseline
  process.stdout.write(JSON.stringify(await which()) + '\n')
}
