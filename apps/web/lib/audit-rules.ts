import {
  AUDIT_CONDITIONS,
  compileAuditRules,
  isAuditCondition,
  isConditionRule,
  selectorKey,
  type AuditCondition,
  type AuditParticipation,
  type AuditRule,
  type AuditSelector,
  type AuditSnapshot,
  type AuditValue,
  type IndexIntent,
  type LanguageConfig,
  type RecordedIntent,
  type Requirement,
} from '@seotools/core/crawl/audit'

/**
 * What a URL's configuration points at: the rule that decided it, as the analysis knew it, or
 * nothing. A rule that is gone since (deleted after the crawl was analysed) is told apart from the
 * default, and still described, because the analysis keeps the rules it used.
 */
export type RuleRef = { selector: AuditSelector; reason: string | null } | 'removed' | null

/** The rules an analysis used, by id, as the references the pages show. */
export function ruleRefsOf(snapshot: AuditSnapshot | null): (id: string | null) => RuleRef {
  const byId = new Map(snapshot?.rules.map((rule) => [rule.id, rule]))
  return (id) => {
    if (id === null) return null
    const rule = byId.get(id)
    return rule ? { selector: rule.selector, reason: rule.reason } : 'removed'
  }
}

/** The statements a rule can make about the URLs it covers, in the order the editors show them. */
export const STATEMENTS = ['audit', 'intent', ...AUDIT_CONDITIONS] as const
export type StatementKey = (typeof STATEMENTS)[number]

/**
 * The exceptions set on one exact URL that act, one per statement: what the table and detail edit.
 * A disabled exception does not act, so it is not what the URL has: the resolver ignores it too.
 */
export function explicitRulesOf<R extends AuditRule>(rules: readonly R[], url: string) {
  const about = (dimension: AuditRule['dimension']) =>
    rules.find(
      (rule) =>
        rule.enabled &&
        rule.dimension === dimension &&
        rule.selector.kind === 'url' &&
        rule.selector.url === url,
    ) ?? null
  return {
    audit: about('audit'),
    intent: about('intent'),
    conditions: Object.fromEntries(
      AUDIT_CONDITIONS.map((condition) => [condition, about(condition)]),
    ) as Record<AuditCondition, R | null>,
  }
}

/** What a rule says of itself where a sentence has to name it. */
export type RuleSummary =
  /** It is the exception set on this exact URL. */
  { exception: true } | { exception: false; selector: AuditSelector }

/** What rules ask of a condition of a URL, and which rule says so. `null`: nothing does. */
export interface ConditionOutcome {
  requirement: Requirement | null
  rule: RuleSummary | null
}

/**
 * What a URL is, and what it owes to which rule or exception, for each thing a rule can decide:
 * whether it is audited, the expectation of its indexing as a whole, and each condition on its own.
 */
export interface AuditOutcome {
  audit: { value: AuditParticipation; rule: RuleSummary | null }
  intent: { value: RecordedIntent; rule: RuleSummary | null }
  conditions: Record<AuditCondition, ConditionOutcome>
}

/**
 * What a URL is under the configuration in force now, and what it owes to which rule: the one thing
 * the actions on a URL need to show under each choice. It is not what the last analysis concluded
 * (that is stored with the crawl), but what the next one will.
 */
export interface UrlAuditCurrent extends AuditOutcome {
  /** The exceptions that act on this URL: what each choice starts from. */
  explicit: {
    audit: AuditValue | null
    /** The expectation the exception states, if there is an exception for it. */
    intent: IndexIntent | null
    conditions: Record<AuditCondition, Requirement | null>
  }
  /** What it would be with no exception of its own: the result of choosing "according to the rules". */
  underRules: AuditOutcome
  /** The reason of the exception on this URL, for whichever statement has one. */
  reason: string | null
}

const summaryOf = (rule: AuditRule | null): RuleSummary | null =>
  rule
    ? rule.selector.kind === 'url'
      ? { exception: true }
      : { exception: false, selector: rule.selector }
    : null

export function outcomeOf(
  rules: readonly AuditRule[],
  host: string,
  languages: LanguageConfig,
  url: string,
): AuditOutcome {
  const { audit, intent, conditions } = compileAuditRules(rules, host, { languages }).resolve(url)
  return {
    audit: { value: audit.value, rule: summaryOf(audit.rule) },
    intent: { value: intent.value, rule: summaryOf(intent.rule) },
    conditions: Object.fromEntries(
      AUDIT_CONDITIONS.map((condition) => [
        condition,
        {
          requirement: conditions[condition].requirement,
          rule: summaryOf(conditions[condition].rule),
        },
      ]),
    ) as Record<AuditCondition, ConditionOutcome>,
  }
}

export function currentAuditOf(
  config: { rules: readonly AuditRule[]; languages: LanguageConfig },
  host: string,
  url: string,
): UrlAuditCurrent {
  const explicit = explicitRulesOf(config.rules, url)
  const elsewhere = config.rules.filter(
    (rule) => !(rule.selector.kind === 'url' && rule.selector.url === url),
  )
  const stating = [explicit.audit, explicit.intent, ...Object.values(explicit.conditions)]
  return {
    ...outcomeOf(config.rules, host, config.languages, url),
    explicit: {
      audit: explicit.audit ? (explicit.audit.value as AuditValue) : null,
      intent:
        explicit.intent?.dimension === 'intent' &&
        (explicit.intent.value === 'indexable' || explicit.intent.value === 'not-indexable')
          ? explicit.intent.value
          : null,
      conditions: Object.fromEntries(
        AUDIT_CONDITIONS.map((condition) => {
          const rule = explicit.conditions[condition]
          return [condition, rule && isConditionRule(rule) ? rule.value : null]
        }),
      ) as Record<AuditCondition, Requirement | null>,
    },
    underRules: outcomeOf(elsewhere, host, config.languages, url),
    reason: stating.find((rule) => rule !== null)?.reason ?? null,
  }
}

/** What is picked in the dialog of one URL. `rules` is "according to the rules". */
export interface AuditPicks {
  audit: 'rules' | AuditValue
  intent: 'rules' | IndexIntent
  conditions: Record<AuditCondition, 'rules' | Requirement>
}

const EXCEPTION: RuleSummary = { exception: true }

/**
 * What the URL would be once the picks are saved, worked out the way `planUrlConfig` saves them: a
 * value picked is the exception's, and "according to the rules" is what the rules give. Each
 * statement is its own: none of them states, resets or copies another.
 */
export function outcomeAfter(current: UrlAuditCurrent, picks: AuditPicks): AuditOutcome {
  const rules = current.underRules
  return {
    audit:
      picks.audit === 'rules'
        ? rules.audit
        : {
            value: picks.audit === 'exclude' ? ('excluded' as const) : ('audited' as const),
            rule: EXCEPTION,
          },
    intent: picks.intent === 'rules' ? rules.intent : { value: picks.intent, rule: EXCEPTION },
    conditions: Object.fromEntries(
      AUDIT_CONDITIONS.map((condition) => {
        const pick = picks.conditions[condition]
        return [
          condition,
          pick === 'rules' ? rules.conditions[condition] : { requirement: pick, rule: EXCEPTION },
        ]
      }),
    ) as Record<AuditCondition, ConditionOutcome>,
  }
}

/**
 * The rows of `audit_rules` as the settings page shows them: one rule per selector, with the
 * statements it makes. A statement is a row of its own, so a rule is the rows that share a selector.
 */
export interface RuleGroup<R extends AuditRule = AuditRule> {
  /** What identifies the selector. */
  key: string
  selector: AuditSelector
  /** The row that acts for each statement the rule makes: the enabled one, or the first. */
  statements: Partial<Record<StatementKey, R>>
  /** Every row of the rule, to turn them on, off or away together. */
  ids: string[]
  /** Every row that acts is enabled. A rule with some rows off (from before rules were edited as one) is off. */
  enabled: boolean
  reason: string | null
}

export function groupRules<R extends AuditRule>(rules: readonly R[]): RuleGroup<R>[] {
  const groups = new Map<string, RuleGroup<R>>()
  for (const rule of rules) {
    const key = selectorKey(rule.selector)
    let group = groups.get(key)
    if (!group) {
      group = {
        key,
        selector: rule.selector,
        statements: {},
        ids: [],
        enabled: true,
        reason: null,
      }
      groups.set(key, group)
    }
    group.ids.push(rule.id)
    const statement = rule.dimension as StatementKey
    const current = group.statements[statement]
    // A disabled duplicate never takes the place of the row that acts.
    if (!current || (!current.enabled && rule.enabled)) group.statements[statement] = rule
  }
  for (const group of groups.values()) {
    const acting = Object.values(group.statements)
    group.enabled = acting.length > 0 && acting.every((rule) => rule.enabled)
    group.reason = acting.find((rule) => rule.reason !== null)?.reason ?? null
  }
  return [...groups.values()]
}

/** The statements of a rule that are about conditions, in the order the editors show them. */
export const conditionsOf = (group: RuleGroup): [AuditCondition, Requirement][] =>
  AUDIT_CONDITIONS.flatMap((condition) => {
    const rule = group.statements[condition]
    return rule && isConditionRule(rule) && isAuditCondition(rule.dimension)
      ? [[condition, rule.value] as [AuditCondition, Requirement]]
      : []
  })
