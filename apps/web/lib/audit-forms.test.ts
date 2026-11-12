import { AUDIT_DIMENSIONS, AUDIT_LIMITS } from '@seotools/core'
import { describe, expect, it } from 'vitest'
import {
  isRuleId,
  parseLanguagesForm,
  parseRuleForm,
  parseRuleIds,
  parseRuleInput,
  parseUrlConfig,
} from './audit-forms'

const HOST = 'acme.com'

const input = (overrides: Partial<Parameters<typeof parseRuleInput>[0]> = {}) => ({
  kind: 'prefix',
  selector: '/cart',
  query: 'any',
  queryValue: '',
  audit: 'exclude',
  reason: 'The cart',
  enabled: true,
  ...overrides,
})

const form = (fields: Record<string, string>) => {
  const data = new FormData()
  for (const [key, value] of Object.entries(fields)) data.set(key, value)
  return data
}

describe('parseRuleInput', () => {
  it('turns what was typed into a rule that says what it was told to', () => {
    expect(parseRuleInput(input(), HOST)).toEqual({
      ok: true,
      statements: { audit: 'exclude' },
      selector: { kind: 'prefix', path: '/cart', query: { mode: 'any' }, scope: 'literal' },
      reason: 'The cart',
      enabled: true,
    })
  })

  it('reads every statement a rule can make, each on its own', () => {
    expect(
      parseRuleInput(
        input({
          audit: 'include',
          intent: 'not-indexable',
          noindex: 'required',
          nofollow: 'allowed',
          robots: 'forbidden',
          sitemap: 'required',
        }),
        HOST,
      ),
    ).toMatchObject({
      ok: true,
      statements: {
        audit: 'include',
        intent: 'not-indexable',
        conditions: {
          noindex: 'required',
          nofollow: 'allowed',
          robots: 'forbidden',
          sitemap: 'required',
        },
      },
    })
    // What is left empty or out is not said.
    const parsed = parseRuleInput(input({ audit: '', noindex: 'allowed', nofollow: '' }), HOST)
    expect(parsed).toMatchObject({ ok: true, statements: { conditions: { noindex: 'allowed' } } })
    expect(parsed).not.toHaveProperty('statements.audit')
    expect(parsed).not.toHaveProperty('statements.conditions.nofollow')
  })

  it('takes the values each statement has and no others', () => {
    for (const [name, value] of [
      ['audit', 'indexable'],
      ['audit', 'required'],
      ['intent', 'exclude'],
      ['intent', 'none'],
      ['intent', 'inherit'],
      ['noindex', 'exclude'],
      ['noindex', 'indexable'],
      ['sitemap', 'maybe'],
      ['robots', 5],
    ] as const) {
      expect(parseRuleInput(input({ [name]: value }), HOST), `${name}=${value}`).toEqual({
        ok: false,
        error: 'value',
      })
    }
    expect(parseRuleInput(input({ audit: '', intent: 'indexable' }), HOST)).toMatchObject({
      ok: true,
    })
  })

  it('refuses a rule that says nothing', () => {
    expect(parseRuleInput(input({ audit: '' }), HOST)).toEqual({ ok: false, error: 'statements' })
    expect(parseRuleInput(input({ audit: undefined }), HOST)).toEqual({
      ok: false,
      error: 'statements',
    })
  })

  it('reads a query that is asked for, the empty one included', () => {
    expect(
      parseRuleInput(input({ kind: 'path', query: 'exact', queryValue: '' }), HOST),
    ).toMatchObject({
      ok: true,
      selector: {
        kind: 'path',
        path: '/cart',
        query: { mode: 'exact', value: '' },
        scope: 'literal',
      },
    })
  })

  it('reads where the path is looked for, literal unless asked, and only for paths', () => {
    expect(parseRuleInput(input({ scope: 'shared' }), HOST)).toMatchObject({
      ok: true,
      selector: { kind: 'prefix', path: '/cart', scope: 'shared' },
    })
    expect(parseRuleInput(input({ scope: '' }), HOST)).toMatchObject({
      selector: { scope: 'literal' },
    })
    // An exact URL is always literal, whatever came with it.
    expect(
      parseRuleInput(input({ kind: 'url', selector: '/cart', scope: 'shared' }), HOST),
    ).toEqual(
      expect.objectContaining({
        ok: true,
        selector: { kind: 'url', url: 'https://acme.com/cart' },
      }),
    )
    expect(parseRuleInput(input({ scope: 'translated' }), HOST)).toEqual({
      ok: false,
      error: 'scope',
    })
  })

  it('does not read the retired flag that accepted nofollow', () => {
    const parsed = parseRuleInput(
      { ...input({ intent: 'indexable' }), acceptNofollow: true } as never,
      HOST,
    )
    expect(parsed).toMatchObject({ ok: true })
    expect(JSON.stringify(parsed)).not.toContain('acceptNofollow')
  })

  it('refuses a kind of selector that does not exist, and a regular expression', () => {
    expect(parseRuleInput(input({ kind: 'regex' }), HOST)).toEqual({ ok: false, error: 'kind' })
    expect(parseRuleInput(input({ kind: undefined }), HOST)).toEqual({ ok: false, error: 'kind' })
    expect(parseRuleInput(input({ selector: '/cart/.*' }), HOST)).toMatchObject({
      ok: true,
      selector: { path: '/cart/.*' },
    })
  })

  it('takes a path to be a path, not a pattern', () => {
    for (const bad of ['cart', '/cart?x=1', '/cart#top', '/a\\b', '']) {
      expect(parseRuleInput(input({ selector: bad }), HOST)).toEqual({ ok: false, error: 'path' })
    }
  })

  it('checks the selector against the domain', () => {
    expect(
      parseRuleInput(input({ kind: 'url', selector: 'https://acme.com/a' }), HOST),
    ).toMatchObject({
      ok: true,
    })
    expect(parseRuleInput(input({ kind: 'url', selector: 'https://other.com/a' }), HOST)).toEqual({
      ok: false,
      error: 'external',
    })
    expect(parseRuleInput(input({ kind: 'url', selector: 'javascript:alert(1)' }), HOST)).toEqual({
      ok: false,
      error: 'url',
    })
  })

  it('refuses anything that is not text', () => {
    expect(parseRuleInput(input({ selector: 12 }), HOST)).toEqual({ ok: false, error: 'path' })
    expect(parseRuleInput(input({ kind: 5 }), HOST)).toEqual({ ok: false, error: 'kind' })
  })

  it('keeps a reason within its limit', () => {
    expect(parseRuleInput(input({ reason: 'x'.repeat(AUDIT_LIMITS.reason + 1) }), HOST)).toEqual({
      ok: false,
      error: 'reason',
    })
    expect(parseRuleInput(input({ reason: '   ' }), HOST)).toMatchObject({
      ok: true,
      reason: null,
    })
  })
})

describe('parseRuleForm', () => {
  it('reads the fields of the form, and a switch that is off as off', () => {
    const parsed = parseRuleForm(
      form({ kind: 'url', selector: '/cart', audit: 'include', reason: '', id: ' ' }),
      HOST,
    )
    expect(parsed).toMatchObject({
      ok: true,
      id: null,
      statements: { audit: 'include' },
      enabled: false,
      reason: null,
      selector: { kind: 'url', url: 'https://acme.com/cart' },
    })
    expect(
      parseRuleForm(
        form({ kind: 'url', selector: '/cart', audit: 'include', enabled: 'on', id: 'abc' }),
        HOST,
      ),
    ).toMatchObject({ ok: true, id: 'abc', enabled: true })
  })

  it('reads the scope and every statement of a rule', () => {
    expect(
      parseRuleForm(
        form({
          kind: 'prefix',
          selector: '/account',
          scope: 'shared',
          intent: 'not-indexable',
          noindex: '',
          sitemap: 'forbidden',
        }),
        HOST,
      ),
    ).toMatchObject({
      ok: true,
      statements: { intent: 'not-indexable', conditions: { sitemap: 'forbidden' } },
      selector: { scope: 'shared', path: '/account' },
    })
  })

  it('says why it cannot', () => {
    expect(parseRuleForm(form({}), HOST)).toEqual({ ok: false, error: 'statements' })
    expect(parseRuleForm(form({ audit: 'exclude' }), HOST)).toEqual({ ok: false, error: 'kind' })
  })
})

describe('isRuleId', () => {
  it('only accepts what an id looks like', () => {
    expect(isRuleId('0b3f6b5a-6b0c-4f0b-9a54-2f1f6c0c2f11')).toBe(true)
    expect(isRuleId("x' or '1'='1")).toBe(false)
    expect(isRuleId(undefined)).toBe(false)
    expect(isRuleId(12)).toBe(false)
  })
})

describe('parseUrlConfig', () => {
  const ok = { urls: ['https://acme.com/cart'], audit: 'exclude', reason: ' Cart ' }

  it('normalizes the URLs, once each, and the reason', () => {
    expect(
      parseUrlConfig(
        {
          ...ok,
          urls: ['https://ACME.com/cart#top', 'https://acme.com/cart', 'http://www.acme.com/x'],
        },
        HOST,
      ),
    ).toEqual({
      ok: true,
      urls: ['https://acme.com/cart', 'http://www.acme.com/x'],
      audit: 'exclude',
      reason: 'Cart',
    })
  })

  it('takes any statement, or several, and "according to the rules" for each', () => {
    expect(parseUrlConfig({ urls: ok.urls, intent: 'indexable' }, HOST)).toEqual({
      ok: true,
      urls: ok.urls,
      intent: 'indexable',
    })
    expect(parseUrlConfig({ ...ok, intent: 'inherit', audit: 'inherit' }, HOST)).toMatchObject({
      ok: true,
      audit: 'inherit',
      intent: 'inherit',
    })
    expect(parseUrlConfig({ urls: ok.urls, audit: 'include' }, HOST)).toMatchObject({
      ok: true,
      audit: 'include',
    })
  })

  it('sends only what was asked: a statement that is not named is not in the request', () => {
    const parsed = parseUrlConfig({ urls: ok.urls, audit: 'exclude' }, HOST)
    expect(parsed).toEqual({ ok: true, urls: ok.urls, audit: 'exclude' })
    expect(parsed).not.toHaveProperty('intent')
    expect(parsed).not.toHaveProperty('conditions')
    // …and no reason means that the exceptions keep theirs, which is not the same as clearing it.
    expect(parsed).not.toHaveProperty('reason')
    expect(parseUrlConfig({ ...ok, reason: '' }, HOST)).toMatchObject({ ok: true, reason: null })
  })

  it('takes a condition on its own, or with the others, each required, allowed, forbidden or back to the rules', () => {
    expect(parseUrlConfig({ urls: ok.urls, conditions: { nofollow: 'allowed' } }, HOST)).toEqual({
      ok: true,
      urls: ok.urls,
      conditions: { nofollow: 'allowed' },
    })
    expect(
      parseUrlConfig(
        {
          urls: ok.urls,
          intent: 'not-indexable',
          conditions: { noindex: 'required', robots: 'forbidden', sitemap: 'inherit' },
        },
        HOST,
      ),
    ).toMatchObject({
      ok: true,
      intent: 'not-indexable',
      conditions: { noindex: 'required', robots: 'forbidden', sitemap: 'inherit' },
    })
  })

  it('tells "no change" from "according to the rules": a condition left out is not touched', () => {
    const parsed = parseUrlConfig(
      { urls: ok.urls, conditions: { noindex: 'inherit', nofollow: undefined } },
      HOST,
    )
    expect(parsed).toEqual({ ok: true, urls: ok.urls, conditions: { noindex: 'inherit' } })
    expect(parsed).not.toHaveProperty('conditions.nofollow')
    // Nothing named is nothing asked.
    expect(parseUrlConfig({ urls: ok.urls, conditions: {} }, HOST)).toEqual({
      ok: false,
      error: 'choice',
    })
    expect(parseUrlConfig({ urls: ok.urls, conditions: { nofollow: undefined } }, HOST)).toEqual({
      ok: false,
      error: 'choice',
    })
  })

  it('refuses a condition that does not exist, a value it cannot take, and the retired flag', () => {
    for (const conditions of [
      { cloaking: 'required' },
      { noindex: 'indexable' },
      { noindex: 'exclude' },
      { noindex: true },
      { noindex: null },
      'noindex',
      ['noindex'],
      null,
    ]) {
      expect(parseUrlConfig({ urls: ok.urls, conditions }, HOST)).toEqual({
        ok: false,
        error: 'choice',
      })
    }
    // The flag that accepted nofollow no longer exists: on its own it asks for nothing.
    expect(parseUrlConfig({ urls: ok.urls, acceptNofollow: true }, HOST)).toEqual({
      ok: false,
      error: 'choice',
    })
    const parsed = parseUrlConfig({ ...ok, acceptNofollow: true }, HOST)
    expect(parsed).not.toHaveProperty('acceptNofollow')
  })

  it('does not offer no declared intent as a choice', () => {
    expect(parseUrlConfig({ urls: ok.urls, intent: 'none' }, HOST)).toEqual({
      ok: false,
      error: 'choice',
    })
  })

  it('refuses a request that asks for nothing, or for something that does not exist', () => {
    expect(parseUrlConfig({ urls: ok.urls }, HOST)).toEqual({ ok: false, error: 'choice' })
    expect(parseUrlConfig({ ...ok, audit: 'delete' }, HOST)).toEqual({ ok: false, error: 'choice' })
    // `none` is an intent, not a way to take part in the audit.
    expect(parseUrlConfig({ ...ok, audit: 'none' }, HOST)).toEqual({ ok: false, error: 'choice' })
    expect(parseUrlConfig({ urls: ok.urls, intent: 'exclude' }, HOST)).toEqual({
      ok: false,
      error: 'choice',
    })
  })

  it('refuses the whole request if one URL is not of the domain', () => {
    expect(
      parseUrlConfig({ ...ok, urls: ['https://acme.com/a', 'https://other.com/a'] }, HOST),
    ).toEqual({ ok: false, error: 'external' })
    expect(parseUrlConfig({ ...ok, urls: ['https://blog.acme.com/'] }, HOST)).toEqual({
      ok: false,
      error: 'external',
    })
    expect(parseUrlConfig({ ...ok, urls: ['https://acme.com:8080/'] }, HOST)).toEqual({
      ok: false,
      error: 'external',
    })
  })

  it('refuses what is not a list of URLs, or too many of them', () => {
    for (const urls of [[], 'https://acme.com/', [1], ['javascript:alert(1)'], null, undefined]) {
      expect(parseUrlConfig({ ...ok, urls }, HOST)).toEqual({ ok: false, error: 'urls' })
    }
    const many = Array.from(
      { length: AUDIT_LIMITS.bulkUrls + 1 },
      (_, i) => `https://acme.com/${i}`,
    )
    expect(parseUrlConfig({ ...ok, urls: many }, HOST)).toEqual({ ok: false, error: 'urls' })
    expect(
      parseUrlConfig({ ...ok, urls: many.slice(0, AUDIT_LIMITS.bulkUrls) }, HOST),
    ).toMatchObject({
      ok: true,
    })
    expect(parseUrlConfig(null, HOST)).toEqual({ ok: false, error: 'urls' })
    expect(parseUrlConfig('exclude', HOST)).toEqual({ ok: false, error: 'urls' })
  })

  it('refuses a reason that is too long', () => {
    expect(parseUrlConfig({ ...ok, reason: 'x'.repeat(AUDIT_LIMITS.reason + 1) }, HOST)).toEqual({
      ok: false,
      error: 'reason',
    })
  })
})

describe('parseLanguagesForm', () => {
  it('reads the directories one per line or with commas, normalized and sorted, and the switch', () => {
    expect(
      parseLanguagesForm(form({ prefixes: '/es/\n/en/, ca\n/pt-br', unprefixed: 'on' })),
    ).toEqual({
      ok: true,
      languages: { prefixes: ['/ca', '/en', '/es', '/pt-br'], unprefixed: true },
    })
  })

  it('takes a switch that is off as off, and nothing typed as no directories', () => {
    expect(parseLanguagesForm(form({ prefixes: '' }))).toEqual({
      ok: true,
      languages: { prefixes: [], unprefixed: false },
    })
  })

  it('refuses what is not a directory, and too many of them', () => {
    expect(parseLanguagesForm(form({ prefixes: '/es, /en/us' }))).toEqual({
      ok: false,
      error: 'prefix',
    })
    expect(parseLanguagesForm(form({ prefixes: '?x, #y' }))).toEqual({ ok: false, error: 'prefix' })
    const many = Array.from({ length: 51 }, (_, i) => `l${i}`).join('\n')
    expect(parseLanguagesForm(form({ prefixes: many }))).toEqual({ ok: false, error: 'limit' })
  })
})

describe('parseRuleIds', () => {
  const id = '0b3f6b5a-6b0c-4f0b-9a54-2f1f6c0c2f11'

  it('takes a few ids, once each', () => {
    expect(parseRuleIds([id, id])).toEqual([id])
    expect(parseRuleIds([id, id.replace('0b', '1b')])).toHaveLength(2)
  })

  const ids = (count: number) =>
    Array.from(
      { length: count },
      (_, i) => `00000000-0000-4000-8000-${i.toString(16).padStart(12, '0')}`,
    )

  it('accepts the action input for a two-path rule with five statements', () => {
    const groupIds = ids(2 * 5)
    expect(parseRuleIds(groupIds)).toEqual(groupIds)
  })

  it('accepts every row of a full rule set and rejects one beyond its bound', () => {
    const maxRows = AUDIT_LIMITS.pathsPerRule * AUDIT_DIMENSIONS.length
    expect(parseRuleIds(ids(maxRows))).toEqual(ids(maxRows))
    expect(parseRuleIds(ids(maxRows + 1))).toBeNull()
  })

  it('refuses malformed action input', () => {
    for (const value of [[], 'abc', null, undefined, [1], ["x' or '1'='1"], [id, 'nope']]) {
      expect(parseRuleIds(value)).toBeNull()
    }
  })
})
