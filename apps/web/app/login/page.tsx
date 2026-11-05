import { needsSetup } from '@seotools/db'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { getTranslations } from 'next-intl/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getDb } from '@/lib/db'
import { getSession } from '@/lib/session'
import { LoginForm } from './login-form'

export const dynamic = 'force-dynamic'

export async function generateMetadata() {
  const t = await getTranslations('Login')
  return { title: t('metaTitle') }
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ password?: string }>
}) {
  // A fresh install has no admin yet: send the visitor to register one.
  if (await needsSetup(await getDb())) redirect('/setup')
  if (await getSession()) redirect('/')
  const t = await getTranslations('Login')
  const { password } = await searchParams

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>seotools</CardTitle>
          <CardDescription>{t('description')}</CardDescription>
        </CardHeader>
        <CardContent className="grid gap-4">
          {password === 'set' && (
            <p role="status" className="text-sm text-muted-foreground">
              {t('passwordSet')}
            </p>
          )}
          <LoginForm />
          <Link href="/forgot-password" className="text-sm underline-offset-4 hover:underline">
            {t('forgot')}
          </Link>
        </CardContent>
      </Card>
    </main>
  )
}
