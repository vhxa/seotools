import type { RenderCounts } from '@seotools/core/crawl/render-state'
import type { Crawl } from '@seotools/db'
import Link from 'next/link'
import { useFormatter, useTranslations } from 'next-intl'
import { HelpDisclosure, InfoHelp } from '@/components/help'
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card'
import { detailHref, parseDetailQuery } from '@/lib/pages-query'
import { coverageGapOf, renderCoverageOf } from '@/lib/rendering'

/**
 * What a finding group of the block counts. Each issue is listed on its own: one page can have
 * several, so they are never added up into a number of pages.
 */
const GROUPS = {
  links: ['links-only-after-rendering', 'linked-only-by-javascript'],
  text: ['text-only-after-rendering'],
  tags: [
    'title-only-after-rendering',
    'title-changed-by-javascript',
    'description-only-after-rendering',
    'description-changed-by-javascript',
    'h1-only-after-rendering',
    'h1-changed-by-javascript',
    'canonical-only-after-rendering',
    'canonical-changed-by-javascript',
    'noindex-only-in-html',
    'noindex-added-by-javascript',
    'nofollow-only-in-html',
    'nofollow-added-by-javascript',
    'structured-data-only-after-rendering',
    'hreflang-only-after-rendering',
    'social-tags-only-after-rendering',
  ],
} as const

/**
 * The dashboard block of a rendered crawl: how many of its pages show links, text or tags only after
 * rendering, and how many could not be observed completely (and what that leaves unknown). It is not
 * a tile: the four stay as they are. `current` is whether the findings are those of the rules in force.
 */
export function RenderingSummary({
  host,
  crawl,
  counts,
  issueCounts,
  analysed,
}: {
  host: string
  crawl: Crawl
  /** Renders of the crawl by state; `undefined`: its results were pruned. */
  counts: RenderCounts | undefined
  issueCounts: { issue: string; pages: number }[]
  /** The crawl was checked for findings: without it the numbers of findings are not known. */
  analysed: boolean
}) {
  const t = useTranslations('RenderingSummary')
  const tIssues = useTranslations('PageIssues')
  const format = useFormatter()
  const coverage = renderCoverageOf(crawl)
  const query = parseDetailQuery({})
  const found = new Map(issueCounts.map((row) => [row.issue, row.pages]))
  const rendered = counts
    ? Object.values(counts).reduce((sum, n) => sum + n, 0) - counts.failed
    : null
  const anyFinding = Object.values(GROUPS).some((ids) => ids.some((id) => (found.get(id) ?? 0) > 0))

  const unknownNotes = [
    coverage && coverage.unobserved > 0 ? t('linksUnknown') : null,
    coverage?.causes && coverage.causes.unsettled > 0
      ? t('loading', { count: coverage.causes.unsettled })
      : null,
  ].filter((note): note is string => note !== null)

  return (
    <section aria-labelledby="rendering">
      <Card>
        <CardHeader>
          <CardTitle id="rendering" className="flex items-center">
            {t('title')}
            <InfoHelp label={t('title')}>{t('help')}</InfoHelp>
          </CardTitle>
          {rendered !== null && (
            <CardDescription>{t('rendered', { count: rendered })}</CardDescription>
          )}
        </CardHeader>
        <CardContent className="grid gap-6">
          <div className="grid gap-1 text-sm">
            {coverage === null ? (
              <p className="text-muted-foreground">
                {crawl.status === 'cancelled'
                  ? t('stamp.cancelledNotAnalysed')
                  : t(
                      coverageGapOf(crawl) === 'not-analysed'
                        ? 'coverageUnknown'
                        : 'coverageNotRecorded',
                    )}
              </p>
            ) : coverage.unobserved === 0 ? (
              <p>{t('allObserved')}</p>
            ) : (
              <>
                <p className="font-medium">{t('someUnobserved', { count: coverage.unobserved })}</p>
                {coverage.causes && (
                  <p className="text-muted-foreground">
                    {t('causes', {
                      failed: coverage.causes.failedOrMissing,
                      truncated: coverage.causes.truncated,
                      legacyUnsettled: coverage.causes.legacyUnsettled ?? 0,
                    })}
                  </p>
                )}
              </>
            )}
            {unknownNotes.length > 0 && (
              <HelpDisclosure title={t('unknownTitle')}>
                {unknownNotes.map((note) => (
                  <p key={note}>{note}</p>
                ))}
              </HelpDisclosure>
            )}
          </div>
          {analysed ? (
            <div className="grid gap-6 sm:grid-cols-3">
              {(Object.keys(GROUPS) as (keyof typeof GROUPS)[]).map((group) => {
                const rows = GROUPS[group].flatMap((id) => {
                  const pages = found.get(id) ?? 0
                  return pages > 0 ? [{ id, pages }] : []
                })
                return (
                  <div key={group} className="grid content-start gap-2">
                    <h3 className="text-sm text-muted-foreground">{t(`groups.${group}`)}</h3>
                    {rows.length === 0 ? (
                      // Pages that could not be observed completely, or whose coverage is not known,
                      // may have what is not listed here: never "none" then.
                      <p className="text-sm">
                        {coverage === null
                          ? t('linksUnknownGroup')
                          : coverage.unobserved > 0
                            ? t(group === 'links' ? 'linksUnknownGroup' : 'noneObserved')
                            : t('none')}
                      </p>
                    ) : (
                      <ul className="grid divide-y text-sm">
                        {rows.map(({ id, pages }) => (
                          <li key={id} className="flex items-baseline justify-between gap-3 py-1.5">
                            <Link
                              href={detailHref(host, query, { issue: id })}
                              className="min-w-0 truncate underline-offset-2 hover:underline"
                            >
                              {tIssues(`${id}.name`)}
                            </Link>
                            <span className="text-muted-foreground tabular-nums">
                              {format.number(pages)}
                            </span>
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )
              })}
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">{t('notChecked')}</p>
          )}
          {analysed && !anyFinding && coverage?.unobserved === 0 && (
            <p className="text-xs text-muted-foreground">{t('noneNote')}</p>
          )}
        </CardContent>
      </Card>
    </section>
  )
}
