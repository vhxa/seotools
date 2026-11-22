import { COMPARE_VIEWS, type CrawlChange } from '@seotools/core/crawl/compare'
import {
  CONFIGURATION_REASONS,
  SIDE_REASONS,
  type ComparisonReason,
} from '@seotools/core/crawl/comparison-reasons'
import { isPageIssueId } from '@seotools/core/crawl/issues'
import type { Crawl, CrawlComparisonCounts } from '@seotools/db'
import { XIcon } from 'lucide-react'
import Link from 'next/link'
import Form from 'next/form'
import { notFound } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { CrawlsHeader } from '@/components/crawl/crawls-header'
import { CompareAbout } from '@/components/history/compare-about'
import { CompareDrawer, type RowDetail } from '@/components/history/compare-drawer'
import { CompareRowDetail } from '@/components/history/compare-row-detail'
import { CompareTable } from '@/components/history/compare-table'
import { crawlMoment, CrawlStamp } from '@/components/history/crawl-stamp'
import { CheckNowButton } from '@/components/history/check-now-button'
import {
  ComparisonDifferences,
  ComparisonPruned,
  ComparisonSummary,
} from '@/components/history/comparison-summary'
import { PairPicker } from '@/components/history/pair-picker'
import { InfoHelp } from '@/components/help'
import { IssueLabel } from '@/components/pages/issue-mark'
import { Pagination } from '@/components/pagination'
import { Stat } from '@/components/stat'
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
import {
  COMPARE_GROUPS,
  compareHref,
  groupOfChange,
  isFindingChange,
  isOneSidedChange,
  parseCompareQuery,
} from '@/lib/compare-query'
import { loadComparison } from '@/lib/crawl-compare'
import { selectPair } from '@/lib/crawl-history'
import { getDb } from '@/lib/db'
import { cn } from '@/lib/utils'
import { requireDomain } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const t = await getTranslations('CrawlCompare')
  return { title: t('metaTitle', { host }) }
}

/** How many URLs a change lists, from the counts of the comparison. `null`: not known yet. */
const countOf = (counts: CrawlComparisonCounts, change: CrawlChange) =>
  change === 'configuration' && !counts.explained ? null : counts[change]

/** The reasons a tab of URLs one crawl lacks is split by, with how many URLs each has. */
function reasonChips(counts: CrawlComparisonCounts, change: CrawlChange) {
  const configuration = CONFIGURATION_REASONS as readonly ComparisonReason[]
  const pick = (side: 'base' | 'target', inGroup: boolean) =>
    SIDE_REASONS[side]
      .filter((reason) => configuration.includes(reason) === inGroup)
      .map((reason) => ({ reason, count: counts.reasons[side][reason] ?? 0 }))
  const merged = (items: { reason: ComparisonReason; count: number }[]) => {
    const totals = new Map<ComparisonReason, number>()
    for (const { reason, count } of items) totals.set(reason, (totals.get(reason) ?? 0) + count)
    return [...totals].map(([reason, count]) => ({ reason, count }))
  }
  const chips =
    change === 'missing'
      ? pick('base', false)
      : change === 'added'
        ? pick('target', false)
        : merged([...pick('base', true), ...pick('target', true)])
  return chips.filter((chip) => chip.count > 0)
}

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
  const config = await db.audit.config(domain.id)

  // Both crawls must be the domain's: anything else is the same as a crawl that does not exist.
  const selection = await selectPair(db.crawls, domain.id, query.from, query.to)
  if (selection.kind === 'missing') notFound()

  const header = <CrawlsHeader host={domain.host} description={t('description')} />

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
    verifications: db.verifications,
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

  // The short line under the tabs, and the longer text behind its info button.
  const hintKey: Record<
    CrawlChange,
    'added' | 'addedIncomplete' | 'missing' | 'missingIncomplete' | CrawlChange
  > = {
    added: incomplete('base') ? 'addedIncomplete' : 'added',
    missing: incomplete('target') ? 'missingIncomplete' : 'missing',
    configuration: 'configuration',
    status: 'status',
    title: 'title',
    canonical: 'canonical',
    robots: 'robots',
    gained: 'gained',
    lost: 'lost',
  }

  const totalsTable = (
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
            <TableCell className="text-right tabular-nums">{difference(before, after)}</TableCell>
          </TableRow>
        ))}
      </TableBody>
    </Table>
  )

  // One figure that is also the way to its list: the cards are the tabs of the first two groups.
  const statCard = (change: CrawlChange) => {
    const count = counts ? countOf(counts, change) : null
    return (
      <Link
        key={change}
        href={href({ change, page: 1, issue: null, reason: null })}
        scroll={false}
        aria-current={change === query.change ? 'page' : undefined}
        className="block h-full rounded-xl outline-none focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:ring-2 aria-[current=page]:ring-ring [&>[data-slot=card]]:h-full"
      >
        <Stat
          label={t(`changes.${change}`)}
          value={count === null ? '—' : format.number(count)}
          hint={count === null ? t('stat.preparing') : null}
        />
      </Link>
    )
  }
  const group = groupOfChange(query.change)
  const oneSided = isOneSidedChange(query.change)
  const longHint = (
    <div className="grid gap-2">
      <p>{t(`hints.${hintKey[query.change]}`)}</p>
      {isFindingChange(query.change) && (
        <ComparisonSummary lines={data.summary} kinds={['findings']} />
      )}
    </div>
  )

  // What the drawer shows of each listed URL: rendered here, with the page, so it opens at once.
  const ignored = { base: base.ignoredParameters ?? [], target: target.ignoredParameters ?? [] }
  const details: Record<string, RowDetail> = oneSided
    ? Object.fromEntries(
        data.rows.map((row) => [
          row.urlHash,
          {
            url: row.url,
            href: `/domains/${domain.host}/urls/${row.urlHash}?crawl=${row.target ? target.id : base.id}`,
            body: (
              <CompareRowDetail
                host={domain.host}
                row={row}
                baseId={base.id}
                targetId={target.id}
                ignored={ignored}
                state={data.explanation}
                activeRecheckId={data.activeRecheck?.id ?? null}
              />
            ),
          },
        ]),
      )
    : {}

  const table = counts && (
    <CompareTable
      host={domain.host}
      query={{ ...query, ...pinned }}
      change={query.change}
      rows={data.rows}
      baseId={base.id}
      targetId={target.id}
      explanation={data.explanation}
      footer={
        <Pagination
          page={data.page}
          pageCount={data.pageCount}
          href={(page) => href({ page })}
          details={<span>{t('rowsShown', { shown: data.rows.length, matching: data.total })}</span>}
        />
      }
    />
  )

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

      <ComparisonPruned lines={data.summary} />

      {counts ? (
        <>
          <div className="grid gap-3 lg:grid-cols-[3fr_4fr]">
            {COMPARE_GROUPS.filter((entry) => entry.id !== 'findings').map((entry) => (
              <section
                key={entry.id}
                aria-labelledby={`compare-stats-${entry.id}`}
                className="grid gap-2"
              >
                <h2 id={`compare-stats-${entry.id}`} className="text-base font-medium">
                  {t(`groups.${entry.id}`)}
                </h2>
                <div
                  className={cn(
                    'grid grid-cols-2 gap-3',
                    entry.id === 'urls' ? 'sm:grid-cols-3' : 'sm:grid-cols-4',
                  )}
                >
                  {entry.changes.map(statCard)}
                </div>
              </section>
            ))}
          </div>

          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <ComparisonDifferences lines={data.summary} />
            <CompareAbout>
              <div className="grid gap-6">
                <section className="grid gap-3">
                  <h3 className="text-sm font-medium">{t('about.crawls')}</h3>
                  {(
                    [
                      ['earlier', base],
                      ['later', target],
                    ] as const
                  ).map(([role, crawl]) => (
                    <div key={role} className="grid gap-1">
                      <p className="text-xs text-muted-foreground">{t(`roles.${role}`)}</p>
                      <CrawlStamp crawl={crawl} currentVersion={config.version} />
                    </div>
                  ))}
                </section>
                <section className="grid gap-3">
                  <h3 className="text-sm font-medium">{t('about.summary')}</h3>
                  <ComparisonSummary lines={data.summary} />
                </section>
                <section className="grid gap-3">
                  <h3 className="text-sm font-medium">{t('totals.title')}</h3>
                  <p className="text-sm text-muted-foreground">{t('totals.description')}</p>
                  {totalsTable}
                </section>
              </div>
            </CompareAbout>
          </div>

          <Card className="flex h-[calc(100svh-5.75rem)] min-h-[32rem] flex-col md:-mb-4 md:h-[calc(100svh-6.25rem)]">
            <CardHeader className="shrink-0 gap-3">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
                <nav
                  aria-label={t('groupsLabel')}
                  className="inline-flex rounded-lg bg-muted p-[3px] text-sm"
                >
                  {COMPARE_GROUPS.map((entry) => (
                    <Link
                      key={entry.id}
                      href={href({ change: entry.changes[0], page: 1, issue: null, reason: null })}
                      scroll={false}
                      aria-current={entry.id === group.id ? 'page' : undefined}
                      className="inline-flex h-7 items-center rounded-md px-3 font-medium text-foreground/60 outline-none hover:text-foreground focus-visible:ring-3 focus-visible:ring-ring/50 aria-[current=page]:bg-background aria-[current=page]:text-foreground aria-[current=page]:shadow-sm"
                    >
                      {t(`groups.${entry.id}`)}
                    </Link>
                  ))}
                </nav>
                <nav aria-label={t('changesLabel')} className="flex flex-wrap gap-1">
                  {group.changes.map((change) => (
                    <Link
                      key={change}
                      href={href({ change, page: 1, issue: null, reason: null })}
                      scroll={false}
                      aria-current={change === query.change ? 'page' : undefined}
                      className={buttonVariants({
                        variant: change === query.change ? 'secondary' : 'ghost',
                        size: 'sm',
                      })}
                    >
                      {t(`changes.${change}`)}
                      {group.id === 'findings' && (
                        <span className="text-muted-foreground tabular-nums">
                          {format.number(countOf(counts, change) ?? 0)}
                        </span>
                      )}
                    </Link>
                  ))}
                </nav>
              </div>
              <div className="flex items-center gap-1">
                <CardDescription>{t(`helps.${hintKey[query.change]}`)}</CardDescription>
                <InfoHelp label={t(`changes.${query.change}`)} compact>
                  {longHint}
                </InfoHelp>
              </div>
              {oneSided && counts.explained && (
                <nav aria-label={t('why.label')} className="flex flex-wrap gap-1">
                  {[
                    { reason: null, count: countOf(counts, query.change) ?? 0 },
                    ...reasonChips(counts, query.change),
                  ].map(({ reason, count }) => (
                    <Link
                      key={reason ?? 'all'}
                      href={href({ reason, page: 1 })}
                      scroll={false}
                      aria-current={reason === query.reason ? 'page' : undefined}
                      className={buttonVariants({
                        variant: reason === query.reason ? 'secondary' : 'outline',
                        size: 'xs',
                      })}
                    >
                      {reason ? t(`why.reasons.${reason}`) : t('why.all')}
                      <span className="text-muted-foreground tabular-nums">
                        {format.number(count)}
                      </span>
                    </Link>
                  ))}
                </nav>
              )}
              <div className="flex flex-wrap items-center gap-2">
                <nav aria-label={t('viewsLabel')} className="flex gap-1">
                  {COMPARE_VIEWS.map((view) => (
                    <Link
                      key={view}
                      href={href({ view, page: 1 })}
                      scroll={false}
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
                <Form
                  action={`/domains/${domain.host}/crawls/compare`}
                  scroll={false}
                  role="search"
                  className="flex min-w-0 items-center gap-2"
                >
                  <input type="hidden" name="from" value={base.id} />
                  <input type="hidden" name="to" value={target.id} />
                  <input type="hidden" name="change" value={query.change} />
                  <input type="hidden" name="view" value={query.view} />
                  {query.issue && isFindingChange(query.change) && (
                    <input type="hidden" name="issue" value={query.issue} />
                  )}
                  {query.reason && oneSided && (
                    <input type="hidden" name="why" value={query.reason} />
                  )}
                  <Input
                    type="search"
                    name="q"
                    defaultValue={query.search}
                    placeholder={t('search.placeholder')}
                    aria-label={t('search.label')}
                    className="h-7 w-full min-w-0 sm:w-64"
                  />
                  <Button type="submit" variant="outline" size="sm">
                    {t('search.submit')}
                  </Button>
                </Form>
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
                {(query.change === 'added' || query.change === 'missing') && (
                  <div className="ml-auto">
                    <CheckNowButton
                      host={domain.host}
                      from={base.id}
                      to={target.id}
                      side={query.change === 'added' ? 'target' : 'base'}
                      urlHashes={data.rows.filter((row) => row.why).map((row) => row.urlHash)}
                      activeRecheckId={data.activeRecheck?.id ?? null}
                      scope="page"
                    />
                  </div>
                )}
              </div>
              {counts.unrequested > 0 && (
                <p className="text-xs text-muted-foreground">
                  {t('unrequested', { count: counts.unrequested })}
                </p>
              )}
            </CardHeader>
            <CardContent className="flex min-h-0 flex-1 flex-col">
              {oneSided ? (
                <CompareDrawer host={domain.host} query={{ ...query, ...pinned }} details={details}>
                  {table}
                </CompareDrawer>
              ) : (
                table
              )}
            </CardContent>
          </Card>
        </>
      ) : (
        <Card>
          <CardHeader>
            <CardTitle>{t('totals.title')}</CardTitle>
            <CardDescription>{t('totals.description')}</CardDescription>
          </CardHeader>
          <CardContent>{totalsTable}</CardContent>
        </Card>
      )}
    </main>
  )
}
