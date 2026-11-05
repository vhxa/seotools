import { hashUserToken } from '@seotools/db'
import type { Metadata } from 'next'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { getDb } from '@/lib/db'
import { SetPasswordForm } from './form'

export const dynamic = 'force-dynamic'

export async function generateMetadata(): Promise<Metadata> {
  const t = await getTranslations('SetPassword')
  // The address holds the token: it must not travel in a Referer header.
  return { title: t('metaTitle'), referrer: 'no-referrer', robots: { index: false } }
}

/** Where an invitation or a recovery link lands. It says nothing about a link that does not work. */
export default async function SetPasswordPage({
  searchParams,
}: {
  searchParams: Promise<{ token?: string | string[] }>
}) {
  const { token } = await searchParams
  const t = await getTranslations('SetPassword')
  const found =
    typeof token === 'string'
      ? await (await getDb()).users.findToken(hashUserToken(token), new Date())
      : null

  return (
    <main className="flex min-h-svh items-center justify-center p-4">
      <Card className="w-full max-w-sm">
        <CardHeader>
          <CardTitle>{found ? t(`titles.${found.kind}`) : t('invalid.title')}</CardTitle>
          <CardDescription>{found ? found.user.email : t('invalid.description')}</CardDescription>
        </CardHeader>
        <CardContent>
          {found && typeof token === 'string' ? (
            <SetPasswordForm token={token} email={found.user.email} />
          ) : (
            <Link href="/forgot-password" className="text-sm underline-offset-4 hover:underline">
              {t('invalid.again')}
            </Link>
          )}
        </CardContent>
      </Card>
    </main>
  )
}
