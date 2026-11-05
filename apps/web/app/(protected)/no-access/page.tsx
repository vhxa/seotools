import { getTranslations } from 'next-intl/server'
import { Card, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { requireViewer } from '@/lib/session'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  return { title: (await getTranslations('NoAccess'))('title') }
}

/** Where someone without any company or domain lands. */
export default async function NoAccessPage() {
  await requireViewer()
  const t = await getTranslations('NoAccess')
  return (
    <main>
      <Card>
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
      </Card>
    </main>
  )
}
