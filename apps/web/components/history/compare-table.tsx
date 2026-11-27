import type { CrawlChange, FieldChange, UrlSnapshot } from '@seotools/core/crawl/compare'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { ResultsTable } from '@/components/results-table'
import { DetailRow, DetailsButton } from '@/components/history/compare-drawer'
import { ReasonChip } from '@/components/history/compare-reason'
import { FindingChangeBadge } from '@/components/history/finding-badge'
import { Answer, Robots, Text } from '@/components/history/snapshot-cells'
import { IssueBadge } from '@/components/pages/issue-mark'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { compareHref, isOneSidedChange, type CompareQuery } from '@/lib/compare-query'
import type { ExplanationState } from '@/lib/compare-summary'
import type { ComparisonRow } from '@/lib/crawl-compare'
import { displayUrl } from '@/lib/url-display'

const FIELD_CHANGES: readonly CrawlChange[] = ['status', 'title', 'canonical', 'robots']

function Field({ field, snapshot }: { field: FieldChange; snapshot: UrlSnapshot }) {
  if (field === 'status') return <Answer snapshot={snapshot} />
  if (field === 'robots') return <Robots snapshot={snapshot} />
  return <Text value={field === 'title' ? snapshot.title : snapshot.canonical} />
}

/**
 * One page of the URLs that changed in the way chosen. Server-rendered from the page the database
 * returned: it never holds more than the rows on screen. A URL links to its history, in the crawl
 * where it exists.
 */
export function CompareTable({
  host,
  query,
  change,
  rows,
  baseId,
  targetId,
  footer,
  explanation = 'done',
}: {
  footer: ReactNode
  host: string
  query: CompareQuery
  change: CrawlChange
  rows: ComparisonRow[]
  baseId: string
  targetId: string
  /** Whether the pair's reasons were worked out. */
  explanation?: ExplanationState
}) {
  const t = useTranslations('CrawlCompare.table')
  if (rows.length === 0)
    return (
      <ResultsTable footer={footer} fill>
        <p className="p-4 text-sm text-muted-foreground">{t('empty')}</p>
      </ResultsTable>
    )

  const oneSided = isOneSidedChange(change)
  const urlCell = (row: ComparisonRow) => (
    <TableCell
      className={oneSided ? 'results-url bg-background' : 'results-url bg-background align-top'}
    >
      {oneSided ? (
        <span title={row.url} className="block font-mono text-xs break-all whitespace-normal">
          {displayUrl(row.url, host)}
        </span>
      ) : (
        <Link
          href={`/domains/${host}/urls/${row.urlHash}?crawl=${row.target ? targetId : baseId}`}
          title={row.url}
          className="block font-mono text-xs break-all whitespace-normal hover:underline"
        >
          {displayUrl(row.url, host)}
        </Link>
      )}
    </TableCell>
  )

  let head: ReactNode
  let cells: (row: ComparisonRow) => ReactNode
  if (oneSided) {
    head = (
      <>
        <TableHead>{t('columns.answer')}</TableHead>
        <TableHead>{t('columns.reason')}</TableHead>
        <TableHead className="text-right">
          <span className="sr-only">{t('columns.action')}</span>
        </TableHead>
      </>
    )
    cells = (row) => {
      const snapshot = row.target ?? row.base
      return (
        <>
          <TableCell>{snapshot && <Answer snapshot={snapshot} />}</TableCell>
          <TableCell>
            <ReasonChip why={row.why ?? null} state={explanation} />
          </TableCell>
          <TableCell className="text-right">
            <DetailsButton hash={row.urlHash} url={row.url} />
          </TableCell>
        </>
      )
    }
  } else if (FIELD_CHANGES.includes(change)) {
    const field = change as FieldChange
    head = (
      <>
        <TableHead>{t('columns.before')}</TableHead>
        <TableHead>{t('columns.after')}</TableHead>
      </>
    )
    cells = (row) => (
      <>
        <TableCell className="max-w-xs align-top text-muted-foreground">
          {row.base && <Field field={field} snapshot={row.base} />}
        </TableCell>
        <TableCell className="max-w-xs align-top">
          {row.target && <Field field={field} snapshot={row.target} />}
        </TableCell>
      </>
    )
  } else {
    head = <TableHead>{t('columns.findings')}</TableHead>
    cells = (row) => {
      const changes = row.findings?.filter((finding) => finding.kind !== 'persistent') ?? []
      const same = (row.findings?.length ?? 0) - changes.length
      return (
        <TableCell className="align-top [&_[data-slot=badge]]:h-auto [&_[data-slot=badge]]:max-w-full [&_[data-slot=badge]]:whitespace-normal">
          {row.findings === null ? (
            <span className="text-muted-foreground">{t('findingsUnavailable')}</span>
          ) : (
            <div className="grid gap-1.5">
              {changes.map((finding) => (
                <span key={finding.issue} className="flex flex-wrap items-center gap-1.5">
                  <FindingChangeBadge change={finding} />
                  <Link
                    href={compareHref(host, query, { issue: finding.issue, page: 1 })}
                    className="max-w-full min-w-0 rounded-md outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                  >
                    <IssueBadge issue={finding.issue} />
                  </Link>
                </span>
              ))}
              {same > 0 && (
                <span className="text-xs text-muted-foreground">
                  {t('samePersistent', { count: same })}
                </span>
              )}
            </div>
          )}
        </TableCell>
      )
    }
  }

  return (
    <ResultsTable footer={footer} fill>
      <table className="w-full min-w-[44rem] table-fixed text-sm [&_td]:overflow-hidden [&_td]:[overflow-wrap:anywhere] [&_td]:whitespace-normal [&_td:not(:last-child)]:border-r [&_th:not(:last-child)]:border-r">
        <colgroup>
          <col className={oneSided ? undefined : 'w-[36%]'} />
          {oneSided ? (
            <>
              <col className="w-[20%]" />
              <col className="w-[24%]" />
              <col className="w-[8rem]" />
            </>
          ) : FIELD_CHANGES.includes(change) ? (
            <>
              <col className="w-[32%]" />
              <col className="w-[32%]" />
            </>
          ) : (
            <col className="w-[64%]" />
          )}
        </colgroup>
        <TableHeader>
          <TableRow>
            <TableHead className="results-url bg-muted">{t('columns.url')}</TableHead>
            {head}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((row) =>
            oneSided ? (
              <DetailRow key={row.urlHash} hash={row.urlHash}>
                {urlCell(row)}
                {cells(row)}
              </DetailRow>
            ) : (
              <TableRow key={row.urlHash}>
                {urlCell(row)}
                {cells(row)}
              </TableRow>
            ),
          )}
        </TableBody>
      </table>
    </ResultsTable>
  )
}
