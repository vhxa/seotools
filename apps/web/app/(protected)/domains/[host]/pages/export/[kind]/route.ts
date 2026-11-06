import { getTranslations } from 'next-intl/server'
import { selectCrawl } from '@/lib/crawl-history'
import { getDb } from '@/lib/db'
import {
  contentDisposition,
  crawlMoment,
  csvStream,
  describeListing,
  exportCsv,
  exportFileName,
  exportRefusal,
  isExportKind,
  rawParamsOf,
  type Translate,
} from '@/lib/pages-export'
import { listingOf, parseDetailQuery, unappliedFilters } from '@/lib/pages-query'
import { requireDomain } from '@/lib/workspace'
import { dynamicTranslator } from '@/lib/dynamic-translator'

export const dynamic = 'force-dynamic'

const text = (status: number, message: string) =>
  new Response(message, {
    status,
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })

/**
 * The CSV of what the pages table lists for the address (`pages`: one row per URL; `findings`: one
 * row per finding), all of it and not the page on screen. The query is read by the table's own
 * parser and filters, so a file and the screen it was made from never disagree. The file is written
 * as it is read, a batch of URLs at a time, and stops when the client goes away.
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ host: string; kind: string }> },
) {
  const { host, kind } = await params
  // The single place where who may see a domain is decided.
  const { domain } = await requireDomain(host)
  if (!isExportKind(kind)) return text(404, 'Not found')

  const [t, db] = await Promise.all([getTranslations(), getDb()])
  const translate: Translate = dynamicTranslator(t)

  const query = parseDetailQuery(rawParamsOf(new URL(request.url).searchParams))
  // The crawl in the address if it is one of this domain's, the latest one otherwise.
  const selection = await selectCrawl(db.crawls, domain.id, query.crawl)
  const refusal = exportRefusal(selection, kind)
  if (refusal) return text(refusal.status, translate(refusal.message))
  if (selection.kind !== 'selected') return text(404, 'Not found')
  const { crawl } = selection

  const unapplied = unappliedFilters(query, { auditData: crawl.pagesAudit != null })
  const listing = { crawlId: crawl.id, ...listingOf(query, unapplied) }
  const expected = await db.crawls.countListed(listing)
  const moment = crawlMoment(crawl)

  const pieces = exportCsv({
    kind,
    source: db.crawls,
    listing,
    sort: query.sort ? { sort: query.sort, direction: query.direction } : null,
    expected,
    signal: request.signal,
    context: {
      host: domain.host,
      crawlId: crawl.id,
      crawlDate: moment,
      filters: describeListing(query, unapplied, translate),
      onlyIssue: query.issue,
      onlyAccepted: query.accepted,
      analysed: crawl.pagesByWorstIssue !== null,
      translate,
    },
  })

  return new Response(csvStream(pieces, request.signal), {
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': contentDisposition(exportFileName(domain.host, kind, moment)),
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
    },
  })
}
