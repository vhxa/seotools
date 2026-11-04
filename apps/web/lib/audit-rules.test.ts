import { AUDIT_CONDITIONS, type AuditCondition, type NewAuditRule } from '@seotools/core'
import { createCompany } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  conditionsOf,
  currentAuditOf,
  explicitRulesOf,
  groupRules,
  outcomeAfter,
  type AuditOutcome,
  type AuditPicks,
} from './audit-rules'

const HOST = 'acme.com'
const URL_A = 'https://acme.com/cart/items'
const NO_LANGUAGES = { prefixes: [], unprefixed: false }

let db: Database
let domainId: string

beforeEach(async () => {
  db = await createTestDatabase()
  const created = await createCompany(db, { name: 'Acme', domain: HOST })
  if (!created.ok) throw new Error('setup failed')
  domainId = created.domain.id
})
afterEach(async () => {
  await db.close()
})

const prefix = (path: string) =>
  ({ kind: 'prefix', path, query: { mode: 'any' }, scope: 'literal' }) as const

const audit = (selector: NewAuditRule['selector'], value: 'exclude' | 'include', enabled = true) =>
  ({ dimension: 'audit', value, selector, reason: null, enabled }) as NewAuditRule

const intent = (selector: NewAuditRule['selector'], value: 'indexable' | 'not-indexable') =>
  ({ dimension: 'intent', value, selector, reason: null, enabled: true }) as NewAuditRule

const condition = (
  selector: NewAuditRule['selector'],
  dimension: AuditCondition,
  value: 'required' | 'allowed' | 'forbidden',
  enabled = true,
) => ({ dimension, value, selector, reason: null, enabled }) as NewAuditRule

const config = async () => {
  const { rules, languages } = await db.audit.config(domainId)
  return { rules, languages }
}

describe('the exceptions a URL has', () => {
  it('leaves out the ones that are switched off, since they do not act', async () => {
    await db.audit.saveRule({
      domainId,
      rule: audit({ kind: 'url', url: URL_A }, 'exclude', false),
    })
    await db.audit.saveRule({
      domainId,
      rule: condition({ kind: 'url', url: URL_A }, 'noindex', 'required', false),
    })
    const { rules } = await config()
    expect(explicitRulesOf(rules, URL_A).audit).toBeNull()
    expect(explicitRulesOf(rules, URL_A).conditions.noindex).toBeNull()
    const current = currentAuditOf(await config(), HOST, URL_A)
    expect(current.explicit.audit).toBeNull()
    expect(current.explicit.conditions.noindex).toBeNull()
    expect(current.audit).toEqual({ value: 'audited', rule: null })
  })

  it('tells what the rules give once the exceptions of the URL are set aside', async () => {
    await db.audit.saveRule({ domainId, rule: audit(prefix('/cart'), 'exclude') })
    await db.audit.saveRule({ domainId, rule: audit({ kind: 'url', url: URL_A }, 'include') })
    const current = currentAuditOf(await config(), HOST, URL_A)
    expect(current.explicit.audit).toBe('include')
    expect(current.audit).toEqual({ value: 'audited', rule: { exception: true } })
    expect(current.underRules.audit).toEqual({
      value: 'excluded',
      rule: { exception: false, selector: prefix('/cart') },
    })
  })

  it('tells each condition apart, with the rule or exception it comes from', async () => {
    await db.audit.saveRule({ domainId, rule: condition(prefix('/cart'), 'sitemap', 'required') })
    await db.audit.saveRule({ domainId, rule: condition(prefix('/cart'), 'noindex', 'allowed') })
    await db.audit.setUrlConfig({
      domainId,
      host: HOST,
      urls: [URL_A],
      conditions: { noindex: 'forbidden' },
    })
    const current = currentAuditOf(await config(), HOST, URL_A)
    expect(current.explicit.conditions).toEqual({
      noindex: 'forbidden',
      nofollow: null,
      robots: null,
      sitemap: null,
    })
    expect(current.conditions.noindex).toEqual({
      requirement: 'forbidden',
      rule: { exception: true },
    })
    expect(current.conditions.sitemap).toEqual({
      requirement: 'required',
      rule: { exception: false, selector: prefix('/cart') },
    })
    expect(current.conditions.nofollow).toEqual({ requirement: null, rule: null })
    // Without its own exception the noindex is what the rule says.
    expect(current.underRules.conditions.noindex.requirement).toBe('allowed')
  })

  it('does not take the expectation from a condition, or the other way round', async () => {
    await db.audit.saveRule({ domainId, rule: intent(prefix('/cart'), 'not-indexable') })
    await db.audit.setUrlConfig({
      domainId,
      host: HOST,
      urls: [URL_A],
      conditions: { nofollow: 'allowed' },
    })
    const current = currentAuditOf(await config(), HOST, URL_A)
    expect(current.explicit.intent).toBeNull()
    expect(current.intent).toMatchObject({ value: 'not-indexable', rule: { exception: false } })
    expect(current.conditions.nofollow).toMatchObject({ requirement: 'allowed' })
  })
})

const picks = (
  overrides: Omit<Partial<AuditPicks>, 'conditions'> & {
    conditions?: Partial<AuditPicks['conditions']>
  } = {},
): AuditPicks => ({
  audit: 'rules',
  intent: 'rules',
  ...overrides,
  conditions: {
    noindex: 'rules',
    nofollow: 'rules',
    robots: 'rules',
    sitemap: 'rules',
    ...overrides.conditions,
  },
})

describe('what a URL will be after saving', () => {
  it('shows what the rules give when it goes back to them, not the exception that goes', async () => {
    await db.audit.saveRule({ domainId, rule: audit(prefix('/cart'), 'exclude') })
    await db.audit.saveRule({ domainId, rule: audit({ kind: 'url', url: URL_A }, 'include') })
    const current = currentAuditOf(await config(), HOST, URL_A)
    expect(outcomeAfter(current, picks({ audit: 'rules' })).audit.value).toBe('excluded')
    expect(outcomeAfter(current, picks({ audit: 'include' })).audit.rule).toEqual({
      exception: true,
    })
  })

  it('keeps each condition apart from the expectation and from the other conditions', async () => {
    await db.audit.saveRule({ domainId, rule: intent(prefix('/cart'), 'not-indexable') })
    await db.audit.saveRule({ domainId, rule: condition(prefix('/cart'), 'robots', 'required') })
    const current = currentAuditOf(await config(), HOST, URL_A)
    const after = outcomeAfter(current, picks({ conditions: { nofollow: 'allowed' } }))
    // The expectation and the other conditions are still the rules'; only nofollow is the exception's.
    expect(after.intent).toMatchObject({ value: 'not-indexable', rule: { exception: false } })
    expect(after.conditions.robots).toMatchObject({
      requirement: 'required',
      rule: { exception: false },
    })
    expect(after.conditions.nofollow).toEqual({ requirement: 'allowed', rule: { exception: true } })
    // Going back to the rules for it gives what they give: nothing, here.
    expect(outcomeAfter(current, picks()).conditions.nofollow).toEqual(
      current.underRules.conditions.nofollow,
    )
  })

  describe('agrees with what saving does', () => {
    const setups: { name: string; rules: NewAuditRule[] }[] = [
      { name: 'no rules', rules: [] },
      {
        name: 'broader rules that state nothing about conditions',
        rules: [audit(prefix('/cart'), 'exclude'), intent(prefix('/cart'), 'not-indexable')],
      },
      {
        name: 'broader rules that state every condition',
        rules: [
          audit(prefix('/cart'), 'include'),
          intent(prefix('/cart'), 'indexable'),
          ...AUDIT_CONDITIONS.map((name) => condition(prefix('/cart'), name, 'required')),
        ],
      },
      {
        name: 'exceptions already set',
        rules: [
          audit({ kind: 'url', url: URL_A }, 'exclude'),
          intent({ kind: 'url', url: URL_A }, 'not-indexable'),
          condition({ kind: 'url', url: URL_A }, 'noindex', 'forbidden'),
          condition({ kind: 'url', url: URL_A }, 'sitemap', 'allowed'),
          condition(prefix('/cart'), 'sitemap', 'required'),
          condition(prefix('/cart'), 'robots', 'allowed'),
        ],
      },
    ]
    // Every choice for the audit and the expectation, and a few for the conditions, one at a time.
    const all: AuditPicks[] = []
    for (const a of ['rules', 'exclude', 'include'] as const)
      for (const i of ['rules', 'indexable', 'not-indexable'] as const)
        all.push(picks({ audit: a, intent: i }))
    for (const name of AUDIT_CONDITIONS)
      for (const value of ['rules', 'required', 'allowed', 'forbidden'] as const)
        all.push(picks({ conditions: { [name]: value } }))
    all.push(
      picks({
        audit: 'exclude',
        conditions: {
          noindex: 'required',
          nofollow: 'forbidden',
          robots: 'allowed',
          sitemap: 'rules',
        },
      }),
    )

    const shape = (outcome: AuditOutcome) => JSON.stringify(outcome)

    for (const { name, rules } of setups) {
      it(`with ${name}`, async () => {
        for (const rule of rules) await db.audit.saveRule({ domainId, rule })
        const before = currentAuditOf(await config(), HOST, URL_A)
        const saved = await config()
        for (const pick of all) {
          // Save the picks the way the dialog sends them, over the same starting point.
          const copy = await createTestDatabase()
          try {
            const created = await createCompany(copy, { name: 'Copy', domain: HOST })
            if (!created.ok) throw new Error('setup failed')
            for (const rule of saved.rules) {
              const { id: _id, domainId: _domain, createdAt: _c, updatedAt: _u, ...fresh } = rule
              await copy.audit.saveRule({
                domainId: created.domain.id,
                rule: fresh as NewAuditRule,
              })
            }
            await copy.audit.setUrlConfig({
              domainId: created.domain.id,
              host: HOST,
              urls: [URL_A],
              audit: pick.audit === 'rules' ? 'inherit' : pick.audit,
              intent: pick.intent === 'rules' ? 'inherit' : pick.intent,
              conditions: Object.fromEntries(
                AUDIT_CONDITIONS.map((name) => [
                  name,
                  pick.conditions[name] === 'rules' ? 'inherit' : pick.conditions[name],
                ]),
              ),
            })
            const result = await copy.audit.config(created.domain.id)
            const actual = currentAuditOf(
              { rules: result.rules, languages: NO_LANGUAGES },
              HOST,
              URL_A,
            )
            const expected = outcomeAfter(before, pick)
            expect(
              shape({
                audit: actual.audit,
                intent: actual.intent,
                conditions: actual.conditions,
              }),
              `${name}: ${JSON.stringify(pick)}`,
            ).toEqual(shape(expected))
          } finally {
            await copy.close()
          }
        }
      })
    }
  })
})

describe('the rules as the settings page lists them', () => {
  it('makes one rule of the rows that share a selector, and keeps the others apart', async () => {
    await db.audit.saveRuleSet({
      domainId,
      selector: prefix('/cart'),
      statements: { audit: 'exclude', conditions: { sitemap: 'forbidden', noindex: 'required' } },
      reason: 'The cart',
      enabled: true,
    })
    await db.audit.saveRule({ domainId, rule: audit(prefix('/blog'), 'include') })
    const groups = groupRules((await config()).rules)
    expect(groups).toHaveLength(2)
    const cart = groups.find(
      (group) => group.selector.kind === 'prefix' && group.selector.path === '/cart',
    )!
    expect(cart.ids).toHaveLength(3)
    expect(Object.keys(cart.statements).sort()).toEqual(['audit', 'noindex', 'sitemap'])
    expect(cart.enabled).toBe(true)
    expect(cart.reason).toBe('The cart')
    expect(conditionsOf(cart)).toEqual([
      ['noindex', 'required'],
      ['sitemap', 'forbidden'],
    ])
  })

  it('is switched off when any statement that acts is, and lists a duplicate that is off apart', async () => {
    await db.audit.saveRule({ domainId, rule: audit(prefix('/cart'), 'exclude') })
    await db.audit.saveRule({
      domainId,
      rule: condition(prefix('/cart'), 'robots', 'allowed', false),
    })
    await db.audit.saveRule({ domainId, rule: audit(prefix('/cart'), 'include', false) })
    const [group] = groupRules((await config()).rules)
    // The enabled audit row acts; the disabled duplicate does not take its place.
    expect(group?.statements.audit).toMatchObject({ value: 'exclude', enabled: true })
    expect(group?.ids).toHaveLength(3)
    // The robots row is off, so the rule is not fully on.
    expect(group?.enabled).toBe(false)
  })
})
