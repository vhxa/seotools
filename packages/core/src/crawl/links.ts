/**
 * How the links of one URL are explored: the two directions, the groups the types of link are
 * offered in, and the filter a list of them takes. The crawl stores, for each link, the URL it
 * starts at, the URL it points to and its type (`CrawlLinkKind`), nothing else: no anchor text and
 * no attributes other than `rel="nofollow"`, which is a type of its own. Nothing here invents more.
 *
 * Pure on purpose (no Node imports): client components import it through
 * `@seotools/core/crawl/links`.
 */
import { CRAWL_LINK_KINDS, type CrawlLinkKind } from './types'

/** `in`: the links that arrive at a URL. `out`: the links that leave it. */
export const LINK_DIRECTIONS = ['in', 'out'] as const
export type LinkDirection = (typeof LINK_DIRECTIONS)[number]

export const isLinkDirection = (value: unknown): value is LinkDirection =>
  typeof value === 'string' && (LINK_DIRECTIONS as readonly string[]).includes(value)

/** How many links a list shows at a time. */
export const LINKS_PAGE_SIZE = 25
/** The longest text a search takes: what a client sends is cut here. */
export const MAX_LINK_SEARCH_LENGTH = 200

/**
 * The groups the types of link are offered in. `navigation` is what people click and search
 * engines follow, and what a list shows unless asked otherwise. Scripts, styles and images are
 * `resources`: a page that loads a broken one is reported by its own findings whatever list is
 * open, and these are one choice away. `declared` is what a page, a header or a sitemap names.
 */
export const LINK_GROUPS = ['navigation', 'resources', 'declared'] as const
export type LinkGroup = (typeof LINK_GROUPS)[number]

/** Every group plus "all of them". */
export const LINK_GROUP_CHOICES = [...LINK_GROUPS, 'all'] as const
export type LinkGroupChoice = (typeof LINK_GROUP_CHOICES)[number]

/** The group of each type of link. TypeScript fails until a new type is placed in one. */
export const LINK_GROUP_OF = {
  anchor: 'navigation',
  'anchor-nofollow': 'navigation',
  script: 'resources',
  style: 'resources',
  image: 'resources',
  media: 'resources',
  frame: 'resources',
  other: 'resources',
  canonical: 'declared',
  hreflang: 'declared',
  'head-link': 'declared',
  form: 'declared',
  meta: 'declared',
  'structured-data': 'declared',
  'http-header': 'declared',
  redirect: 'declared',
  sitemap: 'declared',
  llms: 'declared',
} as const satisfies Record<CrawlLinkKind, LinkGroup>

export const isLinkKind = (value: unknown): value is CrawlLinkKind =>
  typeof value === 'string' && (CRAWL_LINK_KINDS as readonly string[]).includes(value)

/** The types of link of a group, in the order the crawl lists them. */
export const linkKindsOf = (group: LinkGroupChoice): CrawlLinkKind[] =>
  CRAWL_LINK_KINDS.filter((kind) => group === 'all' || LINK_GROUP_OF[kind] === group)

/** What a list of links is narrowed to. */
export interface LinkFilter {
  group: LinkGroupChoice
  /** One type within the group. `null`: every type of the group. */
  kind: CrawlLinkKind | null
  /** Part of the address at the other end, ignoring case. `''`: no search. */
  search: string
}

/** Navigation links, which is what a list opens on. */
export const DEFAULT_LINK_FILTER: LinkFilter = { group: 'navigation', kind: null, search: '' }

/**
 * A filter from whatever a client sent: what is not recognised falls back to the default, a type
 * outside its group is dropped, and the search is cut to a sensible length.
 */
export function parseLinkFilter(input: unknown): LinkFilter {
  const raw = typeof input === 'object' && input !== null ? (input as Record<string, unknown>) : {}
  const group =
    LINK_GROUP_CHOICES.find((choice) => choice === raw.group) ?? DEFAULT_LINK_FILTER.group
  const kind =
    isLinkKind(raw.kind) && (group === 'all' || LINK_GROUP_OF[raw.kind] === group) ? raw.kind : null
  const search =
    typeof raw.search === 'string' ? raw.search.trim().slice(0, MAX_LINK_SEARCH_LENGTH) : ''
  return { group, kind, search }
}

/** The types of link a filter keeps. `undefined`: all of them, so the list needs no condition. */
export function filterKinds(
  filter: Pick<LinkFilter, 'group' | 'kind'>,
): CrawlLinkKind[] | undefined {
  if (filter.kind) return [filter.kind]
  return filter.group === 'all' ? undefined : linkKindsOf(filter.group)
}

/** How many links of each type a URL has in one direction. */
export type LinkKindCounts = Record<CrawlLinkKind, number>

/** Folds `count(*) group by kind` into a count for every type, with zero for the ones not found. */
export function foldLinkKindCounts(rows: { kind: string; count: number }[]): LinkKindCounts {
  const counts = Object.fromEntries(CRAWL_LINK_KINDS.map((kind) => [kind, 0])) as LinkKindCounts
  for (const { kind, count } of rows) if (isLinkKind(kind)) counts[kind] += count
  return counts
}

/** The links of a group, and of all of them. */
export function linkGroupCounts(counts: LinkKindCounts): Record<LinkGroupChoice, number> {
  const groups = { navigation: 0, resources: 0, declared: 0, all: 0 }
  for (const kind of CRAWL_LINK_KINDS) {
    groups[LINK_GROUP_OF[kind]] += counts[kind]
    groups.all += counts[kind]
  }
  return groups
}

/** Breakdown of the sources that reference a broken or redirected target. */
export function referenceGroup(
  kind: CrawlLinkKind,
): 'link' | 'hreflang' | 'canonical' | 'sitemap' | 'resource' {
  if (kind === 'hreflang' || kind === 'canonical' || kind === 'sitemap') return kind
  return LINK_GROUP_OF[kind] === 'resources' ? 'resource' : 'link'
}
