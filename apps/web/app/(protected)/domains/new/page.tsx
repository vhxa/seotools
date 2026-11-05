import { getTranslations } from 'next-intl/server'
import { AddDomainForm } from '@/components/add-domain-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getDb } from '@/lib/db'
import { requireAdmin } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const t = await getTranslations('NewDomain')
  return { title: t('metaTitle') }
}

// `new` can never be a tracked host (hosts always contain a dot), so it doesn't clash with [host].
export default async function NewDomainPage({
  searchParams,
}: {
  searchParams: Promise<{ company?: string }>
}) {
  await requireAdmin()
  const t = await getTranslations('NewDomain')
  const { company } = await searchParams
  const companies = await (await getDb()).companies.list()
  const defaultCompany = companies.find((c) => c.id === company) ?? companies[0]

  return (
    <main className="flex justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {defaultCompany && (
            <AddDomainForm
              companies={companies.map(({ id, name }) => ({ id, name }))}
              defaultCompanyId={defaultCompany.id}
              cancelHref="/"
            />
          )}
        </CardContent>
      </Card>
    </main>
  )
}
