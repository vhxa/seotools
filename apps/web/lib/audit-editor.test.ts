import type { AuditRule, AuditSelector } from '@seotools/core/crawl/audit'
import { AUDIT_RULE_TEMPLATES } from '@seotools/core/crawl/audit-templates'
import { describe, expect, it } from 'vitest'
import {
  applyTemplate,
  controlState,
  inheritedOfRule,
  inheritedOfUrl,
  mergeInherited,
  picksOf,
  picksOfRule,
  picksOfUrl,
  requirementView,
  resetPick,
  summaryLine,
  summaryParts,
  urlRequest,
  type StatementPicks,
} from './audit-editor'
import { currentAuditOf, groupRules } from './audit-rules'

const HOST = 'acme.com'
const NONE = { prefixes: [], unprefixed: false }
const prefix = (path: string, scope: 'literal' | 'shared' = 'literal'): AuditSelector => ({
  kind: 'prefix',
  path,
  scope,
  query: { mode: 'any' },
})
const rule = (
  id: string,
  selector: AuditSelector,
  dimension: 'noindex' | 'sitemap' | 'audit' | 'intent',
  value: string,
  set: string | null = null,
) => ({ id, selector, dimension, value, enabled: true, reason: null, set }) as unknown as AuditRule

describe('what a rule inherits', () => {
  it('is the default when no other rule says anything, and the default only has a position for some', () => {
    const inherited = inheritedOfRule({
      selectors: [prefix('/cart')],
      ids: [],
      rules: [],
      host: HOST,
      languages: NONE,
    })
    expect(inherited.conditions.noindex).toEqual({
      position: 'forbidden',
      origin: { kind: 'default' },
    })
    // Their default raises no finding of its own or a low one: nothing to highlight.
    for (const condition of ['sitemap', 'canonical', 'unlinked'] as const) {
      expect(inherited.conditions[condition].position).toBeNull()
    }
    expect(inherited.audit.position).toBe('include')
    expect(inherited.intent.position).toBe('indexable')
  })

  it('names the rule it comes from, and ignores the rows of the rule being edited', () => {
    const rules = [
      rule('broad', prefix('/'), 'noindex', 'required'),
      rule('mine', prefix('/cart'), 'noindex', 'forbidden'),
    ]
    const inherited = inheritedOfRule({
      selectors: [prefix('/cart')],
      ids: ['mine'],
      rules,
      host: HOST,
      languages: NONE,
    })
    expect(inherited.conditions.noindex.position).toBe('required')
    expect(inherited.conditions.noindex.origin).toMatchObject({
      kind: 'rules',
      selectors: [prefix('/')],
    })
  })

  it('says it varies by path when the paths of a rule disagree, and lists them', () => {
    const rules = [rule('b', prefix('/b'), 'noindex', 'required')]
    const inherited = inheritedOfRule({
      selectors: [prefix('/a'), prefix('/b')],
      ids: [],
      rules,
      host: HOST,
      languages: NONE,
    })
    const { origin } = inherited.conditions.noindex
    expect(origin.kind).toBe('varies')
    if (origin.kind !== 'varies') return
    expect(origin.paths.map((path) => path.position)).toEqual(['forbidden', 'required'])
    // What does not differ stays one thing.
    expect(inherited.audit.origin).toEqual({ kind: 'default' })
  })

  it('merges equal answers into one, and lists the rules they come from once', () => {
    const origin = (key: string) => ({ kind: 'rule' as const, key, selector: prefix(`/${key}`) })
    const merged = mergeInherited([
      { selector: prefix('/a'), position: 'required', origin: origin('x') },
      { selector: prefix('/b'), position: 'required', origin: origin('x') },
    ])
    expect(merged).toEqual({
      position: 'required',
      origin: { kind: 'rules', selectors: [prefix('/x')] },
    })
    // The same position from a rule on one path and the default on the other is not one origin.
    const mixed = mergeInherited([
      { selector: prefix('/a'), position: 'forbidden', origin: { kind: 'default' } },
      { selector: prefix('/b'), position: 'forbidden', origin: origin('x') },
    ])
    expect(mixed.origin.kind).toBe('varies')
  })

  it('shows what the rules give a URL once its exception goes', () => {
    const rules = [
      rule('r1', prefix('/'), 'noindex', 'required'),
      {
        ...rule('e1', { kind: 'url', url: 'https://acme.com/cart' }, 'noindex', 'allowed'),
      } as AuditRule,
    ]
    const current = currentAuditOf({ rules, languages: NONE }, HOST, 'https://acme.com/cart')
    const inherited = inheritedOfUrl(current)
    expect(inherited.conditions.noindex.position).toBe('required')
    expect(inherited.conditions.noindex.origin).toMatchObject({ kind: 'rules' })
    expect(inherited.conditions.sitemap).toEqual({ position: null, origin: { kind: 'default' } })
    expect(picksOfUrl(current).conditions.noindex).toBe('allowed')
    expect(picksOfUrl(current).conditions.sitemap).toBe('inherit')
  })
})

describe('the state of a control', () => {
  const inherited = { position: 'forbidden' as const, origin: { kind: 'default' as const } }

  it('shows what applies, muted, while it is not stated', () => {
    expect(controlState('inherit', 'single', inherited)).toEqual({
      kind: 'inherited',
      position: 'forbidden',
      origin: { kind: 'default' },
    })
  })
  it('is solid once a position is stated, and goes back to inherited', () => {
    expect(controlState('required', 'single', inherited)).toEqual({
      kind: 'stated',
      value: 'required',
    })
    expect(resetPick('single')).toBe('inherit')
  })
  it('keeps "no change" apart from "back to inherited" for several URLs', () => {
    expect(controlState('keep', 'bulk', inherited)).toEqual({ kind: 'nochange' })
    expect(controlState('inherit', 'bulk', inherited)).toEqual({ kind: 'removed' })
    expect(resetPick('bulk')).toBe('keep')
  })
})

describe('a condition as two buttons and "don\'t warn either way"', () => {
  const inherited = (position: 'required' | 'allowed' | 'forbidden' | null) => ({
    position,
    origin: { kind: 'default' as const },
  })
  const view = (
    pick: Parameters<typeof controlState<'required' | 'allowed' | 'forbidden'>>[0],
    position = null as 'required' | 'allowed' | 'forbidden' | null,
    mode: 'single' | 'bulk' = 'single',
  ) => requirementView(controlState(pick, mode, inherited(position)))

  it('is solid on the button that was stated, with the checkbox off', () => {
    expect(view('required')).toEqual({
      button: 'required',
      mutedButton: null,
      allowed: false,
      mutedAllowed: false,
    })
    expect(view('forbidden').button).toBe('forbidden')
  })
  it('states `allowed` with the checkbox and leaves both buttons unselected', () => {
    expect(view('allowed')).toEqual({
      button: null,
      mutedButton: null,
      allowed: true,
      mutedAllowed: false,
    })
  })
  it('shows what applies without a statement: a muted button, or a muted checkbox', () => {
    expect(view('inherit', 'forbidden')).toMatchObject({ mutedButton: 'forbidden', allowed: false })
    expect(view('inherit', 'allowed')).toMatchObject({
      mutedAllowed: true,
      mutedButton: null,
      allowed: false,
    })
  })
  it('highlights nothing when the default matches none of them', () => {
    expect(view('inherit', null)).toEqual({
      button: null,
      mutedButton: null,
      allowed: false,
      mutedAllowed: false,
    })
  })
  it('shows nothing for several URLs at "No change" or "Follow the rules"', () => {
    const nothing = { button: null, mutedButton: null, allowed: false, mutedAllowed: false }
    expect(view('keep', 'forbidden', 'bulk')).toEqual(nothing)
    expect(view('inherit', 'forbidden', 'bulk')).toEqual(nothing)
  })
  it('sends the stored value for the checkbox, and nothing for a control left alone', () => {
    const initial = picksOf('keep')
    const picks = { ...initial, conditions: { ...initial.conditions, noindex: 'allowed' as const } }
    expect(
      urlRequest({
        urls: ['https://acme.com/a', 'https://acme.com/b'],
        picks,
        initial,
        multiple: true,
        reason: '',
        reasonTouched: false,
      }).body,
    ).toEqual({
      urls: ['https://acme.com/a', 'https://acme.com/b'],
      conditions: { noindex: 'allowed' },
    })
  })
})

describe('templates', () => {
  const template = (id: string) => AUDIT_RULE_TEMPLATES.find((item) => item.id === id)

  it('fills the statements the template makes and leaves the rest unstated', () => {
    const picks = applyTemplate(template('private-area') ?? null)
    expect(picks.intent).toBe('not-indexable')
    expect(picks.conditions).toMatchObject({
      noindex: 'allowed',
      nofollow: 'allowed',
      robots: 'allowed',
      sitemap: 'forbidden',
      canonical: 'inherit',
      unlinked: 'inherit',
    })
    expect(picks.audit).toBe('inherit')
  })
  it('can leave a page out of the audit', () => {
    const picks = applyTemplate(template('leave-out') ?? null)
    expect(picks.audit).toBe('exclude')
    expect(picks.intent).toBe('inherit')
  })
  it('only fills statements: where a rule applies (the languages included) is not its business', () => {
    expect(Object.keys(applyTemplate(template('private-area') ?? null)).sort()).toEqual([
      'audit',
      'conditions',
      'intent',
    ])
  })
  it('clearing it leaves nothing stated, and each template replaces the last', () => {
    expect(applyTemplate(null)).toEqual(picksOf('inherit'))
    const second = applyTemplate(template('campaign-landing') ?? null)
    expect(second.intent).toBe('inherit')
    expect(second.conditions.sitemap).toBe('allowed')
    expect(second.conditions.noindex).toBe('inherit')
  })
  it.each(AUDIT_RULE_TEMPLATES.map((item) => [item.id, item] as const))(
    '%s states something',
    (_id, item) => {
      expect(applyTemplate(item)).not.toEqual(picksOf('inherit'))
    },
  )
})

describe('what an exception sends', () => {
  const urls = ['https://acme.com/a', 'https://acme.com/b']
  const base = { urls, reason: '', reasonTouched: false }
  const touch = (
    changes: Partial<StatementPicks['conditions']>,
    rest?: Partial<StatementPicks>,
  ) => ({
    ...picksOf('keep'),
    ...rest,
    conditions: { ...picksOf('keep').conditions, ...changes },
  })

  it('sends nothing for several URLs when nothing was touched ("No change")', () => {
    const initial = picksOf('keep')
    const { body, any } = urlRequest({ ...base, picks: initial, initial, multiple: true })
    expect(any).toBe(false)
    expect(body).toEqual({ urls })
  })
  it('sends only the statements the user touched', () => {
    const initial = picksOf('keep')
    const { body, any } = urlRequest({
      ...base,
      picks: touch({ sitemap: 'allowed' }, { intent: 'not-indexable' }),
      initial,
      multiple: true,
    })
    expect(any).toBe(true)
    expect(body).toEqual({ urls, intent: 'not-indexable', conditions: { sitemap: 'allowed' } })
  })
  it('sends "back to inherited" (inherit) apart from "no change" (nothing)', () => {
    const initial = picksOf('keep')
    const { body } = urlRequest({
      ...base,
      picks: touch({ noindex: 'inherit' }),
      initial,
      multiple: true,
    })
    expect(body).toEqual({ urls, conditions: { noindex: 'inherit' } })
  })
  it('sends nothing for one URL that was not changed, and what changed otherwise', () => {
    const initial = { ...picksOf('inherit') }
    expect(
      urlRequest({
        urls: [urls[0]!],
        reason: '',
        reasonTouched: false,
        picks: initial,
        initial,
        multiple: false,
      }).any,
    ).toBe(false)
    const picks = { ...initial, conditions: { ...initial.conditions, robots: 'allowed' as const } }
    const { body } = urlRequest({
      urls: [urls[0]!],
      reason: 'why',
      reasonTouched: true,
      picks,
      initial,
      multiple: false,
    })
    expect(body).toEqual({
      urls: [urls[0]],
      conditions: { robots: 'allowed' },
      reason: 'why',
    })
  })
  it('re-saves the exceptions a URL has when only the reason changed', () => {
    const initial = {
      ...picksOf('inherit'),
      conditions: { ...picksOf('inherit').conditions, noindex: 'allowed' as const },
    }
    const { body, any } = urlRequest({
      urls: [urls[0]!],
      reason: 'new',
      reasonTouched: true,
      picks: initial,
      initial,
      multiple: false,
    })
    expect(any).toBe(true)
    expect(body.conditions).toEqual({ noindex: 'allowed' })
  })
})

describe('the summary of a rule', () => {
  const words = {
    audit: (value: string) => (value === 'exclude' ? 'left out' : 'audited'),
    intent: (value: string) => (value === 'indexable' ? 'indexable' : 'not indexable'),
    condition: (condition: string, requirement: string) => `${condition} ${requirement}`,
  }
  const group = (rows: AuditRule[]) => groupRules(rows)[0]!

  it('says what the rule states in one line, and nothing of what it leaves out', () => {
    const g = group([
      rule('1', prefix('/a'), 'intent', 'not-indexable'),
      rule('2', prefix('/a'), 'noindex', 'allowed'),
      rule('3', prefix('/a'), 'sitemap', 'forbidden'),
    ])
    expect(summaryLine(summaryParts(g), words)).toBe(
      'not indexable · noindex allowed · sitemap forbidden',
    )
    expect(picksOfRule(g).conditions.robots).toBe('inherit')
  })
  it('puts the audit last', () => {
    const g = group([rule('1', prefix('/a'), 'audit', 'exclude')])
    expect(summaryLine(summaryParts(g), words)).toBe('left out')
  })
})
