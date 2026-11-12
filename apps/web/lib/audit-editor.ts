import {
  AUDIT_CONDITIONS,
  inheritedStatements,
  type AuditCondition,
  type AuditParticipation,
  type AuditRule,
  type AuditSelector,
  type AuditValue,
  type IndexIntent,
  type InheritedSource,
  type LanguageConfig,
  type Requirement,
} from '@seotools/core/crawl/audit'
import type { AUDIT_RULE_TEMPLATES } from '@seotools/core/crawl/audit-templates'
import type { RuleGroup, RuleSummary, UrlAuditCurrent } from '@/lib/audit-rules'

/**
 * What the editors of rules and of URL exceptions work with, apart from the components: what is
 * picked for each statement, what each one would be if it were not stated and where that comes from,
 * and the requests and summaries made from them. Pure, so each of those is tested without a browser.
 */

/**
 * What is picked for one statement. `keep` is "no change": nothing is sent, so what the URLs have
 * stays (only when several URLs are being changed). `inherit` is "not stated": for an exception, the
 * exception goes and the URL takes what the rules say; for a rule, this rule says nothing about it.
 * They are different on purpose.
 */
export type Pick<V extends string> = 'keep' | 'inherit' | V

export interface StatementPicks {
  audit: Pick<AuditValue>
  /** The expectation of indexing as a whole: an advanced concept, apart from the conditions. */
  intent: Pick<IndexIntent>
  conditions: Record<AuditCondition, Pick<Requirement>>
}

export const picksOf = (value: 'keep' | 'inherit'): StatementPicks => ({
  audit: value,
  intent: value,
  conditions: Object.fromEntries(AUDIT_CONDITIONS.map((condition) => [condition, value])) as Record<
    AuditCondition,
    Pick<Requirement>
  >,
})

/** What a pick says in a form or a request: nothing for "not stated" and "no change". */
export const stated = (pick: string) => (pick === 'inherit' || pick === 'keep' ? '' : pick)

// --- what is inherited ----------------------------------------------------------------------------

/**
 * What a condition is worth when no rule states it, in the positions the editor offers. Noindex,
 * nofollow and a robots.txt block raise a finding by themselves, which is what "forbidden" asks. The
 * sitemap listing, a canonical elsewhere and the lack of internal links raise none, or a low one, so
 * none of the three positions describes them and nothing is highlighted.
 */
export const DEFAULT_POSITION: Record<AuditCondition, Requirement | null> = {
  noindex: 'forbidden',
  nofollow: 'forbidden',
  robots: 'forbidden',
  sitemap: null,
  canonical: null,
  unlinked: null,
}

/** Where what a statement would be comes from. */
export type SingleOrigin =
  { kind: 'default' } | { kind: 'rule'; key: string; selector: AuditSelector }

export type Origin =
  | { kind: 'default' }
  /** One or more rules, by their first selector. */
  | { kind: 'rules'; selectors: AuditSelector[] }
  /** The paths of a rule with several paths do not agree. */
  | {
      kind: 'varies'
      paths: { selector: AuditSelector; position: string | null; origin: SingleOrigin }[]
    }

/** What a statement would be if it were not stated, as a position of its control, and why. */
export interface Inherited<V extends string> {
  /** `null`: none of the positions describes it (the default raises no finding of its own). */
  position: V | null
  origin: Origin
}

export interface InheritedPicks {
  audit: Inherited<AuditValue>
  intent: Inherited<IndexIntent>
  conditions: Record<AuditCondition, Inherited<Requirement>>
}

const positionOfAudit = (value: unknown): AuditValue | null =>
  value === 'excluded' ? 'exclude' : value === 'audited' ? 'include' : null
const positionOfIntent = (value: unknown): IndexIntent | null =>
  value === 'indexable' || value === 'not-indexable' ? value : null
const positionOfRequirement = (value: unknown): Requirement | null =>
  value === 'required' || value === 'allowed' || value === 'forbidden' ? value : null

/**
 * One statement across the paths of a rule: when every path would be the same thing, that; when
 * they disagree, "varies by path", with each one, for a tooltip.
 */
export function mergeInherited<V extends string>(
  perPath: { selector: AuditSelector; position: V | null; origin: SingleOrigin }[],
): Inherited<V> {
  const [first, ...rest] = perPath
  if (!first) return { position: null, origin: { kind: 'default' } }
  const agree = rest.every((path) => path.position === first.position)
  const kinds = new Set(perPath.map((path) => path.origin.kind))
  if (agree && kinds.size === 1) {
    if (first.origin.kind === 'default') return { position: first.position, origin: first.origin }
    const rules = new Map<string, AuditSelector>()
    for (const { origin } of perPath) {
      if (origin.kind === 'rule' && !rules.has(origin.key)) rules.set(origin.key, origin.selector)
    }
    return { position: first.position, origin: { kind: 'rules', selectors: [...rules.values()] } }
  }
  return {
    position: null,
    origin: {
      kind: 'varies',
      paths: perPath.map(({ selector, position, origin }) => ({ selector, position, origin })),
    },
  }
}

const singleOrigin = (from: InheritedSource): SingleOrigin =>
  from.source === 'default'
    ? { kind: 'default' }
    : { kind: 'rule', key: from.key, selector: from.selector }

/**
 * What a rule would be, statement by statement, on each of its paths if it did not state it, from the
 * other rules of the domain (`inheritedStatements` asks the same resolver the worker uses).
 */
export function inheritedOfRule(input: {
  selectors: readonly AuditSelector[]
  /** The rows of the rule being edited, which do not count: it is what they are being compared with. */
  ids: readonly string[]
  set?: string | null
  rules: readonly AuditRule[]
  host: string
  languages: LanguageConfig
}): InheritedPicks {
  const perSelector = inheritedStatements(input)
  const across = <V extends string>(
    dimension: keyof (typeof perSelector)[number]['statements'],
    toPosition: (value: unknown) => V | null,
    fallback: V | null,
  ) =>
    mergeInherited<V>(
      perSelector.map(({ selector, statements }) => {
        const found = statements[dimension]
        const position = toPosition(found.value)
        return {
          selector,
          position: found.from.source === 'default' ? (position ?? fallback) : position,
          origin: singleOrigin(found.from),
        }
      }),
    )
  return {
    audit: across('audit', positionOfAudit, 'include'),
    intent: across('intent', positionOfIntent, 'indexable'),
    conditions: Object.fromEntries(
      AUDIT_CONDITIONS.map((condition) => [
        condition,
        across(condition, positionOfRequirement, DEFAULT_POSITION[condition]),
      ]),
    ) as InheritedPicks['conditions'],
  }
}

const originOfSummary = (rule: RuleSummary | null): Origin =>
  rule && !rule.exception ? { kind: 'rules', selectors: [rule.selector] } : { kind: 'default' }

/** What one URL would be if its exception went (what the rules give it), which is what it inherits. */
export function inheritedOfUrl(current: UrlAuditCurrent): InheritedPicks {
  const rules = current.underRules
  const participation = (value: AuditParticipation) => positionOfAudit(value)
  return {
    audit: {
      position: participation(rules.audit.value),
      origin: originOfSummary(rules.audit.rule),
    },
    intent: {
      position: positionOfIntent(rules.intent.value) ?? 'indexable',
      origin: originOfSummary(rules.intent.rule),
    },
    conditions: Object.fromEntries(
      AUDIT_CONDITIONS.map((condition) => {
        const { requirement, rule } = rules.conditions[condition]
        return [
          condition,
          {
            position: rule ? requirement : DEFAULT_POSITION[condition],
            origin: originOfSummary(rule),
          },
        ]
      }),
    ) as InheritedPicks['conditions'],
  }
}

// --- the state of one control ---------------------------------------------------------------------

export type ControlState<V extends string> =
  /** Several URLs, nothing chosen: what each has is left alone. */
  | { kind: 'nochange' }
  /** Several URLs, "according to the rules" chosen: their exceptions go. */
  | { kind: 'removed' }
  /** Not stated: shows, muted, what applies without it. */
  | { kind: 'inherited'; position: V | null; origin: Origin }
  /** Stated: solid, with a way back. */
  | { kind: 'stated'; value: V }

export function controlState<V extends string>(
  pick: Pick<V>,
  mode: 'single' | 'bulk',
  inherited: Inherited<V>,
): ControlState<V> {
  if (pick === 'keep') return { kind: 'nochange' }
  if (pick === 'inherit') {
    return mode === 'bulk'
      ? { kind: 'removed' }
      : { kind: 'inherited', position: inherited.position, origin: inherited.origin }
  }
  return { kind: 'stated', value: pick }
}

/**
 * A condition is shown as two buttons (Required, Forbidden) and a checkbox, "Don't warn either way",
 * which is the stored `allowed`. What each of the three looks like for a state of the control:
 * solid when stated, muted (dashed) when it is what applies without a statement. Stating `allowed`
 * leaves both buttons off, and stating a button leaves the checkbox off.
 */
export interface RequirementView {
  /** The button that is chosen. */
  button: 'required' | 'forbidden' | null
  /** The button that applies while nothing is chosen. */
  mutedButton: 'required' | 'forbidden' | null
  /** "Don't warn either way" is chosen. */
  allowed: boolean
  /** "Don't warn either way" is what applies while nothing is chosen. */
  mutedAllowed: boolean
}

export function requirementView(state: ControlState<Requirement>): RequirementView {
  const none: RequirementView = {
    button: null,
    mutedButton: null,
    allowed: false,
    mutedAllowed: false,
  }
  if (state.kind === 'stated') {
    return state.value === 'allowed' ? { ...none, allowed: true } : { ...none, button: state.value }
  }
  if (state.kind === 'inherited') {
    return state.position === 'allowed'
      ? { ...none, mutedAllowed: true }
      : { ...none, mutedButton: state.position }
  }
  return none
}

/** What the "back" button of a stated control goes back to. */
export const resetPick = (mode: 'single' | 'bulk'): 'keep' | 'inherit' =>
  mode === 'bulk' ? 'keep' : 'inherit'

// --- templates ------------------------------------------------------------------------------------

type Template = (typeof AUDIT_RULE_TEMPLATES)[number]
interface TemplateStatements {
  audit?: AuditValue
  intent?: IndexIntent
  conditions?: Partial<Record<AuditCondition, Requirement>>
}

/**
 * The picks a template fills in. Everything it does not state is not stated by the rule, whatever
 * was picked before: choosing a template replaces the statements, it never adds to them.
 */
export function applyTemplate(template: Template | { statements: TemplateStatements } | null) {
  const picks = picksOf('inherit')
  if (!template) return picks
  const { audit, intent, conditions } = template.statements as TemplateStatements
  if (audit) picks.audit = audit
  if (intent) picks.intent = intent
  for (const condition of AUDIT_CONDITIONS) {
    const requirement = conditions?.[condition]
    if (requirement) picks.conditions[condition] = requirement
  }
  return picks
}

// --- the request of an exception ------------------------------------------------------------------

/**
 * What to send for the exceptions of one or more URLs: only what the user chose to change, so nothing
 * else can be reset by saving. "No change" (`keep`) is a statement left out; "according to the rules"
 * (`inherit`) removes the exception. A reason written for one URL with nothing else changed re-saves
 * its exceptions. Several URLs never send a statement the user did not touch.
 */
export function urlRequest(input: {
  urls: string[]
  picks: StatementPicks
  /** What the picks started from. */
  initial: StatementPicks
  multiple: boolean
  reason: string
  reasonTouched: boolean
}): { body: Record<string, unknown>; any: boolean } {
  const { picks, initial, multiple, reasonTouched } = input
  const body: Record<string, unknown> = { urls: input.urls }
  const conditions: Record<string, string> = {}
  let any = false
  const send = (pick: string, was: string, set: (value: string) => void) => {
    if (pick === 'keep') return
    if (pick !== was || (reasonTouched && !multiple && was !== 'inherit')) {
      set(pick)
      any = true
    }
  }
  send(picks.audit, initial.audit, (value) => (body.audit = value))
  send(picks.intent, initial.intent, (value) => (body.intent = value))
  for (const condition of AUDIT_CONDITIONS) {
    send(picks.conditions[condition], initial.conditions[condition], (value) => {
      conditions[condition] = value
    })
  }
  if (Object.keys(conditions).length > 0) body.conditions = conditions
  // Only a reason that was written is sent; otherwise each exception keeps its own.
  if (reasonTouched) body.reason = input.reason
  return { body, any }
}

/** What one URL starts from: the exceptions it really has, and "not stated" for the rest. */
export function picksOfUrl(current: UrlAuditCurrent): StatementPicks {
  return {
    audit: current.explicit.audit ?? 'inherit',
    intent: current.explicit.intent ?? 'inherit',
    conditions: Object.fromEntries(
      AUDIT_CONDITIONS.map((condition) => [
        condition,
        current.explicit.conditions[condition] ?? 'inherit',
      ]),
    ) as StatementPicks['conditions'],
  }
}

/** What a rule being edited starts from: what it says, and nothing for a new one. */
export function picksOfRule(group: RuleGroup | undefined): StatementPicks {
  const picks = picksOf('inherit')
  if (!group) return picks
  const audit = group.statements.audit
  const intent = group.statements.intent
  if (audit?.dimension === 'audit') picks.audit = audit.value
  if (
    intent?.dimension === 'intent' &&
    (intent.value === 'indexable' || intent.value === 'not-indexable')
  ) {
    picks.intent = intent.value
  }
  for (const condition of AUDIT_CONDITIONS) {
    const rule = group.statements[condition]
    if (rule && rule.dimension === condition) picks.conditions[condition] = rule.value
  }
  return picks
}

// --- the summary of a rule ------------------------------------------------------------------------

export type SummaryPart =
  | { kind: 'audit'; value: AuditValue }
  | { kind: 'intent'; value: IndexIntent }
  | { kind: 'condition'; condition: AuditCondition; requirement: Requirement }

/** What a rule states, in the order the editor shows it: nothing for what it leaves out. */
export function summaryParts(group: RuleGroup): SummaryPart[] {
  const picks = picksOfRule(group)
  return [
    ...(picks.intent === 'indexable' || picks.intent === 'not-indexable'
      ? [{ kind: 'intent', value: picks.intent } as const]
      : []),
    ...AUDIT_CONDITIONS.flatMap((condition) => {
      const requirement = picks.conditions[condition]
      return requirement === 'inherit' || requirement === 'keep'
        ? []
        : [{ kind: 'condition', condition, requirement } as const]
    }),
    ...(picks.audit === 'exclude' || picks.audit === 'include'
      ? [{ kind: 'audit', value: picks.audit } as const]
      : []),
  ]
}

export interface SummaryWords {
  audit: (value: AuditValue) => string
  intent: (value: IndexIntent) => string
  condition: (condition: AuditCondition, requirement: Requirement) => string
}

/** "Not indexable · noindex indifferent · not in sitemap": a rule in one line of plain words. */
export function summaryLine(parts: readonly SummaryPart[], words: SummaryWords): string {
  return parts
    .map((part) =>
      part.kind === 'audit'
        ? words.audit(part.value)
        : part.kind === 'intent'
          ? words.intent(part.value)
          : words.condition(part.condition, part.requirement),
    )
    .join(' · ')
}
