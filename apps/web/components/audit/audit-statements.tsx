'use client'

import {
  AUDIT_CONDITIONS,
  AUDIT_VALUES,
  INDEX_INTENTS,
  REQUIREMENTS,
  type AuditCondition,
  type AuditValue,
  type IndexIntent,
  type Requirement,
} from '@seotools/core/crawl/audit'
import { ChevronDownIcon, PlusIcon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import { EffectiveNote } from '@/components/audit/effective-note'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import type { AuditOutcome, UrlAuditCurrent } from '@/lib/audit-rules'

/**
 * What is picked for one statement. `keep` is "no change": nothing is sent, so what the URLs have
 * stays (only when several URLs are being changed). `inherit` is "according to the rules": the
 * exception goes, and the URL takes what the rules say. For a rule it is "this rule says nothing
 * about it". They are different on purpose.
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

/** The conditions a set of picks states or changes, which is what the editor shows to begin with. */
export const touchedConditions = (picks: StatementPicks, neutral: 'keep' | 'inherit') =>
  AUDIT_CONDITIONS.filter((condition) => picks.conditions[condition] !== neutral)

type Item = { value: string; label: string }

function StatementSelect({
  id,
  label,
  items,
  value,
  onValueChange,
  disabled,
  children,
  action,
}: {
  id: string
  label: string
  items: Item[]
  value: string
  onValueChange: (value: string) => void
  disabled?: boolean
  children?: ReactNode
  action?: ReactNode
}) {
  return (
    <div className="grid gap-1.5">
      <div className="flex items-center justify-between gap-2">
        <Label htmlFor={id}>{label}</Label>
        {action}
      </div>
      <Select
        items={items}
        value={value}
        onValueChange={(next) => next && onValueChange(next)}
        disabled={disabled}
      >
        <SelectTrigger id={id} className="w-full" aria-label={label}>
          <SelectValue />
        </SelectTrigger>
        <SelectContent alignItemWithTrigger={false}>
          {items.map((item) => (
            <SelectItem key={item.value} value={item.value}>
              {item.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
      {children}
    </div>
  )
}

/**
 * The statements a rule or an exception can make about the URLs it covers, in the one editor both
 * use: whether they take part in the audit, what is asked of each condition (`noindex`, `nofollow`,
 * robots.txt, sitemap: required, allowed or forbidden) and, as an advanced concept, what is expected
 * of their indexing as a whole. Each statement is its own: none of them states, resets or copies
 * another.
 *
 * Conditions are added one at a time instead of listed, because most URLs need none: the ones with
 * an exception show up, and "Add condition" brings in the rest. For one URL each statement shows what
 * it is now and what the rules give if the exception goes; for several, "No change" comes first so
 * that nothing is touched unless it is chosen.
 */
export function AuditStatements({
  mode,
  subject,
  picks,
  onChange,
  shown,
  onShown,
  idBase,
  current,
  after,
}: {
  /** One URL (or one rule) starts from what it has; several start from "no change". */
  mode: 'single' | 'bulk'
  /** Exceptions on URLs inherit from the rules; a rule just says or does not say. */
  subject: 'url' | 'rule'
  picks: StatementPicks
  onChange: (picks: StatementPicks) => void
  /** The conditions on show. */
  shown: AuditCondition[]
  onShown: (shown: AuditCondition[]) => void
  idBase: string
  /** One URL only: what it is now, and what it will be once saved. */
  current?: UrlAuditCurrent
  after?: AuditOutcome | null
}) {
  const t = useTranslations('AuditStatements')
  const tConditions = useTranslations('AuditStatements.conditions')
  const neutral = mode === 'bulk' ? 'keep' : 'inherit'

  const choose = <V extends string>(values: readonly V[], labelOf: (value: V) => string) => [
    ...(mode === 'bulk' ? [{ value: 'keep', label: t('keep') }] : []),
    { value: 'inherit', label: subject === 'url' ? t('rules') : t('notSet') },
    ...values.map((value) => ({ value, label: labelOf(value) })),
  ]

  const participation = choose([...AUDIT_VALUES].reverse(), (value) => t(`audit.${value}`))
  const expectation = choose(INDEX_INTENTS, (value) => t(`intent.${value}`))
  const requirements = choose(REQUIREMENTS, (value) => t(`requirement.${value}`))

  const hidden = AUDIT_CONDITIONS.filter((condition) => !shown.includes(condition))
  const advancedOpen = picks.intent !== neutral

  const noteFor = (kind: 'audit' | 'intent' | AuditCondition, changed: boolean) => {
    if (subject !== 'url' || mode !== 'single' || !current || !after) return null
    return (
      <div className="grid gap-0.5" aria-live="polite">
        {changed && <EffectiveNote kind={kind} outcome={current} prefix="now" />}
        <EffectiveNote
          kind={kind}
          outcome={changed ? after : current}
          {...(changed ? { prefix: 'afterSave' as const } : {})}
        />
      </div>
    )
  }
  const changedFrom = (pick: string, base: string | undefined) =>
    base !== undefined && pick !== base

  return (
    <div className="grid gap-5">
      <StatementSelect
        id={`${idBase}-audit`}
        label={t('audit.label')}
        items={participation}
        value={picks.audit}
        onValueChange={(value) => onChange({ ...picks, audit: value as StatementPicks['audit'] })}
      >
        <p className="text-xs text-muted-foreground">{t('audit.help')}</p>
        {noteFor(
          'audit',
          changedFrom(picks.audit, current && (current.explicit.audit ?? 'inherit')),
        )}
      </StatementSelect>

      <div className="grid gap-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-sm font-medium">{t('conditions.title')}</p>
          {hidden.length > 0 && (
            <DropdownMenu>
              <DropdownMenuTrigger render={<Button type="button" variant="outline" size="sm" />}>
                <PlusIcon />
                {t('conditions.add')}
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="min-w-56">
                {hidden.map((condition) => (
                  <DropdownMenuItem key={condition} onClick={() => onShown([...shown, condition])}>
                    {tConditions(`${condition}.label`)}
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
        {shown.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            {subject === 'url' ? t('conditions.noneUrl') : t('conditions.noneRule')}
          </p>
        ) : (
          shown.map((condition) => {
            const pick = picks.conditions[condition]
            const stated = pick !== 'keep' && pick !== 'inherit'
            const started = current?.explicit.conditions[condition] ?? null
            return (
              <StatementSelect
                key={condition}
                id={`${idBase}-${condition}`}
                label={tConditions(`${condition}.label`)}
                items={requirements}
                value={pick}
                onValueChange={(value) =>
                  onChange({
                    ...picks,
                    conditions: { ...picks.conditions, [condition]: value },
                  })
                }
                action={
                  // A row nobody asked anything of yet can go; one that has an exception is removed by
                  // choosing "according to the rules", which is what removes the exception.
                  started === null && !stated ? (
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon-sm"
                      aria-label={t('conditions.remove', {
                        condition: tConditions(`${condition}.label`),
                      })}
                      onClick={() => {
                        onChange({
                          ...picks,
                          conditions: { ...picks.conditions, [condition]: neutral },
                        })
                        onShown(shown.filter((other) => other !== condition))
                      }}
                    >
                      <XIcon />
                    </Button>
                  ) : undefined
                }
              >
                <p className="text-xs text-muted-foreground">
                  {stated
                    ? tConditions(`${condition}.help.${pick as Requirement}`)
                    : tConditions(`${condition}.default`)}
                </p>
                {noteFor(condition, changedFrom(pick, current && (started ?? 'inherit')))}
              </StatementSelect>
            )
          })
        )}
        <p className="text-xs text-muted-foreground">{t('conditions.unknown')}</p>
      </div>

      <Collapsible defaultOpen={advancedOpen} className="grid gap-3">
        <CollapsibleTrigger
          render={
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="justify-start gap-1 px-1 [&[data-panel-open]>svg]:rotate-180"
            />
          }
        >
          <ChevronDownIcon className="transition-transform" />
          {t('advanced.title')}
        </CollapsibleTrigger>
        <CollapsibleContent className="grid gap-3">
          <p className="text-xs text-muted-foreground">{t('advanced.help')}</p>
          <StatementSelect
            id={`${idBase}-intent`}
            label={t('intent.label')}
            items={expectation}
            value={picks.intent}
            onValueChange={(value) =>
              onChange({ ...picks, intent: value as StatementPicks['intent'] })
            }
          >
            <p className="text-xs text-muted-foreground">
              {picks.intent === 'indexable' || picks.intent === 'not-indexable'
                ? t(`intent.help.${picks.intent}`)
                : t('intent.help.default')}
            </p>
            {noteFor(
              'intent',
              changedFrom(picks.intent, current && (current.explicit.intent ?? 'inherit')),
            )}
          </StatementSelect>
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
