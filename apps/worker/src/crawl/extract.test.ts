import { describe, expect, it } from 'vitest'
import {
  extractCssUrls,
  extractHtml,
  parseLinkHeader,
  parseRefresh,
  parseRobotsSitemaps,
  parseFeed,
  parseOpenSearch,
  parseSitemap,
} from './extract'

const PAGE = 'https://example.com/blog/post'
const urlsOf = (html: string, kind?: string) =>
  extractHtml(html, PAGE)
    .links.filter((link) => !kind || link.kind === kind)
    .map((link) => link.url)

describe('extractHtml', () => {
  it('reads the data of a page', () => {
    const page = extractHtml(
      `<html><head>
        <title>  My
          title </title>
        <meta name="description" content="About this">
        <meta name="robots" content="noindex">
        <meta name="ROBOTS" content="nofollow">
        <meta name="googlebot" content="noarchive">
        <meta name="GPTBot" content="noindex">
        <link rel="canonical" href="/blog/post/">
        <link rel="alternate" hreflang="es" href="https://example.com/es/post">
        <link rel="alternate" hreflang="x-default" href="/post">
      </head><body><h1>Hello <em>world</em></h1><h1>Second</h1></body></html>`,
      PAGE,
    )
    expect(page).toMatchObject({
      title: 'My title',
      description: 'About this',
      metaRobots: 'noindex, nofollow',
      botRobots: { googlebot: 'noarchive', gptbot: 'noindex' },
      canonical: 'https://example.com/blog/post/',
      h1: ['Hello world', 'Second'],
      hreflang: [
        { lang: 'es', url: 'https://example.com/es/post' },
        { lang: 'x-default', url: 'https://example.com/post' },
      ],
    })
  })

  it('keeps its time and size in check whatever a page holds', () => {
    const started = Date.now()
    const page = extractHtml(
      `<head><${'x'.repeat(5000)}></head><link rel="canonical" href="/${'a'.repeat(10_000)}">
       <a href="/x">${'.!'.repeat(500_000)}a</a>`,
      PAGE,
    )
    expect(Date.now() - started).toBeLessThan(2000)
    expect(page.facts.invalidHeadElements[0]).toHaveLength(50)
    expect(page.facts.canonicals[0]?.raw).toHaveLength(2048)
  })

  it('does not mistake the title of an SVG for the title of the page', () => {
    expect(extractHtml('<svg><title>Icon</title></svg><title>Page</title>', PAGE).title).toBe(
      'Page',
    )
    expect(extractHtml('<svg><title>Icon</title></svg>', PAGE).title).toBeNull()
  })

  it('finds URLs in the head', () => {
    const html = `<head>
      <link rel="canonical" href="/c">
      <link rel="alternate" hreflang="fr" href="/fr">
      <link rel="stylesheet" href="/a.css">
      <link rel="icon" href="/favicon.ico">
      <link rel="preload" as="image" imagesrcset="/p1.png 1x, /p2.png 2x">
      <link rel="next" href="/page/2">
      <link rel="amphtml" href="/amp">
      <link rel="manifest" href="/site.webmanifest">
      <script src="/a.js"></script>
      <meta property="og:image" content="/og.png">
      <meta property="og:url" content="https://example.com/og">
      <meta name="twitter:image" content="/tw.png">
      <meta http-equiv="refresh" content="5; url=/moved">
    </head>`
    expect(urlsOf(html, 'canonical')).toEqual(['https://example.com/c'])
    expect(urlsOf(html, 'hreflang')).toEqual(['https://example.com/fr'])
    expect(urlsOf(html, 'style')).toEqual(['https://example.com/a.css'])
    expect(urlsOf(html, 'script')).toEqual(['https://example.com/a.js'])
    expect(urlsOf(html, 'head-link').sort()).toEqual(
      ['/amp', '/favicon.ico', '/p1.png', '/p2.png', '/page/2', '/site.webmanifest']
        .map((path) => `https://example.com${path}`)
        .sort(),
    )
    expect(urlsOf(html, 'meta').sort()).toEqual(
      ['/moved', '/og', '/og.png', '/tw.png'].map((p) => `https://example.com${p}`).sort(),
    )
  })

  it('finds URLs in the body', () => {
    const html = `
      <a href="/a">a</a><a href="other">relative</a><area href="/area">
      <img src="/i.png" srcset="/i1.png 1x, /i2.png 2x" data-src="/lazy.png" data-srcset="/l.png 2x">
      <picture><source srcset="/s.webp"></picture>
      <video src="/v.mp4" poster="/poster.png"><track src="/t.vtt"></video>
      <audio src="/a.mp3"></audio><embed src="/e.swf"><object data="/o.pdf"></object>
      <iframe src="/f.html"></iframe>
      <form action="/search"></form><form method="POST" action="/login"></form>
      <blockquote cite="/source"></blockquote>
      <svg><image href="/svg.png"/></svg>`
    const urls = urlsOf(html).map((url) => url.replace('https://example.com', ''))
    expect(urls).toEqual(
      expect.arrayContaining([
        '/a',
        '/blog/other',
        '/area',
        '/i.png',
        '/i1.png',
        '/i2.png',
        '/lazy.png',
        '/l.png',
        '/s.webp',
        '/v.mp4',
        '/poster.png',
        '/t.vtt',
        '/a.mp3',
        '/e.swf',
        '/o.pdf',
        '/f.html',
        '/search',
        '/source',
        '/svg.png',
      ]),
    )
    // A POST form is an action, not a page anyone can link to.
    expect(urls).not.toContain('/login')
  })

  it('follows rel=nofollow links and links on noindex pages all the same', () => {
    const html =
      '<meta name="robots" content="noindex,nofollow"><a rel="nofollow" href="/hidden">x</a>'
    expect(urlsOf(html, 'anchor-nofollow')).toEqual(['https://example.com/hidden'])
  })

  it('finds URLs in CSS and structured data', () => {
    const html = `
      <style>body { background: url("/bg.png") } @import '/more.css';</style>
      <div style="background-image: url(/inline.png)"></div>
      <script type="application/ld+json">
        { "@type": "Article", "url": "https://example.com/ld", "image": ["https://example.com/ld.png"],
          "author": { "url": "https://elsewhere.org/me" }, "name": "not a url" }
      </script>
      <script type="application/ld+json">{ broken json </script>`
    expect(urlsOf(html, 'style').sort()).toEqual(
      ['/bg.png', '/inline.png', '/more.css'].map((p) => `https://example.com${p}`).sort(),
    )
    expect(urlsOf(html, 'structured-data').sort()).toEqual(
      ['https://elsewhere.org/me', 'https://example.com/ld', 'https://example.com/ld.png'].sort(),
    )
  })

  it('resolves against <base>, and only the first one', () => {
    const html =
      '<base href="https://example.com/x/"><base href="https://example.com/y/"><a href="a">a</a>'
    expect(urlsOf(html, 'anchor')).toEqual(['https://example.com/x/a'])
  })

  it('ignores what cannot be requested', () => {
    const html = `<a href="#top">x</a><a href="">x</a><a href="mailto:a@b.co">x</a>
      <a href="tel:+1">x</a><a href="javascript:void(0)">x</a>
      <img src="data:image/png;base64,AAAA">`
    expect(extractHtml(html, PAGE).links).toEqual([])
  })

  it('survives broken markup', () => {
    const page = extractHtml('<title>Oops<a href="/a"><div><<<>>', PAGE)
    expect(page.links.length).toBeLessThanOrEqual(1)
    expect(extractHtml('', PAGE).title).toBeNull()
  })
})

describe('parseRefresh', () => {
  it.each([
    ['0; url=/next', '/next'],
    ['5;URL=https://a.co/', 'https://a.co/'],
    ["3; url='/quoted'", '/quoted'],
    ['10', undefined],
  ])('%s → %s', (value, expected) => {
    expect(parseRefresh(value)).toBe(expected)
  })
})

describe('extractCssUrls', () => {
  it('finds url() and @import, quoted or not, and skips data URLs', () => {
    const css = `@import "a.css"; @import url(b.css);
      .x { background: url('/c.png'), url(d.png); mask: url(#local); src: url(data:font/woff;base64,AA) }`
    expect(
      extractCssUrls(css, 'https://example.com/css/main.css')
        .map((l) => l.url)
        .sort(),
    ).toEqual(
      [
        'https://example.com/c.png',
        'https://example.com/css/a.css',
        'https://example.com/css/b.css',
        'https://example.com/css/d.png',
      ].sort(),
    )
  })
})

describe('parseLinkHeader', () => {
  it('reads canonicals, hreflangs and other links', () => {
    const parsed = parseLinkHeader(
      '</c>; rel="canonical", <https://example.com/es>; rel="alternate"; hreflang="es", </s.css>; rel=preload; as=style',
      PAGE,
    )
    expect(parsed.canonical).toBe('https://example.com/c')
    expect(parsed.hreflang).toEqual([
      { lang: 'es', url: 'https://example.com/es', source: 'header' },
    ])
    expect(parsed.links).toEqual([
      { url: 'https://example.com/c', kind: 'canonical' },
      { url: 'https://example.com/es', kind: 'hreflang' },
      { url: 'https://example.com/s.css', kind: 'http-header' },
    ])
  })
})

describe('parseSitemap', () => {
  const base = 'https://example.com/sitemap.xml'

  it('reads a urlset, with images, videos and alternates', () => {
    const parsed = parseSitemap(
      `<?xml version="1.0"?><urlset xmlns:image="i" xmlns:video="v" xmlns:xhtml="x">
        <url><loc> https://example.com/a </loc>
          <xhtml:link rel="alternate" hreflang="es" href="https://example.com/es/a"/>
          <image:image><image:loc>https://example.com/a.png</image:loc></image:image>
          <video:video><video:content_loc>https://example.com/a.mp4</video:content_loc></video:video>
        </url>
        <url><loc>https://example.com/b?x=1&amp;y=2</loc></url>
      </urlset>`,
      base,
    )
    expect(parsed.sitemaps).toEqual([])
    expect(parsed.urls.sort()).toEqual(
      [
        'https://example.com/a',
        'https://example.com/es/a',
        'https://example.com/a.png',
        'https://example.com/a.mp4',
        'https://example.com/b?x=1&y=2',
      ].sort(),
    )
  })

  it('reads a sitemap index', () => {
    const parsed = parseSitemap(
      `<sitemapindex><sitemap><loc>https://example.com/one.xml</loc></sitemap>
        <sitemap><loc>https://example.com/two.xml.gz</loc></sitemap></sitemapindex>`,
      base,
    )
    expect(parsed.urls).toEqual([])
    expect(parsed.sitemaps).toEqual([
      'https://example.com/one.xml',
      'https://example.com/two.xml.gz',
    ])
  })

  it('reads a plain-text sitemap', () => {
    expect(
      parseSitemap('https://example.com/a\r\n\r\nnot a url\nhttps://example.com/b', base).urls,
    ).toEqual(['https://example.com/a', 'https://example.com/b'])
  })

  it('finds nothing in other XML', () => {
    expect(parseSitemap('<rss><channel><link>https://a.co</link></channel></rss>', base)).toEqual({
      urls: [],
      sitemaps: [],
      format: null,
      entries: 0,
      lastModified: null,
      hreflang: [],
    })
  })
})

describe('parseRobotsSitemaps', () => {
  it('finds sitemaps anywhere in the file, case-insensitively', () => {
    const robots = `User-agent: *\nDisallow: /\nSITEMAP: https://example.com/a.xml\n  sitemap:/rel.xml\nSitemap:\n# Sitemap: https://example.com/comment.xml`
    expect(parseRobotsSitemaps(robots, 'https://example.com/robots.txt')).toEqual([
      'https://example.com/a.xml',
      'https://example.com/rel.xml',
    ])
  })
})

describe('sitemap summaries', () => {
  const base = 'https://example.com/sitemap.xml'

  it('counts entries, not the images in them, and keeps the newest date', () => {
    const parsed = parseSitemap(
      `<?xml version="1.0"?>
      <urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
              xmlns:image="http://www.google.com/schemas/sitemap-image/1.1">
        <url><loc>https://example.com/a</loc><lastmod>2026-01-02</lastmod>
          <image:image><image:loc>https://example.com/a.png</image:loc></image:image></url>
        <url><loc>https://example.com/b</loc><lastmod>2026-03-04T10:00:00+00:00</lastmod></url>
        <url><loc>https://example.com/c</loc><lastmod>not a date</lastmod></url>
      </urlset>`,
      base,
    )
    expect(parsed).toMatchObject({
      format: 'urlset',
      entries: 3,
      lastModified: '2026-03-04T10:00:00.000Z',
    })
  })

  it('tells an index apart', () => {
    const parsed = parseSitemap(
      '<sitemapindex><sitemap><loc>https://example.com/a.xml</loc></sitemap></sitemapindex>',
      base,
    )
    expect(parsed).toMatchObject({
      format: 'index',
      entries: 1,
      sitemaps: ['https://example.com/a.xml'],
    })
  })

  it('reads plain text as a sitemap only if it lists URLs', () => {
    expect(parseSitemap('https://example.com/a\nhttps://example.com/b', base)).toMatchObject({
      format: 'text',
      entries: 2,
    })
    expect(parseSitemap('nothing here', base).format).toBeNull()
    expect(parseSitemap('<!doctype html><html></html>', base).format).toBeNull()
  })
})

describe('announced files', () => {
  it('finds the feeds and search descriptions a page announces, which are links as well', () => {
    const page = extractHtml(
      `<head>
        <link rel="alternate" type="application/rss+xml" href="/rss">
        <link rel="alternate" type="application/atom+xml" href="https://example.com/atom">
        <link rel="alternate" hreflang="es" href="/es">
        <link rel="search" type="application/opensearchdescription+xml" href="/os.xml">
      </head>`,
      'https://example.com/',
    )
    expect(page.feeds).toEqual(['https://example.com/rss', 'https://example.com/atom'])
    expect(page.openSearch).toEqual(['https://example.com/os.xml'])
    expect(page.links.map((link) => link.url)).toContain('https://example.com/rss')
  })
})

describe('parseFeed', () => {
  it('reads RSS', () => {
    expect(
      parseFeed(`<rss version="2.0"><channel><title> Blog </title><lastBuildDate>Mon, 02 Mar 2026 10:00:00 GMT</lastBuildDate>
        <item><title>First</title><pubDate>Sun, 01 Mar 2026 10:00:00 GMT</pubDate></item>
        <item><title>Second</title></item></channel></rss>`),
    ).toEqual({
      format: 'rss',
      title: 'Blog',
      items: 2,
      lastModified: '2026-03-02T10:00:00.000Z',
    })
  })

  it('reads Atom', () => {
    expect(
      parseFeed(`<feed xmlns="http://www.w3.org/2005/Atom"><title>Blog</title><updated>2026-03-02T10:00:00Z</updated>
        <entry><title>First</title></entry></feed>`),
    ).toMatchObject({ format: 'atom', title: 'Blog', items: 1 })
  })

  it('refuses anything else', () => {
    expect(parseFeed('<!doctype html><html></html>')).toBeNull()
    expect(parseFeed('not xml')).toBeNull()
  })
})

describe('parseOpenSearch', () => {
  it('reads a description', () => {
    expect(
      parseOpenSearch(`<OpenSearchDescription xmlns="http://a9.com/-/spec/opensearch/1.1/">
        <ShortName>Acme</ShortName><Description>Search Acme</Description>
        <Url type="text/html" template="https://example.com/s?q={searchTerms}"/>
      </OpenSearchDescription>`),
    ).toEqual({
      shortName: 'Acme',
      description: 'Search Acme',
      templates: ['https://example.com/s?q={searchTerms}'],
    })
  })

  it('refuses anything else', () => {
    expect(parseOpenSearch('<html></html>')).toBeNull()
  })
})
