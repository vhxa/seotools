import { useTranslations } from 'next-intl'

/** Says on each page of the Crawls section that it is one, above its heading. */
export function CrawlsContext() {
  const t = useTranslations('Sidebar')
  return <p className="text-sm text-muted-foreground">{t('crawls')}</p>
}
