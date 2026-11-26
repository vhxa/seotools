'use client'
import type { CapacityHardware, CrawlCapacitySample } from '@seotools/core/capacity'
import { CrawlCapacityEstimate } from '@/components/crawl/crawl-capacity-estimate'
import { NumericSlider } from '@/components/numeric-slider'
import type { RenderStatus } from '@seotools/core/render-status'
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

const urlStops = [
  1, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10_000, 25_000, 50_000, 100_000, 250_000, 500_000,
  1_000_000, 2_500_000, 5_000_000, 10_000_000,
]

function includeSavedStop(stops: number[], saved: number | null) {
  return saved === null || stops.includes(saved) ? stops : [...stops, saved].sort((a, b) => a - b)
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
  browserState,
  samples,
  renderSlots,
  hardware,
}: {
  host: string
  settings: CrawlSettings
  defaultUserAgent: string
  secretsSaved: boolean
  browserState: RenderStatus['state'] | 'unknown'
  samples: Record<'html' | 'rendered', CrawlCapacitySample | null>
  renderSlots: number
  hardware: CapacityHardware | null
}) {
  const browser = useTranslations('RenderBrowser')
  const v = useTranslations('Vitals')
  const t = useTranslations('CrawlSettings')
  const canEdit = useCanEdit()
  const [state, onSubmit, pending] = useFormActionState<ActionState>(
    saveCrawlSettingsAction.bind(null, host),
    {},
  )
  // Controlled: what a choice shows (the hint, the count, the key field) follows it.
  const [mode, setMode] = useState<string>(settings.renderingMode)
  const capacity = useTranslations('Capacity')
  const [renderOmitted, setRenderOmitted] = useState(settings.renderOmittedHosts.join('\n'))
  const [numbers, setNumbers] = useState({
    concurrency: settings.concurrency,
    requestsPerSecond: settings.requestsPerSecond,
    timeoutSeconds: Math.round(settings.timeoutMs / 1000),
    maxRetries: settings.maxRetries,
    renderWaitMs: settings.renderWaitMs,
    maxDepth: settings.maxDepth,
    maxUrls: settings.maxUrls,
    retainCrawls: settings.retainCrawls,
    historyDays: settings.historyDays,
  })
  const setNumber = <K extends keyof typeof numbers>(key: K, value: (typeof numbers)[K]) =>
    setNumbers((previous) => ({ ...previous, [key]: value }))
  const [files, setFiles] = useState<readonly ExtraCrawlFileKind[]>(enabledExtraFiles(settings))

  const modes = CRAWL_RENDERING_AVAILABLE.map((value) => ({
    value,
    label: t(`rendering.modes.${value}`),
  }))

  return (
    <form onSubmit={onSubmit} className="grid gap-6">
      <div className="grid gap-2">
        <Label htmlFor="collectVitals">{v('collect')}</Label>
        <Switch
          id="collectVitals"
          name="collectVitals"
          defaultChecked={settings.collectVitals}
          disabled={!canEdit}
        />
        <p className="text-sm text-muted-foreground">{v('privacy')}</p>
      </div>
      {/* Who cannot change the settings still reads them: inputs are disabled, not hidden. */}
      <Section
        id="requests"
        title={t('sections.requests.title')}
        description={t('sections.requests.description')}
      >
        {modes.length > 1 ? (
          <>
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
                    <SelectItem
                      key={item.value}
                      value={item.value}
                      disabled={
                        item.value === 'headless' &&
                        browserState !== 'ready' &&
                        settings.renderingMode !== 'headless'
                      }
                    >
                      {item.label}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
              {browserState !== 'ready' && (
                <p className="text-xs text-muted-foreground">
                  {t('rendering.unavailable', { reason: browser(browserState) })}{' '}
                  <a
                    className="underline"
                    href="https://github.com/vhxa/seotools/blob/main/docs/rendering.md"
                    target="_blank"
                    rel="noreferrer"
                  >
                    {browser('guide')}
                  </a>
                  {settings.renderingMode === 'headless' && ` ${t('rendering.unavailableKept')}`}
                </p>
              )}
              {/* The invisible copy reserves the room, so the warning never moves what is below. */}
              <div className="relative">
                <p aria-hidden className="invisible text-xs">
                  {t('rendering.comparison')}
                </p>
                <p className="absolute inset-0 text-xs text-muted-foreground" aria-live="polite">
                  {mode !== settings.renderingMode ? t('rendering.comparison') : ''}
                </p>
              </div>
            </div>
            <div className="grid gap-4 sm:grid-cols-2">
              <NumericSlider
                name="concurrency"
                label={t('concurrency.label')}
                hint={t('concurrency.hint')}
                value={numbers.concurrency}
                onChange={(value) => setNumber('concurrency', value!)}
                disabled={!canEdit}
                {...limits.concurrency}
              />
              <NumericSlider
                name="requestsPerSecond"
                label={t('requestsPerSecond.label')}
                hint={t('requestsPerSecond.hint')}
                value={numbers.requestsPerSecond}
                onChange={(value) => setNumber('requestsPerSecond', value!)}
                disabled={!canEdit}
                {...limits.requestsPerSecond}
              />
              <NumericSlider
                name="timeoutSeconds"
                label={t('timeout.label')}
                hint={t('timeout.hint')}
                value={numbers.timeoutSeconds}
                onChange={(value) => setNumber('timeoutSeconds', value!)}
                disabled={!canEdit}
                display={(value) => capacity('seconds', { count: value })}
                {...limits.timeoutSeconds}
              />
              <NumericSlider
                name="maxRetries"
                label={t('maxRetries.label')}
                hint={t('maxRetries.hint')}
                value={numbers.maxRetries}
                onChange={(value) => setNumber('maxRetries', value!)}
                disabled={!canEdit}
                {...limits.maxRetries}
              />
            </div>
            <CrawlCapacityEstimate
              samples={samples}
              mode={mode === 'headless' ? 'rendered' : 'html'}
              concurrency={numbers.concurrency}
              requestsPerSecond={numbers.requestsPerSecond}
              maxUrls={numbers.maxUrls}
              slots={renderSlots}
              hardware={hardware}
            />
            {/*
              Part of the Rendered choice: shown in both so nothing moves, disabled under HTML. A
              disabled field is not submitted, so the saved values travel in hidden fields and an
              HTML save never resets them.
            */}
            <div
              role="group"
              aria-label={t('rendering.options')}
              className="grid gap-4 rounded-xl border p-4"
            >
              <p className="text-xs text-muted-foreground">
                {t(mode === 'headless' ? 'rendering.optionsRendered' : 'rendering.optionsHtml')}
              </p>
              {mode !== 'headless' && (
                <>
                  <input type="hidden" name="renderWaitMs" value={numbers.renderWaitMs} />
                  <input type="hidden" name="renderOmittedHosts" value={renderOmitted} />
                </>
              )}
              <NumericSlider
                name="renderWaitMs"
                label={t('rendering.wait')}
                hint={t('rendering.waitHint')}
                min={1000}
                max={30000}
                stops={includeSavedStop(
                  Array.from({ length: 30 }, (_, n) => (n + 1) * 1000),
                  settings.renderWaitMs,
                )}
                value={numbers.renderWaitMs}
                onChange={(value) => setNumber('renderWaitMs', value!)}
                display={(value) => capacity('milliseconds', { count: value })}
                disabled={!canEdit || mode !== 'headless'}
              />
              <div className="grid gap-2">
                <Label htmlFor="renderOmittedHosts">{t('rendering.omitted')}</Label>
                <Textarea
                  id="renderOmittedHosts"
                  {...(mode === 'headless' ? { name: 'renderOmittedHosts' } : {})}
                  value={renderOmitted}
                  onChange={(event) => setRenderOmitted(event.target.value)}
                  disabled={!canEdit || mode !== 'headless'}
                />
                <p className="text-xs text-muted-foreground">{t('rendering.omittedHint')}</p>
              </div>
            </div>
          </>
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
      </Section>

      <Section
        id="scope"
        title={t('sections.scope.title')}
        description={t('sections.scope.description')}
      >
        {(['includePrefixes', 'excludePrefixes', 'ignoredParameters'] as const).map((name) => (
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
        <NumericSlider
          name="maxDepth"
          label={t('maxDepth.label')}
          hint={t('maxDepth.hint')}
          value={numbers.maxDepth}
          onChange={(value) => setNumber('maxDepth', value)}
          min={1}
          max={100}
          unlimited
          disabled={!canEdit}
        />

        <NumericSlider
          name="maxUrls"
          label={t('maxUrls.label')}
          hint={t('maxUrls.hint')}
          value={numbers.maxUrls}
          onChange={(value) => setNumber('maxUrls', value)}
          unlimited
          disabled={!canEdit}
          stops={includeSavedStop(urlStops, settings.maxUrls)}
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
          <input
            type="hidden"
            name="retention"
            value={numbers.retainCrawls === null ? 'all' : 'latest'}
            disabled={!canEdit}
          />
          <NumericSlider
            name="retainCrawls"
            label={t('retention.countLabel')}
            hint={t('retention.countHint')}
            value={numbers.retainCrawls}
            onChange={(value) => setNumber('retainCrawls', value)}
            disabled={!canEdit}
            unlimited
            {...limits.retainCrawls}
          />
          <NumericSlider
            name="historyDays"
            label={t('retention.historyLabel')}
            hint={t('retention.historyHint')}
            value={numbers.historyDays}
            onChange={(value) => setNumber('historyDays', value)}
            disabled={!canEdit}
            unlimited
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
