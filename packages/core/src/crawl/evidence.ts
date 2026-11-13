/**
 * The evidence some findings come with: what the crawl saw that makes a URL have the issue, so that
 * someone can act on it (which images, which other pages, which canonical declarations, which
 * links). The shapes are in `types.ts`; this says which issues have it and reads it back from
 * storage. The worker gathers it while parsing a page (`PageFactsCollector`) or while comparing the
 * pages of a crawl or reading stored page values, and keeps `total` with only the first few samples
 * of each list.
 *
 * Pure on purpose (no Node imports): client components import it through
 * `@seotools/core/crawl/evidence`.
 */
import { z } from '../zod'
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
  'linked-only-by-javascript': 'related-urls',
  'links-only-after-rendering': 'related-urls',
  'html-entities-as-text': 'values',
  'few-html-links': 'values',
  'img-no-alt': 'images',
  'img-empty-alt': 'images',
  'img-long-alt': 'images',
  'img-no-size': 'images',
  'title-duplicate': 'related-urls',
  'description-duplicate': 'related-urls',
  'h1-duplicate': 'related-urls',
  'content-duplicate': 'related-urls',
  'content-near-duplicate': 'related-urls',
  'canonical-broken': 'related-urls',
  'canonical-redirect': 'related-urls',
  'canonical-not-indexable': 'related-urls',
  'links-to-broken': 'related-urls',
  'resources-broken': 'related-urls',
  'og-image-broken': 'related-urls',
  'links-to-redirect': 'related-urls',
  'links-to-canonicalised': 'related-urls',
  'links-tracking-parameters': 'related-urls',
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

// What was stored is untrusted: every field is read on its own, bounded again, and a field that is
// not what it should be is left out rather than failing the whole item.
const text = z
  .string()
  .transform((value) => boundedText(value))
  .catch('')
const url = z
  .string()
  .transform((value) => boundedUrl(value))
  .catch(null)

const imageSchema = z
  .object({
    src: z.string().transform((value) => boundedText(value)),
    url,
    id: text,
    class: text,
    alt: text,
  })
  .transform(({ src, url, id, class: className, alt }): ImageEvidence => ({
    src,
    url,
    ...(id ? { id } : {}),
    ...(className ? { class: className } : {}),
    ...(alt ? { alt } : {}),
  }))

const linkSchema = z
  .object({
    kind: z.string().refine((kind) => kind === 'form' || LINK_KINDS.has(kind)),
    url,
    raw: text,
    text,
    reason: z.enum(['javascript-url', 'scripted']).optional().catch(undefined),
  })
  .transform(({ kind, url, raw, text: label, reason }): LinkEvidence => ({
    kind: kind as CrawlLinkKind | 'form',
    url,
    ...(raw ? { raw } : {}),
    ...(label ? { text: label } : {}),
    ...(reason ? { reason } : {}),
  }))

const canonicalSchema = z
  .object({
    raw: z.string().transform((value) => boundedText(value)),
    url,
    inHead: z.unknown().optional(),
    source: z.enum(['html', 'header']).nullable().catch(null),
  })
  .transform(({ raw, url, inHead, source }): CanonicalEvidence => ({
    raw,
    url,
    inHead: inHead === true,
    source,
  }))

const envelopeSchema = z.object({
  kind: z.string(),
  total: z.number().int().nonnegative(),
  items: z.unknown().optional(),
  urls: z.unknown().optional(),
  atLeast: z.unknown().optional(),
})

function items<T>(value: unknown, schema: z.ZodType<T>): T[] | null {
  if (!Array.isArray(value)) return null
  const kept: T[] = []
  for (const item of value.slice(0, MAX_EVIDENCE_ITEMS)) {
    const parsed = schema.safeParse(item)
    if (parsed.success) kept.push(parsed.data)
  }
  return kept
}

/**
 * Evidence as it was stored, checked and bounded again. `null` for anything that is not one: a
 * later version's kind, or a damaged value. The finding then simply has no evidence to show.
 */
export function parseIssueEvidence(value: unknown): IssueEvidence | null {
  const envelope = envelopeSchema.safeParse(value)
  if (!envelope.success) return null
  const { total } = envelope.data
  switch (envelope.data.kind) {
    case 'values': {
      const list = items(
        envelope.data.items,
        z.object({
          field: z.enum(['title', 'description', 'h1', 'internal-links']),
          text,
        }),
      )
      return list && { kind: 'values', total, items: list }
    }
    case 'images': {
      const list = items(envelope.data.items, imageSchema)
      return list && { kind: 'images', total, items: list }
    }
    case 'links': {
      const list = items(envelope.data.items, linkSchema)
      return list && { kind: 'links', total, items: list }
    }
    case 'canonicals': {
      const list = items(envelope.data.items, canonicalSchema)
      return list && { kind: 'canonicals', total, items: list }
    }
    case 'related-urls': {
      const { urls } = envelope.data
      if (!Array.isArray(urls)) return null
      return {
        kind: 'related-urls',
        total,
        ...(envelope.data.atLeast === true ? { atLeast: true as const } : {}),
        urls: urls
          .slice(0, MAX_EVIDENCE_ITEMS)
          .flatMap((item) => (typeof item === 'string' && boundedUrl(item) ? [item] : [])),
      }
    }
    default:
      return null
  }
}
