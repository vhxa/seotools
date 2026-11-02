import { PAGE_ISSUE_IDS, crawlUrlHash, createLogger, type PageIssueId } from '@seotools/core'
import { createCompany } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { analyseCrawl } from './analysis'
import { runCrawl } from './engine'
import { fakeSite, moved, type Answer } from './fake-site'
import { FetchError, type FetchedResponse } from './fetcher'
import { isValidHreflang } from './language-codes'
import { parseRobotsDirectives } from './site-audit'

const log = createLogger('test', 'silent')
const SITE = 'https://example.com'

const SAFE_HEADERS = {
  'strict-transport-security': 'max-age=31536000',
  'content-security-policy': "default-src 'self'",
  'x-content-type-options': 'nosniff',
  'x-frame-options': 'DENY',
  'referrer-policy': 'no-referrer',
}

/** Words that depend on the seed, so that no two pages read alike unless a test wants them to. */
function words(seed: string, count = 260): string {
  let state = [...seed].reduce((sum, char) => (sum * 31 + char.charCodeAt(0)) >>> 0, 7)
  const list: string[] = []
  for (let i = 0; i < count; i++) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0
    list.push(`w${(state >>> 8).toString(36)}`)
  }
  return list.join(' ')
}

interface PageOptions {
  /** `null` leaves the tag out. */
  title?: string | null
  description?: string | null
  /** `null` leaves the tag out. */
  canonical?: string | null
  head?: string
  body?: string
  /** Replaces the whole text of the page. */
  text?: string
  h1?: string | null
  h2?: string | null
  links?: string
  headers?: Record<string, string>
}

/** A page with nothing wrong, unless the options say otherwise. */
function page(path: string, options: PageOptions = {}): Partial<FetchedResponse> {
  const url = path.startsWith('http') ? path : `${SITE}${path}`
  const title =
    options.title === undefined ? `A good title for ${path} of this site` : options.title
  const description =
    options.description === undefined
      ? `A description of ${path} that is long enough to say something about what it holds, really.`
      : options.description
  const canonical = options.canonical === undefined ? url : options.canonical
  const h1 = options.h1 === undefined ? `The main heading of ${path}` : options.h1
  const h2 = options.h2 === undefined ? 'A second heading' : options.h2
  return {
    statusCode: 200,
    headers: { 'content-type': 'text/html', ...SAFE_HEADERS, ...options.headers },
    body: Buffer.from(`<!doctype html><html lang="en"><head>
      ${title === null ? '' : `<title>${title}</title>`}
      ${description === null ? '' : `<meta name="description" content="${description}">`}
      ${canonical === null ? '' : `<link rel="canonical" href="${canonical}">`}
      <script type="application/ld+json">{"@type":"WebPage"}</script>
      ${options.head ?? ''}
    </head><body>
      ${h1 === null ? '' : `<h1>${h1}</h1>`}
      ${h2 === null ? '' : `<h2>${h2}</h2>`}
      <p>${options.text ?? words(path)}</p>
      ${options.links ?? `<a href="/">Back to the home page</a>`}
      ${options.body ?? ''}
    </body></html>`),
  }
}

const sitemapOf = (paths: readonly string[], extra = '') =>
  `<?xml version="1.0"?><urlset xmlns:xhtml="http://www.w3.org/1999/xhtml">${paths
    .map(
      (path) =>
        `<url><loc>${path.startsWith('http') ? path : `${SITE}${path}`}</loc>${extra}</url>`,
    )
    .join('')}</urlset>`

const xml = (body: string): Partial<FetchedResponse> => ({
  statusCode: 200,
  headers: { 'content-type': 'application/xml' },
  body: Buffer.from(body),
})

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

const SCENARIOS: Record<PageIssueId, Scenario> = {
  // --- response codes ------------------------------------------------------
  'no-response': { at: '/x', pages: { '/x': new FetchError('ECONNRESET', 'reset') } },
  'server-error': { at: '/x', pages: { '/x': { statusCode: 500, headers: {} } } },
  'client-error': { at: '/x', pages: { '/x': { statusCode: 404, headers: {} } } },
  'redirect-loop': { at: '/x', pages: { '/x': moved('/y'), '/y': moved('/x') } },
  'soft-404': {
    at: '/x',
    pages: { '/x': page('/x', { title: 'Page not found on this site, sorry', text: 'Nothing.' }) },
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
  noindex: {
    at: '/x',
    pages: { '/x': page('/x', { head: '<meta name="robots" content="noindex">' }) },
  },
  nofollow: {
    at: '/x',
    pages: { '/x': page('/x', { head: '<meta name="robots" content="nofollow">' }) },
  },
  'snippet-limited': {
    at: '/x',
    pages: { '/x': page('/x', { head: '<meta name="robots" content="max-snippet:10">' }) },
  },
  noimageindex: {
    at: '/x',
    pages: { '/x': page('/x', { head: '<meta name="robots" content="noimageindex">' }) },
  },
  'unavailable-after': {
    at: '/x',
    pages: {
      '/x': page('/x', { head: '<meta name="robots" content="unavailable_after: 2030-01-01">' }),
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
  'canonical-not-indexable': {
    at: '/x',
    pages: {
      '/x': page('/x', { canonical: `${SITE}/y` }),
      '/y': page('/y', { head: '<meta name="robots" content="noindex">' }),
    },
  },
  'canonical-fragment': { at: '/x', pages: { '/x': page('/x', { canonical: `${SITE}/x#top` }) } },
  'canonical-missing': { at: '/x', pages: { '/x': page('/x', { canonical: null }) } },
  canonicalised: { at: '/x', pages: { '/x': page('/x', { canonical: `${SITE}/about` }) } },
  'canonical-relative': { at: '/x', pages: { '/x': page('/x', { canonical: '/x' }) } },
  'canonical-repeated': {
    at: '/x',
    pages: { '/x': page('/x', { head: `<link rel="canonical" href="${SITE}/x">` }) },
  },

  // --- sitemaps ------------------------------------------------------------
  // Fifty thousand URLs would take a while to crawl. See the test of its own below.
  'sitemap-too-big': { at: '/sitemap.xml' },
  'sitemap-not-indexable': {
    at: '/x',
    pages: { '/x': page('/x', { head: '<meta name="robots" content="noindex">' }) },
  },
  'orphan-in-sitemap': { at: '/x', pages: { '/x': page('/x') }, notLinked: ['/x'] },
  'indexable-not-in-sitemap': { at: '/x', pages: { '/x': page('/x') }, notInSitemap: ['/x'] },
  'in-many-sitemaps': {
    at: '/x',
    pages: {
      '/x': page('/x'),
      [`${SITE}/sitemap2.xml`]: xml(sitemapOf(['/x'])),
    },
    notLinked: [`${SITE}/sitemap2.xml`],
    notInSitemap: [`${SITE}/sitemap2.xml`],
    robots: `User-agent: *\nDisallow:\nSitemap: ${SITE}/sitemap2.xml\n`,
  },

  // --- hreflang ------------------------------------------------------------
  'hreflang-not-200': {
    at: '/x',
    details: ['html'],
    pages: { '/x': page('/x', { head: '<link rel="alternate" hreflang="es" href="/es">' }) },
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
  'title-same-as-h1': {
    at: '/x',
    pages: {
      '/x': page('/x', {
        title: 'The same words in both of them',
        h1: 'The same words in both of them',
      }),
    },
  },

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
  'h2-missing': { at: '/x', pages: { '/x': page('/x', { h2: null }) } },
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
  'url-tracking': { at: '/a?utm_source=x', pages: { '/a?utm_source=x': page('/a?utm_source=x') } },
  'url-uppercase': { at: '/Abc', pages: { '/Abc': page('/Abc') } },
  'url-non-ascii': { at: '/caf%C3%A9', pages: { '/caf%C3%A9': page('/caf%C3%A9') } },
  'url-parameters': { at: '/a?x=1', pages: { '/a?x=1': page('/a?x=1') } },
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
  'missing-head-or-body': {
    at: '/x',
    pages: {
      '/x': {
        statusCode: 200,
        headers: { 'content-type': 'text/html', ...SAFE_HEADERS },
        body: Buffer.from('<title>A page with no head or body tags at all</title><p>Hello</p>'),
      },
    },
  },
  'multiple-head-or-body': {
    at: '/x',
    pages: { '/x': page('/x', { body: '<body><p>More</p></body>' }) },
  },
  'document-too-big': { at: '/x', pages: { '/x': { ...page('/x'), bytes: 3_000_000 } } },
  'head-not-first': {
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

async function crawl(site: Record<string, Answer>) {
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

  it.each(PAGE_ISSUE_IDS.filter((id) => id !== 'sitemap-too-big'))('finds %s', async (id) => {
    const scenario = SCENARIOS[id]
    const crawlId = await crawl(websiteOf(scenario))
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
    await analyseCrawl(db, crawlId)
    expect((await issuesAt(crawlId, '/sitemap.xml')).map((row) => row.issue)).toContain(
      'sitemap-too-big',
    )
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
    expect(found.find((row) => row.issue === 'hreflang-not-200')?.details).toEqual(['sitemap'])
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

  it('ignores what it does not know', () => {
    expect(parse('whatever, noindex')).toEqual(['noindex'])
  })
})
