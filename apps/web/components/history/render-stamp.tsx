import type { Crawl } from '@seotools/db'
import { useTranslations } from 'next-intl'
import { Badge } from '@/components/ui/badge'
import { isRenderedCrawl, renderCoverageOf } from '@/lib/rendering'

/**
 * Which way a crawl looked at the site: the served HTML only, or every page opened in a browser. For
 * a rendered crawl it also says how many pages could not be observed completely and whether the
 * findings that depend on links between pages were evaluated. What the analysis did not record is
 * said as such, never as "complete".
 */
export function RenderStamp({
  crawl,
  detailed = true,
}: {
  crawl: Pick<Crawl, 'rendering' | 'auditSnapshot' | 'type'>
  detailed?: boolean
}) {
  const t = useTranslations('RenderingSummary.stamp')
  const rendered = isRenderedCrawl(crawl)
  const coverage = renderCoverageOf(crawl)
  return (
    <span className="grid gap-0.5">
      <span className="flex flex-wrap items-center gap-1.5">
        <Badge variant="outline" title={t(`hints.${rendered ? 'rendered' : 'html'}`)}>
          {t(rendered ? 'rendered' : 'html')}
        </Badge>
        {rendered && detailed && (
          <span className="text-xs text-muted-foreground">
            {coverage === null
              ? t('coverageUnknown')
              : coverage.unobserved === 0
                ? t('allObserved')
                : t('someUnobserved', { count: coverage.unobserved })}
          </span>
        )}
      </span>
      {rendered && detailed && coverage && coverage.unobserved > 0 && (
        <span className="text-xs text-muted-foreground">
          {coverage.causes &&
            t('causes', {
              failed: coverage.causes.failedOrMissing,
              truncated: coverage.causes.truncated,
              unsettled: coverage.causes.unsettled,
            }) + ' · '}
          {t('linksNotEvaluated')}
        </span>
      )}
      {rendered && detailed && coverage?.unobserved === 0 && (
        <span className="text-xs text-muted-foreground">{t('linksEvaluated')}</span>
      )}
    </span>
  )
}
