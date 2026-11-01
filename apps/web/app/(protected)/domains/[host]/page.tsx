import { getTranslations } from 'next-intl/server'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requireDomain } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

export async function generateMetadata({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const t = await getTranslations('DomainHome')
  return { title: t('metaTitle', { host }) }
}

export default async function DomainPage({ params }: { params: Promise<{ host: string }> }) {
  const { host } = await params
  const { domain, company } = await requireDomain(host)
  const t = await getTranslations('DomainHome')

  return (
    <main className="grid gap-6">
      <div className="grid gap-1">
        <h1 className="text-2xl font-semibold">{domain.host}</h1>
        <p className="text-sm text-muted-foreground">{t('company', { company: company.name })}</p>
      </div>
      <Card>
        <CardHeader>
          <CardTitle>{t('emptyTitle')}</CardTitle>
          <CardDescription>{t('emptyDescription', { host: domain.host })}</CardDescription>
        </CardHeader>
      </Card>
    </main>
  )
}
