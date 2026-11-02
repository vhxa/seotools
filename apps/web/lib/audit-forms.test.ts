import { AUDIT_LIMITS } from '@seotools/core'
import { describe, expect, it } from 'vitest'
import {
  isRuleId,
  parseLanguagesForm,
  parseRuleForm,
  parseRuleInput,
  parseUrlConfig,
} from './audit-forms'

const HOST = 'acme.com'

const input = (overrides: Partial<Parameters<typeof parseRuleInput>[0]> = {}) => ({
  kind: 'prefix',
  selector: '/cart',
  query: 'any',
  queryValue: '',
  value: 'exclude',
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
  it('turns what was typed into a rule', () => {
    expect(parseRuleInput(input(), 'audit', HOST)).toEqual({
      ok: true,
      rule: {
        dimension: 'audit',
        value: 'exclude',
        selector: { kind: 'prefix', path: '/cart', query: { mode: 'any' }, scope: 'literal' },
        reason: 'The cart',
        enabled: true,
      },
    })
  })

  it('reads a query that is asked for, the empty one included', () => {
    expect(
      parseRuleInput(input({ kind: 'path', query: 'exact', queryValue: '' }), 'audit', HOST),
    ).toMatchObject({
      ok: true,
      rule: {
        selector: {
          kind: 'path',
          path: '/cart',
          query: { mode: 'exact', value: '' },
          scope: 'literal',
        },
      },
    })
  })

  it('takes the values of the dimension and no others', () => {
    expect(parseRuleInput(input({ value: 'indexable' }), 'audit', HOST)).toEqual({
      ok: false,
      error: 'value',
    })
    expect(parseRuleInput(input({ value: 'exclude' }), 'intent', HOST)).toEqual({
      ok: false,
      error: 'value',
    })
    expect(parseRuleInput(input({ value: 'not-indexable' }), 'intent', HOST)).toMatchObject({
      ok: true,
    })
    expect(parseRuleInput(input({ value: 'indexable' }), 'intent', HOST)).toMatchObject({
      ok: true,
    })
    expect(parseRuleInput(input({ value: undefined }), 'audit', HOST)).toEqual({
      ok: false,
      error: 'value',
    })
  })

  it('does not offer, for a new configuration, no declared intent', () => {
    expect(parseRuleInput(input({ value: 'none' }), 'intent', HOST)).toEqual({
      ok: false,
      error: 'value',
    })
  })

  it('reads where the path is looked for, literal unless asked, and only for paths', () => {
    expect(parseRuleInput(input({ scope: 'shared' }), 'audit', HOST)).toMatchObject({
      ok: true,
      rule: { selector: { kind: 'prefix', path: '/cart', scope: 'shared' } },
    })
    expect(parseRuleInput(input({ scope: '' }), 'audit', HOST)).toMatchObject({
      rule: { selector: { scope: 'literal' } },
    })
    // An exact URL is always literal, whatever came with it.
    expect(
      parseRuleInput(input({ kind: 'url', selector: '/cart', scope: 'shared' }), 'audit', HOST),
    ).toEqual({
      ok: true,
      rule: expect.objectContaining({ selector: { kind: 'url', url: 'https://acme.com/cart' } }),
    })
    expect(parseRuleInput(input({ scope: 'translated' }), 'audit', HOST)).toEqual({
      ok: false,
      error: 'scope',
    })
  })

  it('accepts nofollow only on an expectation, and not unless asked for', () => {
    expect(parseRuleInput(input({ value: 'indexable' }), 'intent', HOST)).toMatchObject({
      rule: { acceptNofollow: false },
    })
    for (const accept of [true, 'on']) {
      expect(
        parseRuleInput(input({ value: 'not-indexable', acceptNofollow: accept }), 'intent', HOST),
      ).toMatchObject({ rule: { acceptNofollow: true } })
    }
    for (const accept of [false, 'off', 'true', 1, undefined]) {
      expect(
        parseRuleInput(input({ value: 'indexable', acceptNofollow: accept }), 'intent', HOST),
      ).toMatchObject({ rule: { acceptNofollow: false } })
    }
    // An exclusion has nothing to accept.
    expect(
      parseRuleInput(input({ value: 'exclude', acceptNofollow: true }), 'audit', HOST),
    ).not.toHaveProperty('rule.acceptNofollow')
  })

  it('refuses a dimension that does not exist', () => {
    expect(parseRuleInput(input(), 'seo' as 'audit', HOST)).toEqual({
      ok: false,
      error: 'dimension',
    })
  })

  it('refuses a kind of selector that does not exist, and a regular expression', () => {
    expect(parseRuleInput(input({ kind: 'regex', selector: '^/cart.*' }), 'audit', HOST)).toEqual({
      ok: false,
      error: 'kind',
    })
    expect(parseRuleInput(input({ kind: undefined }), 'audit', HOST)).toEqual({
      ok: false,
      error: 'kind',
    })
  })

  it('takes a path to be a path, not a pattern', () => {
    expect(parseRuleInput(input({ selector: '/cart/*' }), 'audit', HOST)).toMatchObject({
      ok: true,
      rule: { selector: { path: '/cart/*' } },
    })
    // …which will only ever match a path that has an asterisk.
  })

  it('checks the selector against the domain', () => {
    expect(
      parseRuleInput(input({ kind: 'url', selector: 'https://other.com/' }), 'audit', HOST),
    ).toEqual({
      ok: false,
      error: 'external',
    })
    expect(parseRuleInput(input({ selector: 'cart' }), 'audit', HOST)).toEqual({
      ok: false,
      error: 'path',
    })
    expect(
      parseRuleInput(input({ kind: 'path', query: 'exact', queryValue: 'a#b' }), 'audit', HOST),
    ).toEqual({ ok: false, error: 'query' })
  })

  it('refuses anything that is not text', () => {
    expect(parseRuleInput(input({ selector: { $ne: 1 } }), 'audit', HOST)).toEqual({
      ok: false,
      error: 'path',
    })
    expect(parseRuleInput(input({ kind: 'url', selector: 42 }), 'audit', HOST)).toEqual({
      ok: false,
      error: 'url',
    })
  })

  it('keeps a reason within its limit', () => {
    expect(parseRuleInput(input({ reason: '   ' }), 'audit', HOST)).toMatchObject({
      ok: true,
      rule: { reason: null },
    })
    expect(
      parseRuleInput(input({ reason: 'x'.repeat(AUDIT_LIMITS.reason + 1) }), 'audit', HOST),
    ).toEqual({ ok: false, error: 'reason' })
  })
})

describe('parseRuleForm', () => {
  it('reads the fields of the form, and a switch that is off as off', () => {
    const parsed = parseRuleForm(
      form({ kind: 'url', selector: '/cart', value: 'include', reason: '', id: ' ' }),
      'audit',
      HOST,
    )
    expect(parsed).toMatchObject({
      ok: true,
      id: null,
      rule: {
        value: 'include',
        enabled: false,
        reason: null,
        selector: { kind: 'url', url: 'https://acme.com/cart' },
      },
    })
    expect(
      parseRuleForm(
        form({ kind: 'url', selector: '/cart', value: 'include', enabled: 'on', id: 'abc' }),
        'audit',
        HOST,
      ),
    ).toMatchObject({ ok: true, id: 'abc', rule: { enabled: true } })
  })

  it('reads the scope and the acceptance of nofollow of an expectation', () => {
    const parsed = parseRuleForm(
      form({
        kind: 'prefix',
        selector: '/account',
        scope: 'shared',
        value: 'not-indexable',
        acceptNofollow: 'on',
      }),
      'intent',
      HOST,
    )
    expect(parsed).toMatchObject({
      ok: true,
      rule: {
        value: 'not-indexable',
        acceptNofollow: true,
        selector: { scope: 'shared', path: '/account' },
      },
    })
  })

  it('says why it cannot', () => {
    expect(parseRuleForm(form({}), 'audit', HOST)).toEqual({ ok: false, error: 'value' })
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

  it('takes either dimension, or both, and "according to the rules" for each', () => {
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

  it('sends only what was asked: a dimension that is not named is not in the request', () => {
    const parsed = parseUrlConfig({ urls: ok.urls, audit: 'exclude' }, HOST)
    expect(parsed).toEqual({ ok: true, urls: ok.urls, audit: 'exclude' })
    expect(parsed).not.toHaveProperty('intent')
    expect(parsed).not.toHaveProperty('acceptNofollow')
    // …and no reason means that the exceptions keep theirs, which is not the same as clearing it.
    expect(parsed).not.toHaveProperty('reason')
    expect(parseUrlConfig({ ...ok, reason: '' }, HOST)).toMatchObject({ ok: true, reason: null })
  })

  it('takes the acceptance of nofollow on its own, or with an expectation', () => {
    expect(parseUrlConfig({ urls: ok.urls, acceptNofollow: true }, HOST)).toEqual({
      ok: true,
      urls: ok.urls,
      acceptNofollow: true,
    })
    expect(
      parseUrlConfig({ urls: ok.urls, intent: 'not-indexable', acceptNofollow: false }, HOST),
    ).toMatchObject({ ok: true, intent: 'not-indexable', acceptNofollow: false })
  })

  it('does not take an acceptance of nofollow to go with going back to the rules', () => {
    expect(
      parseUrlConfig({ urls: ok.urls, intent: 'inherit', acceptNofollow: true }, HOST),
    ).toEqual({
      ok: false,
      error: 'choice',
    })
    expect(parseUrlConfig({ urls: ok.urls, acceptNofollow: 'yes' }, HOST)).toEqual({
      ok: false,
      error: 'choice',
    })
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
