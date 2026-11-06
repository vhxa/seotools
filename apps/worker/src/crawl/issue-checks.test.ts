import {
  EMPTY_AUDIT_SNAPSHOT,
  PAGE_ISSUE_IDS,
  crawlUrlHash,
  createLogger,
  type NewAuditRule,
  type PageIssueId,
} from '@seotools/core'
import { createCompany } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { analyseCrawl } from './analysis'
import { runCrawl } from './engine'
import { fakeSite, moved, type Answer } from './fake-site'
import { FetchError } from './fetcher'
import { SAFE_HEADERS, SITE, page, sitemapOf, words, xml } from './test-site'
import { CHECKS } from './issue-checks'
import { isValidHreflang } from './language-codes'
import { parseRobotsDirectives, type AuditedUrl, type Site } from './site-audit'

const log = createLogger('test', 'silent')
interface Scenario {
  /** Where the issue should be found: a path, or an absolute URL. */
  at: string
  pages?: Record<string, Answer>
  /** Paths or URLs the home page links to, on top of every page in `pages`. */
  homeLinks?: string
  /** Pages the home page does not link to. */
  notLinked?: readonly string[]
  /** Pages the sitemap does not list. */
  notInSitemap?: readonly string[]
  robots?: string
  details?: string[]
  /** Rules and exceptions in force when the site is crawled. */
  rules?: NewAuditRule[]
}

function websiteOf({
  pages = {},
  homeLinks = '',
  notLinked = [],
  notInSitemap = [],
  robots,
}: Scenario) {
  const paths = Object.keys(pages)
  const anchors = paths
    .filter((path) => !notLinked.includes(path))
    .map((path) => `<a href="${path}">A link to ${path}</a>`)
    .join('')
  const listed = ['/', ...paths].filter((path) => !notInSitemap.includes(path))
  const site: Record<string, Answer> = {
    [`${SITE}/`]: page('/', { links: anchors + homeLinks + `<a href="/about">About us</a>` }),
    [`${SITE}/about`]: page('/about'),
    [`${SITE}/sitemap.xml`]: xml(sitemapOf([...listed, '/about'])),
    ...(robots
      ? {
          [`${SITE}/robots.txt`]: {
            statusCode: 200,
            headers: { 'content-type': 'text/plain' },
            body: Buffer.from(robots),
          },
        }
      : {}),
  }
  for (const [path, answer] of Object.entries(pages)) {
    site[path.startsWith('http') ? path : `${SITE}${path}`] = answer
  }
  return site
}

/** A rule declaring what a path is expected to be. */
const expecting = (path: string, value: 'indexable' | 'not-indexable'): NewAuditRule => ({
  dimension: 'intent',
  value,
  selector: { kind: 'path', path, query: { mode: 'any' }, scope: 'literal' },
  reason: null,
  enabled: true,
})

/** A rule asking something of a condition of a path. */
const asking = (
  path: string,
  dimension: 'noindex' | 'nofollow' | 'robots' | 'sitemap',
  value: 'required' | 'allowed' | 'forbidden',
): NewAuditRule => ({
  dimension,
  value,
  selector: { kind: 'path', path, query: { mode: 'any' }, scope: 'literal' },
  reason: null,
  enabled: true,
})

const SCENARIOS: Record<PageIssueId, Scenario> = {
  // --- what is expected of a URL's indexation ------------------------------
  'expected-indexable-blocked': {
    at: '/x',
    pages: { '/x': page('/x', { head: '<meta name="robots" content="noindex">' }) },
    rules: [expecting('/x', 'indexable')],
    details: ['noindex'],
  },
  'noindex-required-missing': {
    at: '/x',
    pages: { '/x': page('/x') },
    rules: [asking('/x', 'noindex', 'required')],
  },
  'nofollow-required-missing': {
    at: '/x',
    pages: { '/x': page('/x') },
    rules: [asking('/x', 'nofollow', 'required')],
  },
  'robots-block-required-missing': {
    at: '/x',
    pages: { '/x': page('/x') },
    robots: 'User-agent: *\nDisallow: /private',
    rules: [asking('/x', 'robots', 'required')],
  },
  'sitemap-required-missing': {
    at: '/x',
    pages: { '/x': page('/x') },
    notInSitemap: ['/x'],
    rules: [asking('/x', 'sitemap', 'required')],
  },
  'sitemap-forbidden-present': {
    at: '/x',
    pages: { '/x': page('/x') },
    rules: [asking('/x', 'sitemap', 'forbidden')],
  },
  'expected-not-indexable-but-indexable': {
    at: '/x',
    pages: { '/x': page('/x') },
    rules: [expecting('/x', 'not-indexable')],
  },

  // --- response codes ------------------------------------------------------
  'no-response': { at: '/x', pages: { '/x': new FetchError('ECONNRESET', 'reset') } },
  'server-error': { at: '/x', pages: { '/x': { statusCode: 500, headers: {} } } },
  'client-error': { at: '/x', pages: { '/x': { statusCode: 404, headers: {} } } },
  'redirect-loop': { at: '/x', pages: { '/x': moved('/y'), '/y': moved('/x') } },
  'soft-404-confirmed': {
    at: '/x',
    pages: { '/x': page('/x', { title: 'Page not found on this site, sorry', text: 'Nothing.' }) },
  },
  'soft-404-possible': {
    at: '/x',
    pages: { '/x': page('/x', { text: 'Sorry, the offer you wanted does not exist any more.' }) },
  },
  'redirect-chain': {
    at: '/x',
    pages: { '/x': moved('/y'), '/y': moved('/z'), '/z': page('/z') },
    notLinked: ['/y', '/z'],
  },
  'refresh-redirect': {
    at: '/x',
    pages: { '/x': page('/x', { head: '<meta http-equiv="refresh" content="0; url=/about">' }) },
  },
  'robots-blocked': {
    at: '/x',
    pages: { '/x': page('/x') },
    robots: 'User-agent: *\nDisallow: /x\n',
  },
  'redirect-3xx': { at: '/x', pages: { '/x': moved('/about') } },
  'broken-external-link': {
    at: 'https://elsewhere.org/gone',
    homeLinks: '<a href="https://elsewhere.org/gone">A link elsewhere</a>',
  },

  // --- directives ----------------------------------------------------------
  'directive-outside-head': {
    at: '/x',
    pages: { '/x': page('/x', { body: '<meta name="robots" content="index">' }) },
  },
  'directives-conflict': {
    at: '/x',
    pages: {
      '/x': page('/x', {
        head: '<meta name="robots" content="noindex"><meta name="robots" content="index">',
      }),
    },
  },
  'directives-conflict-snippets': {
    at: '/x',
    pages: {
      '/x': page('/x', {
        head: '<meta name="robots" content="nosnippet, max-snippet:50">',
      }),
    },
  },
  'directives-unreadable': {
    at: '/x',
    pages: { '/x': page('/x', { head: '<meta name="robots" content="noindex">' }) },
    robots: 'User-agent: *\nDisallow: /x\n',
    details: ['noindex'],
  },
  noindex: {
    at: '/x',
    pages: { '/x': page('/x', { head: '<meta name="robots" content="noindex">' }) },
  },
  nofollow: {
    at: '/x',
    pages: { '/x': page('/x', { head: '<meta name="robots" content="nofollow">' }) },
  },
  nosnippet: {
    at: '/x',
    pages: { '/x': page('/x', { head: '<meta name="robots" content="max-snippet:0">' }) },
  },
  'max-snippet-limited': {
    at: '/x',
    pages: { '/x': page('/x', { head: '<meta name="robots" content="max-snippet:10">' }) },
  },
  noimageindex: {
    at: '/x',
    pages: { '/x': page('/x', { head: '<meta name="robots" content="noimageindex">' }) },
  },
  'unavailable-after-expired': {
    at: '/x',
    pages: {
      '/x': page('/x', { head: '<meta name="robots" content="unavailable_after: 2000-01-01">' }),
    },
  },
  'unavailable-after-future': {
    at: '/x',
    pages: {
      '/x': page('/x', { head: '<meta name="robots" content="unavailable_after: 2999-01-01">' }),
    },
  },

  // --- canonicals ----------------------------------------------------------
  'canonical-outside-head': {
    at: '/x',
    pages: { '/x': page('/x', { canonical: null, body: '<link rel="canonical" href="/x">' }) },
  },
  'canonical-conflict': {
    at: '/x',
    pages: { '/x': page('/x', { head: '<link rel="canonical" href="/about">' }) },
  },
  'canonical-broken': {
    at: '/x',
    pages: {
      '/x': page('/x', { canonical: `${SITE}/y` }),
      '/y': { statusCode: 404, headers: {} },
    },
  },
  'canonical-redirect': {
    at: '/x',
    pages: { '/x': page('/x', { canonical: `${SITE}/y` }), '/y': moved('/about') },
  },
  'canonical-not-indexable': {
    at: '/x',
    pages: {
      '/x': page('/x', { canonical: `${SITE}/y` }),
      '/y': page('/y', { head: '<meta name="robots" content="noindex">' }),
    },
  },
  'canonical-fragment': { at: '/x', pages: { '/x': page('/x', { canonical: `${SITE}/x#top` }) } },
  'canonical-missing': { at: '/x', pages: { '/x': page('/x', { canonical: null }) } },
  'canonical-relative': { at: '/x', pages: { '/x': page('/x', { canonical: '/x' }) } },
  'canonical-repeated': {
    at: '/x',
    pages: { '/x': page('/x', { head: `<link rel="canonical" href="${SITE}/x">` }) },
  },

  // --- sitemaps ------------------------------------------------------------
  // Fifty thousand URLs would take a while to crawl. See the test of its own below.
  'sitemap-too-big': { at: '/sitemap.xml' },
  'sitemap-broken': { at: '/x', pages: { '/x': { statusCode: 410, headers: {} } } },
  'sitemap-redirect': { at: '/x', pages: { '/x': moved('/about') } },
  'sitemap-not-indexable': {
    at: '/x',
    pages: { '/x': page('/x', { head: '<meta name="robots" content="noindex">' }) },
  },
  // Nothing says what a search engine has indexed yet. See the test of its own below.
  'indexed-not-in-sitemap': { at: '/x', pages: { '/x': page('/x') }, notInSitemap: ['/x'] },
  'indexable-not-in-sitemap': { at: '/x', pages: { '/x': page('/x') }, notInSitemap: ['/x'] },

  // --- hreflang ------------------------------------------------------------
  'hreflang-unreachable': {
    at: '/x',
    details: ['html'],
    pages: { '/x': page('/x', { head: '<link rel="alternate" hreflang="es" href="/es">' }) },
  },
  'hreflang-redirect': {
    at: '/x',
    details: ['html'],
    pages: {
      '/x': page('/x', { head: '<link rel="alternate" hreflang="es" href="/es">' }),
      '/es': moved('/about'),
    },
  },
  'hreflang-no-return': {
    at: '/x',
    details: ['html'],
    pages: {
      '/x': page('/x', { head: '<link rel="alternate" hreflang="es" href="/es">' }),
      '/es': page('/es'),
    },
  },
  'hreflang-invalid-code': {
    at: '/x',
    details: ['html'],
    pages: { '/x': page('/x', { head: '<link rel="alternate" hreflang="en-UK" href="/x">' }) },
  },
  'hreflang-outside-head': {
    at: '/x',
    details: ['html'],
    pages: { '/x': page('/x', { body: '<link rel="alternate" hreflang="en" href="/x">' }) },
  },
  'hreflang-non-canonical': {
    at: '/x',
    details: ['html'],
    pages: {
      '/x': page('/x', { head: '<link rel="alternate" hreflang="es" href="/es">' }),
      '/es': page('/es', { canonical: `${SITE}/about` }),
    },
  },
  'hreflang-noindex': {
    at: '/x',
    details: ['html'],
    pages: {
      '/x': page('/x', { head: '<link rel="alternate" hreflang="es" href="/es">' }),
      '/es': page('/es', { head: '<meta name="robots" content="noindex">' }),
    },
  },
  'hreflang-same-language': {
    at: '/x',
    details: ['html'],
    pages: {
      '/x': page('/x', {
        head: '<link rel="alternate" hreflang="es" href="/es"><link rel="alternate" hreflang="ES" href="/about">',
      }),
    },
  },
  'hreflang-no-self': {
    at: '/x',
    details: ['html'],
    pages: { '/x': page('/x', { head: '<link rel="alternate" hreflang="es" href="/about">' }) },
  },
  'hreflang-no-x-default': {
    at: '/x',
    details: ['html'],
    pages: { '/x': page('/x', { head: '<link rel="alternate" hreflang="en" href="/x">' }) },
  },

  // --- title ---------------------------------------------------------------
  'title-missing': { at: '/x', pages: { '/x': page('/x', { title: null }) } },
  'title-outside-head': {
    at: '/x',
    pages: {
      '/x': page('/x', { title: null, body: '<title>A title in the wrong place, sadly</title>' }),
    },
  },
  'title-multiple': {
    at: '/x',
    pages: { '/x': page('/x', { head: '<title>Another title for this same page</title>' }) },
  },
  'title-duplicate': {
    at: '/x',
    pages: {
      '/x': page('/x', { title: 'The very same title for both of them' }),
      '/y': page('/y', { title: 'The  very same TITLE for both of them' }),
    },
  },
  'title-too-long': {
    at: '/x',
    pages: { '/x': page('/x', { title: 'A very long title '.repeat(5) }) },
  },
  'title-too-short': { at: '/x', pages: { '/x': page('/x', { title: 'Short' }) } },

  // --- meta description ----------------------------------------------------
  'description-multiple': {
    at: '/x',
    pages: { '/x': page('/x', { head: '<meta name="description" content="Another one">' }) },
  },
  'description-outside-head': {
    at: '/x',
    pages: { '/x': page('/x', { body: '<meta name="description" content="In the body">' }) },
  },
  'description-missing': { at: '/x', pages: { '/x': page('/x', { description: null }) } },
  'description-duplicate': {
    at: '/x',
    pages: {
      '/x': page('/x', {
        description: 'The same description, long enough not to be called too short.',
      }),
      '/y': page('/y', {
        description: 'The same description, long enough not to be called too short.',
      }),
    },
  },
  'description-too-long': {
    at: '/x',
    pages: { '/x': page('/x', { description: 'A very long description. '.repeat(10) }) },
  },
  'description-too-short': { at: '/x', pages: { '/x': page('/x', { description: 'Short.' }) } },

  // --- headings ------------------------------------------------------------
  'h1-missing': { at: '/x', pages: { '/x': page('/x', { h1: null }) } },
  'h1-multiple': { at: '/x', pages: { '/x': page('/x', { body: '<h1>One more</h1>' }) } },
  'heading-empty': { at: '/x', pages: { '/x': page('/x', { body: '<h3> </h3>' }) } },
  'heading-skipped-level': { at: '/x', pages: { '/x': page('/x', { body: '<h4>Down two</h4>' }) } },
  'h2-missing': {
    at: '/x',
    pages: { '/x': page('/x', { h2: null, text: words('/x', 400) }) },
  },
  'h1-duplicate': {
    at: '/x',
    pages: {
      '/x': page('/x', { h1: 'The same heading' }),
      '/y': page('/y', { h1: 'The same heading' }),
    },
  },
  'heading-too-long': {
    at: '/x',
    pages: { '/x': page('/x', { h2: 'A very long heading '.repeat(5) }) },
  },

  // --- content -------------------------------------------------------------
  'content-duplicate': {
    at: '/x',
    pages: {
      '/x': page('/x', { text: words('same'), h1: 'Heading', h2: 'Other' }),
      '/y': page('/y', { text: words('same'), h1: 'Heading', h2: 'Other' }),
    },
  },
  'content-near-duplicate': {
    at: '/x',
    pages: {
      '/x': page('/x', { text: `${words('same', 1000)} one`, h1: 'Heading', h2: 'Other' }),
      '/y': page('/y', { text: `${words('same', 1000)} two`, h1: 'Heading', h2: 'Other' }),
    },
  },
  'content-placeholder': {
    at: '/x',
    pages: { '/x': page('/x', { text: `Lorem ipsum dolor sit amet. ${words('/x')}` }) },
  },
  'content-thin': { at: '/x', pages: { '/x': page('/x', { text: words('/x', 50) }) } },

  // --- images --------------------------------------------------------------
  'img-no-alt': {
    at: '/x',
    pages: { '/x': page('/x', { body: '<img src="/i.png" width="1" height="1">' }) },
  },
  'img-empty-alt': {
    at: '/x',
    pages: { '/x': page('/x', { body: '<img src="/i.png" alt="" width="1" height="1">' }) },
  },
  'img-too-heavy': {
    at: '/i.png',
    pages: {
      '/i.png': { statusCode: 200, headers: { 'content-type': 'image/png' }, bytes: 200_000 },
    },
    notLinked: ['/i.png'],
    notInSitemap: ['/i.png'],
    homeLinks: '<img src="/i.png" alt="An image" width="1" height="1">',
  },
  'img-no-size': {
    at: '/x',
    pages: { '/x': page('/x', { body: '<img src="/i.png" alt="An image">' }) },
  },
  'img-long-alt': {
    at: '/x',
    pages: {
      '/x': page('/x', {
        body: `<img src="/i.png" alt="${'A very long text '.repeat(10)}" width="1" height="1">`,
      }),
    },
  },

  // --- structured data -----------------------------------------------------
  'json-ld-invalid': {
    at: '/x',
    pages: { '/x': page('/x', { head: '<script type="application/ld+json">{not json</script>' }) },
  },
  // This one needs a page without any, which the template does not offer. See below.
  'no-structured-data': {
    at: '/x',
    pages: {
      '/x': {
        statusCode: 200,
        headers: { 'content-type': 'text/html', ...SAFE_HEADERS },
        body: Buffer.from(
          `<html><head><title>A page without structured data</title></head><body><a href="/">Home page</a></body></html>`,
        ),
      },
    },
  },

  // --- links ---------------------------------------------------------------
  'link-to-localhost': {
    at: '/x',
    pages: { '/x': page('/x', { body: '<a href="http://localhost:3000/y">Local copy</a>' }) },
  },
  'uncrawlable-links': {
    at: '/x',
    pages: { '/x': page('/x', { body: '<a href="javascript:go()">Go there</a>' }) },
  },
  'only-nofollow-inlinks': {
    at: '/x',
    pages: { '/x': page('/x') },
    notLinked: ['/x'],
    homeLinks: '<a rel="nofollow" href="/x">A link to it</a>',
  },
  'only-noindex-inlinks': {
    at: '/x',
    pages: {
      '/hub': page('/hub', {
        head: '<meta name="robots" content="noindex">',
        links: '<a href="/x">A link to it</a>',
      }),
      '/x': page('/x'),
    },
    notLinked: ['/x'],
  },
  'orphan-in-sitemap': { at: '/x', pages: { '/x': page('/x') }, notLinked: ['/x'] },
  'no-outgoing-links': { at: '/x', pages: { '/x': page('/x', { links: '' }) } },
  'internal-nofollow-links': {
    at: '/x',
    pages: { '/x': page('/x', { body: '<a rel="nofollow" href="/about">About us</a>' }) },
  },
  'deep-page': {
    at: '/d4',
    pages: {
      '/d1': page('/d1', { links: '<a href="/d2">Deeper in</a>' }),
      '/d2': page('/d2', { links: '<a href="/d3">Deeper in</a>' }),
      '/d3': page('/d3', { links: '<a href="/d4">Deeper in</a>' }),
      '/d4': page('/d4'),
    },
    notLinked: ['/d2', '/d3', '/d4'],
  },
  'anchor-empty': { at: '/x', pages: { '/x': page('/x', { body: '<a href="/about"> </a>' }) } },
  'anchor-vague': {
    at: '/x',
    pages: { '/x': page('/x', { body: '<a href="/about">Leer más »</a>' }) },
  },

  // --- URLs ----------------------------------------------------------------
  'url-multiple-slashes': { at: '/a//b', pages: { '/a//b': page('/a//b') } },
  'url-spaces': { at: '/a%20b', pages: { '/a%20b': page('/a%20b') } },
  'links-to-broken': { at: '/', pages: { '/x': { statusCode: 404, headers: {} } } },
  'links-to-redirect': { at: '/', pages: { '/x': moved('/about') } },
  'links-to-canonicalised': {
    at: '/',
    pages: { '/x': page('/x', { canonical: `${SITE}/about` }) },
  },
  'links-tracking-parameters': {
    at: '/',
    pages: { '/a?utm_source=x': page('/a?utm_source=x') },
  },
  'url-tracking': { at: '/a?utm_source=x', pages: { '/a?utm_source=x': page('/a?utm_source=x') } },
  'url-uppercase': { at: '/Abc', pages: { '/Abc': page('/Abc') } },
  'url-repetitive-path': { at: '/a/b/a/b', pages: { '/a/b/a/b': page('/a/b/a/b') } },
  'url-internal-search': { at: '/?s=x', pages: { '/?s=x': page('/?s=x') } },
  'url-underscores': { at: '/a_b', pages: { '/a_b': page('/a_b') } },
  'url-too-long': {
    at: `/${'a'.repeat(120)}`,
    pages: { [`/${'a'.repeat(120)}`]: page(`/${'a'.repeat(120)}`) },
  },

  // --- security ------------------------------------------------------------
  'http-url': {
    at: 'http://example.com/x',
    pages: { 'http://example.com/x': page('http://example.com/x') },
    notInSitemap: ['http://example.com/x'],
  },
  'mixed-content': {
    at: '/x',
    pages: { '/x': page('/x', { body: '<script src="http://example.com/a.js"></script>' }) },
  },
  'insecure-form': {
    at: '/x',
    pages: {
      '/x': page('/x', { body: '<form method="post" action="http://example.com/send"></form>' }),
    },
  },
  'missing-security-header': {
    at: '/x',
    details: ['X-Content-Type-Options', 'Referrer-Policy'],
    pages: {
      '/x': page('/x', { headers: { 'x-content-type-options': '', 'referrer-policy': '' } }),
    },
  },
  'unsafe-cross-origin-links': {
    at: '/x',
    pages: {
      '/x': page('/x', { body: '<a target="_blank" href="https://elsewhere.org/">Elsewhere</a>' }),
    },
  },
  'protocol-relative': {
    at: '/x',
    pages: { '/x': page('/x', { body: '<script src="//cdn.example.org/a.js"></script>' }) },
  },

  // --- HTML ----------------------------------------------------------------
  'invalid-head-elements': {
    at: '/x',
    pages: { '/x': page('/x', { head: '<div>Not here</div>' }) },
  },
  'html-structure-broken': {
    at: '/x',
    pages: {
      '/x': page('/x', {
        canonical: null,
        head: `<div>Oops</div><link rel="canonical" href="${SITE}/x">`,
      }),
    },
  },
  'multiple-head-or-body': {
    at: '/x',
    pages: { '/x': page('/x', { body: '<body><p>More</p></body>' }) },
  },
  'document-too-big': { at: '/x', pages: { '/x': { ...page('/x'), bytes: 3_000_000 } } },
  'content-before-head': {
    at: '/x',
    pages: {
      '/x': {
        statusCode: 200,
        headers: { 'content-type': 'text/html', ...SAFE_HEADERS },
        body: Buffer.from(
          '<html><meta charset="utf-8"><head><title>A title</title></head><body></body></html>',
        ),
      },
    },
  },
}

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

async function crawl(site: Record<string, Answer>, rules: NewAuditRule[] = []) {
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
    createFetcher: fakeSite(site, 0).createFetcher,
    retryBaseMs: 1,
  })
  return started.id
}

const absolute = (at: string) => (at.startsWith('http') ? at : `${SITE}${at}`)

const issuesAt = async (crawlId: string, at: string) =>
  db.crawls.issuesOf(crawlId, [crawlUrlHash(absolute(at))])

describe('each issue', () => {
  it('has a scenario', () => {
    expect(Object.keys(SCENARIOS).sort()).toEqual([...PAGE_ISSUE_IDS].sort())
  })

  it.each(
    PAGE_ISSUE_IDS.filter((id) => id !== 'sitemap-too-big' && id !== 'indexed-not-in-sitemap'),
  )('finds %s', async (id) => {
    const scenario = SCENARIOS[id]
    const crawlId = await crawl(websiteOf(scenario), scenario.rules)
    const found = await issuesAt(crawlId, scenario.at)
    expect(found.map((row) => row.issue)).toContain(id)
    if (scenario.details) {
      expect(found.find((row) => row.issue === id)?.details).toEqual(scenario.details)
    }
  })

  it('finds a sitemap over the limits of the protocol', async () => {
    const crawlId = await crawl(websiteOf({ at: '/sitemap.xml' }))
    expect((await issuesAt(crawlId, '/sitemap.xml')).map((row) => row.issue)).not.toContain(
      'sitemap-too-big',
    )
    const stored = await db.crawls.getUrl(crawlId, crawlUrlHash(`${SITE}/sitemap.xml`))
    await db.crawls.recordResult({
      crawlId,
      urlHash: crawlUrlHash(`${SITE}/sitemap.xml`),
      result: { ...stored!, data: { sitemapSize: { entries: 50_001, bytes: 10 } } },
    })
    await analyseCrawl(db, crawlId, EMPTY_AUDIT_SNAPSHOT)
    expect((await issuesAt(crawlId, '/sitemap.xml')).map((row) => row.issue)).toContain(
      'sitemap-too-big',
    )
  })
})

describe('a URL a search engine has indexed', () => {
  // Nothing tells the crawl which URLs are indexed yet, so this is the check on its own.
  const check = (indexed: boolean | null, sitemaps: number) =>
    CHECKS['indexed-not-in-sitemap'](
      { indexed, sitemaps, sitemapsAmbiguous: 0 } as AuditedUrl,
      {} as Site,
    )

  it('is reported when no sitemap lists it', () => {
    expect(check(true, 0)).toBe(true)
    expect(check(true, 1)).toBe(false)
  })

  it('is not guessed from being indexable', () => {
    expect(check(null, 0)).toBe(false)
    expect(check(false, 0)).toBe(false)
  })

  it('is not also reported as merely indexable', async () => {
    const crawlId = await crawl(
      websiteOf({ at: '/x', pages: { '/x': page('/x') }, notInSitemap: ['/x'] }),
    )
    const found = (await issuesAt(crawlId, '/x')).map((row) => row.issue)
    expect(found).toContain('indexable-not-in-sitemap')
    expect(found).not.toContain('indexed-not-in-sitemap')
  })
})

describe('a site with nothing wrong', () => {
  it('has no issues at all', async () => {
    const crawlId = await crawl(websiteOf({ at: '/' }))
    expect(await issuesAt(crawlId, '/')).toEqual([])
    expect(await issuesAt(crawlId, '/about')).toEqual([])
    expect(await issuesAt(crawlId, '/sitemap.xml')).toEqual([])
    expect((await db.crawls.get(crawlId))?.pagesByWorstIssue).toEqual({
      issue: 0,
      warning: 0,
      opportunity: 0,
    })
  })
})

describe('what is not an issue', () => {
  const only = (scenario: Scenario) => crawl(websiteOf(scenario))
  const has = async (crawlId: string, at: string, id: PageIssueId) =>
    (await issuesAt(crawlId, at)).some((row) => row.issue === id)

  it('tells a headline-based probable soft 404 from a content-only possible one', async () => {
    const crawlId = await only({
      at: '/x',
      pages: {
        '/x': page('/x', { title: 'Page not found on this site, sorry', text: 'Nothing.' }),
        '/y': page('/y', { text: 'Sorry, the offer you wanted does not exist any more.' }),
      },
    })
    expect(await has(crawlId, '/x', 'soft-404-confirmed')).toBe(true)
    expect(await has(crawlId, '/x', 'soft-404-possible')).toBe(false)
    expect(await has(crawlId, '/y', 'soft-404-possible')).toBe(true)
    expect(await has(crawlId, '/y', 'soft-404-confirmed')).toBe(false)
  })

  it('does not infer a non-indexable canonical target from unknown data or self-reference', async () => {
    const crawlId = await only({
      at: '/x',
      pages: {
        '/x': page('/x', { canonical: `${SITE}/resource` }),
        '/resource': { statusCode: 200, headers: { 'content-type': 'image/png' } },
        '/self': page('/self', { head: '<meta name="robots" content="noindex">' }),
        '/failed': page('/failed', { canonical: `${SITE}/error` }),
        '/error': new FetchError('network', 'Unavailable'),
      },
    })
    for (const path of ['/x', '/self', '/failed']) {
      expect(await has(crawlId, path, 'canonical-not-indexable')).toBe(false)
    }
  })

  it('leaves the noindex nobody expected to the page that has it, not to the one that points at it', async () => {
    const crawlId = await crawl(
      websiteOf({
        at: '/x',
        pages: {
          '/x': page('/x', { canonical: `${SITE}/y` }),
          '/y': page('/y', { head: '<meta name="robots" content="noindex">' }),
        },
      }),
      [expecting('/x', 'not-indexable')],
    )
    // /x is expected to be out of the index, so what its canonical leads to is no news for it.
    expect(await has(crawlId, '/x', 'canonical-not-indexable')).toBe(false)
    expect(await has(crawlId, '/y', 'noindex')).toBe(true)
  })

  it('does not take a long page that mentions it for a soft 404', async () => {
    const crawlId = await only({
      at: '/x',
      pages: { '/x': page('/x', { text: `${words('/x', 400)} page not found` }) },
    })
    expect(await has(crawlId, '/x', 'soft-404-possible')).toBe(false)
  })

  it('has no limit on snippets to report for max-snippet:-1', async () => {
    const crawlId = await only({
      at: '/x',
      pages: { '/x': page('/x', { head: '<meta name="robots" content="max-snippet:-1">' }) },
    })
    expect(await has(crawlId, '/x', 'max-snippet-limited')).toBe(false)
    expect(await has(crawlId, '/x', 'nosnippet')).toBe(false)
  })

  it('does not call nosnippet and max-snippet:0 contradictory', async () => {
    const crawlId = await only({
      at: '/x',
      pages: {
        '/x': page('/x', { head: '<meta name="robots" content="nosnippet, max-snippet:0">' }),
      },
    })
    expect(await has(crawlId, '/x', 'directives-conflict-snippets')).toBe(false)
    expect(await has(crawlId, '/x', 'nosnippet')).toBe(true)
  })

  it('finds contradictory values for the same limit', async () => {
    const crawlId = await only({
      at: '/x',
      pages: {
        '/x': page('/x', {
          head: '<meta name="robots" content="max-image-preview:large"><meta name="robots" content="max-image-preview:none">',
        }),
      },
    })
    expect(await has(crawlId, '/x', 'directives-conflict-snippets')).toBe(true)
    expect(await has(crawlId, '/x', 'directives-conflict')).toBe(false)
  })

  it('reads an unavailable_after date that has a comma', async () => {
    const crawlId = await only({
      at: '/x',
      pages: {
        '/x': page('/x', {
          head: '<meta name="robots" content="unavailable_after: Monday, 25-Jun-2001 15:00:00 PST, nofollow">',
        }),
      },
    })
    expect(await has(crawlId, '/x', 'unavailable-after-expired')).toBe(true)
    expect(await has(crawlId, '/x', 'nofollow')).toBe(true)
  })

  it('does not ask for the alt text of a decorative image', async () => {
    const crawlId = await only({
      at: '/x',
      pages: {
        '/x': page('/x', {
          body: '<img src="/a.png" alt="" role="presentation" width="1" height="1"><img src="/b.png" aria-hidden="true" width="1" height="1">',
        }),
      },
    })
    expect(await has(crawlId, '/x', 'img-empty-alt')).toBe(false)
    expect(await has(crawlId, '/x', 'img-no-alt')).toBe(false)
  })

  it('does not ask for subsections on a short page', async () => {
    const crawlId = await only({
      at: '/x',
      pages: { '/x': page('/x', { h2: null, text: words('/x', 250) }) },
    })
    expect(await has(crawlId, '/x', 'h2-missing')).toBe(false)
  })

  it('tells a hreflang target that redirects from one that fails', async () => {
    const crawlId = await only({
      at: '/x',
      pages: {
        '/x': page('/x', {
          head: '<link rel="alternate" hreflang="es" href="/es"><link rel="alternate" hreflang="fr" href="/fr">',
        }),
        '/es': moved('/about'),
        '/fr': { statusCode: 404, headers: {} },
      },
    })
    const found = await issuesAt(crawlId, '/x')
    expect(found.map((row) => row.issue)).toEqual(
      expect.arrayContaining(['hreflang-redirect', 'hreflang-unreachable']),
    )
  })

  it('does not report broken HTML that cost no indexing signal as a structure issue', async () => {
    const crawlId = await only({
      at: '/x',
      pages: { '/x': page('/x', { head: '<div>Not here</div>' }) },
    })
    expect(await has(crawlId, '/x', 'invalid-head-elements')).toBe(true)
    expect(await has(crawlId, '/x', 'html-structure-broken')).toBe(false)
  })

  it('does not blame a site for the URLs only the crawler tried', async () => {
    const crawlId = await only({ at: '/' })
    for (const at of [
      'http://example.com/',
      'https://www.example.com/',
      'http://www.example.com/',
      '/robots.txt',
      '/llms.txt',
    ]) {
      expect(await issuesAt(crawlId, at)).toEqual([])
    }
  })

  it.each(['<a href="/llms.txt">File</a>', '<img src="/llms.txt" alt="File">'])(
    'keeps failures of referenced probes actionable: %s',
    async (homeLinks) => {
      const crawlId = await only({ at: '/', homeLinks })
      const stored = await db.crawls.getUrl(crawlId, crawlUrlHash(`${SITE}/llms.txt`))
      expect(stored?.source).toBe('llms')
      expect(stored?.statusCode).toBe(404)
      expect(await has(crawlId, '/llms.txt', 'client-error')).toBe(true)
    },
  )

  it('does blame it for them if the whole site is down', async () => {
    const crawlId = await crawl({ [`${SITE}/`]: new FetchError('ECONNREFUSED', 'refused') })
    expect(await has(crawlId, '/', 'no-response')).toBe(true)
  })

  it('leaves a broken-looking page that answered with an error to the status code', async () => {
    const crawlId = await only({
      at: '/x',
      pages: {
        '/x': { ...page('/x', { title: null, h1: null }), statusCode: 404 },
      },
    })
    expect(await has(crawlId, '/x', 'client-error')).toBe(true)
    expect(await has(crawlId, '/x', 'title-missing')).toBe(false)
    expect(await has(crawlId, '/x', 'h1-missing')).toBe(false)
  })

  it('does not count a noscript image in the head as the end of the head', async () => {
    const crawlId = await only({
      at: '/x',
      pages: {
        '/x': page('/x', {
          // The canonical comes after the image, and must still be seen as in the head.
          canonical: null,
          head: `<noscript><img src="/pixel.gif" alt="" width="1" height="1"></noscript><link rel="canonical" href="${SITE}/x">`,
        }),
      },
    })
    expect(await has(crawlId, '/x', 'invalid-head-elements')).toBe(true)
    expect(await has(crawlId, '/x', 'canonical-outside-head')).toBe(false)
  })

  it('sees that an invalid element ends the head', async () => {
    const crawlId = await only({
      at: '/x',
      pages: {
        '/x': page('/x', {
          canonical: null,
          head: `<div>Oops</div><link rel="canonical" href="${SITE}/x">`,
        }),
      },
    })
    expect(await has(crawlId, '/x', 'canonical-outside-head')).toBe(true)
  })

  it('does not treat a title inside an SVG as the title of the page', async () => {
    const crawlId = await only({
      at: '/x',
      pages: { '/x': page('/x', { body: '<svg><title>An icon</title></svg>' }) },
    })
    expect(await has(crawlId, '/x', 'title-multiple')).toBe(false)
    expect(await has(crawlId, '/x', 'title-outside-head')).toBe(false)
  })

  it('does not count what every page repeats as content', async () => {
    const nav = `<nav>${words('nav', 500)}</nav><footer>${words('footer', 500)}</footer>`
    const crawlId = await only({
      at: '/x',
      pages: {
        '/x': page('/x', { text: words('x', 30), body: nav }),
      },
    })
    expect(await has(crawlId, '/x', 'content-thin')).toBe(true)
  })

  it('does not call two pages copies for having no text', async () => {
    const crawlId = await only({
      at: '/x',
      pages: { '/x': page('/x', { text: ' ' }), '/y': page('/y', { text: ' ' }) },
    })
    expect(await has(crawlId, '/x', 'content-duplicate')).toBe(false)
    expect(await has(crawlId, '/x', 'content-thin')).toBe(true)
  })

  it('does not compare pages that will not be indexed', async () => {
    const noindex = '<meta name="robots" content="noindex">'
    const crawlId = await only({
      at: '/x',
      pages: {
        '/x': page('/x', { head: noindex, title: 'The same title for both of them, yes' }),
        '/y': page('/y', { head: noindex, title: 'The same title for both of them, yes' }),
      },
    })
    expect(await has(crawlId, '/x', 'title-duplicate')).toBe(false)
  })

  it('does not call a page canonical-less for a canonical in a header', async () => {
    const crawlId = await only({
      at: '/x',
      pages: {
        '/x': page('/x', { canonical: null, headers: { link: `<${SITE}/x>; rel="canonical"` } }),
      },
    })
    expect(await has(crawlId, '/x', 'canonical-missing')).toBe(false)
  })

  it('accepts a page linked to itself as having no links in', async () => {
    const crawlId = await only({
      at: '/x',
      pages: { '/x': page('/x', { links: '<a href="/x">This same page</a>' }) },
      notLinked: ['/x'],
    })
    expect(await has(crawlId, '/x', 'orphan-in-sitemap')).toBe(true)
    expect(await has(crawlId, '/x', 'no-outgoing-links')).toBe(true)
  })

  it('counts every path to a page when measuring how deep it is', async () => {
    const crawlId = await only({
      at: '/x',
      pages: {
        '/old': moved('/x'),
        '/x': page('/x'),
      },
      notLinked: ['/x'],
    })
    expect(await has(crawlId, '/x', 'deep-page')).toBe(false)
    expect((await db.crawls.getUrl(crawlId, crawlUrlHash(`${SITE}/x`)))?.statusCode).toBe(200)
  })

  it('leaves the security headers of a plain HTTP page without HSTS', async () => {
    const crawlId = await only({
      at: 'http://example.com/x',
      pages: {
        'http://example.com/x': page('http://example.com/x', {
          headers: { 'strict-transport-security': '' },
        }),
      },
    })
    expect(await has(crawlId, 'http://example.com/x', 'missing-security-header')).toBe(false)
  })

  it('lets a CSP stand in for X-Frame-Options', async () => {
    const crawlId = await only({
      at: '/x',
      pages: {
        '/x': page('/x', {
          headers: {
            'x-frame-options': '',
            'content-security-policy': "frame-ancestors 'none'",
          },
        }),
      },
    })
    expect(await has(crawlId, '/x', 'missing-security-header')).toBe(false)
  })

  it('accepts valid hreflang targets and a full set of alternates', async () => {
    const alternates = `<link rel="alternate" hreflang="en" href="/x"><link rel="alternate" hreflang="es-ES" href="/es"><link rel="alternate" hreflang="x-default" href="/x">`
    const crawlId = await only({
      at: '/x',
      pages: {
        '/x': page('/x', { head: alternates }),
        '/es': page('/es', { head: alternates }),
      },
    })
    expect(await issuesAt(crawlId, '/x')).toEqual([])
    expect(await issuesAt(crawlId, '/es')).toEqual([])
  })
})

describe('where a hreflang comes from', () => {
  it('reads alternates from a header', async () => {
    const crawlId = await crawl(
      websiteOf({
        at: '/x',
        pages: {
          '/x': page('/x', {
            headers: { link: `<${SITE}/about>; rel="alternate"; hreflang="es"` },
          }),
        },
      }),
    )
    const found = await issuesAt(crawlId, '/x')
    expect(found.find((row) => row.issue === 'hreflang-no-self')?.details).toEqual(['header'])
  })

  it('reads alternates from a sitemap, and lists every source', async () => {
    const site = websiteOf({
      at: '/x',
      pages: {
        '/x': page('/x', { head: '<link rel="alternate" hreflang="en" href="/about">' }),
      },
    })
    site[`${SITE}/sitemap.xml`] = xml(
      sitemapOf(
        ['/', '/about', '/x'],
        `<xhtml:link rel="alternate" hreflang="fr" href="${SITE}/fr"/>`,
      ),
    )
    const crawlId = await crawl(site)
    const found = await issuesAt(crawlId, '/x')
    expect(found.find((row) => row.issue === 'hreflang-no-self')?.details).toEqual([
      'html',
      'sitemap',
    ])
    expect(found.find((row) => row.issue === 'hreflang-unreachable')?.details).toEqual(['sitemap'])
  })
})

describe('isValidHreflang', () => {
  it.each(['en', 'es-ES', 'zh-Hant', 'zh-Hant-TW', 'pt-br', 'x-default', 'es-419', 'EN-gb'])(
    'accepts %s',
    (code) => expect(isValidHreflang(code)).toBe(true),
  )
  it.each(['', 'english', 'en_US', 'en-UK', 'xx', 'es-XX', 'en-US-x', 'en-us-gb'])(
    'refuses %s',
    (code) => expect(isValidHreflang(code)).toBe(false),
  )
})

describe('parseRobotsDirectives', () => {
  const parse = (...values: (string | null)[]) => [...parseRobotsDirectives(values)]

  it('reads directives, whatever their case', () => {
    expect(parse('NoIndex, nofollow', null)).toEqual(['noindex', 'nofollow'])
  })

  it('keeps the value of those that have one', () => {
    expect(parse('max-snippet: 20, unavailable_after: 2030-01-01')).toEqual([
      'max-snippet:20',
      'unavailable_after:2030-01-01',
    ])
  })

  it('follows what is meant for Google, and ignores what is meant for other bots', () => {
    expect(parse('googlebot: noindex')).toEqual(['noindex'])
    expect(parse('bingbot: noindex')).toEqual([])
  })

  it('keeps a date with a comma in one piece', () => {
    expect(parse('unavailable_after: Mon, 25 Jun 2030 15:00:00 GMT, noindex')).toEqual([
      'unavailable_after:mon, 25 jun 2030 15:00:00 gmt',
      'noindex',
    ])
  })

  it('ignores what it does not know', () => {
    expect(parse('whatever, noindex')).toEqual(['noindex'])
  })
})
