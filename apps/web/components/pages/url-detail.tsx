import { crawlUrlHash } from '@seotools/core'
import { PAGE_ISSUES, isPageIssueId } from '@seotools/core/crawl/issues'
import { ExternalLinkIcon } from 'lucide-react'
import { getFormatter, getTranslations } from 'next-intl/server'
import type { ReactNode } from 'react'
import { PriorityToggle, UrlLink } from '@/components/crawl/url-cells'
import { StatusCell } from '@/components/crawl/status-cell'
import { OpenUrlLink } from '@/components/pages/url-drawer'
import { Badge } from '@/components/ui/badge'
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
  const [t, tIssues, tSeverity, tKinds, format] = await Promise.all([
    getTranslations('UrlDetail'),
    getTranslations('PageIssues'),
    getTranslations('Pages.issues.severity'),
    getTranslations('LinkKinds'),
    getFormatter(),
  ])
  const { url, crawl } = data
  const isPage = url.kind === 'page'
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

      {isPage && (
        <>
          <Section title={t('sections.issues')}>
            {crawl.pagesWithIssuesCount === null ? (
              <p className="text-sm text-muted-foreground">{t('notChecked')}</p>
            ) : data.issues.length === 0 ? (
              <p className="text-sm text-muted-foreground">{t('noIssues')}</p>
            ) : (
              <ul className="grid gap-2 text-sm">
                {data.issues.map((id) => (
                  <li key={id} className="grid gap-0.5">
                    <span className="flex items-center gap-2 font-medium">
                      {isPageIssueId(id) ? tIssues(`${id}.name`) : id}
                      {isPageIssueId(id) && (
                        <Badge
                          variant={
                            PAGE_ISSUES[id].severity === 'error' ? 'destructive' : 'secondary'
                          }
                        >
                          {tSeverity(PAGE_ISSUES[id].severity)}
                        </Badge>
                      )}
                    </span>
                    {isPageIssueId(id) && (
                      <span className="text-muted-foreground">{tIssues(`${id}.description`)}</span>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </Section>

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
        </>
      )}

      <Section title={t('sections.linksIn')}>{links(data.linksIn, data.hasMoreIn)}</Section>
      <Section title={t('sections.linksOut')}>{links(data.linksOut, data.hasMoreOut)}</Section>
    </div>
  )
}
