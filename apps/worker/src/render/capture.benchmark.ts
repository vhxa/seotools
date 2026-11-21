import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  createLogger,
  DEFAULT_CRAWL_SETTINGS,
  defaultCrawlerUserAgent,
  normalizeCrawlUrl,
} from '@seotools/core'
import { CAPTURE_DELAY_TOLERANCE_MS } from '@seotools/core/crawl/render-state'
import { extractHtml } from '../crawl/extract'
import { createHttpFetcher, decodeText, FetchError } from '../crawl/fetcher'
import { createRequester } from '../crawl/requester'
import { MAX_ROBOTS_BYTES } from '../crawl/response'
import { renderRobots } from '../crawl/rendering'
import { createRenderResourceCache } from './cache'
import { RENDER_LIMITS } from './limits'
import { createRenderService } from './service'
import { createSlots } from './slots'

const host = 'beaire.com'
const origin = `https://${host}`
const targets = readFileSync(new URL('./capture-benchmark-paths.txt', import.meta.url), 'utf8')
  .trim()
  .split('\n')
  .map((path) => normalizeCrawlUrl(path, origin))
  .filter((url): url is string => !!url && new URL(url).origin === origin)
const comparisonRules = [
  ['network-quiet', 0],
  ['full-window', Infinity],
  ['minimum-2500ms', 2500],
] as const
const [, , browserUrl, mode, ...extraArgs] = process.argv
if (!browserUrl || (mode !== undefined && mode !== '--single-pass') || extraArgs.length > 0)
  throw new Error('Usage: capture.benchmark.ts <isolated browser CDP URL> [--single-pass]')
const singlePass = mode === '--single-pass'
const rules = singlePass ? [comparisonRules[1]] : comparisonRules
const { concurrency } = DEFAULT_CRAWL_SETTINGS
const userAgent = defaultCrawlerUserAgent()
const log = createLogger('capture-benchmark', 'silent')
const signal = new AbortController().signal
const hash = (value: string | Buffer) => createHash('sha256').update(value).digest('hex')

interface Observation {
  url: string
  durationMs: number | null
  status: string
  captureDelayMs?: number | null
  failedRequests?: number
  servedHash?: string
  servedTextHash?: string | null
  renderedHash?: string | null
  anchorsHash?: string
}

const observations = new Map(rules.map(([rule]) => [rule, new Map<string, Observation[]>()]))
for (let round = 0; round < (singlePass ? 1 : 3); round++) {
  // Rotate rule order to reduce the effects of warming or a deployment mid-benchmark.
  for (let offset = 0; offset < rules.length; offset++) {
    const [rule, minQuietCaptureMs] = rules[(round + offset) % rules.length]!
    const service = createRenderService({
      browserUrl,
      concurrency,
      minQuietCaptureMs,
      writeStatus: async () => {},
    })
    const resourceSlots = createSlots(RENDER_LIMITS.pageResources * concurrency)
    const fetcher = createHttpFetcher({
      userAgent,
      timeoutMs: DEFAULT_CRAWL_SETTINGS.timeoutMs,
      concurrency: concurrency + RENDER_LIMITS.pageResources * concurrency,
      allowPrivateNetworks: false,
    })
    const requester = createRequester({
      fetcher,
      settings: DEFAULT_CRAWL_SETTINGS,
      signal,
      retryBaseMs: 1000,
      log,
    })
    const cache = createRenderResourceCache()
    try {
      const browser = await service.check()
      if (browser.state !== 'ready') throw new Error(JSON.stringify(browser))
      const robots = await requester.fetchWithRetries(`${origin}/robots.txt`, {
        readBody: 'force',
        maxBytes: MAX_ROBOTS_BYTES,
      })
      const allowedByRobots = renderRobots({
        robots:
          robots instanceof FetchError
            ? {}
            : {
                [origin]: {
                  status: robots.statusCode,
                  body: robots.body?.toString('utf8') ?? null,
                },
              },
      })

      async function measure(url: string): Promise<Observation> {
        const document = await requester.fetchWithRetries(url, { readBody: 'auto' })
        if (document instanceof FetchError) return { url, durationMs: null, status: document.code }
        const contentType = document.headers['content-type']
        if (document.statusCode !== 200 || !document.body || !contentType?.includes('text/html'))
          return { url, durationMs: null, status: `HTTP ${document.statusCode}` }
        const outcome = await service.render({
          url,
          host,
          userAgent,
          document,
          requester,
          cache,
          allowedByRobots,
          ignoredParameters: ['duration'],
          resourceSlots,
          signal,
        })
        const result: Observation = {
          url,
          durationMs: outcome.durationMs,
          captureDelayMs: outcome.captureDelayMs,
          failedRequests: outcome.requests.failedCount,
          status: outcome.redirected ? 'redirect' : outcome.truncated ? 'cut' : outcome.status,
          servedHash: hash(document.body),
        }
        if (result.status === 'rendered') {
          const served = extractHtml(decodeText(document.body, contentType), url)
          const rendered = extractHtml(outcome.html, url)
          result.servedTextHash = served.facts.textHash
          result.renderedHash = rendered.facts.textHash
          result.anchorsHash = hash(
            JSON.stringify(
              [
                ...new Set(
                  rendered.links
                    .filter(({ kind }) => kind.startsWith('anchor'))
                    .map(({ kind, url }) => `${kind} ${url}`),
                ),
              ].sort(),
            ),
          )
        }
        return result
      }

      const target = targets.values()
      await Promise.all(
        Array.from({ length: concurrency }, async () => {
          for (const url of target) {
            const row = await measure(url)
            console.log(JSON.stringify({ rule, round: round + 1, ...row }))
            const group = observations.get(rule)!
            const previous = group.get(url) ?? []
            previous.push(row)
            group.set(url, previous)
          }
        }),
      )
    } finally {
      fetcher.close()
      await service.close()
    }
  }
}

for (const [rule, rows] of observations) {
  const comparable = [...rows.values()].filter((row) => row.every((r) => r.status === 'rendered'))
  const same = (row: Observation[]) =>
    row.every(
      (r) => r.renderedHash === row[0]!.renderedHash && r.anchorsHash === row[0]!.anchorsHash,
    )
  const durations = [...rows.values()]
    .flatMap((row) => row.flatMap(({ durationMs }) => (durationMs === null ? [] : [durationMs])))
    .sort((a, b) => a - b)
  const percentile = (p: number) => durations[Math.ceil(durations.length * p) - 1] ?? null
  const sameServed = comparable.filter((row) =>
    row.every((r) => r.servedHash === row[0]!.servedHash),
  )
  const delayed = [...rows.values()]
    .flat()
    .filter(({ captureDelayMs }) => (captureDelayMs ?? 0) > CAPTURE_DELAY_TOLERANCE_MS)
  console.log(
    JSON.stringify({
      rule,
      total: targets.length,
      comparable: comparable.length,
      ...(singlePass
        ? { delayedCaptures: delayed.length }
        : {
            identical: comparable.filter(same).length,
            sameServed: sameServed.length,
            identicalWhenSameServed: sameServed.filter(same).length,
          }),
      medianMs: percentile(0.5),
      p95Ms: percentile(0.95),
    }),
  )
}
