import {
  EXPLANATION_VERSION,
  MAX_CHAIN_STEPS,
  RENDER_SETTINGS,
  WITNESS_SETTINGS,
  chainStep,
  classifyDifference,
  classifyLink,
  entersChain,
  identityChange,
  isComparisonReason,
  narrower,
  type ClassTally,
  type ComparisonReason,
  type ComparisonSide,
  type LinkClass,
  type PageObservation,
  type PairConditions,
} from '@seotools/core/crawl/comparison-reasons'
import { crawlUrlHash } from '@seotools/core'
import { randomUUID } from 'node:crypto'
import { ComparisonSupersededError } from './comparison-errors'
import { RENDER_BATCH, STALE_EXPLANATION_MS } from './mapping'
import { compareCrawlDiscovery } from '@seotools/core/crawl/discovery'
import { discoveryLinkVaried, type AnswerPair } from '@seotools/core/crawl/paired'
import {
  captureProvesAbsence,
  renderStateOf,
  type CaptureEvidence,
  type RenderState,
} from '@seotools/core/crawl/render-state'
import type {
  Crawl,
  Database,
  ExplainedUrl,
  InLink,
  OneSidedUrl,
  RenderRow,
  SourceCounterpart,
  StoredPage,
} from './types'

/** URLs worked out at a time: one batch and its grouped in-links are all that is held in memory. */
export const EXPLAIN_BATCH = 2000

/**
 * Whether a link missing from this render proves it was not in the page: WP1's
 * `captureProvesAbsence`, which reads one self-contained observation (the render's state and its
 * whole stored `data`: capture rule, pending work, capture delay, failed dependencies).
 */
export type CaptureTrust = (observation: CaptureEvidence) => boolean

/** For tests: no render proves anything. */
export const NO_CAPTURE_TRUST: CaptureTrust = () => false

/** What a render says, worked out once per render and kept instead of its data. */
export interface RenderEvidence {
  state: RenderState
  /** A trusted capture: a link found only after rendering that it lacks is proven absent. */
  provesAbsence: boolean
}

/**
 * A stored render row as WP1 reads it: its state by `renderStateOf` (captured when `data.capture`
 * exists, redirected when `data.redirected` is true, the served HTML cut when its row says so), and
 * whether it proves a link absent. Fails closed: `data` that does not parse to an object is a render
 * whose state is `unknown` and that proves nothing.
 */
export function renderEvidence(
  row: RenderRow,
  servedTruncated: boolean,
  captureTrust: CaptureTrust,
): RenderEvidence {
  let data: unknown
  try {
    data = JSON.parse(row.data)
  } catch {
    return { state: 'unknown', provesAbsence: false }
  }
  if (!data || typeof data !== 'object' || Array.isArray(data))
    return { state: 'unknown', provesAbsence: false }
  const stored = data as { capture?: unknown; redirected?: unknown }
  const state = renderStateOf({
    status: row.status,
    settled: row.settled,
    captured: !!stored.capture,
    truncated: row.truncated,
    redirected: stored.redirected === true,
    servedTruncated,
  })
  try {
    return { state, provesAbsence: captureTrust({ state, data: data as CaptureEvidence['data'] }) }
  } catch {
    return { state, provesAbsence: false }
  }
}

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
  /** Who is working it out (a job id, or the crawl that just ended). Each attempt adds a unique token. */
  runner: string
  /** The job that runs it (`null` inside a crawl job): one job per pair at most. */
  jobId?: string | null
  /** Default: WP1's `captureProvesAbsence`. */
  captureTrust?: CaptureTrust
  /** Default: the stored pairs (`storedSiteVariation`). */
  variation?: SiteVariation
  /**
   * What a failed attempt leaves: `queued` when the job running it will try again, otherwise
   * `failed`, asked for again from `retryAt` (default: `STALE_EXPLANATION_MS` from now).
   */
  onFailure?: { state: 'queued' } | { state: 'failed'; retryAt?: Date }
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
 * What the two crawls allow to compare, seen from `side` (the crawl that has the URLs), from their
 * recorded discovery snapshots (WP2): whatever a side did not record compares as not comparable.
 */
function conditionsOf(own: Crawl, other: Crawl): PairConditions {
  const differences = compareCrawlDiscovery(own, other)
  const differs = (settings: readonly string[]) =>
    differences.some((difference) => settings.includes(difference.setting))
  const rendered = (crawl: Crawl) => crawl.rendering?.mode === 'rendered'
  return {
    otherRendered: rendered(other),
    requestsComparable: !differs(WITNESS_SETTINGS),
    rendersComparable: rendered(own) && rendered(other) && !differs(RENDER_SETTINGS),
    depthNarrowed: narrower(
      own.discoverySettings ? own.discoverySettings.maxDepth : undefined,
      other.discoverySettings ? other.discoverySettings.maxDepth : undefined,
    ),
  }
}

/**
 * Works out why each URL that one crawl of a pair has and the other lacks differs, from what the two
 * crawls stored, and stores it (`crawl_comparison_urls`). Requests nothing. Bounded: every pass reads
 * a batch of URLs and their in-links a page at a time, never a whole crawl.
 *
 * The pair is claimed first, with a token unique to this attempt, in a transaction that checks both
 * crawls are still retained; every write is fenced by that claim, so a run taken over by another one,
 * or whose crawl was pruned, stops without writing (`superseded`). Starting again starts over.
 *
 * 1. URLs whose address is another one in the other crawl because the crawls ignore different query
 *    parameters: `merged` / `split`, with the address they have there.
 * 2. The rest, from their in-links (`classifyLink`, `classifyDifference`).
 * 3. Chains: URLs reached only through others the other crawl did not see either (`chainStep`,
 *    `entersChain`): a change of the site only through an observed entrance.
 */
export async function explainPair(options: ExplainOptions): Promise<ExplainOutcome> {
  const { db, baseId, targetId, signal } = options
  const captureTrust = options.captureTrust ?? captureProvesAbsence
  const variation = options.variation ?? storedSiteVariation(db)
  const work = db.crawls.comparisonWork
  const [base, target] = await Promise.all([db.crawls.get(baseId), db.crawls.get(targetId)])
  if (!base || !target || base.pruned || target.pruned || base.domainId !== target.domainId)
    return 'not-comparable'
  const runner = `${options.runner}:${randomUUID()}`
  const pair = { baseId, targetId }
  const claim = { ...pair, runner }
  if (
    !(await work.begin({
      ...claim,
      version: EXPLANATION_VERSION,
      jobId: options.jobId ?? null,
    }))
  )
    return 'not-comparable'
  // WP3's witness only between completed crawls whose requests were made alike.
  const witnessComparable =
    base.status === 'completed' &&
    target.status === 'completed' &&
    conditionsOf(base, target).requestsComparable
  const crawlOf = { base, target }
  const otherOf = (side: ComparisonSide) => (side === 'base' ? target : base)

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
              ...emptyRow(side, url.urlHash, url.seq),
              reason: side === 'base' ? 'merged' : 'split',
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
          await work.save({ ...claim, rows })
        }
      }

      // 1b. The address they became, when only the other crawl has it: the same setting explains it.
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
            ...claim,
            rows: found.map((into) => {
              // One of the addresses that became it, named in the sentence.
              const from = rows.find((row) => row.intoHash === into.urlHash)!
              return {
                ...emptyRow(otherSide, into.urlHash, into.seq),
                reason: from.reason,
                detail: 'into',
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
      const conditions = conditionsOf(own, other)
      const limitNarrowed = narrower(
        own.discoverySettings ? own.discoverySettings.maxUrls : undefined,
        other.discoverySettings ? other.discoverySettings.maxUrls : undefined,
      )
      let after: string | null = null
      // Each linking page in both crawls, and each render's evidence, kept across batches of this
      // side (a page that links everything is read once), up to a bound.
      const cache: Caches = { pages: new Map(), renders: { own: new Map(), other: new Map() } }
      for (;;) {
        stopIfAborted(signal)
        // Undecided only (pass 1 decided the merged ones), by `url_hash` after the last batch.
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
        const classes = await classesOf({
          work,
          pair,
          side,
          crawls: { own, other },
          seqs,
          merged,
          conditions,
          captureTrust,
          cache,
        })
        const rows = urls.map((url): ExplainedUrl => {
          const byClass = (url.seq !== null && classes.get(url.seq)) || {}
          const varied = variedSource(url, own, other, otherPairs, witnessComparable, variation)
          const explanation = classifyDifference({
            side,
            source: url.source,
            classes: byClass,
            otherIncomplete: other.status === 'incomplete',
            limitNarrowed,
            depthNarrowed: conditions.depthNarrowed,
            varied,
            numbered: url.seq !== null && own.ref !== null,
          })
          return {
            ...emptyRow(side, url.urlHash, url.seq),
            reason: explanation.reason,
            detail: explanation.detail,
            via: explanation.via,
            viaKind: explanation.viaKind,
            viaRendered: explanation.viaRendered,
            sources: explanation.sources,
            unseen: byClass['not-seen']?.count ?? 0,
          }
        })
        await work.save({ ...claim, rows })
      }
    }

    // 3. Chains, to a fixpoint: what is not reached through a source that was not reached either.
    let settled = false
    for (let step = 0; step < (options.maxChainSteps ?? MAX_CHAIN_STEPS) && !settled; step++) {
      settled = !(await chainPass(work, claim, 'step', signal))
    }
    if (settled) {
      // An observed entrance into each group that is left, followed to a fixpoint as well.
      let entering = true
      for (let step = 0; step < (options.maxChainSteps ?? MAX_CHAIN_STEPS) && entering; step++) {
        entering = await chainPass(work, claim, 'enter', signal)
      }
    }
    // What is left is a change of the site only when entered; otherwise, and at the cap, unknown.
    await chainPass(work, claim, settled ? 'final' : 'cap', signal)

    const finished = await work.finish({ ...claim, state: 'done' })
    return finished ? 'done' : 'superseded'
  } catch (error) {
    if (error instanceof ComparisonSupersededError) return 'superseded'
    const failure = options.onFailure ?? { state: 'failed' as const }
    await work
      .finish({
        ...claim,
        state: failure.state,
        retryAt:
          failure.state === 'failed'
            ? (failure.retryAt ?? new Date(Date.now() + STALE_EXPLANATION_MS))
            : null,
      })
      .catch(() => undefined)
    throw error
  }
}

const emptyRow = (side: ComparisonSide, urlHash: string, seq: number | null): ExplainedUrl => ({
  side,
  urlHash,
  seq,
  reason: 'unknown',
  detail: null,
  via: null,
  viaKind: null,
  viaRendered: null,
  through: null,
  sources: 0,
  unseen: 0,
  intoHash: null,
  intoUrl: null,
  intoPresent: null,
})

/** Linking pages whose observations are kept between batches of a side: a bound on memory. */
export const COUNTERPART_CACHE = 200_000

interface Caches {
  pages: Map<number, SourceCounterpart>
  /** Render evidence by URL hash in each crawl; `null`: no render. */
  renders: { own: Map<string, RenderEvidence | null>; other: Map<string, RenderEvidence | null> }
}

/** In-links read at a time: the page of plain rows held in memory with one batch of URLs. */
export const LINK_PAGE = 50_000

const toObservation = (
  page: StoredPage,
  render: RenderEvidence | null | undefined,
): PageObservation => ({
  state: page.state,
  kind: page.kind,
  statusCode: page.statusCode,
  notRequested: page.notRequested,
  servedTruncated: page.servedTruncated,
  renderState: render?.state ?? null,
  renderTrusted: render?.provesAbsence ?? false,
})

/**
 * The in-links of a batch of URLs, by class (`classifyLink`). Links are read as plain numbers, a page
 * at a time; each linking page is looked up in both crawls once per side, and a render only for the
 * pages whose links were found after rendering, `RENDER_BATCH` rows at a time, each group parsed into
 * its evidence and dropped.
 */
async function classesOf(input: {
  work: Database['crawls']['comparisonWork']
  pair: { baseId: string; targetId: string }
  side: ComparisonSide
  crawls: { own: Crawl; other: Crawl }
  seqs: number[]
  merged: boolean
  conditions: PairConditions
  captureTrust: CaptureTrust
  cache: Caches
}): Promise<Map<number, Partial<Record<LinkClass, ClassTally>>>> {
  const { work, pair, side, seqs, merged, conditions, captureTrust, cache } = input
  const classes = new Map<number, Partial<Record<LinkClass, ClassTally>>>()
  let after: { target: number; source: number; kind: string } | null = null
  for (;;) {
    const links: InLink[] = await work.inLinks({ ...pair, side, seqs, after, limit: LINK_PAGE })
    if (links.length === 0) break
    const last = links.at(-1)!
    after = { target: last.target, source: last.source, kind: last.kind }
    const unknown = [...new Set(links.map((link) => link.source))].filter(
      (seq) => !cache.pages.has(seq),
    )
    // Bounded: past the cap it starts again, which costs lookups, never memory.
    if (cache.pages.size + unknown.length > COUNTERPART_CACHE) cache.pages.clear()
    for (const found of await work.counterparts({ ...pair, side, sources: unknown, merged }))
      cache.pages.set(found.source, found)
    await readRenders(links, input)
    for (const link of links) {
      const page = cache.pages.get(link.source)
      if (!page) continue
      const name = classifyLink({
        rendered: link.rendered,
        kind: link.kind,
        own: toObservation(page.own, cache.renders.own.get(page.own.urlHash)),
        other: page.other && toObservation(page.other, cache.renders.other.get(page.other.urlHash)),
        identityChanged: page.identityChanged,
        conditions,
      })
      const byClass = classes.get(link.target) ?? {}
      const found = byClass[name]
      byClass[name] =
        found && found.via <= link.source
          ? { ...found, count: found.count + 1 }
          : {
              count: (found?.count ?? 0) + 1,
              via: link.source,
              kind: link.kind,
              rendered: link.rendered,
            }
      classes.set(link.target, byClass)
    }
    if (links.length < LINK_PAGE) break
  }
  return classes

  /** The renders these rendered links need, on both sides, read and parsed a group at a time. */
  async function readRenders(links: InLink[], { crawls: pairCrawls }: typeof input) {
    if (!conditions.otherRendered) return
    const wanted = { own: new Map<string, boolean>(), other: new Map<string, boolean>() }
    for (const link of links) {
      if (!link.rendered) continue
      const page = cache.pages.get(link.source)
      if (!page) continue
      if (!cache.renders.own.has(page.own.urlHash))
        wanted.own.set(page.own.urlHash, page.own.servedTruncated)
      if (page.other && !cache.renders.other.has(page.other.urlHash))
        wanted.other.set(page.other.urlHash, page.other.servedTruncated)
    }
    for (const which of ['own', 'other'] as const) {
      const store = cache.renders[which]
      const hashes = [...wanted[which].keys()]
      if (store.size + hashes.length > COUNTERPART_CACHE) store.clear()
      for (let i = 0; i < hashes.length; i += RENDER_BATCH) {
        const group = hashes.slice(i, i + RENDER_BATCH)
        const rows = await work.renders({
          ...pair,
          crawlId: pairCrawls[which].id,
          urlHashes: group,
        })
        for (const row of rows)
          store.set(
            row.urlHash,
            renderEvidence(row, wanted[which].get(row.urlHash) ?? false, captureTrust),
          )
        for (const urlHash of group) if (!store.has(urlHash)) store.set(urlHash, null)
      }
    }
  }
}

/**
 * WP3: the `seq` of the page whose link to U is witnessed as varying in the crawl that lacks U, which
 * only WP3's direction-matched witness may say (an actual served anchor, its original answer lacking
 * U and its repeat having it, both whole 2xx). `null`: no witness.
 */
function variedSource(
  url: OneSidedUrl,
  own: Crawl,
  other: Crawl,
  otherPairs: unknown[],
  comparable: boolean,
  variation: SiteVariation,
): number | null {
  // The discovering link must have been stored: an unknown edge is never taken for a served one.
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
 * One pass over the rows still `pending`.
 * - `step`: settle what a source not seen either explains (`chainStep`); returns whether anything
 *   changed.
 * - `enter`: mark (`detail: 'entered'`) the rows with an observed entrance (`entersChain`); returns
 *   whether anything changed.
 * - `final`: entered rows are a change of the site, named through a source of their group; the rest
 *   (a closed group no observed link enters) is `unknown`.
 * - `cap`: still moving at the cap: `unknown`.
 */
async function chainPass(
  work: Database['crawls']['comparisonWork'],
  claim: { baseId: string; targetId: string; runner: string },
  pass: 'step' | 'enter' | 'final' | 'cap',
  signal?: AbortSignal,
): Promise<boolean> {
  let changed = false
  let after: string | null = null
  const pair = { baseId: claim.baseId, targetId: claim.targetId }
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
      })
      for (const row of own) {
        const unseen = sources
          .filter((source) => source.target === row.seq)
          .map((source) => ({
            reason:
              source.reason === 'pending' || (source.reason && isComparisonReason(source.reason))
                ? (source.reason as ComparisonReason | 'pending')
                : null,
            entered: source.detail === 'entered',
            seq: source.seq,
          }))
        const entered = row.detail === 'entered'
        if (pass === 'cap') {
          updates.push({ ...row, reason: 'unknown', detail: 'cap', through: null })
        } else if (pass === 'enter') {
          if (!entered && entersChain(side, row.via !== null, unseen))
            updates.push({ ...row, detail: 'entered' })
        } else if (pass === 'final') {
          if (!entered) {
            updates.push({ ...row, reason: 'unknown', detail: 'cycle', through: null })
            continue
          }
          const through = unseen.reduce<number | null>(
            (lowest, source) => (lowest === null || source.seq < lowest ? source.seq : lowest),
            null,
          )
          updates.push({
            ...row,
            reason: side === 'base' ? 'unlinked' : 'linked',
            detail: through === null ? null : 'chain',
            through,
          })
        } else {
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
    }
    if (updates.length > 0) {
      changed = true
      await work.resolve({ ...claim, rows: updates })
    }
  }
  return changed
}
