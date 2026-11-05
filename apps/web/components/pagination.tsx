import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import type { ReactNode } from 'react'
import { buttonVariants } from '@/components/ui/button'

/** Previous and next links with a summary. Keeps the current page visible even when everything fits. */
export async function Pagination({
  page,
  pageCount,
  href,
  details,
}: {
  details?: ReactNode
  page: number
  pageCount: number
  href: (page: number) => string
}) {
  const t = await getTranslations('Pagination')
  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <div className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-xs text-muted-foreground">
        <p className="font-medium text-foreground">{t('summary', { page, pages: pageCount })}</p>
        {details}
      </div>
      <div className="flex gap-2">
        {page > 1 && (
          <Link
            href={href(page - 1)}
            scroll={false}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            {t('previous')}
          </Link>
        )}
        {page < pageCount && (
          <Link
            href={href(page + 1)}
            scroll={false}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            {t('next')}
          </Link>
        )}
      </div>
    </div>
  )
}
