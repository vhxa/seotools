import type { LanguageConfig } from '@seotools/core/crawl/audit'
import { isPageIssueId, isSecondaryFinding, PAGE_ISSUES } from '@seotools/core/crawl/issues'
import type { CrawlUrlAudit, CrawlUrlIssue, StructureUrl } from '@seotools/db'

/** Levels of directories shown at once below the one being looked at. */
export const STRUCTURE_DEPTH = 3
/** Directories listed under each node; the rest are one "other" row. */
export const STRUCTURE_CHILDREN = 12
/** Directories kept in memory per node and in all: past them, a directory only counts in "other". */
export const STRUCTURE_TRACKED_PER_NODE = 500
export const STRUCTURE_TRACKED_NODES = 5_000
/** Segments of a `?path=` that are read. */
const MAX_PATH_SEGMENTS = 16
const MAX_SEGMENT_LENGTH = 200
/** URLs read from the database at a time. */
export const STRUCTURE_BATCH = 2_000

/** What the URLs of a part of the site add up to. Findings are `null` when the crawl has none. */
export interface StructureCounts {
  /** Pages: HTML that answered 2xx. */
  pages: number
  /** URLs of the site that failed (4xx, 5xx or no answer), redirects not included. */
  errors: number
  /** Audited pages with a finding of each type (secondary findings not counted). */
  issue: number
  warning: number
  opportunity: number
}

export const emptyCounts = (): StructureCounts => ({
  pages: 0,
  errors: 0,
  issue: 0,
  warning: 0,
  opportunity: 0,
})

const add = (to: StructureCounts, by: StructureCounts) => {
  to.pages += by.pages
  to.errors += by.errors
  to.issue += by.issue
  to.warning += by.warning
  to.opportunity += by.opportunity
}

export interface StructureNode {
  /** The directory's name, without slashes. Empty for the node being looked at when it is the root. */
  name: string
  /** `/blog/`: where it is, and what `?path=` takes to look at it. */
  path: string
  counts: StructureCounts
  children: StructureNode[]
  /** Directories not listed in `children`, folded together: how many, and what they add up to. */
  other: { directories: number | null; counts: StructureCounts } | null
  /** It has directories below it that this tree does not show: expanding it shows them. */
  deeper: boolean
}

export interface StructureLanguage {
  /** The declared directory, `/es`, or `null` for everything else. */
  prefix: string | null
  counts: StructureCounts
}

/** The directories a path is in, in order: `/a/b/c` is in `a` and `b`, `/a/b/` in `a` and `b` too. */
export function directoriesOf(pathname: string): string[] {
  const segments = pathname.split('/').slice(1)
  return segments.slice(0, -1).filter((segment) => segment !== '')
}

/** The path of an address, or `null` if it is not one. */
export function pathnameOf(url: string): string | null {
  try {
    return new URL(url).pathname
  } catch {
    return null
  }
}

/** The directories `?path=/blog/en/` names. Anything that is not a plain path is the root. */
export function parseStructurePath(value: string | string[] | undefined): string[] {
  const raw = (Array.isArray(value) ? value[0] : value) ?? ''
  if (!raw.startsWith('/')) return []
  return raw
    .split('/')
    .filter((segment) => segment !== '')
    .slice(0, MAX_PATH_SEGMENTS)
    .map((segment) => segment.slice(0, MAX_SEGMENT_LENGTH))
}

/** `['a', 'b']` as `/a/b/`, and no directories as `/`. */
export const pathOfDirectories = (directories: readonly string[]) =>
  directories.length === 0 ? '/' : `/${directories.join('/')}/`

interface Tracked {
  name: string
  directories: string[]
  counts: StructureCounts
  children: Map<string, Tracked>
  folded: StructureCounts
  /** Directories that were counted in `folded` for lack of room, and have no node. */
  untracked: number
  deeper: boolean
}

const node = (name: string, directories: string[]): Tracked => ({
  name,
  directories,
  counts: emptyCounts(),
  children: new Map(),
  folded: emptyCounts(),
  untracked: 0,
  deeper: false,
})

/**
 * Adds up what URLs hold, directory by directory, below `root`. Memory is bounded whatever the
 * crawl: at most `STRUCTURE_DEPTH` levels, and a node's directories past the per-node and total
 * limits count only in its folded "other".
 */
export class StructureTree {
  private readonly top: Tracked
  private nodes = 1
  private readonly languages: LanguageConfig
  private readonly byLanguage = new Map<string | null, StructureCounts>()

  constructor(
    private readonly root: readonly string[],
    languages: LanguageConfig,
  ) {
    this.top = node('', [...root])
    this.languages = languages
    for (const prefix of languages.prefixes) this.byLanguage.set(prefix, emptyCounts())
    this.byLanguage.set(null, emptyCounts())
  }

  add(pathname: string, counts: StructureCounts) {
    const directories = directoriesOf(pathname)
    // The language breakdown looks at the whole site, whichever directory the tree is rooted at.
    const first = directories[0]
    const prefix =
      first === undefined
        ? null
        : (this.languages.prefixes.find((candidate) => candidate === `/${first}`) ?? null)
    add(this.byLanguage.get(prefix)!, counts)

    if (this.root.some((segment, index) => directories[index] !== segment)) return
    const below = directories.slice(this.root.length)
    add(this.top.counts, counts)
    let current = this.top
    for (let level = 0; level < below.length; level++) {
      if (level === STRUCTURE_DEPTH) {
        current.deeper = true
        return
      }
      const name = below[level]!
      let next = current.children.get(name)
      if (!next) {
        if (
          current.children.size >= STRUCTURE_TRACKED_PER_NODE ||
          this.nodes >= STRUCTURE_TRACKED_NODES
        ) {
          current.untracked++
          add(current.folded, counts)
          return
        }
        next = node(name, [...this.root, ...below.slice(0, level + 1)])
        current.children.set(name, next)
        this.nodes++
      }
      add(next.counts, counts)
      current = next
    }
  }

  result(): { tree: StructureNode; languages: StructureLanguage[]; truncated: boolean } {
    const languages: StructureLanguage[] = [
      ...this.languages.prefixes.map((prefix) => ({
        prefix: prefix as string | null,
        counts: this.byLanguage.get(prefix)!,
      })),
      { prefix: null, counts: this.byLanguage.get(null)! },
    ]
    return { tree: finish(this.top), languages, truncated: this.nodes >= STRUCTURE_TRACKED_NODES }
  }
}

function finish(tracked: Tracked): StructureNode {
  const ranked = [...tracked.children.values()].sort(
    (a, b) => b.counts.pages - a.counts.pages || a.name.localeCompare(b.name, 'en'),
  )
  const shown = ranked.slice(0, STRUCTURE_CHILDREN)
  const rest = ranked.slice(STRUCTURE_CHILDREN)
  const folded = emptyCounts()
  add(folded, tracked.folded)
  for (const child of rest) add(folded, child.counts)
  const foldedCount = rest.length + tracked.untracked
  return {
    name: tracked.name,
    path: pathOfDirectories(tracked.directories),
    counts: tracked.counts,
    children: shown.map(finish),
    other:
      foldedCount > 0
        ? { directories: tracked.untracked > 0 ? null : foldedCount, counts: folded }
        : null,
    // A level that is cut shows its own directories as "other" but is expanded the same way.
    deeper: tracked.deeper,
  }
}

/** The URLs of a batch that are pages, which are the ones the audit looked at. */
const isPage = (url: StructureUrl) =>
  url.kind === 'page' && url.statusCode !== null && url.statusCode >= 200 && url.statusCode < 300

/** The `errors` view, by what a URL of the site did: failed, and was not a redirect. */
const isError = (url: StructureUrl) =>
  url.state === 'done' &&
  url.kind !== 'redirect' &&
  (url.statusCode === null || url.statusCode >= 400)

/** What one URL adds, given the findings and the audit of the page. `null` findings: not known. */
export function countsOf(
  url: StructureUrl,
  analysis: {
    audit: Pick<CrawlUrlAudit, 'participation' | 'indexability'> | undefined
    issues: Pick<CrawlUrlIssue, 'issue'>[]
  } | null,
): StructureCounts {
  const counts = emptyCounts()
  if (isPage(url)) {
    counts.pages = 1
    if (analysis?.audit?.participation === 'audited') {
      const types = new Set<'issue' | 'warning' | 'opportunity'>()
      for (const { issue } of analysis.issues) {
        if (!isPageIssueId(issue) || isSecondaryFinding(issue, analysis.audit.indexability))
          continue
        types.add(PAGE_ISSUES[issue].type)
      }
      for (const type of types) counts[type] = 1
    }
  }
  if (isError(url)) counts.errors = 1
  return counts
}

/**
 * Reads the site of a crawl in bounded batches and adds it up. `analysisOf` gives what the audit
 * concluded about the pages of a batch (`null`: the crawl was not checked, so no findings).
 */
export async function buildStructure(input: {
  root: readonly string[]
  languages: LanguageConfig
  nextBatch: (after: string | null, limit: number) => Promise<StructureUrl[]>
  analysisOf: (
    pages: StructureUrl[],
  ) => Promise<Map<string, { audit: CrawlUrlAudit | undefined; issues: CrawlUrlIssue[] }> | null>
}) {
  const tree = new StructureTree(input.root, input.languages)
  let after: string | null = null
  for (;;) {
    const batch = await input.nextBatch(after, STRUCTURE_BATCH)
    if (batch.length === 0) break
    const analysis = await input.analysisOf(batch.filter(isPage))
    for (const url of batch) {
      const pathname = pathnameOf(url.url)
      if (pathname === null) continue
      tree.add(
        pathname,
        countsOf(
          url,
          analysis?.get(url.urlHash) ?? (analysis ? { audit: undefined, issues: [] } : null),
        ),
      )
    }
    if (batch.length < STRUCTURE_BATCH) break
    after = batch[batch.length - 1]!.urlHash
  }
  return tree.result()
}
