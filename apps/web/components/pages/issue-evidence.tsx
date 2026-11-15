import type { CanonicalEvidence, IssueEvidence } from '@seotools/core'
import { evidenceKindOf, type ISSUE_EVIDENCE } from '@seotools/core/crawl/evidence'
import { ExternalLinkIcon } from 'lucide-react'
import { useTranslations } from 'next-intl'
import type { ReactNode } from 'react'
import { OpenUrlLink } from '@/components/pages/url-drawer'
import { Badge } from '@/components/ui/badge'
import { evidenceTarget } from '@/lib/issue-evidence'

type Place = {
  /** The crawl's URLs the evidence links to the detail of. */
  known: ReadonlyMap<string, string>
  hrefFor: (urlHash: string) => string
}

const ADDRESS = 'min-w-0 font-mono text-xs break-all'

/**
 * An address from evidence: the detail of the page when the crawl has it, the address itself,
 * opened apart, when it is some other HTTP(S) URL, and plain text for anything else. What a site
 * wrote is never put in an `href` unless it is a real URL (`evidenceTarget`).
 */
export function Address({
  url,
  text,
  known,
  hrefFor,
}: Place & { url: string | null; text?: string | undefined }) {
  const target = evidenceTarget(url, known)
  const shown = text ?? url
  if (target.kind === 'crawl') {
    return (
      <OpenUrlLink
        target={{ hash: target.hash, url: target.url }}
        href={hrefFor(target.hash)}
        className={`${ADDRESS} hover:underline`}
        title={target.url}
      >
        {shown}
      </OpenUrlLink>
    )
  }
  if (target.kind === 'external') {
    return (
      <a
        href={target.url}
        target="_blank"
        rel="noreferrer noopener"
        className={`${ADDRESS} inline-flex items-baseline gap-1 hover:underline`}
        title={target.url}
      >
        {shown}
        <ExternalLinkIcon aria-hidden className="size-3 shrink-0 self-center" />
      </a>
    )
  }
  return <span className={ADDRESS}>{shown}</span>
}

function Meta({ children }: { children: ReactNode }) {
  return (
    <Badge variant="outline" className="max-w-full font-mono font-normal break-all">
      {children}
    </Badge>
  )
}

function Canonical({ declared, ...place }: Place & { declared: CanonicalEvidence }) {
  const t = useTranslations('IssueEvidence.canonicals')
  return (
    <li className="grid gap-1">
      <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        <code className={ADDRESS}>{declared.raw || t('empty')}</code>
        {declared.source === 'header' && <Badge variant="outline">{t('source.header')}</Badge>}
        {declared.source !== 'header' && (
          <Badge variant="outline">{t(declared.inHead ? 'inHead' : 'inBody')}</Badge>
        )}
      </span>
      {declared.url !== null && declared.url !== declared.raw && (
        <span className="flex items-baseline gap-1.5 text-muted-foreground">
          <span aria-hidden>→</span>
          <span className="sr-only">{t('resolvesTo')}</span>
          <Address url={declared.url} {...place} />
        </span>
      )}
    </li>
  )
}

/** What the crawl saw that makes a URL have an issue, from the evidence stored with the finding. */
function Items({ evidence, ...place }: Place & { evidence: IssueEvidence }) {
  const t = useTranslations('IssueEvidence')
  const tKinds = useTranslations('LinkKinds')

  switch (evidence.kind) {
    case 'values':
      return (
        <>
          {evidence.items.map((item, index) => (
            <li key={index} className="grid gap-1">
              <span className="font-medium">{t(`fields.${item.field}`)}</span>
              <code className="break-all">{item.text}</code>
            </li>
          ))}
        </>
      )

    case 'images':
      return (
        <>
          {evidence.items.map((image, index) => (
            <li key={index} className="grid gap-1">
              <span className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
                {image.src === '' ? (
                  <span className="text-muted-foreground">{t('images.noSource')}</span>
                ) : (
                  <Address url={image.url} text={image.url ?? image.src} {...place} />
                )}
                {image.id && <Meta>{t('images.id', { value: image.id })}</Meta>}
                {image.class && <Meta>{t('images.class', { value: image.class })}</Meta>}
              </span>
              {image.alt && (
                <span className="text-muted-foreground">
                  {t('images.alt', { value: image.alt })}
                </span>
              )}
            </li>
          ))}
        </>
      )
    case 'links':
      return (
        <>
          {evidence.items.map((link, index) => (
            <li key={index} className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
              <Badge variant="outline">{tKinds(link.kind)}</Badge>
              {link.url === null ? (
                <code className={ADDRESS}>{link.raw || t('links.noAddress')}</code>
              ) : (
                <Address url={link.url} {...place} />
              )}
              {link.raw && link.url !== null && (
                <span className="text-muted-foreground">
                  {t('links.written', { value: link.raw })}
                </span>
              )}
              {link.text && <span>{t('links.text', { value: link.text })}</span>}
              {link.reason && (
                <span className="text-muted-foreground">{t(`links.reasons.${link.reason}`)}</span>
              )}
            </li>
          ))}
        </>
      )
    case 'canonicals':
      return (
        <>
          {evidence.items.map((declared, index) => (
            <Canonical key={index} declared={declared} {...place} />
          ))}
        </>
      )
    case 'related-urls':
      return (
        <>
          {evidence.urls.map((url) => (
            <li key={url}>
              <Address url={url} {...place} />
            </li>
          ))}
        </>
      )
  }
}

/** The other URLs a finding a rule accepts is about, for any issue. */
export function RelatedUrls({ urls, total, ...place }: Place & { urls: string[]; total: number }) {
  const t = useTranslations('UrlDetail.accepted')
  return (
    <div className="grid gap-1 rounded-md border bg-muted/30 p-3 text-xs">
      <p className="font-medium">{t('related', { total })}</p>
      <ul className="grid gap-1">
        {urls.map((url) => (
          <li key={url}>
            <Address url={url} {...place} />
          </li>
        ))}
      </ul>
    </div>
  )
}

/**
 * The evidence of a finding: what makes the URL have the issue, labelled by what it is. A finding
 * whose issue comes with evidence but has none says it is not available (the crawl predates it),
 * and never shows examples it does not have.
 */
export function IssueEvidenceView({
  issue,
  evidence,
  ...place
}: Place & { issue: string; evidence: IssueEvidence | undefined }) {
  const t = useTranslations('IssueEvidence')
  const expected = evidenceKindOf(issue)
  if (expected === null) return null
  if (evidence?.kind !== expected) {
    return <p className="text-xs text-muted-foreground">{t('unavailable')}</p>
  }

  const shown = evidence.kind === 'related-urls' ? evidence.urls.length : evidence.items.length
  const unit = t(`units.${evidence.kind}`, { total: evidence.total })
  const total =
    evidence.kind === 'related-urls' && evidence.atLeast ? t('atLeast', { value: unit }) : unit
  const label = t(`labels.${issue as keyof typeof ISSUE_EVIDENCE}`)

  return (
    <div className="grid gap-2 rounded-md border bg-muted/30 p-3 text-xs">
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="font-medium">{label}</span>
        <span className="text-muted-foreground">
          {shown < evidence.total ? t('showing', { total, shown }) : total}
        </span>
      </p>
      {shown === 0 ? (
        <p className="text-muted-foreground">{t('noSamples')}</p>
      ) : (
        <ul className="grid gap-2">
          <Items evidence={evidence} {...place} />
        </ul>
      )}
    </div>
  )
}
