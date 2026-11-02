import {
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
import type { AuditRuleRecord, Crawl, Database } from '@seotools/db'

/** The id the rule being previewed has among the others. It is not a UUID, so no rule can have it. */
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
  /** An enabled rule of that dimension already has that selector. */
  | { status: 'conflict'; with: RuleBrief }
  | {
      status: 'ok'
      /** When the crawl whose URLs were looked at finished. */
      crawledAt: string | null
      /** URLs of the crawl that were looked at: the internal ones. */
      scanned: number
      /** URLs the selector covers, whether or not this rule decides them. */
      matches: number
      /** Of those, the ones this rule would decide. */
      decides: number
      /** URLs whose effective result would be different from what it is now. */
      changes: number
      /** URLs it covers where a more specific rule decides. */
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

/** What a dimension makes of a URL: the part of a resolution a rule of that dimension can change. */
const effectOf = (resolution: AuditResolution, dimension: AuditDimension) =>
  dimension === 'audit'
    ? resolution.audit.value
    : `${resolution.intent.value}${resolution.intent.acceptNofollow ? '+nofollow' : ''}`

/**
 * What a rule would do to the URLs the last full crawl knows, before it is saved. It resolves with
 * the same code as the worker, with the language directories of the domain, over the rules as they
 * are now and over the rules as they would be, so the answer is the one the next analysis gives. It
 * only looks at known URLs; the rule will apply to the ones found later too.
 *
 * It tells apart the URLs the selector covers, the ones whose effective result would change (the
 * rule decides them and what it says differs from what they are now), and the ones it covers where a
 * more specific rule prevails.
 */
export async function previewRule(input: {
  db: Database
  host: string
  crawl: Crawl | null
  rules: readonly AuditRuleRecord[]
  languages: LanguageConfig
  /** The rule being edited, which the candidate replaces. */
  replacing: string | null
  candidate: NewAuditRule
}): Promise<AuditPreview> {
  const { db, host, crawl, candidate, languages } = input
  if (!crawl) return { status: 'no-results' }

  const others = input.rules.filter((rule) => rule.id !== input.replacing)
  const key = selectorKey(candidate.selector)
  const clash = others.find(
    (rule) =>
      rule.enabled && rule.dimension === candidate.dimension && selectorKey(rule.selector) === key,
  )
  if (clash) return { status: 'conflict', with: briefOf(clash) }

  // Previewed as if on: a rule that is switched off covers the same URLs, it just does not decide.
  const previewed = { ...candidate, id: PREVIEW_ID, enabled: true } as AuditRule
  const now = compileAuditRules(input.rules, host, { languages })
  const after = compileAuditRules([...others, previewed], host, { languages })
  const dimension = candidate.dimension
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
      if (!parts || !selectorMatches(candidate.selector, parts)) continue
      matches++
      if (matchSamples.length < MAX_SAMPLES) matchSamples.push(url)
      const resolved = after.resolve(url)
      const winner = resolved[dimension].rule
      if (winner?.id === PREVIEW_ID) {
        decides++
        if (effectOf(resolved, dimension) !== effectOf(now.resolve(url), dimension)) {
          changes++
          if (changeSamples.length < MAX_SAMPLES) changeSamples.push(url)
        }
      } else if (winner) {
        overriddenCount++
        if (overridden.length < MAX_SAMPLES) overridden.push({ url, by: briefOf(winner) })
      }
    }
    if (batch.length < BATCH) break
  }
  return {
    status: 'ok',
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
