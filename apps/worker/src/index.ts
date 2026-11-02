import { hostname } from 'node:os'
import { randomBytes } from 'node:crypto'
import {
  EnvError,
  JOB_TYPES,
  WORKER_HEARTBEAT_INTERVAL_MS,
  createLogger,
  createSettings,
  getMailer,
  parseWorkerEnv,
  settingsKeyFrom,
} from '@seotools/core'
import { createDatabase } from '@seotools/db'
import pkg from '../package.json' with { type: 'json' }
import { createCrawlFileRefresher } from './crawl/file-refresher'
import { createHttpFetcher } from './crawl/fetcher'
import { reanalyseOutdatedCrawls } from './crawl/reanalysis'
import { createFaviconRefresher } from './favicon/refresh'
import { handlers } from './handlers'
import { createCrawlRunHandler } from './handlers/crawl-run'
import { createRunner } from './runner'
import { runDueSchedules } from './scheduler'

/** How often due schedules, favicon and crawl file checks are looked for. Nothing is to the second. */
const SCHEDULER_INTERVAL_MS = 30_000

async function main() {
  const env = parseWorkerEnv()
  const log = createLogger('worker', env.LOG_LEVEL)
  const db = await createDatabase({ url: env.DATABASE_URL, dialect: env.DATABASE_DIALECT })
  const settings = createSettings(db.settings, settingsKeyFrom(env))

  const workerId = `${hostname()}-${process.pid}-${randomBytes(2).toString('hex')}`
  const startedAt = new Date()
  const beat = () =>
    db.heartbeats
      .beat({ workerId, startedAt })
      .catch((err) => log.error({ err }, 'heartbeat failed'))
  await beat()
  const heartbeat = setInterval(beat, WORKER_HEARTBEAT_INTERVAL_MS)

  const shared = {
    db,
    workerId,
    getMailer: () => getMailer(settings),
    pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
    lockTimeoutMs: env.JOB_LOCK_TIMEOUT_MS,
  }
  const crawlTypes = [JOB_TYPES.crawlRun]
  const runner = createRunner({
    ...shared,
    log,
    handlers,
    concurrency: env.WORKER_CONCURRENCY,
    excludeTypes: crawlTypes,
  })
  // A crawl can take hours, so crawls get slots of their own: they must not hold up other jobs.
  const crawlRunner = createRunner({
    ...shared,
    log: log.child({ lane: 'crawl' }),
    handlers: {
      [JOB_TYPES.crawlRun]: createCrawlRunHandler({
        db,
        allowPrivateNetworks: env.CRAWLER_ALLOW_PRIVATE_NETWORKS,
        appVersion: pkg.version,
      }),
    },
    concurrency: env.CRAWL_CONCURRENCY,
    types: crawlTypes,
  })
  runner.start()
  crawlRunner.start()

  const tickScheduler = () =>
    runDueSchedules(db, log).catch((err) => log.error({ err }, 'crawl scheduler failed'))
  void tickScheduler()
  const scheduler = setInterval(tickScheduler, SCHEDULER_INTERVAL_MS)

  // Icons are looked for on the same beat as schedules: cheap when nothing is due.
  const createFetcher: Parameters<typeof createFaviconRefresher>[0]['createFetcher'] = (config) =>
    createHttpFetcher({ ...config, allowPrivateNetworks: env.CRAWLER_ALLOW_PRIVATE_NETWORKS })
  const favicons = createFaviconRefresher({
    db,
    log: log.child({ lane: 'favicon' }),
    appVersion: pkg.version,
    createFetcher,
  })
  void favicons.tick()
  const faviconTimer = setInterval(() => void favicons.tick(), SCHEDULER_INTERVAL_MS)

  const crawlFiles = createCrawlFileRefresher({
    db,
    log: log.child({ lane: 'crawl-files' }),
    appVersion: pkg.version,
    createFetcher,
  })
  void crawlFiles.tick()
  const crawlFilesTimer = setInterval(() => void crawlFiles.tick(), SCHEDULER_INTERVAL_MS)

  // After an update that changes the issues, earlier crawls show their old totals until this is done.
  let stopping = false
  const reanalysis = reanalyseOutdatedCrawls({
    db,
    log: log.child({ lane: 'analysis' }),
    stopped: () => stopping,
  }).catch((err) => log.error({ err }, 'analysing crawls again failed'))

  const shutdown = async (signal: string) => {
    if (stopping) return
    stopping = true
    log.info({ signal }, 'shutting down')
    clearInterval(heartbeat)
    clearInterval(scheduler)
    clearInterval(faviconTimer)
    clearInterval(crawlFilesTimer)
    // Crawls resume from their stored queue, so they don't need the grace period to finish.
    await Promise.all([
      runner.stop(),
      crawlRunner.stop(0),
      favicons.stop(),
      crawlFiles.stop(),
      reanalysis,
    ])
    await db.close()
    process.exit(0)
  }
  process.on('SIGTERM', () => void shutdown('SIGTERM'))
  process.on('SIGINT', () => void shutdown('SIGINT'))
}

main().catch((error) => {
  console.error(error instanceof EnvError ? error.message : error)
  process.exit(1)
})
