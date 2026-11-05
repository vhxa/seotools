import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { ForgotPasswordForm } from './form'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  return { title: (await getTranslations('PasswordRecovery'))('title') }
}

export default async function ForgotPasswordPage() {
  const t = await getTranslations('PasswordRecovery')
  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{t('title')}</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          <ForgotPasswordForm />
          <Link href="/login" className="text-sm underline-offset-4 hover:underline">
            {t('backToLogin')}
          </Link>
        </CardContent>
      </Card>
    </main>
  )
}
