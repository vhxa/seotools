import { regressionsFor } from './incident-alerts'
import {
  createVitalsClient,
  cwvCollectPayload,
  emptyVitals,
  loadVitalsKey,
  VitalsError,
  type Settings,
} from '@seotools/core'
import type { Database, VitalsRecord } from '@seotools/db'
import { ANALYSIS_WAIT_MS } from '../alerts/run'
import { recordedAuditConfig } from '../crawl/analysis'
import { recomputeAudit } from '../crawl/audit-recompute'
import { loadSite, type AuditedUrl } from '../crawl/site-audit'
import { JobDeferredError, JobInterruptedError, type JobHandler } from '../types'

let nextCrux = 0
async function delay(ms: number, _value: undefined, options: { signal: AbortSignal }) {
  if (options.signal.aborted) throw new JobInterruptedError()
  await new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer)
      reject(new JobInterruptedError())
    }
    const timer = setTimeout(() => {
      options.signal.removeEventListener('abort', abort)
      resolve()
    }, ms)
    options.signal.addEventListener('abort', abort, { once: true })
  })
}
export function createCwvCollectHandler(options: {
  db: Database
  settings: Settings
  paused: boolean
}): JobHandler {
  return async (job, ctx) => {
    const { crawlId } = cwvCollectPayload.parse(job.payload)
    const { db, settings } = options
    const crawl = await db.crawls.get(crawlId)
    if (!crawl || crawl.pruned || options.paused) return
    let checkedAt = -Infinity
    let cached: string | null | undefined
    async function allowed() {
      if (ctx.signal.aborted) throw new JobInterruptedError()
      if (Date.now() - checkedAt < 3000) return cached
      const domain = await db.domains.get(crawl!.domainId)
      const current = await db.crawls.get(crawlId)
      cached =
        (domain &&
          !domain.archivedAt &&
          current &&
          !current.pruned &&
          (await db.crawls.settings(domain.id)).collectVitals &&
          (await loadVitalsKey(settings))) ||
        null
      checkedAt = Date.now()
      return cached
    }
    const key = await allowed()
    if (!key) return
    if (!crawl.auditSnapshot || crawl.pagesByWorstIssue === null) {
      // The crawl's own analysis comes first. One that never arrives (it failed) is given up on
      // after the same wait as the alerts, instead of deferring forever.
      const finishedAt = crawl.finishedAt ?? crawl.createdAt
      if (Date.now() - finishedAt.getTime() < ANALYSIS_WAIT_MS) {
        throw new JobDeferredError(30_000, 'Waiting for crawl analysis')
      }
      ctx.log.warn({ crawlId }, 'Core Web Vitals not collected: the crawl was never analysed')
      return
    }
    const client = createVitalsClient(key)
    const state = (status: string, error: string | null = null): VitalsRecord => ({
      ...emptyVitals(),
      crawlId,
      formFactor: 'all',
      status,
      error,
      collectedAt: new Date(),
    })
    const reanalyse = async () => {
      if (!(await allowed())) return
      await recomputeAudit({
        db,
        domainId: crawl.domainId,
        crawlId,
        force: true,
        log: ctx.log,
        signal: ctx.signal,
        finalAttempt: job.attempts >= job.maxAttempts,
      })
    }
    let fieldComplete = false
    try {
      const config = recordedAuditConfig(crawl)
      const site = await loadSite(db, crawl, config)
      const priorities = await db.priorityUrls.list(crawl.domainId)
      const priority = new Set(priorities.map((url) => url.urlHash))
      const pages = selectVitalsPages(site.urls, priority)
      const home =
        site.urls.find((url) => url.internal && url.contentPage && url.parsed.pathname === '/') ??
        pages[0]
      if (!home) {
        await db.vitals.saveOrigin(state('failed', 'no-data'))
        await reanalyse()
        return
      }
      const origins = await db.vitals.origins(crawlId)
      const saved = await db.vitals.urls(crawlId)
      async function ask(request: () => Promise<ReturnType<typeof emptyVitals> | null>) {
        for (let attempt = 0; ; attempt++) {
          try {
            await delay(Math.max(0, nextCrux - Date.now()), undefined, { signal: ctx.signal })
            if (!(await allowed())) return undefined
            nextCrux = Date.now() + 500
            return await request()
          } catch (error) {
            if (ctx.signal.aborted) throw new JobInterruptedError()
            if (!(error instanceof VitalsError)) throw error
            if (error.category === 'quota') {
              const wait = error.retryAfterMs ?? 60_000
              if (attempt >= 2) throw new JobDeferredError(wait, 'Google quota exhausted')
              await delay(wait, undefined, { signal: ctx.signal })
            } else if (error.category === 'forbidden') throw error
            else return null
          }
        }
      }
      for (const formFactor of ['PHONE', 'DESKTOP'] as const) {
        if (origins.some((row) => row.formFactor === formFactor && row.status !== 'failed'))
          continue
        const metrics = await ask(() =>
          client.crux({ origin: home.parsed.origin }, formFactor, ctx.signal),
        )
        if (metrics === undefined) return
        if (!(await allowed())) return
        await db.vitals.saveOrigin({
          ...state(metrics ? 'collected' : 'no-data'),
          ...metrics,
          formFactor,
        })
      }
      for (const page of pages) {
        const urlHash = page.url.urlHash
        if (saved.some((row) => row.urlHash === urlHash && row.source === 'field')) continue
        const metrics = await ask(() => client.crux({ url: page.url.url }, 'PHONE', ctx.signal))
        if (metrics === undefined) return
        if (!(await allowed())) return
        await db.vitals.saveUrl({
          ...state(metrics ? 'collected' : 'no-data'),
          ...metrics,
          formFactor: 'PHONE',
          urlHash,
          source: 'field',
        })
      }
      await db.vitals.saveOrigin(state('collected'))
      fieldComplete = true
      for (const page of priorities.slice(0, 50)) {
        if (saved.some((row) => row.urlHash === page.urlHash && row.source === 'lab')) continue
        if (!(await allowed())) return
        const metrics = await ask(() => client.psi(page.url, ctx.signal))
        if (metrics === undefined) return
        if (!(await allowed())) return
        await db.vitals.saveUrl({
          ...state(metrics ? 'collected' : 'no-data'),
          ...metrics,
          formFactor: 'PHONE',
          urlHash: page.urlHash,
          source: 'lab',
        })
      }
      if (!(await allowed())) return
      await db.vitals.saveOrigin(state('collected'))
      await reanalyse()
      if (
        crawl.type === 'full' &&
        (await allowed()) &&
        (await regressionsFor(db, crawlId)).length
      ) {
        await db.vitals.queueAlerts(crawlId)
      }
    } catch (error) {
      if (ctx.signal.aborted || error instanceof JobInterruptedError)
        throw new JobInterruptedError()
      if (error instanceof JobDeferredError) throw error
      const category = error instanceof VitalsError ? error.category : 'network'
      if (await allowed()) {
        if (!fieldComplete) await db.vitals.saveOrigin(state('failed', category))
        await reanalyse()
      }
      throw new VitalsError(category)
    }
  }
}

export function selectVitalsPages(urls: AuditedUrl[], priority: ReadonlySet<string>) {
  return urls
    .filter((url) => url.internal && url.contentPage && url.indexable)
    .sort(
      (a, b) =>
        Number(priority.has(b.url.urlHash)) - Number(priority.has(a.url.urlHash)) ||
        (a.clickDepth ?? Infinity) - (b.clickDepth ?? Infinity) ||
        a.url.urlHash.localeCompare(b.url.urlHash),
    )
    .slice(0, 1000)
}
