/**
 * The evidence some findings come with: what the crawl saw that makes a URL have the issue, so that
 * someone can act on it (which images, which other pages, which canonical declarations, which
 * links). The shapes are in `types.ts`; this says which issues have it and reads it back from
 * storage. The worker gathers it while parsing a page (`PageFactsCollector`) or while comparing the
 * pages of a crawl, and keeps `total` with only the first few samples of each list.
 *
 * Pure on purpose (no Node imports): client components import it through
 * `@seotools/core/crawl/evidence`.
 */
import type { PageIssueId } from './issues'
import {
  CRAWL_LINK_KINDS,
  MAX_EVIDENCE_ITEMS,
  MAX_EVIDENCE_TEXT,
  MAX_EVIDENCE_URL,
  type CanonicalEvidence,
  type CrawlLinkKind,
  type ImageEvidence,
  type IssueEvidence,
  type LinkEvidence,
} from './types'

export type IssueEvidenceKind = IssueEvidence['kind']

/**
 * The issues that come with evidence, and what kind. A finding of one of these without it means
 * the crawl cannot say (it was parsed before the evidence was kept): the UI says so, and never
 * makes up examples. Issues not listed have none.
 */
export const ISSUE_EVIDENCE = {
  'img-no-alt': 'images',
  'img-empty-alt': 'images',
  'img-long-alt': 'images',
  'img-no-size': 'images',
  'title-duplicate': 'related-urls',
  'description-duplicate': 'related-urls',
  'h1-duplicate': 'related-urls',
  'content-duplicate': 'related-urls',
  'content-near-duplicate': 'related-urls',
  'canonical-conflict': 'canonicals',
  'canonical-repeated': 'canonicals',
  'canonical-outside-head': 'canonicals',
  'canonical-fragment': 'canonicals',
  'canonical-relative': 'canonicals',
  'link-to-localhost': 'links',
  'uncrawlable-links': 'links',
  'mixed-content': 'links',
  'protocol-relative': 'links',
  'insecure-form': 'links',
  'unsafe-cross-origin-links': 'links',
  'anchor-empty': 'links',
  'anchor-vague': 'links',
} as const satisfies Partial<Record<PageIssueId, IssueEvidenceKind>>

/** The kind of evidence an issue comes with, or `null` if it has none. */
export const evidenceKindOf = (issue: string): IssueEvidenceKind | null =>
  Object.hasOwn(ISSUE_EVIDENCE, issue) ? ISSUE_EVIDENCE[issue as keyof typeof ISSUE_EVIDENCE] : null

/** Text a site wrote, on one line and no longer than `max`: it ends in `…` when it was cut. */
export function boundedText(text: string, max = MAX_EVIDENCE_TEXT): string {
  // Cut before collapsing: the text can be as long as the page.
  const head = text
    .slice(0, max * 4)
    .replace(/\s+/g, ' ')
    .trim()
  return head.length > max ? `${head.slice(0, max - 1)}…` : head
}

/** A resolved URL, or `null` when it is too long to keep as something to link to. */
export const boundedUrl = (url: string | null | undefined): string | null =>
  url && url.length <= MAX_EVIDENCE_URL ? url : null

const LINK_KINDS: ReadonlySet<string> = new Set(CRAWL_LINK_KINDS)

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

const text = (value: unknown, max = MAX_EVIDENCE_TEXT): string | undefined =>
  typeof value === 'string' ? boundedText(value, max) : undefined

const url = (value: unknown): string | null =>
  typeof value === 'string' ? boundedUrl(value) : null

function image(value: unknown): ImageEvidence | null {
  if (!isRecord(value) || typeof value.src !== 'string') return null
  const id = text(value.id)
  const className = text(value.class)
  const alt = text(value.alt)
  return {
    src: boundedText(value.src),
    url: url(value.url),
    ...(id ? { id } : {}),
    ...(className ? { class: className } : {}),
    ...(alt ? { alt } : {}),
  }
}

function link(value: unknown): LinkEvidence | null {
  if (!isRecord(value) || typeof value.kind !== 'string') return null
  if (value.kind !== 'form' && !LINK_KINDS.has(value.kind)) return null
  const raw = text(value.raw)
  const label = text(value.text)
  const reason =
    value.reason === 'javascript-url' || value.reason === 'scripted' ? value.reason : undefined
  return {
    kind: value.kind as CrawlLinkKind | 'form',
    url: url(value.url),
    ...(raw ? { raw } : {}),
    ...(label ? { text: label } : {}),
    ...(reason ? { reason } : {}),
  }
}

function canonical(value: unknown): CanonicalEvidence | null {
  if (!isRecord(value) || typeof value.raw !== 'string') return null
  return {
    raw: boundedText(value.raw),
    url: url(value.url),
    inHead: value.inHead === true,
    source: value.source === 'html' || value.source === 'header' ? value.source : null,
  }
}

function items<T>(value: unknown, read: (item: unknown) => T | null): T[] | null {
  if (!Array.isArray(value)) return null
  const kept: T[] = []
  for (const item of value.slice(0, MAX_EVIDENCE_ITEMS)) {
    const parsed = read(item)
    if (parsed) kept.push(parsed)
  }
  return kept
}

/**
 * Evidence as it was stored, checked and bounded again. `null` for anything that is not one: a
 * later version's kind, or a damaged value. The finding then simply has no evidence to show.
 */
export function parseIssueEvidence(value: unknown): IssueEvidence | null {
  if (!isRecord(value)) return null
  const { total } = value
  if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < 0) return null
  switch (value.kind) {
    case 'images': {
      const list = items(value.items, image)
      return list && { kind: 'images', total, items: list }
    }
    case 'links': {
      const list = items(value.items, link)
      return list && { kind: 'links', total, items: list }
    }
    case 'canonicals': {
      const list = items(value.items, canonical)
      return list && { kind: 'canonicals', total, items: list }
    }
    case 'related-urls': {
      if (!Array.isArray(value.urls)) return null
      const urls = value.urls
        .slice(0, MAX_EVIDENCE_ITEMS)
        .flatMap((item) => (typeof item === 'string' && boundedUrl(item) ? [item] : []))
      return {
        kind: 'related-urls',
        total,
        ...(value.atLeast === true ? { atLeast: true as const } : {}),
        urls,
      }
    }
    default:
      return null
  }
}
