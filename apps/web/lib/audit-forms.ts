import {
  AUDIT_DIMENSIONS,
  AUDIT_LIMITS,
  AUDIT_VALUES,
  INDEX_INTENTS,
  SELECTOR_KINDS,
  SELECTOR_SCOPES,
  isInternalUrl,
  normalizeCrawlUrl,
  parseAuditReason,
  parseAuditSelector,
  parseLanguagePrefixes,
  type AuditDimension,
  type LanguageConfig,
  type NewAuditRule,
  type SelectorError,
  type SelectorScope,
} from '@seotools/core'
import type { UrlAuditChoice, UrlIntentChoice } from '@seotools/db'

/** Validation of what comes from the audit settings and the actions on URLs, at the boundary. */

export type RuleError = 'dimension' | 'value' | 'kind' | 'scope' | 'reason' | SelectorError

export type RuleResult = { ok: true; rule: NewAuditRule } | { ok: false; error: RuleError }

export interface RuleInput {
  kind: unknown
  selector: unknown
  query: unknown
  queryValue: unknown
  /** `literal` when left out. Only a path or a prefix has one. */
  scope?: unknown
  value: unknown
  /** Intent rules only: accept the page's own `nofollow`. */
  acceptNofollow?: unknown
  reason: unknown
  enabled: boolean
}

const text = (value: unknown) => (typeof value === 'string' ? value : '')

/** What a rule is made of, from untrusted input: the selector is checked against the domain. */
export function parseRuleInput(
  input: RuleInput,
  dimension: AuditDimension,
  host: string,
): RuleResult {
  if (!AUDIT_DIMENSIONS.includes(dimension)) return { ok: false, error: 'dimension' }
  const value = text(input.value)
  const allowed: readonly string[] = dimension === 'audit' ? AUDIT_VALUES : INDEX_INTENTS
  if (!allowed.includes(value)) return { ok: false, error: 'value' }

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

  return {
    ok: true,
    rule: {
      dimension,
      value,
      selector: parsed.selector,
      // A switch that is on sends `on`; only an expectation can accept a nofollow.
      ...(dimension === 'intent'
        ? { acceptNofollow: input.acceptNofollow === true || input.acceptNofollow === 'on' }
        : {}),
      reason,
      enabled: input.enabled,
    } as NewAuditRule,
  }
}

/** The ids of rules are UUIDs: anything else cannot be one, and is not looked up. */
export const isRuleId = (value: unknown): value is string =>
  typeof value === 'string' && /^[0-9a-f-]{36}$/i.test(value)

export function parseRuleForm(
  form: FormData,
  dimension: AuditDimension,
  host: string,
): (RuleResult & { ok: true; id: string | null }) | Extract<RuleResult, { ok: false }> {
  const parsed = parseRuleInput(
    {
      kind: form.get('kind'),
      selector: form.get('selector'),
      query: form.get('query'),
      queryValue: form.get('queryValue'),
      scope: form.get('scope'),
      acceptNofollow: form.get('acceptNofollow'),
      value: form.get('value'),
      reason: form.get('reason'),
      // A switch that is off sends nothing.
      enabled: form.get('enabled') === 'on',
    },
    dimension,
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
      acceptNofollow?: boolean
      /** Left out when the request did not name one: the reasons the exceptions have stay. */
      reason?: string | null
    }
  | { ok: false; error: UrlConfigError }

/**
 * What the table and the detail of a URL send: the URLs, and what to change. A dimension that is not
 * in the request is not touched, so nothing the user did not edit can be reset by saving. Every URL
 * has to be one of the domain; one that is not refuses the whole request, so a change is never
 * applied to some of the URLs asked for. `inherit` is "according to the rules": the exception no
 * longer states an expectation. Whether `nofollow` is accepted is its own choice: it can come with
 * `inherit`, and then only that stays different from the rules.
 */
export function parseUrlConfig(input: unknown, host: string): UrlConfigResult {
  if (typeof input !== 'object' || input === null) return { ok: false, error: 'urls' }
  const { urls, audit, intent, acceptNofollow, reason } = input as Record<string, unknown>
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
  if (audit !== undefined && !auditChoices.includes(audit)) return { ok: false, error: 'choice' }
  if (intent !== undefined && !intentChoices.includes(intent)) return { ok: false, error: 'choice' }
  if (acceptNofollow !== undefined && typeof acceptNofollow !== 'boolean') {
    return { ok: false, error: 'choice' }
  }
  // Asking for nothing is not a request.
  if (audit === undefined && intent === undefined && acceptNofollow === undefined) {
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
    ...(acceptNofollow === undefined ? {} : { acceptNofollow }),
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
