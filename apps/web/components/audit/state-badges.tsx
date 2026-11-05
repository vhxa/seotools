import {
  AUDIT_CONDITIONS,
  conditionOutcome,
  type AuditParticipation,
  type ConditionStates,
  type IntentOutcome,
  type RecordedIntent,
} from '@seotools/core/crawl/audit'
import type { IndexabilityState } from '@seotools/core/crawl/indexability'
import { EyeOffIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { SelectorLabel, useSelectorText } from '@/components/audit/selector-label'
import { Badge } from '@/components/ui/badge'
import type { RuleRef } from '@/lib/audit-rules'
import { cn } from '@/lib/utils'

/** Left out of the audit, audited, or not analysed. Never mistaken for "no findings". */
export function ParticipationBadge({
  participation,
  className,
}: {
  participation: AuditParticipation | null
  className?: string
}) {
  const t = useTranslations('AuditState.participation')
  if (participation === null) {
    return (
      <Badge variant="outline" className={cn('font-normal text-muted-foreground', className)}>
        {t('unknown')}
      </Badge>
    )
  }
  return participation === 'excluded' ? (
    <Badge variant="secondary" className={className}>
      <EyeOffIcon aria-hidden />
      {t('excluded')}
    </Badge>
  ) : (
    <span className={cn('text-sm', className)}>{t('audited')}</span>
  )
}

/**
 * What the user expects of the indexation of a URL. It is an intent: not a statement about the
 * index. With no rule behind it, it is the default and says so. `none` is what an analysis from
 * before the default said.
 */
export function IntentBadge({
  intent,
  isDefault = false,
  className,
}: {
  intent: RecordedIntent | null
  /** No rule decided it: the expectation is the default. */
  isDefault?: boolean
  className?: string
}) {
  const t = useTranslations('AuditState.intent')
  if (intent === null) {
    return (
      <Badge variant="outline" className={cn('font-normal text-muted-foreground', className)}>
        {t('unknown')}
      </Badge>
    )
  }
  if (isDefault) {
    return (
      <span className={cn('text-sm text-muted-foreground', className)}>
        {intent === 'indexable' ? t('indexableDefault') : t(intent)}
      </span>
    )
  }
  return (
    <Badge
      variant="outline"
      className={cn(
        'font-normal',
        (intent === 'none' || isDefault) && 'text-muted-foreground',
        className,
      )}
    >
      {isDefault && intent === 'indexable' ? t('indexableDefault') : t(intent)}
    </Badge>
  )
}

/**
 * What rules ask of the conditions of a URL (noindex, nofollow, robots.txt, sitemap), one badge for
 * each that a rule states, with whether the crawl saw it met. A condition nobody states has none.
 * What the crawl could not tell is dashed and says so, never green.
 */
export function ConditionBadges({
  conditions,
  className,
}: {
  conditions: ConditionStates
  className?: string
}) {
  const t = useTranslations('AuditState.conditions')
  const tRequirement = useTranslations('AuditStatements.requirement')
  return AUDIT_CONDITIONS.flatMap((condition) => {
    const state = conditions[condition]
    if (!state) return []
    const outcome = conditionOutcome(state.requirement, state.observed)
    return [
      <Badge
        key={condition}
        variant="outline"
        className={cn(
          'font-normal',
          outcome === 'met' && 'text-emerald-700 dark:text-emerald-400',
          outcome === 'unmet' && 'text-destructive',
          outcome === 'unknown' && 'border-dashed text-muted-foreground',
          className,
        )}
      >
        {t('badge', {
          condition: t(`names.${condition}`),
          requirement: tRequirement(state.requirement),
        })}
        <span>· {t(`outcome.${outcome}`)}</span>
      </Badge>,
    ]
  })
}

/** What the crawl saw, whatever the audit says and whatever is expected. */
export function IndexabilityBadge({
  state,
  blockers = [],
  className,
}: {
  state: IndexabilityState | null
  blockers?: readonly string[]
  className?: string
}) {
  const t = useTranslations('AuditState')
  if (state === null) {
    return (
      <Badge variant="outline" className={cn('font-normal text-muted-foreground', className)}>
        {t('participation.unknown')}
      </Badge>
    )
  }
  if (state === 'indexable') {
    return <span className={cn('text-sm', className)}>{t('indexability.indexable')}</span>
  }
  const title = blockers
    .map((blocker) => (isBlocker(blocker) ? t(`blockers.${blocker}`) : blocker))
    .join('\n')
  return (
    <Badge
      variant="outline"
      title={title || undefined}
      className={cn(
        'font-normal',
        state === 'unknown' && 'border-dashed text-muted-foreground',
        className,
      )}
    >
      {t(`indexability.${state}`)}
    </Badge>
  )
}

const BLOCKERS = ['noindex', 'canonical', 'robots', 'redirect', 'http-error'] as const
const isBlocker = (value: string): value is (typeof BLOCKERS)[number] =>
  (BLOCKERS as readonly string[]).includes(value)

export function BlockerList({ blockers }: { blockers: readonly string[] }) {
  const t = useTranslations('AuditState.blockers')
  if (blockers.length === 0) return null
  return (
    <div className="flex flex-wrap gap-1">
      {blockers.map((blocker) => (
        <Badge key={blocker} variant="outline" className="font-normal">
          {isBlocker(blocker) ? t(blocker) : blocker}
        </Badge>
      ))}
    </div>
  )
}

/** The expectation against the observation, in a sentence. */
export function IntentOutcomeText({ outcome }: { outcome: IntentOutcome }) {
  const t = useTranslations('AuditState.outcome')
  if (outcome === 'none') return null
  return <p className="text-sm text-muted-foreground">{t(outcome)}</p>
}

/** Where a setting comes from: the rule that decided it and the reason it was given. */
export function RuleOrigin({ rule }: { rule: RuleRef }) {
  const t = useTranslations('AuditState.origin')
  const text = useSelectorText()
  if (rule === null) return <span className="text-muted-foreground">{t('default')}</span>
  if (rule === 'removed') return <span className="text-muted-foreground">{t('removed')}</span>
  return (
    <span className="grid gap-1">
      <SelectorLabel selector={rule.selector} />
      <span className="text-xs text-muted-foreground" title={text(rule.selector)}>
        {rule.reason ? t('reason', { reason: rule.reason }) : t('noReason')}
      </span>
    </span>
  )
}
