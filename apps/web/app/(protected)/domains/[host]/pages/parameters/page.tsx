import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getFormatter, getTranslations } from 'next-intl/server'
import { selectCrawl } from '@/lib/crawl-history'
import { getDb } from '@/lib/db'
import { crawlMoment } from '@/lib/pages-export'
import { PARAMETER_SCAN_LIMIT, parameterSummary } from '@/lib/query-parameters'
import { requireDomain } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

const ENTRIES_PER_PAGE = 50

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const t = await getTranslations('Parameters')
  return { title: t('metaTitle', { host }) }
}

/**
 * The query parameters of a retained full crawl: how many internal URLs carry each, and where they
 * enter the site (a link from a URL without the parameter to one with it), with the context the
 * crawl stored for that link. Read from what the crawl stored; nothing is requested.
 */
export default async function ParametersPage({
  params,
  searchParams,
}: {
  params: Promise<{ host: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { host } = await params
  const { domain } = await requireDomain(host)
  const query = await searchParams
  const [db, t, tKinds, tRegions, format] = await Promise.all([
    getDb(),
    getTranslations('Parameters'),
    getTranslations('LinkKinds'),
    getTranslations('LinkRegions'),
    getFormatter(),
  ])
  const selection = await selectCrawl(
    db.crawls,
    domain.id,
    typeof query.crawl === 'string' ? query.crawl : null,
  )
  if (selection.kind === 'missing') notFound()

  const base = `/domains/${domain.host}/pages/details`
  const header = (
    <div className="grid gap-1">
      <Link href={base} className="text-sm text-muted-foreground hover:underline">
        {t('back')}
      </Link>
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      {selection.kind === 'selected' && (
        <p className="text-sm text-muted-foreground">
          {t('crawl', {
            date: format.dateTime(crawlMoment(selection.crawl), {
              dateStyle: 'medium',
              timeStyle: 'short',
            }),
          })}
        </p>
      )}
    </div>
  )
  if (selection.kind === 'empty' || selection.crawl.pruned) {
    return (
      <main className="grid gap-6">
        {header}
        <p className="text-sm text-muted-foreground">
          {selection.kind === 'empty' ? t('empty') : t('pruned')}
        </p>
      </main>
    )
  }
  const { crawl } = selection

  const { parameters, bounded } = await parameterSummary(db.crawls, crawl.id)

  const rawPage = typeof query.page === 'string' ? Number(query.page) : 1
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 100_000) : 1
  const entries = await db.crawls.parameterEntries(crawl.id, {
    limit: ENTRIES_PER_PAGE,
    offset: (page - 1) * ENTRIES_PER_PAGE,
  })
  const detail = (hash: string) => `${base}/${hash}?crawl=${crawl.id}`
  const pageHref = (value: number) => `?crawl=${crawl.id}&page=${value}`

  return (
    <main className="grid min-w-0 gap-8 [overflow-wrap:anywhere]">
      {header}

      <section aria-labelledby="parameters" className="grid gap-2">
        <h2 id="parameters" className="text-lg font-medium">
          {t('names')}
        </h2>
        {bounded && (
          <p className="text-sm text-muted-foreground">
            {t('bounded', { count: PARAMETER_SCAN_LIMIT })}
          </p>
        )}
        {parameters.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('none')}</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-sm">
              <thead className="text-muted-foreground">
                <tr className="border-b">
                  <th scope="col" className="py-2 pr-4 font-medium">
                    {t('name')}
                  </th>
                  <th scope="col" className="py-2 text-right font-medium">
                    {t('count')}
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {parameters.map(([name, count]) => (
                  <tr key={name}>
                    <td className="py-2 pr-4 font-mono">
                      <Link
                        className="hover:underline"
                        href={`${base}?crawl=${crawl.id}&view=all&q=${encodeURIComponent(`${name}=`)}`}
                      >
                        {name}
                      </Link>
                    </td>
                    <td className="py-2 text-right tabular-nums">{format.number(count)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </section>

      <section aria-labelledby="entries" className="grid gap-2">
        <h2 id="entries" className="text-lg font-medium">
          {t('entries')}
        </h2>
        <p className="text-sm text-muted-foreground">{t('entriesHelp')}</p>
        {entries.entries.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noContext')}</p>
        ) : (
          <ul className="grid divide-y text-sm">
            {entries.entries.map((entry, index) => (
              <li key={`${entry.sourceHash}-${entry.urlHash}-${index}`} className="grid gap-1 py-3">
                <Link className="hover:underline" href={detail(entry.sourceHash)}>
                  {entry.sourceUrl}
                </Link>
                <Link className="font-medium hover:underline" href={detail(entry.urlHash)}>
                  → {entry.url}
                </Link>
                <p className="text-muted-foreground">
                  {[
                    tKinds(entry.kind),
                    entry.context?.text ? `“${entry.context.text}”` : undefined,
                    entry.context?.element,
                    entry.context?.region ? tRegions(entry.context.region) : undefined,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                {entry.context?.snippet && (
                  <code className="block overflow-x-auto rounded bg-muted px-2 py-1 font-mono text-xs whitespace-pre-wrap">
                    {entry.context.snippet}
                  </code>
                )}
              </li>
            ))}
          </ul>
        )}
        {(page > 1 || page * ENTRIES_PER_PAGE < entries.total) && (
          <nav aria-label={t('pagination')} className="flex gap-4 text-sm">
            {page > 1 && (
              <Link className="hover:underline" href={pageHref(page - 1)}>
                {t('previous')}
              </Link>
            )}
            {page * ENTRIES_PER_PAGE < entries.total && (
              <Link className="hover:underline" href={pageHref(page + 1)}>
                {t('next')}
              </Link>
            )}
          </nav>
        )}
      </section>
    </main>
  )
}
