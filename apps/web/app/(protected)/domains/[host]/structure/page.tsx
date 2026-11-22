import { auditResultsState } from '@seotools/core/crawl/audit'
import { FolderTreeIcon } from 'lucide-react'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { getFormatter, getTranslations } from 'next-intl/server'
import { AuditResultsNotice } from '@/components/audit/audit-notice'
import { InfoHelp } from '@/components/help'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { getDb } from '@/lib/db'
import { detailHref, parseDetailQuery } from '@/lib/pages-query'
import {
  buildStructure,
  parseStructurePath,
  pathOfDirectories,
  STRUCTURE_DEPTH,
  type StructureCounts,
  type StructureNode,
} from '@/lib/structure'
import { cn } from '@/lib/utils'
import { requireDomain } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const t = await getTranslations('Structure')
  return { title: t('metaTitle', { host }) }
}

/**
 * The directory column keeps room for ordinary names and only truncates (with the full path in a
 * tooltip) the very long ones: it is the column the page is about, the figures are narrow.
 */
const DIRECTORY_CELL = 'min-w-56 max-w-[22rem]'

type Params = Promise<Record<string, string | string[] | undefined>>

/**
 * The directories of the latest full crawl with what is in each: pages, errors and pages with
 * findings. Added up on the server in bounded batches; a node is opened through the address
 * (`?path=/blog/`), never by loading the whole crawl.
 */
export default async function StructurePage({
  params,
  searchParams,
}: {
  params: Promise<{ host: string }>
  searchParams: Params
}) {
  const { host } = await params
  const { domain } = await requireDomain(host)
  const root = parseStructurePath((await searchParams).path)
  const [t, tDashboard, format] = await Promise.all([
    getTranslations('Structure'),
    getTranslations('Dashboard'),
    getFormatter(),
  ])
  const db = await getDb()
  const [latest, config] = await Promise.all([
    db.crawls.latestWithResults(domain.id, 'full'),
    db.audit.config(domain.id),
  ])
  const state = auditResultsState(latest, config)
  // Findings are shown only when the analysis is of this crawl and reflects the configuration.
  const findings =
    latest !== null && latest.pagesWithType !== null && !latest.pruned && state.kind === 'current'
  const crawl = latest && !latest.pruned ? latest : null
  const structure = crawl
    ? await buildStructure({
        root,
        languages: config.languages,
        nextBatch: (after, limit) => db.crawls.listStructureUrls(crawl.id, { after, limit }),
        analysisOf: async (pages) => {
          if (!findings || pages.length === 0) return findings ? new Map() : null
          const hashes = pages.map(({ urlHash }) => urlHash)
          const [issues, audit] = await Promise.all([
            db.crawls.issuesOf(crawl.id, hashes),
            db.crawls.auditOf(crawl.id, hashes),
          ])
          const found = new Map(
            hashes.map((hash) => [
              hash,
              {
                audit: undefined as (typeof audit)[number] | undefined,
                issues: [] as typeof issues,
              },
            ]),
          )
          for (const row of audit) {
            const entry = found.get(row.urlHash)
            if (entry) entry.audit = row
          }
          for (const row of issues) found.get(row.urlHash)?.issues.push(row)
          return found
        },
      })
    : null

  const query = parseDetailQuery({})
  const number = (value: number) => format.number(value)
  const urlsOf = (path: string, view?: 'errors') =>
    detailHref(domain.host, query, { search: `${domain.host}${path}`, ...(view ? { view } : {}) })
  const href = (directories: readonly string[]) =>
    directories.length === 0
      ? `/domains/${domain.host}/structure`
      : `/domains/${domain.host}/structure?${new URLSearchParams({ path: pathOfDirectories(directories) })}`

  // Pages and what is found on them first; failing URLs last, apart: they are not pages and are
  // not comparable with them (hreflang targets and other references that failed count too).
  const columns = [
    { key: 'pages', label: t('columns.pages'), help: t('columns.pagesHelp') },
    { key: 'issue', label: t('columns.issue'), help: null },
    { key: 'warning', label: t('columns.warning'), help: null },
    { key: 'opportunity', label: t('columns.opportunity'), help: null },
    { key: 'errors', label: t('columns.errors'), help: t('columns.errorsHelp') },
  ] as const

  const headCells = columns.map(({ key, label, help }) => (
    <TableHead
      key={key}
      className={cn('text-right whitespace-normal', key === 'errors' && 'border-l')}
    >
      <span className="inline-flex items-center justify-end gap-0.5">
        {label}
        {help && (
          <InfoHelp label={label} compact>
            {help}
          </InfoHelp>
        )}
      </span>
    </TableHead>
  ))

  /** The figures of a row, each leading to its URLs; `path: null` for a sum with no one address. */
  function cells(path: string | null, counts: StructureCounts) {
    return columns.map(({ key }) => {
      const value = counts[key]
      const unknown = !findings && (key === 'issue' || key === 'warning' || key === 'opportunity')
      return (
        <TableCell
          key={key}
          className={cn('text-right tabular-nums', key === 'errors' && 'border-l')}
        >
          {unknown ? (
            <span className="text-muted-foreground">—</span>
          ) : value === 0 ? (
            <span className="text-muted-foreground">0</span>
          ) : path === null ? (
            number(value)
          ) : (
            <Link
              href={urlsOf(path, key === 'errors' ? 'errors' : undefined)}
              className="underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {number(value)}
            </Link>
          )}
        </TableCell>
      )
    })
  }

  function rows(nodes: StructureNode[], level: number, parent: StructureNode): ReactNode[] {
    const out: ReactNode[] = []
    for (const child of nodes) {
      out.push(
        <TableRow key={child.path}>
          <TableCell className={DIRECTORY_CELL}>
            <div
              className="flex min-w-0 items-center gap-2"
              style={{ paddingLeft: `${level * 1.25}rem` }}
            >
              <Link
                href={href(child.path.split('/').filter(Boolean))}
                className="min-w-0 truncate font-mono text-sm underline-offset-4 hover:underline focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
                title={child.path}
              >
                {child.name}/
              </Link>
              {child.deeper && (
                <span className="shrink-0 text-xs text-muted-foreground">{t('hasMore')}</span>
              )}
            </div>
          </TableCell>
          {cells(child.path, child.counts)}
        </TableRow>,
      )
      out.push(...rows(child.children, level + 1, child))
    }
    if (parent.other) {
      out.push(
        <TableRow key={`${parent.path}…other`}>
          <TableCell className={DIRECTORY_CELL}>
            <span
              className="block truncate text-sm text-muted-foreground"
              style={{ paddingLeft: `${level * 1.25}rem` }}
            >
              {parent.other.directories === null
                ? t('otherMany')
                : t('other', { count: parent.other.directories })}
            </span>
          </TableCell>
          {cells(null, parent.other.counts)}
        </TableRow>,
      )
    }
    return out
  }

  const top = structure?.tree
  const crumbs = root.map((name, index) => ({ name, directories: root.slice(0, index + 1) }))

  return (
    <main className="grid gap-8">
      <div className="grid gap-1">
        <h1 className="text-xl font-semibold">{t('title')}</h1>
        <p className="text-sm text-muted-foreground">{t('description')}</p>
      </div>

      <AuditResultsNotice host={domain.host} state={state} />

      {!latest ? (
        <p className="text-sm text-muted-foreground">{t('noCrawl')}</p>
      ) : !crawl ? (
        <p className="text-sm text-muted-foreground">{tDashboard('pruned')}</p>
      ) : (
        <>
          {latest.pagesWithType === null && (
            <p className="text-sm text-muted-foreground">{t('notChecked')}</p>
          )}
          {latest.status === 'incomplete' && (
            <p className="text-sm text-muted-foreground">
              {t('incomplete', { urls: latest.urlsCount })}
            </p>
          )}
          {structure && top && (
            <section aria-labelledby="tree" className="grid gap-3">
              <h2 id="tree" className="flex items-center text-base font-medium">
                {t('tree')}
                <InfoHelp label={t('tree')}>{t('treeHelp', { depth: STRUCTURE_DEPTH })}</InfoHelp>
              </h2>
              <nav aria-label={t('breadcrumb')}>
                <ol className="flex flex-wrap items-center gap-1 font-mono text-sm">
                  <li>
                    {root.length === 0 ? (
                      <span aria-current="page">{domain.host}/</span>
                    ) : (
                      <Link href={href([])} className="underline-offset-4 hover:underline">
                        {domain.host}/
                      </Link>
                    )}
                  </li>
                  {crumbs.map(({ name, directories }, index) => (
                    <li key={directories.join('/')}>
                      {index === crumbs.length - 1 ? (
                        <span aria-current="page">{name}/</span>
                      ) : (
                        <Link
                          href={href(directories)}
                          className="underline-offset-4 hover:underline"
                        >
                          {name}/
                        </Link>
                      )}
                    </li>
                  ))}
                </ol>
              </nav>
              {top.counts.pages === 0 && top.counts.errors === 0 && top.children.length === 0 ? (
                <p className="rounded-xl border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
                  {t('emptyPath')}
                </p>
              ) : (
                <div className="overflow-x-auto rounded-xl border bg-card shadow-card [&_thead]:bg-muted/50">
                  <Table>
                    <TableHeader>
                      <TableRow>
                        <TableHead>{t('directory')}</TableHead>
                        {headCells}
                      </TableRow>
                    </TableHeader>
                    <TableBody>
                      <TableRow className="bg-muted/40 font-medium">
                        <TableCell
                          className={cn(DIRECTORY_CELL, 'truncate font-mono text-sm')}
                          title={top.path}
                        >
                          <FolderTreeIcon className="mr-2 inline size-4 align-text-bottom" />
                          {top.path}
                        </TableCell>
                        {cells(top.path, top.counts)}
                      </TableRow>
                      {rows(top.children, 1, top)}
                    </TableBody>
                  </Table>
                </div>
              )}
              {!findings && latest.pagesWithType !== null && state.kind !== 'current' && (
                <p className="text-xs text-muted-foreground">{t('findingsHidden')}</p>
              )}
            </section>
          )}

          {structure && structure.languages.some(({ prefix }) => prefix !== null) && (
            <section aria-labelledby="languages" className="grid gap-3">
              <h2 id="languages" className="flex items-center text-base font-medium">
                {t('languages')}
                <InfoHelp label={t('languages')}>{t('languagesHelp')}</InfoHelp>
              </h2>
              <div className="overflow-x-auto rounded-xl border bg-card shadow-card [&_thead]:bg-muted/50">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>{t('directory')}</TableHead>
                      {headCells}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {structure.languages.map(({ prefix, counts }) => (
                      <TableRow key={prefix ?? 'rest'}>
                        <TableCell className="font-mono text-sm">
                          {prefix === null ? (
                            <span className="font-sans text-muted-foreground">
                              {t(config.languages.unprefixed ? 'unprefixed' : 'rest')}
                            </span>
                          ) : (
                            <Link
                              href={href([prefix.slice(1)])}
                              className="underline-offset-4 hover:underline"
                            >
                              {prefix}/
                            </Link>
                          )}
                        </TableCell>
                        {cells(prefix === null ? null : `${prefix}/`, counts)}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </section>
          )}
          {structure?.truncated && (
            <p className="text-xs text-muted-foreground">{t('truncated')}</p>
          )}
        </>
      )}
    </main>
  )
}
