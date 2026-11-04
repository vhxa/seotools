import {
  crawlUrlHash,
  createLogger,
  type AuditSelector,
  type CrawlLinkKind,
  type NewAuditRule,
  type Requirement,
} from '@seotools/core'
import { createCompany } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { analyseCrawl, currentAuditConfig } from './analysis'
import { runCrawl } from './engine'
import { fakeSite, type Answer } from './fake-site'
import { SITE, page, xml } from './test-site'

/**
 * What a sitemap lists. Listing is a `<loc>`; the alternates, images and videos an entry names are
 * requested like any URL of the site but are not "in the sitemap". A crawl that stored every URL of
 * a sitemap alike cannot be told apart afterwards, and is not claimed to.
 */

const log = createLogger('test', 'silent')

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

const url = (path: string) => `${SITE}${path}`
const hashOf = (path: string) => crawlUrlHash(url(path))
const exactPath = (path: string): AuditSelector => ({
  kind: 'path',
  path,
  query: { mode: 'any' },
  scope: 'literal',
})
const asking = (path: string, value: Requirement): NewAuditRule => ({
  dimension: 'sitemap',
  value,
  selector: exactPath(path),
  reason: null,
  enabled: true,
})
const noindex = '<meta name="robots" content="noindex">'

async function addRules(rules: NewAuditRule[]) {
  for (const rule of rules) {
    const saved = await db.audit.saveRule({ domainId, rule })
    if (!saved.ok) throw new Error(`rule not saved: ${saved.error}`)
  }
}

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

const findings = async (crawlId: string, path: string) =>
  (await db.crawls.issuesOf(crawlId, [hashOf(path)])).map((row) => row.issue)
const stateOf = async (crawlId: string, path: string) =>
  (await db.crawls.auditOf(crawlId, [hashOf(path)]))[0]

/** What the sitemap file linked to, by the type of link, as the crawl stored it. */
async function linkedFrom(crawlId: string, file: string) {
  const links = await db.crawls.linksFrom(crawlId, [hashOf(file)])
  const byKind = new Map<CrawlLinkKind, string[]>()
  for (const link of links) {
    const target = (await db.crawls.getUrl(crawlId, link.targetHash))?.url ?? link.targetHash
    byKind.set(link.kind, [...(byKind.get(link.kind) ?? []), target])
  }
  return byKind
}

/**
 * A site where the home page links to `/a` and `/b`, and the sitemap lists those two. Entry `/a` also
 * names `/es/a` as an alternate (it is not listed, and not linked anywhere), an image and a video
 * whose player is the page `/player`.
 */
function website(pages: Record<string, Answer> = {}, sitemap?: string) {
  return {
    [url('/')]: page('/', {
      links: '<a href="/a">A</a><a href="/b">B</a>',
    }),
    [url('/a')]: page('/a'),
    [url('/b')]: page('/b'),
    [url('/es/a')]: page('/es/a', { head: noindex }),
    [url('/player')]: page('/player'),
    [url('/sitemap.xml')]: xml(
      sitemap ??
        `<?xml version="1.0"?><urlset xmlns:xhtml="http://www.w3.org/1999/xhtml"
           xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
           xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">
          <url><loc>${url('/a')}</loc>
            <xhtml:link rel="alternate" hreflang="es" href="${url('/es/a')}"/>
            <xhtml:link rel="alternate" hreflang="en" href="${url('/a')}"/>
            <image:image><image:loc>${url('/pic.png')}</image:loc></image:image>
            <video:video><video:player_loc>${url('/player')}</video:player_loc></video:video>
          </url>
          <url><loc>${url('/b')}</loc></url>
        </urlset>`,
    ),
    ...pages,
  } satisfies Record<string, Answer>
}

describe('a crawl that records what a sitemap did with each URL', () => {
  it('lists the <loc> and stores the rest under the type that says what it was', async () => {
    const id = await crawl(website())
    const links = await linkedFrom(id, '/sitemap.xml')
    expect(links.get('sitemap')?.sort()).toEqual([url('/a'), url('/b')])
    expect(links.get('hreflang')?.sort()).toEqual([url('/a'), url('/es/a')])
    expect(links.get('image')).toEqual([url('/pic.png')])
    expect(links.get('media')).toEqual([url('/player')])
  })

  it('still finds and requests what it only names', async () => {
    const id = await crawl(website())
    for (const path of ['/es/a', '/player', '/pic.png']) {
      const stored = await db.crawls.getUrl(id, hashOf(path))
      expect(stored, path).toMatchObject({ state: 'done', source: 'sitemap', scope: 'internal' })
    }
    expect(await db.crawls.getUrl(id, hashOf('/es/a'))).toMatchObject({ statusCode: 200 })
  })

  it('does not call an alternate that no <url> lists a non-indexable URL in the sitemap', async () => {
    const id = await crawl(website())
    // It has noindex and the sitemap only names it as an alternate: nothing lists it.
    expect(await findings(id, '/es/a')).toContain('noindex')
    expect(await findings(id, '/es/a')).not.toContain('sitemap-not-indexable')
    // What the sitemap lists, it lists: a noindex there is a conflict again.
    const conflict = await crawl(website({ [url('/b')]: page('/b', { head: noindex }) }))
    expect(await findings(conflict, '/b')).toContain('sitemap-not-indexable')
  })

  it('names what keeps a listed URL from being indexed', async () => {
    const id = await crawl(
      website({
        [url('/a')]: page('/a', { head: noindex, canonical: url('/b') }),
        [url('/b')]: { statusCode: 301, headers: { location: url('/') } },
      }),
    )
    const rows = await db.crawls.issuesOf(id, [hashOf('/a'), hashOf('/b')])
    const of = (path: string) =>
      rows.find((row) => row.urlHash === hashOf(path) && row.issue === 'sitemap-not-indexable')
    expect(of('/a')?.details?.sort()).toEqual(['canonical', 'noindex'])
    expect(of('/b')?.details).toEqual(['redirect'])
  })

  it('does not take an alternate for being listed when a rule requires or forbids the listing', async () => {
    await addRules([asking('/es/a', 'required'), asking('/player', 'forbidden')])
    const id = await crawl(website())
    // Not listed, so it is missing where a listing is required.
    expect(await findings(id, '/es/a')).toContain('sitemap-required-missing')
    expect(await stateOf(id, '/es/a')).toMatchObject({
      conditions: { sitemap: { requirement: 'required', observed: 'absent' } },
    })
    // Only the player of a video: not listed, so not forbidden.
    expect(await findings(id, '/player')).not.toContain('sitemap-forbidden-present')
    expect(await stateOf(id, '/player')).toMatchObject({
      conditions: { sitemap: { requirement: 'forbidden', observed: 'absent' } },
    })
  })

  it('does not take a page that is only the player of a video for a listed one', async () => {
    const id = await crawl(website())
    expect(await findings(id, '/player')).toContain('indexable-not-in-sitemap')
    expect(await findings(id, '/a')).not.toContain('indexable-not-in-sitemap')
  })

  it('is satisfied by an alternate that also has a <url> of its own', async () => {
    await addRules([asking('/es/a', 'required')])
    const id = await crawl(
      website(
        {},
        `<urlset xmlns:xhtml="x">
          <url><loc>${url('/a')}</loc>
            <xhtml:link rel="alternate" hreflang="es" href="${url('/es/a')}"/></url>
          <url><loc>${url('/es/a')}</loc>
            <xhtml:link rel="alternate" hreflang="en" href="${url('/a')}"/></url>
          <url><loc>${url('/b')}</loc></url>
        </urlset>`,
      ),
    )
    expect(await findings(id, '/es/a')).not.toContain('sitemap-required-missing')
    expect(await stateOf(id, '/es/a')).toMatchObject({
      conditions: { sitemap: { observed: 'present' } },
    })
    expect(await findings(id, '/es/a')).toContain('sitemap-not-indexable')
  })

  it('keeps the hreflang relations the sitemap declares, with their origin', async () => {
    const id = await crawl(website())
    // /a declares /es/a as an alternate, in the sitemap, and /es/a is noindex: that is about hreflang.
    const rows = await db.crawls.issuesOf(id, [hashOf('/a')])
    expect(rows.find((row) => row.issue === 'hreflang-noindex')?.details).toEqual(['sitemap'])
    expect(rows.map((row) => row.issue)).not.toContain('hreflang-no-self')
  })

  it('reads a sitemap index, and the plain-text sitemap it points at', async () => {
    const id = await crawl(
      website(
        {
          [url('/pages.xml')]: xml(
            `<urlset><url><loc>${url('/a')}</loc></url><url><loc>${url('/b')}</loc></url></urlset>`,
          ),
          [url('/list.txt')]: {
            statusCode: 200,
            headers: { 'content-type': 'text/plain' },
            body: Buffer.from(`${url('/player')}\n`),
          },
        },
        `<sitemapindex><sitemap><loc>${url('/pages.xml')}</loc></sitemap>
          <sitemap><loc>${url('/list.txt')}</loc></sitemap></sitemapindex>`,
      ),
    )
    const links = await linkedFrom(id, '/pages.xml')
    expect(links.get('sitemap')?.sort()).toEqual([url('/a'), url('/b')])
    expect((await linkedFrom(id, '/list.txt')).get('sitemap')).toEqual([url('/player')])
    // /player is only linked from the text sitemap, which lists it.
    for (const path of ['/a', '/player']) {
      expect(await findings(id, path)).not.toContain('indexable-not-in-sitemap')
    }
  })
})

/**
 * What a crawl from before the origin was recorded looks like: every URL of a sitemap is a link of
 * the `sitemap` type, and the sitemap file has no `references`. That is all it says, and re-analysing
 * it cannot say more.
 */
async function storeLikeBefore(id: string) {
  const file = (await db.crawls.getUrl(id, hashOf('/sitemap.xml')))!
  const { references: _gone, ...size } = file.data!.sitemapSize!
  await db.crawls.recordResult({
    crawlId: id,
    urlHash: hashOf('/sitemap.xml'),
    result: { ...file, data: { ...file.data, sitemapSize: size } },
    links: ['/a', '/b', '/es/a', '/pic.png', '/player'].map((path) => ({
      sourceHash: hashOf('/sitemap.xml'),
      targetHash: hashOf(path),
      kind: 'sitemap' as const,
    })),
  })
}

const reanalyse = async (id: string) => {
  await analyseCrawl(db, id, await currentAuditConfig(db, domainId))
}

describe('a crawl from before the origin was recorded', () => {
  it('does not say that an alternate was listed, nor that it was not', async () => {
    await addRules([asking('/es/a', 'required')])
    const id = await crawl(website())
    // As the old crawler stored it: the alternate looked listed.
    await storeLikeBefore(id)
    await reanalyse(id)

    expect(await findings(id, '/es/a')).not.toContain('sitemap-not-indexable')
    expect(await findings(id, '/es/a')).not.toContain('sitemap-required-missing')
    expect(await findings(id, '/es/a')).not.toContain('indexable-not-in-sitemap')
    expect(await stateOf(id, '/es/a')).toMatchObject({
      conditions: { sitemap: { requirement: 'required', observed: 'unknown' } },
    })
  })

  it('does not claim a forbidden listing for it either', async () => {
    await addRules([asking('/es/a', 'forbidden')])
    const id = await crawl(website())
    await storeLikeBefore(id)
    await reanalyse(id)
    expect(await findings(id, '/es/a')).not.toContain('sitemap-forbidden-present')
    expect(await stateOf(id, '/es/a')).toMatchObject({
      conditions: { sitemap: { observed: 'unknown' } },
    })
  })

  it('keeps reading as listed what no sitemap declared as an alternate', async () => {
    await addRules([asking('/b', 'forbidden')])
    const id = await crawl(website({ [url('/b')]: page('/b', { head: noindex }) }))
    await storeLikeBefore(id)
    await reanalyse(id)
    expect(await findings(id, '/b')).toContain('sitemap-not-indexable')
    expect(await findings(id, '/b')).toContain('sitemap-forbidden-present')
  })

  it('is not repaired by analysing it again: a crawl with the origin is what says', async () => {
    const id = await crawl(website())
    await storeLikeBefore(id)
    await reanalyse(id)
    expect((await stateOf(id, '/es/a'))?.conditions).toEqual({})
    // The alternate is neither listed nor unlisted for that crawl, so the page that declares it has
    // nothing to be told about a listing it never had.
    const next = await crawl(website())
    await addRules([asking('/es/a', 'required')])
    await reanalyse(next)
    expect(await stateOf(next, '/es/a')).toMatchObject({
      conditions: { sitemap: { observed: 'absent' } },
    })
  })

  it('tells the sitemaps apart one by one when a crawl has both', async () => {
    // The first file was stored before the origin was recorded and the second after.
    const both = `<sitemapindex><sitemap><loc>${url('/old.xml')}</loc></sitemap>
      <sitemap><loc>${url('/new.xml')}</loc></sitemap></sitemapindex>`
    const id = await crawl(
      website(
        {
          [url('/old.xml')]: xml(
            `<urlset xmlns:xhtml="x"><url><loc>${url('/a')}</loc>
              <xhtml:link rel="alternate" hreflang="es" href="${url('/es/a')}"/></url></urlset>`,
          ),
          [url('/new.xml')]: xml(
            `<urlset xmlns:xhtml="x"><url><loc>${url('/b')}</loc>
              <xhtml:link rel="alternate" hreflang="es" href="${url('/es/a')}"/></url></urlset>`,
          ),
        },
        both,
      ),
    )
    const old = (await db.crawls.getUrl(id, hashOf('/old.xml')))!
    const { references: _gone, ...size } = old.data!.sitemapSize!
    await db.crawls.recordResult({
      crawlId: id,
      urlHash: hashOf('/old.xml'),
      result: { ...old, data: { ...old.data, sitemapSize: size } },
      links: [
        { sourceHash: hashOf('/old.xml'), targetHash: hashOf('/a'), kind: 'sitemap' },
        { sourceHash: hashOf('/old.xml'), targetHash: hashOf('/es/a'), kind: 'sitemap' },
      ],
    })
    await addRules([asking('/es/a', 'required'), asking('/a', 'required')])
    await reanalyse(id)
    // /es/a: only the old file names it as a listing, and it is an alternate: cannot be told.
    expect(await stateOf(id, '/es/a')).toMatchObject({
      conditions: { sitemap: { observed: 'unknown' } },
    })
    // /a: the old file lists it, and nothing declares it an alternate: it was listed.
    expect(await stateOf(id, '/a')).toMatchObject({
      conditions: { sitemap: { observed: 'present' } },
    })
  })
})
