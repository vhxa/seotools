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

/** The exceptions set now on one exact URL, one per dimension: what the table and detail edit. */
export function explicitRulesOf<R extends AuditRule>(rules: readonly R[], url: string) {
  const about = (dimension: AuditRule['dimension']) =>
    rules.find(
      (rule) =>
        rule.dimension === dimension && rule.selector.kind === 'url' && rule.selector.url === url,
    ) ?? null
  return { audit: about('audit'), intent: about('intent') }
}

/** What a rule says of itself where a sentence has to name it. */
export interface RuleSummary {
  selector: AuditSelector
  /** It is the exception set on this exact URL, not a broader rule. */
  exception: boolean
}

/**
 * What a URL is under the configuration in force now, and what it owes to which rule: the one thing
 * the actions on a URL need to show under each choice. It is not what the last analysis concluded
 * (that is stored with the crawl), but what the next one will.
 */
export interface UrlAuditCurrent {
  audit: {
    /** The exception set on this URL, if any: what the selector starts from. */
    explicit: AuditValue | null
    value: AuditParticipation
    rule: RuleSummary | null
  }
  intent: {
    explicit: IndexIntent | null
    value: RecordedIntent
    acceptNofollow: boolean
    rule: RuleSummary | null
  }
  /** The reason of the exception on this URL, for whichever dimension has one. */
  reason: string | null
}

const summaryOf = (rule: AuditRule | null): RuleSummary | null =>
  rule ? { selector: rule.selector, exception: rule.selector.kind === 'url' } : null

export function currentAuditOf(
  config: { rules: readonly AuditRule[]; languages: LanguageConfig },
  host: string,
  url: string,
): UrlAuditCurrent {
  const resolved = compileAuditRules(config.rules, host, { languages: config.languages }).resolve(
    url,
  )
  const explicit = explicitRulesOf(config.rules, url)
  const intentException = explicit.intent
  return {
    audit: {
      explicit: explicit.audit ? (explicit.audit.value as AuditValue) : null,
      value: resolved.audit.value,
      rule: summaryOf(resolved.audit.rule),
    },
    intent: {
      explicit:
        intentException &&
        intentException.dimension === 'intent' &&
        intentException.value !== 'none'
          ? intentException.value
          : null,
      value: resolved.intent.value,
      acceptNofollow: resolved.intent.acceptNofollow,
      rule: summaryOf(resolved.intent.rule),
    },
    reason: explicit.audit?.reason ?? intentException?.reason ?? null,
  }
}
