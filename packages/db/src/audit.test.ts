import type { AuditSelector } from '@seotools/core'
import { describe, expect, it } from 'vitest'
import {
  planFindingStates,
  planSaveRuleSet,
  planUpgradeSemantics,
  selectorHashOf,
  type AuditRuleRow,
  type PlanContext,
} from './audit'

/** The rows a version of the code before conditions left, as the planner sees them. */
let counter = 0
const row = (
  selector: AuditSelector,
  over: Partial<AuditRuleRow> & { value?: string; acceptNofollow?: boolean } = {},
): AuditRuleRow => {
  const hash = selectorHashOf(selector)
  const enabled = over.enabled ?? true
  return {
    id: `row-${++counter}`,
    ruleSet: null,
    domainId: 'd1',
    dimension: 'intent',
    value: 'indexable',
    selectorKind: selector.kind,
    selector: selector.kind === 'url' ? selector.url : selector.path,
    queryMode: selector.kind !== 'url' && selector.query.mode === 'exact' ? 'exact' : 'any',
    queryValue:
      selector.kind !== 'url' && selector.query.mode === 'exact' ? selector.query.value : null,
    scope: selector.kind === 'url' ? 'literal' : selector.scope,
    acceptNofollow: false,
    selectorHash: hash,
    activeKey: enabled ? hash : null,
    reason: null,
    enabled,
    createdAt: new Date(0),
    updatedAt: new Date(0),
    ...over,
  }
}

const prefix = (path: string, scope: 'literal' | 'shared' = 'literal'): AuditSelector => ({
  kind: 'prefix',
  path,
  query: { mode: 'any' },
  scope,
})
const exactPath = (path: string): AuditSelector => ({
  kind: 'path',
  path,
  query: { mode: 'any' },
  scope: 'literal',
})
const url = (value: string): AuditSelector => ({ kind: 'url', url: value })

let ids = 0
const context: PlanContext = {
  now: new Date(1),
  newId: () => `new-${++ids}`,
  languages: { prefixes: [], unprefixed: false },
}

/** The nofollow rules the plan writes, by selector. */
function written(rows: AuditRuleRow[], from = 2) {
  const plan = planUpgradeSemantics(rows, context, from)
  if (!plan.ok) throw new Error('plan refused')
  return {
    plan,
    inserted: plan.changes.flatMap((change) =>
      change.op === 'insert' ? [`${change.row.selector} ${change.row.value}`] : [],
    ),
    deleted: plan.changes.flatMap((change) => (change.op === 'delete' ? [change.id] : [])),
    patched: plan.changes.flatMap((change) => (change.op === 'update' ? [change.id] : [])),
  }
}

describe('moving the rules from accepting nofollow to conditions', () => {
  it('writes the condition where it was accepted, and refused only where a rule under it needs to say so', () => {
    const accepting = row(prefix('/cart'), { acceptNofollow: true })
    const inside = row(prefix('/cart/help'))
    const apart = row(prefix('/blog'))
    const above = row(prefix('/'))
    const { inserted, patched } = written([accepting, inside, apart, above])
    expect(inserted.sort()).toEqual(['/cart allowed', '/cart/help forbidden'])
    // The rule that accepted keeps its expectation and loses only the retired flag.
    expect(patched).toEqual([accepting.id])
  })

  it('reaches what a more specific exact path or URL under an accepting rule decides', () => {
    const accepting = row(prefix('/shop'), { acceptNofollow: true })
    const exact = row(exactPath('/shop/a'))
    const one = row(url('https://acme.com/shop/b'))
    const elsewhere = row(url('https://acme.com/about'))
    const { inserted } = written([accepting, exact, one, elsewhere])
    expect(inserted.sort()).toEqual([
      '/shop allowed',
      '/shop/a forbidden',
      'https://acme.com/shop/b forbidden',
    ])
  })

  it('cannot tell where a shared rule lands, so it writes the refusal for every rule it could win over', () => {
    const accepting = row(prefix('/cart', 'shared'), { acceptNofollow: true })
    const literal = row(prefix('/es/other'))
    const { inserted } = written([accepting, literal])
    expect(inserted).toEqual(expect.arrayContaining(['/cart allowed', '/es/other forbidden']))
  })

  it('does not let an exact URL that accepts win over anything', () => {
    const accepting = row(url('https://acme.com/a'), { acceptNofollow: true })
    const other = row(prefix('/a'))
    expect(written([accepting, other]).inserted).toEqual(['https://acme.com/a allowed'])
  })

  it('does nothing for a domain that never accepted nofollow, and drops an exception that only refused it', () => {
    const plain = row(prefix('/cart'))
    const refusing = row(url('https://acme.com/cart'), { value: 'inherit' })
    const plan = written([plain, refusing])
    expect(plan.inserted).toEqual([])
    expect(plan.deleted).toEqual([refusing.id])
    // From the second semantics the version moves only when a rule did.
    expect(written([plain]).plan.bump).toBe(false)
    expect(written([plain, refusing]).plan.bump).toBe(true)
  })

  it('moves every domain from the first semantics, and deletes what `none` held', () => {
    const none = row(prefix('/blog'), { value: 'none' })
    const plan = written([none], 1)
    expect(plan.deleted).toEqual([none.id])
    expect(plan.plan.bump).toBe(true)
    expect(written([], 1).plan.bump).toBe(true)
  })

  it('keeps a rule that is switched off off, and does not write over a condition that is already there', () => {
    const off = row(prefix('/cart'), { acceptNofollow: true, enabled: false })
    const [change] = written([off]).plan.changes.filter((c) => c.op === 'insert')
    expect(change).toMatchObject({ row: { value: 'allowed', enabled: false, activeKey: null } })
    const accepting = row(prefix('/cart'), { acceptNofollow: true })
    const theirs = row(prefix('/cart'), { dimension: 'nofollow', value: 'forbidden' })
    expect(written([accepting, theirs]).inserted).toEqual([])
  })

  it('is what the rules look like afterwards: nothing left to move', () => {
    const accepting = row(prefix('/cart'), { acceptNofollow: true })
    const rows = [accepting, row(prefix('/cart/help'))]
    const first = written(rows)
    const after = rows.map((r) => (r === accepting ? { ...r, acceptNofollow: false } : r))
    expect(first.patched).toEqual([accepting.id])
    expect(written(after).plan.changes).toEqual([])
  })
})

describe('moving the rules to the meaning that reads relations', () => {
  const rows = (dimension: AuditRuleRow['dimension'], value: string, over = {}) =>
    row(prefix('/es'), { dimension, value, ...over })

  it.each([
    ['intent', 'not-indexable'],
    ['noindex', 'required'],
    ['noindex', 'allowed'],
    ['robots', 'required'],
    ['robots', 'allowed'],
  ] as const)(
    'moves the version for a %s rule that is %s, and writes nothing',
    (dimension, value) => {
      const plan = written([rows(dimension, value)], 3)
      expect(plan.plan.changes).toEqual([])
      expect(plan.plan.bump).toBe(true)
    },
  )

  it.each([
    ['intent', 'indexable'],
    ['audit', 'exclude'],
    ['noindex', 'forbidden'],
    ['robots', 'forbidden'],
    ['nofollow', 'allowed'],
    ['sitemap', 'required'],
  ] as const)(
    'does not move it for a %s rule that is %s: it is read the same',
    (dimension, value) => {
      expect(written([rows(dimension, value)], 3).plan.bump).toBe(false)
    },
  )

  it('does not count a rule that is switched off', () => {
    expect(written([rows('noindex', 'allowed', { enabled: false })], 3).plan.bump).toBe(false)
  })

  it('moves a domain with no rules only from the first meaning', () => {
    expect(written([], 3).plan.bump).toBe(false)
    expect(written([], 2).plan.bump).toBe(false)
    expect(written([], 1).plan.bump).toBe(true)
  })

  it('moves, from 4, a domain whose rules the origin-only meaning reads another way', () => {
    expect(written([rows('noindex', 'allowed')], 4).plan.bump).toBe(true)
    expect(written([rows('intent', 'not-indexable')], 4).plan.bump).toBe(true)
    expect(written([rows('noindex', 'forbidden')], 4).plan.bump).toBe(false)
    expect(written([], 4).plan.bump).toBe(false)
  })

  it('finds nothing to change once it is at the current meaning', () => {
    expect(written([rows('noindex', 'allowed')], 5).plan.bump).toBe(false)
  })
})

describe('rule path limits', () => {
  const base = {
    domainId: 'd1',
    statements: { audit: 'exclude' as const },
    reason: null,
    enabled: true,
  }
  it('accepts 20 distinct path selectors and rejects 21, zero, duplicates and grouped URLs', () => {
    const selectors = Array.from({ length: 20 }, (_, i) => prefix(`/p${i}`))
    const allowed = planSaveRuleSet([], { ...base, selectors }, context)
    expect(allowed.ok && allowed.changes).toHaveLength(20)
    expect(
      planSaveRuleSet([], { ...base, selectors: [...selectors, prefix('/extra')] }, context),
    ).toEqual({ ok: false, error: 'limit' })
    expect(planSaveRuleSet([], { ...base, selectors: [] }, context)).toEqual({
      ok: false,
      error: 'limit',
    })
    expect(
      planSaveRuleSet([], { ...base, selectors: [prefix('/a'), prefix('/a')] }, context),
    ).toEqual({ ok: false, error: 'conflict' })
    expect(
      planSaveRuleSet(
        [],
        { ...base, selectors: [prefix('/a'), url('https://example.com/b')] },
        context,
      ),
    ).toEqual({ ok: false, error: 'limit' })
  })
})

it('advances the decision timestamp on a note edit even within the same millisecond', () => {
  const now = new Date('2026-11-12T00:00:00Z')
  const current = {
    id: 'd',
    domainId: 'domain',
    issue: 'title-missing',
    urlHash: null,
    targetKey: '*',
    state: 'dismissed' as const,
    note: 'Alice note',
    setBy: 'alice',
    setAt: now,
  }
  const result = planFindingStates(
    [current],
    {
      domainId: 'domain',
      issue: current.issue,
      urlHashes: [null],
      state: 'dismissed',
      note: 'Bob note',
      setBy: 'bob',
    },
    { now, newId: () => 'unused', languages: { prefixes: [], unprefixed: false } },
  )
  expect(result.ok && result.states?.[0]?.setAt.getTime()).toBe(now.getTime() + 1)
  expect(result.ok && result.bump).toBe(false)
})
