import { FindingStatesList } from '@/components/audit/finding-states-list'
import { FindingStateActions } from '@/components/audit/finding-state-actions'
import { VitalsValues } from './vitals-values'
import { urlVitals } from '@/lib/vitals'
import { AUDIT_CONDITIONS, intentOutcome } from '@seotools/core/crawl/audit'
import { isPageIssueId } from '@seotools/core/crawl/issues'
import { CircleHelpIcon, ExternalLinkIcon } from 'lucide-react'
import { getFormatter, getTranslations } from 'next-intl/server'
import { getDb } from '@/lib/db'
import type { ReactNode } from 'react'
import {
  BlockerList,
  IndexabilityBadge,
  IntentBadge,
  IntentOutcomeText,
  ConditionBadges,
  ParticipationBadge,
  RuleOrigin,
} from '@/components/audit/state-badges'
import { AuditResultsNotice } from '@/components/audit/audit-notice'
import { AcceptedFindings } from '@/components/pages/accepted-findings'
import { Disclosure } from '@/components/pages/disclosure'
import { FindingHelp } from '@/components/pages/finding-help'
import { RecheckButton } from '@/components/verification/recheck-button'
import { UrlAuditActions } from '@/components/audit/url-audit-actions'
import { InfoHelp } from '@/components/help'
import { PriorityToggle, UrlLink } from '@/components/crawl/url-cells'
import { StatusCell } from '@/components/crawl/status-cell'
import { IssueEvidenceView } from '@/components/pages/issue-evidence'
import { IssueDetails, IssueLabel, IssueMark } from '@/components/pages/issue-mark'
import { UrlSharePreview } from '@/components/pages/share-preview'
import { UrlLinks } from '@/components/pages/url-links'
import { UrlRecheck } from '@/components/verification/url-recheck'
import { Tabs, TabsList, TabsTrigger, TabsContent } from '@/components/ui/tabs'
import { Badge } from '@/components/ui/badge'
import { groupDetailFindings } from '@/lib/url-detail-findings'
import { ruleRefsOf } from '@/lib/audit-rules'
import { sharePreview } from '@/lib/share-preview'
import { formatBytes } from '@/lib/format'
import type { UrlDetailData } from '@/lib/url-detail'

function Section({ title, children, id }: { title: string; children: ReactNode; id?: string }) {
  return (
    <section id={id} className="grid min-w-0 scroll-mt-4 grid-cols-[minmax(0,1fr)] gap-3">
      <h2 className="text-sm font-medium">{title}</h2>
      {children}
    </section>
  )
}

function Fields({ children }: { children: ReactNode }) {
  return (
    <dl className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-x-4 gap-y-2 text-sm @min-[24rem]/url-detail:grid-cols-[minmax(0,8rem)_minmax(0,1fr)]">
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
  context,
  history,
}: {
  host: string
  history?: ReactNode
  context?: ReactNode
  data: UrlDetailData
  hrefFor: (urlHash: string) => string
}) {
  const [t, tIssues, format] = await Promise.all([
    getTranslations('UrlDetail'),
    getTranslations('PageIssues'),
    getFormatter(),
  ])
  const basis = await getTranslations('AuditBasis')
  const { url, crawl, audit } = data
  const renderedBasis = crawl.auditSnapshot?.documentBasis === 'rendered-v1'
  const documentUnknown =
    renderedBasis && isPageUrl(data) && audit?.documentObservation !== 'complete'
  const renderReason =
    data.render?.status === 'failed'
      ? 'failed'
      : data.render?.data.redirected
        ? 'redirected'
        : url.data?.truncated || data.render?.truncated
          ? 'truncated'
          : data.render?.status === 'rendered' && !data.render.settled
            ? 'unsettled'
            : 'missing'
  const findingGroups = groupDetailFindings(data.issues)
  const findingsId = `url-findings-${crawl.id}-${url.urlHash}`
  const isPage = url.kind === 'page'
  const [tAudit, tState] = await Promise.all([
    getTranslations('UrlDetail.audit'),
    getTranslations('AuditState'),
  ])
  const refOf = ruleRefsOf(crawl.auditSnapshot)
  // Named as the domain names them now; a value whose extractor is gone keeps its key as a name.
  const extractors = new Map(
    (await (await getDb()).crawls.settings(crawl.domainId)).extractors.map((e) => [e.key, e.name]),
  )
  const discovery = await (await getDb()).crawls.discoveryPath(crawl.id, url.urlHash)
  const tKinds = await getTranslations('LinkKinds')
  const tRegions = await getTranslations('LinkRegions')
  const extracted = Object.entries(url.data?.extracted ?? {})
  const notSet = <span className="text-muted-foreground">{t('notSet')}</span>
  const text = (value: string | null | undefined) => (value ? value : notSet)

  const v = await getTranslations('Vitals')
  const vitals = urlVitals(await (await getDb()).vitals.urls(data.crawl.id), data.url.urlHash)
  return (
    <div className="@container/url-detail grid min-w-0 grid-cols-[minmax(0,1fr)] gap-6 [overflow-wrap:anywhere] [&_[data-slot=badge]]:max-w-full [&_[data-slot=select-trigger]]:max-w-full [&_[data-slot=select-trigger]]:min-w-0 [&_[data-slot=select-value]]:min-w-0">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm text-muted-foreground">{t(`kinds.${url.kind}`)}</span>
        {data.recheck.available && (
          <RecheckButton
            host={host}
            urls={[url.url]}
            disabled={data.recheck.busy || data.recheck.archived}
          />
        )}
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

      {crawl.pagesByWorstIssue !== null && (
        <div className="grid gap-1 text-sm text-muted-foreground">
          <p>{basis(renderedBasis ? 'rendered' : 'html')}</p>
          <p>{basis('exceptions')}</p>
          {documentUnknown && (
            <p role="status">
              {basis('unknown')} {basis(renderReason)}
            </p>
          )}
        </div>
      )}
      {context}
      <AuditResultsNotice host={host} state={data.results} />
      <Section title={v('title')}>
        <p>{v('field')}</p>
        <VitalsValues metrics={vitals.field} />
        {vitals.field?.status === 'no-data' && <p>{v('noField')}</p>}
        {vitals.lab && (
          <>
            <p>{v('lab')}</p>
            <VitalsValues metrics={vitals.lab} lab />
          </>
        )}
      </Section>
      <Section title={t('sections.summary')}>
        <p className="text-xs text-muted-foreground">
          {t('observedAt', {
            when: format.dateTime(crawl.finishedAt ?? crawl.createdAt, {
              dateStyle: 'medium',
              timeStyle: 'short',
            }),
          })}
        </p>
        {data.recheck.available && data.recheck.view && (
          <a
            href={`#url-recheck-${crawl.id}-${url.urlHash}`}
            className="w-fit text-sm underline underline-offset-4"
          >
            {t('recheckAvailable', { when: format.relativeTime(data.recheck.view.verifiedAt) })}
          </a>
        )}
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
          {audit && (
            <Field label={tAudit('technical')}>
              <div className="grid gap-1.5">
                <div className="flex flex-wrap items-center gap-1">
                  <IndexabilityBadge state={audit.indexability} />
                  <InfoHelp label={tAudit('technical')}>{tState('technicalNote')}</InfoHelp>
                </div>
                <BlockerList blockers={audit.blockers} />
              </div>
            </Field>
          )}
          {url.data?.notRequested && <p>{t(`notRequested.${url.data.notRequested}`)}</p>}
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

      {isPage && (
        <Section title={t('keyFacts')}>
          <Fields>
            <Field label={t('fields.title')}>
              {text(url.title)}{' '}
              {url.title && (
                <span className="text-muted-foreground">
                  {t('characters', { count: url.title.length })}
                </span>
              )}
            </Field>
            <Field label={t('fields.description')}>
              {text(url.data?.description)}{' '}
              {url.data?.description && (
                <span className="text-muted-foreground">
                  {t('characters', { count: url.data.description.length })}
                </span>
              )}
            </Field>
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
            <Field label={t('fields.canonical')}>
              {text(url.canonical)}{' '}
              {url.canonical === url.url && <Badge variant="secondary">{t('self')}</Badge>}
            </Field>

            <Field label={t('fields.metaRobots')}>{text(url.metaRobots)}</Field>
            <Field label={t('fields.xRobotsTag')}>{text(url.xRobotsTag)}</Field>
            <Field label={t('words')}>
              {url.data?.facts ? format.number(url.data.facts.words) : notSet}
            </Field>
            <Field label={t('fields.depth')}>{format.number(url.depth)}</Field>
            <Field label={t('inbound')}>{format.number(data.links.in.total)}</Field>
            <Field label={t('fields.responseTime')}>
              {url.responseTimeMs === null
                ? notSet
                : t('responseTime', { value: url.responseTimeMs })}
            </Field>
            <Field label={t('fields.size')}>
              {url.bytes === null ? notSet : formatBytes(format, url.bytes)}
            </Field>
            {extracted.map(([key, values]) => (
              <Field key={key} label={extractors.get(key) ?? key}>
                <ul className="grid gap-1">
                  {values.map((value, index) => (
                    <li key={index}>{value}</li>
                  ))}
                </ul>
              </Field>
            ))}
          </Fields>
        </Section>
      )}

      {isPage && (
        <Section title={t('sections.preview')}>
          <UrlSharePreview
            crawlPreview={sharePreview(url)}
            crawledAt={crawl.finishedAt ?? crawl.createdAt}
            recheck={data.recheck.preview}
            url={url.url}
          />
        </Section>
      )}

      {discovery.length > 1 && (
        <Section title={t('discovery')}>
          <ol className="grid gap-2 text-sm">
            {discovery.map((step) => (
              <li key={step.urlHash} className="min-w-0">
                {step.foundKind && (
                  <span className="mr-2 text-muted-foreground">{tKinds(step.foundKind)}</span>
                )}
                <a className="break-all underline" href={hrefFor(step.urlHash)}>
                  {step.url}
                </a>
                {step.context && (
                  <span className="block text-xs text-muted-foreground">
                    {[
                      step.context.text ? `“${step.context.text}”` : undefined,
                      step.context.element,
                      step.context.region ? tRegions(step.context.region) : undefined,
                    ]
                      .filter(Boolean)
                      .join(' · ')}
                  </span>
                )}
              </li>
            ))}
          </ol>
        </Section>
      )}
      <Tabs defaultValue="findings" className="min-w-0">
        <TabsList className="max-w-full flex-wrap group-data-horizontal/tabs:h-auto">
          {(['findings', 'links', 'indexing', 'history', 'technical'] as const).map((tab) => (
            <TabsTrigger key={tab} value={tab}>
              {t(`tabs.${tab}`)}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="findings" className="grid gap-6">
          <Section id={findingsId} title={t('sections.issues')}>
            {crawl.pagesByWorstIssue === null ? (
              <p className="text-sm text-muted-foreground">{t('notChecked')}</p>
            ) : audit?.participation === 'excluded' ? (
              <p className="text-sm text-muted-foreground">{t('excludedFindings')}</p>
            ) : data.issues.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                {documentUnknown
                  ? basis('unknown')
                  : data.accepted.length > 0
                    ? t('noPendingIssues')
                    : t('noIssues')}
              </p>
            ) : (
              <div className="grid gap-4">
                {findingGroups.map(({ importance, findings }) => (
                  <div key={importance} className="grid gap-2">
                    <h3 className="text-sm font-medium">
                      {t(`findingGroups.${importance}`, { count: findings.length })}
                    </h3>
                    <ul className="grid gap-2 text-sm">
                      {findings.map(({ issue: id, details, evidence }) => (
                        <li key={id}>
                          <Disclosure
                            defaultOpen={importance === 'high'}
                            title={
                              <span className="flex flex-wrap items-center gap-2">
                                {isPageIssueId(id) && <IssueMark issue={id} />}
                                <IssueLabel issue={id} />
                              </span>
                            }
                          >
                            {isPageIssueId(id) && (
                              <p className="text-muted-foreground">
                                {tIssues(`${id}.description`)}
                              </p>
                            )}
                            {details && <IssueDetails details={details} />}
                            <IssueEvidenceView
                              issue={id}
                              evidence={evidence}
                              known={data.evidenceUrls}
                              hrefFor={hrefFor}
                            />
                            <FindingHelp issue={id} />
                            {(
                              (data.findingStates ?? []).find(
                                (r) => r.issue === id && r.urlHash === url.urlHash,
                              ) ??
                              (data.findingStates ?? []).find(
                                (r) => r.issue === id && r.urlHash === null,
                              )
                            )?.state === 'in-progress' && (
                              <FindingStatesList
                                host={host}
                                rows={[
                                  (data.findingStates ?? []).find(
                                    (r) => r.issue === id && r.urlHash === url.urlHash,
                                  ) ??
                                    (data.findingStates ?? []).find(
                                      (r) => r.issue === id && r.urlHash === null,
                                    )!,
                                ]}
                                compact
                              />
                            )}
                            <FindingStateActions host={host} issue={id} hashes={[url.urlHash]} />
                          </Disclosure>
                        </li>
                      ))}
                    </ul>
                  </div>
                ))}
              </div>
            )}
          </Section>

          <AcceptedFindings host={host} data={data} hrefFor={hrefFor} />

          <UrlRecheck data={data} />
        </TabsContent>
        <TabsContent value="indexing">
          {url.scope === 'internal' && (
            <Disclosure title={t('sections.audit')}>
              {audit === null ? (
                <p className="text-sm text-muted-foreground">{tAudit('notAnalysed')}</p>
              ) : (
                <>
                  <Fields>
                    {audit.participation === 'excluded' && (
                      <Field label={tAudit('participation')}>
                        <ParticipationBadge participation={audit.participation} />
                      </Field>
                    )}
                    {audit.intentRule !== null && (
                      <Field label={tAudit('intent')}>
                        {isPage ? (
                          <div className="grid gap-1">
                            <div className="flex flex-wrap gap-1">
                              <IntentBadge
                                intent={audit.intent}
                                isDefault={audit.intentRule === null}
                              />
                            </div>
                          </div>
                        ) : (
                          <span className="text-muted-foreground">
                            {tState('intent.notApplicable')}
                          </span>
                        )}
                      </Field>
                    )}
                    {AUDIT_CONDITIONS.some((condition) => audit.conditions[condition]) && (
                      <Field label={tAudit('conditions')}>
                        <div className="grid gap-2">
                          {AUDIT_CONDITIONS.map((condition) => {
                            const state = audit.conditions[condition]
                            return state ? (
                              <div key={condition} className="grid gap-1">
                                <div className="flex flex-wrap gap-1">
                                  <ConditionBadges
                                    conditions={{ [condition]: state }}
                                    className="h-auto max-w-full whitespace-normal"
                                  />
                                </div>
                                <RuleOrigin rule={refOf(state.rule)} />
                              </div>
                            ) : null
                          })}
                        </div>
                      </Field>
                    )}
                  </Fields>
                  {isPage && audit.intentRule !== null && (
                    <IntentOutcomeText
                      outcome={intentOutcome(audit.intent, audit.indexability, audit.blockers)}
                    />
                  )}
                  {audit.participation === 'excluded' && (
                    <p className="text-sm text-muted-foreground">{tAudit('excludedNote')}</p>
                  )}
                  {(audit.participationRule !== null || audit.intentRule !== null) && (
                    <Disclosure title={t('sections.ruleOrigins')}>
                      <Fields>
                        {audit.participationRule !== null && (
                          <Field label={tAudit('participation')}>
                            <RuleOrigin rule={refOf(audit.participationRule)} />
                          </Field>
                        )}
                        {isPage && audit.intentRule !== null && (
                          <Field label={tAudit('intent')}>
                            <RuleOrigin rule={refOf(audit.intentRule)} />
                          </Field>
                        )}
                      </Fields>
                    </Disclosure>
                  )}
                  {audit.participationRule === null &&
                    audit.intentRule === null &&
                    !AUDIT_CONDITIONS.some((condition) => audit.conditions[condition]) && (
                      <p className="text-sm text-muted-foreground">{tAudit('noExplicitRules')}</p>
                    )}
                </>
              )}
            </Disclosure>
          )}
        </TabsContent>
        <TabsContent value="technical">
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
        </TabsContent>
        <TabsContent value="history">
          {history ?? (
            <a
              className="underline"
              href={`/domains/${host}/urls/${url.urlHash}?crawl=${crawl.id}`}
            >
              {t('viewHistory')}
            </a>
          )}
        </TabsContent>
        <TabsContent value="links" className="grid gap-6">
          <div id="inbound-links">
            <UrlLinks host={host} data={data} direction="in" hrefFor={hrefFor} />
          </div>
          <UrlLinks host={host} data={data} direction="out" hrefFor={hrefFor} />
        </TabsContent>
      </Tabs>
    </div>
  )
}

function isPageUrl(data: UrlDetailData) {
  return (
    data.url.scope === 'internal' &&
    data.url.kind === 'page' &&
    data.url.statusCode !== null &&
    data.url.statusCode >= 200 &&
    data.url.statusCode < 300
  )
}
