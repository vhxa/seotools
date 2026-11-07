import {
  fieldChanges,
  issueTimelines,
  keepsUrlHistory,
  reportedIssues,
  type FieldChange,
  type FindingChange,
  type Observation,
  type UnknownReason,
  type UrlSnapshot,
} from '@seotools/core/crawl/compare'
import { compareIssueSeverity, isPageIssueId } from '@seotools/core/crawl/issues'
import type { Crawl, CrawlUrlTrace } from '@seotools/db'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { ParticipationBadge } from '@/components/audit/state-badges'
import { CrawlStatusBadge } from '@/components/crawl/crawl-status-badge'
import { FindingChangeBadge, useReasonText } from '@/components/history/finding-badge'
import { useCrawlMoment } from '@/components/history/crawl-stamp'
import { Answer, NotSet, Robots, Text } from '@/components/history/snapshot-cells'
import { IssueBadge } from '@/components/pages/issue-mark'
import { Badge } from '@/components/ui/badge'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { compareHref, parseCompareQuery } from '@/lib/compare-query'
import { evidenceOf, indexTraces } from '@/lib/crawl-evidence'
import { cn } from '@/lib/utils'

/**
 * What the timeline tells in words. A crawl that has no evidence on one side (pruned, not analysed,
 * the URL not there) leaves a dashed gap in the strip already; saying "unverified" for each issue
 * that is merely the first one the retained crawls know of would only repeat it.
 */
const GAPS: readonly UnknownReason[] = ['pruned', 'unanalysed', 'not-seen']
const worthTelling = (event: FindingChange) =>
  event.kind !== 'persistent' &&
  !(event.kind === 'unverified' && event.reasons.every((reason) => GAPS.includes(reason)))

const CELL_STYLES: Record<Observation['presence'], string> = {
  present: 'border-destructive bg-destructive',
  absent: 'border-emerald-500/60 bg-emerald-500/40',
  unknown: 'border-dashed border-muted-foreground/50 bg-transparent',
}

/** Findings of a URL in each crawl, as a strip from the oldest crawl to the newest. */
function Strip({ cells, crawls }: { cells: Observation[]; crawls: Crawl[] }) {
  const t = useTranslations('CrawlHistory.url.cells')
  const reasonText = useReasonText()
  const when = useCrawlMoment()
  return (
    <span className="flex flex-wrap gap-0.5">
      {cells.map((cell, index) => {
        const crawl = crawls[index]
        if (!crawl) return null
        const label = t(cell.presence === 'unknown' ? 'unknown' : cell.presence, {
          when: when(crawl),
          reason: cell.presence === 'unknown' ? reasonText([cell.reason]) : '',
        })
        return (
          <span
            key={crawl.id}
            title={label}
            className={cn('size-3 rounded-[3px] border', CELL_STYLES[cell.presence])}
          >
            <span className="sr-only">{label}</span>
          </span>
        )
      })}
    </span>
  )
}

/**
 * What every retained full crawl recorded of a URL, newest first, and how its findings went through
 * them. A crawl whose results were pruned has nothing to show and says so; a crawl that cannot say
 * whether the URL had a finding leaves a gap in the strip instead of reading as "no finding".
 * `crawls` are the domain's, oldest first.
 */
export function UrlHistory({
  host,
  urlHash,
  crawls,
  traces,
  viewingId,
}: {
  host: string
  urlHash: string
  crawls: Crawl[]
  traces: CrawlUrlTrace[]
  /** The crawl whose detail is on the page. */
  viewingId: string
}) {
  const t = useTranslations('CrawlHistory.url')
  const tFields = useTranslations('CrawlCompare.fields')
  const when = useCrawlMoment()
  const index = indexTraces(traces)
  const evidence = evidenceOf(crawls, index, urlHash)
  const traceOf = (crawl: Crawl) => index.get(`${crawl.id}:${urlHash}`)
  const defaultCompare = parseCompareQuery({})

  const timelines = issueTimelines(evidence, reportedIssues(evidence)).sort((a, b) =>
    isPageIssueId(a.issue) && isPageIssueId(b.issue)
      ? compareIssueSeverity(a.issue, b.issue) || (a.issue < b.issue ? -1 : 1)
      : a.issue < b.issue
        ? -1
        : 1,
  )

  const rows = crawls
    .map((crawl, position) => {
      const trace = traceOf(crawl)
      // The change is against the crawl before it that still has its results.
      const previous = crawls
        .slice(0, position)
        .reverse()
        .find((candidate) => keepsUrlHistory(candidate))
      const previousTrace = previous ? traceOf(previous) : undefined
      let changes: FieldChange[] = []
      let presence: 'added' | 'missing' | null = null
      if (keepsUrlHistory(crawl) && previous) {
        if (trace && previousTrace) changes = fieldChanges(previousTrace.snapshot, trace.snapshot)
        else if (trace) presence = 'added'
        else if (previousTrace) presence = 'missing'
      }
      return { crawl, trace, previous, changes, presence, position }
    })
    .reverse()

  const findings = (crawl: Crawl, trace: CrawlUrlTrace | undefined) => {
    if (!trace) return <NotSet />
    if (crawl.pagesByWorstIssue === null) return <span>{t('notAnalysed')}</span>
    if (trace.audit === null)
      return <span className="text-muted-foreground">{t('auditUnknown')}</span>
    if (trace.audit.participation === 'excluded') {
      return <ParticipationBadge participation="excluded" />
    }
    return <span className="tabular-nums">{trace.issues.length}</span>
  }

  const snapshotOf = (trace: CrawlUrlTrace): UrlSnapshot => trace.snapshot

  return (
    <div className="grid gap-4">
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description', { count: crawls.length })}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          {crawls.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('empty')}</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('columns.crawl')}</TableHead>
                  <TableHead>{t('columns.answer')}</TableHead>
                  <TableHead>{t('columns.page')}</TableHead>
                  <TableHead>{t('columns.findings')}</TableHead>
                  <TableHead>{t('columns.changes')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map(({ crawl, trace, previous, changes, presence }) => (
                  <TableRow
                    key={crawl.id}
                    aria-current={crawl.id === viewingId ? 'true' : undefined}
                    className={cn(crawl.id === viewingId && 'bg-muted/40')}
                  >
                    <TableCell className="align-top">
                      <div className="grid gap-1">
                        {trace && !crawl.pruned ? (
                          <Link
                            href={`/domains/${host}/pages/details/${urlHash}?crawl=${crawl.id}`}
                            className="text-sm font-medium hover:underline"
                          >
                            {when(crawl)}
                          </Link>
                        ) : (
                          <span className="text-sm font-medium">{when(crawl)}</span>
                        )}
                        <span className="flex flex-wrap gap-1">
                          <CrawlStatusBadge status={crawl.status} />
                          {!keepsUrlHistory(crawl) ? (
                            <Badge variant="secondary" title={t('prunedHint')}>
                              {t('pruned')}
                            </Badge>
                          ) : (
                            crawl.pruned && (
                              <Badge variant="secondary" title={t('compactHint')}>
                                {t('compact')}
                              </Badge>
                            )
                          )}
                          {crawl.id === viewingId && (
                            <Badge variant="outline">{t('viewing')}</Badge>
                          )}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell className="align-top">
                      {!keepsUrlHistory(crawl) ? (
                        <span className="text-sm text-muted-foreground">{t('prunedRow')}</span>
                      ) : trace ? (
                        <Answer snapshot={snapshotOf(trace)} />
                      ) : (
                        <span className="text-sm text-muted-foreground">{t('notSeen')}</span>
                      )}
                    </TableCell>
                    <TableCell className="max-w-xs align-top text-sm">
                      {trace && keepsUrlHistory(crawl) ? (
                        <div className="grid gap-1">
                          <Text value={trace.snapshot.title} />
                          {trace.snapshot.canonical && (
                            <span className="font-mono text-xs break-all text-muted-foreground">
                              {trace.snapshot.canonical}
                            </span>
                          )}
                          <Robots snapshot={trace.snapshot} />
                        </div>
                      ) : null}
                    </TableCell>
                    <TableCell className="align-top text-sm">
                      {keepsUrlHistory(crawl) ? findings(crawl, trace) : null}
                    </TableCell>
                    <TableCell className="align-top">
                      <div className="flex flex-wrap items-center gap-1">
                        {presence && (
                          <Badge variant="secondary">
                            {t(presence === 'added' ? 'appeared' : 'vanished')}
                          </Badge>
                        )}
                        {changes.map((field) => (
                          <Badge key={field} variant="outline">
                            {tFields(field)}
                          </Badge>
                        ))}
                        {previous && (
                          <Link
                            href={compareHref(host, defaultCompare, {
                              from: previous.id,
                              to: crawl.id,
                            })}
                            className="text-xs text-muted-foreground hover:underline"
                          >
                            {t('compareWithPrevious')}
                          </Link>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </CardContent>
      </Card>

      {timelines.length > 0 && (
        <Card>
          <CardHeader>
            <CardTitle>{t('timeline.title')}</CardTitle>
            <CardDescription>{t('timeline.description')}</CardDescription>
          </CardHeader>
          <CardContent className="grid gap-4">
            <ul className="grid gap-4">
              {timelines.map((timeline) => (
                <li key={timeline.issue} className="grid gap-1.5">
                  <IssueBadge issue={timeline.issue} />
                  <Strip cells={timeline.cells} crawls={crawls} />
                  <span className="flex flex-wrap gap-x-4 gap-y-1">
                    {timeline.events.flatMap((event, position) => {
                      const crawl = crawls[position]
                      return event && crawl && worthTelling(event)
                        ? [
                            <span key={crawl.id} className="flex items-center gap-1.5 text-xs">
                              <FindingChangeBadge change={event} />
                              <span className="text-muted-foreground">{when(crawl)}</span>
                            </span>,
                          ]
                        : []
                    })}
                  </span>
                </li>
              ))}
            </ul>
            <p className="text-xs text-muted-foreground">{t('timeline.legend')}</p>
          </CardContent>
        </Card>
      )}
    </div>
  )
}
