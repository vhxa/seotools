import {
  AUDIT_CONDITIONS,
  AUDIT_DIMENSIONS,
  AUDIT_LIMITS,
  AUDIT_VALUES,
  INDEX_INTENTS,
  REQUIREMENTS,
  SELECTOR_KINDS,
  SELECTOR_SCOPES,
  isInternalUrl,
  normalizeCrawlUrl,
  parseAuditReason,
  parseAuditSelector,
  parseLanguagePrefixes,
  type AuditCondition,
  type AuditSelector,
  type LanguageConfig,
  type SelectorError,
  type SelectorScope,
} from '@seotools/core'
import type {
  RuleStatements,
  UrlAuditChoice,
  UrlConditionChoices,
  UrlIntentChoice,
} from '@seotools/db'

/** Validation of what comes from the audit settings and the actions on URLs, at the boundary. */

export type RuleError = 'statements' | 'value' | 'kind' | 'scope' | 'reason' | SelectorError

/** A rule as the editor saves it: where it applies and what it says about those URLs. */
export interface RuleSet {
  selector: AuditSelector
  statements: RuleStatements
  reason: string | null
  enabled: boolean
}

export type RuleResult = ({ ok: true } & RuleSet) | { ok: false; error: RuleError }

export interface RuleInput {
  kind: unknown
  selector: unknown
  query: unknown
  queryValue: unknown
  /** `literal` when left out. Only a path or a prefix has one. */
  scope?: unknown
  /** What the rule says about the audit (`exclude`, `include`) or nothing (`''`). */
  audit?: unknown
  /** What it says about the expectation of indexing as a whole (an advanced concept) or nothing. */
  intent?: unknown
  /** What it asks of each condition, or nothing: `required`, `allowed`, `forbidden` or `''`. */
  noindex?: unknown
  nofollow?: unknown
  robots?: unknown
  sitemap?: unknown
  canonical?: unknown
  unlinked?: unknown
  reason: unknown
  enabled: boolean
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')

/** What a statement says when it says something: a value of its set, nothing, or an error. */
function statementValue<V extends string>(
  value: unknown,
  allowed: readonly V[],
): { ok: true; value: V | undefined } | { ok: false } {
  if (value === undefined || value === null || value === '') return { ok: true, value: undefined }
  return typeof value === 'string' && (allowed as readonly string[]).includes(value)
    ? { ok: true, value: value as V }
    : { ok: false }
}

/** What a rule is made of, from untrusted input: the selector is checked against the domain. */
export function parseRuleInput(input: RuleInput, host: string): RuleResult {
  const audit = statementValue(input.audit, AUDIT_VALUES)
  const intent = statementValue(input.intent, INDEX_INTENTS)
  if (!audit.ok || !intent.ok) return { ok: false, error: 'value' }
  const conditions: NonNullable<RuleStatements['conditions']> = {}
  for (const condition of AUDIT_CONDITIONS) {
    const asked = statementValue(input[condition], REQUIREMENTS)
    if (!asked.ok) return { ok: false, error: 'value' }
    if (asked.value !== undefined) conditions[condition] = asked.value
  }
  const statements: RuleStatements = {
    ...(audit.value === undefined ? {} : { audit: audit.value }),
    ...(intent.value === undefined ? {} : { intent: intent.value }),
    ...(Object.keys(conditions).length === 0 ? {} : { conditions }),
  }
  // A rule that says nothing is not a rule.
  if (Object.keys(statements).length === 0) return { ok: false, error: 'statements' }

  const kind = text(input.kind)
  if (!(SELECTOR_KINDS as readonly string[]).includes(kind)) return { ok: false, error: 'kind' }
  const query = text(input.query)
  const scope = text(input.scope) || 'literal'
  if (!(SELECTOR_SCOPES as readonly string[]).includes(scope)) return { ok: false, error: 'scope' }
  const parsed = parseAuditSelector(
    kind === 'url'
      ? { kind: 'url', value: text(input.selector) }
      : {
          kind: kind as 'path' | 'prefix',
          value: text(input.selector),
          query: query === 'exact' ? 'exact' : 'any',
          queryValue: text(input.queryValue),
          scope: scope as SelectorScope,
        },
    host,
  )
  if (!parsed.ok) return parsed

  const reason = parseAuditReason(text(input.reason))
  if (reason === undefined) return { ok: false, error: 'reason' }

  return { ok: true, selector: parsed.selector, statements, reason, enabled: input.enabled }
}

/** The ids of rules are UUIDs: anything else cannot be one, and is not looked up. */
export const isRuleId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)

/** The rules of a request, as the ids they come in: some, each one an id, no more than a rule can have. */
export function parseRuleIds(value: unknown): string[] | null {
  const maxRows = AUDIT_LIMITS.pathsPerRule * AUDIT_DIMENSIONS.length
  if (!Array.isArray(value) || value.length === 0 || value.length > maxRows) return null
  if (!value.every(isRuleId)) return null
  return [...new Set(value as string[])]
}

export function parseRuleForm(
  form: FormData,
  host: string,
): (RuleResult & { id: string | null }) | Extract<RuleResult, { ok: false }> {
  const parsed = parseRuleInput(
    {
      kind: form.get('kind'),
      selector: form.get('selector'),
      query: form.get('query'),
      queryValue: form.get('queryValue'),
      scope: form.get('scope'),
      audit: form.get('audit'),
      intent: form.get('intent'),
      noindex: form.get('noindex'),
      nofollow: form.get('nofollow'),
      robots: form.get('robots'),
      sitemap: form.get('sitemap'),
      canonical: form.get('canonical'),
      unlinked: form.get('unlinked'),
      reason: form.get('reason'),
      // A switch that is off sends nothing.
      enabled: form.get('enabled') === 'on',
    },
    host,
  )
  if (!parsed.ok) return parsed
  const id = text(form.get('id')).trim()
  return { ...parsed, id: id === '' ? null : id }
}

export type UrlConfigError = 'urls' | 'external' | 'choice' | 'reason'

export type UrlConfigResult =
  | {
      ok: true
      urls: string[]
      audit?: UrlAuditChoice
      intent?: UrlIntentChoice
      conditions?: UrlConditionChoices
      /** Left out when the request did not name one: the reasons the exceptions have stay. */
      reason?: string | null
    }
  | { ok: false; error: UrlConfigError }

/**
 * What the table and the detail of a URL send: the URLs, and what to change. A statement that is not
 * in the request is not touched, so nothing the user did not edit can be reset by saving (that is
 * "no change", which is not the same as `inherit`: according to the rules, which removes the
 * exception). Every URL has to be one of the domain; one that is not refuses the whole request, so a
 * change is never applied to some of the URLs asked for.
 */
export function parseUrlConfig(input: unknown, host: string): UrlConfigResult {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'urls' }
  const { urls, audit, intent, conditions, reason } = input as Record<string, unknown>
  if (
    !Array.isArray(urls) ||
    urls.length === 0 ||
    urls.length > AUDIT_LIMITS.bulkUrls ||
    !urls.every((url) => typeof url === 'string')
  ) {
    return { ok: false, error: 'urls' }
  }
  const normalized: string[] = []
  for (const url of urls as string[]) {
    const clean = normalizeCrawlUrl(url)
    if (!clean) return { ok: false, error: 'urls' }
    if (!isInternalUrl(clean, host)) return { ok: false, error: 'external' }
    normalized.push(clean)
  }

  const auditChoices: readonly unknown[] = ['inherit', ...AUDIT_VALUES]
  const intentChoices: readonly unknown[] = ['inherit', ...INDEX_INTENTS]
  const conditionChoices: readonly unknown[] = ['inherit', ...REQUIREMENTS]
  if (audit !== undefined && !auditChoices.includes(audit)) return { ok: false, error: 'choice' }
  if (intent !== undefined && !intentChoices.includes(intent)) return { ok: false, error: 'choice' }

  const chosen: UrlConditionChoices = {}
  if (conditions !== undefined) {
    if (typeof conditions !== 'object' || conditions === null || Array.isArray(conditions)) {
      return { ok: false, error: 'choice' }
    }
    for (const [name, choice] of Object.entries(conditions)) {
      if (!(AUDIT_CONDITIONS as readonly string[]).includes(name))
        return { ok: false, error: 'choice' }
      if (choice === undefined) continue
      if (!conditionChoices.includes(choice)) return { ok: false, error: 'choice' }
      chosen[name as AuditCondition] = choice as UrlConditionChoices[AuditCondition]
    }
  }
  // Asking for nothing is not a request.
  if (audit === undefined && intent === undefined && Object.keys(chosen).length === 0) {
    return { ok: false, error: 'choice' }
  }

  let cleanReason: string | null | undefined
  if (reason !== undefined) {
    cleanReason = parseAuditReason(typeof reason === 'string' ? reason : '')
    if (cleanReason === undefined) return { ok: false, error: 'reason' }
  }

  return {
    ok: true,
    urls: [...new Set(normalized)],
    ...(audit === undefined ? {} : { audit: audit as UrlAuditChoice }),
    ...(intent === undefined ? {} : { intent: intent as UrlIntentChoice }),
    ...(Object.keys(chosen).length === 0 ? {} : { conditions: chosen }),
    ...(cleanReason === undefined ? {} : { reason: cleanReason }),
  }
}

export type LanguagesResult =
  { ok: true; languages: LanguageConfig } | { ok: false; error: 'prefix' | 'limit' }

/** The language directories of the domain, from the form: one per line, or separated by commas. */
export function parseLanguagesForm(form: FormData): LanguagesResult {
  const parsed = parseLanguagePrefixes(text(form.get('prefixes')))
  if (!parsed.ok) return parsed
  // A switch that is off sends nothing.
  return {
    ok: true,
    languages: { prefixes: parsed.prefixes, unprefixed: form.get('unprefixed') === 'on' },
  }
}
