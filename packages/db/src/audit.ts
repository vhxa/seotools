import {
  findingDismissalsOf,
  canonicalThresholds,
  parseThresholdOverrides,
  AUDIT_CONDITIONS,
  AUDIT_DIMENSIONS,
  AUDIT_LIMITS,
  JOB_TYPES,
  NO_LANGUAGES,
  ORIGIN_RELATIONS_SEMANTICS,
  canonicalLanguages,
  crawlUrlHash,
  reachesRelations,
  groupRules,
  sameLanguages,
  selectorKey,
  type AuditCondition,
  type AuditDimension,
  type AuditSelector,
  type AuditValue,
  type IntentRuleValue,
  type LanguageConfig,
  type NewAuditRule,
  type QuerySelector,
  type Requirement,
  type SelectorScope,
  type ThresholdOverrides,
} from '@seotools/core'
import type {
  FindingStateRecord,
  SetFindingStates,
  AuditConfig,
  AuditMutation,
  AuditRuleRecord,
  RuleStatements,
  UrlAuditChoice,
  UrlConditionChoices,
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
  ruleSet: string | null
  domainId: string
  dimension: AuditDimension
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
    set: row.ruleSet,
    domainId: row.domainId,
    dimension: row.dimension,
    value: row.value as AuditValue & IntentRuleValue & Requirement,
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
    ruleSet: selector.kind === 'url' ? null : (rule.set ?? null),
    dimension: rule.dimension,
    value: rule.value,
    selectorKind: selector.kind,
    selector: selector.kind === 'url' ? selector.url : selector.path,
    queryMode: selector.kind === 'url' ? ('any' as const) : selector.query.mode,
    queryValue:
      selector.kind !== 'url' && selector.query.mode === 'exact' ? selector.query.value : null,
    scope: selector.kind === 'url' ? ('literal' as const) : selector.scope,
    // Retired with semantics 3: accepting `nofollow` is a condition rule now.
    acceptNofollow: false,
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
  | { ok: false; error: 'conflict' | 'not-found' | 'limit'; key?: string }
  | {
      ok: true
      states?: FindingStateRecord[]
      changes: RuleChange[]
      /** The language directories are changing to these. */
      languages?: LanguageConfig
      /** The figures of the checks are changing to these. */
      thresholds?: ThresholdOverrides
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
  if (current.ruleSet !== null)
    return planSetEnabledMany(rows, { ids: [input.id], enabled: input.enabled }, context)
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
  return planDeleteMany(rows, { ids: [input.id] })
}

/** Every statement a rule can make, by its dimension. */
const STATEMENT_DIMENSIONS: readonly AuditDimension[] = AUDIT_DIMENSIONS

/**
 * Writes rules into the plan. A rule is a row of `audit_rules`; what the editors show as one rule or
 * one exception is every row that has its selector, one per statement.
 */
function ruleWriter(
  rows: readonly AuditRuleRow[],
  input: { domainId: string },
  context: PlanContext,
) {
  const changes: RuleChange[] = []
  const deleted = new Set<string>()
  let created = 0
  return {
    changes,
    get net() {
      return rows.length + created - deleted.size
    },
    remove(row: AuditRuleRow) {
      if (deleted.has(row.id)) return
      deleted.add(row.id)
      changes.push({ op: 'delete', id: row.id })
    },
    /** Writes `rule` over `current`, or as a new row when there is none. */
    write(current: AuditRuleRow | undefined, rule: NewAuditRule) {
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
    },
  }
}

/** The value to give a statement of a dimension, from what a request says. */
const ruleOf = (
  dimension: AuditDimension,
  value: string,
  selector: AuditSelector,
  reason: string | null,
  enabled: boolean,
): NewAuditRule => ({ dimension, value, selector, reason, enabled }) as NewAuditRule

/**
 * What the table and the detail of a URL set: for each URL, the rules that are about that exact URL
 * (its exception, one row per statement), created, changed or removed. `inherit` removes the row, and
 * with it the URL goes back to what the broader rules say for that statement. A statement left out
 * is not touched, and neither is anything of an exception that the change does not name:
 * - the participation, the expectation of indexing and each of the four conditions are independent
 *   statements: setting one never states, resets or copies another;
 * - a `reason` left out keeps the one the exception has.
 * Disabled exceptions do not act: a change reuses one only when no enabled one exists, and `inherit`
 * removes them all.
 */
export function planUrlConfig(
  rows: readonly AuditRuleRow[],
  input: {
    domainId: string
    host: string
    urls: readonly string[]
    audit?: UrlAuditChoice
    intent?: UrlIntentChoice
    conditions?: UrlConditionChoices
    reason?: string | null
  },
  context: PlanContext,
): AuditPlan {
  const writer = ruleWriter(rows, input, context)
  const choices: [AuditDimension, string | undefined][] = [
    ['audit', input.audit],
    ['intent', input.intent],
    ...AUDIT_CONDITIONS.map((condition): [AuditDimension, string | undefined] => [
      condition,
      input.conditions?.[condition],
    ]),
  ]
  for (const url of new Set(input.urls)) {
    const selector: AuditSelector = { kind: 'url', url }
    for (const [dimension, choice] of choices) {
      if (choice === undefined) continue
      const all = rows.filter(
        (row) => row.dimension === dimension && row.selectorKind === 'url' && row.selector === url,
      )
      const acting = all.find((row) => row.enabled) ?? all[0]
      if (choice === 'inherit') {
        for (const row of all) writer.remove(row)
        continue
      }
      writer.write(
        acting,
        ruleOf(
          dimension,
          choice,
          selector,
          input.reason !== undefined ? input.reason : (acting?.reason ?? null),
          true,
        ),
      )
    }
  }
  if (writer.net > AUDIT_LIMITS.rulesPerDomain) return { ok: false, error: 'limit' }
  return { ok: true, changes: writer.changes }
}

/** A set id identifies a multi-path rule; a selector identifies a legacy group. */
export type RuleEditing = string | AuditSelector

/** Retains the single-selector API for callers of the current editor. */
export type RuleSelectors =
  { selectors: AuditSelector[]; selector?: never } | { selector: AuditSelector; selectors?: never }

const belongsTo = (row: AuditRuleRow, editing: RuleEditing) =>
  typeof editing === 'string'
    ? row.ruleSet === editing
    : row.ruleSet === null && row.selectorHash === selectorHashOf(editing)

/** One rule, saved atomically across all its selectors, keeping the ids of surviving rows. */
export function planSaveRuleSet(
  rows: readonly AuditRuleRow[],
  input: {
    domainId: string
    statements: RuleStatements
    reason: string | null
    enabled: boolean
    editing?: RuleEditing
  } & RuleSelectors,
  context: PlanContext,
): AuditPlan {
  const selectors = input.selectors ?? [input.selector]
  if (
    selectors.length < 1 ||
    selectors.length > AUDIT_LIMITS.pathsPerRule ||
    (selectors.length > 1 && selectors.some((s) => s.kind === 'url'))
  ) {
    return { ok: false, error: 'limit' }
  }
  const hashes = selectors.map(selectorHashOf)
  if (new Set(hashes).size !== hashes.length) return { ok: false, error: 'conflict' }
  const editing = input.editing
  const source = editing === undefined ? [] : rows.filter((row) => belongsTo(row, editing))
  if (input.editing !== undefined && source.length === 0) return { ok: false, error: 'not-found' }

  // An untouched legacy editor must be lossless, including disabled duplicates, mixed enabled
  // states, per-row reasons and retired acceptNofollow/intent values. Only an actual edit rewrites it.
  const sourceHashes = new Set(source.map((row) => row.selectorHash))
  const group = groupRules(source.map(toAuditRule))[0]
  const acting = Object.values(group?.statements ?? {})
  if (
    source.length > 0 &&
    sourceHashes.size === hashes.length &&
    hashes.every((h) => sourceHashes.has(h)) &&
    input.enabled === acting.every((row) => row.enabled) &&
    input.reason === (acting.find((row) => row.reason !== null)?.reason ?? null) &&
    STATEMENT_DIMENSIONS.every(
      (d) => statementOf(input.statements, d) === acting.find((row) => row.dimension === d)?.value,
    )
  ) {
    return { ok: true, changes: [] }
  }
  const set = selectors.some((s) => s.kind === 'url')
    ? null
    : (source.find((row) => row.ruleSet !== null)?.ruleSet ??
      (selectors.length > 1 ? context.newId() : null))
  const movingLegacy =
    typeof input.editing === 'object' && sourceHashes.size === 1 && selectors.length === 1
  const writer = ruleWriter(rows, input, context)
  for (const row of source) {
    if (
      (!movingLegacy && !hashes.includes(row.selectorHash)) ||
      statementOf(input.statements, row.dimension) === undefined
    )
      writer.remove(row)
  }
  for (const selector of selectors) {
    const targetHash = selectorHashOf(selector)
    for (const dimension of STATEMENT_DIMENSIONS) {
      const value = statementOf(input.statements, dimension)
      if (value === undefined) continue
      const clash = rows.find(
        (row) =>
          row.dimension === dimension && row.activeKey === targetHash && !source.includes(row),
      )
      if (input.enabled && clash)
        return {
          ok: false,
          error: 'conflict',
          key: clash.ruleSet ?? selectorKey(toAuditRule(clash).selector),
        }
      const candidates = source.filter(
        (row) => row.dimension === dimension && (movingLegacy || row.selectorHash === targetHash),
      )
      const current = candidates.find((row) => row.enabled) ?? candidates[0]
      writer.write(current, {
        ...ruleOf(dimension, value, selector, input.reason, input.enabled),
        set,
      })
      for (const row of candidates) if (row !== current) writer.remove(row)
    }
  }
  if (writer.net > AUDIT_LIMITS.rulesPerDomain) return { ok: false, error: 'limit' }
  return { ok: true, changes: writer.changes }
}

/** The value a set of statements gives a dimension. `undefined`: it states nothing about it. */
function statementOf(statements: RuleStatements, dimension: AuditDimension): string | undefined {
  if (dimension === 'audit') return statements.audit
  if (dimension === 'intent') return statements.intent
  return statements.conditions?.[dimension as AuditCondition]
}

/** Turns some rules on or off together, all or none: it is one rule as the editors show it. */
export function planSetEnabledMany(
  rows: readonly AuditRuleRow[],
  input: { ids: readonly string[]; enabled: boolean },
  context: PlanContext,
): AuditPlan {
  const requested = [...new Set(input.ids)].map((id) => rows.find((row) => row.id === id))
  if (requested.some((row) => !row)) return { ok: false, error: 'not-found' }
  const sets = new Set(requested.flatMap((row) => (row?.ruleSet ? [row.ruleSet] : [])))
  const targets = rows.filter(
    (row) => input.ids.includes(row.id) || (row.ruleSet !== null && sets.has(row.ruleSet)),
  )
  if (targets.length === 0 || targets.some((row) => !row)) return { ok: false, error: 'not-found' }
  // The places that are taken while the change is made, one per dimension and selector.
  const taken = new Set(
    rows.flatMap((row) => (row.activeKey === null ? [] : [`${row.dimension} ${row.activeKey}`])),
  )
  const changes: RuleChange[] = []
  for (const row of targets as AuditRuleRow[]) {
    if (row.enabled === input.enabled) continue
    const key = `${row.dimension} ${row.selectorHash}`
    if (input.enabled) {
      if (taken.has(key)) return { ok: false, error: 'conflict' }
      taken.add(key)
    } else taken.delete(key)
    changes.push({
      op: 'update',
      id: row.id,
      patch: {
        enabled: input.enabled,
        activeKey: input.enabled ? row.selectorHash : null,
        updatedAt: context.now,
      },
    })
  }
  return { ok: true, changes }
}

/** Removes some rules together, all or none. */
export function planDeleteMany(
  rows: readonly AuditRuleRow[],
  input: { ids: readonly string[] },
): AuditPlan {
  const ids = [...new Set(input.ids)]
  if (ids.length === 0 || ids.some((id) => !rows.some((row) => row.id === id))) {
    return { ok: false, error: 'not-found' }
  }
  const sets = new Set(
    rows.filter((row) => ids.includes(row.id)).flatMap((row) => (row.ruleSet ? [row.ruleSet] : [])),
  )
  return {
    ok: true,
    changes: rows
      .filter((row) => ids.includes(row.id) || (row.ruleSet !== null && sets.has(row.ruleSet)))
      .map((row) => ({ op: 'delete' as const, id: row.id })),
  }
}

/** Changes the language directories of the domain, if they are not these already. */
/** The figures of the checks, which change the configuration only when they differ. */
export function planThresholds(
  thresholds: ThresholdOverrides,
  current: ThresholdOverrides,
): AuditPlan {
  const next = canonicalThresholds(thresholds)
  if (JSON.stringify(next) === JSON.stringify(canonicalThresholds(current))) {
    return { ok: true, changes: [] }
  }
  return { ok: true, changes: [], thresholds: next }
}

export function planLanguages(languages: LanguageConfig, context: PlanContext): AuditPlan {
  const next = canonicalLanguages(languages)
  if (sameLanguages(next, context.languages)) return { ok: true, changes: [] }
  return { ok: true, changes: [], languages: next }
}

/**
 * Whether an accepting rule `a` could win over rule `r` for some URL `r` covers, which is when `r`
 * has to say for itself that it does not accept `nofollow`. Over-approximate on purpose: a rule too
 * many changes nothing (a condition that is `forbidden` is what a URL without a rule has), a rule too
 * few would change what a URL had.
 */
function couldWinOver(a: AuditSelector, r: AuditSelector): boolean {
  // An exact URL decides one URL, and nothing is more specific than it.
  if (a.kind === 'url') return false
  const rPath = r.kind === 'url' ? new URL(r.url).pathname : r.path
  const shared = a.scope === 'shared' || (r.kind !== 'url' && r.scope === 'shared')
  if (a.kind === 'path') {
    return r.kind === 'url'
      ? shared || rPath === a.path
      : r.kind === 'path' && (shared || rPath === a.path)
  }
  if (shared) return true
  return a.path === '/' || rPath === a.path || rPath.startsWith(`${a.path}/`)
}

/**
 * What moving to a newer meaning of a configuration (`AUDIT_SEMANTICS`) does to the rules a domain
 * already has. `from` is the meaning they have now.
 * - From 1: a rule that said `none` (no declared intent, to cancel a broader rule) has no
 *   counterpart: those URLs go back to what the rules say, which can bring back a broader rule that
 *   `none` was holding off.
 * - From 1 or 2: accepting the page's own `nofollow` hung off the intent rule that won. That becomes
 *   the `nofollow` condition, a rule of its own with the same selector: `allowed` where it was
 *   accepted and, where a more specific rule did not accept it under one that did, `forbidden`
 *   (which is what a URL without a rule has, written down only where it is needed). The intent rules
 *   keep their expectation: an old `not-indexable` is never read as a required `noindex`. An
 *   exception that only accepted `nofollow` (`inherit`) leaves nothing but the condition.
 * - From 1, 2, 3 or 4: nothing is written for what a URL declares of its own indexation reaching the
 *   findings of the URLs that point at it (a required or allowed `noindex` or robots.txt block, an
 *   expectation of `not-indexable`), nor for 5 taking that back from the destination of a relation.
 *   The rules are the same; what they accept differs, so a domain
 *   that has one is analysed again, and one that has none reads the same under both.
 * Audit rules and the expectation of every other intent rule stay as they are. Running it again
 * finds nothing to change. The version moves for every domain from 1, whether or not a rule goes:
 * what a configuration means changed for all of them; from 2 it moves only where rules changed, or
 * rules that the newer meaning reads another way exist, since everything else reads the same under
 * both.
 */
export function planUpgradeSemantics(
  rows: readonly AuditRuleRow[],
  context: PlanContext,
  from = 1,
): AuditPlan {
  const changes: RuleChange[] = []
  const gone = new Set<string>()
  if (from < 2) {
    for (const row of rows) {
      if (row.dimension === 'intent' && row.value === 'none') {
        changes.push({ op: 'delete', id: row.id })
        gone.add(row.id)
      }
    }
  }
  const intents = rows.filter((row) => row.dimension === 'intent' && !gone.has(row.id))
  const accepting = intents.filter((row) => row.acceptNofollow)
  for (const row of intents) {
    const asked = row.acceptNofollow
      ? ('allowed' as const)
      : accepting.some((other) =>
            couldWinOver(toAuditRule(other).selector, toAuditRule(row).selector),
          )
        ? ('forbidden' as const)
        : null
    // Written once: a rule that is already there for this selector is the user's, not ours to redo.
    const taken = rows.some(
      (other) =>
        other.dimension === 'nofollow' &&
        other.selectorHash === row.selectorHash &&
        (!row.enabled || other.enabled),
    )
    if (asked !== null && !taken) {
      const selector = toAuditRule(row).selector
      changes.push({
        op: 'insert',
        row: {
          id: context.newId(),
          domainId: row.domainId,
          ...ruleColumns(ruleOf('nofollow', asked, selector, row.reason, row.enabled)),
          createdAt: context.now,
          updatedAt: context.now,
        },
      })
    }
    if (row.value === 'inherit') changes.push({ op: 'delete', id: row.id })
    else if (row.acceptNofollow) {
      changes.push({
        op: 'update',
        id: row.id,
        patch: { acceptNofollow: false, updatedAt: context.now },
      })
    }
  }
  const reached =
    from < ORIGIN_RELATIONS_SEMANTICS &&
    rows.some((row) => row.enabled && !gone.has(row.id) && reachesRelations(row))
  return { ok: true, changes, bump: from < 2 || changes.length > 0 || reached }
}

/**
 * The setting that records that the rules of a domain were brought to the current meaning of a
 * configuration (`AUDIT_SEMANTICS`), so that it happens once.
 */
export const AUDIT_SEMANTICS_SETTING = 'audit.semantics'

/**
 * The rules that an older meaning could read differently from today's: the ones a domain has to
 * have for its rules to be looked at again when the meaning moves from 2 or later.
 */
export const UPGRADED_DIMENSIONS: AuditDimension[] = ['intent', 'noindex', 'robots']

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
  plan.changes.length > 0 ||
  plan.languages !== undefined ||
  plan.thresholds !== undefined ||
  plan.bump === true

export interface AuditStateRow {
  version: number
  recomputeError: string | null
  recomputeErrorVersion: number | null
  languagePrefixes: string | null
  languageUnprefixed: boolean
  thresholds: string | null
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

/** The figures a domain set, from its row; anything unreadable is the defaults. */
export function thresholdsOf(
  row: Pick<AuditStateRow, 'thresholds'> | undefined,
): ThresholdOverrides {
  if (!row?.thresholds) return {}
  try {
    return parseThresholdOverrides(JSON.parse(row.thresholds))
  } catch {
    return {}
  }
}

export const thresholdColumns = (thresholds: ThresholdOverrides) => {
  const kept = canonicalThresholds(thresholds)
  return { thresholds: Object.keys(kept).length > 0 ? JSON.stringify(kept) : null }
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
  states?: () => Promise<FindingStateRecord[]>
  rules: () => Promise<AuditRuleRow[]>
}): Promise<AuditConfig> {
  for (let attempt = 1; ; attempt++) {
    const before = await read.state()
    const rules = await read.rules()
    const findingStates = (await read.states?.()) ?? []
    const after = await read.state()
    if ((before?.version ?? 0) === (after?.version ?? 0) || attempt >= MAX_CONFIG_READS) {
      return {
        findingStates,
        version: before?.version ?? 0,
        languages: languagesOf(before),
        thresholds: thresholdsOf(before),
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

/** Plans human decisions separately from rule resolution; only a changed dismissal queues analysis. */
export function planFindingStates(
  rows: FindingStateRecord[],
  input: SetFindingStates,
  context: PlanContext,
): AuditPlan {
  if (
    input.urlHashes.length === 0 ||
    input.urlHashes.length > AUDIT_LIMITS.bulkUrls ||
    input.note.trim().length > 1000 ||
    (input.state === 'dismissed' && input.issue.startsWith('expected-'))
  ) {
    return { ok: false, error: 'limit' }
  }
  let next = [...rows]
  for (const urlHash of new Set(input.urlHashes)) {
    const current = next.find((r) => r.issue === input.issue && r.urlHash === urlHash)
    const domain = next.find((r) => r.issue === input.issue && r.urlHash === null)
    if (input.state === 'pending' && (urlHash === null || !domain)) {
      next = next.filter(
        (r) =>
          r !== current && !(urlHash === null && r.issue === input.issue && r.state === 'pending'),
      )
    } else {
      const row: FindingStateRecord = {
        id: current?.id ?? context.newId(),
        domainId: input.domainId,
        issue: input.issue,
        urlHash,
        targetKey: urlHash ?? '*',
        state: input.state,
        note: input.note.trim(),
        setBy: input.setBy,
        setAt: context.now,
      }
      if (current?.state === row.state && current.note === row.note) continue
      next = next.filter((r) => r !== current)
      next.push(row)
    }
  }
  if (next.length > 2000) return { ok: false, error: 'limit' }
  const key = (values: FindingStateRecord[]) =>
    JSON.stringify(findingDismissalsOf(values).map((r) => [r.issue, r.urlHash, r.state]))
  return { ok: true, changes: [], states: next, bump: key(rows) !== key(next) }
}
