'use client'
import { extractorsText } from '@/lib/crawl-extractors'

import {
  EXTRA_CRAWL_FILES,
  enabledExtraFiles,
  type ExtraCrawlFileKind,
} from '@seotools/core/crawl/files'
import {
  CRAWL_RENDERING_AVAILABLE,
  CRAWL_SETTINGS_LIMITS as limits,
  type CrawlSettings,
} from '@seotools/core/crawl/settings'
import { useTranslations } from 'next-intl'
import { useState, type ReactNode } from 'react'
import { saveCrawlSettingsAction, type ActionState } from '@/app/(protected)/domains/[host]/actions'
import { InfoHelp } from '@/components/help'
import { useCanEdit } from '@/components/domain-access'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Textarea } from '@/components/ui/textarea'
import { Switch } from '@/components/ui/switch'
import { useFormActionState } from '@/hooks/use-form-action-state'

type Retention = 'latest' | 'current' | 'all'

const retentionOf = (retainCrawls: number | null): Retention =>
  retainCrawls === null ? 'all' : retainCrawls === 1 ? 'current' : 'latest'

function NumberField({
  name,
  label,
  hint,
  defaultValue,
  min,
  max,
  required = true,
  disabled,
}: {
  name: string
  label: string
  hint: string
  defaultValue: number | string
  min: number
  max: number
  required?: boolean
  disabled: boolean
}) {
  return (
    <div className="grid content-start gap-2">
      <div className="flex items-center gap-1">
        <Label htmlFor={name}>{label}</Label>
        <InfoHelp label={label}>{hint}</InfoHelp>
      </div>
      <Input
        id={name}
        name={name}
        type="number"
        min={min}
        max={max}
        step={1}
        defaultValue={defaultValue}
        required={required}
        disabled={disabled}
      />
    </div>
  )
}

/** One titled group of the form: the fields are all part of the same form and the same save. */
function Section({
  id,
  title,
  description,
  children,
}: {
  id: string
  title: string
  description: string
  children: ReactNode
}) {
  return (
    <Card aria-labelledby={`${id}-title`} role="group">
      <CardHeader>
        <CardTitle id={`${id}-title`}>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="grid gap-6">{children}</CardContent>
    </Card>
  )
}

export function CrawlSettingsForm({
  host,
  settings,
  defaultUserAgent,
  secretsSaved,
}: {
  host: string
  settings: CrawlSettings
  defaultUserAgent: string
  secretsSaved: boolean
}) {
  const t = useTranslations('CrawlSettings')
  const canEdit = useCanEdit()
  const [state, onSubmit, pending] = useFormActionState<ActionState>(
    saveCrawlSettingsAction.bind(null, host),
    {},
  )
  // Controlled: what a choice shows (the hint, the count, the key field) follows it.
  const [mode, setMode] = useState<string>(settings.renderingMode)
  const [retention, setRetention] = useState<Retention>(retentionOf(settings.retainCrawls))
  const [files, setFiles] = useState<readonly ExtraCrawlFileKind[]>(enabledExtraFiles(settings))

  const modes = CRAWL_RENDERING_AVAILABLE.map((value) => ({
    value,
    label: t(`rendering.modes.${value}`),
  }))

  const retentions = (['latest', 'current', 'all'] as const).map((value) => ({
    value,
    label: t(`retention.modes.${value}`),
  }))

  return (
    <form onSubmit={onSubmit} className="grid gap-6">
      {/* Who cannot change the settings still reads them: inputs are disabled, not hidden. */}
      <Section
        id="requests"
        title={t('sections.requests.title')}
        description={t('sections.requests.description')}
      >
        {modes.length > 1 ? (
          <div className="grid gap-2">
            <Label htmlFor="renderingMode">{t('rendering.label')}</Label>
            <Select
              name="renderingMode"
              items={modes}
              value={mode}
              disabled={!canEdit}
              onValueChange={(value) => value && setMode(value)}
            >
              <SelectTrigger id="renderingMode" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {modes.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t('rendering.hint')}</p>
          </div>
        ) : (
          <input type="hidden" name="renderingMode" value={modes[0]?.value ?? mode} />
        )}

        <div className="grid gap-2">
          <Label htmlFor="userAgent">{t('userAgent.label')}</Label>
          <Input
            id="userAgent"
            name="userAgent"
            defaultValue={settings.userAgent ?? ''}
            placeholder={defaultUserAgent}
            maxLength={limits.userAgentLength}
            disabled={!canEdit}
            autoCapitalize="none"
            autoCorrect="off"
            spellCheck={false}
            aria-describedby="userAgent-hint"
          />
          <p id="userAgent-hint" className="text-xs text-muted-foreground">
            {t('userAgent.hint')}
          </p>
        </div>

        <div className="grid gap-4 sm:grid-cols-2">
          <NumberField
            name="concurrency"
            label={t('concurrency.label')}
            hint={t('concurrency.hint')}
            defaultValue={settings.concurrency}
            disabled={!canEdit}
            {...limits.concurrency}
          />
          <NumberField
            name="requestsPerSecond"
            label={t('requestsPerSecond.label')}
            hint={t('requestsPerSecond.hint')}
            defaultValue={settings.requestsPerSecond}
            disabled={!canEdit}
            {...limits.requestsPerSecond}
          />
          <NumberField
            name="timeoutSeconds"
            label={t('timeout.label')}
            hint={t('timeout.hint')}
            defaultValue={settings.timeoutMs / 1000}
            disabled={!canEdit}
            {...limits.timeoutSeconds}
          />
          <NumberField
            name="maxRetries"
            label={t('maxRetries.label')}
            hint={t('maxRetries.hint')}
            defaultValue={settings.maxRetries}
            disabled={!canEdit}
            {...limits.maxRetries}
          />
        </div>
      </Section>

      <Section
        id="scope"
        title={t('sections.scope.title')}
        description={t('sections.scope.description')}
      >
        {(['includePrefixes', 'excludePrefixes'] as const).map((name) => (
          <div key={name} className="grid gap-2">
            <Label htmlFor={name}>{t(`${name}.label`)}</Label>
            <Textarea
              id={name}
              name={name}
              defaultValue={settings[name].join('\n')}
              disabled={!canEdit}
            />
            <p className="text-xs text-muted-foreground">{t(`${name}.hint`)}</p>
          </div>
        ))}
        <NumberField
          name="maxDepth"
          label={t('maxDepth.label')}
          hint={t('maxDepth.hint')}
          defaultValue={settings.maxDepth ?? ''}
          min={1}
          max={100}
          required={false}
          disabled={!canEdit}
        />

        <NumberField
          name="maxUrls"
          label={t('maxUrls.label')}
          hint={t('maxUrls.hint')}
          defaultValue={settings.maxUrls ?? ''}
          required={false}
          disabled={!canEdit}
          {...limits.maxUrls}
        />
      </Section>

      <Section
        id="extraction"
        title={t('sections.extraction.title')}
        description={t('sections.extraction.description')}
      >
        <div className="grid gap-2">
          <Label htmlFor="extractors">{t('extractors.label')}</Label>
          <Textarea
            id="extractors"
            name="extractors"
            defaultValue={extractorsText(settings.extractors)}
            placeholder={t('extractors.placeholder')}
            disabled={!canEdit}
            className="font-mono"
            spellCheck={false}
          />
          <p className="text-xs text-muted-foreground">{t('extractors.hint')}</p>
        </div>
      </Section>

      <Section
        id="retention"
        title={t('sections.retention.title')}
        description={t('sections.retention.description')}
      >
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="grid content-start gap-2">
            <Label htmlFor="retention">{t('retention.label')}</Label>
            <Select
              name="retention"
              items={retentions}
              value={retention}
              disabled={!canEdit}
              onValueChange={(value) => value && setRetention(value as Retention)}
            >
              <SelectTrigger id="retention" className="w-full">
                <SelectValue />
              </SelectTrigger>
              <SelectContent alignItemWithTrigger={false}>
                {retentions.map((item) => (
                  <SelectItem key={item.value} value={item.value}>
                    {item.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <p className="text-xs text-muted-foreground">{t(`retention.hints.${retention}`)}</p>
          </div>
          {retention === 'latest' && (
            <NumberField
              name="retainCrawls"
              label={t('retention.countLabel')}
              hint={t('retention.countHint')}
              defaultValue={settings.retainCrawls ?? 2}
              disabled={!canEdit}
              {...limits.retainCrawls}
            />
          )}
          <NumberField
            name="historyDays"
            label={t('retention.historyLabel')}
            hint={t('retention.historyHint')}
            defaultValue={settings.historyDays ?? ''}
            disabled={!canEdit}
            required={false}
            {...limits.historyDays}
          />
        </div>
      </Section>

      <Section
        id="credentials"
        title={t('requestSecrets.label')}
        description={t('sections.credentials.description')}
      >
        <div className="grid gap-4">
          {secretsSaved && (
            <p className="text-xs text-muted-foreground">{t('requestSecrets.saved')}</p>
          )}
          <div className="grid gap-2">
            <Label htmlFor="requestHeaders">{t('requestSecrets.headers')}</Label>
            <Textarea
              id="requestHeaders"
              name="requestHeaders"
              disabled={!canEdit}
              autoComplete="off"
            />
            <p className="text-xs text-muted-foreground">{t('requestSecrets.hint')}</p>
          </div>
          {(['username', 'password'] as const).map((field) => (
            <div key={field} className="grid gap-2">
              <Label htmlFor={`basic-${field}`}>{t(`requestSecrets.${field}`)}</Label>
              <Input
                id={`basic-${field}`}
                name={field === 'username' ? 'basicUsername' : 'basicPassword'}
                type={field === 'password' ? 'password' : 'text'}
                disabled={!canEdit}
                autoComplete="off"
                maxLength={4096}
              />
            </div>
          ))}
          <div className="flex items-center gap-2">
            <Switch id="clearRequestSecrets" name="clearRequestSecrets" disabled={!canEdit} />
            <Label htmlFor="clearRequestSecrets">{t('requestSecrets.clear')}</Label>
          </div>
        </div>
      </Section>

      <Section id="files" title={t('optionalFiles.label')} description={t('optionalFiles.hint')}>
        <div className="grid gap-4">
          <div className="grid gap-3 sm:grid-cols-2">
            {EXTRA_CRAWL_FILES.map((kind) => (
              <div key={kind} className="flex items-start gap-3">
                <Switch
                  id={`file.${kind}`}
                  name={`file.${kind}`}
                  checked={files.includes(kind)}
                  disabled={!canEdit}
                  onCheckedChange={(checked) =>
                    setFiles((current) =>
                      checked ? [...current, kind] : current.filter((file) => file !== kind),
                    )
                  }
                />
                <div className="grid gap-1">
                  <Label htmlFor={`file.${kind}`}>{t(`optionalFiles.kinds.${kind}.label`)}</Label>
                  <p className="text-xs text-muted-foreground">
                    {t(`optionalFiles.kinds.${kind}.hint`)}
                  </p>
                </div>
              </div>
            ))}
          </div>
          {files.includes('indexnow') && (
            <div className="grid gap-2">
              <Label htmlFor="indexNowKey">{t('optionalFiles.indexNow.label')}</Label>
              <Input
                id="indexNowKey"
                name="indexNowKey"
                defaultValue={settings.indexNowKey ?? ''}
                maxLength={128}
                disabled={!canEdit}
                required
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                aria-describedby="indexNowKey-hint"
              />
              <p id="indexNowKey-hint" className="text-xs text-muted-foreground">
                {t('optionalFiles.indexNow.hint')}
              </p>
            </div>
          )}
        </div>
      </Section>

      {/* Always in reach: the form is long and has one save. */}
      <div className="sticky bottom-0 z-10 -mb-4 flex flex-wrap items-center gap-3 border-t bg-background/95 py-3 backdrop-blur supports-backdrop-filter:bg-background/80">
        {canEdit && (
          <Button type="submit" disabled={pending}>
            {t('save')}
          </Button>
        )}
        {pending && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('saving')}
          </p>
        )}
        {state.saved && !pending && !state.error && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('saved')}
          </p>
        )}
        {state.error && (
          <p role="alert" className="text-sm text-destructive">
            {state.error}
          </p>
        )}
      </div>
    </form>
  )
}
