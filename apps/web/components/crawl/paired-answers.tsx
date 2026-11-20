import type { Crawl } from '@seotools/db'
import type { AnswerPair } from '@seotools/core/crawl/paired'
import Link from 'next/link'
import { getTranslations } from 'next-intl/server'
import { getDb } from '@/lib/db'

export async function PairedNotice({ crawl, host }: { crawl: Crawl; host: string }) {
  if (crawl.type !== 'full' || crawl.status !== 'completed') return null
  const t = await getTranslations('PairedAnswers')
  const summary = crawl.pairedSummary
  const examples =
    crawl.pruned || !summary
      ? []
      : await Promise.all(
          summary.examples.map(async (hash) => (await getDb()).crawls.getUrl(crawl.id, hash)),
        )
  return (
    <section className="grid gap-1 text-sm">
      <p>
        {!summary?.comparable
          ? t('unavailable')
          : summary.different
            ? t('notice', { different: summary.different, total: summary.comparable })
            : t('same', { total: summary.comparable })}
      </p>
      {summary && summary.selected > summary.comparable && (
        <p>{t('unknown', { count: summary.selected - summary.comparable })}</p>
      )}
      {summary && crawl.pruned && <p>{t('pruned')}</p>}
      {examples.length > 0 && (
        <details>
          <summary className="cursor-pointer">{t('examples')}</summary>
          <ul>
            {examples.map(
              (row) =>
                row && (
                  <li key={row.urlHash}>
                    <Link
                      className="break-all underline"
                      href={`/domains/${host}/urls/${row.urlHash}?crawl=${crawl.id}`}
                    >
                      {row.url}
                    </Link>
                  </li>
                ),
            )}
          </ul>
        </details>
      )}
    </section>
  )
}

export async function PairedDetail({ pair }: { pair: AnswerPair }) {
  const t = await getTranslations('PairedAnswers')
  return (
    <section className="grid gap-2">
      <h3 className="font-medium">{t('title')}</h3>
      <p>
        {pair.unknown
          ? t(pair.unknown)
          : pair.changed.length
            ? t('changed', {
                fields: pair.changed
                  .map((field) => t(field === 'title' ? 'titleField' : field))
                  .join(', '),
              })
            : t('same', { total: 1 })}
      </p>
      {(['original', 'repeat'] as const).map((side) => {
        const answer = pair[side]
        if (!answer) return null
        return (
          <div key={side}>
            <h4 className="text-sm font-medium">{t(side)}</h4>
            <time dateTime={answer.at}>{answer.at}</time> · HTTP {answer.status}{' '}
            {answer.media === 'html' ? 'HTML' : answer.media === 'other' ? t('other') : ''}
            {answer.location && <p>{answer.location}</p>}
            {answer.html && (
              <>
                <p>{answer.html.title}</p>
                {pair.changed.includes('text') && (
                  <p>
                    {t('text')} · <code>{answer.html.textDigest}</code>
                  </p>
                )}
                {pair.changed.includes('anchors') && (
                  <p>
                    {t('anchors')} ({answer.html.anchors.count}) ·{' '}
                    <code>{answer.html.anchors.digest}</code>
                  </p>
                )}
                {pair.changed.includes('title') && <code>{answer.html.titleDigest}</code>}
              </>
            )}
            {pair.examples
              .filter((e) => e.side === side)
              .map((e) => (
                <p key={e.hash}>{t('onlyHere', { url: e.label })}</p>
              ))}
          </div>
        )
      })}
    </section>
  )
}
