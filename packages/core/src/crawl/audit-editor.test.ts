import { describe, expect, it } from 'vitest'
import { defaultScope, inheritedStatements, type AuditRule, type AuditSelector } from './audit'
import { AUDIT_RULE_TEMPLATES } from './audit-templates'

const prefix = (
  path: string,
  scope: 'shared' | 'literal' = 'literal',
): Extract<AuditSelector, { kind: 'prefix' }> => ({
  kind: 'prefix',
  path,
  scope,
  query: { mode: 'any' },
})
const rule = (id: string, selector: AuditSelector, value: 'required' | 'forbidden'): AuditRule => ({
  id,
  selector,
  dimension: 'noindex',
  value,
  enabled: true,
  reason: null,
})

describe('editor helpers', () => {
  const languages = { prefixes: ['/es', '/ca'], unprefixed: false }
  it('defaults new rules to shared only when language directories are declared', () => {
    expect(defaultScope(languages)).toBe('shared')
    expect(defaultScope({ prefixes: [], unprefixed: true })).toBe('literal')
  })
  it('omits every edited row and reports inheritance separately for disagreeing paths', () => {
    const selectors = [prefix('/a'), prefix('/b')]
    const result = inheritedStatements({
      selectors,
      ids: ['edit'],
      host: 'example.com',
      languages,
      rules: [
        rule('broad', prefix('/'), 'required'),
        rule('b', prefix('/b'), 'forbidden'),
        rule('edit', prefix('/a'), 'forbidden'),
      ],
    })
    expect(result.map((r) => r.statements.noindex)).toEqual([
      { value: 'required', from: { source: 'rule', key: 'prefix / *', selector: prefix('/') } },
      { value: 'forbidden', from: { source: 'rule', key: 'prefix /b *', selector: prefix('/b') } },
    ])
    expect(result[0]?.statements.canonical).toEqual({ value: null, from: { source: 'default' } })
    expect(result[0]?.statements.intent.value).toBe('indexable')
  })
  it('uses the declared language scope, query and compiler precedence at a prefix itself', () => {
    const shared = prefix('/shop', 'shared')
    const literal: AuditSelector = {
      kind: 'path',
      path: '/ca/shop',
      query: { mode: 'exact', value: 'sale=1' },
      scope: 'literal',
    }
    const result = inheritedStatements({
      selectors: [
        { ...shared, query: { mode: 'exact', value: 'sale=1' } },
        prefix('/uncovered', 'shared'),
      ],
      ids: [],
      set: 'edited',
      host: 'example.com',
      languages,
      rules: [
        rule('shared', shared, 'required'),
        rule('literal', literal, 'forbidden'),
        { ...rule('edit', shared, 'required'), set: 'edited' },
      ],
    })
    expect(result[0]?.statements.noindex.from).toEqual({
      source: 'rule',
      key: 'path /ca/shop =sale=1',
      selector: literal,
    })
    expect(result[1]?.statements.noindex.from).toEqual({ source: 'default' })
  })
  it('exports exactly the decided template prefills', () => {
    expect(AUDIT_RULE_TEMPLATES.map((t) => t.id)).toEqual([
      'private-area',
      'search-and-filters',
      'campaign-landing',
      'must-be-indexed',
      'leave-out',
    ])
    expect(AUDIT_RULE_TEMPLATES[3].statements.conditions.canonical).toBe('forbidden')
  })
})
