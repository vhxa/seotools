import { describe, expect, it } from 'vitest'
import { EMPTY_AUDIT_SNAPSHOT, auditSnapshotOf, type AuditRule } from './audit'
import {
  keepsUrlHistory,
  FINDING_CHANGES,
  PAGE_LOCAL_ISSUES,
  assessPair,
  auditScopeKey,
  byAge,
  classifyFinding,
  classifyFindings,
  crawlAuditScope,
  crawlFactsOf,
  fieldChanges,
  isBrowsableStatus,
  isPageLocalIssue,
  issueTimelines,
  observe,
  orderPair,
  reportedIssues,
  type CrawlFacts,
  type CrawlLike,
  type Evidence,
  type UrlEvidence,
  type UrlSnapshot,
} from './compare'
import { PAGE_ISSUE_IDS } from './issues'
import { DEFAULT_THRESHOLDS } from './thresholds'

const CATALOG = '3.abc'

function crawl(overrides: Partial<CrawlLike> = {}): CrawlLike {
  return {
    id: 'c1',
    status: 'completed',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    finishedAt: new Date('2026-01-01T01:00:00Z'),
    pruned: false,
    pagesByWorstIssue: { issue: 0, warning: 0, opportunity: 0 },
    pagesAudit: { audited: 1, excluded: 0, indexable: 1, notIndexable: 0, unknownIndexability: 0 },
    issueCatalog: CATALOG,
    auditVersion: 2,
    auditSnapshot: auditSnapshotOf(2, []),
    ...overrides,
  }
}

const facts = (overrides: Partial<CrawlFacts> = {}): CrawlFacts => ({
  ...crawlFactsOf(crawl()),
  ...overrides,
})

const url = (issues: string[] = [], overrides: Partial<UrlEvidence> = {}): UrlEvidence => ({
  requested: true,
  participation: 'audited',
  intent: 'indexable',
  conditions: '',
  issues: new Set(issues),
  ...overrides,
})

const seen = (
  issues: string[] = [],
  overrides: Partial<UrlEvidence> = {},
  f = facts(),
): Evidence => ({
  crawl: f,
  url: url(issues, overrides),
})

const snapshot = (overrides: Partial<UrlSnapshot> = {}): UrlSnapshot => ({
  state: 'done',
  kind: 'page',
  statusCode: 200,
  redirectTo: null,
  title: 'Home',
  canonical: null,
  metaRobots: null,
  xRobotsTag: null,
  error: null,
  depth: 0,
  ...overrides,
})

describe('fieldChanges', () => {
  it('finds nothing between identical answers', () => {
    expect(fieldChanges(snapshot(), snapshot())).toEqual([])
  })

  it('names each part of the answer that differs', () => {
    expect(fieldChanges(snapshot(), snapshot({ statusCode: 404 }))).toEqual(['status'])
    expect(fieldChanges(snapshot(), snapshot({ kind: 'redirect', redirectTo: '/x' }))).toEqual([
      'status',
    ])
    expect(fieldChanges(snapshot(), snapshot({ title: 'Casa' }))).toEqual(['title'])
    expect(fieldChanges(snapshot(), snapshot({ canonical: 'https://acme.com/' }))).toEqual([
      'canonical',
    ])
    expect(fieldChanges(snapshot(), snapshot({ xRobotsTag: 'noindex' }))).toEqual(['robots'])
    expect(fieldChanges(snapshot(), snapshot({ metaRobots: 'noindex' }))).toEqual(['robots'])
    expect(
      fieldChanges(snapshot(), snapshot({ statusCode: 500, title: null, metaRobots: 'nofollow' })),
    ).toEqual(['status', 'title', 'robots'])
  })

  it('compares exactly: a title that only changes case is a change, and an empty one is not null', () => {
    expect(fieldChanges(snapshot({ title: 'home' }), snapshot({ title: 'Home' }))).toEqual([
      'title',
    ])
    expect(fieldChanges(snapshot({ title: '' }), snapshot({ title: null }))).toEqual(['title'])
  })

  it('does not compare a URL one of the crawls found but did not request', () => {
    expect(fieldChanges(snapshot({ state: 'queued', statusCode: null }), snapshot())).toEqual([])
    expect(fieldChanges(snapshot(), snapshot({ state: 'queued', statusCode: null }))).toEqual([])
  })
})

describe('orderPair and byAge', () => {
  it('puts the older crawl first whatever the order given', () => {
    const older = crawl({ id: 'a', createdAt: new Date('2026-01-01') })
    const newer = crawl({ id: 'b', createdAt: new Date('2026-02-01') })
    expect(orderPair(newer, older)).toEqual({ base: older, target: newer })
    expect(orderPair(older, newer)).toEqual({ base: older, target: newer })
  })

  it('breaks a tie by id, so that the order is always the same', () => {
    const at = new Date('2026-01-01')
    const a = crawl({ id: 'a', createdAt: at })
    const b = crawl({ id: 'b', createdAt: at })
    expect(byAge(a, b)).toBeLessThan(0)
    expect(orderPair(b, a)).toEqual({ base: a, target: b })
  })

  it('knows which statuses have results', () => {
    expect(isBrowsableStatus('completed')).toBe(true)
    expect(isBrowsableStatus('incomplete')).toBe(true)
    for (const status of ['pending', 'running', 'failed', 'cancelled'] as const) {
      expect(isBrowsableStatus(status)).toBe(false)
    }
  })
})

describe('auditScopeKey', () => {
  const rule = (overrides: Partial<AuditRule> = {}): AuditRule =>
    ({
      id: 'r1',
      dimension: 'audit',
      value: 'exclude',
      selector: { kind: 'prefix', path: '/blog', query: { mode: 'any' }, scope: 'literal' },
      reason: 'because',
      enabled: true,
      ...overrides,
    }) as AuditRule

  it('is the same for a rule made again with another id and reason', () => {
    expect(auditScopeKey(auditSnapshotOf(3, [rule()]))).toBe(
      auditScopeKey(auditSnapshotOf(9, [rule({ id: 'r2', reason: null })])),
    )
  })

  it('differs when a rule, its value or the languages differ', () => {
    const base = auditScopeKey(auditSnapshotOf(3, [rule()]))
    expect(auditScopeKey(auditSnapshotOf(3, []))).not.toBe(base)
    expect(
      auditScopeKey(auditSnapshotOf(3, [rule({ value: 'include' } as Partial<AuditRule>)])),
    ).not.toBe(base)
    expect(
      auditScopeKey(auditSnapshotOf(3, [rule()], { prefixes: ['/es'], unprefixed: true })),
    ).not.toBe(base)
  })

  it('tells a snapshot from before semantics 2 apart from one with no rules now', () => {
    expect(auditScopeKey(EMPTY_AUDIT_SNAPSHOT)).not.toBe(auditScopeKey(auditSnapshotOf(0, [])))
  })

  it('differs when a condition is asked for, and by what it asks', () => {
    const condition = (value: 'required' | 'allowed') =>
      rule({ dimension: 'noindex', value } as Partial<AuditRule>)
    const required = auditScopeKey(auditSnapshotOf(3, [condition('required')]))
    expect(required).not.toBe(auditScopeKey(auditSnapshotOf(3, [])))
    expect(required).not.toBe(auditScopeKey(auditSnapshotOf(3, [condition('allowed')])))
    expect(required).not.toBe(
      auditScopeKey(
        auditSnapshotOf(3, [
          rule({ dimension: 'nofollow', value: 'required' } as Partial<AuditRule>),
        ]),
      ),
    )
  })

  it('does not tell semantics 2 from 3 when the older one has nothing that 3 reads another way', () => {
    const before = { ...auditSnapshotOf(3, [rule()]), semantics: 2 }
    const after = auditSnapshotOf(4, [rule()])
    expect(auditScopeKey(before)).toBe(auditScopeKey(after))
    // But an accepted nofollow was the expectation's, and a snapshot with one means something else.
    const accepting = {
      ...before,
      rules: [
        ...before.rules,
        {
          id: 'i',
          dimension: 'intent',
          value: 'indexable',
          acceptNofollow: true,
          selector: { kind: 'prefix', path: '/', query: { mode: 'any' }, scope: 'literal' },
          reason: null,
          enabled: true,
        } as AuditRule,
      ],
    }
    expect(auditScopeKey(accepting)).not.toBe(auditScopeKey(after))
  })

  describe('the meaning that reads relations (semantics 4)', () => {
    const allowing = (dimension: 'noindex' | 'robots' = 'noindex'): AuditRule =>
      rule({ dimension, value: 'allowed' } as Partial<AuditRule>)
    const third = (rules: AuditRule[]) => ({ ...auditSnapshotOf(3, rules), semantics: 3 })

    it('reads a configuration of semantics 3 the same unless a rule accepts what others point at', () => {
      for (const rules of [
        [],
        [rule()],
        [rule({ dimension: 'sitemap', value: 'required' } as Partial<AuditRule>)],
        [rule({ dimension: 'nofollow', value: 'allowed' } as Partial<AuditRule>)],
        [rule({ dimension: 'noindex', value: 'forbidden' } as Partial<AuditRule>)],
        [rule({ dimension: 'intent', value: 'indexable', acceptNofollow: false } as never)],
      ]) {
        expect(auditScopeKey(third(rules))).toBe(auditScopeKey(auditSnapshotOf(3, rules)))
      }
    })

    it.each([
      ['an allowed noindex', allowing()],
      [
        'a required noindex',
        rule({ dimension: 'noindex', value: 'required' } as Partial<AuditRule>),
      ],
      ['an allowed robots block', allowing('robots')],
      [
        'an expectation of not being indexable',
        rule({ dimension: 'intent', value: 'not-indexable', acceptNofollow: false } as never),
      ],
    ])('does not read %s the same under 3 and 4', (_, accepting) => {
      expect(auditScopeKey(third([accepting]))).not.toBe(
        auditScopeKey(auditSnapshotOf(3, [accepting])),
      )
    })

    it('does not make an older analysis comparable with a newer one that reads the same rules differently', () => {
      const before = crawl({ auditSnapshot: third([allowing()]) })
      const after = crawl({ auditSnapshot: auditSnapshotOf(4, [allowing()]) })
      expect(assessPair(before, after).notes.map((note) => note.code)).toContain('audit')
      // Nothing to note when nothing in the rules is read another way.
      const plain = crawl({ auditSnapshot: third([rule()]) })
      const plainNow = crawl({ auditSnapshot: auditSnapshotOf(4, [rule()]) })
      expect(assessPair(plain, plainNow).notes.map((note) => note.code)).not.toContain('audit')
    })

    it('does not call a relation finding resolved when the other end was declared in the meantime', () => {
      const without = facts({ scope: auditScopeKey(auditSnapshotOf(2, [])) })
      const declared = facts({ scope: auditScopeKey(auditSnapshotOf(3, [allowing()])) })
      for (const issue of [
        'hreflang-noindex',
        'canonical-not-indexable',
        'hreflang-no-return',
        'hreflang-non-canonical',
        'only-noindex-inlinks',
      ]) {
        expect(isPageLocalIssue(issue)).toBe(false)
        // The page itself is the same in both crawls: its own rules did not change, the target's did.
        expect(
          classifyFinding(issue, {
            base: seen([issue], {}, without),
            target: seen([], {}, declared),
          }),
        ).toMatchObject({ kind: 'unverified', reasons: ['audit'] })
        expect(
          classifyFinding(issue, {
            base: seen([], {}, without),
            target: seen([issue], {}, declared),
          }),
        ).toMatchObject({ kind: 'unverified', reasons: ['audit'] })
      }
    })
  })

  it('is unknown for a crawl that was not analysed, or whose snapshot is gone', () => {
    expect(crawlAuditScope(crawl({ pagesByWorstIssue: null }))).toBeNull()
    expect(crawlAuditScope(crawl({ auditSnapshot: null, auditVersion: 4 }))).toBeNull()
    // Analysed before configuration existed: with none.
    expect(crawlAuditScope(crawl({ auditSnapshot: null, auditVersion: null }))).toBe(
      auditScopeKey(EMPTY_AUDIT_SNAPSHOT),
    )
  })
})

describe('assessPair', () => {
  const base = crawl({ id: 'a' })
  const target = crawl({ id: 'b' })
  const codes = (a: CrawlLike, b: CrawlLike) =>
    assessPair(a, b).notes.map((note) => `${note.code}:${note.sides.join('+')}`)

  it('has nothing to say about two complete crawls analysed the same way', () => {
    expect(assessPair(base, target)).toEqual({ urls: true, findings: true, notes: [] })
  })

  it('cannot compare URLs when a side was pruned, and says which', () => {
    const result = assessPair(base, crawl({ id: 'b', pruned: true }))
    expect(result).toMatchObject({ urls: false, findings: false })
    expect(codes(base, crawl({ pruned: true }))).toEqual(['pruned:target'])
    expect(codes(crawl({ pruned: true }), crawl({ pruned: true }))).toEqual(['pruned:base+target'])
  })

  it('cannot compare findings when a side was not analysed', () => {
    const result = assessPair(crawl({ pagesByWorstIssue: null }), target)
    expect(result).toMatchObject({ urls: true, findings: false })
    expect(codes(crawl({ pagesByWorstIssue: null }), target)).toEqual(['unanalysed:base'])
  })

  it('flags a different issue catalog, which is no reason to call anything fixed', () => {
    expect(codes(base, crawl({ issueCatalog: '4.xyz' }))).toEqual(['catalog:base+target'])
    expect(codes(base, crawl({ issueCatalog: null }))).toEqual(['catalog:base+target'])
  })

  it('flags a different audit configuration, but not one that only got another version', () => {
    const excluded = auditSnapshotOf(3, [
      {
        id: 'r1',
        dimension: 'audit',
        value: 'exclude',
        selector: { kind: 'prefix', path: '/blog', query: { mode: 'any' }, scope: 'literal' },
        reason: null,
        enabled: true,
      },
    ])
    expect(codes(base, crawl({ auditVersion: 3, auditSnapshot: excluded }))).toEqual([
      'audit:base+target',
    ])
    expect(codes(base, crawl({ auditVersion: 7, auditSnapshot: auditSnapshotOf(7, []) }))).toEqual(
      [],
    )
  })

  it('flags a crawl that stopped at its URL limit, on the side it happened', () => {
    expect(codes(crawl({ status: 'incomplete' }), target)).toEqual(['incomplete:base'])
    expect(codes(base, crawl({ status: 'incomplete' }))).toEqual(['incomplete:target'])
  })

  it('flags a crawl analysed before it kept what was audited', () => {
    expect(codes(crawl({ pagesAudit: null }), target)).toEqual(['legacy:base'])
  })
})

describe('observe', () => {
  it('says why a crawl cannot tell, never "not reported"', () => {
    const reason = (e: Evidence) => {
      const o = observe('title-missing', e)
      return o.presence === 'unknown' ? o.reason : o.presence
    }
    expect(reason(seen([], {}, facts({ retained: false, observable: false })))).toBe('pruned')
    expect(reason(seen([], {}, facts({ analysed: false })))).toBe('unanalysed')
    expect(reason({ crawl: facts(), url: null })).toBe('not-seen')
    expect(reason(seen([], { requested: false }))).toBe('not-requested')
    expect(reason(seen([], { participation: 'excluded' }))).toBe('excluded')
    expect(reason(seen([], { participation: null }))).toBe('participation')
    expect(reason(seen([]))).toBe('absent')
    expect(reason(seen(['title-missing']))).toBe('present')
  })

  it('does not trust an incomplete crawl on what depends on other URLs, either way', () => {
    const incomplete = facts({ complete: false })
    expect(observe('title-missing', seen(['title-missing'], {}, incomplete)).presence).toBe(
      'present',
    )
    expect(observe('title-missing', seen([], {}, incomplete)).presence).toBe('absent')
    for (const issue of ['title-duplicate', 'orphan-in-sitemap', 'redirect-chain']) {
      expect(isPageLocalIssue(issue)).toBe(false)
      expect(observe(issue, seen([issue], {}, incomplete))).toEqual({
        presence: 'unknown',
        reason: 'incomplete',
      })
      expect(observe(issue, seen([], {}, incomplete))).toEqual({
        presence: 'unknown',
        reason: 'incomplete',
      })
    }
  })
})

describe('the issues that only depend on the page', () => {
  it('are all in the catalog, once', () => {
    expect(new Set(PAGE_LOCAL_ISSUES).size).toBe(PAGE_LOCAL_ISSUES.length)
    for (const id of PAGE_LOCAL_ISSUES) expect(PAGE_ISSUE_IDS).toContain(id)
  })

  it('leave out what looks at other URLs or at the clock', () => {
    for (const id of [
      'title-duplicate',
      'description-duplicate',
      'h1-duplicate',
      'content-duplicate',
      'content-near-duplicate',
      'redirect-chain',
      'redirect-loop',
      'canonical-not-indexable',
      'orphan-in-sitemap',
      'only-nofollow-inlinks',
      'deep-page',
      'indexed-not-in-sitemap',
      'indexable-not-in-sitemap',
      'hreflang-no-return',
      'hreflang-no-self',
      'unavailable-after-future',
      'unavailable-after-expired',
      'robots-blocked',
      'broken-external-link',
      'expected-not-indexable-but-indexable',
    ]) {
      expect(isPageLocalIssue(id), id).toBe(false)
    }
  })
})

describe('classifyFinding', () => {
  const issue = 'title-missing'
  const classify = (
    base: Evidence,
    target: Evidence,
    extra: { earlier?: Evidence[]; between?: Evidence[] } = {},
  ) => classifyFinding(issue, { base, target, ...extra })

  it('says nothing when neither crawl reports it, or neither can tell', () => {
    expect(classify(seen([]), seen([]))).toBeNull()
    expect(classify({ crawl: facts(), url: null }, { crawl: facts(), url: null })).toBeNull()
  })

  it('calls an issue new, resolved or persistent when both crawls could have reported it', () => {
    expect(classify(seen([]), seen([issue]))).toMatchObject({ kind: 'new', reportedBy: 'target' })
    expect(classify(seen([issue]), seen([]))).toMatchObject({
      kind: 'resolved',
      reportedBy: 'base',
    })
    expect(classify(seen([issue]), seen([issue]))).toMatchObject({
      kind: 'persistent',
      reportedBy: 'both',
    })
  })

  describe('reappeared', () => {
    it('is never inferred from two crawls alone', () => {
      expect(classify(seen([]), seen([issue]))?.kind).toBe('new')
      expect(classify(seen([issue]), seen([issue]))?.kind).toBe('persistent')
    })

    it('needs a crawl before the earlier one that did report it', () => {
      expect(classify(seen([]), seen([issue]), { earlier: [seen([issue])] })?.kind).toBe(
        'reappeared',
      )
      // Crawls that report it do not count when they cannot say, or say it was not there.
      expect(
        classify(seen([]), seen([issue]), {
          earlier: [seen([], {}, facts({ retained: false, observable: false })), seen([])],
        })?.kind,
      ).toBe('new')
    })

    it('needs a crawl in between that could have reported it and did not', () => {
      expect(classify(seen([issue]), seen([issue]), { between: [seen([])] })?.kind).toBe(
        'reappeared',
      )
      // A crawl in between that cannot say is a gap, not an absence.
      for (const between of [
        seen([], {}, facts({ retained: false, observable: false })),
        seen([], { participation: 'excluded' }),
        seen([], { requested: false }),
        { crawl: facts(), url: null },
        seen([], {}, facts({ catalog: 'other' })),
      ]) {
        expect(classify(seen([issue]), seen([issue]), { between: [between] })?.kind).toBe(
          'persistent',
        )
      }
      expect(classify(seen([issue]), seen([issue]), { between: [seen([issue])] })?.kind).toBe(
        'persistent',
      )
    })
  })

  describe('when the evidence does not say why the findings differ', () => {
    it('does not call an issue resolved or new after the issue catalog changed', () => {
      const other = facts({ catalog: '4.zzz' })
      expect(classify(seen([issue]), seen([], {}, other))).toMatchObject({
        kind: 'unverified',
        reportedBy: 'base',
        reasons: ['catalog'],
      })
      expect(classify(seen([], {}, other), seen([issue]))).toMatchObject({
        kind: 'unverified',
        reportedBy: 'target',
        reasons: ['catalog'],
      })
      // Nor when a catalog was never recorded.
      expect(classify(seen([issue]), seen([], {}, facts({ catalog: null })))?.kind).toBe(
        'unverified',
      )
    })

    it('does not call an issue resolved when the URL expectation or what its rules ask of it changed', () => {
      expect(classify(seen([issue]), seen([], { intent: 'not-indexable' }))).toMatchObject({
        kind: 'unverified',
        reasons: ['audit'],
      })
      expect(classify(seen([], { conditions: 'nofollow=allowed' }), seen([issue]))).toMatchObject({
        kind: 'unverified',
        reasons: ['audit'],
      })
      // Each condition counts: a requirement that changed from one to another is a change too.
      expect(
        classify(
          seen([], { conditions: 'noindex=required' }),
          seen([issue], { conditions: 'noindex=forbidden' }),
        ),
      ).toMatchObject({ kind: 'unverified', reasons: ['audit'] })
    })

    it('does not call a finding that looks at other pages resolved when the audit rules changed', () => {
      const changed = facts({ scope: 'something else' })
      expect(
        classifyFinding('title-duplicate', {
          base: seen(['title-duplicate']),
          target: seen([], {}, changed),
        }),
      ).toMatchObject({ kind: 'unverified', reasons: ['audit'] })
      // One that only depends on the page is not touched by rules about other URLs.
      expect(classify(seen([issue]), seen([], {}, changed))?.kind).toBe('resolved')
    })

    it('does not call a finding of an incomplete crawl resolved or new, if it looks at other pages', () => {
      const incomplete = facts({ complete: false })
      expect(
        classifyFinding('orphan-in-sitemap', {
          base: seen(['orphan-in-sitemap']),
          target: seen([], {}, incomplete),
        }),
      ).toMatchObject({ kind: 'unverified', reportedBy: 'base', reasons: ['incomplete'] })
      expect(classify(seen([issue]), seen([], {}, incomplete))?.kind).toBe('resolved')
    })

    it('does not call an issue resolved when the later crawl did not request the URL', () => {
      expect(classify(seen([issue]), seen([], { requested: false }))).toMatchObject({
        kind: 'unverified',
        reasons: ['not-requested'],
      })
    })

    it('does not guess when the analysis did not keep what was audited', () => {
      expect(classify(seen([issue]), seen([], { participation: null }))).toMatchObject({
        kind: 'unverified',
        reasons: ['participation'],
      })
    })
  })

  describe('policy against the site', () => {
    it('does not call an issue resolved when the later crawl no longer audits the URL', () => {
      expect(classify(seen([issue]), seen([], { participation: 'excluded' }))).toEqual({
        issue,
        kind: 'excluded',
        reportedBy: 'base',
        reasons: [],
      })
    })

    it('does not call an issue new when the earlier crawl left the URL out of the audit', () => {
      expect(classify(seen([], { participation: 'excluded' }), seen([issue]))).toEqual({
        issue,
        kind: 'audited',
        reportedBy: 'target',
        reasons: [],
      })
    })

    it('ignores the findings of a URL excluded on both sides', () => {
      expect(
        classifyFindings({
          base: seen([issue], { participation: 'excluded' }),
          target: seen([issue], { participation: 'excluded' }),
        }),
      ).toEqual([])
    })
  })
})

describe('classifyFindings', () => {
  it('lists every issue either side reports, differences first and the worst first', () => {
    const changes = classifyFindings({
      base: seen(['title-missing', 'noindex', 'h1-multiple']),
      target: seen(['noindex', 'h1-multiple', 'client-error', 'title-too-long']),
    })
    expect(changes.map((c) => `${c.kind}:${c.issue}`)).toEqual([
      'new:client-error',
      'new:title-too-long',
      'resolved:title-missing',
      'persistent:noindex',
      'persistent:h1-multiple',
    ])
  })

  it('finds a reappearance and a new issue side by side', () => {
    const changes = classifyFindings({
      base: seen([]),
      target: seen(['title-missing', 'h1-missing']),
      earlier: [seen(['title-missing'])],
    })
    expect(changes.map((c) => `${c.kind}:${c.issue}`).sort()).toEqual([
      'new:h1-missing',
      'reappeared:title-missing',
    ])
  })

  it('has every kind in the list it is ranked by', () => {
    expect(new Set(FINDING_CHANGES).size).toBe(FINDING_CHANGES.length)
  })
})

describe('issueTimelines', () => {
  const issue = 'title-missing'

  it('follows an issue through crawls and finds the reappearance', () => {
    const [timeline] = issueTimelines([seen([issue]), seen([]), seen([]), seen([issue])], [issue])
    expect(timeline?.cells.map((c) => c.presence)).toEqual([
      'present',
      'absent',
      'absent',
      'present',
    ])
    expect(timeline?.events.map((e) => e?.kind ?? null)).toEqual([
      null,
      'resolved',
      null,
      'reappeared',
    ])
  })

  it('leaves a gap instead of reading a pruned crawl as "not reported"', () => {
    const [timeline] = issueTimelines(
      [seen([issue]), seen([], {}, facts({ retained: false, observable: false })), seen([issue])],
      [issue],
    )
    expect(timeline?.cells.map((c) => c.presence)).toEqual(['present', 'unknown', 'present'])
    // Nothing says it was fixed in between, so it is not called reappeared either.
    expect(timeline?.events.map((e) => e?.kind ?? null)).toEqual([null, 'unverified', 'unverified'])
  })

  it('does not call the first appearance after an unknown stretch new', () => {
    const [timeline] = issueTimelines([{ crawl: facts(), url: null }, seen([issue])], [issue])
    expect(timeline?.events[1]).toMatchObject({ kind: 'unverified', reasons: ['not-seen'] })
  })

  it('collects the issues a URL ever had', () => {
    expect(
      [
        ...reportedIssues([
          seen(['a', 'b']),
          seen(['b', 'c'], { participation: 'excluded' }),
          seen(['d']),
        ]),
      ].sort(),
    ).toEqual(['a', 'b', 'd'])
  })
})

describe('a finding a rule accepts in the later crawl', () => {
  const crawl: Evidence['crawl'] = {
    retained: true,
    observable: true,
    analysed: true,
    complete: true,
    catalog: 'v1',
    scope: 's1',
    perUrlAudit: true,
    thresholds: DEFAULT_THRESHOLDS,
  }
  const url = (issues: string[], accepted: string[] = [], conditions = 'none'): UrlEvidence => ({
    requested: true,
    participation: 'audited',
    intent: 'indexable',
    conditions,
    issues: new Set(issues),
    accepted: new Set(accepted),
  })

  it('is accepted, never resolved, whatever else changed around it', () => {
    const change = classifyFinding('noindex', {
      base: { crawl, url: url(['noindex']) },
      target: { crawl: { ...crawl, scope: 's2' }, url: url([], ['noindex'], 'noindex:allowed') },
    })
    expect(change).toMatchObject({ kind: 'accepted', reportedBy: 'base' })
  })

  it('is resolved only when the later crawl no longer sees it', () => {
    const change = classifyFinding('noindex', {
      base: { crawl, url: url(['noindex']) },
      target: { crawl, url: url([]) },
    })
    expect(change).toMatchObject({ kind: 'resolved' })
  })

  it('is not told as new when the rule goes away: the configuration changed, not the site', () => {
    const change = classifyFinding('noindex', {
      base: { crawl, url: url([], ['noindex'], 'noindex:allowed') },
      target: { crawl: { ...crawl, scope: 's2' }, url: url(['noindex']) },
    })
    expect(change).toMatchObject({ kind: 'unverified', reasons: ['audit'] })
  })
})

describe('a finding decided by a figure the domain sets', () => {
  const crawl: Evidence['crawl'] = {
    retained: true,
    observable: true,
    analysed: true,
    complete: true,
    catalog: 'v1',
    scope: 's1',
    perUrlAudit: true,
    thresholds: DEFAULT_THRESHOLDS,
  }
  const url = (issues: string[]): UrlEvidence => ({
    requested: true,
    participation: 'audited',
    intent: 'indexable',
    conditions: 'none',
    issues: new Set(issues),
    accepted: new Set(),
  })
  const longer = { ...crawl, scope: 's2', thresholds: { ...DEFAULT_THRESHOLDS, titleMax: 100 } }

  it('is not resolved when only the figure moved', () => {
    const change = classifyFinding('title-too-long', {
      base: { crawl, url: url(['title-too-long']) },
      target: { crawl: longer, url: url([]) },
    })
    expect(change).toMatchObject({ kind: 'unverified', reasons: ['audit'] })
  })

  it('is not new when only the figure moved', () => {
    const change = classifyFinding('title-too-long', {
      base: { crawl: longer, url: url([]) },
      target: { crawl, url: url(['title-too-long']) },
    })
    expect(change).toMatchObject({ kind: 'unverified', reasons: ['audit'] })
  })

  it('still compares a page-local issue no figure decides', () => {
    const change = classifyFinding('title-missing', {
      base: { crawl, url: url(['title-missing']) },
      target: { crawl: longer, url: url([]) },
    })
    expect(change).toMatchObject({ kind: 'resolved' })
  })
})

describe('a crawl kept only as compact history', () => {
  it('still says what each URL was, but cannot be compared with another crawl in detail', () => {
    const compact = { pruned: true, history: true }
    expect(keepsUrlHistory(compact)).toBe(true)
    expect(keepsUrlHistory({ pruned: true, history: false })).toBe(false)
    expect(keepsUrlHistory({ pruned: false })).toBe(true)
  })
})
