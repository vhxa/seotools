import { getTranslations } from 'next-intl/server'
import { CompanyForm } from '@/components/company-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requireSession } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const t = await getTranslations('NewCompany')
  return { title: t('metaTitle') }
}

export default async function NewCompanyPage() {
  await requireSession()
  const t = await getTranslations('NewCompany')

  return (
    <main className="flex justify-center">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <CompanyForm submitLabel={t('submit')} pendingLabel={t('submitting')} cancelHref="/" />
        </CardContent>
      </Card>
    </main>
  )
}
