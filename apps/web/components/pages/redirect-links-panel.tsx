'use client'

import { ArrowRightLeftIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import { useCallback, useRef, useState, useTransition } from 'react'
import { loadRedirectLinksAction } from '@/app/(protected)/domains/[host]/link-actions'
import { StatusCell } from '@/components/crawl/status-cell'
import { OpenUrlLink } from '@/components/pages/url-drawer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import type { RedirectLinksPage } from '@/lib/redirect-links'
import { applyHref, type HrefPattern } from '@/lib/url-links'
import { displayUrl } from '@/lib/url-display'

type Failure = 'unavailable' | 'pruned' | 'failed'

/**
 * "Through redirects": the URLs that redirect to the one being looked at and, under each, the links
 * that point at it. Those links point at the redirecting URL, not at this one, which is said in the
 * list itself. The first page comes with the detail; the rest is read as it is asked for, and the
 * list stays where it is (dimmed) until it arrives.
 */
export function RedirectLinksPanel({
  host,
  crawlId,
  urlHash,
  initial,
  hrefs,
}: {
  host: string
  crawlId: string
  urlHash: string
  initial: RedirectLinksPage
  hrefs: HrefPattern
}) {
  const t = useTranslations('UrlLinks.viaRedirects')
  const tKinds = useTranslations('LinkKinds')
  const tRegions = useTranslations('LinkRegions')
  const tPagination = useTranslations('Pagination')
  const [shown, setShown] = useState(initial)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [pending, startTransition] = useTransition()
  const latest = useRef(0)

  const load = useCallback(
    (page: number) => {
      const request = ++latest.current
      startTransition(async () => {
        let outcome: Awaited<ReturnType<typeof loadRedirectLinksAction>> | 'failed'
        try {
          outcome = await loadRedirectLinksAction(host, { crawlId, urlHash, page })
        } catch {
          outcome = 'failed'
        }
        if (request !== latest.current) return
        if (outcome === 'failed') setFailure('failed')
        else if (outcome.kind === 'ok') {
          setShown(outcome.links)
          setFailure(null)
        } else setFailure(outcome.kind)
      })
    },
    [host, crawlId, urlHash],
  )

  return (
    <section
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3"
      aria-labelledby="links-via-redirects-title"
    >
      <h3
        id="links-via-redirects-title"
        className="flex flex-wrap items-center gap-2 text-sm font-medium"
      >
        <ArrowRightLeftIcon className="size-4 text-muted-foreground" aria-hidden="true" />
        {t('title')}
        <Badge variant="secondary">{t('count', { count: shown.total })}</Badge>
      </h3>
      <p className="text-xs text-muted-foreground">{t('note')}</p>
      {failure && (
        <p role="alert" className="text-sm text-destructive">
          {t(`errors.${failure}`)}
        </p>
      )}
      <div aria-busy={pending} className={pending ? 'opacity-60 transition-opacity' : undefined}>
        <ul className="grid gap-3 text-sm">
          {shown.items.map((redirecting) => (
            <li key={redirecting.urlHash} className="grid min-w-0 gap-1.5">
              <div className="flex min-w-0 items-center gap-2">
                <span className="flex w-14 shrink-0 items-center">
                  {redirecting.statusCode === null ? (
                    <Badge variant="outline">—</Badge>
                  ) : (
                    <StatusCell row={{ statusCode: redirecting.statusCode, error: null }} />
                  )}
                </span>
                <OpenUrlLink
                  target={{ hash: redirecting.urlHash, url: redirecting.url }}
                  href={applyHref(hrefs, redirecting.urlHash)}
                  className="block min-w-0 truncate font-mono text-xs hover:underline"
                  title={redirecting.url}
                >
                  {displayUrl(redirecting.url, host)}
                </OpenUrlLink>
              </div>
              {redirecting.links === 0 ? (
                <p className="pl-16 text-xs text-muted-foreground">{t('noLinks')}</p>
              ) : (
                <ul className="grid gap-1 pl-16 text-xs">
                  {redirecting.sources.map((source) => (
                    <li
                      key={`${source.urlHash}:${source.kind}`}
                      className="grid min-w-0 grid-cols-[minmax(0,1fr)_max-content] items-center gap-2"
                    >
                      <OpenUrlLink
                        target={{ hash: source.urlHash, url: source.url }}
                        href={applyHref(hrefs, source.urlHash)}
                        className="block min-w-0 truncate font-mono hover:underline"
                        title={source.url}
                      >
                        {displayUrl(source.url, host)}
                      </OpenUrlLink>
                      <Badge variant="outline" className="whitespace-nowrap">
                        {tKinds(source.kind)}
                      </Badge>
                      {source.context && (
                        <span className="col-span-full text-muted-foreground">
                          {[
                            source.context.text,
                            source.context.element,
                            source.context.region ? tRegions(source.context.region) : undefined,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </span>
                      )}
                    </li>
                  ))}
                  {redirecting.links > redirecting.sources.length && (
                    <li className="text-muted-foreground">
                      {t('more', { count: redirecting.links - redirecting.sources.length })}
                    </li>
                  )}
                </ul>
              )}
            </li>
          ))}
        </ul>
      </div>
      {shown.pageCount > 1 && (
        <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
          <p className="text-sm text-muted-foreground tabular-nums">
            {tPagination('summary', { page: shown.page, pages: shown.pageCount })}
          </p>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending || shown.page <= 1}
              onClick={() => load(shown.page - 1)}
            >
              {tPagination('previous')}
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={pending || shown.page >= shown.pageCount}
              onClick={() => load(shown.page + 1)}
            >
              {tPagination('next')}
            </Button>
          </div>
        </div>
      )}
    </section>
  )
}
