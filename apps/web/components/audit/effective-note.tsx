import type { AuditCondition } from '@seotools/core/crawl/audit'
import { useTranslations } from 'next-intl'
import { useSelectorText } from '@/components/audit/selector-label'
import type { AuditOutcome, RuleSummary } from '@/lib/audit-rules'

/**
 * What a URL is, as a sentence, and which rule (or exception) says so. Always the effective result,
 * never a guess from a choice: choosing "according to the rules" shows what the rules give, not a
 * copy of what the URL has. A condition names its own origin, since each is decided on its own.
 */
export function EffectiveNote({
  kind,
  outcome,
  prefix,
}: {
  kind: 'audit' | 'intent' | AuditCondition
  outcome: AuditOutcome
  /** Introduces the sentence: when it is what the URL is now, or what it will be after saving. */
  prefix?: 'now' | 'afterSave'
}) {
  const t = useTranslations('AuditState.effective')
  const tDialog = useTranslations('AuditDialog.state')
  const tRequirement = useTranslations('AuditStatements.requirement')
  const text = useSelectorText()
  const named = (rule: RuleSummary | null) => (rule && !rule.exception ? text(rule.selector) : '')
  let message: string
  if (kind === 'audit') {
    const { rule, value } = outcome.audit
    const excluded = value === 'excluded'
    message = !rule
      ? t('audit.default')
      : rule.exception
        ? t(excluded ? 'audit.excludedByException' : 'audit.includedByException')
        : t(excluded ? 'audit.excludedByRule' : 'audit.includedByRule', { rule: named(rule) })
  } else if (kind === 'intent') {
    const { rule, value } = outcome.intent
    const key = value === 'not-indexable' ? 'notIndexable' : 'indexable'
    message = !rule
      ? t('intent.default')
      : rule.exception
        ? t(`intent.${key}ByException`)
        : t(`intent.${key}ByRule`, { rule: named(rule) })
  } else {
    const { rule, requirement } = outcome.conditions[kind]
    message =
      !rule || !requirement
        ? t(`condition.default.${kind}`)
        : rule.exception
          ? t('condition.byException', { requirement: tRequirement(requirement) })
          : t('condition.byRule', { requirement: tRequirement(requirement), rule: named(rule) })
  }
  return (
    <p className="text-xs text-muted-foreground">
      {prefix ? tDialog(prefix, { state: message }) : message}
    </p>
  )
}
