'use client'

import { TriangleAlertIcon } from 'lucide-react'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { Button, buttonVariants } from '@/components/ui/button'

/**
 * What a page of the signed-in app shows when rendering it throws. The message and the stack never
 * reach the screen (they can hold paths or data): only the digest, which finds the error in the logs.
 */
export default function ProtectedError({
  error,
  reset,
}: {
  error: Error & { digest?: string }
  reset: () => void
}) {
  const t = useTranslations('AppError')
  return (
    <main className="grid justify-items-center gap-4 py-16 text-center">
      <TriangleAlertIcon className="size-10 text-muted-foreground" aria-hidden />
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p className="max-w-prose text-sm text-muted-foreground">{t('description')}</p>
      {error.digest && (
        <p className="text-xs text-muted-foreground">{t('reference', { digest: error.digest })}</p>
      )}
      <div className="flex flex-wrap justify-center gap-2">
        <Button onClick={() => reset()}>{t('retry')}</Button>
        <Link href="/" className={buttonVariants({ variant: 'outline' })}>
          {t('home')}
        </Link>
      </div>
    </main>
  )
}
