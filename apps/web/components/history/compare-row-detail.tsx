import type { UrlSnapshot } from '@seotools/core/crawl/compare'
import { useTranslations } from 'next-intl'
import { CheckNowButton } from '@/components/history/check-now-button'
import { CompareReason, ReasonChip } from '@/components/history/compare-reason'
import { Answer, Text } from '@/components/history/snapshot-cells'
import type { ExplanationState } from '@/lib/compare-summary'
import type { ComparisonRow } from '@/lib/crawl-compare'

/**
 * What the drawer says of a URL one crawl lacks: what that crawl stored of it, why the other one
 * does not have it, in full, and what a recheck made after the later crawl answered. Nothing here
 * is new: it is the table's explanation with room to be read.
 */
export function CompareRowDetail({
  host,
  row,
  baseId,
  targetId,
  ignored,
  state,
  activeRecheckId,
}: {
  host: string
  row: ComparisonRow
  baseId: string
  targetId: string
  ignored: { base: readonly string[]; target: readonly string[] }
  state: ExplanationState
  activeRecheckId: string | null
}) {
  const t = useTranslations('CrawlCompare.detail')
  const side = row.target ? 'target' : 'base'
  const snapshot: UrlSnapshot | null = row.target ?? row.base
  const checkable =
    row.why && row.why.explanation.reason !== 'merged' && row.why.explanation.reason !== 'split'

  return (
    <div className="grid gap-6">
      <section className="grid gap-3">
        <h3 className="text-sm font-medium">{t(side === 'target' ? 'laterHas' : 'earlierHas')}</h3>
        {snapshot && (
          <dl className="grid grid-cols-[6rem_1fr] gap-x-4 gap-y-2 text-sm">
            <dt className="text-muted-foreground">{t('response')}</dt>
            <dd>
              <Answer snapshot={snapshot} />
            </dd>
            <dt className="text-muted-foreground">{t('title')}</dt>
            <dd>
              <Text value={snapshot.title} />
            </dd>
          </dl>
        )}
      </section>
      <section className="grid gap-3">
        <h3 className="text-sm font-medium">{t('why')}</h3>
        <div>
          <ReasonChip why={row.why ?? null} state={state} />
        </div>
        <CompareReason
          large
          host={host}
          url={row.url}
          why={row.why ?? null}
          state={state}
          check={row.check ?? null}
          baseId={baseId}
          targetId={targetId}
          ignored={ignored}
        />
      </section>
      {checkable && (
        <CheckNowButton
          host={host}
          from={baseId}
          to={targetId}
          side={side}
          urlHashes={[row.urlHash]}
          activeRecheckId={activeRecheckId}
        />
      )}
    </div>
  )
}
