import { getTranslations } from 'next-intl/server'
import Link from 'next/link'
import { buttonVariants } from '@/components/ui/button'

/** Previous and next links with a summary. Renders nothing when everything fits in one page. */
export async function Pagination({
  page,
  pageCount,
  href,
}: {
  page: number
  pageCount: number
  href: (page: number) => string
}) {
  if (pageCount <= 1) return null
  const t = await getTranslations('Pagination')
  return (
    <div className="flex items-center justify-between gap-4">
      <p className="text-sm text-muted-foreground">{t('summary', { page, pages: pageCount })}</p>
      <div className="flex gap-2">
        {page > 1 && (
          <Link
            href={href(page - 1)}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            {t('previous')}
          </Link>
        )}
        {page < pageCount && (
          <Link
            href={href(page + 1)}
            className={buttonVariants({ variant: 'outline', size: 'sm' })}
          >
            {t('next')}
          </Link>
        )}
      </div>
    </div>
  )
}
