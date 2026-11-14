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
import { isRenderedCrawl } from '@/lib/rendering'
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

  const unapplied = unappliedFilters(query, {
    auditData: crawl.pagesAudit != null,
    rendered: isRenderedCrawl(crawl),
  })
  const listing = { crawlId: crawl.id, ...listingOf(query, unapplied) }
  const expected = await db.crawls.countListed(listing)
  const moment = crawlMoment(crawl)

  const findingStates = (await db.audit.config(domain.id)).findingStates
  const people = [
    ...new Set((crawl.auditSnapshot?.dismissals ?? []).flatMap((d) => (d.setBy ? [d.setBy] : []))),
  ]
  const decisionNames = new Map(
    await Promise.all(
      people.map(
        async (id) =>
          [id, (await db.users.get(id))?.name ?? translate('FindingStates.formerMember')] as const,
      ),
    ),
  )
  const pieces = exportCsv({
    kind,
    source: db.crawls,
    listing,
    sort: query.sort ? { sort: query.sort, direction: query.direction } : null,
    expected,
    signal: request.signal,
    context: {
      findingStates,
      decisionNames,
      onlyAcceptedKind: query.acceptanceKind,
      host: domain.host,
      crawlId: crawl.id,
      ignoredParameters: crawl.ignoredParameters ?? [],
      crawlDate: moment,
      filters: describeListing(query, unapplied, translate),
      onlyState: query.state,
      onlyIssue: query.state === 'dismissed' ? null : query.issue,
      onlyAccepted: query.state === 'dismissed' ? (query.issue ?? 'all') : query.accepted,
      analysed: crawl.pagesByWorstIssue !== null,
      rendered: isRenderedCrawl(crawl),
      translate,
      vitals: new Map(
        (await db.vitals.urls(crawl.id))
          .filter((row) => row.source === 'field' && row.formFactor === 'PHONE')
          .map((row) => [row.urlHash, row]),
      ),
      extractors: (await db.crawls.settings(domain.id)).extractors,
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
