import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { requireDomain } from '@/lib/workspace'
import { getDb } from '@/lib/db'
import { selectCrawl } from '@/lib/crawl-history'
import { countParameters } from '@/lib/query-parameters'

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
  const db = await getDb()
  const t = await getTranslations('Parameters')
  const kinds = await getTranslations('LinkKinds')
  const regions = await getTranslations('LinkRegions')
  const selection = await selectCrawl(
    db.crawls,
    domain.id,
    typeof query.crawl === 'string' ? query.crawl : null,
  )
  if (selection.kind === 'missing') notFound()
  if (selection.kind === 'empty')
    return (
      <main>
        <h1>{t('title')}</h1>
        <p>{t('empty')}</p>
      </main>
    )
  const { crawl } = selection
  if (crawl.pruned)
    return (
      <main>
        <h1>{t('title')}</h1>
        <p>{t('pruned')}</p>
      </main>
    )
  const counts = new Map<string, number>()
  let scanned = 0
  while (scanned < 100000) {
    const rows = await db.crawls.listUrls({
      crawlId: crawl.id,
      view: 'all',
      search: '?',
      limit: 1000,
      offset: scanned,
    })
    countParameters(
      rows.filter((row) => row.scope === 'internal').map((row) => row.url),
      counts,
    )
    scanned += rows.length
    if (rows.length < 1000) break
  }
  const rawPage = typeof query.page === 'string' ? Number(query.page) : 1
  const page = Number.isSafeInteger(rawPage) && rawPage > 0 ? Math.min(rawPage, 100000) : 1
  const entries = await db.crawls.parameterEntries(crawl.id, { limit: 50, offset: (page - 1) * 50 })
  const base = `/domains/${host}/pages/details`
  const detail = (hash: string) => `${base}/${hash}?crawl=${crawl.id}`
  const pageHref = (value: number) => `?crawl=${crawl.id}&page=${value}`
  return (
    <main className="grid min-w-0 gap-6 [overflow-wrap:anywhere]">
      <h1 className="text-xl font-semibold">{t('title')}</h1>
      <p className="text-sm text-muted-foreground">
        {t('crawl', { date: (crawl.finishedAt ?? crawl.createdAt).toISOString() })}
      </p>
      {scanned >= 100000 && <p>{t('bounded')}</p>}
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead>
            <tr>
              <th>{t('name')}</th>
              <th>{t('count')}</th>
            </tr>
          </thead>
          <tbody>
            {[...counts]
              .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
              .map(([name, count]) => (
                <tr key={name}>
                  <td className="py-2">
                    <Link
                      className="underline"
                      href={`${base}?crawl=${crawl.id}&view=all&q=${encodeURIComponent(name + '=')}`}
                    >
                      {name}
                    </Link>
                  </td>
                  <td>{count}</td>
                </tr>
              ))}
          </tbody>
        </table>
      </div>
      {counts.size === 0 && <p>{t('none')}</p>}
      <h2 className="text-lg font-medium">{t('entries')}</h2>
      {entries.entries.length === 0 && (
        <p className="text-sm text-muted-foreground">{t('noContext')}</p>
      )}
      <ul className="grid gap-4 text-sm">
        {entries.entries.map((entry, index) => (
          <li key={index} className="grid min-w-0 gap-1">
            <Link className="underline" href={detail(entry.sourceHash)}>
              {entry.sourceUrl}
            </Link>
            <Link className="underline" href={detail(entry.urlHash)}>
              → {entry.url}
            </Link>
            <p className="text-muted-foreground">
              {[
                kinds(entry.kind),
                entry.context?.text,
                entry.context?.element,
                entry.context?.region ? regions(entry.context.region) : undefined,
              ]
                .filter(Boolean)
                .join(' · ')}
            </p>
            {entry.context?.snippet ? (
              <p className="font-mono text-xs text-muted-foreground">{entry.context.snippet}</p>
            ) : (
              <p>{t('noContext')}</p>
            )}
          </li>
        ))}
      </ul>
      <nav className="flex gap-4">
        {page > 1 && <Link href={pageHref(page - 1)}>{t('previous')}</Link>}
        {page * 50 < entries.total && <Link href={pageHref(page + 1)}>{t('next')}</Link>}
      </nav>
    </main>
  )
}
