'use client'

import {
  EXTRA_CRAWL_FILES,
  enabledExtraFiles,
  type ExtraCrawlFileKind,
} from '@seotools/core/crawl/files'
import {
  CRAWL_RENDERING_AVAILABLE,
  CRAWL_RENDERING_MODES,
  CRAWL_SETTINGS_LIMITS as limits,
  type CrawlSettings,
} from '@seotools/core/crawl/settings'
import { useTranslations } from 'next-intl'
import { useState } from 'react'
import { saveCrawlSettingsAction, type ActionState } from '@/app/(protected)/domains/[host]/actions'
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
}: {
  name: string
  label: string
  hint: string
  defaultValue: number | string
  min: number
  max: number
  required?: boolean
}) {
  return (
    <div className="grid content-start gap-2">
      <Label htmlFor={name}>{label}</Label>
      <Input
        id={name}
        name={name}
        type="number"
        min={min}
        max={max}
        step={1}
        defaultValue={defaultValue}
        aria-describedby={`${name}-hint`}
        required={required}
      />
      <p id={`${name}-hint`} className="text-xs text-muted-foreground">
        {hint}
      </p>
    </div>
  )
}

export function CrawlSettingsForm({
  host,
  settings,
  defaultUserAgent,
}: {
  host: string
  settings: CrawlSettings
  defaultUserAgent: string
}) {
  const t = useTranslations('CrawlSettings')
  const [state, onSubmit, pending] = useFormActionState<ActionState>(
    saveCrawlSettingsAction.bind(null, host),
    {},
  )
  // Controlled: what a choice shows (the hint, the count, the key field) follows it.
  const [mode, setMode] = useState<string>(settings.renderingMode)
  const [retention, setRetention] = useState<Retention>(retentionOf(settings.retainCrawls))
  const [files, setFiles] = useState<readonly ExtraCrawlFileKind[]>(enabledExtraFiles(settings))

  const modes = CRAWL_RENDERING_MODES.map((value) => ({
    value,
    label: t(`rendering.modes.${value}`),
    disabled: !CRAWL_RENDERING_AVAILABLE.includes(value),
  }))
  const retentions = (['latest', 'current', 'all'] as const).map((value) => ({
    value,
    label: t(`retention.modes.${value}`),
  }))

  return (
    <form onSubmit={onSubmit} className="grid gap-6">
      <div className="grid gap-2">
        <Label htmlFor="renderingMode">{t('rendering.label')}</Label>
        <Select
          name="renderingMode"
          items={modes}
          value={mode}
          onValueChange={(value) => value && setMode(value)}
        >
          <SelectTrigger id="renderingMode" className="w-full">
            <SelectValue />
          </SelectTrigger>
          <SelectContent alignItemWithTrigger={false}>
            {modes.map((item) => (
              <SelectItem key={item.value} value={item.value} disabled={item.disabled}>
                {item.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
        <p className="text-xs text-muted-foreground">{t('rendering.hint')}</p>
      </div>

      <div className="grid gap-2">
        <Label htmlFor="userAgent">{t('userAgent.label')}</Label>
        <Input
          id="userAgent"
          name="userAgent"
          defaultValue={settings.userAgent ?? ''}
          placeholder={defaultUserAgent}
          maxLength={limits.userAgentLength}
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
          {...limits.concurrency}
        />
        <NumberField
          name="requestsPerSecond"
          label={t('requestsPerSecond.label')}
          hint={t('requestsPerSecond.hint')}
          defaultValue={settings.requestsPerSecond}
          {...limits.requestsPerSecond}
        />
        <NumberField
          name="timeoutSeconds"
          label={t('timeout.label')}
          hint={t('timeout.hint')}
          defaultValue={settings.timeoutMs / 1000}
          {...limits.timeoutSeconds}
        />
        <NumberField
          name="maxRetries"
          label={t('maxRetries.label')}
          hint={t('maxRetries.hint')}
          defaultValue={settings.maxRetries}
          {...limits.maxRetries}
        />
      </div>

      <NumberField
        name="maxUrls"
        label={t('maxUrls.label')}
        hint={t('maxUrls.hint')}
        defaultValue={settings.maxUrls ?? ''}
        required={false}
        {...limits.maxUrls}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <div className="grid content-start gap-2">
          <Label htmlFor="retention">{t('retention.label')}</Label>
          <Select
            name="retention"
            items={retentions}
            value={retention}
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
            defaultValue={settings.retainCrawls ?? 10}
            {...limits.retainCrawls}
          />
        )}
      </div>

      <fieldset className="grid gap-4">
        <div className="grid gap-1">
          <legend className="text-sm font-medium">{t('optionalFiles.label')}</legend>
          <p className="text-xs text-muted-foreground">{t('optionalFiles.hint')}</p>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {EXTRA_CRAWL_FILES.map((kind) => (
            <div key={kind} className="flex items-start gap-3">
              <Switch
                id={`file.${kind}`}
                name={`file.${kind}`}
                checked={files.includes(kind)}
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
      </fieldset>

      {state.error && (
        <p role="alert" className="text-sm text-destructive">
          {state.error}
        </p>
      )}
      <div className="flex items-center gap-3">
        <Button type="submit" disabled={pending}>
          {t('save')}
        </Button>
        {state.saved && !pending && (
          <p role="status" className="text-sm text-muted-foreground">
            {t('saved')}
          </p>
        )}
      </div>
    </form>
  )
}
