import {
  AUDIT_CONDITIONS,
  compileAuditRules,
  selectorKey,
  selectorMatches,
  urlPartsOf,
  type AuditDimension,
  type AuditResolution,
  type AuditRule,
  type AuditSelector,
  type LanguageConfig,
  type NewAuditRule,
} from '@seotools/core'
import type { AuditRuleRecord, Crawl, Database, RuleStatements } from '@seotools/db'

/** The id the rows of the rule being previewed have among the others. Not a UUID, so no rule has it. */
const PREVIEW_ID = 'preview'
const BATCH = 5000
const MAX_SAMPLES = 8

/** What a rule shows of another one that wins over it. */
export interface RuleBrief {
  id: string
  dimension: AuditDimension
  value: string
  selector: AuditSelector
  reason: string | null
}

export type AuditPreview =
  /** There is no full crawl with results to look at. The rule can still be saved. */
  | { status: 'no-results' }
  /** An enabled rule already says something of the same kind about that selector. */
  | { status: 'conflict'; with: RuleBrief }
  | {
      status: 'ok'
      /** When the crawl whose URLs were looked at finished. */
      crawledAt: string | null
      /** URLs of the crawl that were looked at: the internal ones. */
      scanned: number
      /** Whether the rule would act: it is on. A rule that is off covers URLs and decides none. */
      active: boolean
      /** URLs the selector covers, whether or not this rule decides them. */
      matches: number
      /** Of those, the ones where this rule would decide at least one of its statements, were it on. */
      decides: number
      /**
       * URLs whose effective result would be different from what it is now, wherever they are: the
       * ones the selector covers, and also the ones the rule being edited covered before and no
       * longer does.
       */
      changes: number
      /** URLs it covers where a more specific rule decides every statement it makes. */
      overriddenCount: number
      /** Examples of the URLs it covers. */
      matchSamples: string[]
      /** Examples of the URLs whose effective result would change. */
      changeSamples: string[]
      /** Examples of URLs it covers where another rule is more specific, with that rule. */
      overridden: { url: string; by: RuleBrief }[]
    }

export const briefOf = (rule: AuditRule): RuleBrief => ({
  id: rule.id,
  dimension: rule.dimension,
  value: rule.value,
  selector: rule.selector,
  reason: rule.reason,
})

/** The rule as the editor shows it: the statements it makes, each one a row of its own. */
export function rulesOfSet(
  selector: AuditSelector,
  statements: RuleStatements,
  reason: string | null,
  enabled: boolean,
): NewAuditRule[] {
  const base = { selector, reason, enabled }
  return [
    ...(statements.audit ? [{ ...base, dimension: 'audit', value: statements.audit }] : []),
    ...(statements.intent ? [{ ...base, dimension: 'intent', value: statements.intent }] : []),
    ...AUDIT_CONDITIONS.flatMap((condition) => {
      const value = statements.conditions?.[condition]
      return value ? [{ ...base, dimension: condition, value }] : []
    }),
  ] as NewAuditRule[]
}

/** What a resolution makes of a URL, for every statement a rule can make. */
const effectOf = (resolution: AuditResolution) =>
  [
    resolution.audit.value,
    resolution.intent.value,
    ...AUDIT_CONDITIONS.map((condition) => resolution.conditions[condition].requirement ?? '-'),
  ].join('|')

/** The rule that decides each statement of a resolution, by dimension. */
const decidersOf = (resolution: AuditResolution): Partial<Record<AuditDimension, AuditRule>> => ({
  ...(resolution.audit.rule ? { audit: resolution.audit.rule } : {}),
  ...(resolution.intent.rule ? { intent: resolution.intent.rule } : {}),
  ...Object.fromEntries(
    AUDIT_CONDITIONS.flatMap((condition) => {
      const rule = resolution.conditions[condition].rule
      return rule ? [[condition, rule]] : []
    }),
  ),
})

/**
 * What a rule would do to the URLs the last full crawl knows, before it is saved. It resolves with
 * the same code as the worker, with the language directories of the domain, over the rules as they
 * are now and over the rules as they would be, so the answer is the one the next analysis gives. It
 * only looks at known URLs; the rule will apply to the ones found later too.
 *
 * A rule makes several statements, each decided on its own: it decides a URL where it wins at least
 * one of them, and is overridden where another rule is more specific for all of them. It tells apart
 * the URLs the selector covers, the ones whose effective result would change, and the ones it covers
 * where a more specific rule prevails. A change is any URL that is different between the rules as they
 * are and as they would be: when a rule is edited, that includes what the old selector covered and
 * the new one does not, and a rule that is switched off changes what it was deciding before. The URLs
 * neither selector covers cannot change, so they are not resolved.
 */
export async function previewRule(input: {
  db: Database
  host: string
  crawl: Crawl | null
  rules: readonly AuditRuleRecord[]
  languages: LanguageConfig
  /** The selector of the rule being edited, whose rows the candidate replaces. */
  editing: AuditSelector | null
  candidate: {
    selector: AuditSelector
    statements: RuleStatements
    reason: string | null
    enabled: boolean
  }
}): Promise<AuditPreview> {
  const { db, host, crawl, candidate, languages } = input
  if (!crawl) return { status: 'no-results' }

  const editingKey = input.editing ? selectorKey(input.editing) : null
  const replaced = input.rules.filter((rule) => selectorKey(rule.selector) === editingKey)
  const others = input.rules.filter((rule) => selectorKey(rule.selector) !== editingKey)
  const key = selectorKey(candidate.selector)
  const rows = rulesOfSet(
    candidate.selector,
    candidate.statements,
    candidate.reason,
    candidate.enabled,
  )

  // A rule that is off cannot clash: only enabled rules are unique, per statement.
  const clash = others.find(
    (rule) =>
      rule.enabled &&
      selectorKey(rule.selector) === key &&
      rows.some((row) => row.dimension === rule.dimension),
  )
  if (clash && candidate.enabled) return { status: 'conflict', with: briefOf(clash) }

  const previewed = rows.map((row) => ({ ...row, id: PREVIEW_ID }) as AuditRule)
  const now = compileAuditRules(input.rules, host, { languages })
  const after = compileAuditRules([...others, ...previewed], host, { languages })
  // What it would decide if it were on: the same unless it is off.
  const ifOn = candidate.enabled
    ? after
    : compileAuditRules(
        [
          ...others.filter((rule) => rule !== clash),
          ...previewed.map((rule) => ({ ...rule, enabled: true })),
        ],
        host,
        { languages },
      )
  const stated = new Set<AuditDimension>(rows.map((row) => row.dimension))

  let scanned = 0
  let matches = 0
  let decides = 0
  let changes = 0
  let overriddenCount = 0
  const matchSamples: string[] = []
  const changeSamples: string[] = []
  const overridden: { url: string; by: RuleBrief }[] = []
  for (let offset = 0; ; offset += BATCH) {
    const batch = await db.crawls.urlBriefs(crawl.id, { limit: BATCH, offset })
    for (const { url } of batch) {
      scanned++
      const parts = urlPartsOf(url, host, languages)
      if (!parts) continue
      const covered = selectorMatches(candidate.selector, parts)
      const wasCovered = replaced.some((rule) => selectorMatches(rule.selector, parts))
      if (!covered && !wasCovered) continue
      if (covered) {
        matches++
        if (matchSamples.length < MAX_SAMPLES) matchSamples.push(url)
        const winners = decidersOf(ifOn.resolve(url))
        const mine = [...stated].filter((dimension) => winners[dimension]?.id === PREVIEW_ID)
        if (mine.length > 0) decides++
        else {
          const by = [...stated].map((dimension) => winners[dimension]).find(Boolean)
          if (by) {
            overriddenCount++
            if (overridden.length < MAX_SAMPLES) overridden.push({ url, by: briefOf(by) })
          }
        }
      }
      if (effectOf(after.resolve(url)) !== effectOf(now.resolve(url))) {
        changes++
        if (changeSamples.length < MAX_SAMPLES) changeSamples.push(url)
      }
    }
    if (batch.length < BATCH) break
  }
  return {
    status: 'ok',
    active: candidate.enabled,
    crawledAt: crawl.finishedAt?.toISOString() ?? null,
    scanned,
    matches,
    decides,
    changes,
    overriddenCount,
    matchSamples,
    changeSamples,
    overridden,
  }
}
