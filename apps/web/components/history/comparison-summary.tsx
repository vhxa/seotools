import { CircleAlertIcon, InfoIcon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { Alert, AlertDescription } from '@/components/ui/alert'
import type { SummaryLine } from '@/lib/compare-summary'
import { crawlBuildLine } from '@/lib/crawl-build'

/**
 * The short summary at the top of a comparison (`summarizeComparison`): what differs between the
 * two crawls, what the URLs one of them lacks come down to, and how far findings compare. Plain on
 * purpose: this says what is true; the redesign decides how it looks.
 */
export function ComparisonSummary({ lines }: { lines: SummaryLine[] }) {
  const t = useTranslations('CrawlCompare.summary')
  const tCounted = useTranslations('CrawlCompare.why.counted')
  const tNotes = useTranslations('CrawlCompare.summary.caveats')
  const tBuild = useTranslations('Crawls.build')
  const format = useFormatter()
  const list = (items: string[]) => format.list(items, { type: 'conjunction' })

  if (lines.some((line) => line.kind === 'pruned')) {
    return (
      <Alert variant="destructive">
        <CircleAlertIcon />
        <AlertDescription>{t('pruned')}</AlertDescription>
      </Alert>
    )
  }

  const said = lines.map((line) => {
    switch (line.kind) {
      case 'builds':
        return (
          <p key="builds">
            {t('builds', {
              earlier: crawlBuildLine(line.base, (key, values) => tBuild(key, values)),
              later: crawlBuildLine(line.target, (key, values) => tBuild(key, values)),
            })}
          </p>
        )
      case 'settings': {
        const name = (setting: string) =>
          setting === 'ignoredParameters' &&
          line.ignored.added.length + line.ignored.removed.length > 0
            ? t('ignoredChange', {
                changes: [
                  ...line.ignored.added.map((p) => `+${p}`),
                  ...line.ignored.removed.map((p) => `−${p}`),
                ].join(', '),
              })
            : t(`settings.${setting}` as Parameters<typeof t>[0])
        return (
          <p key="settings">
            {line.changed.length > 0
              ? t('settingsChanged', { list: list(line.changed.map(name)) })
              : t('settingsSame')}
            {line.unrecorded.length > 0 && (
              <span className="text-muted-foreground">
                {' '}
                {t('settingsUnrecorded', { list: list(line.unrecorded.map(name)) })}
              </span>
            )}
          </p>
        )
      }
      case 'urls': {
        if (line.state !== 'done') {
          return <p key="urls">{t(`urls.${line.state}`)}</p>
        }
        const reasons = (items: { reason: string; count: number }[]) =>
          items.length === 0
            ? ''
            : ` (${list(
                items.map((item) =>
                  tCounted(item.reason as Parameters<typeof tCounted>[0], { count: item.count }),
                ),
              )})`
        return (
          <p key="urls">
            {t('urls.done', {
              configuration: line.configuration,
              missing: line.missing,
              added: line.added,
              missingReasons: reasons(line.reasons.missing),
              addedReasons: reasons(line.reasons.added),
            })}
            {line.limited.length > 0 && (
              <>
                {' '}
                {t(`limited.${line.limited.length === 2 ? 'both' : (line.limited[0] ?? 'both')}`)}
              </>
            )}
          </p>
        )
      }
      case 'findings':
        return (
          <p key="findings">
            {t(`findings.${line.basis}`)}
            {line.caveats.length > 0 && (
              <>
                {' '}
                {t('findings.caveats', {
                  list: list(line.caveats.map((code) => tNotes(code))),
                })}
              </>
            )}
          </p>
        )
      case 'pruned':
        return null
    }
  })

  return (
    <Alert>
      <InfoIcon />
      <AlertDescription className="grid gap-1">{said}</AlertDescription>
    </Alert>
  )
}
