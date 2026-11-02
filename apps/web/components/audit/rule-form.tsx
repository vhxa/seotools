'use client'

import {
  AUDIT_LIMITS,
  AUDIT_VALUES,
  INDEX_INTENTS,
  SELECTOR_KINDS,
  SELECTOR_SCOPES,
  type AuditDimension,
  type AuditRule,
  type AuditValue,
  type IndexIntent,
  type SelectorKind,
  type SelectorScope,
} from '@seotools/core/crawl/audit'
import { useTranslations } from 'next-intl'
import { useEffect, useState, useTransition } from 'react'
import {
  previewAuditRuleAction,
  saveAuditRuleAction,
  type PreviewState,
  type RuleFormState,
} from '@/app/(protected)/domains/[host]/audit-actions'
import { RulePreview } from '@/components/audit/rule-preview'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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

type QueryMode = 'any' | 'exact'

/** The values the fields start from: those of the rule being edited, or blank for a new one. */
function initialOf(rule: AuditRule | undefined, dimension: AuditDimension) {
  const selector = rule?.selector
  return {
    kind: (selector?.kind ?? 'prefix') as SelectorKind,
    address: selector ? (selector.kind === 'url' ? selector.url : selector.path) : '',
    query: (selector && selector.kind !== 'url' ? selector.query.mode : 'any') as QueryMode,
    queryValue:
      selector && selector.kind !== 'url' && selector.query.mode === 'exact'
        ? selector.query.value
        : '',
    scope: (selector && selector.kind !== 'url' ? selector.scope : 'literal') as SelectorScope,
    value: rule?.value ?? (dimension === 'audit' ? 'exclude' : 'not-indexable'),
    acceptNofollow: rule?.dimension === 'intent' ? rule.acceptNofollow : false,
    reason: rule?.reason ?? '',
    enabled: rule?.enabled ?? true,
  }
}

/**
 * Creates a rule, or edits one. The same form for exclusions and for expected indexing, and for
 * both the selector system is the same: only what the rule says differs. It can preview what the
 * rule would do to the last full crawl before saving.
 */
export function RuleForm(props: {
  host: string
  dimension: AuditDimension
  /** The domain declared language directories: a shared scope covers nothing before. */
  languagesDeclared: boolean
  /** The rule being edited. Absent: a new one. */
  rule?: AuditRule
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
  dimension,
  languagesDeclared,
  rule,
  onSaved,
  onCancel,
}: {
  host: string
  dimension: AuditDimension
  languagesDeclared: boolean
  rule?: AuditRule
  onSaved: () => void
  onCancel?: () => void
}) {
  const t = useTranslations('AuditRules')
  const [state, onSubmit, saving] = useFormActionState<RuleFormState>(
    saveAuditRuleAction.bind(null, host, dimension),
    {},
  )
  const start = initialOf(rule, dimension)
  const [kind, setKind] = useState<SelectorKind>(start.kind)
  const [address, setAddress] = useState(start.address)
  const [query, setQuery] = useState<QueryMode>(start.query)
  const [queryValue, setQueryValue] = useState(start.queryValue)
  const [scope, setScope] = useState<SelectorScope>(start.scope)
  const [value, setValue] = useState<string>(start.value)
  const [acceptNofollow, setAcceptNofollow] = useState(start.acceptNofollow)
  const [reason, setReason] = useState(start.reason)
  const [enabled, setEnabled] = useState(start.enabled)
  const [preview, setPreview] = useState<PreviewState | null>(null)
  const [previewing, startPreview] = useTransition()

  // A saved rule is news to whoever holds the form; `state` is a fresh object for every submit.
  useEffect(() => {
    if (state.saved) onSaved()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  const values: readonly string[] = dimension === 'audit' ? AUDIT_VALUES : INDEX_INTENTS
  const valueLabel = (item: string) =>
    dimension === 'audit'
      ? t(`values.audit.${item as AuditValue}`)
      : t(`values.intent.${item as IndexIntent}`)
  const valueHelp = (item: string) =>
    dimension === 'audit'
      ? t(`valueHelp.audit.${item as AuditValue}`)
      : t(`valueHelp.intent.${item as IndexIntent}`)
  const items = values.map((item) => ({ value: item, label: valueLabel(item) }))
  const kinds = SELECTOR_KINDS.map((item) => ({ value: item, label: t(`kinds.${item}`) }))
  // An exact URL is always literal; a shared scope is only offered once there are directories to
  // share between (or when the rule being edited already has it).
  const sharedAvailable = languagesDeclared || start.scope === 'shared'
  const scopes = SELECTOR_SCOPES.map((item) => ({
    value: item,
    label: t(`scope.${item}`),
    disabled: item === 'shared' && !sharedAvailable,
  }))
  const idBase = `${dimension}-${rule?.id ?? 'new'}`
  const hasScope = kind !== 'url'

  const runPreview = () =>
    startPreview(async () => {
      setPreview(
        await previewAuditRuleAction(host, dimension, {
          id: rule?.id,
          kind,
          selector: address,
          query,
          queryValue,
          scope: hasScope ? scope : 'literal',
          acceptNofollow: dimension === 'intent' && acceptNofollow,
          value,
          reason,
        }),
      )
    })

  return (
    <form onSubmit={onSubmit} className="grid gap-4">
      {rule && <input type="hidden" name="id" value={rule.id} />}
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="query" value={query} />
      <input type="hidden" name="scope" value={hasScope ? scope : 'literal'} />
      <input type="hidden" name="value" value={value} />
      {dimension === 'intent' && acceptNofollow && (
        <input type="hidden" name="acceptNofollow" value="on" />
      )}
      {enabled && <input type="hidden" name="enabled" value="on" />}

      <div className="grid gap-2">
        <Label>{t('form.value')}</Label>
        <Select items={items} value={value} onValueChange={(next) => next && setValue(next)}>
          <SelectTrigger className="w-full" aria-label={t('form.value')}>
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
        <p className="text-xs text-muted-foreground">{valueHelp(value)}</p>
      </div>

      {dimension === 'intent' && (
        <div className="flex items-start gap-3">
          <Checkbox
            id={`${idBase}-nofollow`}
            checked={acceptNofollow}
            onCheckedChange={(next) => setAcceptNofollow(next === true)}
            aria-describedby={`${idBase}-nofollow-help`}
          />
          <div className="grid gap-0.5">
            <Label htmlFor={`${idBase}-nofollow`}>{t('nofollow.label')}</Label>
            <p id={`${idBase}-nofollow-help`} className="text-xs text-muted-foreground">
              {t('nofollow.help')}
            </p>
          </div>
        </div>
      )}

      <div className="grid gap-2">
        <Label>{t('form.kind')}</Label>
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
        <p className="text-xs text-muted-foreground">{t(`kindHelp.${kind}`)}</p>
      </div>

      {hasScope && (
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
      )}

      <div className="grid gap-2">
        <Label htmlFor={`${idBase}-selector`}>{t('form.selector')}</Label>
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

      {kind !== 'url' && (
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
      )}

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

      {preview && <RulePreview state={preview} />}

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
