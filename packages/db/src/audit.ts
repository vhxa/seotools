import {
  AUDIT_LIMITS,
  JOB_TYPES,
  NO_LANGUAGES,
  canonicalLanguages,
  compileAuditRules,
  crawlUrlHash,
  sameLanguages,
  selectorKey,
  type AuditSelector,
  type AuditValue,
  type LanguageConfig,
  type NewAuditRule,
  type QuerySelector,
  type RecordedIntent,
  type SelectorScope,
} from '@seotools/core'
import type {
  AuditConfig,
  AuditMutation,
  AuditRuleRecord,
  UrlAuditChoice,
  UrlIntentChoice,
} from './types'

/**
 * The logic of changing a domain's rules, apart from the database. A change reads the rules of the
 * domain (at most `AUDIT_LIMITS.rulesPerDomain`) and decides, as a plan, what to write; the dialects
 * only read the rows, run the plan and bump the version, in one transaction. So the three of them
 * cannot disagree about what a conflict is.
 */

export interface AuditRuleRow {
  id: string
  domainId: string
  dimension: 'audit' | 'intent'
  value: string
  selectorKind: 'url' | 'path' | 'prefix'
  selector: string
  queryMode: 'any' | 'exact'
  queryValue: string | null
  scope: SelectorScope
  acceptNofollow: boolean
  selectorHash: string
  activeKey: string | null
  reason: string | null
  enabled: boolean
  createdAt: Date
  updatedAt: Date
}

export function toAuditRule(row: AuditRuleRow): AuditRuleRecord {
  const query: QuerySelector =
    row.queryMode === 'exact' ? { mode: 'exact', value: row.queryValue ?? '' } : { mode: 'any' }
  const selector: AuditSelector =
    row.selectorKind === 'url'
      ? { kind: 'url', url: row.selector }
      : {
          kind: row.selectorKind === 'prefix' ? 'prefix' : 'path',
          path: row.selector,
          query,
          scope: row.scope,
        }
  return {
    id: row.id,
    domainId: row.domainId,
    dimension: row.dimension,
    value: row.value as AuditValue & RecordedIntent,
    selector,
    reason: row.reason,
    enabled: row.enabled,
    ...(row.dimension === 'intent' ? { acceptNofollow: row.acceptNofollow } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  } as AuditRuleRecord
}

/** The identity of a selector as a column: URLs can be too long to index directly. */
export const selectorHashOf = (selector: AuditSelector) => crawlUrlHash(selectorKey(selector))

/** What a rule is made of in the columns of `audit_rules`, apart from who and when. */
function ruleColumns(rule: NewAuditRule) {
  const { selector } = rule
  const hash = selectorHashOf(selector)
  return {
    dimension: rule.dimension,
    value: rule.value,
    selectorKind: selector.kind,
    selector: selector.kind === 'url' ? selector.url : selector.path,
    queryMode: selector.kind === 'url' ? ('any' as const) : selector.query.mode,
    queryValue:
      selector.kind !== 'url' && selector.query.mode === 'exact' ? selector.query.value : null,
    scope: selector.kind === 'url' ? ('literal' as const) : selector.scope,
    acceptNofollow: rule.dimension === 'intent' && rule.acceptNofollow === true,
    selectorHash: hash,
    activeKey: rule.enabled ? hash : null,
    reason: rule.reason,
    enabled: rule.enabled,
  }
}

type RuleColumns = ReturnType<typeof ruleColumns>

export type RuleChange =
  | { op: 'insert'; row: AuditRuleRow }
  | { op: 'update'; id: string; patch: Partial<RuleColumns> & { updatedAt: Date } }
  | { op: 'delete'; id: string }

export type AuditPlan =
  | { ok: false; error: 'conflict' | 'not-found' | 'limit' }
  | {
      ok: true
      changes: RuleChange[]
      /** The language directories are changing to these. */
      languages?: LanguageConfig
      /** The version moves even if no rule or language does: what the rules mean changed. */
      bump?: boolean
      result?: string
    }

export interface PlanContext {
  now: Date
  newId: () => string
  /** The language directories now, which the effective result of a URL depends on. */
  languages: LanguageConfig
}

const sameColumns = (row: AuditRuleRow, columns: RuleColumns) =>
  (Object.keys(columns) as (keyof RuleColumns)[]).every((key) => row[key] === columns[key])

/** An enabled rule with this selector, for this dimension, other than `exceptId`. */
const conflictFor = (
  rows: readonly AuditRuleRow[],
  columns: Pick<AuditRuleRow, 'dimension' | 'activeKey'>,
  exceptId: string | null,
) =>
  columns.activeKey !== null &&
  rows.some(
    (row) =>
      row.id !== exceptId &&
      row.dimension === columns.dimension &&
      row.activeKey === columns.activeKey,
  )

/** Creates a rule, or edits the one with `id`. */
export function planSaveRule(
  rows: readonly AuditRuleRow[],
  input: { domainId: string; id?: string; rule: NewAuditRule },
  context: PlanContext,
): AuditPlan {
  const columns = ruleColumns(input.rule)
  if (input.id !== undefined) {
    const current = rows.find((row) => row.id === input.id)
    if (!current) return { ok: false, error: 'not-found' }
    if (conflictFor(rows, columns, current.id)) return { ok: false, error: 'conflict' }
    if (sameColumns(current, columns)) return { ok: true, changes: [], result: current.id }
    return {
      ok: true,
      changes: [{ op: 'update', id: current.id, patch: { ...columns, updatedAt: context.now } }],
      result: current.id,
    }
  }
  if (rows.length >= AUDIT_LIMITS.rulesPerDomain) return { ok: false, error: 'limit' }
  if (conflictFor(rows, columns, null)) return { ok: false, error: 'conflict' }
  const id = context.newId()
  return {
    ok: true,
    changes: [
      {
        op: 'insert',
        row: {
          id,
          domainId: input.domainId,
          ...columns,
          createdAt: context.now,
          updatedAt: context.now,
        },
      },
    ],
    result: id,
  }
}

export function planSetEnabled(
  rows: readonly AuditRuleRow[],
  input: { id: string; enabled: boolean },
  context: PlanContext,
): AuditPlan {
  const current = rows.find((row) => row.id === input.id)
  if (!current) return { ok: false, error: 'not-found' }
  if (current.enabled === input.enabled) return { ok: true, changes: [], result: current.id }
  const activeKey = input.enabled ? current.selectorHash : null
  if (input.enabled && conflictFor(rows, { ...current, activeKey }, current.id)) {
    return { ok: false, error: 'conflict' }
  }
  return {
    ok: true,
    changes: [
      {
        op: 'update',
        id: current.id,
        patch: { enabled: input.enabled, activeKey, updatedAt: context.now },
      },
    ],
    result: current.id,
  }
}

export function planDeleteRule(rows: readonly AuditRuleRow[], input: { id: string }): AuditPlan {
  if (!rows.some((row) => row.id === input.id)) return { ok: false, error: 'not-found' }
  return { ok: true, changes: [{ op: 'delete', id: input.id }] }
}

/**
 * What the table and the detail of a URL set: for each URL, the rule that is about that exact URL
 * in each dimension, created, changed or removed. `inherit` removes it, and with it the URL goes
 * back to what the broader rules say, including whether `nofollow` is accepted. A dimension left out
 * is not touched, and neither is anything of an exception that the change does not name:
 * - `acceptNofollow` alone changes only that, keeping the expectation the URL has now;
 * - an expectation alone keeps accepting `nofollow` as the URL does now;
 * - a `reason` left out keeps the one the exception has.
 * Where a new exception has to take a value it was not given, it takes the URL's effective one, so
 * making an exception never changes what it was not asked to change.
 */
export function planUrlConfig(
  rows: readonly AuditRuleRow[],
  input: {
    domainId: string
    host: string
    urls: readonly string[]
    audit?: UrlAuditChoice
    intent?: UrlIntentChoice
    acceptNofollow?: boolean
    reason?: string | null
  },
  context: PlanContext,
): AuditPlan {
  const changes: RuleChange[] = []
  let created = 0
  const resolver = compileAuditRules(rows.map(toAuditRule), input.host, {
    languages: context.languages,
  })

  const write = (current: AuditRuleRow | undefined, rule: NewAuditRule) => {
    const columns = ruleColumns(rule)
    if (current) {
      if (!sameColumns(current, columns)) {
        changes.push({
          op: 'update',
          id: current.id,
          patch: { ...columns, updatedAt: context.now },
        })
      }
      return
    }
    created++
    changes.push({
      op: 'insert',
      row: {
        id: context.newId(),
        domainId: input.domainId,
        ...columns,
        createdAt: context.now,
        updatedAt: context.now,
      },
    })
  }

  for (const url of new Set(input.urls)) {
    const exception = (dimension: 'audit' | 'intent') =>
      rows.find(
        (row) => row.dimension === dimension && row.selectorKind === 'url' && row.selector === url,
      )
    const selector: AuditSelector = { kind: 'url', url }

    if (input.audit !== undefined) {
      const current = exception('audit')
      if (input.audit === 'inherit') {
        if (current) changes.push({ op: 'delete', id: current.id })
      } else {
        write(current, {
          dimension: 'audit',
          value: input.audit,
          selector,
          reason: input.reason !== undefined ? input.reason : (current?.reason ?? null),
          enabled: true,
        })
      }
    }

    if (input.intent === 'inherit') {
      const current = exception('intent')
      if (current) changes.push({ op: 'delete', id: current.id })
    } else if (input.intent !== undefined || input.acceptNofollow !== undefined) {
      const current = exception('intent')
      const effective = resolver.resolve(url).intent
      // A rule of the retired `none` is no expectation: what the URL is expected to be then is the default.
      const kept = current?.value ?? effective.value
      write(current, {
        dimension: 'intent',
        value: input.intent ?? (kept === 'none' ? 'indexable' : (kept as RecordedIntent)),
        selector,
        acceptNofollow: input.acceptNofollow ?? current?.acceptNofollow ?? effective.acceptNofollow,
        reason: input.reason !== undefined ? input.reason : (current?.reason ?? null),
        enabled: true,
      })
    }
  }
  if (rows.length + created > AUDIT_LIMITS.rulesPerDomain) return { ok: false, error: 'limit' }
  return { ok: true, changes }
}

/** Changes the language directories of the domain, if they are not these already. */
export function planLanguages(languages: LanguageConfig, context: PlanContext): AuditPlan {
  const next = canonicalLanguages(languages)
  if (sameLanguages(next, context.languages)) return { ok: true, changes: [] }
  return { ok: true, changes: [], languages: next }
}

/**
 * What moving to the second semantics does to the rules a domain already has. A rule that said `none`
 * (no declared intent, to cancel a broader rule) has no counterpart: those URLs go back to what the
 * rules say, which can bring back a broader rule that `none` was holding off. Audit rules, and every
 * other intent rule, stay as they are. The version moves whether or not a rule goes: what a
 * configuration means changed for every domain.
 */
export function planUpgradeSemantics(rows: readonly AuditRuleRow[]): AuditPlan {
  return {
    ok: true,
    changes: rows
      .filter((row) => row.dimension === 'intent' && row.value === 'none')
      .map((row) => ({ op: 'delete' as const, id: row.id })),
    bump: true,
  }
}

/**
 * The setting that records that the rules of a domain were brought to the current meaning of a
 * configuration (`AUDIT_SEMANTICS`), so that it happens once.
 */
export const AUDIT_SEMANTICS_SETTING = 'audit.semantics'

/** The payload of the job that analyses a domain's latest crawl again. Equal for equal domains. */
export const recomputePayload = (domainId: string) => JSON.stringify({ domainId })

/** The job that analyses a domain's latest full crawl again, ready for insertion. */
export function recomputeJobValues(domainId: string, jobId: string, now: Date) {
  return {
    id: jobId,
    type: JOB_TYPES.auditRecompute,
    payload: recomputePayload(domainId),
    runAt: now,
    createdAt: now,
    updatedAt: now,
  }
}

export function mutationResult(
  plan: AuditPlan,
  version: number,
  record: (id: string) => AuditRuleRecord | null,
): AuditMutation {
  if (!plan.ok) return plan
  const rule = plan.result ? record(plan.result) : null
  return { ok: true, version, changed: planChanges(plan), ...(rule ? { rule } : {}) }
}

/** Whether a plan changes anything that makes the version move. */
export const planChanges = (plan: Extract<AuditPlan, { ok: true }>) =>
  plan.changes.length > 0 || plan.languages !== undefined || plan.bump === true

export interface AuditStateRow {
  version: number
  recomputeError: string | null
  recomputeErrorVersion: number | null
  languagePrefixes: string | null
  languageUnprefixed: boolean
}

/** The language directories as the configuration row keeps them. */
export function languagesOf(
  row: Pick<AuditStateRow, 'languagePrefixes' | 'languageUnprefixed'> | undefined,
): LanguageConfig {
  if (!row) return NO_LANGUAGES
  let prefixes: string[] = []
  try {
    const parsed: unknown = row.languagePrefixes ? JSON.parse(row.languagePrefixes) : []
    if (Array.isArray(parsed)) prefixes = parsed.filter((item) => typeof item === 'string')
  } catch {
    // A column nobody but this code writes: if it is garbage, no language is declared.
  }
  return canonicalLanguages({ prefixes, unprefixed: row.languageUnprefixed })
}

export const languageColumns = (languages: LanguageConfig) => ({
  languagePrefixes: languages.prefixes.length > 0 ? JSON.stringify(languages.prefixes) : null,
  languageUnprefixed: languages.unprefixed,
})

const MAX_CONFIG_READS = 5

/**
 * The rules of a domain with the version they are at. The version is read before and after the
 * rules and the read repeats if it moved, so the version always labels the rules it came with (or
 * older ones: if it never settles, the version read first is returned, which only ever makes the
 * result look out of date, never current).
 */
export async function readAuditConfig(read: {
  state: () => Promise<AuditStateRow | undefined>
  rules: () => Promise<AuditRuleRow[]>
}): Promise<AuditConfig> {
  for (let attempt = 1; ; attempt++) {
    const before = await read.state()
    const rules = await read.rules()
    const after = await read.state()
    if ((before?.version ?? 0) === (after?.version ?? 0) || attempt >= MAX_CONFIG_READS) {
      return {
        version: before?.version ?? 0,
        languages: languagesOf(before),
        rules: rules.map(toAuditRule),
        recomputeError:
          after?.recomputeError != null && after.recomputeErrorVersion != null
            ? { message: after.recomputeError, version: after.recomputeErrorVersion }
            : null,
      }
    }
  }
}

/** Deletes first, so that a rule can give up a selector in the same change that another takes it. */
export const inApplyOrder = (changes: readonly RuleChange[]) =>
  [...changes].sort((a, b) => ORDER[a.op] - ORDER[b.op])
const ORDER = { delete: 0, update: 1, insert: 2 } as const
