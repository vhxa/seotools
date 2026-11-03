import { crawlUrlHash } from '@seotools/core'
import { intentOutcome } from '@seotools/core/crawl/audit'
import { isPageIssueId } from '@seotools/core/crawl/issues'
import { ExternalLinkIcon } from 'lucide-react'
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
import { IssueDetails, IssueLabel, IssueMark } from '@/components/pages/issue-mark'
import { OpenUrlLink } from '@/components/pages/url-drawer'
import { UrlRecheck } from '@/components/verification/url-recheck'
import { Badge } from '@/components/ui/badge'
import { ruleRefsOf } from '@/lib/audit-rules'
import { formatBytes } from '@/lib/format'
import type { UrlDetailData } from '@/lib/url-detail'

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="grid gap-3">
      <h3 className="text-sm font-medium">{title}</h3>
      {children}
    </section>
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
 * page of its own: `hrefFor` says where a linked URL opens in each, and `linkLimit` how many
 * links to list.
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
  const [t, tIssues, tKinds, format] = await Promise.all([
    getTranslations('UrlDetail'),
    getTranslations('PageIssues'),
    getTranslations('LinkKinds'),
    getFormatter(),
  ])
  const { url, crawl, audit } = data
  const isPage = url.kind === 'page'
  const [tAudit, tState] = await Promise.all([
    getTranslations('UrlDetail.audit'),
    getTranslations('AuditState'),
  ])
  const refOf = ruleRefsOf(crawl.auditSnapshot)
  const notSet = <span className="text-muted-foreground">{t('notSet')}</span>
  const text = (value: string | null | undefined) => (value ? value : notSet)

  const links = (items: UrlDetailData['linksIn'], more: boolean) =>
    items.length === 0 ? (
      <p className="text-sm text-muted-foreground">{t('noLinks')}</p>
    ) : (
      <ul className="grid gap-1.5 text-sm">
        {items.map((link) => (
          <li
            key={`${link.kind}:${link.url}`}
            className="flex items-baseline justify-between gap-3"
          >
            <OpenUrlLink
              target={{ hash: crawlUrlHash(link.url), url: link.url }}
              href={hrefFor(crawlUrlHash(link.url))}
              className="min-w-0 truncate font-mono text-xs hover:underline"
              title={link.url}
            >
              {link.url}
            </OpenUrlLink>
            <Badge variant="outline">{tKinds(link.kind)}</Badge>
          </li>
        ))}
        {more && <li className="text-muted-foreground">{t('moreLinks')}</li>}
      </ul>
    )

  return (
    <div className="grid gap-6">
      <div className="flex flex-wrap items-center gap-2">
        <StatusCell row={url} />
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
          <ExternalLinkIcon className="size-3.5" />
          {t('openUrl')}
        </a>
      </div>

      <Section title={t('sections.summary')}>
        <Fields>
          {url.error && <Field label={t('fields.error')}>{url.error}</Field>}
          {url.redirectTo && (
            <Field label={t('fields.redirectTo')}>
              <UrlLink url={url.redirectTo} />
            </Field>
          )}
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
                  <div className="grid gap-1">
                    <ParticipationBadge participation={audit.participation} />
                    <RuleOrigin rule={refOf(audit.participationRule)} />
                  </div>
                </Field>
                <Field label={tAudit('intent')}>
                  {isPage ? (
                    <div className="grid gap-1">
                      <div className="flex flex-wrap gap-1">
                        <IntentBadge intent={audit.intent} isDefault={audit.intentRule === null} />
                        {audit.acceptNofollow && <NofollowAcceptedBadge />}
                      </div>
                      <RuleOrigin rule={refOf(audit.intentRule)} />
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
            </>
          )}
        </Section>
      )}

      <Section title={t('sections.issues')}>
        {crawl.pagesByWorstIssue === null ? (
          <p className="text-sm text-muted-foreground">{t('notChecked')}</p>
        ) : audit?.participation === 'excluded' ? (
          <p className="text-sm text-muted-foreground">{t('excludedFindings')}</p>
        ) : data.issues.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('noIssues')}</p>
        ) : (
          <ul className="grid gap-3 text-sm">
            {data.issues.map(({ issue: id, details }) => (
              <li key={id} className="grid gap-1">
                <span className="flex flex-wrap items-center gap-2 font-medium">
                  <IssueLabel issue={id} />
                  {isPageIssueId(id) && <IssueMark issue={id} />}
                </span>
                {isPageIssueId(id) && (
                  <span className="text-muted-foreground">{tIssues(`${id}.description`)}</span>
                )}
                {details && <IssueDetails details={details} />}
              </li>
            ))}
          </ul>
        )}
      </Section>

      <UrlRecheck host={host} data={data} />

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
            <Field label={t('fields.metaRobots')}>{text(url.metaRobots)}</Field>
            <Field label={t('fields.xRobotsTag')}>{text(url.xRobotsTag)}</Field>
          </Fields>
        </Section>
      )}

      <Section title={t('sections.linksIn')}>{links(data.linksIn, data.hasMoreIn)}</Section>
      <Section title={t('sections.linksOut')}>{links(data.linksOut, data.hasMoreOut)}</Section>
    </div>
  )
}
