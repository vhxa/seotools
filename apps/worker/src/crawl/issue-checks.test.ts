import type { VitalMetrics } from '@seotools/core'
import {
  emptyVitals,
  EMPTY_AUDIT_SNAPSHOT,
  MAX_EVIDENCE_ITEMS,
  PAGE_ISSUE_IDS,
  auditSnapshotOf,
  crawlUrlHash,
  classifyFinding,
  createLogger,
  crawlFactsOf,
  type CrawlPageFacts,
  type NewAuditRule,
  type PageIssueId,
} from '@seotools/core'
import { createCompany } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { recomputeAudit } from './audit-recompute'
import { applyFindingDismissals } from './issue-checks'
import { analyseCrawl, currentAuditConfig } from './analysis'
import { runCrawl } from './engine'
import { fakeSite, moved, type Answer } from './fake-site'
import { FetchError } from './fetcher'
import { SAFE_HEADERS, SITE, page, sitemapOf, words, xml } from './test-site'
import { CHECKS } from './issue-checks'
import { isValidHreflang, isWellFormedLanguageTag } from './language-codes'
import { parseRobotsDirectives, type AuditedUrl, type Site } from './site-audit'

const log = createLogger('test', 'silent')
interface Scenario {
  /** Where the issue should be found: a path, or an absolute URL. */
  at: string
  vitals?: Partial<VitalMetrics>
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
  dimension: 'noindex' | 'nofollow' | 'robots' | 'sitemap' | 'canonical' | 'unlinked',
  value: 'required' | 'allowed' | 'forbidden',
): NewAuditRule => ({
  dimension,
  value,
  selector: { kind: 'path', path, query: { mode: 'any' }, scope: 'literal' },
  reason: null,
  enabled: true,
})

/** Open Graph and Twitter tags that are complete, with the parts a test changes left to it. */
const shared = (
  path: string,
  { image = 'https://cdn.example.net/og.png', url = `${SITE}${path}`, card = true } = {},
) =>
  `<meta property="og:title" content="A title"><meta property="og:type" content="website">
   <meta property="og:image" content="${image}"><meta property="og:url" content="${url}">
   ${card ? '<meta name="twitter:card" content="summary_large_image">' : ''}`

const SCENARIOS: Record<PageIssueId, Scenario> = {
  'html-entities-as-text': { at: '/x', pages: { '/x': page('/x', { h1: 'd&amp;#8217;exemple' }) } },
  'few-html-links': { at: '/x', pages: { '/x': page('/x') } },

  'lcp-poor': { at: '/x', pages: { '/x': page('/x') }, vitals: { lcp: 4001 } },
  'inp-poor': { at: '/x', pages: { '/x': page('/x') }, vitals: { inp: 501 } },
  'cls-poor': { at: '/x', pages: { '/x': page('/x') }, vitals: { cls: 0.251 } },
  // --- what is expected of a URL's indexation ------------------------------
  'expected-indexable-blocked': {
    at: '/x',
    pages: { '/x': page('/x', { head: '<meta name="robots" content="noindex">' }) },
    rules: [expecting('/x', 'indexable')],
    details: ['noindex'],
  },
  'canonical-required-missing': {
    at: '/x',
    pages: { '/x': page('/x') },
    rules: [asking('/x', 'canonical', 'required')],
  },
  'canonical-forbidden-present': {
    at: '/x',
    pages: { '/x': page('/x', { canonical: `${SITE}/about` }) },
    rules: [asking('/x', 'canonical', 'forbidden')],
  },
  'unlinked-required-missing': {
    at: '/x',
    pages: { '/x': page('/x') },
    rules: [asking('/x', 'unlinked', 'required')],
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
  'redirect-temporary': { at: '/x', pages: { '/x': moved('/about', 302) } },
  'slow-response': { at: '/x', pages: { '/x': { ...page('/x'), responseTimeMs: 2500 } } },
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

  // --- social --------------------------------------------------------------
  'og-missing': { at: '/x', pages: { '/x': page('/x', { social: null }) } },
  'og-incomplete': {
    at: '/x',
    pages: {
      '/x': page('/x', {
        social:
          '<meta property="og:title" content="A title"><meta name="twitter:card" content="summary">',
      }),
    },
    details: ['og:type', 'og:image', 'og:url'],
  },
  'og-image-broken': {
    at: '/x',
    pages: { '/x': page('/x', { social: shared('/x', { image: '/gone.png' }) }) },
  },
  'og-url-mismatch': {
    at: '/x',
    pages: { '/x': page('/x', { social: shared('/x', { url: `${SITE}/elsewhere` }) }) },
  },
  'twitter-card-missing': {
    at: '/x',
    pages: { '/x': page('/x', { social: shared('/x', { card: false }) }) },
  },

  // --- structured data -----------------------------------------------------
  'structured-data-required-missing': {
    at: '/x',
    pages: {
      '/x': page('/x', {
        head: '<script type="application/ld+json">{"@type":"Product","name":"Robe"}</script>',
      }),
    },
    details: ['Product: offers | review | aggregateRating'],
  },
  'structured-data-recommended-missing': {
    at: '/x',
    pages: {
      '/x': page('/x', {
        head: '<script type="application/ld+json">{"@context":"https://schema.org","@graph":[{"@type":"Organization","name":"Aire","url":"https://example.com"}]}</script>',
      }),
    },
    details: ['Organization: logo'],
  },
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
  'resources-broken': {
    at: '/x',
    pages: {
      '/x': page('/x', { body: '<img src="/gone.png" alt="An image" width="1" height="1">' }),
    },
  },
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
  'html-lang-missing': { at: '/x', pages: { '/x': page('/x', { html: '<html>' }) } },
  'html-lang-invalid': { at: '/x', pages: { '/x': page('/x', { html: '<html lang="en_US">' }) } },
  'viewport-missing': {
    at: '/x',
    pages: { '/x': page('/x', { document: '<meta charset="utf-8">' }) },
  },
  'charset-missing': {
    at: '/x',
    pages: {
      '/x': page('/x', { document: '<meta name="viewport" content="width=device-width">' }),
    },
  },
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

it('uses crawl identity for canonical, self and return hreflang, and og:url declarations', async () => {
  await db.crawls.saveIgnoredParameters(domainId, ['updatedAt'])
  const id = await crawl(
    websiteOf({
      at: '/a',
      pages: {
        '/a': page('/a', {
          canonical: `${SITE}/a?updatedAt=1`,
          head: `<link rel="alternate" hreflang="en" href="${SITE}/a?updatedAt=2"><link rel="alternate" hreflang="es" href="${SITE}/b?updatedAt=3">`,
          social: `<meta property="og:url" content="${SITE}/a?updatedAt=4">`,
        }),
        '/b': page('/b', {
          head: `<link rel="alternate" hreflang="en" href="${SITE}/a?updatedAt=5"><link rel="alternate" hreflang="es" href="${SITE}/b?updatedAt=6">`,
        }),
        '/different': page('/different', { canonical: `${SITE}/a?updatedAt=7` }),
      },
    }),
  )
  const issues = (await issuesAt(id, '/a')).map((row) => row.issue)
  for (const issue of [
    'canonical-other',
    'hreflang-no-self',
    'hreflang-no-return',
    'og-url-mismatch',
  ])
    expect(issues).not.toContain(issue)
  const stored = await db.crawls.getUrl(id, crawlUrlHash(`${SITE}/a`))
  expect(stored?.canonical).toBe(`${SITE}/a?updatedAt=1`)
  const audit = await db.crawls.auditOf(id, [
    crawlUrlHash(`${SITE}/a`),
    crawlUrlHash(`${SITE}/different`),
  ])
  expect(audit.find((row) => row.urlHash === crawlUrlHash(`${SITE}/a`))?.indexability).toBe(
    'indexable',
  )
  expect(audit.find((row) => row.urlHash === crawlUrlHash(`${SITE}/different`))?.indexability).toBe(
    'not-indexable',
  )
})

describe('each issue', () => {
  it('has a scenario', () => {
    expect(Object.keys(SCENARIOS).sort()).toEqual([...PAGE_ISSUE_IDS].sort())
  })

  it.each(
    PAGE_ISSUE_IDS.filter((id) => id !== 'sitemap-too-big' && id !== 'indexed-not-in-sitemap'),
  )('finds %s', async (id) => {
    const scenario = SCENARIOS[id]
    const crawlId = await crawl(websiteOf(scenario), scenario.rules)
    if (scenario.vitals) {
      await db.vitals.saveUrl({
        ...emptyVitals(),
        ...scenario.vitals,
        crawlId,
        urlHash: crawlUrlHash(absolute(scenario.at)),
        source: 'field',
        formFactor: 'PHONE',
        status: 'collected',
        error: null,
        collectedAt: new Date(),
      })
      await analyseCrawl(db, crawlId, await currentAuditConfig(db, domainId))
    }
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

describe('facts stored by an older crawl', () => {
  it('lack fields added since, which read as not seen instead of failing the analysis', async () => {
    const crawlId = await crawl(websiteOf({ at: '/' }))
    const hash = crawlUrlHash(`${SITE}/`)
    const stored = await db.crawls.getUrl(crawlId, hash)
    const { notFoundHeadline: _headline, notFoundText: _text, ...older } = stored!.data!.facts!
    await db.crawls.recordResult({
      crawlId,
      urlHash: hash,
      result: { ...stored!, data: { ...stored!.data, facts: older as CrawlPageFacts } },
    })
    await expect(analyseCrawl(db, crawlId, EMPTY_AUDIT_SNAPSHOT)).resolves.toBeDefined()
    const issues = (await issuesAt(crawlId, '/')).map((row) => row.issue)
    expect(issues).not.toContain('soft-404-confirmed')
    expect(issues).not.toContain('soft-404-possible')
  })
})

const NEW_FACT_ISSUES = [
  'og-missing',
  'og-incomplete',
  'og-image-broken',
  'og-url-mismatch',
  'twitter-card-missing',
  'html-lang-missing',
  'html-lang-invalid',
  'viewport-missing',
  'charset-missing',
] as const satisfies readonly PageIssueId[]

describe('what a crawl did not look for', () => {
  /** A page of a crawl from before social and document facts, as it is when read back. */
  async function olderPage(at: string, html: Partial<Record<string, unknown>> = {}) {
    const crawlId = await crawl(
      websiteOf({
        at,
        pages: {
          [at]: page(at, { social: null, html: '<html>', document: '<meta name="x" content="y">' }),
        },
      }),
    )
    const hash = crawlUrlHash(absolute(at))
    const stored = await db.crawls.getUrl(crawlId, hash)
    const { social: _social, document: _document, ...older } = stored!.data!.facts!
    await db.crawls.recordResult({
      crawlId,
      urlHash: hash,
      result: {
        ...stored!,
        data: { ...stored!.data, facts: { ...older, ...html } as CrawlPageFacts },
      },
    })
    return crawlId
  }

  it('is not taken for having none: nothing of what they say is reported', async () => {
    // The page really has no tags, no lang, no viewport and no charset: a new crawl says so.
    const fresh = await crawl(
      websiteOf({
        at: '/x',
        pages: {
          '/x': page('/x', {
            social: null,
            html: '<html>',
            document: '<meta name="x" content="y">',
          }),
        },
      }),
    )
    const now = (await issuesAt(fresh, '/x')).map((row) => row.issue)
    for (const id of ['og-missing', 'html-lang-missing', 'viewport-missing', 'charset-missing']) {
      expect(now).toContain(id)
    }
    // The same page as an earlier crawl stored it, without those fields.
    const crawlId = await olderPage('/x')
    await expect(analyseCrawl(db, crawlId, EMPTY_AUDIT_SNAPSHOT)).resolves.toBeDefined()
    const issues = (await issuesAt(crawlId, '/x')).map((row) => row.issue)
    for (const id of NEW_FACT_ISSUES) expect(issues).not.toContain(id)
  })

  it('keeps which issues it could not see, so that a later crawl is not compared as if it had', async () => {
    const crawlId = await olderPage('/x')
    await analyseCrawl(db, crawlId, EMPTY_AUDIT_SNAPSHOT)
    const snapshot = (await db.crawls.get(crawlId))?.auditSnapshot
    expect(snapshot?.unobserved).toEqual(
      [...NEW_FACT_ISSUES, 'cls-poor', 'inp-poor', 'lcp-poor'].sort(),
    )

    // Analysed again from what it stored (as the startup reanalysis does): worked out again.
    await analyseCrawl(db, crawlId, snapshot!)
    expect((await db.crawls.get(crawlId))?.auditSnapshot?.unobserved).toEqual(
      [...NEW_FACT_ISSUES, 'cls-poor', 'inp-poor', 'lcp-poor'].sort(),
    )

    // A crawl that looked says nothing is unobserved, and keeps no field.
    const fresh = await crawl(websiteOf({ at: '/x', pages: { '/x': page('/x') } }))
    expect((await db.crawls.get(fresh))?.auditSnapshot?.unobserved).toEqual([
      'cls-poor',
      'inp-poor',
      'lcp-poor',
    ])
    // Which also holds when it is analysed again from a snapshot that said otherwise.
    await analyseCrawl(db, fresh, snapshot!)
    expect((await db.crawls.get(fresh))?.auditSnapshot?.unobserved).toEqual([
      'cls-poor',
      'inp-poor',
      'lcp-poor',
    ])

    // Against the old crawl, what the new one reports is not new: nobody could have seen it.
    const bare = await crawl(websiteOf({ at: '/x', pages: { '/x': page('/x', { social: null }) } }))
    const crawls = await Promise.all([crawlId, bare].map((id) => db.crawls.get(id)))
    const [base, target] = crawls.map((row) => crawlFactsOf(row as never))
    const url = (issues: string[]) => ({
      requested: true,
      participation: 'audited' as const,
      intent: 'indexable' as const,
      conditions: '',
      issues: new Set(issues),
    })
    const reported = (await issuesAt(bare, '/x')).map((row) => row.issue)
    expect(reported).toContain('og-missing')
    expect(
      classifyFinding('og-missing', {
        base: { crawl: { ...base!, catalog: target!.catalog, scope: target!.scope }, url: url([]) },
        target: { crawl: target!, url: url(reported) },
      }),
    ).toMatchObject({ kind: 'unverified', reasons: ['unobserved'] })
  })

  it('still finds what the answer alone says: a slow response and a temporary redirect', async () => {
    const crawlId = await crawl(
      websiteOf({
        at: '/x',
        pages: { '/x': { ...page('/x'), responseTimeMs: 2500 }, '/y': moved('/about', 307) },
      }),
    )
    const found = async (at: string) => (await issuesAt(crawlId, at)).map((row) => row.issue)
    expect(await found('/x')).toContain('slow-response')
    expect(await found('/y')).toContain('redirect-temporary')
  })
})

describe('social tags, the document and what a page loads', () => {
  const only = (scenario: Scenario) => crawl(websiteOf(scenario))
  const issuesOf = async (crawlId: string, at: string) =>
    (await issuesAt(crawlId, at)).map((row) => row.issue)

  it('does not call a page with Open Graph tags missing them, nor one with none incomplete', async () => {
    const crawlId = await only({
      at: '/x',
      pages: {
        '/x': page('/x', { social: '<meta property="og:locale" content="en_US">' }),
        '/y': page('/y', { social: null }),
      },
    })
    const x = await issuesOf(crawlId, '/x')
    expect(x).not.toContain('og-missing')
    expect(x).toContain('og-incomplete')
    expect(x).toContain('twitter-card-missing')
    const y = await issuesOf(crawlId, '/y')
    expect(y).toContain('og-missing')
    expect(y).not.toContain('og-incomplete')
    expect(y).toContain('twitter-card-missing')
  })

  it('compares og:url with the canonical, and with the page itself when it has none', async () => {
    const crawlId = await only({
      at: '/x',
      pages: {
        '/x': page('/x', {
          canonical: `${SITE}/main`,
          social: shared('/x', { url: `${SITE}/main` }),
        }),
        '/y': page('/y', { canonical: null, social: shared('/y', { url: `${SITE}/other` }) }),
        '/z': page('/z', { canonical: null, social: shared('/z') }),
      },
    })
    expect(await issuesOf(crawlId, '/x')).not.toContain('og-url-mismatch')
    expect(await issuesOf(crawlId, '/y')).toContain('og-url-mismatch')
    expect(await issuesOf(crawlId, '/z')).not.toContain('og-url-mismatch')
  })

  it('reports a share image of the crawl that fails or redirects, with it as evidence', async () => {
    const crawlId = await only({
      at: '/x',
      pages: {
        '/x': page('/x', { social: shared('/x', { image: '/gone.png' }) }),
        '/y': page('/y', { social: shared('/y', { image: '/moved.png' }) }),
        '/moved.png': moved('/about'),
        '/ok': page('/ok', { social: shared('/ok', { image: '/fine.png' }) }),
        '/fine.png': { statusCode: 200, headers: { 'content-type': 'image/png' } },
        // Only the twitter image: it is the one that is checked.
        '/t': page('/t', {
          social: `${shared('/t', { image: 'https://cdn.example.net/ok.png' }).replace(/<meta property="og:image"[^>]*>/, '')}<meta name="twitter:image" content="/gone.png">`,
        }),
      },
    })
    const found = (await issuesAt(crawlId, '/x')).find((row) => row.issue === 'og-image-broken')
    expect(found?.evidence).toMatchObject({ kind: 'related-urls', urls: [`${SITE}/gone.png`] })
    expect(await issuesOf(crawlId, '/y')).toContain('og-image-broken')
    expect(await issuesOf(crawlId, '/ok')).not.toContain('og-image-broken')
    expect(await issuesOf(crawlId, '/t')).toContain('og-image-broken')
  })

  it('does not say a share image the crawl did not request is broken', async () => {
    const crawlId = await only({
      at: '/x',
      pages: {
        '/x': page('/x', { social: shared('/x', { image: 'https://cdn.example.net/gone.png' }) }),
      },
    })
    expect(await issuesOf(crawlId, '/x')).not.toContain('og-image-broken')
  })

  it('judges the language of the document, and the charset by the header too', async () => {
    const crawlId = await only({
      at: '/x',
      pages: {
        '/a': page('/a', { html: '<html lang="es-419">' }),
        '/b': page('/b', { html: '<html lang="en_US">' }),
        '/c': page('/c', { html: '<html lang="">' }),
        '/f': page('/f', { html: '<html lang="fil">' }),
        '/g': page('/g', { html: '<html lang="de-CH-1901">' }),
        '/h': page('/h', { html: '<html lang="en-US-u-ca-gregory">' }),
        '/d': page('/d', {
          document: '<meta name="viewport" content="width=device-width">',
          headers: { 'content-type': 'text/html; charset=utf-8' },
        }),
        '/e': page('/e', {
          document:
            '<meta http-equiv="Content-Type" content="text/html; charset=utf-8"><meta name="viewport" content="width=device-width">',
        }),
      },
    })
    expect(await issuesOf(crawlId, '/a')).not.toContain('html-lang-invalid')
    expect(await issuesOf(crawlId, '/b')).toContain('html-lang-invalid')
    const c = await issuesOf(crawlId, '/c')
    expect(c).toContain('html-lang-missing')
    expect(c).not.toContain('html-lang-invalid')
    for (const valid of ['/f', '/g', '/h']) {
      expect(await issuesOf(crawlId, valid)).not.toContain('html-lang-invalid')
    }
    expect(await issuesOf(crawlId, '/d')).not.toContain('charset-missing')
    expect(await issuesOf(crawlId, '/e')).not.toContain('charset-missing')
  })

  it('finds a response slower than the threshold of the domain, and only a page that answered', async () => {
    const crawlId = await only({
      at: '/x',
      pages: {
        '/fast': { ...page('/fast'), responseTimeMs: 900 },
        '/slow': { ...page('/slow'), responseTimeMs: 1001 },
        '/slow-404': {
          statusCode: 404,
          headers: { 'content-type': 'text/html' },
          responseTimeMs: 5000,
        },
      },
    })
    expect(await issuesOf(crawlId, '/fast')).not.toContain('slow-response')
    expect(await issuesOf(crawlId, '/slow')).toContain('slow-response')
    expect(await issuesOf(crawlId, '/slow-404')).not.toContain('slow-response')
    await analyseCrawl(db, crawlId, auditSnapshotOf(1, [], undefined, { responseTimeMaxMs: 5000 }))
    expect(await issuesOf(crawlId, '/slow')).not.toContain('slow-response')
    await analyseCrawl(db, crawlId, auditSnapshotOf(1, [], undefined, { responseTimeMaxMs: 500 }))
    expect(await issuesOf(crawlId, '/fast')).toContain('slow-response')
  })

  it('tells a temporary redirect from a permanent one', async () => {
    const crawlId = await only({
      at: '/x',
      pages: {
        '/a': moved('/about', 301),
        '/b': moved('/about', 302),
        '/c': moved('/about', 307),
        '/d': moved('/about', 308),
      },
    })
    expect(await issuesOf(crawlId, '/a')).not.toContain('redirect-temporary')
    expect(await issuesOf(crawlId, '/b')).toContain('redirect-temporary')
    expect(await issuesOf(crawlId, '/c')).toContain('redirect-temporary')
    expect(await issuesOf(crawlId, '/d')).not.toContain('redirect-temporary')
  })

  it('reports a script, stylesheet or image that fails on the page that loads it', async () => {
    const crawlId = await only({
      at: '/x',
      pages: {
        '/x': page('/x', {
          head: '<link rel="stylesheet" href="/gone.css"><link rel="icon" href="/gone.ico">',
          body: '<script src="/gone.js"></script><img src="/ok.png" alt="a" width="1" height="1"><iframe src="/gone-frame"></iframe>',
        }),
        '/ok.png': { statusCode: 200, headers: { 'content-type': 'image/png' } },
        '/y': page('/y', {
          body: '<img src="https://cdn.example.net/gone.png" alt="a" width="1" height="1">',
        }),
      },
    })
    const found = (await issuesAt(crawlId, '/x')).find((row) => row.issue === 'resources-broken')
    expect(found?.evidence).toMatchObject({ kind: 'related-urls', total: 3 })
    const urls = found?.evidence?.kind === 'related-urls' ? found.evidence.urls : []
    expect([...urls].sort()).toEqual([`${SITE}/gone-frame`, `${SITE}/gone.css`, `${SITE}/gone.js`])
    // A `head-link` cannot be told to be a stylesheet or an icon, so it is not judged.
    expect(urls).not.toContain(`${SITE}/gone.ico`)
    // The page itself is not blamed on the resource: it gets its own finding.
    expect(await issuesOf(crawlId, '/gone.js')).toContain('client-error')
    // Another site's image that the crawl did not request is not known to be broken.
    expect(await issuesOf(crawlId, '/y')).not.toContain('resources-broken')
  })

  it('keeps the broken resources of a page bounded, and counts them all', async () => {
    // Pages that all load the same many broken scripts: the total is right, the sample is bounded.
    const scripts = Array.from({ length: 25 }, (_, i) => `/gone-${i}.js`)
    const loading = scripts.map((src) => `<script src="${src}"></script>`)
    // Twice, so that a resource a page loads more than once counts once.
    const body = loading.join('') + loading.join('')
    const pages = Object.fromEntries(
      Array.from({ length: 12 }, (_, i) => [`/p${i}`, page(`/p${i}`, { body })]),
    )
    const crawlId = await only({ at: '/p0', pages })
    for (const path of ['/p0', '/p5', '/p11']) {
      const found = (await issuesAt(crawlId, path)).find((row) => row.issue === 'resources-broken')
      expect(found?.evidence).toMatchObject({ kind: 'related-urls', total: 25 })
      const urls = found?.evidence?.kind === 'related-urls' ? found.evidence.urls : []
      expect(urls).toHaveLength(MAX_EVIDENCE_ITEMS)
      expect(new Set(urls).size).toBe(MAX_EVIDENCE_ITEMS)
    }
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
    await analyseCrawl(db, crawlId, auditSnapshotOf(1, [], undefined, { htmlLinksMin: 0 }))
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
    await analyseCrawl(db, crawlId, auditSnapshotOf(1, [], undefined, { htmlLinksMin: 0 }))
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

describe('isWellFormedLanguageTag', () => {
  it.each([
    'en',
    'es-419',
    'fil',
    'de-CH-1901',
    'en-US-u-ca-gregory',
    'zh-Hant-TW',
    'und',
    ' en-GB ',
    // Well formed, even if no search engine would take it for hreflang.
    'en-UK',
  ])('accepts %s', (tag) => expect(isWellFormedLanguageTag(tag)).toBe(true))
  it.each(['', '  ', 'en_US', 'english language', 'en,fr', '*', '123', 'e', 'a'.repeat(5000)])(
    'refuses %s',
    (tag) => expect(isWellFormedLanguageTag(tag)).toBe(false),
  )
  it('does not hand a long value to Intl', () => {
    const spy = vi.spyOn(Intl, 'getCanonicalLocales')
    expect(isWellFormedLanguageTag(`en-${'a'.repeat(200)}`)).toBe(false)
    expect(spy).not.toHaveBeenCalled()
    spy.mockRestore()
  })
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

describe('figures a domain sets for its checks', () => {
  it('replace the recommended ones, and moving them analyses the latest crawl again', async () => {
    const site = websiteOf({ at: '/x', pages: { '/x': page('/x', { text: words('/x', 150) }) } })
    const id = await crawl(site)
    expect((await issuesAt(id, '/x')).map((row) => row.issue)).toContain('content-thin')

    const saved = await db.audit.setThresholds({ domainId, thresholds: { thinWords: 100 } })
    expect(saved).toMatchObject({ ok: true, changed: true })
    expect((await db.audit.config(domainId)).thresholds).toEqual({ thinWords: 100 })
    await analyseCrawl(db, id, await currentAuditConfig(db, domainId))
    expect((await issuesAt(id, '/x')).map((row) => row.issue)).not.toContain('content-thin')
    expect((await db.crawls.get(id))?.auditSnapshot?.thresholds).toEqual({ thinWords: 100 })

    // Setting the same figures again changes nothing.
    expect(
      await db.audit.setThresholds({ domainId, thresholds: { thinWords: 100 } }),
    ).toMatchObject({
      changed: false,
    })
  })
})

describe('field vitals findings', () => {
  it.each([
    ['lcp-poor', 'lcp', 2500, 4000],
    ['inp-poor', 'inp', 200, 500],
    ['cls-poor', 'cls', 0.1, 0.25],
  ] as const)(
    'raises %s only above the poor threshold, never without field data',
    (issue, metric, good, poor) => {
      for (const value of [null, good, poor]) {
        const url = { vitals: { ...emptyVitals(), [metric]: value } } as AuditedUrl
        expect(CHECKS[issue](url, {} as Site)).toBe(false)
      }
      expect(
        CHECKS[issue](
          { vitals: { ...emptyVitals(), [metric]: poor + 0.001 } } as AuditedUrl,
          {} as Site,
        ),
      ).toBe(true)
      expect(CHECKS[issue]({} as AuditedUrl, {} as Site)).toBe(false)
    },
  )
})

it('applies URL and domain dismissals after rules, preserves pending overrides and historical snapshots', async () => {
  const id = await crawl(
    websiteOf({
      at: '/x',
      pages: { '/x': page('/x', { title: '' }), '/y': page('/y', { title: '' }) },
    }),
  )
  const older = id
  const latest = await crawl(
    websiteOf({
      at: '/x',
      pages: { '/x': page('/x', { title: '' }), '/y': page('/y', { title: '' }) },
    }),
  )
  const member = await db.users.create({
    name: 'Editor',
    email: 'dismiss@example.com',
    role: 'member',
  })
  const input = {
    domainId,
    issue: 'title-missing',
    urlHashes: [null],
    state: 'dismissed' as const,
    note: '',
    setBy: member.id,
  }
  await db.audit.setFindingStates(input)
  await db.audit.setFindingStates({
    ...input,
    urlHashes: [crawlUrlHash(absolute('/x'))],
    state: 'pending',
  })
  await analyseCrawl(db, latest, await currentAuditConfig(db, domainId))
  expect((await issuesAt(latest, '/x')).some((r) => r.issue === 'title-missing')).toBe(true)
  expect((await issuesAt(latest, '/y')).some((r) => r.issue === 'title-missing')).toBe(false)
  expect(await db.crawls.acceptedOf(latest, [crawlUrlHash(absolute('/y'))])).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        issue: 'title-missing',
        acceptance: expect.objectContaining({ kind: 'dismissal', scope: 'domain' }),
      }),
    ]),
  )
  await recomputeAudit({ db, domainId, crawlId: older, force: true, finalAttempt: true, log })
  expect((await issuesAt(older, '/y')).some((r) => r.issue === 'title-missing')).toBe(true)
  await db.audit.setFindingStates({ ...input, state: 'pending' })
  await db.audit.setFindingStates({ ...input, urlHashes: [crawlUrlHash(absolute('/y'))] })
  await analyseCrawl(db, latest, await currentAuditConfig(db, domainId))
  expect(await db.crawls.acceptedOf(latest, [crawlUrlHash(absolute('/y'))])).toEqual(
    expect.arrayContaining([
      expect.objectContaining({
        acceptance: expect.objectContaining({ kind: 'dismissal', scope: 'url' }),
      }),
    ]),
  )
})

it('never dismisses expected findings, including malformed stored snapshots', () => {
  const subject = { url: { urlHash: 'h' } } as AuditedUrl
  const site = {
    config: {
      dismissals: [
        { id: 'd', issue: 'expected-indexable-blocked', urlHash: null, state: 'dismissed' },
      ],
    },
  } as Site
  expect(
    applyFindingDismissals(subject, site, [{ issue: 'expected-indexable-blocked' }], []),
  ).toMatchObject({
    found: [{ issue: 'expected-indexable-blocked' }],
    accepted: [],
  })
})

it('records Alice and her decision time in the snapshot and acceptance before Bob changes it', async () => {
  const alice = await db.users.create({ name: 'Alice', email: 'alice@example.com', role: 'member' })
  const bob = await db.users.create({ name: 'Bob', email: 'bob@example.com', role: 'member' })
  const input = {
    domainId,
    issue: 'title-missing',
    urlHashes: [null],
    state: 'dismissed' as const,
    note: 'Alice note',
    setBy: alice.id,
  }
  await db.audit.setFindingStates(input)
  const decision = (await db.audit.config(domainId)).findingStates[0]!
  const site = websiteOf({ at: '/x', pages: { '/x': page('/x', { title: '' }) } })
  const older = await crawl(site)
  const original = (await db.crawls.acceptedOf(older, [crawlUrlHash(absolute('/x'))])).find(
    (r) => r.issue === input.issue,
  )!
  expect(original.acceptance).toMatchObject({
    kind: 'dismissal',
    setBy: alice.id,
    setAt: decision.setAt.toISOString(),
  })
  expect((await db.crawls.get(older))?.auditSnapshot?.dismissals?.[0]).toMatchObject({
    setBy: alice.id,
    setAt: decision.setAt.toISOString(),
  })
  await db.audit.setFindingStates({
    ...input,
    state: 'in-progress',
    setBy: bob.id,
    note: 'Bob note',
  })
  await crawl(site)
  await recomputeAudit({ db, domainId, crawlId: older, force: true, finalAttempt: true, log })
  expect(
    (await db.crawls.acceptedOf(older, [crawlUrlHash(absolute('/x'))])).find(
      (r) => r.issue === input.issue,
    )?.acceptance,
  ).toEqual(original.acceptance)
})

describe('stored HTML text and link heuristics', () => {
  it.each([
    ['title', { title: 'An &amp;amp; example' }, true],
    ['description', { description: 'An &amp;nbsp; example' }, true],
    ['second H1', { body: '<h1>d&amp;#x2019;exemple</h1>' }, true],
    ['decoded once', { h1: 'd&#8217;exemple &amp; other' }, false],
    ['no semicolon', { h1: 'd&amp;#8217 example' }, false],
    ['name bound', { h1: '&amp;' + 'a'.repeat(33) + ';' }, false],
    ['numeric bound', { h1: '&amp;#12345678;' }, false],
    ['named boundary', { h1: '&amp;' + 'a'.repeat(32) + ';' }, true],
    ['numeric boundary', { h1: '&amp;#1234567;' }, true],
  ])('detects references in %s after one decode', async (_, options, raised) => {
    const id = await crawl(websiteOf({ at: '/x', pages: { '/x': page('/x', options) } }))
    const finding = (await issuesAt(id, '/x')).find((row) => row.issue === 'html-entities-as-text')
    expect(Boolean(finding)).toBe(raised)
    if (raised) expect(finding?.evidence).toMatchObject({ kind: 'values', total: 1 })
  })

  it('counts stored internal anchors, handles the threshold boundary and skips unjudgeable responses', async () => {
    const links = (count: number) =>
      Array.from({ length: count }, (_, i) => `<a href="/target${i}">Target</a>`).join('')
    const id = await crawl(
      websiteOf({
        at: '/x',
        pages: {
          '/x': page('/x', { links: links(4) + '<a href="https://external.test/">External</a>' }),
          '/boundary': page('/boundary', { links: links(5) }),
          '/noindex': page('/noindex', { head: '<meta name="robots" content="noindex">' }),
          '/redirect': moved('/about'),
          '/error': { ...page('/error'), statusCode: 404 },
          '/resource': {
            statusCode: 200,
            headers: { 'content-type': 'text/plain' },
            body: Buffer.from('text'),
          },
        },
      }),
    )
    const found = (await issuesAt(id, '/x')).find((row) => row.issue === 'few-html-links')
    expect(found?.evidence).toEqual({
      kind: 'values',
      total: 1,
      items: [{ field: 'internal-links', text: '4' }],
    })
    for (const path of ['/boundary', '/noindex', '/redirect', '/error', '/resource'])
      expect((await issuesAt(id, path)).map((row) => row.issue)).not.toContain('few-html-links')
    await analyseCrawl(db, id, auditSnapshotOf(1, [], undefined, { htmlLinksMin: 0 }))
    expect((await issuesAt(id, '/x')).map((row) => row.issue)).not.toContain('few-html-links')
    await analyseCrawl(db, id, auditSnapshotOf(1, [], undefined, { htmlLinksMin: 6 }))
    expect((await issuesAt(id, '/boundary')).map((row) => row.issue)).toContain('few-html-links')
    const hash = crawlUrlHash(`${SITE}/x`)
    const stored = await db.crawls.getUrl(id, hash)
    await db.crawls.recordResult({
      crawlId: id,
      urlHash: hash,
      result: { ...stored!, data: { ...stored!.data, truncated: true } },
    })
    await analyseCrawl(db, id, auditSnapshotOf(1, []))
    expect((await issuesAt(id, '/x')).map((row) => row.issue)).not.toContain('few-html-links')
  })
})
