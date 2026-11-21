import { ignoredParametersOf } from '@seotools/core/crawl/comparison-reasons'
import Link from 'next/link'
import { useFormatter, useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import type { CheckAnswer, RowReason } from '@/lib/crawl-compare'

/**
 * Why a URL is in one crawl only, in one sentence, from the reason stored for the pair: it names the
 * page it was linked from, the address it merged into, or what was not read whole, as links into
 * the crawl that has them. Only what the two crawls stored is said; when nothing explains it, today's
 * generic sentence. A recheck made after the later crawl adds what the URL answers now, apart.
 */
export function CompareReason({
  host,
  url,
  why,
  check,
  baseId,
  targetId,
  ignored,
}: {
  host: string
  /** The URL being explained. */
  url: string
  why: RowReason | null
  check: CheckAnswer | null
  baseId: string
  targetId: string
  /** Ignored parameters of each crawl, to name those that merged or split an address. */
  ignored: { base: readonly string[]; target: readonly string[] }
}) {
  const t = useTranslations('CrawlCompare.why')
  const tKinds = useTranslations('LinkKinds')
  const tRegions = useTranslations('LinkRegions')
  if (!why) return <p className="text-xs text-muted-foreground">{t('pending')}</p>

  const { explanation } = why
  const side = explanation.side
  const own = side === 'base' ? baseId : targetId
  const other = side === 'base' ? targetId : baseId
  const page = (urlHash: string, crawlId: string) =>
    `/domains/${host}/urls/${urlHash}?crawl=${crawlId}`
  const link = (target: { url: string; urlHash: string } | null, crawlId = own) =>
    function PageLink(chunks: ReactNode) {
      return target ? (
        <Link
          href={page(target.urlHash, crawlId)}
          className="font-mono break-all underline-offset-2 hover:underline"
        >
          {chunks}
        </Link>
      ) : (
        <span className="font-mono break-all">{chunks}</span>
      )
    }
  const via = { via: why.via?.url ?? '—', link: link(why.via) }
  const through = { through: why.through?.url ?? '—', link: link(why.through) }

  let sentence: ReactNode
  switch (explanation.reason) {
    case 'merged':
    case 'split': {
      const into = explanation.into
      const reversed = explanation.detail === 'into'
      // The crawl that ignores the parameter, and the address that carries it.
      const params = ignoredParametersOf(
        reversed ? (into?.url ?? '') : url,
        explanation.reason === 'merged' ? ignored.target : ignored.base,
      )
      const key = reversed ? 'into' : into?.present ? 'present' : 'absent'
      sentence = t.rich(`${explanation.reason}.${key}`, {
        params: params.join(', ') || '—',
        into: into?.url ?? '—',
        link: link(into ? { url: into.url, urlHash: into.urlHash } : null, other),
      })
      break
    }
    case 'settings':
      sentence =
        explanation.detail === 'excluded' || explanation.detail === 'depth'
          ? t.rich(`settings.${explanation.detail}.${side}`, via)
          : t(`settings.${settingKey(explanation.detail)}.${side}`)
      break
    case 'mode':
      sentence = t.rich(`mode.${side}`, via)
      break
    case 'unlinked':
    case 'linked':
      sentence =
        explanation.detail === 'chain'
          ? t.rich(`${explanation.reason}.chain`, through)
          : t.rich(`${explanation.reason}.direct`, via)
      break
    case 'notReached':
      sentence =
        explanation.detail === 'not-seen'
          ? t.rich(`notReached.chain.${side}`, through)
          : t.rich(`notReached.direct.${side}`, {
              ...via,
              state: t(`states.${stateKey(explanation.detail)}`),
            })
      break
    case 'limit':
      sentence = t(`limit.${side}`)
      break
    case 'depth':
      sentence = t.rich(`depth.${side}`, via)
      break
    case 'unstable':
      sentence = t.rich('unstable', via)
      break
    case 'unknown':
      sentence = t(
        `unknown.${explanation.detail === 'legacy' || explanation.detail === 'cap' ? explanation.detail : 'none'}`,
      )
      break
  }

  const notes: string[] = []
  if (explanation.reason === 'limit' && explanation.detail === 'unrecorded')
    notes.push(t('limit.unrecorded'))
  if (explanation.reason === 'depth')
    notes.push(t(explanation.detail === 'unchanged' ? 'depth.unchanged' : 'depth.unrecorded'))
  if (
    (explanation.reason === 'unlinked' || explanation.reason === 'linked') &&
    explanation.detail !== 'chain' &&
    explanation.sources > 1
  ) {
    notes.push(t('allWhole', { count: explanation.sources }))
  }

  const shownLink =
    why.link &&
    (explanation.reason === 'unlinked' ||
      explanation.reason === 'linked' ||
      explanation.reason === 'notReached' ||
      explanation.reason === 'mode')
      ? why.link
      : null

  return (
    <div className="grid gap-1 text-xs">
      <p>{sentence}</p>
      {notes.map((note) => (
        <p key={note} className="text-muted-foreground">
          {note}
        </p>
      ))}
      {shownLink && (
        <p className="text-muted-foreground">
          {t(side === 'base' ? 'linkWas' : 'linkIs', {
            kind: tKinds(shownLink.kind as Parameters<typeof tKinds>[0]),
            region: shownLink.context?.region ? tRegions(shownLink.context.region) : '',
            text: shownLink.context?.text ?? '',
            hasText: shownLink.context?.text ? 'yes' : 'no',
            hasRegion: shownLink.context?.region ? 'yes' : 'no',
          })}
        </p>
      )}
      {check && <CheckLine check={check} />}
    </div>
  )
}

const settingKey = (detail: string | null) =>
  detail === 'priority' || detail === 'files' || detail === 'limit' ? detail : 'other'

/** The class of a source not read whole, as the sentence names it. */
function stateKey(detail: string | null) {
  switch (detail) {
    case 'failed':
    case 'redirected':
    case 'served-truncated':
    case 'render-missing':
    case 'render-failed':
    case 'render-truncated':
    case 'render-unsettled':
    case 'render-redirected':
    case 'render-unreliable':
    case 'not-requested':
    case 'depth':
    case 'excluded':
    case 'mode':
      return detail
    default:
      return 'other'
  }
}

/** What the URL answers now: a recheck made after the later crawl, kept apart from the reason. */
function CheckLine({ check }: { check: CheckAnswer }) {
  const t = useTranslations('CrawlCompare.check')
  const format = useFormatter()
  const when = check.fetchedAt
    ? format.dateTime(check.fetchedAt, { dateStyle: 'medium', timeStyle: 'short' })
    : ''
  const answer =
    check.statusCode === null
      ? t('noAnswer', { when, error: check.error ?? '' })
      : check.redirectTo
        ? t('redirects', { when, status: check.statusCode, url: check.redirectTo })
        : t('answers', { when, status: check.statusCode })
  return (
    <div className="mt-1 border-l-2 pl-2">
      <p>{answer}</p>
      <p className="text-muted-foreground">{t('note')}</p>
    </div>
  )
}
