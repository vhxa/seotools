import { FindingStateActions } from '@/components/audit/finding-state-actions'
import { FindingStatesList } from '@/components/audit/finding-states-list'
import { rulesOfAcceptance } from '@seotools/core/crawl/acceptance'
import { isPageIssueId } from '@seotools/core/crawl/issues'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { RuleOrigin } from '@/components/audit/state-badges'
import { Disclosure } from '@/components/pages/disclosure'
import { IssueEvidenceView, RelatedUrls } from '@/components/pages/issue-evidence'
import { IssueDetails, IssueLabel, IssueMark } from '@/components/pages/issue-mark'
import { describeAcceptance } from '@/lib/acceptance-reason'
import { ruleRefsOf } from '@/lib/audit-rules'
import { dynamicTranslator } from '@/lib/dynamic-translator'
import type { UrlDetailData } from '@/lib/url-detail'

/**
 * What rules accept: of this URL, and of the others that what is declared of this URL acts on. Apart
 * from what is pending, closed by default, and always saying it is not the same as being fixed.
 */
export async function AcceptedFindings({
  data,
  host,
  hrefFor,
}: {
  host: string
  data: UrlDetailData
  hrefFor: (urlHash: string) => string
}) {
  const { accepted, acceptedElsewhere, crawl, evidenceUrls } = data
  if (accepted.length === 0 && acceptedElsewhere.total === 0) return null
  const [t, tIssues, tAll] = await Promise.all([
    getTranslations('UrlDetail.accepted'),
    getTranslations('PageIssues'),
    getTranslations(),
  ])
  const refOf = ruleRefsOf(crawl.auditSnapshot)

  const translate = dynamicTranslator(tAll)

  return (
    <>
      {accepted.length > 0 && (
        <Disclosure title={t('title', { count: accepted.length })}>
          {accepted.some((r) => r.acceptance.kind !== 'dismissal') && (
            <p className="text-xs text-muted-foreground">{t('note')}</p>
          )}
          <ul className="grid gap-3 text-sm">
            {accepted.map(({ issue, acceptedBy, acceptance, details, evidence }) => (
              <li key={`${issue}:${acceptedBy}`} className="grid gap-1.5">
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  {isPageIssueId(issue) && <IssueMark issue={issue} />}
                  <IssueLabel issue={issue} />
                </span>
                <p className="text-muted-foreground">{describeAcceptance(acceptance, translate)}</p>
                {acceptance.kind === 'dismissal' && (
                  <>
                    <FindingStatesList
                      compact
                      host={host}
                      rows={(data.findingStates ?? []).filter((row) => row.id === acceptance.id)}
                    />
                    <FindingStateActions
                      host={host}
                      issue={issue}
                      hashes={[data.url.urlHash]}
                      restoreOnly
                    />
                  </>
                )}
                {rulesOfAcceptance(acceptance).map((rule) => (
                  <RuleOrigin key={rule} rule={refOf(rule)} />
                ))}
                {isPageIssueId(issue) && (
                  <p className="text-xs text-muted-foreground">{tIssues(`${issue}.description`)}</p>
                )}
                {details && <IssueDetails details={details} />}
                {evidence?.kind === 'related-urls' ? (
                  <RelatedUrls
                    urls={evidence.urls}
                    total={evidence.total}
                    known={evidenceUrls}
                    hrefFor={hrefFor}
                  />
                ) : (
                  evidence && (
                    <IssueEvidenceView
                      issue={issue}
                      evidence={evidence}
                      known={evidenceUrls}
                      hrefFor={hrefFor}
                    />
                  )
                )}
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
      {acceptedElsewhere.total > 0 && (
        <Disclosure title={t('elsewhereTitle', { total: acceptedElsewhere.total })}>
          <p className="text-xs text-muted-foreground">{t('elsewhereNote')}</p>
          <ul className="grid gap-2 text-sm">
            {acceptedElsewhere.findings.map(({ urlHash, url, issue }) => (
              <li key={`${urlHash}:${issue}`} className="grid gap-0.5">
                <Link href={hrefFor(urlHash)} className="break-all hover:underline" title={url}>
                  {url}
                </Link>
                <span className="text-xs text-muted-foreground">
                  <IssueLabel issue={issue} />
                </span>
              </li>
            ))}
          </ul>
        </Disclosure>
      )}
    </>
  )
}
