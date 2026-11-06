import { ArchiveIcon } from 'lucide-react'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { Alert, AlertAction, AlertDescription } from '@/components/ui/alert'
import { buttonVariants } from '@/components/ui/button'

/** One compact line on every page of an archived domain: where to restore it, and why it is read only. */
export async function ArchivedNotice({ canManage }: { canManage: boolean }) {
  const t = await getTranslations('Archive')
  return (
    <Alert className="mb-4">
      <ArchiveIcon />
      <AlertDescription>{t('notice')}</AlertDescription>
      {canManage && (
        <AlertAction>
          <Link href="/system/companies" className={buttonVariants({ variant: 'outline', size: 'sm' })}>
            {t('manage')}
          </Link>
        </AlertAction>
      )}
    </Alert>
  )
}
