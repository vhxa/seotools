import {
  AUDIT_SEMANTICS,
  isSiteScopedIssue,
  EMPTY_AUDIT_SNAPSHOT,
  RELATIONS_SEMANTICS,
  auditSnapshotOf,
  crawlUrlHash,
  createLogger,
  defaultResolution,
  type AuditCondition,
  type AuditSelector,
  type AuditSnapshot,
  type IndexabilityBlocker,
  type NewAuditRule,
  type PageIssueId,
  type Requirement,
  type ResolvedConditions,
} from '@seotools/core'
import { createCompany } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { analyseCrawl, currentAuditConfig } from './analysis'
import { runCrawl } from './engine'
import { fakeSite, moved, type Answer } from './fake-site'
import { reanalyseOutdatedCrawls } from './reanalysis'
import { evaluateRecheck, recheckContext } from './recheck'
import {
  acceptedBlockers,
  excusedBlockers,
  excusesInlinks,
  excusesMissingReturn,
  isExpectedOut,
  relationsApply,
} from './relations'
import type { AuditedUrl } from './site-audit'
import { SITE, page, sitemapOf, xml } from './test-site'

const log = createLogger('test', 'silent')

// --- the matrix, on its own ---------------------------------------------------------------------

type Intent = 'indexable' | 'not-indexable'

interface Declared {
  intent?: Intent
  noindex?: Requirement
  robots?: Requirement
  /** What the crawl saw. `null`: it could not tell. */
  blockers?: readonly IndexabilityBlocker[] | null
}

/** The part of a URL the matrix reads. */
function declared({ intent = 'indexable', noindex, robots, blockers = [] }: Declared): AuditedUrl {
  const conditions: ResolvedConditions = defaultResolution().conditions
  if (noindex) conditions.noindex = { requirement: noindex, rule: null }
  if (robots) conditions.robots = { requirement: robots, rule: null }
  return {
    intent,
    conditions,
    indexability:
      blockers === null
        ? { state: 'unknown', blockers: [] }
        : blockers.length > 0
          ? { state: 'not-indexable', blockers: [...blockers] }
          : { state: 'indexable', blockers: [] },
  } as AuditedUrl
}

const NOW = { config: auditSnapshotOf(1, []) }
const OLD = { config: { ...auditSnapshotOf(1, []), semantics: 3 } }
/** The meaning in which a destination's own declarations also excused the origin. */
const V4 = { config: { ...auditSnapshotOf(1, []), semantics: RELATIONS_SEMANTICS } }

describe('what a URL accepts of its own indexation', () => {
  it('accepts nothing by default', () => {
    expect([...acceptedBlockers(declared({}))]).toEqual([])
  })

  it.each<[string, Declared, IndexabilityBlocker[]]>([
    ['a required noindex', { noindex: 'required' }, ['noindex']],
    ['an allowed noindex', { noindex: 'allowed' }, ['noindex']],
    ['a forbidden noindex', { noindex: 'forbidden' }, []],
    ['a required robots block', { robots: 'required' }, ['robots']],
    ['an allowed robots block', { robots: 'allowed' }, ['robots']],
    ['a forbidden robots block', { robots: 'forbidden' }, []],
    // The expectation covers a noindex and a canonical elsewhere, but not a robots.txt block.
    [
      'the expectation of not being indexable',
      { intent: 'not-indexable' },
      ['noindex', 'canonical'],
    ],
    // A condition that is stated decides its own blocker, whatever the expectation says.
    [
      'a forbidden noindex under an expectation of not being indexable',
      { intent: 'not-indexable', noindex: 'forbidden' },
      ['canonical'],
    ],
    [
      'an allowed robots block under an expectation of not being indexable',
      { intent: 'not-indexable', robots: 'allowed' },
      ['noindex', 'canonical', 'robots'],
    ],
    // Allowing one blocker does not accept the others.
    ['an allowed noindex alone', { noindex: 'allowed', robots: 'forbidden' }, ['noindex']],
    ['the expectation of being indexable', { intent: 'indexable' }, []],
  ])('%s', (_, url, expected) => {
    expect([...acceptedBlockers(declared(url))].sort()).toEqual([...expected].sort())
  })

  it('is out of the index on purpose only when everything in the way was accepted', () => {
    const out = (url: Declared) => isExpectedOut(declared(url))
    expect(out({ noindex: 'allowed', blockers: ['noindex'] })).toBe(true)
    expect(out({ intent: 'not-indexable', blockers: ['noindex', 'canonical'] })).toBe(true)
    // Something else stands in the way that nobody accepted.
    expect(out({ noindex: 'allowed', blockers: ['noindex', 'robots'] })).toBe(false)
    expect(out({ intent: 'not-indexable', blockers: ['robots'] })).toBe(false)
    expect(out({ intent: 'not-indexable', blockers: ['noindex', 'http-error'] })).toBe(false)
    expect(out({ noindex: 'allowed', robots: 'allowed', blockers: ['noindex', 'robots'] })).toBe(
      true,
    )
    // A declaration with nothing in the way proves nothing, and what the crawl cannot tell is unknown.
    expect(out({ noindex: 'required', blockers: [] })).toBe(false)
    expect(out({ noindex: 'required', blockers: null })).toBe(false)
    expect(out({ blockers: ['noindex'] })).toBe(false)
  })
})

describe('what a pair excuses', () => {
  const excused = (origin: Declared, destination: Declared, site = NOW) =>
    [...excusedBlockers(declared(origin), declared(destination), site)].sort()

  it('excused what the destination accepts, and only that, under semantics 4', () => {
    expect(excused({}, { noindex: 'allowed', blockers: ['noindex'] }, V4)).toEqual(['noindex'])
    expect(
      excused({}, { noindex: 'allowed', robots: 'forbidden', blockers: ['noindex'] }, V4),
    ).toEqual(['noindex'])
    expect(excused({}, { intent: 'not-indexable', blockers: ['canonical'] }, V4)).toEqual([
      'canonical',
      'noindex',
    ])
    expect(excused({}, { blockers: ['noindex'] }, V4)).toEqual([])
    expect(excused({}, { noindex: 'forbidden', blockers: ['noindex'] }, V4)).toEqual([])
  })

  it('excuses nothing for what only the destination declares, from semantics 5', () => {
    expect(excused({}, { noindex: 'allowed', blockers: ['noindex'] })).toEqual([])
    expect(excused({}, { intent: 'not-indexable', blockers: ['canonical'] })).toEqual([])
    expect(
      excused(
        { intent: 'not-indexable', blockers: ['canonical'] },
        { intent: 'not-indexable', blockers: ['noindex'] },
      ),
    ).toEqual(['canonical', 'noindex', 'robots'])
  })

  it('never excuses how the destination answers', () => {
    const everything = { intent: 'not-indexable', noindex: 'required', robots: 'required' } as const
    expect(excused({}, { ...everything, blockers: ['redirect'] })).not.toContain('redirect')
    expect(excused({}, { ...everything, blockers: ['http-error'] })).not.toContain('http-error')
    expect(
      excused({ noindex: 'allowed', blockers: ['noindex'] }, { blockers: ['http-error'] }),
    ).not.toContain('http-error')
  })

  it('excuses all that is about the index when the origin is itself out of it on purpose', () => {
    const origin = { noindex: 'allowed', blockers: ['noindex'] } as const
    expect(excused(origin, { blockers: ['noindex', 'canonical', 'robots'] })).toEqual([
      'canonical',
      'noindex',
      'robots',
    ])
    // An origin that merely may be noindex, and is not, is in the index: its alternates are read.
    expect(excused({ noindex: 'allowed' }, { blockers: ['noindex'] })).toEqual([])
    // One that is out for a reason nobody accepted is not out on purpose.
    expect(
      excused({ noindex: 'allowed', blockers: ['noindex', 'robots'] }, { blockers: ['noindex'] }),
    ).toEqual([])
    // One the crawl could not judge is not either.
    expect(excused({ noindex: 'required', blockers: null }, { blockers: ['noindex'] })).toEqual([])
  })

  it('excuses nothing under a configuration older than the meaning that reads it', () => {
    const origin = { noindex: 'allowed', blockers: ['noindex'] } as const
    const destination = { noindex: 'allowed', blockers: ['noindex'] } as const
    expect(excused(origin, destination, OLD)).toEqual([])
    expect(excused(origin, destination, NOW)).toEqual(['canonical', 'noindex', 'robots'])
    expect(relationsApply(OLD)).toBe(false)
    expect(relationsApply(NOW)).toBe(true)
    expect(RELATIONS_SEMANTICS).toBeLessThanOrEqual(AUDIT_SEMANTICS)
    // An analysis from before semantics existed is the first meaning.
    expect(relationsApply({ config: EMPTY_AUDIT_SNAPSHOT })).toBe(false)
  })

  it('excuses a missing return when the origin is out on purpose (either end under 4)', () => {
    const out = { noindex: 'required', blockers: ['noindex'] } as const
    const missing = (o: Declared, d: Declared, site = NOW) =>
      excusesMissingReturn(declared(o), declared(d), site)
    expect(missing({}, out)).toBe(false)
    expect(missing({}, out, V4)).toBe(true)
    expect(missing(out, {})).toBe(true)
    expect(missing({}, {})).toBe(false)
    expect(missing({}, { blockers: ['noindex'] })).toBe(false)
    expect(missing({}, out, OLD)).toBe(false)
  })

  it('excuses the links that reach a URL only when it is out on purpose', () => {
    const inlinks = (url: Declared, site = NOW) => excusesInlinks(declared(url), site)
    expect(inlinks({ noindex: 'required', blockers: ['noindex'] })).toBe(true)
    expect(inlinks({ noindex: 'required', blockers: [] })).toBe(false)
    expect(inlinks({ blockers: ['noindex'] })).toBe(false)
    expect(inlinks({ noindex: 'required', blockers: ['noindex'] }, OLD)).toBe(false)
  })
})

// --- the matrix, over crawls --------------------------------------------------------------------

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
const asking = (
  selector: AuditSelector,
  dimension: AuditCondition,
  value: Requirement,
  enabled = true,
): NewAuditRule => ({ dimension, value, selector, reason: null, enabled })
const expecting = (selector: AuditSelector, value: Intent): NewAuditRule => ({
  dimension: 'intent',
  value,
  selector,
  reason: null,
  enabled: true,
})
const excluding = (selector: AuditSelector): NewAuditRule => ({
  dimension: 'audit',
  value: 'exclude',
  selector,
  reason: null,
  enabled: true,
})

async function addRules(rules: NewAuditRule[]) {
  for (const rule of rules) {
    const saved = await db.audit.saveRule({ domainId, rule })
    if (!saved.ok) throw new Error(`rule not saved: ${saved.error}`)
  }
}

const url = (path: string) => `${SITE}${path}`
const hashOf = (path: string) => crawlUrlHash(url(path))
const meta = (content: string) => `<meta name="robots" content="${content}">`
const alternate = (lang: string, path: string) =>
  `<link rel="alternate" hreflang="${lang}" href="${url(path)}">`

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
const detailsOf = async (crawlId: string, path: string, issue: PageIssueId) =>
  (await db.crawls.issuesOf(crawlId, [hashOf(path)])).find((row) => row.issue === issue)?.details
const stateOf = async (crawlId: string, path: string) =>
  (await db.crawls.auditOf(crawlId, [hashOf(path)]))[0]

/** Analyses a crawl again under semantics 4, when a destination's declarations also excused. */
async function asSemantics4(crawlId: string) {
  const config = await currentAuditConfig(db, domainId)
  await analyseCrawl(db, crawlId, { ...config, semantics: RELATIONS_SEMANTICS })
  return crawlId
}

/** The findings that are about a relation to another URL, which is what the matrix decides. */
const RELATIONS = [
  'canonical-broken',
  'canonical-redirect',
  'canonical-not-indexable',
  'hreflang-noindex',
  'hreflang-non-canonical',
  'hreflang-no-return',
  'hreflang-redirect',
  'hreflang-unreachable',
  'only-noindex-inlinks',
  'only-nofollow-inlinks',
  'sitemap-broken',
  'sitemap-redirect',
  'sitemap-not-indexable',
] as const satisfies PageIssueId[]
const relationsOf = async (crawlId: string, path: string) =>
  (await findings(crawlId, path)).filter((issue) =>
    (RELATIONS as readonly string[]).includes(issue),
  )

interface World {
  /** How the destination `/t` is. */
  target?: { head?: string; canonical?: string | null; answer?: Answer; returns?: boolean }
  /** How the origin `/s` is. */
  source?: { head?: string; truncated?: boolean }
  robots?: string
}

/**
 * `/s` declares `/t` as its Spanish alternate and `/c` has `/t` as its canonical; `/t` links back to
 * `/s` unless it says otherwise. Everything is linked from the home page, and the sitemap lists the
 * pages that are not on either end of those relations.
 */
function world({ target = {}, source = {}, robots }: World = {}): Record<string, Answer> {
  const targetPage =
    target.answer ??
    page('/t', {
      head: `${target.head ?? ''}${target.returns === false ? '' : alternate('en', '/s')}`,
      ...(target.canonical !== undefined ? { canonical: target.canonical } : {}),
    })
  const sourcePage = page('/s', { head: `${alternate('es', '/t')}${source.head ?? ''}` })
  const all = ['/', '/s', '/t', '/c']
  return {
    [url('/')]: page('/', {
      links: ['/s', '/t', '/c'].map((p) => `<a href="${p}">Go to ${p}</a>`).join(''),
    }),
    [url('/s')]: source.truncated ? { ...sourcePage, truncated: true } : sourcePage,
    [url('/t')]: targetPage,
    [url('/c')]: page('/c', { canonical: url('/t') }),
    [url('/sitemap.xml')]: xml(sitemapOf(all.filter((p) => p !== '/t' && p !== '/c'))),
    ...(robots
      ? {
          [url('/robots.txt')]: {
            statusCode: 200,
            headers: { 'content-type': 'text/plain' },
            body: Buffer.from(robots),
          },
        }
      : {}),
  }
}

const NOINDEX = { head: meta('noindex') }

describe('the destination of a canonical or an hreflang that is not indexed', () => {
  it('is reported as ever when nobody declared anything', async () => {
    const id = await crawl(world({ target: NOINDEX }))
    expect(await findings(id, '/s')).toContain('hreflang-noindex')
    expect(await findings(id, '/c')).toContain('canonical-not-indexable')
    expect(await detailsOf(id, '/c', 'canonical-not-indexable')).toEqual(['noindex'])
  })

  it.each<[string, NewAuditRule[]]>([
    ['required', [asking(exactPath('/t'), 'noindex', 'required')]],
    ['allowed', [asking(exactPath('/t'), 'noindex', 'allowed')]],
    ['inherited from a broader rule', [asking(prefix('/'), 'noindex', 'allowed')]],
    ['expected not to be indexable', [expecting(exactPath('/t'), 'not-indexable')]],
  ])('was not, under semantics 4, when its noindex is %s', async (_, rules) => {
    await addRules(rules)
    const id = await asSemantics4(await crawl(world({ target: NOINDEX })))
    expect(await findings(id, '/s')).not.toContain('hreflang-noindex')
    expect(await findings(id, '/c')).not.toContain('canonical-not-indexable')
    // The facts are the same: it still cannot be indexed, and says why.
    expect(await stateOf(id, '/t')).toMatchObject({
      indexability: 'not-indexable',
      blockers: ['noindex'],
    })
  })

  it.each<[string, NewAuditRule[]]>([
    ['required', [asking(exactPath('/t'), 'noindex', 'required')]],
    ['allowed', [asking(exactPath('/t'), 'noindex', 'allowed')]],
    ['expected not to be indexable', [expecting(exactPath('/t'), 'not-indexable')]],
  ])('is to an origin expected to be indexable, when its noindex is %s', async (_, rules) => {
    await addRules(rules)
    const id = await crawl(world({ target: NOINDEX }))
    expect(await findings(id, '/s')).toContain('hreflang-noindex')
    expect(await findings(id, '/c')).toContain('canonical-not-indexable')
    expect(await detailsOf(id, '/c', 'canonical-not-indexable')).toEqual(['noindex'])
  })

  it.each<[string, NewAuditRule[]]>([
    ['forbidden', [asking(exactPath('/t'), 'noindex', 'forbidden')]],
    ['expected to be indexable', [expecting(exactPath('/t'), 'indexable')]],
    [
      'forbidden although the expectation is not to be indexable',
      [
        expecting(exactPath('/t'), 'not-indexable'),
        asking(exactPath('/t'), 'noindex', 'forbidden'),
      ],
    ],
    [
      'forbidden by an exception under a broader rule that allows it',
      [asking(prefix('/'), 'noindex', 'allowed'), asking(exactPath('/t'), 'noindex', 'forbidden')],
    ],
    [
      'allowed by an exception that is disabled, under a broader rule that forbids it',
      [
        asking(prefix('/'), 'noindex', 'forbidden'),
        asking(exactPath('/t'), 'noindex', 'allowed', false),
      ],
    ],
    ['only allowed for the robots.txt block', [asking(exactPath('/t'), 'robots', 'allowed')]],
    ['declared of another URL', [asking(exactPath('/s'), 'noindex', 'allowed')]],
  ])('is still when its noindex is %s', async (_, rules) => {
    await addRules(rules)
    const id = await crawl(world({ target: NOINDEX }))
    expect(await findings(id, '/s')).toContain('hreflang-noindex')
    expect(await findings(id, '/c')).toContain('canonical-not-indexable')
  })

  it('was excused, under semantics 4, by a rule that an exception of its own does not undo', async () => {
    await addRules([
      asking(prefix('/'), 'noindex', 'allowed'),
      asking(exactPath('/t'), 'noindex', 'forbidden', false),
    ])
    const id = await asSemantics4(await crawl(world({ target: NOINDEX })))
    expect(await findings(id, '/s')).not.toContain('hreflang-noindex')
    expect(await findings(id, '/c')).not.toContain('canonical-not-indexable')
  })

  it('does not accept a robots.txt block because a noindex was allowed', async () => {
    await addRules([asking(exactPath('/t'), 'noindex', 'allowed')])
    const id = await asSemantics4(
      await crawl(world({ target: NOINDEX, robots: 'User-agent: *\nDisallow: /t' })),
    )
    // The hreflang finding is about the noindex, which was accepted.
    expect(await findings(id, '/s')).not.toContain('hreflang-noindex')
    // The canonical leads to a URL that is also blocked, and nobody accepted that.
    expect(await findings(id, '/c')).toContain('canonical-not-indexable')
    expect((await detailsOf(id, '/c', 'canonical-not-indexable'))?.sort()).toEqual([
      'noindex',
      'robots',
    ])
    expect(await findings(id, '/t')).toContain('robots-blocked')
  })

  it('does not accept a robots.txt block because the URL is expected not to be indexable', async () => {
    await addRules([expecting(exactPath('/t'), 'not-indexable')])
    const id = await crawl(world({ target: {}, robots: 'User-agent: *\nDisallow: /t' }))
    expect(await findings(id, '/c')).toContain('canonical-not-indexable')
    expect(await detailsOf(id, '/c', 'canonical-not-indexable')).toEqual(['robots'])
  })

  it('accepted both, under semantics 4, when both were allowed', async () => {
    await addRules([
      asking(exactPath('/t'), 'noindex', 'allowed'),
      asking(exactPath('/t'), 'robots', 'allowed'),
    ])
    const id = await asSemantics4(
      await crawl(world({ target: NOINDEX, robots: 'User-agent: *\nDisallow: /t' })),
    )
    expect(await findings(id, '/c')).not.toContain('canonical-not-indexable')
    expect(await findings(id, '/t')).not.toContain('robots-blocked')
  })

  it('is still reported when the URL also fails, whatever was accepted', async () => {
    await addRules([
      asking(exactPath('/t'), 'noindex', 'required'),
      expecting(exactPath('/t'), 'not-indexable'),
    ])
    const id = await crawl(
      world({
        target: {
          answer: {
            statusCode: 404,
            headers: { 'content-type': 'text/html', 'x-robots-tag': 'noindex' },
          },
        },
      }),
    )
    expect(await findings(id, '/s')).toContain('hreflang-unreachable')
    // A broken reference, not a matter of the index: nothing declared of either end changes it.
    expect(await findings(id, '/c')).toContain('canonical-broken')
    expect(await findings(id, '/c')).not.toContain('canonical-not-indexable')
  })

  it('is still reported when the URL redirects', async () => {
    await addRules([expecting(exactPath('/t'), 'not-indexable')])
    const id = await crawl(world({ target: { answer: moved('/s') } }))
    expect(await findings(id, '/s')).toContain('hreflang-redirect')
    expect(await findings(id, '/c')).toContain('canonical-redirect')
    expect(await findings(id, '/c')).not.toContain('canonical-not-indexable')
  })
})

describe('the origin of a canonical or an hreflang that is out of the index on purpose', () => {
  it('does not tell what it points at is not indexed', async () => {
    await addRules([asking(exactPath('/s'), 'noindex', 'allowed')])
    const id = await crawl(world({ source: NOINDEX, target: NOINDEX }))
    expect(await findings(id, '/s')).not.toContain('hreflang-noindex')
    // The destination is not accepted: it says so itself, once.
    expect(await findings(id, '/t')).toContain('noindex')
  })

  it('does not wait for a return from the destination', async () => {
    await addRules([asking(exactPath('/s'), 'noindex', 'required')])
    const id = await crawl(world({ source: NOINDEX, target: { returns: false } }))
    expect(await findings(id, '/s')).not.toContain('hreflang-no-return')
  })

  it('is judged by what the crawl saw, not by what the rule allows', async () => {
    await addRules([asking(exactPath('/s'), 'noindex', 'allowed')])
    // It may have a noindex and it has not: it is in the index, so its alternates are read.
    const id = await crawl(world({ target: NOINDEX }))
    expect(await findings(id, '/s')).toContain('hreflang-noindex')
  })

  it('is not out on purpose when a noindex that is required is missing', async () => {
    await addRules([asking(exactPath('/s'), 'noindex', 'required')])
    const id = await crawl(world({ target: NOINDEX }))
    expect(await findings(id, '/s')).toContain('noindex-required-missing')
    expect(await findings(id, '/s')).toContain('hreflang-noindex')
  })

  it('is not out on purpose when the crawl read only part of it', async () => {
    await addRules([asking(exactPath('/s'), 'noindex', 'required')])
    // Cut short before any directive: a missing noindex is unknown, so it is not known to be out.
    const id = await crawl(world({ source: { truncated: true }, target: NOINDEX }))
    expect(await findings(id, '/s')).not.toContain('noindex-required-missing')
    expect(await findings(id, '/s')).toContain('hreflang-noindex')
    expect(await stateOf(id, '/s')).toMatchObject({
      conditions: { noindex: { observed: 'unknown' } },
    })
  })

  it('is not out on purpose when something nobody accepted also keeps it out', async () => {
    await addRules([asking(exactPath('/s'), 'noindex', 'allowed')])
    const id = await crawl(
      world({ source: NOINDEX, target: NOINDEX, robots: 'User-agent: *\nDisallow: /s' }),
    )
    expect(await stateOf(id, '/s')).toMatchObject({ blockers: ['noindex', 'robots'] })
    expect(await findings(id, '/s')).toContain('hreflang-noindex')
  })

  it('is out on purpose by the expectation alone, for a noindex and a canonical elsewhere', async () => {
    await addRules([expecting(exactPath('/c'), 'not-indexable')])
    const id = await crawl(world({ target: NOINDEX }))
    // /c canonicalises to /t, and both are out: nothing to say about it.
    expect(await findings(id, '/c')).not.toContain('canonical-not-indexable')
    expect(await findings(id, '/c')).not.toContain('canonicalised')
  })

  it('still reports how what it points at answers', async () => {
    await addRules([asking(exactPath('/s'), 'noindex', 'required')])
    const gone = await crawl(
      world({ source: NOINDEX, target: { answer: { statusCode: 404, headers: {} } } }),
    )
    expect(await findings(gone, '/s')).toContain('hreflang-unreachable')
    const moves = await crawl(world({ source: NOINDEX, target: { answer: moved('/about') } }))
    expect(await findings(moves, '/s')).toContain('hreflang-redirect')
  })
})

describe('a missing return link', () => {
  it('is reported for an indexable page that does not link back', async () => {
    const id = await crawl(world({ target: { returns: false } }))
    expect(await findings(id, '/s')).toContain('hreflang-no-return')
  })

  it.each<[string, NewAuditRule[]]>([
    ['required', [asking(exactPath('/t'), 'noindex', 'required')]],
    ['allowed', [asking(exactPath('/t'), 'noindex', 'allowed')]],
    ['expected', [expecting(exactPath('/t'), 'not-indexable')]],
  ])('was not, under semantics 4, when the destination is out on purpose (%s)', async (_, rules) => {
    await addRules(rules)
    const id = await asSemantics4(await crawl(world({ target: { ...NOINDEX, returns: false } })))
    expect(await findings(id, '/s')).not.toContain('hreflang-no-return')
  })

  it('is, from an indexable origin, whatever the destination declares', async () => {
    await addRules([asking(exactPath('/t'), 'noindex', 'allowed')])
    const id = await crawl(world({ target: { ...NOINDEX, returns: false } }))
    expect(await findings(id, '/s')).toContain('hreflang-no-return')
  })

  it('is when the destination is out of the index by accident', async () => {
    const id = await crawl(world({ target: { ...NOINDEX, returns: false } }))
    expect(await findings(id, '/s')).toContain('hreflang-no-return')
  })

  it('is when the destination may be noindex and is not', async () => {
    await addRules([asking(exactPath('/t'), 'noindex', 'allowed')])
    const id = await crawl(world({ target: { returns: false } }))
    expect(await findings(id, '/s')).toContain('hreflang-no-return')
  })
})

describe('a hreflang to a URL whose canonical is elsewhere', () => {
  const elsewhere = { canonical: url('/c') }

  it('is reported by default', async () => {
    const id = await crawl(world({ target: elsewhere }))
    expect(await findings(id, '/s')).toContain('hreflang-non-canonical')
  })

  it('was not, under semantics 4, when the destination is expected not to be indexable', async () => {
    await addRules([expecting(exactPath('/t'), 'not-indexable')])
    const id = await asSemantics4(await crawl(world({ target: elsewhere })))
    expect(await findings(id, '/s')).not.toContain('hreflang-non-canonical')
  })

  it('is to an origin expected to be indexable, whatever the destination expects', async () => {
    await addRules([expecting(exactPath('/t'), 'not-indexable')])
    const id = await crawl(world({ target: elsewhere }))
    expect(await findings(id, '/s')).toContain('hreflang-non-canonical')
  })

  it('is when only its noindex was accepted: a canonical elsewhere is not a noindex', async () => {
    await addRules([asking(exactPath('/t'), 'noindex', 'required')])
    const id = await crawl(world({ target: elsewhere }))
    expect(await findings(id, '/s')).toContain('hreflang-non-canonical')
    expect(await findings(id, '/t')).toContain('noindex-required-missing')
  })

  it('is not when the origin is out of the index on purpose', async () => {
    await addRules([asking(exactPath('/s'), 'noindex', 'required')])
    const id = await crawl(world({ source: NOINDEX, target: elsewhere }))
    expect(await findings(id, '/s')).not.toContain('hreflang-non-canonical')
  })
})

describe('the links that reach a URL', () => {
  /** `/x` is linked from `/hub` alone, which nobody indexes. */
  function hubSite(x: Answer = page('/x')): Record<string, Answer> {
    return {
      [url('/')]: page('/', { links: '<a href="/hub">Hub</a>' }),
      [url('/hub')]: page('/hub', { head: meta('noindex'), links: '<a href="/x">X</a>' }),
      [url('/x')]: x,
      [url('/sitemap.xml')]: xml(sitemapOf(['/', '/hub', '/x'])),
    }
  }

  it('are reported for an indexable page, however much the pages that link to it were expected', async () => {
    await addRules([asking(exactPath('/hub'), 'noindex', 'required')])
    const id = await crawl(hubSite())
    expect(await findings(id, '/x')).toContain('only-noindex-inlinks')
  })

  it('are not reported for a page that is out of the index on purpose', async () => {
    await addRules([asking(exactPath('/x'), 'noindex', 'required')])
    const id = await crawl(hubSite(page('/x', NOINDEX)))
    expect(await findings(id, '/x')).not.toContain('only-noindex-inlinks')
  })

  it('are reported for a page that is out of the index by accident', async () => {
    const id = await crawl(hubSite(page('/x', NOINDEX)))
    expect(await findings(id, '/x')).toContain('only-noindex-inlinks')
  })

  it('are reported for a page that may be noindex and is not', async () => {
    await addRules([asking(exactPath('/x'), 'noindex', 'allowed')])
    const id = await crawl(hubSite())
    expect(await findings(id, '/x')).toContain('only-noindex-inlinks')
  })
})

describe('a URL listed in a sitemap that cannot be indexed', () => {
  it('is still reported when its noindex is what was expected, and says what is in the way', async () => {
    await addRules([asking(exactPath('/t'), 'noindex', 'required')])
    const base = world({ target: NOINDEX })
    const id = await crawl({
      ...base,
      [url('/sitemap.xml')]: xml(sitemapOf(['/', '/s', '/t', '/c'])),
    })
    // The sitemap asks for it to be indexed and the page says it must not: a conflict of its own.
    expect(await findings(id, '/t')).toContain('sitemap-not-indexable')
    expect(await detailsOf(id, '/t', 'sitemap-not-indexable')).toEqual(['noindex'])
  })
})

describe('a URL left out of the audit', () => {
  it('is not made healthy by being left out', async () => {
    await addRules([excluding(exactPath('/t'))])
    const id = await crawl(world({ target: NOINDEX }))
    expect(await findings(id, '/s')).toContain('hreflang-noindex')
    expect(await findings(id, '/c')).toContain('canonical-not-indexable')
    expect(await findings(id, '/t')).toEqual([])
    expect(await stateOf(id, '/t')).toMatchObject({
      participation: 'excluded',
      indexability: 'not-indexable',
      blockers: ['noindex'],
    })
  })

  it('still follows what was declared of it, which is a different statement', async () => {
    await addRules([excluding(exactPath('/t')), asking(exactPath('/t'), 'noindex', 'allowed')])
    const id = await asSemantics4(await crawl(world({ target: NOINDEX })))
    expect(await findings(id, '/s')).not.toContain('hreflang-noindex')
    expect(await findings(id, '/t')).toEqual([])
    expect(await stateOf(id, '/t')).toMatchObject({
      participation: 'excluded',
      indexability: 'not-indexable',
      blockers: ['noindex'],
    })
  })

  it('has no findings of its own, whatever it points at', async () => {
    await addRules([excluding(exactPath('/s'))])
    const id = await crawl(world({ target: NOINDEX }))
    expect(await findings(id, '/s')).toEqual([])
    expect(await findings(id, '/c')).toContain('canonical-not-indexable')
  })
})

// --- an analysis keeps the meaning it was made with ---------------------------------------------

describe('a finding a rule accepts', () => {
  const acceptedOf = (crawlId: string, path: string) =>
    db.crawls.acceptedOf(crawlId, [hashOf(path)])
  const ruleIds = async () => (await db.audit.config(domainId)).rules.map((rule) => rule.id)

  it('stays out of what is pending on both ends, and is kept with who accepts it (noindex)', async () => {
    await addRules([asking(exactPath('/t'), 'noindex', 'allowed')])
    const id = await crawl(world({ target: NOINDEX }))

    expect(await findings(id, '/t')).not.toContain('noindex')
    const own = await acceptedOf(id, '/t')
    expect(own.map(({ issue }) => issue)).toContain('noindex')
    expect(own.find(({ issue }) => issue === 'noindex')).toMatchObject({
      acceptedBy: hashOf('/t'),
      acceptance: { kind: 'condition', condition: 'noindex', requirement: 'allowed' },
    })
    expect(await db.crawls.acceptedCounts(id)).toEqual(
      expect.arrayContaining([{ issue: 'noindex', pages: 1 }]),
    )
  })

  it('on a canonical is on the origin, with the destination as what accepts it and as evidence', async () => {
    await addRules([asking(exactPath('/t'), 'noindex', 'allowed')])
    const id = await asSemantics4(await crawl(world({ target: NOINDEX })))

    expect(await findings(id, '/c')).not.toContain('canonical-not-indexable')
    const [rule] = await ruleIds()
    const accepted = (await acceptedOf(id, '/c')).find(
      ({ issue }) => issue === 'canonical-not-indexable',
    )
    expect(accepted).toMatchObject({
      acceptedBy: hashOf('/t'),
      acceptance: { kind: 'relation', end: 'destination', blockers: ['noindex'], rules: [rule] },
      evidence: { kind: 'related-urls', total: 1, urls: [url('/t')] },
    })
  })

  it('on an hreflang says what it points at, and shows on the destination as acting on others', async () => {
    await addRules([asking(exactPath('/t'), 'noindex', 'required')])
    const id = await asSemantics4(await crawl(world({ target: NOINDEX })))

    expect(await findings(id, '/s')).not.toContain('hreflang-noindex')
    expect(
      (await acceptedOf(id, '/s')).find(({ issue }) => issue === 'hreflang-noindex'),
    ).toMatchObject({
      acceptedBy: hashOf('/t'),
      evidence: { kind: 'related-urls', total: 1, urls: [url('/t')] },
    })

    const elsewhere = await db.crawls.acceptedBecauseOf(id, hashOf('/t'), { limit: 10 })
    expect(elsewhere.findings).toEqual(
      expect.arrayContaining([
        { urlHash: hashOf('/s'), url: url('/s'), issue: 'hreflang-noindex' },
        { urlHash: hashOf('/c'), url: url('/c'), issue: 'canonical-not-indexable' },
      ]),
    )
    expect(elsewhere.total).toBeGreaterThanOrEqual(2)
    // Its own finding is not "another URL".
    expect(elsewhere.findings.some(({ urlHash }) => urlHash === hashOf('/t'))).toBe(false)
  })

  it('from an origin out on purpose is accepted by the origin, and never acts on the destination', async () => {
    await addRules([asking(exactPath('/s'), 'noindex', 'allowed')])
    const id = await crawl(world({ source: NOINDEX, target: NOINDEX }))

    expect(
      (await acceptedOf(id, '/s')).find(({ issue }) => issue === 'hreflang-noindex'),
    ).toMatchObject({
      acceptedBy: hashOf('/s'),
      acceptance: { kind: 'relation', end: 'origin', blockers: ['noindex'] },
    })
    expect(await findings(id, '/t')).toContain('noindex')
    expect((await db.crawls.acceptedBecauseOf(id, hashOf('/t'), { limit: 10 })).total).toBe(0)
  })

  it('on a robots.txt block needs the robots condition: a noindex rule does not accept it', async () => {
    const robots = 'User-agent: *\nDisallow: /t'
    await addRules([asking(exactPath('/t'), 'noindex', 'allowed')])
    const blocked = await crawl(world({ target: {}, robots }))
    expect(await findings(blocked, '/c')).toContain('canonical-not-indexable')
    expect(
      (await acceptedOf(blocked, '/c')).some(({ issue }) => issue === 'canonical-not-indexable'),
    ).toBe(false)

    await addRules([asking(exactPath('/t'), 'robots', 'allowed')])
    const accepted = await asSemantics4(await crawl(world({ target: {}, robots })))
    expect(await findings(accepted, '/c')).not.toContain('canonical-not-indexable')
    expect(
      (await acceptedOf(accepted, '/c')).find(({ issue }) => issue === 'canonical-not-indexable'),
    ).toMatchObject({
      acceptedBy: hashOf('/t'),
      acceptance: { kind: 'relation', end: 'destination', blockers: ['robots'] },
    })
    expect(await findings(accepted, '/t')).not.toContain('robots-blocked')
    expect((await acceptedOf(accepted, '/t')).map(({ issue }) => issue)).toContain('robots-blocked')
  })

  it('is never what a destination that fails or redirects is', async () => {
    await addRules([asking(exactPath('/t'), 'noindex', 'allowed')])
    const id = await crawl(
      world({ target: { answer: { statusCode: 500, headers: {}, body: Buffer.from('') } } }),
    )
    expect(await findings(id, '/c')).toContain('canonical-broken')
    expect((await acceptedOf(id, '/c')).some(({ issue }) => issue.startsWith('canonical-'))).toBe(
      false,
    )
  })

  it('is nothing at all when nobody declared anything, or the URL is left out of the audit', async () => {
    const none = await crawl(world({ target: NOINDEX }))
    expect(await db.crawls.acceptedCounts(none)).toEqual([])

    await addRules([excluding(exactPath('/s'))])
    const left = await crawl(world({ source: NOINDEX, target: NOINDEX }))
    expect(await acceptedOf(left, '/s')).toEqual([])
  })

  it('goes away when the rule does, and the finding is pending again', async () => {
    await addRules([asking(exactPath('/t'), 'noindex', 'allowed')])
    const id = await asSemantics4(await crawl(world({ target: NOINDEX })))
    expect(await findings(id, '/c')).not.toContain('canonical-not-indexable')

    const [rule] = await ruleIds()
    await db.audit.deleteRule({ domainId, id: rule! })
    await analyseCrawl(db, id, await currentAuditConfig(db, domainId))

    expect(await findings(id, '/c')).toContain('canonical-not-indexable')
    expect(await db.crawls.acceptedCounts(id)).toEqual([])
  })

  it('is not read back from an analysis under a meaning that accepted no relation', async () => {
    await addRules([asking(exactPath('/t'), 'noindex', 'allowed')])
    const id = await crawl(world({ target: NOINDEX }))
    const old = { ...(await currentAuditConfig(db, domainId)), semantics: RELATIONS_SEMANTICS - 1 }
    await analyseCrawl(db, id, old as AuditSnapshot)
    expect(await findings(id, '/c')).toContain('canonical-not-indexable')
    expect(
      (await acceptedOf(id, '/c')).some(({ acceptance }) => acceptance.kind === 'relation'),
    ).toBe(false)
  })
})

describe('an analysis made before the meaning that reads relations', () => {
  const allowing = () => [asking(exactPath('/t'), 'noindex', 'allowed')]
  const analysedAs = async (id: string, snapshot: AuditSnapshot) => {
    await analyseCrawl(db, id, snapshot)
    return { s: await relationsOf(id, '/s'), c: await relationsOf(id, '/c') }
  }

  it('is repeated as it was, and the current one reads the same rules another way', async () => {
    await addRules(allowing())
    const id = await crawl(world({ target: NOINDEX }))
    const now = await currentAuditConfig(db, domainId)
    expect(now.semantics).toBe(AUDIT_SEMANTICS)

    const before = await analysedAs(id, { ...now, semantics: 3 })
    expect(before).toEqual({ s: ['hreflang-noindex'], c: ['canonical-not-indexable'] })
    expect((await db.crawls.get(id))?.auditSnapshot?.semantics).toBe(3)

    // Under 4 the destination's allowed noindex excused both origins.
    expect(await analysedAs(id, { ...now, semantics: RELATIONS_SEMANTICS })).toEqual({
      s: [],
      c: [],
    })
    expect((await db.crawls.get(id))?.auditSnapshot?.semantics).toBe(RELATIONS_SEMANTICS)

    // Under the current meaning only the origin's own declarations do, and both are indexable.
    expect(await analysedAs(id, now)).toEqual(before)
    expect((await db.crawls.get(id))?.auditSnapshot?.semantics).toBe(AUDIT_SEMANTICS)
  })

  it('stays what it was when the catalog analyses it again', async () => {
    await addRules(allowing())
    const id = await crawl(world({ target: NOINDEX }))
    const now = await currentAuditConfig(db, domainId)
    await analyseCrawl(db, id, { ...now, semantics: 3 })
    // As if the catalog changed since: the crawl is analysed again with the configuration it kept.
    const stored = (await db.crawls.get(id))!
    await db.crawls.saveAnalysis({
      crawlId: id,
      issues: [],
      pages: { issue: 0, warning: 0, opportunity: 0 },
      withType: { issue: 0, warning: 0, opportunity: 0 },
      catalog: 'older',
      audit: {
        snapshot: stored.auditSnapshot!,
        pages: { audited: 0, excluded: 0, indexable: 0, notIndexable: 0, unknownIndexability: 0 },
        urls: [],
      },
    })
    expect(await reanalyseOutdatedCrawls({ db, log })).toBe(1)
    expect((await db.crawls.get(id))?.auditSnapshot?.semantics).toBe(3)
    expect(await findings(id, '/s')).toContain('hreflang-noindex')
    expect(await findings(id, '/c')).toContain('canonical-not-indexable')
  })

  it('does not read what it never had: an analysis without a semantics is the first one', async () => {
    const id = await crawl(world({ target: NOINDEX }))
    await analyseCrawl(db, id, EMPTY_AUDIT_SNAPSHOT)
    expect(await findings(id, '/s')).toContain('hreflang-noindex')
  })
})

describe('a recheck of some URLs', () => {
  it('settles none of the findings about the other end of a relation', () => {
    // They need the other URL, which a recheck does not have: only a full crawl says.
    for (const issue of RELATIONS) expect(isSiteScopedIssue(issue), issue).toBe(true)
  })

  it('knows nothing of the other end of a relation, and is not made to', async () => {
    await addRules([
      asking(exactPath('/t'), 'noindex', 'allowed'),
      expecting(exactPath('/s'), 'not-indexable'),
    ])
    const config = await currentAuditConfig(db, domainId)
    const context = recheckContext({
      host: 'example.com',
      now: new Date(),
      config,
      robotsTexts: new Map(),
      answered: true,
    })
    const outcome = evaluateRecheck(
      {
        url: url('/s'),
        source: 'link',
        linksIn: 1,
        anchors: { internal: 1, nofollow: 0 },
        answer: {
          kind: 'page',
          statusCode: 200,
          contentType: 'text/html',
          redirectTo: null,
          title: 'A',
          metaRobots: null,
          xRobotsTag: null,
          canonical: url('/t'),
          responseTimeMs: 1,
          bytes: 10,
          error: null,
          data: { hreflang: [{ lang: 'es', url: url('/t'), source: 'html' }] },
        },
      },
      context,
    )
    const settled = outcome.findings.map(({ issue }) => issue)
    for (const issue of RELATIONS) expect(settled).not.toContain(issue)
    // The checks about other URLs were not made, and are not said to have been: that is for a crawl.
    expect(outcome.unchecked).toEqual([])
    expect(outcome.audit).toMatchObject({ intent: 'not-indexable' })
  })
})
