'use client'

import {
  AUDIT_CONDITIONS,
  AUDIT_LIMITS,
  SELECTOR_KINDS,
  SELECTOR_SCOPES,
  type AuditCondition,
  type Requirement,
  type SelectorKind,
  type SelectorScope,
} from '@seotools/core/crawl/audit'
import { ChevronDownIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useState, useTransition } from 'react'
import {
  previewAuditRuleAction,
  saveAuditRuleAction,
  type PreviewState,
  type RuleFormState,
} from '@/app/(protected)/domains/[host]/audit-actions'
import {
  AuditStatements,
  picksOf,
  touchedConditions,
  type StatementPicks,
} from '@/components/audit/audit-statements'
import { RulePreview } from '@/components/audit/rule-preview'
import { Button } from '@/components/ui/button'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { RadioGroup, RadioGroupItem } from '@/components/ui/radio-group'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Switch } from '@/components/ui/switch'
import { Textarea } from '@/components/ui/textarea'
import { useFormActionState } from '@/hooks/use-form-action-state'
import type { RuleGroup } from '@/lib/audit-rules'

type QueryMode = 'any' | 'exact'

/** The picks the fields start from: what the rule being edited says, and nothing for a new one. */
function picksOfGroup(group: RuleGroup | undefined): StatementPicks {
  const picks = picksOf('inherit')
  if (!group) return picks
  const audit = group.statements.audit
  const intent = group.statements.intent
  if (audit?.dimension === 'audit') picks.audit = audit.value
  if (
    intent?.dimension === 'intent' &&
    (intent.value === 'indexable' || intent.value === 'not-indexable')
  ) {
    picks.intent = intent.value
  }
  for (const condition of AUDIT_CONDITIONS) {
    const rule = group.statements[condition]
    if (rule && rule.dimension === condition) {
      picks.conditions[condition] = rule.value as Requirement
    }
  }
  return picks
}

/** The values the fields start from: those of the rule being edited, or blank for a new one. */
function initialOf(group: RuleGroup | undefined) {
  const selector = group?.selector
  return {
    kind: (selector?.kind ?? 'prefix') as SelectorKind,
    address: selector ? (selector.kind === 'url' ? selector.url : selector.path) : '',
    query: (selector && selector.kind !== 'url' ? selector.query.mode : 'any') as QueryMode,
    queryValue:
      selector && selector.kind !== 'url' && selector.query.mode === 'exact'
        ? selector.query.value
        : '',
    scope: (selector && selector.kind !== 'url' ? selector.scope : 'literal') as SelectorScope,
    picks: picksOfGroup(group),
    reason: group?.reason ?? '',
    enabled: group?.enabled ?? true,
  }
}

/** What a pick says in a form: nothing for "not set by this rule", otherwise the value. */
const valueOf = (pick: string) => (pick === 'inherit' || pick === 'keep' ? '' : pick)

/**
 * Creates a rule, or edits one. The same editor as the exceptions of a URL: the same statements
 * (participation, what is asked of each condition, and the expectation of indexing as a whole under
 * "Advanced"), and the same selectors, written as one sentence: where it applies, and what it says
 * there. The query and the language scope are advanced options. It can preview what the rule would do
 * to the last full crawl before saving.
 */
export function RuleForm(props: {
  host: string
  /** The language directories were declared: a shared scope covers nothing before. */
  languagesDeclared: boolean
  /** The rule being edited, with every statement it makes. Absent: a new one. */
  rule?: RuleGroup
  onSaved?: () => void
  onCancel?: () => void
}) {
  // A new rule starts over once it is saved, by mounting the form again; one being edited hands
  // control back to whoever opened it.
  const [round, setRound] = useState(0)
  return (
    <RuleFormFields
      key={round}
      {...props}
      onSaved={() => {
        props.onSaved?.()
        if (!props.rule) setRound((current) => current + 1)
      }}
    />
  )
}

function RuleFormFields({
  host,
  languagesDeclared,
  rule,
  onSaved,
  onCancel,
}: {
  host: string
  languagesDeclared: boolean
  rule?: RuleGroup
  onSaved: () => void
  onCancel?: () => void
}) {
  const t = useTranslations('AuditRules')
  const [state, onSubmit, saving] = useFormActionState<RuleFormState>(
    saveAuditRuleAction.bind(null, host),
    {},
  )
  const start = initialOf(rule)
  const [kind, setKind] = useState<SelectorKind>(start.kind)
  const [address, setAddress] = useState(start.address)
  const [query, setQuery] = useState<QueryMode>(start.query)
  const [queryValue, setQueryValue] = useState(start.queryValue)
  const [scope, setScope] = useState<SelectorScope>(start.scope)
  const [picks, setPicks] = useState<StatementPicks>(start.picks)
  const [shown, setShown] = useState<AuditCondition[]>(touchedConditions(start.picks, 'inherit'))
  const [reason, setReason] = useState(start.reason)
  const [enabled, setEnabled] = useState(start.enabled)
  // The preview is kept with the form it was worked out for, and only shows while the form is still
  // that one: changing anything that decides what the rule does makes it out of date.
  const [preview, setPreview] = useState<{ form: string; result: PreviewState } | null>(null)
  const [previewing, startPreview] = useTransition()

  // A saved rule is news to whoever holds the form; `state` is a fresh object for every submit.
  useEffect(() => {
    if (state.saved) onSaved()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  const kinds = SELECTOR_KINDS.map((item) => ({ value: item, label: t(`kinds.${item}`) }))
  // An exact URL is always literal; a shared scope is only offered once there are directories to
  // share between (or when the rule being edited already has it).
  const sharedAvailable = languagesDeclared || start.scope === 'shared'
  const scopes = SELECTOR_SCOPES.map((item) => ({
    value: item,
    label: t(`scope.${item}`),
    disabled: item === 'shared' && !sharedAvailable,
  }))
  const idBase = `rule-${rule?.key ?? 'new'}`
  const hasScope = kind !== 'url'
  // What the sentence says apart from its defaults, to open the advanced options when it matters.
  const advancedUsed = hasScope && (query === 'exact' || scope === 'shared')

  // Everything that changes what the rule does. The reason does not.
  const previewInput = {
    id: rule?.ids[0],
    kind,
    selector: address,
    query,
    queryValue,
    scope: hasScope ? scope : 'literal',
    audit: valueOf(picks.audit),
    intent: valueOf(picks.intent),
    noindex: valueOf(picks.conditions.noindex),
    nofollow: valueOf(picks.conditions.nofollow),
    robots: valueOf(picks.conditions.robots),
    sitemap: valueOf(picks.conditions.sitemap),
    enabled,
    reason,
  }
  const formKey = JSON.stringify({ ...previewInput, reason: undefined })

  const runPreview = () =>
    startPreview(async () => {
      const result = await previewAuditRuleAction(host, previewInput)
      setPreview({ form: formKey, result })
    })

  return (
    <form onSubmit={onSubmit} className="grid gap-5">
      {rule && <input type="hidden" name="id" value={rule.ids[0]} />}
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="query" value={query} />
      <input type="hidden" name="scope" value={hasScope ? scope : 'literal'} />
      <input type="hidden" name="audit" value={valueOf(picks.audit)} />
      <input type="hidden" name="intent" value={valueOf(picks.intent)} />
      {AUDIT_CONDITIONS.map((condition) => (
        <input
          key={condition}
          type="hidden"
          name={condition}
          value={valueOf(picks.conditions[condition])}
        />
      ))}
      {enabled && <input type="hidden" name="enabled" value="on" />}

      <div className="grid gap-2">
        <Label htmlFor={`${idBase}-selector`}>{t('form.appliesTo')}</Label>
        <div className="grid gap-2 sm:grid-cols-[minmax(0,17rem)_1fr]">
          <Select
            items={kinds}
            value={kind}
            onValueChange={(next) => next && setKind(next as SelectorKind)}
          >
            <SelectTrigger className="w-full" aria-label={t('form.kind')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {kinds.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Input
            id={`${idBase}-selector`}
            name="selector"
            value={address}
            onChange={(event) => setAddress(event.target.value)}
            placeholder={
              kind === 'url' ? t('form.urlPlaceholder', { host }) : t('form.pathPlaceholder')
            }
            maxLength={AUDIT_LIMITS.selector}
            inputMode="url"
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            className="font-mono"
            required
          />
        </div>
        <p className="text-xs text-muted-foreground">{t(`kindHelp.${kind}`)}</p>
      </div>

      {hasScope && (
        <Collapsible defaultOpen={advancedUsed} className="grid gap-3">
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
            {t('form.advancedSelector')}
          </CollapsibleTrigger>
          <CollapsibleContent className="grid gap-4">
            <fieldset className="grid gap-2">
              <legend className="mb-1 text-sm font-medium">{t('query.label')}</legend>
              <RadioGroup value={query} onValueChange={(next) => setQuery(next as QueryMode)}>
                <Label className="flex items-center gap-2 font-normal">
                  <RadioGroupItem value="any" />
                  {t('query.any')}
                </Label>
                <Label className="flex items-center gap-2 font-normal">
                  <RadioGroupItem value="exact" />
                  {t('query.exact')}
                </Label>
              </RadioGroup>
              {query === 'exact' && (
                <div className="grid gap-2">
                  <Label htmlFor={`${idBase}-query`} className="sr-only">
                    {t('query.valueLabel')}
                  </Label>
                  <Input
                    id={`${idBase}-query`}
                    name="queryValue"
                    value={queryValue}
                    onChange={(event) => setQueryValue(event.target.value)}
                    placeholder={t('query.valuePlaceholder')}
                    maxLength={AUDIT_LIMITS.selector}
                    autoCapitalize="none"
                    autoCorrect="off"
                    spellCheck={false}
                    className="font-mono"
                  />
                  <p className="text-xs text-muted-foreground">{t('query.valueHelp')}</p>
                </div>
              )}
            </fieldset>

            <div className="grid gap-2">
              <Label>{t('scope.label')}</Label>
              <Select
                items={scopes}
                value={scope}
                onValueChange={(next) => next && setScope(next as SelectorScope)}
              >
                <SelectTrigger className="w-full" aria-label={t('scope.label')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {scopes.map((item) => (
                    <SelectItem key={item.value} value={item.value} disabled={item.disabled}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">{t(`scope.${scope}Help`)}</p>
              {!sharedAvailable && (
                <p className="text-xs text-muted-foreground">{t('scope.noLanguages')}</p>
              )}
            </div>
          </CollapsibleContent>
        </Collapsible>
      )}

      <div className="grid gap-2">
        <p className="text-sm font-medium">{t('form.says')}</p>
        <AuditStatements
          mode="single"
          subject="rule"
          picks={picks}
          onChange={setPicks}
          shown={shown}
          onShown={setShown}
          idBase={idBase}
        />
      </div>

      <div className="grid gap-2">
        <Label htmlFor={`${idBase}-reason`}>{t('form.reason')}</Label>
        <Textarea
          id={`${idBase}-reason`}
          name="reason"
          value={reason}
          onChange={(event) => setReason(event.target.value)}
          placeholder={t('form.reasonPlaceholder')}
          maxLength={AUDIT_LIMITS.reason}
          rows={2}
        />
      </div>

      <div className="flex items-start gap-3">
        <Switch
          id={`${idBase}-enabled`}
          checked={enabled}
          onCheckedChange={setEnabled}
          aria-describedby={`${idBase}-enabled-help`}
        />
        <div className="grid gap-0.5">
          <Label htmlFor={`${idBase}-enabled`}>{t('form.enabled')}</Label>
          <p id={`${idBase}-enabled-help`} className="text-xs text-muted-foreground">
            {t('form.enabledHelp')}
          </p>
        </div>
      </div>

      {preview && preview.form === formKey && <RulePreview state={preview.result} />}

      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}

      <div className="flex flex-wrap gap-2">
        <Button type="submit" disabled={saving}>
          {saving ? t('form.saving') : t('form.save')}
        </Button>
        <Button type="button" variant="outline" onClick={runPreview} disabled={previewing}>
          {previewing ? t('form.previewing') : t('form.preview')}
        </Button>
        {onCancel && (
          <Button type="button" variant="ghost" onClick={onCancel}>
            {t('form.cancel')}
          </Button>
        )}
      </div>
    </form>
  )
}
