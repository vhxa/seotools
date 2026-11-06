'use client'

import {
  LINKS_PAGE_SIZE,
  LINK_GROUP_CHOICES,
  MAX_LINK_SEARCH_LENGTH,
  isLinkKind,
  linkGroupCounts,
  linkKindsOf,
  type LinkFilter,
  type LinkGroupChoice,
} from '@seotools/core/crawl/links'
import { ArrowDownToLineIcon, ArrowUpFromLineIcon } from 'lucide-react'
import { useFormatter, useTranslations } from 'next-intl'
import { useCallback, useEffect, useRef, useState, useTransition } from 'react'
import { loadLinksAction } from '@/app/(protected)/domains/[host]/link-actions'
import { StatusCell } from '@/components/crawl/status-cell'
import { OpenUrlLink } from '@/components/pages/url-drawer'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import { applyHref, type HrefPattern, type UrlLinksPage } from '@/lib/url-links'

const ALL_TYPES = 'all-types'
const SEARCH_DELAY_MS = 300

type Failure = 'unavailable' | 'pruned' | 'failed'

/**
 * The links of one URL in one direction. The first page comes with the detail; changing the group,
 * the type, the search or the page asks the server for the next one, and the list stays where it is
 * (dimmed) until it arrives, so nothing around it moves.
 */
export function UrlLinksPanel({
  host,
  crawlId,
  urlHash,
  initial,
  hrefs,
  read,
  cutShort,
}: {
  host: string
  crawlId: string
  urlHash: string
  initial: UrlLinksPage
  hrefs: HrefPattern
  /** The crawl read this URL: what it links to is known (and may be nothing). */
  read: boolean
  /** The crawl stopped at its URL limit, so the links are not all there is. */
  cutShort: boolean
}) {
  const direction = initial.direction
  const t = useTranslations('UrlLinks')
  const tRegions = useTranslations('LinkRegions')
  const tKinds = useTranslations('LinkKinds')
  const tPagination = useTranslations('Pagination')
  const format = useFormatter()
  const [shown, setShown] = useState(initial)
  // What was last asked for: the controls show it straight away, the list when it arrives.
  const [asked, setAsked] = useState<LinkFilter>(initial.filter)
  const [searchText, setSearchText] = useState(initial.filter.search)
  const [failure, setFailure] = useState<Failure | null>(null)
  const [pending, startTransition] = useTransition()
  const latest = useRef(0)

  const load = useCallback(
    (filter: LinkFilter, page: number) => {
      const request = ++latest.current
      setAsked(filter)
      startTransition(async () => {
        let outcome: Awaited<ReturnType<typeof loadLinksAction>> | 'failed'
        try {
          outcome = await loadLinksAction(host, { crawlId, urlHash, direction, filter, page })
        } catch {
          outcome = 'failed'
        }
        // A later request has taken over: this answer is stale.
        if (request !== latest.current) return
        if (outcome === 'failed') setFailure('failed')
        else if (outcome.kind === 'ok') {
          setShown(outcome.links)
          setFailure(null)
        } else setFailure(outcome.kind)
      })
    },
    [host, crawlId, urlHash, direction],
  )

  // The search waits for a pause in typing. It compares with what was asked, never with what the
  // server understood, so a text it shortens does not ask again and again.
  useEffect(() => {
    const text = searchText.trim()
    if (text === asked.search) return
    const timer = setTimeout(() => load({ ...asked, search: text }, 1), SEARCH_DELAY_MS)
    return () => clearTimeout(timer)
  }, [searchText, asked, load])

  const groupCounts = linkGroupCounts(shown.counts)
  const everything = groupCounts.all
  const kinds = linkKindsOf(asked.group).filter(
    (kind) => shown.counts[kind] > 0 || kind === asked.kind,
  )
  const first = shown.total === 0 ? 0 : (shown.page - 1) * LINKS_PAGE_SIZE + 1
  const last = first === 0 ? 0 : first + shown.items.length - 1

  const DirectionIcon = direction === 'in' ? ArrowDownToLineIcon : ArrowUpFromLineIcon

  const empty =
    everything === 0
      ? direction === 'in'
        ? t('in.empty')
        : read
          ? t('out.empty')
          : t('out.unread')
      : asked.search
        ? t('noMatch', { search: asked.search })
        : t(`groupEmpty.${asked.group}`)

  return (
    <section
      className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-3"
      aria-labelledby={`links-${direction}-title`}
    >
      <div className="grid gap-1">
        <h3
          id={`links-${direction}-title`}
          className="flex flex-wrap items-center gap-2 text-sm font-medium"
        >
          <DirectionIcon className="size-4 text-muted-foreground" aria-hidden="true" />
          {t(`${direction}.title`)}
          <Badge variant="secondary">{t('count', { count: everything })}</Badge>
        </h3>
      </div>

      <Tabs
        className="min-w-0"
        value={asked.group}
        onValueChange={(group) =>
          load({ group: group as LinkGroupChoice, kind: null, search: searchText.trim() }, 1)
        }
      >
        <TabsList
          aria-label={t('groupsLabel')}
          className="max-w-full flex-wrap justify-start gap-y-1 group-data-horizontal/tabs:h-auto"
        >
          {LINK_GROUP_CHOICES.map((group) => (
            <TabsTrigger key={group} value={group} className="h-auto flex-none whitespace-normal">
              {t(`groups.${group}`)}
              <span className="text-muted-foreground tabular-nums">
                {format.number(groupCounts[group])}
              </span>
            </TabsTrigger>
          ))}
        </TabsList>
        <p className="min-h-8 text-xs text-muted-foreground">{t(`groupHelp.${asked.group}`)}</p>

        <div className="flex flex-wrap items-center gap-2">
          <Input
            type="search"
            value={searchText}
            maxLength={MAX_LINK_SEARCH_LENGTH}
            onChange={(event) => setSearchText(event.target.value)}
            placeholder={t('searchPlaceholder')}
            aria-label={t('search')}
            className="h-7 min-w-0 flex-1 basis-40"
          />
          <Select
            items={[
              { value: ALL_TYPES, label: t('kind.all') },
              ...kinds.map((kind) => ({ value: kind, label: tKinds(kind) })),
            ]}
            value={asked.kind ?? ALL_TYPES}
            disabled={kinds.length < 2 && asked.kind === null}
            onValueChange={(value) =>
              load(
                {
                  ...asked,
                  kind: value === ALL_TYPES || !isLinkKind(value) ? null : value,
                  search: searchText.trim(),
                },
                1,
              )
            }
          >
            <SelectTrigger size="sm" className="w-44 max-w-full" aria-label={t('kind.label')}>
              <SelectValue />
            </SelectTrigger>
            <SelectContent alignItemWithTrigger={false}>
              <SelectItem value={ALL_TYPES}>{t('kind.all')}</SelectItem>
              {kinds.map((kind) => (
                <SelectItem key={kind} value={kind}>
                  {tKinds(kind)}
                  <span className="text-muted-foreground tabular-nums">
                    {format.number(shown.counts[kind])}
                  </span>
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <TabsContent value={asked.group} className="grid min-w-0 grid-cols-[minmax(0,1fr)] gap-2">
          {failure && (
            <p role="alert" className="text-sm text-destructive">
              {t(`errors.${failure}`)}
            </p>
          )}
          <div
            aria-busy={pending}
            className={pending ? 'opacity-60 transition-opacity' : undefined}
          >
            {failure ? null : shown.items.length === 0 ? (
              <p className="text-sm text-muted-foreground">{empty}</p>
            ) : (
              <ul className="grid gap-1.5 text-sm">
                {shown.items.map((link) => (
                  <li
                    key={`${link.urlHash}:${link.kind}`}
                    className="grid min-w-0 grid-cols-[3.5rem_minmax(0,1fr)_max-content] items-center gap-2 whitespace-nowrap"
                  >
                    <span className="flex min-w-0 items-center overflow-hidden [&>*]:max-w-full [&>*]:truncate">
                      {link.statusCode === null && !link.error ? (
                        // Never answered because it was never requested: unknown, not a failure.
                        <Badge variant="outline" title={t('notRequested')}>
                          —<span className="sr-only">{t('notRequested')}</span>
                        </Badge>
                      ) : (
                        <StatusCell row={link} />
                      )}
                    </span>
                    <OpenUrlLink
                      target={{ hash: link.urlHash, url: link.url }}
                      href={applyHref(hrefs, link.urlHash)}
                      className="block min-w-0 truncate font-mono text-xs hover:underline"
                      title={link.url}
                    >
                      {link.url}
                    </OpenUrlLink>
                    <span className="flex flex-nowrap items-center justify-end gap-1">
                      {link.scope === 'external' && (
                        <Badge
                          variant="outline"
                          className="shrink-0 whitespace-nowrap"
                          title={t('external')}
                        >
                          {t('external')}
                        </Badge>
                      )}
                      <Badge
                        variant="outline"
                        className="shrink-0 whitespace-nowrap"
                        title={tKinds(isLinkKind(link.kind) ? link.kind : 'other')}
                      >
                        {tKinds(isLinkKind(link.kind) ? link.kind : 'other')}
                      </Badge>
                    </span>
                    {link.context && (
                      <div className="col-span-full grid gap-1 text-xs break-words whitespace-normal text-muted-foreground">
                        <p>
                          {[
                            link.context.text,
                            link.context.element,
                            link.context.region ? tRegions(link.context.region) : undefined,
                          ]
                            .filter(Boolean)
                            .join(' · ')}
                        </p>
                        {link.context.snippet && (
                          <p className="font-mono">{link.context.snippet}</p>
                        )}
                      </div>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          {!failure && shown.total > 0 && (
            <div className="flex min-w-0 flex-wrap items-center justify-between gap-3">
              <p className="text-sm text-muted-foreground tabular-nums">
                {t('showing', { from: first, to: last, total: shown.total })}
              </p>
              {shown.pageCount > 1 && (
                <div className="flex flex-wrap gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending || shown.page <= 1}
                    onClick={() => load(asked, shown.page - 1)}
                  >
                    {tPagination('previous')}
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={pending || shown.page >= shown.pageCount}
                    onClick={() => load(asked, shown.page + 1)}
                  >
                    {tPagination('next')}
                  </Button>
                </div>
              )}
            </div>
          )}
        </TabsContent>
      </Tabs>

      <p className="text-xs text-muted-foreground">{t(`${direction}.note`)}</p>
      {cutShort && <p className="text-xs text-muted-foreground">{t('incomplete')}</p>}
    </section>
  )
}
