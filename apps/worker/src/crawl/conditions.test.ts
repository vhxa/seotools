import {
  AUDIT_CONDITIONS,
  PAGE_ISSUES,
  auditSnapshotOf,
  crawlUrlHash,
  createLogger,
  type AuditCondition,
  type AuditRule,
  type AuditSelector,
  type NewAuditRule,
  type PageIssueId,
  type Requirement,
} from '@seotools/core'
import { createCompany } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { analyseCrawl } from './analysis'
import { recomputeAudit } from './audit-recompute'
import { presenceOf } from './conditions'
import { runCrawl } from './engine'
import { fakeSite, moved, type Answer } from './fake-site'
import { FetchError } from './fetcher'
import { CHECKS } from './issue-checks'
import { SiteContextError, evaluateRecheck, recheckContext, recheckSubject } from './recheck'
import { reanalyseOutdatedCrawls } from './reanalysis'
import { analyseResponse } from './response'
import { SITE, page, sitemapOf, xml } from './test-site'

/**
 * What rules ask of the four conditions of a URL (`noindex`, `nofollow`, `robots`, `sitemap`): each
 * is `required` (a finding when it provably is not there), `allowed` (no finding for it either way) or
 * `forbidden` (a finding when it provably is), decided on its own. What the crawl could not read
 * proves nothing.
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

const exactPath = (path: string): AuditSelector => ({
  kind: 'path',
  path,
  query: { mode: 'any' },
  scope: 'literal',
})
const prefix = (path: string): AuditSelector => ({
  kind: 'prefix',
  path,
  query: { mode: 'any' },
  scope: 'literal',
})
const exactUrl = (path: string): AuditSelector => ({ kind: 'url', url: `${SITE}${path}` })

const asking = (
  selector: AuditSelector,
  dimension: AuditCondition,
  value: Requirement,
  enabled = true,
): NewAuditRule => ({ dimension, value, selector, reason: null, enabled })
const expecting = (
  selector: AuditSelector,
  value: 'indexable' | 'not-indexable',
): NewAuditRule => ({
  dimension: 'intent',
  value,
  selector,
  reason: null,
  enabled: true,
})

async function addRules(rules: NewAuditRule[]) {
  const ids: string[] = []
  for (const rule of rules) {
    const saved = await db.audit.saveRule({ domainId, rule })
    if (!saved.ok) throw new Error(`rule not saved: ${saved.error}`)
    ids.push(saved.rule!.id)
  }
  return ids
}

const absolute = (path: string) => (path.startsWith('http') ? path : `${SITE}${path}`)
const meta = (content: string) => `<meta name="robots" content="${content}">`

/** A small site whose sitemap lists `listed` (every page when left out). */
function website(
  pages: Record<string, Answer> = {},
  options: { listed?: string[]; robots?: Answer; sitemap?: Answer } = {},
) {
  const all: Record<string, Answer> = {
    '/a': page('/a'),
    '/b': page('/b'),
    '/c': page('/c'),
    ...pages,
  }
  // The home page links to everything, so a page is found even where no sitemap lists it.
  const links = Object.keys(all)
    .map((path) => `<a href="${path}">A link to ${path}</a>`)
    .join('')
  all['/'] = pages['/'] ?? page('/', { links })
  const site: Record<string, Answer> = {
    [`${SITE}/sitemap.xml`]: options.sitemap ?? xml(sitemapOf(options.listed ?? Object.keys(all))),
  }
  if (options.robots) site[`${SITE}/robots.txt`] = options.robots
  for (const [path, answer] of Object.entries(all)) site[absolute(path)] = answer
  return site
}

const robotsTxt = (body: string): Answer => ({
  statusCode: 200,
  headers: { 'content-type': 'text/plain' },
  body: Buffer.from(body),
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

const hashOf = (path: string) => crawlUrlHash(absolute(path))
const findings = async (crawlId: string, path: string) =>
  (await db.crawls.issuesOf(crawlId, [hashOf(path)])).map((row) => row.issue)
const stateOf = async (crawlId: string, path: string) =>
  (await db.crawls.auditOf(crawlId, [hashOf(path)]))[0]

const MISSING: Record<AuditCondition, PageIssueId> = {
  noindex: 'noindex-required-missing',
  nofollow: 'nofollow-required-missing',
  robots: 'robots-block-required-missing',
  sitemap: 'sitemap-required-missing',
}
/** What a condition that is there raises when it is forbidden. */
const PRESENT: Record<AuditCondition, PageIssueId> = {
  noindex: 'noindex',
  nofollow: 'nofollow',
  robots: 'robots-blocked',
  sitemap: 'sitemap-forbidden-present',
}
/** The finding a condition has when nothing is stated about it, if it is there or not. */
const GENERIC_IF_MISSING: Partial<Record<AuditCondition, PageIssueId>> = {
  sitemap: 'indexable-not-in-sitemap',
}

/** A site where `/x` has the condition and `/y` does not. */
function withAndWithout(condition: AuditCondition) {
  switch (condition) {
    case 'noindex':
      return website({
        '/x': page('/x', { head: meta('noindex') }),
        '/y': page('/y'),
      })
    case 'nofollow':
      return website({
        '/x': page('/x', { head: meta('nofollow') }),
        '/y': page('/y'),
      })
    case 'robots':
      return website(
        { '/x': page('/x'), '/y': page('/y') },
        { robots: robotsTxt('User-agent: *\nDisallow: /x') },
      )
    case 'sitemap':
      return website(
        { '/x': page('/x'), '/y': page('/y') },
        { listed: ['/', '/a', '/b', '/c', '/x'] },
      )
  }
}

describe.each(AUDIT_CONDITIONS)('the %s condition', (condition) => {
  const rule = (requirement: Requirement) => asking(prefix('/'), condition, requirement)

  it('behaves as it always did when no rule states it', async () => {
    const id = await crawl(withAndWithout(condition))
    for (const path of ['/x', '/y']) {
      const found = await findings(id, path)
      for (const issue of Object.values(MISSING)) expect(found).not.toContain(issue)
      expect(found).not.toContain('sitemap-forbidden-present')
      expect((await stateOf(id, path))?.conditions).toEqual({})
    }
    // The generic finding is what it was: a directive or a block is a finding, a sitemap is not.
    const there = await findings(id, '/x')
    if (condition === 'sitemap') expect(there).not.toContain('indexable-not-in-sitemap')
    else expect(there).toContain(PRESENT[condition])
    if (GENERIC_IF_MISSING[condition]) {
      expect(await findings(id, '/y')).toContain(GENERIC_IF_MISSING[condition])
    }
  })

  it('required: a finding when it is not there, none when it is', async () => {
    await addRules([rule('required')])
    const id = await crawl(withAndWithout(condition))
    expect(await findings(id, '/x')).not.toContain(MISSING[condition])
    expect(await findings(id, '/y')).toContain(MISSING[condition])
    // Having it is what is wanted: the generic finding for having it is not raised.
    if (condition !== 'sitemap') expect(await findings(id, '/x')).not.toContain(PRESENT[condition])
    expect(await stateOf(id, '/x')).toMatchObject({
      conditions: { [condition]: { requirement: 'required', observed: 'present' } },
    })
    expect(await stateOf(id, '/y')).toMatchObject({
      conditions: { [condition]: { requirement: 'required', observed: 'absent' } },
    })
  })

  it('allowed: no finding for it either way', async () => {
    await addRules([rule('allowed')])
    const id = await crawl(withAndWithout(condition))
    for (const path of ['/x', '/y']) {
      const found = await findings(id, path)
      expect(found).not.toContain(MISSING[condition])
      expect(found).not.toContain(PRESENT[condition])
      if (GENERIC_IF_MISSING[condition]) expect(found).not.toContain(GENERIC_IF_MISSING[condition])
    }
  })

  it('forbidden: a finding when it is there, none when it is not', async () => {
    await addRules([rule('forbidden')])
    const id = await crawl(withAndWithout(condition))
    expect(await findings(id, '/x')).toContain(PRESENT[condition])
    expect(await findings(id, '/y')).not.toContain(PRESENT[condition])
    expect(await findings(id, '/y')).not.toContain(MISSING[condition])
    expect(await stateOf(id, '/y')).toMatchObject({
      conditions: { [condition]: { requirement: 'forbidden', observed: 'absent' } },
    })
  })

  it('is decided apart from the other conditions', async () => {
    const others = AUDIT_CONDITIONS.filter((other) => other !== condition)
    await addRules([rule('required')])
    const id = await crawl(withAndWithout(condition))
    const state = await stateOf(id, '/y')
    expect(Object.keys(state?.conditions ?? {})).toEqual([condition])
    for (const other of others) expect(state?.conditions[other]).toBeUndefined()
  })

  it('is inherited by an exception for one URL that states it again', async () => {
    await addRules([rule('required'), asking(exactUrl('/y'), condition, 'allowed')])
    const id = await crawl(withAndWithout(condition))
    expect(await findings(id, '/y')).not.toContain(MISSING[condition])
    expect(await stateOf(id, '/y')).toMatchObject({
      conditions: { [condition]: { requirement: 'allowed' } },
    })
    expect(await stateOf(id, '/a')).toMatchObject({
      conditions: { [condition]: { requirement: 'required' } },
    })
  })

  it('does not act through a disabled exception', async () => {
    await addRules([rule('required'), asking(exactUrl('/y'), condition, 'allowed', false)])
    const id = await crawl(withAndWithout(condition))
    expect(await findings(id, '/y')).toContain(MISSING[condition])
  })
})

describe('conditions inherited one at a time', () => {
  it('takes each from the most specific rule that states it, whatever the others say', async () => {
    const [noindexRule, , sitemapRule] = await addRules([
      asking(prefix('/'), 'noindex', 'required'),
      asking(prefix('/'), 'nofollow', 'allowed'),
      asking(prefix('/a'), 'sitemap', 'forbidden'),
      asking(exactUrl('/a'), 'nofollow', 'forbidden'),
    ])
    const id = await crawl(website({ '/a': page('/a', { head: meta('noindex, nofollow') }) }))
    expect(await stateOf(id, '/a')).toMatchObject({
      conditions: {
        noindex: { requirement: 'required', rule: noindexRule },
        nofollow: { requirement: 'forbidden' },
        sitemap: { requirement: 'forbidden', rule: sitemapRule },
      },
    })
    const found = await findings(id, '/a')
    // The nofollow is forbidden here (the exception), the noindex is wanted, the sitemap is not.
    expect(found).toContain('nofollow')
    expect(found).not.toContain('noindex')
    expect(found).toContain('sitemap-forbidden-present')
    // Another URL takes the broader nofollow, which allows it.
    expect((await stateOf(id, '/b'))?.conditions.nofollow?.requirement).toBe('allowed')
  })
})

describe('what an allowed condition leaves alone', () => {
  it('does not hide a conflict of directives, or the other pages that point at a noindex', async () => {
    await addRules([asking(exactPath('/a'), 'noindex', 'allowed')])
    const id = await crawl(
      website({
        '/a': page('/a', { head: meta('noindex, index') }),
        '/b': page('/b', {
          links: `<a href="/">Back</a><a href="/a">A</a>`,
          head: `<link rel="alternate" hreflang="es" href="${SITE}/a"><link rel="alternate" hreflang="en" href="${SITE}/b">`,
        }),
        '/c': page('/c', { canonical: `${SITE}/a` }),
      }),
    )
    const own = await findings(id, '/a')
    expect(own).not.toContain('noindex')
    expect(own).toContain('directives-conflict')
    // What other pages say about it is theirs: a canonical to a page that cannot be indexed, an
    // hreflang pointing at a noindex.
    expect(await findings(id, '/c')).toContain('canonical-not-indexable')
    expect(await findings(id, '/b')).toContain('hreflang-noindex')
  })

  it('does not hide a robots.txt block that is allowed from what the page says', async () => {
    await addRules([asking(exactPath('/x'), 'robots', 'allowed')])
    const id = await crawl(
      website(
        { '/x': page('/x', { head: meta('noindex') }) },
        { robots: robotsTxt('User-agent: *\nDisallow: /x') },
      ),
    )
    const found = await findings(id, '/x')
    expect(found).not.toContain('robots-blocked')
    // The noindex is a different condition, and nothing was said about it.
    expect(found).toContain('noindex')
  })

  it('does not hide a sitemap that lists a page that cannot be indexed', async () => {
    await addRules([asking(exactPath('/x'), 'sitemap', 'allowed')])
    const id = await crawl(website({ '/x': page('/x', { head: meta('noindex') }) }))
    expect(await findings(id, '/x')).toContain('sitemap-not-indexable')
  })
})

describe('what the crawl could not tell', () => {
  it('does not take a page that was cut short for one without the directive', async () => {
    await addRules([
      asking(prefix('/'), 'noindex', 'required'),
      asking(prefix('/'), 'nofollow', 'required'),
    ])
    const id = await crawl(website({ '/a': { ...page('/a'), truncated: true } }))
    const found = await findings(id, '/a')
    expect(found).not.toContain('noindex-required-missing')
    expect(found).not.toContain('nofollow-required-missing')
    expect(await stateOf(id, '/a')).toMatchObject({
      conditions: { noindex: { observed: 'unknown' }, nofollow: { observed: 'unknown' } },
    })
    // A page that was read whole is judged.
    expect(await findings(id, '/b')).toContain('noindex-required-missing')
  })

  it('still sees a directive in a page that was cut short, since presence is proven by what was read', async () => {
    await addRules([asking(prefix('/'), 'noindex', 'forbidden')])
    const id = await crawl(
      website({ '/a': { ...page('/a', { head: meta('noindex') }), truncated: true } }),
    )
    expect(await findings(id, '/a')).toContain('noindex')
    expect(await stateOf(id, '/a')).toMatchObject({
      conditions: { noindex: { observed: 'present' } },
    })
  })

  it.each([500, 503, 429])(
    'does not take a robots.txt that answered %s for one that blocks nothing',
    async (status) => {
      await addRules([asking(prefix('/'), 'robots', 'required')])
      const id = await crawl(website({}, { robots: { statusCode: status, headers: {} } }))
      expect(await findings(id, '/a')).not.toContain('robots-block-required-missing')
      expect(await stateOf(id, '/a')).toMatchObject({
        conditions: { robots: { requirement: 'required', observed: 'unknown' } },
      })
    },
  )

  it('does not take a robots.txt that could not be requested for one that blocks nothing', async () => {
    await addRules([asking(prefix('/'), 'robots', 'required')])
    const id = await crawl(
      website({}, { robots: new FetchError('ECONNRESET', 'reset') as unknown as Answer }),
    )
    expect(await findings(id, '/a')).not.toContain('robots-block-required-missing')
  })

  it('takes a robots.txt that is not there for one that blocks nothing', async () => {
    await addRules([asking(prefix('/'), 'robots', 'required')])
    // Not in the site map: it answers 404, which means no restrictions.
    const id = await crawl(website())
    expect(await findings(id, '/a')).toContain('robots-block-required-missing')
    expect(await stateOf(id, '/a')).toMatchObject({
      conditions: { robots: { observed: 'absent' } },
    })
  })

  it('still sees a block when the rest of robots.txt cannot be relied on', async () => {
    await addRules([asking(prefix('/'), 'robots', 'forbidden')])
    // A file that answered with a body is read, whatever its status says about the next request.
    const id = await crawl(
      website({}, { robots: { ...robotsTxt('User-agent: *\nDisallow: /a'), statusCode: 200 } }),
    )
    expect(await findings(id, '/a')).toContain('robots-blocked')
  })

  it('does not take a sitemap that could not be read for one that lists nothing', async () => {
    await addRules([asking(prefix('/'), 'sitemap', 'required')])
    const id = await crawl(website({}, { sitemap: { statusCode: 500, headers: {} } }))
    expect(await findings(id, '/a')).not.toContain('sitemap-required-missing')
    expect(await stateOf(id, '/a')).toMatchObject({
      conditions: { sitemap: { requirement: 'required', observed: 'unknown' } },
    })
  })

  it('does not take a sitemap that robots.txt declares and is not there for a list of nothing', async () => {
    await addRules([asking(prefix('/'), 'sitemap', 'required')])
    const id = await crawl(
      website(
        {},
        {
          robots: robotsTxt(`Sitemap: ${SITE}/declared.xml`),
          listed: ['/'],
        },
      ),
    )
    // /declared.xml answers 404: a declared sitemap has to be one, so the lists are not all known.
    expect(await findings(id, '/a')).not.toContain('sitemap-required-missing')
  })

  it('does not take a sitemap off the site for a list of nothing', async () => {
    await addRules([asking(prefix('/'), 'sitemap', 'required')])
    const id = await crawl(
      website({}, { robots: robotsTxt('Sitemap: https://cdn.elsewhere.org/sitemap.xml') }),
    )
    expect(await findings(id, '/a')).not.toContain('sitemap-required-missing')
  })

  it('takes a site with no sitemap at all for one that lists nothing', async () => {
    await addRules([asking(prefix('/'), 'sitemap', 'required')])
    const site = website()
    delete site[`${SITE}/sitemap.xml`]
    const id = await crawl(site)
    expect(await findings(id, '/a')).toContain('sitemap-required-missing')
  })

  it('does not take a crawl that stopped at its limit for one that saw every sitemap entry', async () => {
    await addRules([asking(prefix('/'), 'sitemap', 'required')])
    await db.crawls.saveSettings(domainId, {
      ...(await db.crawls.settings(domainId)),
      maxUrls: 8,
    })
    const id = await crawl(website({}, { listed: ['/'] }))
    expect((await db.crawls.get(id))?.status).toBe('incomplete')
    for (const path of ['/', '/a', '/b']) {
      expect(await findings(id, path)).not.toContain('sitemap-required-missing')
    }
  })

  it('still sees a URL in the sitemap when the lists are not all known', async () => {
    await addRules([asking(prefix('/'), 'sitemap', 'forbidden')])
    const id = await crawl(website({}, { robots: { statusCode: 500, headers: {} } }))
    expect(await findings(id, '/a')).toContain('sitemap-forbidden-present')
  })

  it('judges only pages that answered: not redirects, errors or resources', async () => {
    await addRules([asking(prefix('/'), 'noindex', 'required')])
    const id = await crawl(
      website({
        '/a': moved(`${SITE}/b`),
        '/b': { statusCode: 500, headers: {} },
        '/c': page('/c'),
      }),
    )
    for (const path of ['/a', '/b']) {
      expect(await findings(id, path)).not.toContain('noindex-required-missing')
      expect((await stateOf(id, path))?.conditions.noindex).toMatchObject({ observed: 'unknown' })
    }
    expect(await findings(id, '/c')).toContain('noindex-required-missing')
  })

  it('does not judge what the crawler only tried on its own', async () => {
    await addRules([asking(prefix('/'), 'noindex', 'required')])
    // `http://example.com/` is tried on every site and nothing links to it.
    const id = await crawl(website())
    const tried = (await db.crawls.auditOf(id, [crawlUrlHash('http://example.com/')]))[0]
    if (tried) expect(tried.conditions.noindex?.observed).not.toBe('absent')
  })

  it('has no finding of its own for a page left out of the audit, but keeps what it saw', async () => {
    await addRules([
      asking(prefix('/'), 'noindex', 'required'),
      {
        dimension: 'audit',
        value: 'exclude',
        selector: exactPath('/a'),
        reason: null,
        enabled: true,
      },
    ])
    const id = await crawl(website())
    expect(await findings(id, '/a')).toEqual([])
    expect(await stateOf(id, '/a')).toMatchObject({
      participation: 'excluded',
      conditions: { noindex: { requirement: 'required', observed: 'absent' } },
    })
  })
})

describe('the expectation of being indexable, apart from the conditions', () => {
  it('does not read an expectation of not being indexable as a required noindex', async () => {
    await addRules([expecting(exactPath('/a'), 'not-indexable')])
    const id = await crawl(website())
    const found = await findings(id, '/a')
    expect(found).toContain('expected-not-indexable-but-indexable')
    expect(found).not.toContain('noindex-required-missing')
    expect((await stateOf(id, '/a'))?.conditions).toEqual({})
  })

  it('does not make a required noindex an expectation either', async () => {
    await addRules([asking(exactPath('/a'), 'noindex', 'required')])
    const id = await crawl(website({ '/a': page('/a', { head: meta('noindex') }) }))
    const found = await findings(id, '/a')
    expect(found).not.toContain('noindex')
    expect(found).not.toContain('expected-not-indexable-but-indexable')
    expect(await stateOf(id, '/a')).toMatchObject({ intent: 'indexable', intentRule: null })
  })

  it('keeps the finding for a noindex that a rule forbids, even for a page expected not to be indexable', async () => {
    await addRules([
      expecting(exactPath('/a'), 'not-indexable'),
      asking(exactPath('/a'), 'noindex', 'forbidden'),
    ])
    const id = await crawl(website({ '/a': page('/a', { head: meta('noindex') }) }))
    const found = await findings(id, '/a')
    expect(found).toContain('noindex')
    expect(found).not.toContain('expected-not-indexable-but-indexable')
  })

  it('leaves the expectation to drop a noindex when no rule states the condition', async () => {
    await addRules([expecting(exactPath('/a'), 'not-indexable')])
    const id = await crawl(website({ '/a': page('/a', { head: meta('noindex') }) }))
    expect(await findings(id, '/a')).not.toContain('noindex')
  })

  it('has the sitemap stated for a page expected not to be indexable decide the sitemap findings', async () => {
    await addRules([
      expecting(exactPath('/b'), 'not-indexable'),
      asking(exactPath('/b'), 'sitemap', 'required'),
    ])
    const id = await crawl(website({}, { listed: ['/', '/a', '/c'] }))
    const found = await findings(id, '/b')
    expect(found).toContain('sitemap-required-missing')
    expect(found).not.toContain('indexable-not-in-sitemap')
  })

  it('does not take a block in robots.txt for the page being kept out of the index', async () => {
    await addRules([
      expecting(exactPath('/a'), 'not-indexable'),
      asking(exactPath('/a'), 'robots', 'required'),
    ])
    const id = await crawl(website({}, { robots: robotsTxt('User-agent: *\nDisallow: /a') }))
    const found = await findings(id, '/a')
    // The block is what the rule asks for; the page can still be indexed, as far as the crawl sees.
    expect(found).not.toContain('robots-block-required-missing')
    expect(found).not.toContain('robots-blocked')
    expect(await stateOf(id, '/a')).toMatchObject({ blockers: ['robots'] })
  })
})

describe('an analysis made before conditions', () => {
  it('reads an accepted nofollow as the condition being allowed, as it was made', async () => {
    const id = await crawl(website({ '/a': page('/a', { head: meta('nofollow') }) }))
    expect(await findings(id, '/a')).toContain('nofollow')
    const legacy = {
      version: 4,
      semantics: 2,
      rules: [
        {
          id: 'old-accepting',
          dimension: 'intent',
          value: 'indexable',
          selector: { kind: 'prefix', path: '/', query: { mode: 'any' }, scope: 'literal' },
          acceptNofollow: true,
          reason: null,
          enabled: true,
        },
      ],
    } as never
    await db.crawls.saveAnalysis({
      crawlId: id,
      issues: [],
      pages: { issue: 0, warning: 0, opportunity: 0 },
      withType: { issue: 0, warning: 0, opportunity: 0 },
      catalog: 'old',
      audit: {
        snapshot: legacy,
        pages: { audited: 0, excluded: 0, indexable: 0, notIndexable: 0, unknownIndexability: 0 },
        urls: [],
      },
    })
    expect(await reanalyseOutdatedCrawls({ db, log })).toBe(1)
    expect(await findings(id, '/a')).not.toContain('nofollow')
    expect(await stateOf(id, '/a')).toMatchObject({
      intent: 'indexable',
      intentRule: 'old-accepting',
      conditions: {
        nofollow: { requirement: 'allowed', rule: 'old-accepting', observed: 'present' },
      },
    })
    // It keeps the configuration it had, and the rules of today do not reach it.
    const stored = (await db.crawls.get(id))!
    expect(stored.auditSnapshot?.semantics).toBe(2)
    expect(stored.auditVersion).toBe(4)
  })

  it('finds the same things with a configuration upgraded to conditions as with the old one', async () => {
    const pages = {
      '/a': page('/a', { head: meta('noindex, nofollow') }),
      '/b': page('/b', { head: meta('nofollow') }),
      '/c': page('/c'),
    }
    const id = await crawl(website(pages))
    const selector = (path: string, kind: 'prefix' | 'url' = 'prefix') =>
      kind === 'url'
        ? { kind: 'url' as const, url: `${SITE}${path}` }
        : {
            kind: 'prefix' as const,
            path,
            query: { mode: 'any' as const },
            scope: 'literal' as const,
          }
    const rule = (
      idOf: string,
      sel: AuditSelector,
      value: 'indexable' | 'not-indexable',
      acceptNofollow: boolean,
    ) => ({
      id: idOf,
      dimension: 'intent' as const,
      value,
      selector: sel,
      acceptNofollow,
      reason: null,
      enabled: true,
    })
    const oldRules = [
      rule('r1', selector('/'), 'not-indexable', true),
      rule('r2', selector('/b', 'url'), 'indexable', false),
    ]
    const old = { version: 5, semantics: 2, rules: oldRules } as never
    // What the upgrade writes for them: the expectations stay, the nofollow becomes a condition.
    const upgraded = auditSnapshotOf(6, [
      ...oldRules.map((r) => ({ ...r, acceptNofollow: false })),
      {
        id: 'c1',
        dimension: 'nofollow' as const,
        value: 'allowed' as const,
        selector: selector('/'),
        reason: null,
        enabled: true,
      },
      {
        id: 'c2',
        dimension: 'nofollow' as const,
        value: 'forbidden' as const,
        selector: selector('/b', 'url'),
        reason: null,
        enabled: true,
      },
    ])
    const issuesWith = async (snapshot: typeof upgraded) => {
      await analyseCrawl(db, id, snapshot)
      const out: Record<string, string[]> = {}
      for (const path of ['/', '/a', '/b', '/c']) out[path] = (await findings(id, path)).sort()
      return out
    }
    expect(await issuesWith(old)).toEqual(await issuesWith(upgraded))
  })
})

describe('recalculating after a rule about a condition changes', () => {
  it('queues one recalculation, with no request, and ends with the new findings', async () => {
    const id = await crawl(website())
    expect(await findings(id, '/a')).not.toContain('noindex-required-missing')
    const site = fakeSite(website(), 0)
    expect(site.requests).toEqual([])
    await db.audit.setUrlConfig({
      domainId,
      host: 'example.com',
      urls: [`${SITE}/a`],
      conditions: { noindex: 'required' },
    })
    await recomputeAudit({ db, domainId, log, finalAttempt: false })
    expect(await findings(id, '/a')).toContain('noindex-required-missing')
    // And back: the exception is gone, and so is the finding.
    await db.audit.setUrlConfig({
      domainId,
      host: 'example.com',
      urls: [`${SITE}/a`],
      conditions: { noindex: 'inherit' },
    })
    await recomputeAudit({ db, domainId, log, finalAttempt: false })
    expect(await findings(id, '/a')).not.toContain('noindex-required-missing')
  })
})

describe('the issues of conditions in the catalog', () => {
  it('are findings of the user’s own declarations, and the same for all', () => {
    for (const issue of Object.values(MISSING)) {
      expect(PAGE_ISSUES[issue]).toMatchObject({ category: 'indexing-intent', type: 'issue' })
    }
    expect(PAGE_ISSUES['sitemap-forbidden-present']).toMatchObject({ category: 'indexing-intent' })
  })
})

describe('a recheck of a URL', () => {
  const answerOf = (path: string, overrides: Parameters<typeof page>[1] = {}) => {
    const { result } = analyseResponse({
      item: { url: absolute(path), source: 'link' },
      response: {
        statusCode: 200,
        headers: {},
        body: null,
        truncated: false,
        bytes: 0,
        responseTimeMs: 1,
        ...page(path, overrides),
      },
      optionalFiles: [],
      log,
      discover: () => {},
    })
    return {
      url: absolute(path),
      source: 'link' as const,
      answer: result,
      linksIn: 1,
      anchors: { internal: 1, nofollow: 0 },
    }
  }
  const contextWith = (
    rules: NewAuditRule[],
    robots: Record<string, { status: number | null; text: string | null }> = {},
  ) =>
    recheckContext({
      host: 'example.com',
      now: new Date('2026-01-01T00:00:00Z'),
      config: auditSnapshotOf(
        1,
        rules.map((rule, index) => ({ ...rule, id: `r${index}` }) as AuditRule),
      ),
      robotsTexts: new Map(Object.entries(robots).map(([origin, value]) => [origin, value])),
      answered: true,
    })

  it('settles the directives and the block in robots.txt, and finds what a rule requires', () => {
    const context = contextWith(
      [
        asking(prefix('/'), 'noindex', 'required'),
        asking(prefix('/'), 'nofollow', 'forbidden'),
        asking(prefix('/'), 'robots', 'required'),
      ],
      { [SITE]: { status: 200, text: 'User-agent: *\nDisallow: /private' } },
    )
    const outcome = evaluateRecheck(answerOf('/x', { head: meta('nofollow') }), context)
    const issues = outcome.findings.map((f) => f.issue)
    expect(issues).toEqual(expect.arrayContaining(['noindex-required-missing', 'nofollow']))
    expect(issues).toContain('robots-block-required-missing')
    expect(outcome.unchecked).toEqual([])
    expect(outcome.audit.conditions).toMatchObject({
      noindex: { requirement: 'required', observed: 'absent' },
      nofollow: { requirement: 'forbidden', observed: 'present' },
      robots: { requirement: 'required', observed: 'absent' },
    })
  })

  it('takes a robots.txt that it could not read for nothing', () => {
    const context = contextWith([asking(prefix('/'), 'robots', 'required')], {
      [SITE]: { status: 503, text: null },
    })
    const outcome = evaluateRecheck(answerOf('/x'), context)
    expect(outcome.findings.map((f) => f.issue)).not.toContain('robots-block-required-missing')
    expect(outcome.audit.conditions.robots).toMatchObject({ observed: 'unknown' })
  })

  it('never settles what depends on the sitemaps: no finding, and nothing observed', () => {
    const context = contextWith([asking(prefix('/'), 'sitemap', 'required')])
    const outcome = evaluateRecheck(answerOf('/x'), context)
    const issues = outcome.findings.map((f) => f.issue)
    expect(issues).not.toContain('sitemap-required-missing')
    expect(issues).not.toContain('sitemap-forbidden-present')
    expect(outcome.unchecked).toEqual([])
    expect(outcome.audit.conditions.sitemap).toEqual({
      requirement: 'required',
      rule: 'r0',
      observed: null,
    })
  })

  it('refuses to run the checks on the sitemaps, instead of finding nothing', () => {
    const context = contextWith([
      asking(prefix('/'), 'sitemap', 'required'),
      asking(exactPath('/y'), 'sitemap', 'forbidden'),
    ])
    for (const [path, issue] of [
      ['/x', 'sitemap-required-missing'],
      ['/y', 'sitemap-forbidden-present'],
    ] as const) {
      const { url, site } = recheckSubject(answerOf(path), context)
      expect(() => CHECKS[issue](url, site)).toThrow(SiteContextError)
      expect(() => presenceOf('sitemap', url, site)).toThrow(SiteContextError)
    }
  })

  it('applies the same policy as a crawl', () => {
    const context = contextWith([asking(prefix('/'), 'nofollow', 'allowed')])
    const outcome = evaluateRecheck(answerOf('/x', { head: meta('nofollow') }), context)
    expect(outcome.findings.map((f) => f.issue)).not.toContain('nofollow')
  })
})
