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
import { z } from '../zod'
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

const stringOrNull = z.string().nullable()
const strings = z.array(z.string())

/**
 * The stored shapes. Loose on purpose: anything else stored next to the known fields is kept, and the
 * values of `condition` and `requirement` are only checked to be strings, as they always were.
 */
const acceptanceSchema = z.discriminatedUnion('kind', [
  z.looseObject({
    kind: z.literal('condition'),
    condition: z.custom<AuditCondition>((value) => typeof value === 'string'),
    requirement: z.custom<Requirement>((value) => typeof value === 'string'),
    rule: stringOrNull,
  }),
  z.looseObject({ kind: z.literal('expectation'), rule: stringOrNull }),
  z.looseObject({
    kind: z.literal('relation'),
    end: z.enum(['origin', 'destination']),
    blockers: z.custom<IndexabilityBlocker[]>((value) => strings.safeParse(value).success),
    rules: strings,
  }),
])

/** Reads an acceptance back from storage. `null`: it does not check out. */
export function parseFindingAcceptance(stored: unknown): FindingAcceptance | null {
  const parsed = acceptanceSchema.safeParse(stored)
  return parsed.success ? parsed.data : null
}
