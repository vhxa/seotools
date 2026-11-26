import { isLinkKind } from '@seotools/core/crawl/links'
import type { DiscoveryStep } from '@seotools/db'
import { getTranslations } from 'next-intl/server'
import { discoverySentences } from '@/lib/discovery-chain'
import { displayUrl } from '@/lib/url-display'

/**
 * "How it was found": the steps from where the crawl started to the URL, each a sentence about what
 * one URL did to reach the next ("`/sitemap.xml` lists `/a`", "That URL links to `/b/`"). The kind of
 * link belongs to the step it leads to, so it is read as a relation between two URLs and never as
 * something that is true of the URL on its own. Only what the crawl stored is told; what it did not
 * keep says "not recorded".
 */
export async function DiscoveryChain({
  host,
  steps,
  hrefFor,
}: {
  host: string
  steps: DiscoveryStep[]
  hrefFor: (urlHash: string) => string
}) {
  const [t, tRegions] = await Promise.all([
    getTranslations('UrlDetail.discoveryChain'),
    getTranslations('LinkRegions'),
  ])
  const { sentences, earlierMissing } = discoverySentences(steps)
  const link = (step: DiscoveryStep) => (
    <a
      className="font-mono text-xs break-all underline"
      href={hrefFor(step.urlHash)}
      title={step.url}
    >
      {displayUrl(step.url, host)}
    </a>
  )
  return (
    <div className="grid gap-2">
      <p className="text-xs text-muted-foreground">{t('intro')}</p>
      <ol className="grid gap-3 text-sm">
        {earlierMissing && <li className="text-muted-foreground">{t('earlierMissing')}</li>}
        {sentences.map(({ from, to, kind, isLast }, index) => {
          const context = to.context
          const detail = context
            ? [
                context.text ? `“${context.text}”` : undefined,
                context.element,
                context.region ? tRegions(context.region) : undefined,
              ].filter(Boolean)
            : []
          return (
            <li key={to.urlHash} className="grid min-w-0 grid-cols-[1.5rem_minmax(0,1fr)] gap-x-1">
              <span className="text-muted-foreground tabular-nums">{index + 1}.</span>
              <span className="min-w-0">
                {t.rich('step', {
                  subject: () => (index === 0 ? link(from) : t('thatUrl')),
                  relation: t(`relations.${kind && isLinkKind(kind) ? kind : 'unknown'}`),
                  target: () => (
                    <>
                      {link(to)}
                      {isLast && (
                        <span className="ml-1 rounded border px-1 text-xs text-muted-foreground">
                          {t('thisUrl')}
                        </span>
                      )}
                    </>
                  ),
                })}
                {kind === null && (
                  <span className="block text-xs text-muted-foreground">{t('howMissing')}</span>
                )}
                {detail.length > 0 ? (
                  <span className="block text-xs text-muted-foreground">{detail.join(' · ')}</span>
                ) : (
                  (kind === 'anchor' || kind === 'anchor-nofollow') && (
                    <span className="block text-xs text-muted-foreground">
                      {t('contextMissing')}
                    </span>
                  )
                )}
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}
