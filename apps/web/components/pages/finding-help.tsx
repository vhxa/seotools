import { isPageIssueId, PAGE_ISSUES } from '@seotools/core/crawl/issues'
import { useTranslations, type AppConfig } from 'next-intl'

/** A next step for the finding's subject, without assuming the user's indexing intent. */
export function FindingHelp({ issue }: { issue: string }) {
  const t = useTranslations('FindingHelp')
  if (!isPageIssueId(issue)) return null
  const specificKey = issue as keyof AppConfig['Messages']['FindingHelp']
  return (
    <div className="grid gap-1 text-sm">
      <p className="font-medium">{t('title')}</p>
      <p className="text-muted-foreground">
        {t.has(specificKey) ? t(specificKey) : t(PAGE_ISSUES[issue].category)}
      </p>
    </div>
  )
}
