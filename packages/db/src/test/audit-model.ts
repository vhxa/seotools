import {
  AUDIT_DIMENSIONS,
  REQUIREMENTS,
  AUDIT_VALUES,
  NO_LANGUAGES,
  groupRules,
  selectorKey,
  compileAuditRules,
  auditSnapshotOf,
  auditScopeKey,
  type AuditRule,
  type AuditSelector,
} from '@seotools/core'
import { describe, expect, it } from 'vitest'
import { planSaveRuleSet, selectorHashOf, type AuditRuleRow } from '../audit'
import type { Database, RuleStatements } from '../types'
import { createCompany } from '../workspace'

/** Synthetic legacy rows: no production data and no schema backfill. */
export function describeAuditModel(
  get: () => Database,
  legacyAccept: (id: string) => Promise<void>,
) {
  describe('lossless audit model migration', () => {
    it('preserves every legacy selector group, row, resolution and scope when saved unchanged', async () => {
      const db = get()
      const created = await createCompany(db, { name: 'Model fixture', domain: 'fixture.example' })
      if (!created.ok) throw new Error('fixture domain failed')
      const domainId = created.domain.id
      let n = 0
      const selectors: AuditSelector[] = []
      for (const kind of ['path', 'prefix'] as const)
        for (const scope of ['literal', 'shared'] as const)
          for (const mode of ['any', 'exact'] as const) {
            selectors.push({
              kind,
              scope,
              path: `/p${n++}`,
              query: mode === 'any' ? { mode } : { mode, value: 'q=one' },
            })
          }
      selectors.push({ kind: 'url', url: 'https://fixture.example/exact?q=1' })
      for (const [i, dimension] of AUDIT_DIMENSIONS.entries()) {
        const values =
          dimension === 'audit'
            ? AUDIT_VALUES
            : dimension === 'intent'
              ? (['indexable', 'not-indexable', 'none', 'inherit'] as const)
              : REQUIREMENTS
        for (const [j, value] of values.entries()) {
          const selector = selectors[(i + j) % selectors.length]!
          const saved = await db.audit.saveRule({
            domainId,
            rule: {
              dimension,
              value,
              selector,
              enabled: true,
              reason: `${dimension}-${value}`,
            } as AuditRule,
          })
          if (!saved.ok) throw new Error(saved.error)
          if (dimension === 'intent') await legacyAccept(saved.rule!.id)
          // Disabled duplicate with a different value and reason must survive an unchanged save.
          const duplicate = await db.audit.saveRule({
            domainId,
            rule: {
              dimension,
              value: values[(j + 1) % values.length],
              selector,
              enabled: false,
              reason: 'disabled duplicate',
            } as AuditRule,
          })
          if (!duplicate.ok) throw new Error(duplicate.error)
        }
      }
      await db.audit.saveRule({
        domainId,
        rule: {
          dimension: 'audit',
          value: 'exclude',
          selector: selectors[8]!,
          enabled: false,
          reason: 'disabled only',
        },
      })
      const languages = { prefixes: ['/es', '/fr'], unprefixed: true }
      await db.audit.setLanguages({ domainId, languages })
      const before = await db.audit.config(domainId)
      expect(before.rules.every((rule) => rule.set === null)).toBe(true)
      const groups = groupRules(before.rules)
      const legacyKeys = [...new Set(before.rules.map((rule) => selectorKey(rule.selector)))]
      expect(groups.map((g) => g.key)).toEqual(legacyKeys)
      expect(groups.map((g) => g.selectors)).toEqual(groups.map((g) => [g.selector]))
      const urls = selectors.flatMap((s) =>
        s.kind === 'url'
          ? [s.url, `${s.url}&extra=1`]
          : [s.path, `${s.path}/child`, `/es${s.path}`, `/fr${s.path}?q=one`].map(
              (p) => `https://fixture.example${p}`,
            ),
      )
      const resolver = compileAuditRules(before.rules, 'fixture.example', { languages })
      const resolutions = urls.map((url) => resolver.resolve(url))
      const scope = auditScopeKey(auditSnapshotOf(before.version, before.rules, languages))
      const rows: AuditRuleRow[] = before.rules.map((r) => ({
        id: r.id,
        domainId,
        ruleSet: null,
        dimension: r.dimension,
        value: r.value,
        selectorKind: r.selector.kind,
        selector: r.selector.kind === 'url' ? r.selector.url : r.selector.path,
        queryMode: r.selector.kind === 'url' ? 'any' : r.selector.query.mode,
        queryValue:
          r.selector.kind !== 'url' && r.selector.query.mode === 'exact'
            ? r.selector.query.value
            : null,
        scope: r.selector.kind === 'url' ? 'literal' : r.selector.scope,
        acceptNofollow: r.dimension === 'intent' && r.acceptNofollow,
        selectorHash: selectorHashOf(r.selector),
        activeKey: r.enabled ? selectorHashOf(r.selector) : null,
        enabled: r.enabled,
        reason: r.reason,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
      }))
      for (const group of groups) {
        const statements: RuleStatements = { conditions: {} }
        for (const r of Object.values(group.statements)) {
          if (r.dimension === 'audit') statements.audit = r.value
          else if (r.dimension === 'intent') statements.intent = r.value
          else statements.conditions![r.dimension] = r.value
        }
        const input = {
          domainId,
          editing: group.selector,
          selectors: group.selectors,
          statements,
          reason: group.reason,
          enabled: group.enabled,
        }
        expect(
          planSaveRuleSet(rows, input, {
            now: new Date(),
            languages: NO_LANGUAGES,
            newId: () => {
              throw new Error('unchanged save allocated an id')
            },
          }),
        ).toEqual({ ok: true, changes: [] })
        expect(await db.audit.saveRuleSet(input)).toMatchObject({
          ok: true,
          changed: false,
          version: before.version,
        })
      }
      const after = await db.audit.config(domainId)
      expect(after).toEqual(before)
      expect(
        urls.map((url) =>
          compileAuditRules(after.rules, 'fixture.example', { languages }).resolve(url),
        ),
      ).toEqual(resolutions)
      expect(auditScopeKey(auditSnapshotOf(after.version, after.rules, languages))).toBe(scope)
      expect(
        auditScopeKey({
          ...auditSnapshotOf(after.version, after.rules, languages),
          rules: after.rules.filter((r) => r.enabled).map((r) => ({ ...r, set: 'regrouped' })),
        }),
      ).toBe(scope)
    })

    it('saves several paths once, retains ids, rejects named conflicts and changes whole sets', async () => {
      const db = get()
      const created = await createCompany(db, { name: 'Sets', domain: 'sets.example' })
      if (!created.ok) throw new Error('fixture failed')
      const domainId = created.domain.id
      const selector = (path: string): AuditSelector => ({
        kind: 'prefix',
        path,
        scope: 'literal',
        query: { mode: 'any' },
      })
      const base = {
        domainId,
        statements: { conditions: { canonical: 'allowed' as const } },
        enabled: true,
        reason: 'Set reason',
      }
      await db.audit.saveRuleSet({ ...base, selectors: [selector('/a')] })
      const legacy = (await db.audit.config(domainId)).rules[0]!
      expect(legacy.set).toBeNull()
      expect(
        await db.audit.saveRuleSet({
          ...base,
          editing: selector('/a'),
          selectors: [selector('/a'), selector('/b')],
        }),
      ).toMatchObject({ ok: true, changed: true, version: 2 })
      const set = (await db.audit.config(domainId)).rules
      expect(set).toHaveLength(2)
      expect(set.some((r) => r.id === legacy.id)).toBe(true)
      const key = set[0]!.set!
      expect(key).toBeTruthy()
      expect(set[1]?.set).toBe(key)
      expect(
        await db.audit.saveRuleSet({ ...base, selectors: [selector('/b'), selector('/c')] }),
      ).toEqual({ ok: false, error: 'conflict', key })
      await db.audit.saveRuleSet({
        ...base,
        editing: key,
        selectors: [selector('/a'), selector('/c')],
      })
      const changed = (await db.audit.config(domainId)).rules
      expect(changed.find((r) => selectorKey(r.selector) === selectorKey(selector('/a')))?.id).toBe(
        legacy.id,
      )
      expect(changed.some((r) => selectorKey(r.selector) === selectorKey(selector('/b')))).toBe(
        false,
      )
      await db.audit.setRulesEnabled({ domainId, ids: [legacy.id], enabled: false })
      expect((await db.audit.config(domainId)).rules.every((r) => !r.enabled)).toBe(true)
      await db.audit.deleteRules({ domainId, ids: [legacy.id] })
      expect((await db.audit.config(domainId)).rules).toEqual([])
    })
  })
}
