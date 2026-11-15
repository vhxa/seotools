import { CircleCheckIcon, CornerUpRightIcon, TriangleAlertIcon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import { Address } from '@/components/pages/issue-evidence'
import { Badge } from '@/components/ui/badge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  RENDER_DETAIL_SAMPLE,
  type ComparisonRow,
  type RenderRequests,
  type Shown,
} from '@/lib/url-rendering'
import type { UrlDetailData } from '@/lib/url-detail'

const OMIT_REASONS: readonly string[] = [
  'analytics',
  'experiment',
  'type',
  'domain-list',
  'scheme',
  'limit',
  'redirect',
  'method',
]
const FAILURE_CODES = ['load-timeout', 'crashed', 'serialization', 'navigation'] as const

/** What a site wrote is text here: a value, never markup. */
function Value({ shown }: { shown: Shown }) {
  const t = useTranslations('UrlRendering')
  if (shown.kind === 'unknown') {
    return <span className="text-muted-foreground italic">{t('values.unknown')}</span>
  }
  if (shown.kind === 'none')
    return <span className="text-muted-foreground">{t('values.none')}</span>
  return <span className="[overflow-wrap:anywhere]">{shown.text}</span>
}

function Comparison({ rows }: { rows: ComparisonRow[] }) {
  const t = useTranslations('UrlRendering')
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
      <table className="w-full table-fixed border-collapse text-sm">
        <caption className="sr-only">{t('comparison.caption')}</caption>
        <thead>
          <tr className="text-left text-xs text-muted-foreground">
            <th scope="col" className="w-[22%] py-1 pr-2 font-normal">
              {t('comparison.field')}
            </th>
            <th scope="col" className="w-[39%] py-1 pr-2 font-normal">
              {t('comparison.served')}
            </th>
            <th scope="col" className="w-[39%] py-1 font-normal">
              {t('comparison.rendered')}
            </th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.field} className="border-t align-top">
              <th
                scope="row"
                className="py-1.5 pr-2 text-left font-normal [overflow-wrap:anywhere] text-muted-foreground"
              >
                {t(`fields.${row.field}`)}
                {row.outcome === 'differs' && (
                  <Badge variant="secondary" className="ml-1.5 align-middle">
                    {t('comparison.differs')}
                  </Badge>
                )}
              </th>
              <td className="min-w-0 py-1.5 pr-2">
                <Value shown={row.served} />
              </td>
              <td className="min-w-0 py-1.5">
                <Value shown={row.rendered} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {rows.some((row) => row.outcome === 'unknown') && (
        <p className="text-xs text-muted-foreground">{t('comparison.unknownNote')}</p>
      )}
    </div>
  )
}

function Samples({
  title,
  count,
  children,
}: {
  title: string
  count: number
  children: ReactNode
}) {
  const t = useTranslations('UrlRendering')
  if (count === 0) return null
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-1">
      <h3 className="text-sm font-medium">
        {title} <span className="font-normal text-muted-foreground tabular-nums">({count})</span>
      </h3>
      <ul className="grid gap-1 text-xs">{children}</ul>
      {count > RENDER_DETAIL_SAMPLE && (
        <p className="text-xs text-muted-foreground">
          {t('requests.first', { shown: RENDER_DETAIL_SAMPLE, count })}
        </p>
      )}
    </div>
  )
}

const NO_KNOWN: ReadonlyMap<string, string> = new Map()

function Requests({ requests }: { requests: RenderRequests }) {
  const t = useTranslations('UrlRendering.requests')
  const anything =
    requests.failed.count +
      requests.blockedByRobots.count +
      requests.omitted.count +
      requests.refused.count >
    0
  const place = { known: NO_KNOWN, hrefFor: () => '#' }
  const sample = <T,>(items: T[]) => items.slice(0, RENDER_DETAIL_SAMPLE)
  if (!anything) return <p className="text-sm text-muted-foreground">{t('none')}</p>
  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-4">
      <Samples title={t('failed')} count={requests.failed.count}>
        {sample(requests.failed.items).map((item, index) => (
          <li key={index} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <Badge variant="outline" className="font-mono font-normal">
              {item.code}
            </Badge>
            <Address url={item.url} {...place} />
          </li>
        ))}
      </Samples>
      <Samples title={t('blockedByRobots')} count={requests.blockedByRobots.count}>
        {sample(requests.blockedByRobots.items).map((url, index) => (
          <li key={index}>
            <Address url={url} {...place} />
          </li>
        ))}
      </Samples>
      <Samples title={t('omitted')} count={requests.omitted.count}>
        {sample(requests.omitted.items).map((item, index) => (
          <li key={index} className="flex min-w-0 flex-wrap items-baseline gap-x-2">
            <Badge variant="outline" className="font-normal">
              {OMIT_REASONS.includes(item.reason)
                ? t(`reasons.${item.reason as 'type'}`)
                : item.reason}
            </Badge>
            <Address url={item.url} {...place} />
          </li>
        ))}
      </Samples>
      <Samples title={t('refused')} count={requests.refused.count}>
        {sample(requests.refused.items).map((url, index) => (
          <li key={index}>
            <Address url={url} {...place} />
          </li>
        ))}
      </Samples>
    </div>
  )
}

/**
 * What the crawl's JavaScript rendering observed of this URL, for the crawl shown. Every state says
 * plainly which one it is: a page that was not rendered, or whose render is incomplete, has no
 * comparison at all, and its JavaScript findings are unknown, never "no difference".
 */
export function UrlRendering({
  data,
  hrefFor,
}: {
  data: UrlDetailData
  hrefFor: (urlHash: string) => string
}) {
  const t = useTranslations('UrlRendering')
  const format = useFormatter()
  const { view, links, known } = data.rendering
  const seconds = (ms: number) =>
    t('duration', { seconds: format.number(ms / 1000, { maximumFractionDigits: 1 }) })

  if (view.kind === 'not-rendered') {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
        <p className="flex items-center gap-2 text-sm font-medium">{t('notRendered.title')}</p>
        <p className="text-sm text-muted-foreground">
          {t(`notRendered.reasons.${view.reason}`, { status: view.statusCode ?? '' })}
        </p>
        {view.reason === 'missing' && (
          <Alert className="has-[>svg]:grid-cols-[auto_minmax(0,1fr)]">
            <TriangleAlertIcon />
            <AlertDescription className="min-w-0">
              {t('notRendered.unknownFindings')}
            </AlertDescription>
          </Alert>
        )}
      </div>
    )
  }

  if (view.kind === 'incomplete') {
    const failure = view.failure
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-3">
        <Alert className="has-[>svg]:grid-cols-[auto_minmax(0,1fr)]">
          <TriangleAlertIcon />
          <AlertTitle className="min-w-0">
            {t(`incomplete.${view.state as 'failed'}.title`)}
          </AlertTitle>
          <AlertDescription className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-1">
            <p>
              {view.state === 'truncated'
                ? t(
                    `incomplete.truncated.${view.cut.rendered ? (view.cut.served ? 'both' : 'rendered') : 'served'}`,
                  )
                : t(`incomplete.${view.state}.body`, { ms: view.waitMs ?? 0 })}
            </p>
            {view.state === 'failed' && failure && (
              <p>
                {t('incomplete.failure', {
                  reason: (FAILURE_CODES as readonly string[]).includes(failure)
                    ? t(`incomplete.failures.${failure as (typeof FAILURE_CODES)[number]}`)
                    : failure,
                })}
              </p>
            )}
            <p className="font-medium">{t('incomplete.findingsUnknown')}</p>
          </AlertDescription>
        </Alert>
        {view.state !== 'failed' && (
          <p className="text-xs text-muted-foreground">{seconds(view.durationMs)}</p>
        )}
      </div>
    )
  }

  if (view.kind === 'redirect') {
    return (
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
        <p className="flex items-center gap-2 text-sm font-medium">
          <CornerUpRightIcon aria-hidden className="size-4" />
          {t('redirect.title')}
        </p>
        <p className="flex flex-wrap items-baseline gap-x-2 text-sm">
          {t('redirect.target')}
          <Address url={view.target} known={known} hrefFor={hrefFor} />
        </p>
        <p className="text-sm text-muted-foreground">{t('redirect.nothingElse')}</p>
        <p className="text-xs text-muted-foreground">{seconds(view.durationMs)}</p>
      </div>
    )
  }

  return (
    <div className="grid grid-cols-[minmax(0,1fr)] gap-6">
      <p className="flex items-center gap-2 text-sm">
        <CircleCheckIcon aria-hidden className="size-4" />
        {t('complete')} <span className="text-muted-foreground">· {seconds(view.durationMs)}</span>
      </p>
      <Comparison rows={view.rows} />
      {links && (
        <div className="grid grid-cols-[minmax(0,1fr)] gap-1">
          <h3 className="text-sm font-medium">{t('links.title')}</h3>
          <p className="text-sm">
            {t('links.served', { count: links.served })}
            {' · '}
            <span className={links.total > 0 ? 'font-medium' : ''}>
              {links.total > 0
                ? t('links.onlyAfter', { count: links.total })
                : t('links.noneOnlyAfter')}
            </span>
          </p>
          {links.items.length > 0 && (
            <ul className="grid gap-1 text-xs">
              {links.items.map((link) => (
                <li key={link.urlHash}>
                  <Address
                    url={link.url}
                    known={new Map([[link.url, link.urlHash]])}
                    hrefFor={hrefFor}
                  />
                </li>
              ))}
            </ul>
          )}
          {links.total > links.items.length && (
            <p className="text-xs text-muted-foreground">
              {t('requests.first', { shown: links.items.length, count: links.total })}
            </p>
          )}
        </div>
      )}
      <div className="grid grid-cols-[minmax(0,1fr)] gap-2">
        <h3 className="text-sm font-medium">{t('requests.title')}</h3>
        {view.requests ? (
          <Requests requests={view.requests} />
        ) : (
          <p className="text-sm text-muted-foreground">{t('requests.unknown')}</p>
        )}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)] gap-1">
        <h3 className="text-sm font-medium">{t('scriptErrors.title')}</h3>
        {view.scriptErrors.count === 0 ? (
          <p className="text-sm text-muted-foreground">{t('scriptErrors.none')}</p>
        ) : (
          <>
            <p className="text-sm">{t('scriptErrors.count', { count: view.scriptErrors.count })}</p>
            <ul className="grid gap-1 text-xs">
              {view.scriptErrors.first.slice(0, RENDER_DETAIL_SAMPLE).map((message, index) => (
                <li key={index}>
                  <code className="[overflow-wrap:anywhere] whitespace-pre-wrap">{message}</code>
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  )
}
