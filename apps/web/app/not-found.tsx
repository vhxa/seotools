import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { buttonVariants } from '@/components/ui/button'

export default async function NotFound() {
  const t = await getTranslations('NotFound')
  return (
    // Not min-h-svh: this also renders inside the protected layout, below its header.
    <main className="flex min-h-[60svh] flex-col items-center justify-center gap-4 p-4 text-center">
      <h1 className="text-2xl font-semibold">{t('title')}</h1>
      <p className="max-w-sm text-sm text-muted-foreground">{t('description')}</p>
      <Link href="/" className={buttonVariants()}>
        {t('back')}
      </Link>
    </main>
  )
}
