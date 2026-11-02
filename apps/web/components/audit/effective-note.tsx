import { useTranslations } from 'next-intl'
import { useSelectorText } from '@/components/audit/selector-label'
import type { UrlAuditCurrent } from '@/lib/audit-rules'

/**
 * Under a choice: what the URL is under the rules in force, and which rule (or exception) says so.
 * Always the effective result, never a guess from the choice: choosing "according to the rules"
 * shows what the rules give, not a copy of it.
 */
export function EffectiveNote({
  kind,
  current,
}: {
  kind: 'audit' | 'intent' | 'nofollow'
  current: UrlAuditCurrent
}) {
  const t = useTranslations('AuditState.effective')
  const text = useSelectorText()
  const rule = kind === 'audit' ? current.audit.rule : current.intent.rule
  const by = rule ? text(rule.selector) : ''
  let message: string
  if (kind === 'audit') {
    const excluded = current.audit.value === 'excluded'
    message = !rule
      ? t('audit.default')
      : rule.exception
        ? t(excluded ? 'audit.excludedByException' : 'audit.includedByException')
        : t(excluded ? 'audit.excludedByRule' : 'audit.includedByRule', { rule: by })
  } else if (kind === 'intent') {
    const value = current.intent.value === 'not-indexable' ? 'notIndexable' : 'indexable'
    message = !rule
      ? t('intent.default')
      : rule.exception
        ? t(`intent.${value}ByException`)
        : t(`intent.${value}ByRule`, { rule: by })
  } else {
    const accepted = current.intent.acceptNofollow
    message = !rule
      ? t('nofollow.default')
      : rule.exception
        ? t(accepted ? 'nofollow.acceptedByException' : 'nofollow.notAcceptedByException')
        : t(accepted ? 'nofollow.acceptedByRule' : 'nofollow.notAcceptedByRule', { rule: by })
  }
  return <p className="text-xs text-muted-foreground">{message}</p>
}
