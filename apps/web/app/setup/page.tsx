import { needsSetup } from '@seotools/db'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getDb } from '@/lib/db'
import { SetupForm } from './setup-form'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const t = await getTranslations('Setup')
  return { title: t('metaTitle') }
}

export default async function SetupPage() {
  // Setup exists only until the first admin does.
  if (!(await needsSetup(await getDb()))) redirect('/login')
  const t = await getTranslations('Setup')

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent>
          <SetupForm />
        </CardContent>
      </Card>
    </main>
  )
}
