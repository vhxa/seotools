'use client'

import {
  AUDIT_CONDITIONS,
  INDEX_INTENTS,
  type AuditCondition,
  type AuditValue,
  type IndexIntent,
  type Requirement,
} from '@seotools/core/crawl/audit'
import { ChevronDownIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useId, type ReactNode } from 'react'
import { PositionControl, type Position } from '@/components/audit/position-control'
import { useSelectorParts } from '@/components/audit/selector-label'
import { useCanEdit } from '@/components/domain-access'
import { InfoHelp } from '@/components/help'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import {
  controlState,
  requirementView,
  resetPick,
  type Inherited,
  type InheritedPicks,
  type Origin,
  type Pick,
  type StatementPicks,
} from '@/lib/audit-editor'

/** What a path or a rule is called where a sentence has to name it: its address, and its query if it asks for one. */
function useSelectorName() {
  const parts = useSelectorParts()
  return (selector: Parameters<ReturnType<typeof useSelectorParts>>[0]) => {
    const { value, query } = parts(selector)
    return selector.kind !== 'url' && selector.query.mode === 'exact'
      ? `${value} (${query})`
      : value
  }
}

/** Where a statement would come from if it were not stated, in words. */
function useOriginText() {
  const t = useTranslations('AuditStatements.control')
  const name = useSelectorName()
  return (origin: Origin): string =>
    origin.kind === 'default'
      ? t('default')
      : origin.kind === 'rules'
        ? origin.selectors.length === 1
          ? t('fromRule', { rule: origin.selectors[0] ? name(origin.selectors[0]) : '' })
          : t('fromRules', { rules: origin.selectors.map(name).join(', ') })
        : t('varies')
}

/**
 * One statement in a compact row: its name with a help button and, to the right, one short line (what
 * applies when it is not stated, or what the rules give without the exception); under them the two
 * buttons, "don't warn either way" for a condition, and the way back. Long explanations are in the
 * help buttons, never in paragraphs. Not stated, it shows what applies and why; stated, it is solid
 * with a way back; for several URLs it starts at "No change", which is not the same as going back to
 * what the rules say.
 */
function Statement<V extends string>({
  label,
  help,
  positions,
  pick,
  onPick,
  inherited,
  mode,
  subject,
  allowed,
  disabled,
}: {
  label: string
  help?: ReactNode
  /** The two positions. */
  positions: readonly Position<V>[]
  pick: Pick<V>
  onPick: (pick: Pick<V>) => void
  inherited: Inherited<V>
  mode: 'single' | 'bulk'
  subject: 'url' | 'rule'
  /** A condition can also be "allowed" (`allowed`): the checkbox says it and explains it. */
  allowed?: { value: V; label: string; help: ReactNode }
  disabled: boolean
}) {
  const t = useTranslations('AuditStatements.control')
  const originText = useOriginText()
  const name = useSelectorName()
  const labelId = useId()
  const lineId = useId()
  const state = controlState(pick, mode, inherited)
  const labelOf = (value: V | null) =>
    positions.find((item) => item.value === value)?.label ??
    (allowed && value === allowed.value ? allowed.label : undefined)

  const stateText = (value: V | null, origin: Origin) => {
    const position = labelOf(value)
    return position ? t('stateOf', { position, origin: originText(origin) }) : originText(origin)
  }

  let line: ReactNode = null
  let title: string | undefined
  if (state.kind === 'nochange') line = t('noChange')
  else if (state.kind === 'removed') line = t('removed')
  else if (state.kind === 'inherited') {
    const { origin } = state
    if (origin.kind === 'varies') {
      line = (
        <>
          <span className="truncate">{originText(origin)}</span>
          <InfoHelp label={label} compact>
            <p className="mb-2">{t('variesHelp')}</p>
            <ul className="grid gap-1">
              {origin.paths.map(({ selector, position: at, origin: from }) => (
                <li key={`${selector.kind}-${name(selector)}`}>
                  <code className="font-mono text-xs break-all">{name(selector)}</code>:{' '}
                  {stateText(
                    at as V | null,
                    from.kind === 'default' ? from : { kind: 'rules', selectors: [from.selector] },
                  )}
                </li>
              ))}
            </ul>
          </InfoHelp>
        </>
      )
    } else line = originText(origin)
  } else if (state.kind === 'stated') {
    if (mode === 'bulk') line = t('setBulk')
    else if (subject === 'url') {
      title = t('without', { state: stateText(inherited.position, inherited.origin) })
      line = title
    }
  }

  // A condition is two buttons and a checkbox; the rest are two buttons.
  const view = allowed ? requirementView(state as never) : null
  const stated = view ? view.button : state.kind === 'stated' ? state.value : null
  const muted = view ? view.mutedButton : state.kind === 'inherited' ? state.position : null

  return (
    <div className="grid min-w-0 gap-1" data-statement>
      <div className="flex min-h-6 items-center gap-1">
        <span id={labelId} className="shrink-0 text-sm font-medium">
          {label}
        </span>
        {help && (
          <InfoHelp label={label} compact>
            {help}
          </InfoHelp>
        )}
        <div className="ml-auto flex min-w-0 items-center gap-1 text-xs text-muted-foreground">
          <span id={lineId} className="truncate" {...(title ? { title } : {})}>
            {line}
          </span>
          {mode === 'bulk' && state.kind !== 'removed' && !disabled && (
            <Button
              type="button"
              variant="ghost"
              size="xs"
              className="shrink-0"
              onClick={() => onPick('inherit')}
            >
              {t('followRules')}
            </Button>
          )}
        </div>
      </div>
      <PositionControl
        labelledBy={labelId}
        describedBy={lineId}
        positions={positions}
        stated={stated as V | null}
        muted={muted as V | null}
        onPick={onPick}
        onReset={() => onPick(resetPick(mode))}
        resetLabel={mode === 'bulk' ? t('resetBulk') : t('reset')}
        disabled={disabled}
        wide={!allowed}
        {...(allowed && view
          ? {
              allowed: {
                label: allowed.label,
                help: allowed.help,
                checked: view.allowed,
                muted: view.mutedAllowed,
                onToggle: () => onPick(view.allowed ? resetPick(mode) : allowed.value),
              },
            }
          : {})}
      />
    </div>
  )
}

/**
 * The statements a rule or an exception can make about the URLs it covers, in the one editor both
 * use. Every condition is always there, in a compact row: two buttons (Required, Forbidden) and "Don't
 * warn either way" (what is stored as `allowed`). One that is not stated shows, muted, what applies
 * to these URLs and where that comes from, and stating it makes it solid with a way back. Whether the
 * URLs are audited and what is expected of their indexing as a whole are advanced, and work the same
 * way. Each statement is its own: none of them states, resets or copies another.
 *
 * For one URL (or one rule) a statement starts from what it has; for several URLs it starts at "No
 * change" and only what is touched is sent.
 */
export function AuditStatements({
  mode,
  subject,
  picks,
  onChange,
  inherited,
  idBase,
  advancedOpen,
  advancedExtra,
}: {
  mode: 'single' | 'bulk'
  /** Exceptions on URLs go back to the rules; a rule just says or does not say. */
  subject: 'url' | 'rule'
  picks: StatementPicks
  onChange: (picks: StatementPicks) => void
  /** What each statement would be if it were not stated, and where that comes from. */
  inherited: InheritedPicks
  idBase: string
  /** Opens "Advanced" to begin with, when something in it is already used. */
  advancedOpen?: boolean
  /** What else goes in "Advanced", after the expectation and the audit. */
  advancedExtra?: ReactNode
}) {
  const t = useTranslations('AuditStatements')
  const tConditions = useTranslations('AuditStatements.conditions')
  const canEdit = useCanEdit()
  const neutral = mode === 'bulk' ? 'keep' : 'inherit'

  const requirements: Position<Requirement>[] = (['required', 'forbidden'] as const).map(
    (value) => ({ value, label: t(`requirement.${value}`) }),
  )
  const expectations: Position<IndexIntent>[] = INDEX_INTENTS.map((value) => ({
    value,
    label: t(`intent.${value}`),
  }))
  const participation: Position<AuditValue>[] = (['include', 'exclude'] as const).map((value) => ({
    value,
    label: t(`audit.${value}`),
  }))

  // What a URL declares can accept findings of the URLs that point at it (`relations.ts`).
  const reaches = (condition: AuditCondition) =>
    (condition === 'noindex' || condition === 'robots') &&
    (picks.conditions[condition] === 'required' || picks.conditions[condition] === 'allowed')
  const startsOpen = advancedOpen ?? (picks.intent !== neutral || picks.audit !== neutral)

  return (
    <div className="grid gap-5">
      <div className="grid gap-4">
        <div className="flex items-center gap-1">
          <p className="text-sm font-medium">{t('conditions.title')}</p>
          <InfoHelp label={t('conditions.title')} compact>
            {mode === 'bulk' ? t('conditions.hintBulk') : t('conditions.hint')}
          </InfoHelp>
        </div>
        {/* Two columns when the dialog is wide enough for them, whatever the screen. */}
        <div className="@container">
          <div className="grid gap-x-8 gap-y-4 @xl:grid-cols-[repeat(2,minmax(0,1fr))]">
            {AUDIT_CONDITIONS.map((condition) => {
              const pick = picks.conditions[condition]
              return (
                <Statement<Requirement>
                  key={condition}
                  label={tConditions(`${condition}.label`)}
                  help={
                    <div className="grid gap-2">
                      <p>
                        {pick !== 'keep' && pick !== 'inherit'
                          ? tConditions(`${condition}.help.${pick}`)
                          : tConditions(`${condition}.default`)}
                      </p>
                      <p>{tConditions('unknown')}</p>
                      {reaches(condition) && <p>{t('relationsNote')}</p>}
                    </div>
                  }
                  positions={requirements}
                  pick={pick}
                  onPick={(next) =>
                    onChange({ ...picks, conditions: { ...picks.conditions, [condition]: next } })
                  }
                  inherited={inherited.conditions[condition]}
                  mode={mode}
                  subject={subject}
                  allowed={{
                    value: 'allowed',
                    label: t('control.dontWarn'),
                    help: tConditions(`${condition}.help.allowed`),
                  }}
                  disabled={!canEdit}
                />
              )
            })}
          </div>
        </div>
      </div>

      <Collapsible defaultOpen={startsOpen} className="grid gap-4" id={`${idBase}-advanced`}>
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
        <CollapsibleContent className="grid gap-5">
          <div className="@container">
            <div className="grid gap-x-8 gap-y-4 @xl:grid-cols-[repeat(2,minmax(0,1fr))]">
              <Statement<IndexIntent>
                label={t('intent.label')}
                help={
                  <div className="grid gap-2">
                    <p>{t('advanced.help')}</p>
                    <p>
                      {picks.intent === 'indexable' || picks.intent === 'not-indexable'
                        ? t(`intent.help.${picks.intent}`)
                        : t('intent.help.default')}
                    </p>
                    {picks.intent === 'not-indexable' && <p>{t('relationsNote')}</p>}
                  </div>
                }
                positions={expectations}
                pick={picks.intent}
                onPick={(next) => onChange({ ...picks, intent: next })}
                inherited={inherited.intent}
                mode={mode}
                subject={subject}
                disabled={!canEdit}
              />
              <Statement<AuditValue>
                label={t('audit.label')}
                help={t('audit.help')}
                positions={participation}
                pick={picks.audit}
                onPick={(next) => onChange({ ...picks, audit: next })}
                inherited={inherited.audit}
                mode={mode}
                subject={subject}
                disabled={!canEdit}
              />
            </div>
          </div>
          {advancedExtra}
        </CollapsibleContent>
      </Collapsible>
    </div>
  )
}
