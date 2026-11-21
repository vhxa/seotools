import {
  EXPLANATION_VERSION,
  MAX_CHAIN_STEPS,
  WITNESS_SETTINGS,
  reachChanges,
  chainStep,
  classifyDifference,
  classifyLink,
  identityChange,
  isComparisonReason,
  type ClassTally,
  type ComparisonReason,
  type ComparisonSide,
  type LinkClass,
  type ReachSettingsChanges,
} from '@seotools/core/crawl/comparison-reasons'
import { crawlUrlHash } from '@seotools/core'
import { compareCrawlDiscovery } from '@seotools/core/crawl/discovery'
import { discoveryLinkVaried, type AnswerPair } from '@seotools/core/crawl/paired'
import type { RenderState } from '@seotools/core/crawl/render-state'
import type { Crawl, Database, ExplainedUrl, InLink, OneSidedUrl, SourceCounterpart } from './types'

/** URLs worked out at a time: one batch and its grouped in-links are all that is held in memory. */
export const EXPLAIN_BATCH = 2000

/**
 * What a render of the other crawl was, as WP1's `captureProvesAbsence` reads it: one observation, its
 * state and its stored data (`capture` only; `null` when the render has none).
 */
export interface CaptureObservation {
  state: RenderState | null
  data: { capture?: { rule?: string } & Record<string, unknown> } | null
}

/** Whether a link missing from this render proves it was not in the page (WP1). */
export type CaptureTrust = (observation: CaptureObservation) => boolean

/** For tests: no render proves anything, as before WP1's capture rule. */
export const NO_CAPTURE_TRUST: CaptureTrust = () => false

/**
 * The capture rule of renders made since 0.8.0: a `complete` render with the `v2` marker. This is the
 * marker check WP1 shipped first; its `captureProvesAbsence({ state, data })` (one self-contained
 * observation: also no failed dependency and no delay) replaces it when WP1 merges. Switch the body
 * of this function to `return captureProvesAbsence(observation)` from
 * `@seotools/core/crawl/render-state`.
 */
export const RENDER_CAPTURE_TRUST: CaptureTrust = (observation) =>
  observation.state === 'complete' && observation.data?.capture?.rule === 'v2'

/**
 * WP3's paired observations: a few pages of a crawl requested twice. `pairs` reads, for a batch, the
 * stored pairs of these source pages (a crawl keeps 24 at most); `varied` says whether the link that
 * discovered a URL is witnessed as varying in the crawl that lacks it.
 */
export interface SiteVariation<P = unknown> {
  pairs(crawl: Crawl, sourceHashes: string[]): Promise<P[]>
  varied(input: {
    /** Both crawls completed under comparable request settings (`WITNESS_SETTINGS`). */
    comparable: boolean
    /** The crawl that has the URL, and the one that lacks it. */
    discovering: Crawl
    missing: Crawl
    /** The link that discovered it, in `discovering`. */
    discovery: { sourceHash: string; targetHash: string; kind: string; rendered: boolean }
    /** The stored pairs of `missing` for this batch's discovering pages. */
    pairs: P[]
    targetHash: string
  }): boolean
}

/** For tests: no crawl has paired observations. */
export const NO_SITE_VARIATION: SiteVariation = { pairs: async () => [], varied: () => false }

/** WP3's stored pairs (`answerPairs`) and its direction-matched witness (`discoveryLinkVaried`). */
export function storedSiteVariation(db: Pick<Database, 'crawls'>): SiteVariation<AnswerPair> {
  return {
    async pairs(crawl, sourceHashes) {
      if (!crawl.pairedSummary?.selected || sourceHashes.length === 0) return []
      return db.crawls.answerPairs(crawl.id, sourceHashes)
    },
    varied({ comparable, discovering, missing, discovery, pairs, targetHash }) {
      const pair = pairs.find((found) => found.sourceHash === discovery.sourceHash)
      return discoveryLinkVaried({
        comparableCompletedCrawls: comparable,
        discoveredCrawlId: discovering.id,
        missingCrawlId: missing.id,
        discovery: { crawlId: discovering.id, ...discovery },
        missing: pair ? { crawlId: missing.id, pair } : null,
        targetHash,
      })
    },
  }
}

export interface ExplainOptions {
  db: Pick<Database, 'crawls'>
  baseId: string
  targetId: string
  /** Who is working it out (a job id, or the crawl that just ended): only it may mark it done. */
  runner: string
  /** Default: `RENDER_CAPTURE_TRUST`. */
  captureTrust?: CaptureTrust
  /** Default: the stored pairs (`storedSiteVariation`). */
  variation?: SiteVariation
  /** Whether the depth or URL limit differ. Default: from the crawls' discovery snapshots (WP2). */
  reach?: ReachSettingsChanges
  signal?: AbortSignal
  /** Chain steps before what is still moving is given up on (`MAX_CHAIN_STEPS`). For tests. */
  maxChainSteps?: number
}

export type ExplainOutcome = 'done' | 'superseded' | 'not-comparable'

const sides: ComparisonSide[] = ['base', 'target']
const sameIgnored = (a: Crawl, b: Crawl) =>
  JSON.stringify([...new Set(a.ignoredParameters ?? [])].sort()) ===
  JSON.stringify([...new Set(b.ignoredParameters ?? [])].sort())

const stopIfAborted = (signal?: AbortSignal) => {
  if (signal?.aborted) throw new DOMException('Stopped', 'AbortError')
}

/**
 * Works out why each URL that one crawl of a pair has and the other lacks differs, from what the two
 * crawls stored, and stores it (`crawl_comparison_urls`). Requests nothing. Bounded: every pass reads
 * a batch of URLs and their grouped in-links, never a whole crawl. Starting again starts over (the
 * rows are removed first), so a retried job or a crash is safe.
 *
 * 1. URLs whose address is another one in the other crawl because the crawls ignore different query
 *    parameters: `merged` / `split`, with the address they have there.
 * 2. The rest, from their in-links (`classifyLink`, `classifyDifference`).
 * 3. Chains: URLs reached only through others the other crawl did not see either (`chainStep`).
 */
export async function explainPair(options: ExplainOptions): Promise<ExplainOutcome> {
  const { db, baseId, targetId, runner, signal } = options
  const captureTrust = options.captureTrust ?? RENDER_CAPTURE_TRUST
  const variation = options.variation ?? storedSiteVariation(db)
  const work = db.crawls.comparisonWork
  const [base, target] = await Promise.all([db.crawls.get(baseId), db.crawls.get(targetId)])
  if (!base || !target || base.pruned || target.pruned || base.domainId !== target.domainId)
    return 'not-comparable'
  const differences = compareCrawlDiscovery(base, target)
  const reach = options.reach ?? reachChanges(differences)
  // WP3's witness only between completed crawls whose requests were made alike.
  const comparable =
    base.status === 'completed' &&
    target.status === 'completed' &&
    !differences.some((difference) =>
      (WITNESS_SETTINGS as readonly string[]).includes(difference.setting),
    )
  const crawlOf = { base, target }
  const otherOf = (side: ComparisonSide) => (side === 'base' ? target : base)
  const pair = { baseId, targetId }
  if (!(await work.begin({ ...pair, runner, version: EXPLANATION_VERSION })))
    return 'not-comparable'

  try {
    // 1. Merged and split: only the addresses and the two snapshots of ignored parameters.
    const merged = !sameIgnored(base, target)
    if (merged) {
      for (const side of sides) {
        const other = otherOf(side)
        let after: string | null = null
        for (;;) {
          stopIfAborted(signal)
          const urls: OneSidedUrl[] = await work.oneSided({
            ...pair,
            side,
            after,
            limit: EXPLAIN_BATCH,
            undecided: false,
          })
          if (urls.length === 0) break
          after = urls.at(-1)!.urlHash
          const rows: ExplainedUrl[] = []
          for (const url of urls) {
            const into = identityChange(url.url, other.ignoredParameters ?? [])
            if (into === null) continue
            rows.push({
              side,
              urlHash: url.urlHash,
              seq: url.seq,
              reason: side === 'base' ? 'merged' : 'split',
              detail: null,
              via: null,
              through: null,
              sources: 0,
              unseen: 0,
              intoHash: crawlUrlHash(into),
              intoUrl: into,
              intoPresent: false,
            })
          }
          if (rows.length === 0) continue
          const present = new Set(
            (
              await work.present(
                other.id,
                rows.map((row) => row.intoHash!),
              )
            ).map((found) => found.urlHash),
          )
          for (const row of rows) row.intoPresent = present.has(row.intoHash!)
          await work.save({ ...pair, rows })
        }
      }
    }

    // 1b. The address they became, when only the other crawl has it: the same setting explains it.
    if (merged) {
      for (const side of sides) {
        const own = crawlOf[side]
        const otherSide: ComparisonSide = side === 'base' ? 'target' : 'base'
        let after: string | null = null
        for (;;) {
          stopIfAborted(signal)
          const rows: ExplainedUrl[] = await work.merges({
            ...pair,
            side,
            after,
            limit: EXPLAIN_BATCH,
          })
          if (rows.length === 0) break
          after = rows.at(-1)!.urlHash
          const intoHashes = [...new Set(rows.map((row) => row.intoHash!))]
          const inOwn = new Set((await work.present(own.id, intoHashes)).map((f) => f.urlHash))
          const onlyOther = intoHashes.filter((hash) => !inOwn.has(hash))
          if (onlyOther.length === 0) continue
          const found = await work.present(otherOf(side).id, onlyOther)
          const sourceOf = new Map(
            (
              await work.present(
                own.id,
                rows.map((row) => row.urlHash),
              )
            ).map((f) => [f.urlHash, f.url]),
          )
          await work.save({
            ...pair,
            rows: found.map((into) => {
              // One of the addresses that became it, named in the sentence.
              const from = rows.find((row) => row.intoHash === into.urlHash)!
              return {
                side: otherSide,
                urlHash: into.urlHash,
                seq: into.seq,
                reason: from.reason,
                detail: 'into',
                via: null,
                through: null,
                sources: 0,
                unseen: 0,
                intoHash: from.urlHash,
                intoUrl: sourceOf.get(from.urlHash) ?? null,
                intoPresent: true,
              }
            }),
          })
        }
      }
    }

    // 2. Everything else, from its in-links.
    for (const side of sides) {
      const own = crawlOf[side]
      const other = otherOf(side)
      const otherRendered = other.rendering?.mode === 'rendered'
      const otherIncomplete = other.status === 'incomplete'
      let after: string | null = null
      // What the other crawl has of each linking page, kept across batches of this side (a page
      // that links everything, like a script chunk's sources, is read once), up to a bound.
      const known: CounterpartCache = new Map()
      for (;;) {
        stopIfAborted(signal)
        // Undecided only (pass 1 decided the merged ones), by `url_hash` after the last batch: every
        // batch reads on from where the previous one stopped, never the side from its start.
        const urls: OneSidedUrl[] = await work.oneSided({
          ...pair,
          side,
          after,
          limit: EXPLAIN_BATCH,
          undecided: true,
        })
        if (urls.length === 0) break
        after = urls.at(-1)!.urlHash
        const seqs = urls.flatMap((url) => (url.seq === null ? [] : [url.seq]))
        // The other crawl's stored pairs for the pages that discovered this batch (24 at most).
        const otherPairs = await variation.pairs(
          other,
          urls.flatMap((url) => (url.foundVia ? [url.foundVia.urlHash] : [])),
        )
        const classes = await classesOf(
          work,
          pair,
          side,
          seqs,
          merged,
          otherRendered,
          captureTrust,
          known,
        )
        const rows = urls.map((url): ExplainedUrl => {
          const byClass = (url.seq !== null && classes.get(url.seq)) || {}
          const varied = variedSource(url, own, other, otherPairs, comparable, variation)
          const explanation = classifyDifference({
            side,
            source: url.source,
            classes: byClass,
            otherIncomplete,
            reach,
            varied,
            numbered: url.seq !== null && own.ref !== null,
          })
          return {
            side,
            urlHash: url.urlHash,
            seq: url.seq,
            reason: explanation.reason,
            detail: explanation.detail,
            via: explanation.via,
            through: null,
            sources: explanation.sources,
            unseen: byClass['not-seen']?.count ?? 0,
            intoHash: null,
            intoUrl: null,
            intoPresent: null,
          }
        })
        await work.save({ ...pair, rows })
      }
    }

    // 3. Chains, to a fixpoint: what is not reached through a source that was not reached either.
    let settled = false
    for (let step = 0; step < (options.maxChainSteps ?? MAX_CHAIN_STEPS) && !settled; step++) {
      settled = !(await chainPass(work, pair, merged, false, signal))
    }
    // Still moving at the cap: what is left is not given a change of the site.
    await chainPass(work, pair, merged, settled ? 'final' : 'cap', signal)

    const finished = await work.finish({ ...pair, runner, state: 'done' })
    return finished ? 'done' : 'superseded'
  } catch (error) {
    await work.finish({ ...pair, runner, state: 'failed' }).catch(() => undefined)
    throw error
  }
}

/** Linking pages whose counterpart is kept between batches of a side: a bound on memory. */
export const COUNTERPART_CACHE = 200_000
type CounterpartCache = Map<number, SourceCounterpart['counterpart']>

/** In-links read at a time: the page of plain rows held in memory with one batch of URLs. */
export const LINK_PAGE = 50_000

/**
 * The in-links of a batch of URLs, by class (`classifyLink`). Links are read as plain numbers, a page
 * at a time; what the other crawl has of each linking page is read once per page of links, for the
 * pages not seen yet in this batch, however many URLs each one links.
 */
async function classesOf(
  work: Database['crawls']['comparisonWork'],
  pair: { baseId: string; targetId: string },
  side: ComparisonSide,
  seqs: number[],
  merged: boolean,
  otherRendered: boolean,
  captureTrust: CaptureTrust,
  known: CounterpartCache,
): Promise<Map<number, Partial<Record<LinkClass, ClassTally>>>> {
  const classes = new Map<number, Partial<Record<LinkClass, ClassTally>>>()
  let after: { target: number; source: number; kind: string } | null = null
  for (;;) {
    const links: InLink[] = await work.inLinks({ ...pair, side, seqs, after, limit: LINK_PAGE })
    if (links.length === 0) break
    const last = links.at(-1)!
    after = { target: last.target, source: last.source, kind: last.kind }
    const unknown = [...new Set(links.map((link) => link.source))].filter((seq) => !known.has(seq))
    // Bounded: past the cap it starts again, which costs lookups, never memory.
    if (known.size + unknown.length > COUNTERPART_CACHE) known.clear()
    for (const found of await work.counterparts({ ...pair, side, sources: unknown, merged }))
      known.set(found.source, found.counterpart)
    for (const link of links) {
      const counterpart = known.get(link.source) ?? null
      const name = classifyLink({
        rendered: link.rendered,
        kind: link.kind,
        otherRendered,
        counterpart: counterpart && {
          state: counterpart.state,
          kind: counterpart.kind,
          statusCode: counterpart.statusCode,
          notRequested: counterpart.notRequested,
          servedTruncated: counterpart.servedTruncated,
          renderState: counterpart.renderState,
          captureProvesAbsence:
            link.rendered &&
            captureTrust({
              state: counterpart.renderState,
              data: counterpart.capture === null ? null : { capture: counterpart.capture },
            }),
        },
      })
      const byClass = classes.get(link.target) ?? {}
      const found = byClass[name]
      byClass[name] = found
        ? { count: found.count + 1, via: Math.min(found.via, link.source) }
        : { count: 1, via: link.source }
      classes.set(link.target, byClass)
    }
    if (links.length < LINK_PAGE) break
  }
  return classes
}

/**
 * WP3: the `seq` of the page whose link to U is witnessed as varying in the crawl that lacks U, which
 * only WP3's direction-matched witness may say (a served anchor, its original answer lacking U and
 * its repeat having it). `null`: no witness.
 */
function variedSource(
  url: OneSidedUrl,
  own: Crawl,
  other: Crawl,
  otherPairs: unknown[],
  comparable: boolean,
  variation: SiteVariation,
): number | null {
  if (url.foundFrom === null || url.foundKind === null || url.foundVia === null) return null
  if (otherPairs.length === 0) return null
  const varied = variation.varied({
    comparable,
    discovering: own,
    missing: other,
    discovery: {
      sourceHash: url.foundVia.urlHash,
      targetHash: url.urlHash,
      kind: url.foundKind,
      rendered: url.foundVia.rendered,
    },
    pairs: otherPairs,
    targetHash: url.urlHash,
  })
  return varied ? url.foundFrom : null
}

/**
 * One pass over the rows still `pending`. `false` (a step): settle what a source not seen either
 * explains; returns whether anything changed. `'final'`: what is left is a change of the site, named
 * through a source of its group. `'cap'`: what is left is `unknown`.
 */
async function chainPass(
  work: Database['crawls']['comparisonWork'],
  pair: { baseId: string; targetId: string },
  merged: boolean,
  end: false | 'final' | 'cap',
  signal?: AbortSignal,
): Promise<boolean> {
  let changed = false
  let after: string | null = null
  for (;;) {
    stopIfAborted(signal)
    const rows: ExplainedUrl[] = await work.pending({ ...pair, after, limit: EXPLAIN_BATCH })
    if (rows.length === 0) break
    after = rows.at(-1)!.urlHash
    const updates: ExplainedUrl[] = []
    for (const side of sides) {
      const own = rows.filter((row) => row.side === side && row.seq !== null)
      if (own.length === 0) continue
      const sources = await work.unseenSources({
        ...pair,
        side,
        seqs: own.map((row) => row.seq!),
        merged,
      })
      for (const row of own) {
        const unseen = sources
          .filter((source) => source.target === row.seq)
          .map((source) => ({
            reason:
              source.reason === 'pending' || (source.reason && isComparisonReason(source.reason))
                ? (source.reason as ComparisonReason | 'pending')
                : null,
            seq: source.seq,
          }))
        if (end === 'cap') {
          updates.push({ ...row, reason: 'unknown', detail: 'cap', through: null })
          continue
        }
        if (end === 'final') {
          const through = unseen.reduce<number | null>(
            (lowest, source) => (lowest === null || source.seq < lowest ? source.seq : lowest),
            null,
          )
          updates.push({
            ...row,
            reason: side === 'base' ? 'unlinked' : 'linked',
            detail: 'chain',
            through,
          })
          continue
        }
        const step = chainStep(side, unseen)
        if (step.reason === 'pending') continue
        updates.push({
          ...row,
          reason: step.reason,
          detail: step.reason === 'notReached' ? 'not-seen' : 'chain',
          through: step.through,
        })
      }
    }
    if (updates.length > 0) {
      changed = true
      await work.resolve({ ...pair, rows: updates })
    }
  }
  return changed
}
