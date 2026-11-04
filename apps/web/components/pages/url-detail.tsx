import { intentOutcome } from '@seotools/core/crawl/audit'
import { isPageIssueId } from '@seotools/core/crawl/issues'
import { ChevronDownIcon, CircleHelpIcon, ExternalLinkIcon } from 'lucide-react'
import { getFormatter, getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import {
  BlockerList,
  IndexabilityBadge,
  IntentBadge,
  IntentOutcomeText,
  NofollowAcceptedBadge,
  ParticipationBadge,
  RuleOrigin,
} from '@/components/audit/state-badges'
import { UrlAuditActions } from '@/components/audit/url-audit-actions'
import { PriorityToggle, UrlLink } from '@/components/crawl/url-cells'
import { StatusCell } from '@/components/crawl/status-cell'
import { IssueEvidenceView } from '@/components/pages/issue-evidence'
import { IssueDetails, IssueLabel, IssueMark } from '@/components/pages/issue-mark'
import { UrlLinks } from '@/components/pages/url-links'
import { UrlRecheck } from '@/components/verification/url-recheck'
import { Badge } from '@/components/ui/badge'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from '@/components/ui/collapsible'
import { groupDetailFindings } from '@/lib/url-detail-findings'
import { ruleRefsOf } from '@/lib/audit-rules'
import { formatBytes } from '@/lib/format'
import type { UrlDetailData } from '@/lib/url-detail'

function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="grid scroll-mt-4 gap-3">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
  )
}

/** Keep the heading/name visible while explanations remain available to keyboard users. */
function Disclosure({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <Collapsible className="min-w-0 rounded-lg border">
      <CollapsibleTrigger className="flex w-full items-center justify-between gap-3 rounded-lg p-3 text-left text-sm font-medium hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none [&[aria-expanded=true]>svg]:rotate-180">
        <span className="min-w-0">{title}</span>
        <ChevronDownIcon aria-hidden className="size-4 shrink-0 transition-transform" />
      </CollapsibleTrigger>
      <CollapsibleContent>
        <div className="grid gap-3 px-3 pb-3">{children}</div>
      </CollapsibleContent>
    </Collapsible>
  )
}

function Fields({ children }: { children: ReactNode }) {
  return (
    <dl className="grid grid-cols-[minmax(0,8rem)_minmax(0,1fr)] gap-x-4 gap-y-2 text-sm">
      {children}
    </dl>
  )
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <>
      <dt className="text-muted-foreground">{label}</dt>
      <dd className="min-w-0 break-words">{children}</dd>
    </>
  )
}

/**
 * What the last full crawl found at one URL. Shown in the drawer of the pages table and on the
 * page of its own: `hrefFor` says where a linked URL opens in each.
 */
export async function UrlDetail({
  host,
  data,
  hrefFor,
}: {
  host: string
  data: UrlDetailData
  hrefFor: (urlHash: string) => string
}) {
  const [t, tIssues, format] = await Promise.all([
    getTranslations('UrlDetail'),
    getTranslations('PageIssues'),
    getFormatter(),
  ])
  const { url, crawl, audit } = data
  const findingGroups = groupDetailFindings(data.issues)
  const findingsId = `url-findings-${crawl.id}-${url.urlHash}`
  const isPage = url.kind === 'page'
  const [tAudit, tState] = await Promise.all([
    getTranslations('UrlDetail.audit'),
    getTranslations('AuditState'),
  ])
  const refOf = ruleRefsOf(crawl.auditSnapshot)
  const notSet = <span className="text-muted-foreground">{t('notSet')}</span>
  const text = (value: string | null | undefined) => (value ? value : notSet)

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <Badge variant="outline">{t(`kinds.${url.kind}`)}</Badge>
        {isPage && <PriorityToggle host={host} url={url.url} marked={data.priority} />}
        {url.scope === 'internal' && (
          <UrlAuditActions host={host} url={url.url} current={data.current} />
        )}
        <a
          href={url.url}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground hover:underline"
        >
          <ExternalLinkIcon aria-hidden className="size-3.5" />
          {t('openUrl')}
        </a>
      </div>

      <Section title={t('sections.summary')}>
        <p className="text-xs text-muted-foreground">
          {t('crawlContext', {
            when: format.dateTime(crawl.finishedAt ?? crawl.createdAt, {
              dateStyle: 'medium',
              timeStyle: 'short',
            }),
            version: crawl.auditVersion === null ? t('notSet') : format.number(crawl.auditVersion),
          })}
        </p>
        <Fields>
          <Field label={t('fields.http')}>
            {url.statusCode === null && !url.error ? (
              <Badge variant="outline" className="font-normal text-muted-foreground">
                <CircleHelpIcon aria-hidden />
                {t('httpUnknown')}
              </Badge>
            ) : (
              <StatusCell row={url} automaticCheck={data.automaticCheck} />
            )}
          </Field>
          {url.error && <Field label={t('fields.error')}>{url.error}</Field>}
          {url.redirectTo && (
            <Field label={t('fields.redirectTo')}>
              <UrlLink url={url.redirectTo} />
            </Field>
          )}
        </Fields>
        {crawl.pagesByWorstIssue !== null &&
          audit?.participation !== 'excluded' &&
          data.issues.length > 0 && (
            <a
              href={`#${findingsId}`}
              className="w-fit rounded-sm text-sm underline underline-offset-4 focus-visible:ring-2 focus-visible:ring-ring focus-visible:outline-none"
            >
              {t('findingsSummary', {
                count: data.issues.length,
                high:
                  findingGroups.find((group) => group.importance === 'high')?.findings.length ?? 0,
              })}
            </a>
          )}
      </Section>

      {url.scope === 'internal' && (
        <Section title={t('sections.audit')}>
          {data.results.kind === 'pending' || data.results.kind === 'failed' ? (
            <p className="text-sm text-muted-foreground">{tAudit('pendingNote')}</p>
          ) : null}
          {audit === null ? (
            <p className="text-sm text-muted-foreground">{tAudit('notAnalysed')}</p>
          ) : (
            <>
              <Fields>
                <Field label={tAudit('participation')}>
                  <ParticipationBadge participation={audit.participation} />
                </Field>
                <Field label={tAudit('intent')}>
                  {isPage ? (
                    <div className="grid gap-1">
                      <div className="flex flex-wrap gap-1">
                        <IntentBadge intent={audit.intent} isDefault={audit.intentRule === null} />
                        {audit.acceptNofollow && <NofollowAcceptedBadge />}
                      </div>
                    </div>
                  ) : (
                    <span className="text-muted-foreground">{tState('intent.notApplicable')}</span>
                  )}
                </Field>
                <Field label={tAudit('technical')}>
                  <div className="grid gap-1.5">
                    <IndexabilityBadge state={audit.indexability} />
                    <BlockerList blockers={audit.blockers} />
                  </div>
                </Field>
              </Fields>
              {isPage && (
                <IntentOutcomeText
                  outcome={intentOutcome(audit.intent, audit.indexability, audit.blockers)}
                />
              )}
              {audit.participation === 'excluded' && (
                <p className="text-sm text-muted-foreground">{tAudit('excludedNote')}</p>
              )}
              <p className="text-xs text-muted-foreground">{tState('technicalNote')}</p>
              <Disclosure title={t('sections.ruleOrigins')}>
                <Fields>
                  <Field label={tAudit('participation')}>
                    <RuleOrigin rule={refOf(audit.participationRule)} />
                  </Field>
                  {isPage && (
                    <Field label={tAudit('intent')}>
                      <RuleOrigin rule={refOf(audit.intentRule)} />
                    </Field>
                  )}
                </Fields>
              </Disclosure>
            </>
          )}
        </Section>
      )}

      {isPage && (
        <Section title={t('sections.page')}>
          <Fields>
            <Field label={t('fields.title')}>{text(url.title)}</Field>
            <Field label={t('fields.description')}>{text(url.data?.description)}</Field>
            <Field label={t('fields.h1')}>
              {url.data?.h1?.length ? (
                <ul className="grid gap-1">
                  {url.data.h1.map((heading, index) => (
                    <li key={index}>{heading}</li>
                  ))}
                </ul>
              ) : (
                notSet
              )}
            </Field>
            <Field label={t('fields.canonical')}>{text(url.canonical)}</Field>
          </Fields>
        </Section>
      )}

      <Section id={findingsId} title={t('sections.issues')}>
        {crawl.pagesByWorstIssue === null ? (
          <p className="text-sm text-muted-foreground">{t('notChecked')}</p>
        ) : audit?.participation === 'excluded' ? (
          <p className="text-sm text-muted-foreground">{t('excludedFindings')}</p>
        ) : data.issues.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noIssues')}</p>
        ) : (
          <div className="grid gap-4">
            {findingGroups.map(({ importance, findings }) => (
              <div key={importance} className="grid gap-2">
                <h4 className="text-sm font-medium">
                  {t(`findingGroups.${importance}`, { count: findings.length })}
                </h4>
                <ul className="grid gap-2 text-sm">
                  {findings.map(({ issue: id, details, evidence }) => (
                    <li key={id}>
                      <Disclosure
                        title={
                          <span className="flex flex-wrap items-center gap-2">
                            {isPageIssueId(id) && <IssueMark issue={id} />}
                            <IssueLabel issue={id} />
                          </span>
                        }
                      >
                        {isPageIssueId(id) && (
                          <p className="text-muted-foreground">{tIssues(`${id}.description`)}</p>
                        )}
                        {details && <IssueDetails details={details} />}
                        <IssueEvidenceView
                          issue={id}
                          evidence={evidence}
                          known={data.evidenceUrls}
                          hrefFor={hrefFor}
                        />
                      </Disclosure>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
      </Section>

      <UrlRecheck host={host} data={data} />

      <Disclosure title={t('sections.technical')}>
        <Fields>
          <Field label={t('fields.xRobotsTag')}>{text(url.xRobotsTag)}</Field>
          <Field label={t('fields.metaRobots')}>{text(url.metaRobots)}</Field>
          <Field label={t('fields.contentType')}>{text(url.contentType)}</Field>
          <Field label={t('fields.responseTime')}>
            {url.responseTimeMs === null
              ? notSet
              : t('responseTime', { value: url.responseTimeMs })}
          </Field>
          <Field label={t('fields.size')}>
            {url.bytes === null ? notSet : formatBytes(format, url.bytes)}
          </Field>
          <Field label={t('fields.depth')}>{format.number(url.depth)}</Field>
          <Field label={t('fields.fetchedAt')}>
            {url.fetchedAt
              ? format.dateTime(url.fetchedAt, { dateStyle: 'medium', timeStyle: 'short' })
              : notSet}
          </Field>
        </Fields>
      </Disclosure>

      <UrlLinks host={host} data={data} direction="in" hrefFor={hrefFor} />
      <UrlLinks host={host} data={data} direction="out" hrefFor={hrefFor} />
    </div>
  )
}
