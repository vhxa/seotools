'use client'

import {
  AUDIT_CONDITIONS,
  AUDIT_LIMITS,
  defaultScope,
  parseAuditSelector,
  type AuditSelector,
} from '@seotools/core/crawl/audit'
import { AUDIT_RULE_TEMPLATES } from '@seotools/core/crawl/audit-templates'
import { PlusIcon, XIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useEffect, useMemo, useState, useTransition } from 'react'
import {
  previewAuditRuleAction,
  saveAuditRuleAction,
  type PreviewState,
  type RuleFormState,
} from '@/app/(protected)/domains/[host]/audit-actions'
import { useAuditConfig } from '@/components/audit/audit-config'
import { AuditStatements } from '@/components/audit/audit-statements'
import { RulePreview } from '@/components/audit/rule-preview'
import { InfoHelp } from '@/components/help'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
import {
  applyTemplate,
  inheritedOfRule,
  picksOfRule,
  stated,
  type StatementPicks,
} from '@/lib/audit-editor'
import type { RuleGroup } from '@/lib/audit-rules'

type PathKind = 'path' | 'prefix' | 'url'
type QueryMode = 'any' | 'exact'

/** One path of the rule, as it is being written. `key` only tells rows apart while they are edited. */
interface PathRow {
  key: number
  kind: PathKind
  address: string
  query: QueryMode
  queryValue: string
}

const rowOf = (key: number, selector?: AuditSelector): PathRow =>
  selector
    ? {
        key,
        kind: selector.kind,
        address: selector.kind === 'url' ? selector.url : selector.path,
        query: selector.kind !== 'url' ? selector.query.mode : 'any',
        queryValue:
          selector.kind !== 'url' && selector.query.mode === 'exact' ? selector.query.value : '',
      }
    : { key, kind: 'prefix', address: '', query: 'any', queryValue: '' }

const NO_TEMPLATE = 'none'
type TemplateChoice = (typeof AUDIT_RULE_TEMPLATES)[number]['id'] | typeof NO_TEMPLATE

/**
 * Creates a rule, or edits one. The same statements as the exceptions of a URL, in the order the
 * question comes: where it applies (one or more paths, and whether each language directory counts),
 * what it says about every condition (all of them are there, and what is not stated shows what
 * applies instead), then the advanced ones, the reason and whether it is on. A new rule can start
 * from a template, which only fills in the form. It can preview what the rule would do to the last
 * full crawl before saving.
 */
export function RuleForm(props: {
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
  rule,
  onSaved,
  onCancel,
}: {
  rule?: RuleGroup
  onSaved: () => void
  onCancel?: () => void
}) {
  const t = useTranslations('AuditRules')
  const tTemplates = useTranslations('AuditTemplates')
  const { host, rules, languages } = useAuditConfig()
  const [state, onSubmit, saving] = useFormActionState<RuleFormState>(
    saveAuditRuleAction.bind(null, host),
    {},
  )

  // One switch for every path: a rule whose paths are all shared starts on.
  const startsShared = rule
    ? rule.selectors.every((selector) => selector.kind !== 'url' && selector.scope === 'shared')
    : defaultScope(languages) === 'shared'
  const [rows, setRows] = useState<PathRow[]>(
    rule ? rule.selectors.map((selector, index) => rowOf(index, selector)) : [rowOf(0)],
  )
  const [nextKey, setNextKey] = useState(rows.length)
  const [byLanguage, setByLanguage] = useState(startsShared)
  const [template, setTemplate] = useState<TemplateChoice>(NO_TEMPLATE)
  const [picks, setPicks] = useState<StatementPicks>(picksOfRule(rule))
  const [reason, setReason] = useState(rule?.reason ?? '')
  const [enabled, setEnabled] = useState(rule?.enabled ?? true)
  // The preview is kept with the form it was worked out for, and only shows while the form is still
  // that one: changing anything that decides what the rule does makes it out of date.
  const [preview, setPreview] = useState<{ form: string; result: PreviewState } | null>(null)
  const [previewing, startPreview] = useTransition()

  // A saved rule is news to whoever holds the form; `state` is a fresh object for every submit.
  useEffect(() => {
    if (state.saved) onSaved()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [state])

  // An exact URL is an exception on one URL: it is never one of several paths.
  const isUrl = rows.some((row) => row.kind === 'url')
  const editingUrl = rule?.selector.kind === 'url'
  // Sharing between languages only means something once there are directories to share between
  // (or when the rule being edited already shares).
  const languagesOffered = (languages.prefixes.length > 0 || startsShared) && !isUrl
  const scope = languagesOffered && byLanguage ? 'shared' : 'literal'

  // What each path covers, as the selectors the model works with. A path being written is left out
  // until it is valid; with none valid yet the rule is compared with the whole site.
  const selectors = useMemo(() => {
    const valid = rows.flatMap((row) => {
      const parsed = parseAuditSelector(
        row.kind === 'url'
          ? { kind: 'url', value: row.address }
          : {
              kind: row.kind,
              value: row.address,
              query: row.query,
              queryValue: row.queryValue,
              scope,
            },
        host,
      )
      return parsed.ok && row.address.trim() !== '' ? [parsed.selector] : []
    })
    if (valid.length > 0) return valid
    const whole = parseAuditSelector(
      { kind: 'prefix', value: '/', query: 'any', queryValue: '', scope },
      host,
    )
    return whole.ok ? [whole.selector] : []
  }, [rows, scope, host])

  const set = rule ? (Object.values(rule.statements)[0]?.set ?? null) : null
  const inherited = useMemo(
    () => inheritedOfRule({ selectors, ids: rule?.ids ?? [], set, rules, host, languages }),
    [selectors, rule, set, rules, host, languages],
  )

  const idBase = `rule-${rule?.key ?? 'new'}`
  const pathKinds: { value: PathKind; label: string }[] = [
    { value: 'prefix', label: t('form.pathKinds.prefix') },
    { value: 'path', label: t('form.pathKinds.path') },
    ...(editingUrl ? [{ value: 'url' as const, label: t('kinds.url') }] : []),
  ]
  const patch = (key: number, changes: Partial<PathRow>) =>
    setRows((current) => current.map((row) => (row.key === key ? { ...row, ...changes } : row)))

  // Everything that changes what the rule does. The reason does not.
  const previewInput = {
    id: rule?.ids[0],
    paths: rows.map((row) => ({
      kind: row.kind,
      selector: row.address,
      query: row.query,
      queryValue: row.queryValue,
    })),
    scope,
    audit: stated(picks.audit),
    intent: stated(picks.intent),
    noindex: stated(picks.conditions.noindex),
    nofollow: stated(picks.conditions.nofollow),
    robots: stated(picks.conditions.robots),
    sitemap: stated(picks.conditions.sitemap),
    canonical: stated(picks.conditions.canonical),
    unlinked: stated(picks.conditions.unlinked),
    enabled,
    reason,
  }
  const formKey = JSON.stringify({ ...previewInput, reason: undefined })

  const runPreview = () =>
    startPreview(async () => {
      const result = await previewAuditRuleAction(host, previewInput)
      setPreview({ form: formKey, result })
    })

  const chooseTemplate = (id: TemplateChoice) => {
    setTemplate(id)
    setPicks(applyTemplate(AUDIT_RULE_TEMPLATES.find((item) => item.id === id) ?? null))
  }
  const templates: { value: TemplateChoice; label: string }[] = [
    { value: NO_TEMPLATE, label: t('form.noTemplate') },
    ...AUDIT_RULE_TEMPLATES.map((item) => ({
      value: item.id,
      label: tTemplates(`${item.id}.name`),
    })),
  ]

  const queryUsed = rows.some((row) => row.kind !== 'url' && row.query === 'exact')
  const statementsUsed = picks.intent !== 'inherit' || picks.audit !== 'inherit' || queryUsed

  return (
    <form onSubmit={onSubmit} className="grid gap-6">
      {rule && <input type="hidden" name="id" value={rule.ids[0]} />}
      <input type="hidden" name="scope" value={scope} />
      <input type="hidden" name="audit" value={stated(picks.audit)} />
      <input type="hidden" name="intent" value={stated(picks.intent)} />
      {AUDIT_CONDITIONS.map((condition) => (
        <input
          key={condition}
          type="hidden"
          name={condition}
          value={stated(picks.conditions[condition])}
        />
      ))}
      {enabled && <input type="hidden" name="enabled" value="on" />}

      {!rule && (
        <div className="grid gap-1.5">
          <Label htmlFor={`${idBase}-template`}>{t('form.template')}</Label>
          <Select
            items={templates}
            value={template}
            onValueChange={(next) => next && chooseTemplate(next as TemplateChoice)}
          >
            <SelectTrigger id={`${idBase}-template`} className="w-full sm:max-w-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              {templates.map((item) => (
                <SelectItem key={item.value} value={item.value}>
                  {item.value === NO_TEMPLATE ? (
                    item.label
                  ) : (
                    <span className="grid">
                      <span>{item.label}</span>
                      <span className="text-xs text-muted-foreground">
                        {tTemplates(`${item.value}.description`)}
                      </span>
                    </span>
                  )}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
          <p className="min-h-8 text-xs text-muted-foreground">
            {template === NO_TEMPLATE
              ? t('form.templateHelp')
              : tTemplates(`${template}.description`)}
          </p>
        </div>
      )}

      <fieldset className="grid gap-3">
        <legend className="mb-2 flex items-center gap-1 text-sm font-medium">
          {t('form.appliesTo')}
          <InfoHelp label={t('form.appliesTo')}>
            <p>{t('kindHelp.prefix')}</p>
            <p className="mt-2">{t('kindHelp.path')}</p>
            <p className="mt-2">{t('form.appliesHelp')}</p>
          </InfoHelp>
        </legend>
        {rows.map((row, index) => (
          <div key={row.key} className="grid grid-cols-[1fr_auto] items-center gap-2">
            <div className="grid gap-2 sm:grid-cols-[minmax(0,12rem)_1fr]">
              <input type="hidden" name="kind" value={row.kind} />
              <input type="hidden" name="query" value={row.query} />
              <input type="hidden" name="queryValue" value={row.queryValue} />
              <Select
                items={pathKinds}
                value={row.kind}
                onValueChange={(next) => next && patch(row.key, { kind: next as PathKind })}
              >
                <SelectTrigger className="w-full" aria-label={t('form.kind')}>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent alignItemWithTrigger={false}>
                  {pathKinds.map((item) => (
                    <SelectItem key={item.value} value={item.value}>
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              <Input
                id={`${idBase}-path-${index}`}
                name="selector"
                value={row.address}
                onChange={(event) => patch(row.key, { address: event.target.value })}
                placeholder={
                  row.kind === 'url'
                    ? t('form.urlPlaceholder', { host })
                    : t('form.pathPlaceholder')
                }
                aria-label={t('form.path', { number: index + 1 })}
                maxLength={AUDIT_LIMITS.selector}
                inputMode="url"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                className="font-mono"
                required
              />
            </div>
            {/* Always there, so that adding the second path does not move the first. */}
            <Button
              type="button"
              variant="ghost"
              size="icon-sm"
              aria-label={t('form.removePath', { number: index + 1 })}
              title={t('form.removePath', { number: index + 1 })}
              className={rows.length === 1 ? 'invisible' : undefined}
              tabIndex={rows.length === 1 ? -1 : 0}
              onClick={() => setRows((current) => current.filter((item) => item.key !== row.key))}
            >
              <XIcon />
            </Button>
          </div>
        ))}
        <div className="flex min-h-7 items-center gap-3">
          {!isUrl && (
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={rows.length >= AUDIT_LIMITS.pathsPerRule}
              onClick={() => {
                setRows((current) => [...current, rowOf(nextKey)])
                setNextKey(nextKey + 1)
              }}
            >
              <PlusIcon />
              {t('form.addPath')}
            </Button>
          )}
          {rows.length > 1 && (
            <span className="text-xs text-muted-foreground tabular-nums">
              {t('form.pathCount', { count: rows.length, max: AUDIT_LIMITS.pathsPerRule })}
            </span>
          )}
        </div>

        {languagesOffered && (
          <div className="flex items-start gap-3">
            <Switch
              id={`${idBase}-languages`}
              checked={byLanguage}
              onCheckedChange={setByLanguage}
              aria-describedby={`${idBase}-languages-help`}
            />
            <div className="grid gap-0.5">
              <Label htmlFor={`${idBase}-languages`}>{t('form.byLanguage')}</Label>
              <p id={`${idBase}-languages-help`} className="text-xs text-muted-foreground">
                {byLanguage
                  ? t('form.byLanguageOn', {
                      languages: languages.prefixes.join(', ') || '—',
                    })
                  : t('form.byLanguageOff')}
              </p>
            </div>
          </div>
        )}
      </fieldset>

      <AuditStatements
        mode="single"
        subject="rule"
        picks={picks}
        onChange={setPicks}
        inherited={inherited}
        idBase={idBase}
        advancedOpen={statementsUsed}
        advancedExtra={
          rows.some((row) => row.kind !== 'url') ? (
            <fieldset className="grid gap-2">
              <legend className="mb-1 flex items-center gap-1 text-sm font-medium">
                {t('query.label')}
                <InfoHelp label={t('query.label')} compact>
                  <div className="grid gap-2">
                    <p>{t('query.help')}</p>
                    <p>{t('query.example')}</p>
                  </div>
                </InfoHelp>
              </legend>
              {rows.map((row, index) =>
                row.kind === 'url' ? null : (
                  <div
                    key={row.key}
                    className="grid items-center gap-2 sm:grid-cols-[minmax(0,12rem)_minmax(0,12rem)_1fr]"
                  >
                    <code className="truncate font-mono text-xs" title={row.address}>
                      {row.address || t('form.path', { number: index + 1 })}
                    </code>
                    <Select
                      items={[
                        { value: 'any', label: t('query.any') },
                        { value: 'exact', label: t('query.exact') },
                      ]}
                      value={row.query}
                      onValueChange={(next) => next && patch(row.key, { query: next as QueryMode })}
                    >
                      <SelectTrigger
                        className="w-full"
                        aria-label={`${t('query.label')}: ${row.address || index + 1}`}
                      >
                        <SelectValue />
                      </SelectTrigger>
                      <SelectContent alignItemWithTrigger={false}>
                        <SelectItem value="any">{t('query.any')}</SelectItem>
                        <SelectItem value="exact">{t('query.exact')}</SelectItem>
                      </SelectContent>
                    </Select>
                    <Input
                      value={row.queryValue}
                      onChange={(event) => patch(row.key, { queryValue: event.target.value })}
                      placeholder={t('query.valuePlaceholder')}
                      aria-label={t('query.valueLabel')}
                      maxLength={AUDIT_LIMITS.selector}
                      autoCapitalize="none"
                      autoCorrect="off"
                      spellCheck={false}
                      className={row.query === 'exact' ? 'font-mono' : 'invisible font-mono'}
                      tabIndex={row.query === 'exact' ? 0 : -1}
                    />
                  </div>
                ),
              )}
            </fieldset>
          ) : null
        }
      />

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
