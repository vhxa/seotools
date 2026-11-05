import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { CompanyForm } from '@/components/company-form'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requireAdmin } from '@/lib/session'
import { hasDomains } from '@/lib/workspace'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const t = await getTranslations('Onboarding')
  return { title: t('metaTitle') }
}

/**
 * Right after the first admin registers: ask for the first company and domain. It lives outside
 * the (protected) layout, which sends everyone here until a domain exists.
 */
export default async function OnboardingPage() {
  await requireAdmin()
  if (await hasDomains()) redirect('/')
  const t = await getTranslations('Onboarding')

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-md">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <CompanyForm submitLabel={t('submit')} pendingLabel={t('submitting')} />
        </CardContent>
      </Card>
    </main>
  )
}
