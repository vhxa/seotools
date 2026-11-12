import { DismissalAttribution } from '@/components/audit/dismissal-attribution'
import { isSiteScopedIssue, type VerificationComparison } from '@seotools/core/crawl/verification'
import { isPageIssueId } from '@seotools/core/crawl/issues'
import { CheckIcon, ClockIcon } from 'lucide-react'
import { getFormatter, getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { IndexabilityBadge, ParticipationBadge } from '@/components/audit/state-badges'
import { AutoRefresh } from '@/components/auto-refresh'
import { StatusCell } from '@/components/crawl/status-cell'
import { IssueDetails, IssueLabel, IssueMark } from '@/components/pages/issue-mark'
import { Badge } from '@/components/ui/badge'
import { FindingHelp } from '@/components/pages/finding-help'
import { describeAcceptance } from '@/lib/acceptance-reason'
import { groupDetailFindings } from '@/lib/url-detail-findings'
import { useTranslations } from 'next-intl'
import type { UrlDetailData } from '@/lib/url-detail'
import { dynamicTranslator } from '@/lib/dynamic-translator'

function IssueRow({
  issue,
  details,
  tag,
}: {
  issue: string
  details?: readonly string[] | undefined
  tag?: ReactNode
}) {
  const tIssues = useTranslations('PageIssues')
  return (
    <li className="grid gap-1">
      <span className="flex flex-wrap items-center gap-2 font-medium">
        <IssueLabel issue={issue} />
        {isPageIssueId(issue) && <IssueMark issue={issue} />}
        {tag}
      </span>
      {isPageIssueId(issue) && (
        <p className="text-muted-foreground">{tIssues(`${issue}.description`)}</p>
      )}
      <FindingHelp issue={issue} />
      {details && details.length > 0 && <IssueDetails details={details} />}
    </li>
  )
}

/**
 * What the latest recheck of a URL found, next to what the last full crawl found, which it does not
 * change. A recheck settles the findings that are a fact about the URL itself. The ones that depend
 * on other pages or on links are listed apart, as the crawl left them: only a full crawl says
 * whether they remain.
 */
export async function UrlRecheck({ data }: { data: UrlDetailData }) {
  const { recheck, crawl } = data
  if (!recheck.available) return null
  const [t, format, tAll] = await Promise.all([
    getTranslations('Verification.detail'),
    getFormatter(),
    getTranslations(),
  ])
  const translate = dynamicTranslator(tAll)
  const { view } = recheck
  const crawledAt = crawl.finishedAt ?? crawl.createdAt
  const when = (date: Date) => format.dateTime(date, { dateStyle: 'medium', timeStyle: 'short' })
  const notSet = <span className="text-muted-foreground">{t('notSet')}</span>

  const outcome = view?.verified.outcome ?? null
  const excluded = outcome?.audit.participation === 'excluded'
  const comparison: VerificationComparison | null = view?.comparison ?? null
  const remaining = new Set<string>(comparison?.remaining)
  const appeared = new Set<string>(comparison?.appeared)
  const wasPending = new Set<string>(comparison?.nowAccepted)
  // A recheck from before this was kept has none to show, which says nothing either way.
  const accepted = outcome?.accepted ?? []
  // What only a full crawl settles, as that crawl left it. Nothing for a URL left out of the audit.
  const pending = excluded
    ? []
    : (comparison?.pendingFullCrawl ??
      data.issues.map(({ issue }) => issue).filter(isSiteScopedIssue))
  const detailsOf = (issue: string) => data.issues.find((found) => found.issue === issue)?.details

  return (
    <section
      id={`url-recheck-${crawl.id}-${data.url.urlHash}`}
      className="grid scroll-mt-4 gap-3 rounded-lg border bg-muted/20 p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="text-sm font-medium">{t('title')}</h3>
      </div>
      <p className="text-sm text-muted-foreground">{t('scope')}</p>

      {recheck.waiting && (
        <p role="status" className="flex items-center gap-2 text-sm">
          <AutoRefresh intervalMs={2000} />
          <ClockIcon aria-hidden className="size-3.5" />
          {t('waiting')}
        </p>
      )}
      {recheck.busy && !recheck.waiting && (
        <p className="text-sm text-muted-foreground">{t('busy')}</p>
      )}

      {!view || !outcome ? (
        <p className="text-sm text-muted-foreground">{t('never')}</p>
      ) : (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <span title={when(view.verifiedAt)}>
              {t('rechecked', { when: format.relativeTime(view.verifiedAt) })}
            </span>
          </div>
          {!view.current && (
            <p className="text-sm text-muted-foreground">{t('rules.changedNote')}</p>
          )}

          <p className="text-sm text-muted-foreground">{t('checkedScope')}</p>
          <dl className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-2 text-sm @min-[24rem]/url-detail:grid-cols-[minmax(0,8rem)_minmax(0,1fr)]">
            <dt className="text-muted-foreground">{t('fields.status')}</dt>
            <dd>
              <StatusCell row={view.verified} />
            </dd>
            {view.verified.error && (
              <>
                <dt className="text-muted-foreground">{t('fields.error')}</dt>
                <dd className="min-w-0 break-words">{view.verified.error}</dd>
              </>
            )}
            {view.verified.redirectTo && (
              <>
                <dt className="text-muted-foreground">{t('fields.redirectTo')}</dt>
                <dd className="min-w-0 break-words">{view.verified.redirectTo}</dd>
              </>
            )}
            <dt className="text-muted-foreground">{t('fields.responseTime')}</dt>
            <dd>
              {view.verified.responseTimeMs === null
                ? notSet
                : t('responseTime', { value: view.verified.responseTimeMs })}
            </dd>
            {view.verified.kind === 'page' && (
              <>
                <dt className="text-muted-foreground">{t('fields.title')}</dt>
                <dd className="min-w-0 break-words">{view.verified.title || notSet}</dd>
                <dt className="text-muted-foreground">{t('fields.canonical')}</dt>
                <dd className="min-w-0 break-words">{view.verified.canonical || notSet}</dd>
                <dt className="text-muted-foreground">{t('fields.metaRobots')}</dt>
                <dd className="min-w-0 break-words">{view.verified.metaRobots || notSet}</dd>
                <dt className="text-muted-foreground">{t('fields.xRobotsTag')}</dt>
                <dd className="min-w-0 break-words">{view.verified.xRobotsTag || notSet}</dd>
              </>
            )}
            {excluded && (
              <>
                <dt className="text-muted-foreground">{t('fields.audit')}</dt>
                <dd>
                  <ParticipationBadge participation={outcome.audit.participation} />
                </dd>
              </>
            )}
            <dt className="text-muted-foreground">{t('fields.indexability')}</dt>
            <dd>
              <IndexabilityBadge
                state={outcome.audit.indexability}
                blockers={outcome.audit.blockers}
              />
            </dd>
          </dl>

          {excluded ? (
            <p className="text-sm text-muted-foreground">{t('excluded')}</p>
          ) : (
            <>
              <h4 className="text-sm font-medium">{t('found.title')}</h4>
              <p className="text-xs text-muted-foreground">{t('evidenceNote')}</p>
              {outcome.findings.length === 0 ? (
                <p className="text-sm text-muted-foreground">{t('found.none')}</p>
              ) : (
                <ul className="grid gap-3 text-sm">
                  {groupDetailFindings(outcome.findings)
                    .flatMap(({ findings }) => findings)
                    .map(({ issue, details }) => (
                      <IssueRow
                        key={issue}
                        issue={issue}
                        details={details}
                        tag={
                          remaining.has(issue) ? (
                            <Badge variant="outline">{t('found.remaining')}</Badge>
                          ) : appeared.has(issue) ? (
                            <Badge variant="secondary">{t('found.appeared')}</Badge>
                          ) : null
                        }
                      />
                    ))}
                </ul>
              )}

              {accepted.length > 0 && (
                <>
                  <h4 className="text-sm font-medium">
                    {t('accepted.title', { count: accepted.length })}
                  </h4>
                  <p className="text-xs text-muted-foreground">{t('accepted.note')}</p>
                  <ul className="grid gap-2 text-sm">
                    {accepted.map(({ issue, acceptance }) => (
                      <li key={issue} className="grid gap-0.5">
                        <span className="flex flex-wrap items-center gap-2 font-medium">
                          <IssueLabel issue={issue} />
                          {wasPending.has(issue) && (
                            <Badge variant="outline">{t('accepted.wasPending')}</Badge>
                          )}
                        </span>
                        <span className="text-muted-foreground">
                          {describeAcceptance(acceptance, translate)}
                        </span>
                        {acceptance.kind === 'dismissal' && (
                          <DismissalAttribution
                            acceptance={acceptance}
                            rows={data.findingStates ?? []}
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                </>
              )}

              {comparison && comparison.fixed.length > 0 && (
                <>
                  <h4 className="text-sm font-medium">{t('fixed.title')}</h4>
                  <ul className="grid gap-2 text-sm">
                    {comparison.fixed.map((issue) => (
                      <li key={issue} className="flex flex-wrap items-center gap-2">
                        <CheckIcon aria-hidden className="size-3.5 text-emerald-600" />
                        <IssueLabel issue={issue} />
                      </li>
                    ))}
                  </ul>
                  <p className="text-xs text-muted-foreground">
                    {t('fixed.note', { when: when(crawledAt) })}
                  </p>
                </>
              )}
              {view.notComparable && (
                <p className="text-sm text-muted-foreground">
                  {t(`notComparable.${view.notComparable}`)}
                </p>
              )}
              {outcome.unchecked.length > 0 && (
                <>
                  <h4 className="text-sm font-medium">{t('unchecked.title')}</h4>
                  <ul className="grid gap-2 text-sm">
                    {outcome.unchecked.map((issue) => (
                      <li key={issue}>
                        <IssueLabel issue={issue} />
                      </li>
                    ))}
                  </ul>
                </>
              )}
            </>
          )}
        </>
      )}

      {view && !excluded && (
        <>
          <h4 className="text-sm font-medium">{t('pending.title')}</h4>
          {pending.length === 0 ? (
            <p className="text-sm text-muted-foreground">{t('pending.none')}</p>
          ) : (
            <>
              <p className="text-sm text-muted-foreground">
                {t('pending.note', { when: when(crawledAt) })}
              </p>
              <ul className="grid gap-3 text-sm">
                {pending.map((issue) => (
                  <IssueRow key={issue} issue={issue} details={detailsOf(issue)} />
                ))}
              </ul>
            </>
          )}
        </>
      )}
    </section>
  )
}
