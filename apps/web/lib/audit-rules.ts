import {
  compileAuditRules,
  type AuditParticipation,
  type AuditRule,
  type AuditSelector,
  type AuditSnapshot,
  type AuditValue,
  type IndexIntent,
  type LanguageConfig,
  type RecordedIntent,
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

/**
 * The exceptions set on one exact URL that act, one per dimension: what the table and detail edit.
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
  return { audit: about('audit'), intent: about('intent') }
}

/** What a rule says of itself where a sentence has to name it. */
export type RuleSummary =
  /** It is the exception set on this exact URL. */
  { exception: true } | { exception: false; selector: AuditSelector }

/**
 * What a URL is, and what it owes to which rule or exception, for each thing a rule can decide.
 * `acceptRule` is where `nofollow` comes from, which is not always where the expectation does: an
 * exception can say only that.
 */
export interface AuditOutcome {
  audit: { value: AuditParticipation; rule: RuleSummary | null }
  intent: {
    value: RecordedIntent
    rule: RuleSummary | null
    acceptNofollow: boolean
    acceptRule: RuleSummary | null
  }
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
    /** The expectation the exception states; `null` if there is none or it leaves it to the rules. */
    intent: IndexIntent | null
    /** The URL has an exception about its expectation or its `nofollow`, whichever it states. */
    hasIntentException: boolean
  }
  /** What it would be with no exception of its own: the result of choosing "according to the rules". */
  underRules: AuditOutcome
  /** The reason of the exception on this URL, for whichever dimension has one. */
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
  const { audit, intent } = compileAuditRules(rules, host, { languages }).resolve(url)
  return {
    audit: { value: audit.value, rule: summaryOf(audit.rule) },
    intent: {
      value: intent.value,
      rule: summaryOf(intent.rule),
      acceptNofollow: intent.acceptNofollow,
      acceptRule: summaryOf(intent.acceptRule),
    },
  }
}

export function currentAuditOf(
  config: { rules: readonly AuditRule[]; languages: LanguageConfig },
  host: string,
  url: string,
): UrlAuditCurrent {
  const explicit = explicitRulesOf(config.rules, url)
  const exception = explicit.intent
  const elsewhere = config.rules.filter(
    (rule) => !(rule.selector.kind === 'url' && rule.selector.url === url),
  )
  return {
    ...outcomeOf(config.rules, host, config.languages, url),
    explicit: {
      audit: explicit.audit ? (explicit.audit.value as AuditValue) : null,
      intent:
        exception?.dimension === 'intent' &&
        (exception.value === 'indexable' || exception.value === 'not-indexable')
          ? exception.value
          : null,
      hasIntentException: exception !== null,
    },
    underRules: outcomeOf(elsewhere, host, config.languages, url),
    reason: explicit.audit?.reason ?? exception?.reason ?? null,
  }
}

/** What is picked in the dialog of one URL. */
export interface AuditPicks {
  audit: 'rules' | AuditValue
  intent: 'rules' | IndexIntent
  /** Whether the page's own `nofollow` should be accepted: what the checkbox shows. */
  accept: boolean
}

const EXCEPTION: RuleSummary = { exception: true }

/**
 * What the URL would be once the picks are saved, worked out the way `planUrlConfig` saves them:
 * - a value picked is the exception's; "according to the rules" is what the rules give;
 * - an exception that states an expectation also states `nofollow`; one that does not exists only
 *   when `nofollow` is to differ from what the rules give, and is gone when it is not.
 */
export function outcomeAfter(current: UrlAuditCurrent, picks: AuditPicks): AuditOutcome {
  const rules = current.underRules
  const audit =
    picks.audit === 'rules'
      ? rules.audit
      : {
          value: picks.audit === 'exclude' ? ('excluded' as const) : ('audited' as const),
          rule: EXCEPTION,
        }
  const acceptStated = picks.intent !== 'rules' || picks.accept !== rules.intent.acceptNofollow
  return {
    audit,
    intent: {
      value: picks.intent === 'rules' ? rules.intent.value : picks.intent,
      rule: picks.intent === 'rules' ? rules.intent.rule : EXCEPTION,
      acceptNofollow: picks.accept,
      acceptRule: acceptStated ? EXCEPTION : rules.intent.acceptRule,
    },
  }
}
