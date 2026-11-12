'use server'

import { selectorKey, type AuditSelector } from '@seotools/core'
import { AUDIT_THRESHOLDS } from '@seotools/core/crawl/thresholds'
import { revalidatePath } from 'next/cache'
import { getTranslations } from 'next-intl/server'
import {
  isRuleId,
  parseLanguagesForm,
  parseRuleForm,
  parseRuleIds,
  parseRuleInput,
  parseUrlConfig,
  type RuleError,
  type RuleInput,
  type UrlConfigError,
} from '@/lib/audit-forms'
import { previewRule, type AuditPreview } from '@/lib/audit-preview'
import { parseThresholdsForm } from '@/lib/threshold-forms'
import { getDb } from '@/lib/db'
import { archivedMessage, requireDomainEditor } from '@/lib/workspace'

export interface RuleFormState {
  error?: string
  /** Set after a successful save, to confirm it to the user. */
  saved?: boolean
}

/** Every page that shows what the audit configuration decides. */
function revalidateAudit(host: string) {
  revalidatePath(`/domains/${host}`, 'layout')
}

const errorMessages = () => getTranslations('AuditRules.errors')
type Errors = Awaited<ReturnType<typeof errorMessages>>

const ruleError = (t: Errors, error: RuleError) => t(error)
const languagesError = (t: Errors, error: 'prefix' | 'limit') =>
  error === 'limit' ? t('languagesLimit') : t('languagesPrefix')
const urlError = (t: Errors, error: UrlConfigError) => t(`urls.${error}`)

/** Mutation outcomes the stores report, in words. */
function mutationError(t: Errors, error: 'conflict' | 'not-found' | 'limit') {
  return error === 'not-found' ? t('notFound') : error === 'limit' ? t('limit') : t('conflict')
}

/**
 * Creates a rule, or edits the one the form names with `id` (any of its rows: the rule being edited
 * is every row that has the same selector). A rule says several things about the URLs it covers, each
 * one decided on its own; the form carries them all, and what it leaves out the rule no longer says.
 */
export async function saveAuditRuleAction(
  host: string,
  _previous: RuleFormState,
  formData: FormData,
): Promise<RuleFormState> {
  const { domain } = await requireDomainEditor(host)
  if (domain.archivedAt) return { error: await archivedMessage() }
  const t = await errorMessages()
  const parsed = parseRuleForm(formData, domain.host)
  if (!parsed.ok) return { error: ruleError(t, parsed.error) }
  if (parsed.id !== null && !isRuleId(parsed.id)) return { error: t('notFound') }

  const db = await getDb()
  let editing: string | AuditSelector | undefined
  let selectors = [parsed.selector]
  if (parsed.id !== null) {
    // Looked up in this domain only: an id of another domain is not a rule here.
    const config = await db.audit.config(domain.id)
    const found = config.rules.find((rule) => rule.id === parsed.id)
    if (!found) return { error: t('notFound') }
    editing = found.set ?? found.selector
    if (found.set) {
      const rows = config.rules.filter((rule) => rule.set === found.set)
      const others = rows
        .map((rule) => rule.selector)
        .filter((s) => selectorKey(s) !== selectorKey(found.selector))
      selectors = [
        ...new Map([parsed.selector, ...others].map((s) => [selectorKey(s), s])).values(),
      ]
    }
  }
  const saved = await db.audit.saveRuleSet({
    domainId: domain.id,
    selectors,
    statements: parsed.statements,
    reason: parsed.reason,
    enabled: parsed.enabled,
    ...(editing ? { editing } : {}),
  })
  if (!saved.ok) return { error: mutationError(t, saved.error) }
  revalidateAudit(host)
  return { saved: true }
}

/** Turns a rule on or off. It is every row of the rule: they are one rule as far as anyone sees. */
export async function setAuditRulesEnabledAction(
  host: string,
  ids: unknown,
  enabled: boolean,
): Promise<RuleFormState> {
  const { domain } = await requireDomainEditor(host)
  if (domain.archivedAt) return { error: await archivedMessage() }
  const t = await errorMessages()
  const rules = parseRuleIds(ids)
  if (!rules || typeof enabled !== 'boolean') return { error: t('notFound') }
  const changed = await (
    await getDb()
  ).audit.setRulesEnabled({ domainId: domain.id, ids: rules, enabled })
  if (!changed.ok) return { error: mutationError(t, changed.error) }
  revalidateAudit(host)
  return { saved: true }
}

export async function deleteAuditRulesAction(host: string, ids: unknown): Promise<RuleFormState> {
  const { domain } = await requireDomainEditor(host)
  if (domain.archivedAt) return { error: await archivedMessage() }
  const t = await errorMessages()
  const rules = parseRuleIds(ids)
  if (!rules) return { error: t('notFound') }
  const deleted = await (await getDb()).audit.deleteRules({ domainId: domain.id, ids: rules })
  if (!deleted.ok) return { error: mutationError(t, deleted.error) }
  revalidateAudit(host)
  return { saved: true }
}

export type PreviewState = AuditPreview | { status: 'error'; error: string }

/**
 * What a rule would do to the URLs of the last full crawl, before it is saved. Nothing is written:
 * it checks the input like saving does, and says why it cannot when it cannot.
 */
export async function previewAuditRuleAction(
  host: string,
  input: RuleInput & { id?: unknown },
): Promise<PreviewState> {
  const { domain } = await requireDomainEditor(host)
  const t = await errorMessages()
  // Whatever arrives from a client is checked, including that it is an object at all.
  if (typeof input !== 'object' || input === null) return { status: 'error', error: t('value') }
  // Whether it is on matters: a rule that is off changes what it was deciding, and clashes with none.
  const parsed = parseRuleInput({ ...input, enabled: input.enabled === true }, domain.host)
  if (!parsed.ok) return { status: 'error', error: ruleError(t, parsed.error) }

  const db = await getDb()
  const [crawl, config] = await Promise.all([
    db.crawls.latestWithResults(domain.id, 'full'),
    db.audit.config(domain.id),
  ])
  const edited =
    typeof input.id === 'string' && isRuleId(input.id)
      ? config.rules.find((rule) => rule.id === input.id)
      : null
  const editing = edited ? (edited.set ?? edited.selector) : null
  return previewRule({
    db,
    host: domain.host,
    crawl,
    rules: config.rules,
    languages: config.languages,
    editing,
    candidate: {
      selector: parsed.selector,
      statements: parsed.statements,
      reason: parsed.reason,
      enabled: parsed.enabled,
    },
  })
}

/**
 * Sets what is declared for exact URLs: what the table and the detail of a URL offer. The same
 * model as the rules of the settings page — rules whose selector is that URL — so the three never
 * contradict each other. A statement left out of the request is "no change"; `inherit` removes it.
 */
export async function setUrlAuditAction(host: string, input: unknown): Promise<RuleFormState> {
  const { domain } = await requireDomainEditor(host)
  if (domain.archivedAt) return { error: await archivedMessage() }
  const t = await errorMessages()
  const parsed = parseUrlConfig(input, domain.host)
  if (!parsed.ok) return { error: urlError(t, parsed.error) }
  const { ok: _ok, ...config } = parsed
  const changed = await (
    await getDb()
  ).audit.setUrlConfig({ domainId: domain.id, host: domain.host, ...config })
  if (!changed.ok) return { error: mutationError(t, changed.error) }
  revalidateAudit(host)
  return { saved: true }
}

export interface LanguagesFormState {
  error?: string
  saved?: boolean
}

/**
 * Declares the language directories of the domain, which the rules shared between languages look at.
 * Nothing is deduced from the paths of the site: only what is declared here counts. Changing them
 * moves the version, so the latest crawl is analysed again.
 */
export async function saveAuditLanguagesAction(
  host: string,
  _previous: LanguagesFormState,
  formData: FormData,
): Promise<LanguagesFormState> {
  const { domain } = await requireDomainEditor(host)
  if (domain.archivedAt) return { error: await archivedMessage() }
  const t = await errorMessages()
  const parsed = parseLanguagesForm(formData)
  if (!parsed.ok) return { error: languagesError(t, parsed.error) }
  const saved = await (
    await getDb()
  ).audit.setLanguages({ domainId: domain.id, languages: parsed.languages })
  if (!saved.ok) return { error: mutationError(t, saved.error) }
  revalidateAudit(host)
  return { saved: true }
}

export interface ThresholdsFormState {
  error?: string
  saved?: boolean
}

/**
 * Sets the figures the checks of the domain compare with. Empty fields are the recommended ones.
 * Changing them moves the version, so the latest crawl is analysed again.
 */
export async function saveAuditThresholdsAction(
  host: string,
  _previous: ThresholdsFormState,
  formData: FormData,
): Promise<ThresholdsFormState> {
  const { domain } = await requireDomainEditor(host)
  if (domain.archivedAt) return { error: await archivedMessage() }
  const t = await getTranslations('AuditRules.thresholds.errors')
  const parsed = parseThresholdsForm(formData)
  if (!parsed.ok) {
    if (parsed.error !== 'range' || !parsed.field) return { error: t(parsed.error) }
    const { min, max } = AUDIT_THRESHOLDS[parsed.field]
    const field = (await getTranslations('AuditRules.thresholds.fields'))(`${parsed.field}.label`)
    return { error: t('range', { field, min, max }) }
  }
  const saved = await (
    await getDb()
  ).audit.setThresholds({ domainId: domain.id, thresholds: parsed.thresholds })
  if (!saved.ok) return { error: mutationError(await errorMessages(), saved.error) }
  revalidateAudit(host)
  return { saved: true }
}

/** Asks the worker again to analyse the latest crawl, after a recalculation that failed. */
export async function retryAuditRecomputeAction(host: string): Promise<void> {
  const { domain } = await requireDomainEditor(host)
  await (await getDb()).audit.retryRecompute(domain.id)
  revalidateAudit(host)
}
