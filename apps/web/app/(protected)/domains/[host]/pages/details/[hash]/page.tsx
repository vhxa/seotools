import { ArrowLeftIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { byAge, keepsUrlHistory } from '@seotools/core/crawl/compare'
import { CrawlBanner } from '@/components/history/crawl-banner'
import { CrawlSwitcher } from '@/components/history/crawl-switcher'
import { UrlHistory } from '@/components/history/url-history'
import { UrlDetail } from '@/components/pages/url-detail'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { browsableCrawls, selectCrawl } from '@/lib/crawl-history'
import { getDb } from '@/lib/db'
import { isCrawlId, isUrlHash } from '@/lib/pages-query'
import { loadUrlDetail } from '@/lib/url-detail'
import { requireDomain } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const t = await getTranslations('PagesDetails')
  return { title: t('metaTitle', { host }) }
}

/**
 * The detail of one URL on a page of its own: the full-screen version of the drawer, and the
 * history of the URL across the domain's retained full crawls. `?crawl=` chooses the crawl the
 * detail is of (the latest one without it); the history always spans them all.
 */
export default async function UrlPage({
  params,
  searchParams,
}: {
  params: Promise<{ host: string; hash: string }>
  searchParams: Promise<Record<string, string | string[] | undefined>>
}) {
  const { host, hash } = await params
  const { domain } = await requireDomain(host)
  if (!isUrlHash(hash)) notFound()
  const rawCrawl = (await searchParams).crawl
  const requested = Array.isArray(rawCrawl) ? rawCrawl[0] : rawCrawl
  const t = await getTranslations('UrlDetail')

  const db = await getDb()
  const [selection, config, history] = await Promise.all([
    selectCrawl(db.crawls, domain.id, requested && isCrawlId(requested) ? requested : null),
    db.audit.config(domain.id),
    browsableCrawls(db.crawls, domain.id),
  ])
  // A crawl of another domain is the same as one that does not exist.
  if (selection.kind !== 'selected' || selection.crawl.pruned) notFound()
  const { crawl: selected, latest, historical } = selection
  const latestId = latest?.id ?? null

  const data = await loadUrlDetail({
    domainId: domain.id,
    host: domain.host,
    crawl: selected,
    urlHash: hash,
    historical,
  })
  if (!data) notFound()

  // The history of an URL of the site, across every crawl that still has its results.
  // Oldest first. The crawl on the page is part of it even when it is older than the history goes.
  const crawls = (
    history.some((crawl) => crawl.id === selected.id) ? history : [...history, selected]
  ).sort(byAge)
  const traces =
    data.url.scope === 'internal'
      ? await db.crawls.urlHistory({
          domainId: domain.id,
          crawlIds: crawls.filter(keepsUrlHistory).map((crawl) => crawl.id),
          urlHashes: [hash],
        })
      : []
  const crawlParam = (id: string) => (id === latestId ? '' : `?crawl=${id}`)

  return (
    <main className="grid gap-6">
      <div className="grid justify-items-start gap-3">
        <Link
          href={`/domains/${domain.host}/pages/details${crawlParam(selected.id)}`}
          className={buttonVariants({ variant: 'ghost', size: 'sm' })}
        >
          <ArrowLeftIcon />
          {t('back')}
        </Link>
        <h1 className="font-mono text-lg font-semibold break-all">{data.url.url}</h1>
      </div>
      <Card>
        <CardContent>
          <UrlDetail
            host={domain.host}
            data={data}
            context={
              <CrawlBanner
                crawl={selected}
                historical={historical}
                currentVersion={config.version}
                latestHref={historical ? `/domains/${domain.host}/pages/details/${hash}` : null}
                picker={
                  <CrawlSwitcher
                    crawls={history}
                    selected={selected}
                    latestId={latestId}
                    hrefFor={(crawl) =>
                      `/domains/${domain.host}/pages/details/${hash}${crawlParam(crawl.id)}`
                    }
                  />
                }
              />
            }
            hrefFor={(urlHash) =>
              `/domains/${domain.host}/pages/details/${urlHash}${crawlParam(selected.id)}`
            }
          />
        </CardContent>
      </Card>
      {data.url.scope === 'internal' && (
        <UrlHistory
          host={domain.host}
          urlHash={hash}
          crawls={crawls}
          traces={traces}
          viewingId={selected.id}
        />
      )}
    </main>
  )
}
