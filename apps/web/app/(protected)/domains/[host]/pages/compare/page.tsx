import { CRAWL_CHANGES, COMPARE_VIEWS, type CrawlChange } from '@seotools/core/crawl/compare'
import { isPageIssueId } from '@seotools/core/crawl/issues'
import type { Crawl, CrawlComparisonCounts } from '@seotools/db'
import { XIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { CompareTable } from '@/components/history/compare-table'
import { crawlMoment, CrawlStamp } from '@/components/history/crawl-stamp'
import { PairNotes } from '@/components/history/pair-notes'
import { PairPicker } from '@/components/history/pair-picker'
import { IssueLabel } from '@/components/pages/issue-mark'
import { Pagination } from '@/components/pagination'
import { Button, buttonVariants } from '@/components/ui/button'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { compareHref, isFindingChange, parseCompareQuery } from '@/lib/compare-query'
import { loadComparison } from '@/lib/crawl-compare'
import { selectPair } from '@/lib/crawl-history'
import { getDb } from '@/lib/db'
import { requireDomain } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const t = await getTranslations('CrawlCompare')
  return { title: t('metaTitle', { host }) }
}

/** How many URLs a change lists, from the counts of the comparison. */
const countOf = (counts: CrawlComparisonCounts, change: CrawlChange) => counts[change]

/**
 * Two retained full crawls of a domain, side by side. The address is the state (the two crawls, the
 * kind of change, the view, a search, the page), the server reads one page of the result from what
 * the crawls stored, and nothing is requested from the site. What the two crawls cannot vouch for is
 * said above the results, and the labels of the findings are chosen to match it.
 */
export default async function ComparePage({
  params,
  searchParams,
}: {
  params: Promise<{ host: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { host } = await params
  const query = parseCompareQuery(await searchParams)
  const { domain } = await requireDomain(host)
  const [t, tStatus, tPicker, format] = await Promise.all([
    getTranslations('CrawlCompare'),
    getTranslations('Crawl.status'),
    getTranslations('CrawlHistory.picker'),
    getFormatter(),
  ])
  const db = await getDb()

  // Both crawls must be the domain's: anything else is the same as a crawl that does not exist.
  const selection = await selectPair(db.crawls, domain.id, query.from, query.to)
  if (selection.kind === 'missing') notFound()

  const header = (
    <div className="grid gap-1">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p className="text-sm text-muted-foreground">{t('description')}</p>
    </div>
  )

  if (selection.kind === 'empty') {
    return (
      <main className="grid gap-6">
        {header}
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t('needTwo')}</p>
          </CardContent>
        </Card>
      </main>
    )
  }

  const when = (crawl: Pick<Crawl, 'finishedAt' | 'createdAt'>) =>
    format.dateTime(crawlMoment(crawl), { dateStyle: 'medium', timeStyle: 'short' })
  const latestId = selection.crawls.filter((crawl) => !crawl.pruned).at(-1)?.id
  const options = [...selection.crawls].reverse().map((crawl) => ({
    value: crawl.id,
    label: tPicker('option', {
      when: when(crawl),
      status: tStatus(crawl.status),
      coverage: crawl.pruned ? 'pruned' : 'retained',
      latest: crawl.id === latestId ? 'yes' : 'no',
    }),
  }))

  if (selection.kind === 'same') {
    return (
      <main className="grid gap-6">
        {header}
        <PairPicker
          host={domain.host}
          query={query}
          options={options}
          from={selection.crawl.id}
          to={selection.crawl.id}
        />
        <Card>
          <CardContent>
            <p className="text-sm text-muted-foreground">{t('sameCrawl')}</p>
          </CardContent>
        </Card>
      </main>
    )
  }

  const { base, target } = selection
  const data = await loadComparison({
    crawls: db.crawls,
    domainId: domain.id,
    base,
    target,
    history: selection.crawls,
    query,
  })
  // Every address on the page names both crawls, so that a newer crawl cannot change what a link means.
  const pinned = { from: base.id, to: target.id }
  const href = (changes: Parameters<typeof compareHref>[2]) =>
    compareHref(domain.host, query, { ...pinned, ...changes })
  const { assessment, counts } = data
  const incomplete = (side: 'base' | 'target') =>
    assessment.notes.some((note) => note.code === 'incomplete' && note.sides.includes(side))

  const totals = [
    ['urls', base.urlsCount, target.urlsCount],
    ['pages', base.pagesCount, target.pagesCount],
    ['audited', base.pagesAudit?.audited ?? null, target.pagesAudit?.audited ?? null],
    ['excluded', base.pagesAudit?.excluded ?? null, target.pagesAudit?.excluded ?? null],
    ['indexable', base.pagesAudit?.indexable ?? null, target.pagesAudit?.indexable ?? null],
    ['withIssues', base.pagesWithType?.issue ?? null, target.pagesWithType?.issue ?? null],
    ['withWarnings', base.pagesWithType?.warning ?? null, target.pagesWithType?.warning ?? null],
    [
      'withOpportunities',
      base.pagesWithType?.opportunity ?? null,
      target.pagesWithType?.opportunity ?? null,
    ],
  ] as const
  const number = (value: number | null) => (value === null ? '—' : format.number(value))
  const difference = (before: number | null, after: number | null) =>
    before === null || after === null
      ? '—'
      : format.number(after - before, { signDisplay: 'exceptZero' })

  // What each kind of change means is said above the list; two of them need more when a crawl is cut short.
  const hintKey: Record<
    CrawlChange,
    'added' | 'addedIncomplete' | 'missing' | 'missingIncomplete' | CrawlChange
  > = {
    added: incomplete('base') ? 'addedIncomplete' : 'added',
    missing: incomplete('target') ? 'missingIncomplete' : 'missing',
    status: 'status',
    title: 'title',
    canonical: 'canonical',
    robots: 'robots',
    gained: 'gained',
    lost: 'lost',
  }

  return (
    <main className="grid gap-6">
      {header}

      <PairPicker
        host={domain.host}
        query={query}
        options={options}
        from={base.id}
        to={target.id}
      />

      <div className="grid gap-3 md:grid-cols-2">
        {(
          [
            ['earlier', base],
            ['later', target],
          ] as const
        ).map(([role, crawl]) => (
          <Card key={role} size="sm">
            <CardHeader>
              <CardDescription>{t(`roles.${role}`)}</CardDescription>
            </CardHeader>
            <CardContent>
              <CrawlStamp crawl={crawl} />
            </CardContent>
          </Card>
        ))}
      </div>

      <PairNotes assessment={assessment} />

      <Card>
        <CardHeader>
          <CardTitle>{t('totals.title')}</CardTitle>
          <CardDescription>{t('totals.description')}</CardDescription>
        </CardHeader>
        <CardContent className="overflow-x-auto">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('totals.measure')}</TableHead>
                <TableHead className="text-right">{t('roles.earlier')}</TableHead>
                <TableHead className="text-right">{t('roles.later')}</TableHead>
                <TableHead className="text-right">{t('totals.difference')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {totals.map(([key, before, after]) => (
                <TableRow key={key}>
                  <TableCell>{t(`totals.rows.${key}`)}</TableCell>
                  <TableCell className="text-right tabular-nums">{number(before)}</TableCell>
                  <TableCell className="text-right tabular-nums">{number(after)}</TableCell>
                  <TableCell className="text-right tabular-nums">
                    {difference(before, after)}
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </CardContent>
      </Card>

      {counts && (
        <Card>
          <CardHeader className="gap-3">
            <nav aria-label={t('changesLabel')} className="flex flex-wrap gap-1">
              {CRAWL_CHANGES.map((change) => (
                <Link
                  key={change}
                  href={href({ change, page: 1, issue: null })}
                  aria-current={change === query.change ? 'page' : undefined}
                  className={buttonVariants({
                    variant: change === query.change ? 'secondary' : 'ghost',
                    size: 'sm',
                  })}
                >
                  {t(`changes.${change}`)}
                  <span className="text-muted-foreground tabular-nums">
                    {format.number(countOf(counts, change))}
                  </span>
                </Link>
              ))}
            </nav>
            <CardDescription>{t(`hints.${hintKey[query.change]}`)}</CardDescription>
            <div className="flex flex-wrap items-center gap-2">
              <nav aria-label={t('viewsLabel')} className="flex gap-1">
                {COMPARE_VIEWS.map((view) => (
                  <Link
                    key={view}
                    href={href({ view, page: 1 })}
                    aria-current={view === query.view ? 'page' : undefined}
                    className={buttonVariants({
                      variant: view === query.view ? 'secondary' : 'outline',
                      size: 'sm',
                    })}
                  >
                    {t(`views.${view}`)}
                  </Link>
                ))}
              </nav>
              <form
                action={`/domains/${domain.host}/pages/compare`}
                method="get"
                role="search"
                className="flex items-center gap-2"
              >
                <input type="hidden" name="from" value={base.id} />
                <input type="hidden" name="to" value={target.id} />
                <input type="hidden" name="change" value={query.change} />
                <input type="hidden" name="view" value={query.view} />
                {query.issue && isFindingChange(query.change) && (
                  <input type="hidden" name="issue" value={query.issue} />
                )}
                <Input
                  type="search"
                  name="q"
                  defaultValue={query.search}
                  placeholder={t('search.placeholder')}
                  aria-label={t('search.label')}
                  className="h-7 w-64"
                />
                <Button type="submit" variant="outline" size="sm">
                  {t('search.submit')}
                </Button>
              </form>
              {query.issue && isFindingChange(query.change) && isPageIssueId(query.issue) && (
                <Button
                  variant="secondary"
                  size="sm"
                  render={<Link href={href({ issue: null, page: 1 })} />}
                >
                  <IssueLabel issue={query.issue} />
                  <XIcon />
                  <span className="sr-only">{t('clearIssue')}</span>
                </Button>
              )}
            </div>
            {counts.unrequested > 0 && (
              <p className="text-xs text-muted-foreground">
                {t('unrequested', { count: counts.unrequested })}
              </p>
            )}
          </CardHeader>
          <CardContent className="grid gap-4">
            <CompareTable
              host={domain.host}
              query={{ ...query, ...pinned }}
              change={query.change}
              rows={data.rows}
              baseId={base.id}
              targetId={target.id}
            />
            <p className="text-xs text-muted-foreground">{t('total', { count: data.total })}</p>
            <Pagination
              page={data.page}
              pageCount={data.pageCount}
              href={(page) => href({ page })}
            />
          </CardContent>
        </Card>
      )}
    </main>
  )
}
