import {
  EMPTY_AUDIT_SNAPSHOT,
  MAX_EVIDENCE_ITEMS,
  crawlUrlHash,
  createLogger,
  type CrawlPageFacts,
  type IssueEvidence,
  type NewAuditRule,
  type PageIssueId,
} from '@seotools/core'
import { createCompany } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { analyseCrawl } from './analysis'
import { runCrawl } from './engine'
import { extractHtml } from './extract'
import { fakeSite, type Answer } from './fake-site'
import { SITE, page, sitemapOf, words, xml } from './test-site'

const log = createLogger('test', 'silent')
const HTTPS_PAGE = `${SITE}/blog/post`
const HTTP_PAGE = 'http://example.com/blog/post'
const evidenceOf = (html: string, pageUrl = HTTPS_PAGE) => extractHtml(html, pageUrl).facts

describe('the examples a page keeps of what is wrong with its images', () => {
  it('names each image by where it points and what finds it in the HTML', () => {
    const facts = evidenceOf(
      `<img src="/a.png" id="hero" class="  wide   rounded " width="1" height="1">
       <img src="/b.png" alt="" width="1" height="1">
       <img src="/c.png" alt="${'x'.repeat(150)}" width="1" height="1">
       <img src="https://cdn.example.net/d.png" alt="Fine">`,
    )
    expect(facts.imagesNoAlt).toBe(1)
    expect(facts.evidence?.images).toEqual({
      'no-alt': [
        { src: '/a.png', url: 'https://example.com/a.png', id: 'hero', class: 'wide rounded' },
      ],
      'empty-alt': [{ src: '/b.png', url: 'https://example.com/b.png' }],
      'long-alt': [{ src: '/c.png', url: 'https://example.com/c.png', alt: 'x'.repeat(150) }],
      'no-size': [{ src: 'https://cdn.example.net/d.png', url: 'https://cdn.example.net/d.png' }],
    })
  })

  it('finds a lazy-loaded image by the attribute that holds its address, and an inline one by its type', () => {
    const facts = evidenceOf(
      `<img data-src="/lazy.jpg" width="1" height="1">
       <img src="data:image/png;base64,${'A'.repeat(5000)}" width="1" height="1">
       <img width="1" height="1">`,
    )
    expect(facts.evidence?.images?.['no-alt']).toEqual([
      { src: '/lazy.jpg', url: 'https://example.com/lazy.jpg' },
      { src: 'data:image/png;base64,…', url: null },
      { src: '', url: null },
    ])
  })

  it('does not take an image marked as decorative for one that lacks a description', () => {
    const facts = evidenceOf(
      `<img src="/a.png" role="presentation" width="1" height="1"><img src="/b.png" alt="" aria-hidden="true" width="1" height="1">`,
    )
    expect(facts.imagesNoAlt + facts.imagesEmptyAlt).toBe(0)
    expect(facts.evidence).toBeUndefined()
  })

  it('counts all of them and keeps the first few, however much text each one has', () => {
    const images = Array.from(
      { length: 40 },
      (_, i) =>
        `<img src="/${'p'.repeat(5000)}${i}.png" class="${'c '.repeat(3000)}" id="${'i'.repeat(900)}" width="1" height="1">`,
    ).join('')
    const facts = evidenceOf(images)
    const samples = facts.evidence?.images?.['no-alt'] ?? []
    expect(facts.imagesNoAlt).toBe(40)
    expect(samples).toHaveLength(MAX_EVIDENCE_ITEMS)
    for (const sample of samples) {
      expect(sample.src.length).toBeLessThanOrEqual(200)
      expect(sample.class?.length).toBeLessThanOrEqual(200)
      expect(sample.id?.length).toBeLessThanOrEqual(100)
      // Too long to keep as something to link to.
      expect(sample.url).toBeNull()
    }
    expect(JSON.stringify(facts.evidence).length).toBeLessThan(10_000)
  })

  it('keeps nothing for a page with nothing wrong', () => {
    expect(evidenceOf('<img src="/a.png" alt="A fine image" width="1" height="1">').evidence).toBe(
      undefined,
    )
  })
})

describe('the examples a page keeps of its problematic links', () => {
  it('says where each link to localhost is, in any element that can hold one', () => {
    const facts = evidenceOf(
      `<a href="http://localhost:3000/y">Local copy</a>
       <img src="http://127.0.0.1/i.png" alt="x" width="1" height="1">
       <script src="http://app.localhost/s.js"></script>
       <a href="https://example.org/fine">Elsewhere</a>`,
      HTTP_PAGE,
    )
    expect(facts.localhostLinks).toBe(3)
    expect(facts.evidence?.links?.localhost).toEqual([
      { kind: 'anchor', url: 'http://localhost:3000/y' },
      { kind: 'image', url: 'http://127.0.0.1/i.png' },
      { kind: 'script', url: 'http://app.localhost/s.js' },
    ])
  })

  it('keeps what a link that cannot be crawled says, as written', () => {
    const facts = evidenceOf(
      `<a href="javascript:openMenu('${'x'.repeat(500)}')">Menu</a>
       <a href="#" onclick="go()">Scripted</a>
       <a onclick="go()">No href</a>
       <a href="#">Plain top of the page</a>`,
    )
    expect(facts.uncrawlableLinks).toBe(3)
    const samples = facts.evidence?.links?.uncrawlable ?? []
    expect(samples).toHaveLength(3)
    expect(samples[0]).toMatchObject({ kind: 'anchor', url: null, reason: 'javascript-url' })
    expect(samples[0]?.raw?.startsWith("javascript:openMenu('xxx")).toBe(true)
    expect(samples[0]?.raw).toHaveLength(200)
    expect(samples[1]).toEqual({ kind: 'anchor', url: null, raw: '#', reason: 'scripted' })
    expect(samples[2]).toEqual({ kind: 'anchor', url: null, reason: 'scripted' })
  })

  it('says what a vague link says and where it goes, and where an empty one goes', () => {
    const facts = evidenceOf(
      `<a href="/pricing">Click here</a><a href="/empty"><span></span></a><a href="/ok">Our pricing</a>`,
    )
    expect(facts.evidence?.links?.['vague-anchor']).toEqual([
      { kind: 'anchor', url: 'https://example.com/pricing', text: 'Click here' },
    ])
    expect(facts.evidence?.links?.['empty-anchor']).toEqual([
      { kind: 'anchor', url: 'https://example.com/empty' },
    ])
  })

  it('names what a secure page loads or posts over HTTP, or without saying the scheme', () => {
    const facts = evidenceOf(
      `<script src="http://example.org/a.js"></script>
       <img src="//cdn.example.net/b.png" alt="x" width="1" height="1">
       <form action="http://example.org/send" method="post"></form>
       <a href="https://other.example.net/" target="_blank">Another site</a>`,
    )
    expect(facts.evidence?.links?.['mixed-content']).toEqual([
      { kind: 'script', url: 'http://example.org/a.js' },
    ])
    expect(facts.evidence?.links?.['protocol-relative']).toEqual([
      { kind: 'image', url: 'https://cdn.example.net/b.png', raw: '//cdn.example.net/b.png' },
    ])
    expect(facts.evidence?.links?.['insecure-form']).toEqual([
      { kind: 'form', url: 'http://example.org/send' },
    ])
    expect(facts.evidence?.links?.['unsafe-blank']).toEqual([
      { kind: 'anchor', url: 'https://other.example.net/' },
    ])
  })

  it('counts every link of a kind and keeps the first few', () => {
    const links = Array.from({ length: 30 }, (_, i) => `<a href="http://localhost/${i}">x</a>`)
    const facts = evidenceOf(links.join(''))
    expect(facts.localhostLinks).toBe(30)
    expect(facts.evidence?.links?.localhost).toHaveLength(MAX_EVIDENCE_ITEMS)
    expect(facts.evidence?.links?.localhost?.[0]?.url).toBe('http://localhost/0')
  })
})

// --- what a crawl stores as the evidence of a finding ------------------------------------------------

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

/** A site of pages that have nothing wrong, as the home page links to every one of them. */
function site(pages: Record<string, Answer>) {
  const paths = Object.keys(pages)
  const answers: Record<string, Answer> = {
    [`${SITE}/`]: page('/', {
      links: paths.map((path) => `<a href="${path}">A link to ${path}</a>`).join(''),
    }),
    [`${SITE}/sitemap.xml`]: xml(sitemapOf(['/', ...paths])),
  }
  for (const [path, answer] of Object.entries(pages)) answers[`${SITE}${path}`] = answer
  return answers
}

async function crawl(answers: Record<string, Answer>, rules: NewAuditRule[] = []) {
  for (const rule of rules) {
    const saved = await db.audit.saveRule({ domainId, rule })
    if (!saved.ok) throw new Error(`rule not saved: ${saved.error}`)
  }
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

const hashOf = (path: string) => crawlUrlHash(`${SITE}${path}`)
const finding = async (crawlId: string, path: string, issue: PageIssueId) =>
  (await db.crawls.issuesOf(crawlId, [hashOf(path)])).find((row) => row.issue === issue)
const evidenceAt = async (crawlId: string, path: string, issue: PageIssueId) =>
  (await finding(crawlId, path, issue))?.evidence
const exclusion = (path: string): NewAuditRule => ({
  dimension: 'audit',
  value: 'exclude',
  selector: { kind: 'path', path, query: { mode: 'any' }, scope: 'literal' },
  reason: null,
  enabled: true,
})

describe('the evidence a finding is stored with', () => {
  it('lists the images without a description of a page, resolved', async () => {
    const id = await crawl(
      site({
        '/x': page('/x', {
          body: '<img src="/img/a.png" id="logo" width="1" height="1"><img src="https://cdn.example.net/b.png" width="1" height="1">',
        }),
      }),
    )
    expect(await evidenceAt(id, '/x', 'img-no-alt')).toEqual({
      kind: 'images',
      total: 2,
      items: [
        { src: '/img/a.png', url: `${SITE}/img/a.png`, id: 'logo' },
        { src: 'https://cdn.example.net/b.png', url: 'https://cdn.example.net/b.png' },
      ],
    })
  })

  it('lists the other pages that have the same title, and every page lists the rest', async () => {
    const id = await crawl(
      site({
        '/b': page('/b', { title: 'The very same title, shared by three pages' }),
        '/a': page('/a', { title: 'The very same title, shared by three pages' }),
        '/c': page('/c', { title: 'The  VERY same title, shared by three pages ' }),
      }),
    )
    expect(await evidenceAt(id, '/a', 'title-duplicate')).toEqual({
      kind: 'related-urls',
      total: 2,
      urls: [`${SITE}/b`, `${SITE}/c`],
    })
    expect(await evidenceAt(id, '/c', 'title-duplicate')).toEqual({
      kind: 'related-urls',
      total: 2,
      urls: [`${SITE}/a`, `${SITE}/b`],
    })
  })

  it('has evidence for each way of being a duplicate', async () => {
    const description = 'The same description, long enough not to be called too short at all.'
    const id = await crawl(
      site({
        '/x': page('/x', { description, h1: 'The same heading', text: words('same') }),
        '/y': page('/y', { description, h1: 'The same heading', text: words('same') }),
      }),
    )
    for (const issue of [
      'description-duplicate',
      'h1-duplicate',
      'content-duplicate',
    ] as const satisfies PageIssueId[]) {
      expect(await evidenceAt(id, '/x', issue)).toEqual({
        kind: 'related-urls',
        total: 1,
        urls: [`${SITE}/y`],
      })
    }
  })

  it('lists the near copies of a page, and says so when it only found some', async () => {
    const id = await crawl(
      site({
        '/x': page('/x', { text: `${words('same', 1000)} one`, h1: 'Heading', h2: 'Other' }),
        '/y': page('/y', { text: `${words('same', 1000)} two`, h1: 'Heading', h2: 'Other' }),
      }),
    )
    expect(await evidenceAt(id, '/x', 'content-near-duplicate')).toEqual({
      kind: 'related-urls',
      total: 1,
      urls: [`${SITE}/y`],
    })
  })

  it('keeps a page left out of the audit out of the comparison, and out of the evidence', async () => {
    const same = 'The very same title, shared by three pages'
    const pages = {
      '/a': page('/a', { title: same }),
      '/b': page('/b', { title: same }),
      '/c': page('/c', { title: same }),
    }
    const id = await crawl(site(pages), [exclusion('/b')])
    // /b is still a copy as far as the site goes, but it is not one an audited page answers for.
    expect(await evidenceAt(id, '/a', 'title-duplicate')).toEqual({
      kind: 'related-urls',
      total: 1,
      urls: [`${SITE}/c`],
    })
    expect(await db.crawls.issuesOf(id, [hashOf('/b')])).toEqual([])
  })

  it('lists a page of any number of copies by a sample, and counts all of them', async () => {
    const same = 'A title that more than a few pages have in common'
    const pages: Record<string, Answer> = {}
    for (let i = 0; i < 25; i++) {
      const path = `/p${String(i).padStart(2, '0')}`
      pages[path] = page(path, { title: same })
    }
    const id = await crawl(site(pages))
    const evidence = await evidenceAt(id, '/p07', 'title-duplicate')
    expect(evidence).toMatchObject({ kind: 'related-urls', total: 24 })
    const urls = (evidence as Extract<IssueEvidence, { kind: 'related-urls' }>).urls
    expect(urls).toHaveLength(MAX_EVIDENCE_ITEMS)
    expect(urls[0]).toBe(`${SITE}/p00`)
    expect(urls).not.toContain(`${SITE}/p07`)
  })

  it('shows the canonicals a page declares when they disagree, and where each was declared', async () => {
    const id = await crawl(
      site({
        '/x': page('/x', {
          canonical: `${SITE}/x`,
          head: '<link rel="canonical" href="/other">',
          headers: { link: `<${SITE}/third>; rel="canonical"` },
        }),
      }),
    )
    expect(await evidenceAt(id, '/x', 'canonical-conflict')).toEqual({
      kind: 'canonicals',
      total: 3,
      items: [
        { raw: `${SITE}/x`, url: `${SITE}/x`, inHead: true, source: 'html' },
        { raw: '/other', url: `${SITE}/other`, inHead: true, source: 'html' },
        { raw: `${SITE}/third`, url: `${SITE}/third`, inHead: true, source: 'header' },
      ],
    })
  })

  it('shows only the declarations that are the problem', async () => {
    const id = await crawl(
      site({
        '/x': page('/x', {
          canonical: `${SITE}/x`,
          body: '<link rel="canonical" href="/x#top">',
        }),
      }),
    )
    expect(await evidenceAt(id, '/x', 'canonical-outside-head')).toEqual({
      kind: 'canonicals',
      total: 1,
      items: [{ raw: '/x#top', url: `${SITE}/x`, inHead: false, source: 'html' }],
    })
    expect(await evidenceAt(id, '/x', 'canonical-fragment')).toMatchObject({
      total: 1,
      items: [{ raw: '/x#top' }],
    })
    expect(await evidenceAt(id, '/x', 'canonical-relative')).toMatchObject({
      total: 1,
      items: [{ raw: '/x#top' }],
    })
    // Declared twice, with the same value once resolved: both are the repetition.
    expect(await evidenceAt(id, '/x', 'canonical-repeated')).toMatchObject({ total: 2 })
  })

  it('says where a page links to localhost', async () => {
    const id = await crawl(
      site({ '/x': page('/x', { body: '<a href="http://localhost:3000/dev">Local copy</a>' }) }),
    )
    expect(await evidenceAt(id, '/x', 'link-to-localhost')).toEqual({
      kind: 'links',
      total: 1,
      items: [{ kind: 'anchor', url: 'http://localhost:3000/dev' }],
    })
  })

  it('has no evidence for an issue that does not come with any', async () => {
    const id = await crawl(site({ '/x': page('/x', { title: 'Short' }) }))
    const found = await finding(id, '/x', 'title-too-short')
    expect(found).toEqual({ urlHash: hashOf('/x'), issue: 'title-too-short' })
  })
})

describe('a crawl from before the evidence was kept', () => {
  /** What a page parsed by the previous version stored: no examples, no place for a canonical. */
  async function asParsedBefore(crawlId: string, path: string) {
    const stored = await db.crawls.getUrl(crawlId, hashOf(path))
    const facts = stored!.data!.facts!
    const { evidence: _evidence, ...old } = facts
    const before: CrawlPageFacts = {
      ...old,
      canonicals: facts.canonicals.map(({ source: _source, ...rest }) => rest),
    }
    await db.crawls.recordResult({
      crawlId,
      urlHash: hashOf(path),
      result: { ...stored!, data: { ...stored!.data, facts: before } },
    })
  }

  it('finds the same issues, and does not make up examples it never saw', async () => {
    const id = await crawl(
      site({
        '/x': page('/x', {
          body: '<img src="/a.png" width="1" height="1"><a href="http://localhost/dev">Dev</a>',
        }),
      }),
    )
    expect(await evidenceAt(id, '/x', 'img-no-alt')).toBeDefined()

    await asParsedBefore(id, '/x')
    await analyseCrawl(db, id, EMPTY_AUDIT_SNAPSHOT)
    for (const issue of ['img-no-alt', 'link-to-localhost'] as const) {
      const found = await finding(id, '/x', issue)
      expect(found).toEqual({ urlHash: hashOf('/x'), issue })
    }
  })

  it('still has the evidence that comes from what the crawl did store', async () => {
    const same = 'The very same title, shared by two pages'
    const id = await crawl(
      site({
        '/x': page('/x', { title: same, head: '<link rel="canonical" href="/other">' }),
        '/y': page('/y', { title: same }),
      }),
    )
    await asParsedBefore(id, '/x')
    await analyseCrawl(db, id, EMPTY_AUDIT_SNAPSHOT)
    expect(await evidenceAt(id, '/x', 'title-duplicate')).toMatchObject({
      kind: 'related-urls',
      urls: [`${SITE}/y`],
    })
    // The declarations are all there, though it cannot say where each one was declared.
    expect(await evidenceAt(id, '/x', 'canonical-conflict')).toMatchObject({
      kind: 'canonicals',
      items: [
        { raw: `${SITE}/x`, source: null },
        { raw: '/other', source: null },
      ],
    })
  })
})
