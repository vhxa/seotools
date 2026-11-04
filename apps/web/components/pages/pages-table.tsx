'use client'

import {
  PAGE_ISSUES,
  compareIssueSeverity,
  isPageIssueId,
  type IssueDetailKind,
} from '@seotools/core/crawl/issues'
import type { CrawlUrlKind } from '@seotools/core'
import type {
  AuditParticipation,
  ConditionStates,
  RecordedIntent,
} from '@seotools/core/crawl/audit'
import { MAX_VERIFICATION_URLS } from '@seotools/core/crawl/verification'
import type { IndexabilityState } from '@seotools/core/crawl/indexability'
import type { CrawlUrlSort } from '@seotools/db'
import {
  columnVisibilityFeature,
  createColumnHelper,
  rowSelectionFeature,
  tableFeatures,
  useTable,
  type ColumnVisibilityState,
  type Updater,
} from '@tanstack/react-table'
import {
  ArrowDownIcon,
  ArrowUpDownIcon,
  ArrowUpIcon,
  ChevronDownIcon,
  Columns3Icon,
  RefreshCwIcon,
  EyeOffIcon,
  ExternalLinkIcon,
  SearchIcon,
  SlidersHorizontalIcon,
  StarIcon,
  XIcon,
} from 'lucide-react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { useFormatter, useTranslations } from 'next-intl'
import { useMemo, useOptimistic, useState, useTransition, type FormEvent } from 'react'
import {
  setPriorityUrlAction,
  setPriorityUrlsAction,
} from '@/app/(protected)/domains/[host]/actions'
import { recheckUrlsAction } from '@/app/(protected)/domains/[host]/verify-actions'
import { AuditDialog } from '@/components/audit/audit-dialog'
import {
  IndexabilityBadge,
  IntentBadge,
  ConditionBadges,
  ParticipationBadge,
  RuleOrigin,
} from '@/components/audit/state-badges'
import { StatusCell } from '@/components/crawl/status-cell'
import { IssueBadge, IssueDetails, useIssueLabel } from '@/components/pages/issue-mark'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Badge } from '@/components/ui/badge'
import { OpenUrlLink } from '@/components/pages/url-drawer'
import { Button, buttonVariants } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  DropdownMenu,
  DropdownMenuCheckboxItem,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { Input } from '@/components/ui/input'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { useLocalStorage } from '@/hooks/use-local-storage'
import type { RuleRef } from '@/lib/audit-rules'
import { formatBytes } from '@/lib/format'
import { detailHref, nextSort, type DetailQuery } from '@/lib/pages-query'
import { cn } from '@/lib/utils'

/** What the table needs of a URL. Plain data: it crosses from the server to this component. */
export interface PageRow {
  automaticCheck: boolean
  urlHash: string
  url: string
  title: string | null
  kind: CrawlUrlKind
  statusCode: number | null
  error: string | null
  depth: number
  responseTimeMs: number | null
  bytes: number | null
  contentType: string | null
  redirectTo: string | null
  /** Ids of the issues the URL has. */
  issues: string[]
  /** What the issue being filtered by says about this URL, if it says anything. */
  issueDetails: string[]
  /** Marked as a priority page: what the star toggles. */
  priority: boolean
  /** A URL of the site, which is the only kind the audit can be configured for. */
  internal: boolean
  /** Audited or left out; `null`: the analysis has no state for this URL. */
  participation: AuditParticipation | null
  participationRule: RuleRef
  /** What the user expects of its indexation (the default when no rule says); `null` as above. */
  intent: RecordedIntent | null
  intentRule: RuleRef
  /** The page's own nofollow is accepted, by the rule that decided its expectation. */
  /** What rules asked of its conditions, each with what the crawl saw. */
  conditions: ConditionStates
  /** What the crawl saw of whether it can be indexed; `null` as above. */
  indexability: IndexabilityState | null
  blockers: string[]
}

const features = tableFeatures({ rowSelectionFeature, columnVisibilityFeature })
const helper = createColumnHelper<typeof features, PageRow>()

/**
 * The columns the table can show; what each one renders is in `Cell`. The ones that cannot be
 * hidden are the checkbox, the URL that identifies the row, and the actions.
 */
const columns = helper.columns([
  helper.display({ id: 'select', enableHiding: false }),
  helper.display({ id: 'url', enableHiding: false }),
  helper.display({ id: 'title' }),
  helper.display({ id: 'status' }),
  // Only there when filtering by an issue that details something: the filter says, not the user.
  helper.display({ id: 'issueDetail', enableHiding: false }),
  helper.display({ id: 'issues' }),
  helper.display({ id: 'audit' }),
  helper.display({ id: 'intent' }),
  helper.display({ id: 'indexability' }),
  helper.display({ id: 'origin' }),
  helper.display({ id: 'depth' }),
  helper.display({ id: 'responseTime' }),
  helper.display({ id: 'bytes' }),
  helper.display({ id: 'contentType' }),
  helper.display({ id: 'redirectTo' }),
  helper.display({ id: 'actions', enableHiding: false }),
])

/** Columns the server can sort by. */
const SORTABLE: Partial<Record<string, CrawlUrlSort>> = {
  url: 'url',
  title: 'title',
  status: 'status',
  depth: 'depth',
  responseTime: 'responseTime',
  bytes: 'bytes',
}

/** URL, title and status; the actions are always there. The rest is up to each user. */
const DEFAULT_VISIBILITY: ColumnVisibilityState = {
  issues: false,
  intent: false,
  origin: false,
  depth: false,
  responseTime: false,
  bytes: false,
  contentType: false,
  redirectTo: false,
}
const HIDEABLE = [
  'title',
  'status',
  'issues',
  'audit',
  'intent',
  'indexability',
  'origin',
  'depth',
  'responseTime',
  'bytes',
  'contentType',
  'redirectTo',
]
const STORAGE_KEY = 'seotools:pages-columns'

/** What was saved, on top of the defaults so a column added later starts with its default. */
function parseVisibility(raw: string | null): ColumnVisibilityState {
  if (!raw) return DEFAULT_VISIBILITY
  try {
    const saved: unknown = JSON.parse(raw)
    if (!saved || typeof saved !== 'object') return DEFAULT_VISIBILITY
    const visibility = { ...DEFAULT_VISIBILITY }
    for (const id of HIDEABLE) {
      const value = (saved as Record<string, unknown>)[id]
      if (typeof value === 'boolean') visibility[id] = value
    }
    return visibility
  } catch {
    return DEFAULT_VISIBILITY
  }
}

/** Only on hover or focus, unless the control is already in use. */
const REVEAL =
  'opacity-0 transition-opacity group-hover/row:opacity-100 group-focus-within/row:opacity-100 focus-visible:opacity-100'

/** The star that marks a page as priority. */
function PriorityStar({ host, row }: { host: string; row: PageRow }) {
  const t = useTranslations('Pages.priority')
  const [, startTransition] = useTransition()
  const [marked, setMarked] = useOptimistic(row.priority)
  const label = t(marked ? 'unmark' : 'mark')
  return (
    <Button
      type="button"
      variant="ghost"
      size="icon-sm"
      aria-label={label}
      title={label}
      aria-pressed={marked}
      className={cn(!marked && REVEAL)}
      onClick={() =>
        startTransition(async () => {
          setMarked(!marked)
          await setPriorityUrlAction(host, row.url, !marked)
        })
      }
    >
      <StarIcon className={marked ? 'fill-current' : undefined} />
    </Button>
  )
}

/** Rows have to stay rows: a page can have dozens of issues, and its detail lists them all. */
const MAX_ISSUE_BADGES = 3

function IssueBadges({
  ids,
  participation,
  analysed,
}: {
  ids: string[]
  participation: AuditParticipation | null
  /** Whether the crawl was checked for issues at all. */
  analysed: boolean
}) {
  const t = useTranslations('PagesDetails')
  const label = useIssueLabel()
  // Four things that are not the same: left out, never checked, checked and clean, and findings.
  if (participation === 'excluded') {
    return (
      <span className="inline-flex items-center gap-1 text-muted-foreground">
        <EyeOffIcon aria-hidden className="size-3.5" />
        {t('findings.excluded')}
      </span>
    )
  }
  if (!analysed) return <span className="text-muted-foreground">{t('findings.notAnalysed')}</span>
  if (ids.length === 0) return <span className="text-muted-foreground">{t('findings.none')}</span>
  const ranked = [...ids].sort(
    (a, b) =>
      Number(isPageIssueId(b)) - Number(isPageIssueId(a)) ||
      (isPageIssueId(a) && isPageIssueId(b) ? compareIssueSeverity(a, b) : 0),
  )
  const rest = ranked.slice(MAX_ISSUE_BADGES)
  return (
    <div className="flex flex-wrap gap-1">
      {ranked.slice(0, MAX_ISSUE_BADGES).map((id) => (
        <IssueBadge key={id} issue={id} />
      ))}
      {rest.length > 0 && (
        <Badge variant="outline" title={rest.map(label).join('\n')}>
          {t('moreIssues', { count: rest.length })}
        </Badge>
      )}
    </div>
  )
}

const Muted = ({ children }: { children: string }) => (
  <span className="text-muted-foreground">{children}</span>
)

function Cell({
  id,
  row,
  host,
  query,
  analysed,
  selected,
  onSelect,
}: {
  id: string
  row: PageRow
  host: string
  query: DetailQuery
  analysed: boolean
  selected: boolean
  onSelect: (value: boolean) => void
}) {
  const t = useTranslations('PagesDetails')
  const format = useFormatter()
  switch (id) {
    case 'select':
      return (
        <Checkbox
          checked={selected}
          onCheckedChange={onSelect}
          aria-label={t('selectRow', { url: row.url })}
        />
      )
    case 'url':
      return (
        <div className="flex max-w-md items-center gap-1">
          <OpenUrlLink
            target={{ hash: row.urlHash, url: row.url }}
            href={detailHref(host, query, { url: row.urlHash })}
            title={row.url}
            className="min-w-0 truncate font-mono text-xs hover:underline"
          >
            {row.url}
          </OpenUrlLink>
          <a
            href={row.url}
            target="_blank"
            rel="noreferrer noopener"
            aria-label={t('openUrl', { url: row.url })}
            title={t('openUrl', { url: row.url })}
            className={cn(buttonVariants({ variant: 'ghost', size: 'icon-xs' }), REVEAL)}
          >
            <ExternalLinkIcon />
          </a>
        </div>
      )
    case 'title':
      return row.title ? (
        <span className="block max-w-xs truncate" title={row.title}>
          {row.title}
        </span>
      ) : (
        <Muted>—</Muted>
      )
    case 'status':
      return <StatusCell row={row} automaticCheck={row.automaticCheck} />
    case 'issueDetail':
      return row.issueDetails.length > 0 ? (
        <IssueDetails details={row.issueDetails} />
      ) : (
        <Muted>—</Muted>
      )
    case 'issues':
      return <IssueBadges ids={row.issues} participation={row.participation} analysed={analysed} />
    case 'audit':
      return row.internal ? (
        <ParticipationBadge participation={row.participation} />
      ) : (
        <Muted>—</Muted>
      )
    case 'intent':
      // The expectation is about pages: an image or a redirect has nothing to meet.
      return row.internal && row.kind === 'page' ? (
        <div className="flex flex-wrap gap-1">
          <IntentBadge intent={row.intent} isDefault={row.intentRule === null} />
          <ConditionBadges conditions={row.conditions} />
        </div>
      ) : (
        <Muted>—</Muted>
      )
    case 'indexability':
      return row.internal ? (
        <IndexabilityBadge state={row.indexability} blockers={row.blockers} />
      ) : (
        <Muted>—</Muted>
      )
    case 'origin':
      return row.internal && row.participation !== null ? (
        <div className="grid max-w-xs gap-1.5 text-xs">
          <RuleOrigin rule={row.participationRule} />
          {row.intentRule !== null && <RuleOrigin rule={row.intentRule} />}
        </div>
      ) : (
        <Muted>—</Muted>
      )
    case 'depth':
      return <span className="tabular-nums">{format.number(row.depth)}</span>
    case 'responseTime':
      return row.responseTimeMs === null ? (
        <Muted>—</Muted>
      ) : (
        <span className="tabular-nums">{t('responseTime', { value: row.responseTimeMs })}</span>
      )
    case 'bytes':
      return row.bytes === null ? (
        <Muted>—</Muted>
      ) : (
        <span className="tabular-nums">{formatBytes(format, row.bytes)}</span>
      )
    case 'contentType':
      return row.contentType ? (
        <span className="block max-w-48 truncate" title={row.contentType}>
          {row.contentType}
        </span>
      ) : (
        <Muted>—</Muted>
      )
    case 'redirectTo':
      return row.redirectTo ? (
        <span className="block max-w-xs truncate font-mono text-xs" title={row.redirectTo}>
          {row.redirectTo}
        </span>
      ) : (
        <Muted>—</Muted>
      )
    case 'actions':
      // Only pages can be prioritised, and an issue lists more than pages.
      return row.kind === 'page' ? (
        <div className="flex justify-end">
          <PriorityStar host={host} row={row} />
        </div>
      ) : null
    default:
      return null
  }
}

function SortableHead({
  id,
  label,
  host,
  query,
}: {
  id: string
  label: string
  host: string
  query: DetailQuery
}) {
  const t = useTranslations('PagesDetails')
  const sort = SORTABLE[id]
  if (!sort) return <>{label}</>
  const active = query.sort === sort
  const Icon = !active ? ArrowUpDownIcon : query.direction === 'asc' ? ArrowUpIcon : ArrowDownIcon
  return (
    <Link
      href={detailHref(host, query, { ...nextSort(query, sort), page: 1 })}
      scroll={false}
      title={
        !active
          ? t('sortBy', { column: label })
          : t(query.direction === 'asc' ? 'sortedAscending' : 'sortedDescending')
      }
      className="-mx-2 inline-flex items-center gap-1 rounded-md px-2 py-1 hover:bg-muted"
    >
      {label}
      <Icon className={cn('size-3.5', !active && 'text-muted-foreground')} />
    </Link>
  )
}

/** The search box. It changes the address, so the server does the filtering. */
function Search({ host, query }: { host: string; query: DetailQuery }) {
  const t = useTranslations('PagesDetails')
  const router = useRouter()

  const onSearch = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault()
    const search = String(new FormData(event.currentTarget).get('q') ?? '')
    router.push(detailHref(host, query, { search: search.trim(), page: 1 }), { scroll: false })
  }

  return (
    <form onSubmit={onSearch} role="search" className="relative w-full shrink-0 sm:w-56 2xl:w-80">
      <SearchIcon className="pointer-events-none absolute top-1/2 left-2.5 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input
        name="q"
        type="search"
        defaultValue={query.search}
        placeholder={t('search.placeholder')}
        aria-label={t('search.label')}
        className="pl-8"
      />
    </form>
  )
}

/**
 * The table of URLs of the last crawl. The server filters, sorts and pages (a site can have
 * hundreds of thousands of URLs), so those controls only change the address; what lives here is
 * the selection and which columns are shown, which the table keeps per browser.
 *
 * Mount it with a `key` that changes with the rows it shows: the selection only makes sense for
 * the page it was made on.
 */
export function PagesTable({
  host,
  rows,
  query,
  analysed,
}: {
  host: string
  rows: PageRow[]
  query: DetailQuery
  /** Whether the crawl was checked for issues: a URL with none is then clean, not unchecked. */
  analysed: boolean
}) {
  const t = useTranslations('PagesDetails')
  const tCatalog = useTranslations('IssueCatalog')
  const tRecheck = useTranslations('Verification')
  const router = useRouter()
  const [recheckError, setRecheckError] = useState<string | null>(null)
  const [stored, saveColumns] = useLocalStorage(STORAGE_KEY)
  const columnVisibility = useMemo(() => parseVisibility(stored), [stored])
  const detail: IssueDetailKind | undefined =
    query.issue && isPageIssueId(query.issue) ? PAGE_ISSUES[query.issue].detail : undefined
  const [pending, startTransition] = useTransition()
  const [selection, setSelection] = useState<Record<string, true>>({})
  const [auditDialogOpen, setAuditDialogOpen] = useState(false)

  const table = useTable({
    features,
    columns,
    data: rows,
    getRowId: (row) => row.urlHash,
    state: {
      columnVisibility: { ...columnVisibility, issueDetail: detail !== undefined },
      rowSelection: selection,
    },
    onRowSelectionChange: (updater: Updater<Record<string, true>>) =>
      setSelection((current) => (typeof updater === 'function' ? updater(current) : updater)),
    onColumnVisibilityChange: (updater: Updater<ColumnVisibilityState>) =>
      saveColumns(
        JSON.stringify(typeof updater === 'function' ? updater(columnVisibility) : updater),
      ),
  })

  const selected = rows.filter((row) => selection[row.urlHash])
  // Only pages can be prioritised.
  const selectedPages = selected.filter((row) => row.kind === 'page')
  // The audit is configured for the URLs of the site, whatever they turned out to be.
  const selectedInternal = selected.filter((row) => row.internal)
  const allSelected = rows.length > 0 && selected.length === rows.length
  const visibleColumns = table.getVisibleLeafColumns()

  const mark = (marked: boolean) =>
    startTransition(async () => {
      await setPriorityUrlsAction(
        host,
        selectedPages.map((row) => row.url),
        marked,
      )
      setSelection({})
    })

  /** Asks the worker to request the selected URLs again, without a crawl. */
  const recheck = () =>
    startTransition(async () => {
      setRecheckError(null)
      const state = await recheckUrlsAction(
        host,
        selectedInternal.map((row) => row.url),
      )
      if (state.error) {
        setRecheckError(state.error)
        return
      }
      setSelection({})
      // The banner above the table follows it from here.
      router.refresh()
    })

  return (
    <div className="grid gap-3">
      {recheckError && (
        <Alert variant="destructive">
          <AlertDescription>{recheckError}</AlertDescription>
        </Alert>
      )}
      {/* One row whatever the selection: what appears for it goes between the search and the
          right-hand controls, and nothing there changes size, so nothing below ever moves. */}
      <div className="flex flex-wrap items-center gap-2 lg:flex-nowrap">
        <Search host={host} query={query} />
        {selected.length > 0 && (
          <div
            role="group"
            aria-label={t('selected', { count: selected.length })}
            className="flex shrink-0 items-center gap-1"
          >
            <span className="px-1 text-sm font-medium whitespace-nowrap">
              {t('selected', { count: selected.length })}
            </span>
            <Button
              variant="ghost"
              size="icon-sm"
              aria-label={t('clearSelection')}
              title={t('clearSelection')}
              onClick={() => setSelection({})}
            >
              <XIcon />
            </Button>
            {(selectedPages.length > 0 || selectedInternal.length > 0) && (
              <DropdownMenu>
                <DropdownMenuTrigger
                  render={<Button variant="outline" size="sm" disabled={pending} />}
                >
                  {t('actionsMenu.label')}
                  <ChevronDownIcon />
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="min-w-52">
                  {selectedPages.length > 0 && (
                    <>
                      <DropdownMenuItem onClick={() => mark(true)}>
                        <StarIcon className="fill-current" />
                        {t('bulk.mark')}
                      </DropdownMenuItem>
                      <DropdownMenuItem onClick={() => mark(false)}>
                        <StarIcon />
                        {t('bulk.unmark')}
                      </DropdownMenuItem>
                    </>
                  )}
                  {selectedPages.length > 0 && selectedInternal.length > 0 && (
                    <DropdownMenuSeparator />
                  )}
                  {selectedInternal.length > 0 && (
                    <>
                      <DropdownMenuItem onClick={() => setAuditDialogOpen(true)}>
                        <SlidersHorizontalIcon />
                        {t('bulk.configureAudit')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        disabled={selectedInternal.length > MAX_VERIFICATION_URLS}
                        onClick={recheck}
                      >
                        <RefreshCwIcon />
                        {selectedInternal.length > MAX_VERIFICATION_URLS
                          ? tRecheck('bulk.recheckLimit', { max: MAX_VERIFICATION_URLS })
                          : tRecheck('bulk.recheck')}
                      </DropdownMenuItem>
                    </>
                  )}
                </DropdownMenuContent>
              </DropdownMenu>
            )}
          </div>
        )}
        <div className="ml-auto flex shrink-0 items-center gap-3">
          <DropdownMenu>
            <DropdownMenuTrigger render={<Button variant="outline" size="sm" />}>
              <Columns3Icon />
              {t('columnsMenu.label')}
            </DropdownMenuTrigger>
            <DropdownMenuContent align="end" className="min-w-52">
              {table
                .getAllLeafColumns()
                .filter((column) => column.getCanHide())
                .map((column) => (
                  <DropdownMenuCheckboxItem
                    key={column.id}
                    checked={column.getIsVisible()}
                    onCheckedChange={(value) => column.toggleVisibility(value)}
                  >
                    {t(`columns.${column.id as 'title'}`)}
                  </DropdownMenuCheckboxItem>
                ))}
              <DropdownMenuSeparator />
              <DropdownMenuItem onClick={() => saveColumns(null)}>
                {t('columnsMenu.reset')}
              </DropdownMenuItem>
            </DropdownMenuContent>
          </DropdownMenu>
        </div>
      </div>

      <Table>
        <TableHeader>
          <TableRow>
            {visibleColumns.map((column) => {
              const sort = SORTABLE[column.id]
              const active = sort !== undefined && query.sort === sort
              return (
                <TableHead
                  key={column.id}
                  className={column.id === 'select' || column.id === 'actions' ? 'w-10' : undefined}
                  aria-sort={
                    active ? (query.direction === 'asc' ? 'ascending' : 'descending') : undefined
                  }
                >
                  {column.id === 'select' ? (
                    <Checkbox
                      checked={allSelected}
                      indeterminate={selected.length > 0 && !allSelected}
                      onCheckedChange={(value) => table.toggleAllRowsSelected(value)}
                      aria-label={t('selectAll')}
                    />
                  ) : column.id === 'actions' ? null : (
                    <SortableHead
                      id={column.id}
                      label={
                        column.id === 'issueDetail' && detail
                          ? tCatalog(`detailColumns.${detail}`)
                          : t(`columns.${column.id as 'url'}`)
                      }
                      host={host}
                      query={query}
                    />
                  )}
                </TableHead>
              )
            })}
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.length === 0 && (
            <TableRow>
              <TableCell
                colSpan={visibleColumns.length}
                className="py-8 text-center text-muted-foreground"
              >
                {t('empty')}
              </TableCell>
            </TableRow>
          )}
          {table.getRowModel().rows.map((row) => (
            <TableRow
              key={row.id}
              data-state={row.getIsSelected() ? 'selected' : undefined}
              className="group/row"
            >
              {row.getVisibleCells().map((cell) => (
                <TableCell key={cell.id}>
                  <Cell
                    id={cell.column.id}
                    row={row.original}
                    host={host}
                    query={query}
                    analysed={analysed}
                    selected={row.getIsSelected()}
                    onSelect={(value) => row.toggleSelected(value)}
                  />
                </TableCell>
              ))}
            </TableRow>
          ))}
        </TableBody>
      </Table>
      <AuditDialog
        host={host}
        urls={selectedInternal.map((row) => row.url)}
        open={auditDialogOpen}
        onOpenChange={setAuditDialogOpen}
        onApplied={() => setSelection({})}
      />
    </div>
  )
}
