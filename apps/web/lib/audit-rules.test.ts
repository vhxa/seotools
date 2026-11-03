import { type NewAuditRule } from '@seotools/core'
import { createCompany } from '@seotools/db'
import { createTestDatabase, type Database } from '@seotools/db/test'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  currentAuditOf,
  explicitRulesOf,
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

const intent = (
  selector: NewAuditRule['selector'],
  value: 'indexable' | 'not-indexable',
  acceptNofollow = false,
) =>
  ({
    dimension: 'intent',
    value,
    selector,
    acceptNofollow,
    reason: null,
    enabled: true,
  }) as NewAuditRule

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
    const { rules } = await config()
    expect(explicitRulesOf(rules, URL_A).audit).toBeNull()
    const current = currentAuditOf(await config(), HOST, URL_A)
    expect(current.explicit.audit).toBeNull()
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

  it('tells where nofollow comes from when an exception only says that', async () => {
    await db.audit.saveRule({ domainId, rule: intent(prefix('/cart'), 'not-indexable') })
    await db.audit.setUrlConfig({ domainId, host: HOST, urls: [URL_A], acceptNofollow: true })
    const current = currentAuditOf(await config(), HOST, URL_A)
    expect(current.explicit).toMatchObject({ intent: null, hasIntentException: true })
    expect(current.intent).toMatchObject({
      value: 'not-indexable',
      rule: { exception: false },
      acceptNofollow: true,
      acceptRule: { exception: true },
    })
  })
})

describe('what a URL will be after saving', () => {
  const picks = (overrides: Partial<AuditPicks>): AuditPicks => ({
    audit: 'rules',
    intent: 'rules',
    accept: false,
    ...overrides,
  })

  it('shows what the rules give when it goes back to them, not the exception that goes', async () => {
    await db.audit.saveRule({ domainId, rule: audit(prefix('/cart'), 'exclude') })
    await db.audit.saveRule({ domainId, rule: audit({ kind: 'url', url: URL_A }, 'include') })
    const current = currentAuditOf(await config(), HOST, URL_A)
    expect(outcomeAfter(current, picks({ audit: 'rules' })).audit.value).toBe('excluded')
    expect(outcomeAfter(current, picks({ audit: 'include' })).audit.rule).toEqual({
      exception: true,
    })
  })

  it('keeps nofollow apart from the expectation', async () => {
    await db.audit.saveRule({ domainId, rule: intent(prefix('/cart'), 'not-indexable') })
    const current = currentAuditOf(await config(), HOST, URL_A)
    const after = outcomeAfter(current, picks({ accept: true }))
    // The expectation is still the rule's; only nofollow is the exception's.
    expect(after.intent).toMatchObject({
      value: 'not-indexable',
      rule: { exception: false },
      acceptNofollow: true,
      acceptRule: { exception: true },
    })
    // Not accepting it is what the rules say: no exception is needed.
    expect(outcomeAfter(current, picks({ accept: false })).intent.acceptRule).toEqual(
      current.underRules.intent.acceptRule,
    )
    // An expectation of its own fixes both.
    expect(outcomeAfter(current, picks({ intent: 'indexable' })).intent).toMatchObject({
      value: 'indexable',
      rule: { exception: true },
      acceptRule: { exception: true },
    })
  })

  describe('agrees with what saving does', () => {
    const setups: { name: string; rules: NewAuditRule[] }[] = [
      { name: 'no rules', rules: [] },
      {
        name: 'broader rules that do not accept nofollow',
        rules: [audit(prefix('/cart'), 'exclude'), intent(prefix('/cart'), 'not-indexable')],
      },
      {
        name: 'broader rules that accept it',
        rules: [audit(prefix('/cart'), 'include'), intent(prefix('/cart'), 'indexable', true)],
      },
      {
        name: 'exceptions already set',
        rules: [
          audit({ kind: 'url', url: URL_A }, 'exclude'),
          intent({ kind: 'url', url: URL_A }, 'not-indexable', true),
          intent(prefix('/cart'), 'indexable'),
        ],
      },
    ]
    const all: AuditPicks[] = []
    for (const a of ['rules', 'exclude', 'include'] as const)
      for (const i of ['rules', 'indexable', 'not-indexable'] as const)
        for (const accept of [false, true]) all.push({ audit: a, intent: i, accept })

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
              acceptNofollow: pick.accept,
            })
            const result = await copy.audit.config(created.domain.id)
            const actual = currentAuditOf(
              { rules: result.rules, languages: NO_LANGUAGES },
              HOST,
              URL_A,
            )
            const expected = outcomeAfter(before, pick)
            expect(
              shape({ audit: actual.audit, intent: actual.intent }),
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
