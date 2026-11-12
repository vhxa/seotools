import type { CrawlChange, FieldChange, UrlSnapshot } from '@seotools/core/crawl/compare'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { useTranslations } from 'next-intl'
import { ResultsTable } from '@/components/results-table'
import { FindingChangeBadge } from '@/components/history/finding-badge'
import { Answer, Robots, Text } from '@/components/history/snapshot-cells'
import { IssueBadge } from '@/components/pages/issue-mark'
import { TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { compareHref, type CompareQuery } from '@/lib/compare-query'
import type { ComparisonRow } from '@/lib/crawl-compare'

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
}: {
  footer: ReactNode
  host: string
  query: CompareQuery
  change: CrawlChange
  rows: ComparisonRow[]
  baseId: string
  targetId: string
}) {
  const t = useTranslations('CrawlCompare.table')
  if (rows.length === 0)
    return (
      <ResultsTable footer={footer} fill>
        <p className="p-4 text-sm text-muted-foreground">{t('empty')}</p>
      </ResultsTable>
    )

  const urlCell = (row: ComparisonRow) => (
    <TableCell className="results-url bg-background align-top">
      <Link
        href={`/domains/${host}/urls/${row.urlHash}?crawl=${row.target ? targetId : baseId}`}
        title={row.url}
        className="block font-mono text-xs break-all whitespace-normal hover:underline"
      >
        {row.url}
      </Link>
    </TableCell>
  )

  let head: ReactNode
  let cells: (row: ComparisonRow) => ReactNode
  if (change === 'added' || change === 'missing') {
    const side = (row: ComparisonRow) => (change === 'added' ? row.target : row.base)
    head = (
      <>
        <TableHead>{t('columns.answer')}</TableHead>
        <TableHead>{t('columns.title')}</TableHead>
        <TableHead>{t('columns.depth')}</TableHead>
      </>
    )
    cells = (row) => {
      const snapshot = side(row)
      return snapshot ? (
        <>
          <TableCell className="align-top">
            <Answer snapshot={snapshot} />
          </TableCell>
          <TableCell className="max-w-xs align-top">
            <Text value={snapshot.title} />
          </TableCell>
          <TableCell className="align-top tabular-nums">{snapshot.depth}</TableCell>
        </>
      ) : null
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
      <table className="w-full min-w-[56rem] table-fixed text-sm [&_td]:overflow-hidden [&_td]:[overflow-wrap:anywhere] [&_td]:whitespace-normal">
        <colgroup>
          <col className="w-[36%]" />
          {change === 'added' || change === 'missing' ? (
            <>
              <col className="w-[18%]" />
              <col className="w-[36%]" />
              <col className="w-[10%]" />
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
          {rows.map((row) => (
            <TableRow key={row.urlHash}>
              {urlCell(row)}
              {cells(row)}
            </TableRow>
          ))}
        </TableBody>
      </table>
    </ResultsTable>
  )
}
