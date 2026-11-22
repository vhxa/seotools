import { CircleAlertIcon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import type { SummaryLine } from '@/lib/compare-summary'
import { crawlBuildLine } from '@/lib/crawl-build'

type Kind = SummaryLine['kind']

/** The name of a setting that differs, as the summary and the chips say it. */
function useSettingName() {
  const t = useTranslations('CrawlCompare.summary')
  return (setting: string, ignored: { added: string[]; removed: string[] }) =>
    setting === 'ignoredParameters' && ignored.added.length + ignored.removed.length > 0
      ? t('ignoredChange', {
          changes: [
            ...ignored.added.map((p) => `+${p}`),
            ...ignored.removed.map((p) => `−${p}`),
          ].join(', '),
        })
      : t(`settings.${setting}` as Parameters<typeof t>[0])
}

/**
 * A pair whose results per URL are gone, in one sentence: nothing else about the pair can be said.
 * `null` when the pair can be compared.
 */
export function ComparisonPruned({ lines }: { lines: SummaryLine[] }) {
  const t = useTranslations('CrawlCompare.summary')
  if (!lines.some((line) => line.kind === 'pruned')) return null
  return (
    <Alert variant="destructive">
      <CircleAlertIcon />
      <AlertDescription>{t('pruned')}</AlertDescription>
    </Alert>
  )
}

/**
 * What differs between the two crawls, as one line of chips: the settings that changed, the builds,
 * a crawl that stopped at its URL limit. Short on purpose; the whole text is `ComparisonSummary`.
 */
export function ComparisonDifferences({ lines }: { lines: SummaryLine[] }) {
  const t = useTranslations('CrawlCompare.differences')
  const tBuild = useTranslations('Crawls.build')
  const name = useSettingName()
  const build = (crawl: Parameters<typeof crawlBuildLine>[0]) =>
    crawlBuildLine(crawl, (key, values) => tBuild(key, values))
  const chips: { key: string; text: string; dashed?: boolean }[] = []
  for (const line of lines) {
    if (line.kind === 'settings') {
      for (const setting of line.changed)
        chips.push({ key: `setting-${setting}`, text: name(setting, line.ignored) })
      if (line.unrecorded.length > 0)
        chips.push({
          key: 'unrecorded',
          text: t('unrecorded', { count: line.unrecorded.length }),
          dashed: true,
        })
    }
    if (line.kind === 'builds' && build(line.base) !== build(line.target))
      chips.push({ key: 'builds', text: t('builds') })
    if (line.kind === 'urls' && line.limited.length > 0)
      chips.push({
        key: 'limited',
        text: t(`limited.${line.limited.length === 2 ? 'both' : (line.limited[0] ?? 'both')}`),
      })
  }
  const settingsKnown = lines.some((line) => line.kind === 'settings')
  return (
    <ul aria-label={t('label')} className="flex min-w-0 flex-wrap items-center gap-1.5">
      <li className="text-sm text-muted-foreground">
        {chips.length === 0 ? (settingsKnown ? t('same') : t('nothing')) : t('differ')}
      </li>
      {chips.map((chip) => (
        <li key={chip.key}>
          <Badge variant="outline" className={chip.dashed ? 'border-dashed' : undefined}>
            {chip.text}
          </Badge>
        </li>
      ))}
    </ul>
  )
}

/**
 * The whole text of the comparison's summary (`summarizeComparison`): which builds ran each crawl,
 * which recorded settings differ, what the URLs one of them lacks come down to and how far findings
 * compare. `kinds` keeps only some of its lines. Plain: it says what is true; the chips and the
 * cards above the list say it short.
 */
export function ComparisonSummary({ lines, kinds }: { lines: SummaryLine[]; kinds?: Kind[] }) {
  const t = useTranslations('CrawlCompare.summary')
  const tCounted = useTranslations('CrawlCompare.why.counted')
  const tNotes = useTranslations('CrawlCompare.summary.caveats')
  const tBuild = useTranslations('Crawls.build')
  const format = useFormatter()
  const name = useSettingName()
  const list = (items: string[]) => format.list(items, { type: 'conjunction' })

  const said = lines
    .filter((line) => !kinds || kinds.includes(line.kind))
    .map((line) => {
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
        case 'settings':
          return (
            <p key="settings">
              {line.changed.length > 0
                ? t('settingsChanged', {
                    list: list(line.changed.map((setting) => name(setting, line.ignored))),
                  })
                : t('settingsSame')}
              {line.unrecorded.length > 0 && (
                <span className="text-muted-foreground">
                  {' '}
                  {t('settingsUnrecorded', {
                    list: list(line.unrecorded.map((setting) => name(setting, line.ignored))),
                  })}
                </span>
              )}
            </p>
          )
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

  return <div className="grid gap-2 text-sm">{said}</div>
}
