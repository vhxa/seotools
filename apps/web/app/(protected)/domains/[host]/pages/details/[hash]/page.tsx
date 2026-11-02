import { ArrowLeftIcon } from 'lucide-react'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { UrlDetail } from '@/components/pages/url-detail'
import { buttonVariants } from '@/components/ui/button'
import { Card, CardContent } from '@/components/ui/card'
import { getDb } from '@/lib/db'
import { isUrlHash } from '@/lib/pages-query'
import { loadUrlDetail } from '@/lib/url-detail'
import { requireDomain } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const t = await getTranslations('PagesDetails')
  return { title: t('metaTitle', { host }) }
}

/** The detail of one URL on a page of its own: the full-screen version of the drawer. */
export default async function UrlPage({
  params,
}: {
  params: Promise<{ host: string; hash: string }>
}) {
  const { host, hash } = await params
  const { domain } = await requireDomain(host)
  if (!isUrlHash(hash)) notFound()
  const t = await getTranslations('UrlDetail')

  const latest = await (await getDb()).crawls.latestWithResults(domain.id, 'full')
  if (!latest) notFound()
  const data = await loadUrlDetail({
    domainId: domain.id,
    host: domain.host,
    crawl: latest,
    urlHash: hash,
    linkLimit: 100,
  })
  if (!data) notFound()

  return (
    <main className="grid gap-6">
      <div className="grid justify-items-start gap-3">
        <Link
          href={`/domains/${domain.host}/pages/details`}
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
            hrefFor={(urlHash) => `/domains/${domain.host}/pages/details/${urlHash}`}
          />
        </CardContent>
      </Card>
    </main>
  )
}
