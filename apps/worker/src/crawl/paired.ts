import { createHash } from 'node:crypto'
import { crawlUrlHash, isInternalUrl, normalizeCrawlUrl } from '@seotools/core'
import {
  changedFields,
  type Answer,
  type AnswerPair,
  type PairSummary,
} from '@seotools/core/crawl/paired'
import type { Crawl, Database } from '@seotools/db'
import { HTML_MEDIA_TYPE } from './response'
import { extractHtml } from './extract'
import { decodeText, FetchError } from './fetcher'
import type { Requester } from './requester'

/** Fixed-width URL identities frame the streamed digest without a delimiter. */
class Targets {
  private digest = createHash('sha256')
  readonly sample = new Map<string, string>()
  private count = 0
  add(hash: string, url: string) {
    this.digest.update(hash)
    this.count++
    if (this.sample.size < 64) this.sample.set(hash, url)
  }
  finish() {
    return { count: this.count, digest: this.digest.digest('hex'), hashes: [...this.sample.keys()] }
  }
}

/** Query values may be credentials. Keep only a numeric pagination value in display text. */
function displayUrl(url: string) {
  const parsed = new URL(url)
  const page = parsed.searchParams.get('page') ?? parsed.searchParams.get('paged')
  const suffix = page && /^\d{1,8}$/.test(page) ? `?page=${page}` : parsed.search ? '?…' : ''
  return (parsed.origin + parsed.pathname).slice(0, 200) + suffix
}

export async function repeatAnswers(input: {
  db: Database
  crawl: Crawl
  host: string
  context: string
  identity: (url: string) => string
  requester: Requester
  onCancelled: () => void
  signal: AbortSignal
}) {
  const { db, crawl, host, context, identity, requester, signal } = input
  const { eligible, rows } = await db.crawls.pairedCandidates(crawl.id)
  const pairs: AnswerPair[] = []
  const summary: PairSummary = {
    version: 1,
    eligible,
    selected: rows.length,
    comparable: 0,
    different: 0,
    unknown: {},
    examples: [],
  }
  for (const row of rows) {
    signal.throwIfAborted()
    if ((await db.crawls.get(crawl.id))?.status !== 'running') return undefined
    const facts = row.data?.facts
    const targets = new Targets()
    const original: Answer = {
      at: facts?.servedAt ?? row.fetchedAt?.toISOString() ?? '',
      status: row.statusCode,
      media: 'html',
      location: null,
      html: null,
    }
    if (
      facts?.servedTextDigest &&
      facts.servedTitleDigest &&
      facts.servedAnchors &&
      crawl.ref != null &&
      row.seq != null
    ) {
      let after = ''
      for (;;) {
        const batch = await db.crawls.servedAnchorBatch(crawl.id, crawl.ref, row.seq, after)
        for (const { hash, url } of batch) targets.add(hash, url)
        if (batch.length < 256) break
        after = batch[batch.length - 1]!.hash
      }
      const stored = targets.finish()
      const matched =
        stored.digest === facts.servedAnchors.digest && stored.count === facts.servedAnchors.count
      if (!matched) targets.sample.clear()
      original.html = {
        title: row.title?.slice(0, 160) ?? null,
        titleDigest: facts.servedTitleDigest,
        textDigest: facts.servedTextDigest,
        anchors: matched ? stored : { ...facts.servedAnchors, hashes: [] },
      }
    }
    const pair: AnswerPair = {
      version: 1,
      sourceHash: row.urlHash,
      original,
      repeat: null,
      changed: [],
      unknown: null,
      examples: [],
    }
    if (facts?.requestContext !== context) pair.unknown = 'request-context'
    else if (requester.excessiveDelay()) pair.unknown = 'retry-after'
    else {
      const response = await requester.fetchWithRetries(row.url, {
        readBody: 'auto',
        singleAttempt: true,
        beforeAttempt: async () => {
          // The crawl may have been cancelled while waiting out Retry-After.
          if ((await db.crawls.get(crawl.id))?.status !== 'running') input.onCancelled()
        },
      })
      if (response instanceof FetchError) pair.unknown = 'transport'
      else {
        const type = response.headers['content-type']?.split(';')[0]?.trim().toLowerCase() ?? null
        const html = HTML_MEDIA_TYPE.test(type ?? '')
        const redirect =
          response.statusCode >= 300 && response.statusCode < 400 && response.headers.location
            ? normalizeCrawlUrl(response.headers.location, row.url)
            : null
        const repeat: Answer = {
          at: new Date().toISOString(),
          status: response.statusCode,
          media: html ? 'html' : type ? 'other' : null,
          location: redirect ? displayUrl(redirect) : null,
          html: null,
        }
        pair.repeat = repeat
        const repeated = new Targets()
        // Only a whole 2xx page is read: an error page's links are not the page's links.
        if (
          html &&
          response.body &&
          !response.truncated &&
          response.statusCode >= 200 &&
          response.statusCode < 300 &&
          response.statusCode !== 206 &&
          response.headers['content-range'] === undefined
        ) {
          const page = extractHtml(
            decodeText(response.body, response.headers['content-type']),
            row.url,
          )
          const links = new Map<string, string>()
          for (const link of page.links) {
            if (link.kind !== 'anchor' && link.kind !== 'anchor-nofollow') continue
            const url = identity(link.url)
            if (isInternalUrl(url, host)) links.set(crawlUrlHash(url), url)
          }
          for (const hash of [...links.keys()].sort()) repeated.add(hash, links.get(hash)!)
          repeat.html = {
            title: page.title?.slice(0, 160) ?? null,
            titleDigest: page.facts.servedTitleDigest!,
            textDigest: page.facts.servedTextDigest!,
            anchors: repeated.finish(),
          }
        }
        pair.changed = changedFields(original, repeat)
        if (!pair.changed.length && !(original.html && repeat.html)) pair.unknown = 'incomplete'
        if (original.html && repeat.html && pair.changed.includes('anchors')) {
          for (const side of ['original', 'repeat'] as const) {
            const opposite = side === 'original' ? repeat.html.anchors : original.html.anchors
            if (opposite.count !== opposite.hashes.length) continue
            for (const [hash, url] of (side === 'original' ? targets : repeated).sample) {
              if (pair.examples.length < 4 && !opposite.hashes.includes(hash))
                pair.examples.push({ side, hash, label: displayUrl(url) })
            }
          }
        }
      }
    }
    // Keep observations even when untrusted display text expands during JSON escaping.
    if (Buffer.byteLength(JSON.stringify(pair)) > 16 * 1024) pair.examples = []
    pairs.push(pair)
    if (pair.unknown) summary.unknown[pair.unknown] = (summary.unknown[pair.unknown] ?? 0) + 1
    else summary.comparable++
    if (pair.changed.length) {
      summary.different++
      if (summary.examples.length < 3) summary.examples.push(row.urlHash)
    }
  }
  return { summary, pairs }
}
