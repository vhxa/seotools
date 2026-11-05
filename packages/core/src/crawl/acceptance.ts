/**
 * What a rule accepting a finding means. A finding a rule takes as expected is not gone: what the
 * crawl saw is still there, it is no longer pending, and it can still be read as "accepted by a
 * rule". Three things stay apart everywhere: a problem that was fixed (the crawl no longer sees it),
 * a problem that was accepted (the crawl sees it, and a rule says it is expected), and a result that
 * is unknown (the crawl could not tell).
 *
 * Pure on purpose (no Node imports): client components import it through
 * `@seotools/core/crawl/acceptance`.
 */
import type { AuditCondition, Requirement } from './audit'
import type { IndexabilityBlocker } from './indexability'

export type FindingAcceptance =
  /** A rule states this condition of the URL, which replaces its generic finding. */
  | { kind: 'condition'; condition: AuditCondition; requirement: Requirement; rule: string | null }
  /** A rule expects the URL not to be indexable, and the finding is that expectation itself. */
  | { kind: 'expectation'; rule: string | null }
  /**
   * The finding is about another URL (a canonical, an hreflang, the links that arrive), and what is
   * declared of one end accepts it. `origin`: of the URL that has the finding. `destination`: of the
   * URL it points at, so a rule of that URL is acting on a finding of this one.
   */
  | {
      kind: 'relation'
      end: 'origin' | 'destination'
      blockers: IndexabilityBlocker[]
      rules: string[]
    }

/** The value of the `accepted` filter of a list that means "whichever the finding". */
export const ANY_ACCEPTED = 'all'

/** The rules that accept a finding, for showing which ones they are. */
export function rulesOfAcceptance(acceptance: FindingAcceptance): string[] {
  if (acceptance.kind === 'relation') return acceptance.rules
  return acceptance.rule === null ? [] : [acceptance.rule]
}

const isString = (value: unknown): value is string => typeof value === 'string'
const isStringOrNull = (value: unknown) => value === null || isString(value)

/** Reads an acceptance back from storage. `null`: it does not check out. */
export function parseFindingAcceptance(stored: unknown): FindingAcceptance | null {
  if (typeof stored !== 'object' || stored === null) return null
  const value = stored as Record<string, unknown>
  switch (value.kind) {
    case 'condition':
      return isString(value.condition) && isString(value.requirement) && isStringOrNull(value.rule)
        ? (value as unknown as FindingAcceptance)
        : null
    case 'expectation':
      return isStringOrNull(value.rule) ? (value as unknown as FindingAcceptance) : null
    case 'relation':
      return (value.end === 'origin' || value.end === 'destination') &&
        Array.isArray(value.blockers) &&
        value.blockers.every(isString) &&
        Array.isArray(value.rules) &&
        value.rules.every(isString)
        ? (value as unknown as FindingAcceptance)
        : null
    default:
      return null
  }
}
