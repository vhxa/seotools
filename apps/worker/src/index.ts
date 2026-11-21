import { createIncidentAlertsHandler, createVitalsAlertsHandler } from './handlers/incident-alerts'
import { randomBytes } from 'node:crypto'
import { hostname } from 'node:os'
import {
  DEFAULT_CRAWL_SETTINGS,
  EnvError,
  JOB_TYPES,
  MAIL_DELIVERIES_KEEP,
  MAIL_DELIVERIES_MAX_AGE_MS,
  WORKER_HEARTBEAT_INTERVAL_MS,
  createLogger,
  createSettings,
  MAIL_PAUSED,
  getMailer,
  unavailableMailer,
  parseWorkerEnv,
  settingsKeyFrom,
} from '@seotools/core'
import { createDatabase } from '@seotools/db'
import { getWorkerBuildInfo } from './build-info'
import { createMigrationCheck } from './migration-check'
import { createHttpFetcher } from './crawl/fetcher'
import { createCrawlFileRefresher } from './crawl/file-refresher'
import { reanalyseOutdatedCrawls } from './crawl/reanalysis'
import { createFaviconRefresher } from './favicon/refresh'
import { handlers, createBotTestHandler } from './handlers'
import { createAccessEmailHandler } from './handlers/access-email'
import { createAuditRecomputeHandler } from './handlers/audit-recompute'
import { createCrawlAlertsHandler } from './handlers/crawl-alerts'
import { createCompareExplainHandler } from './handlers/compare-explain'
import { requestLatestExplanations } from './crawl/explain'
import { createCrawlRunHandler } from './handlers/crawl-run'
import { createCwvCollectHandler } from './handlers/cwv-collect'
import { createMailSendHandler } from './handlers/mail-send'
import { createUrlVerifyHandler } from './handlers/url-verify'
import { startRenderRuntime } from './render/runtime'
import { createRunner } from './runner'
import { runDueSchedules } from './scheduler'
import { createUpdateChecker } from './updates/update-checker'

/** How often due schedules, favicon and crawl file checks are looked for. Nothing is to the second. */
const SCHEDULER_INTERVAL_MS = 30_000
/** How often the record of sent email is trimmed. */
const PRUNE_INTERVAL_MS = 60 * 60_000
/** Finished jobs are only a trace; completed ones go after 30 days, failed ones (to diagnose) after 90. */
const COMPLETED_JOBS_MAX_AGE_MS = 30 * 24 * 60 * 60_000
const FAILED_JOBS_MAX_AGE_MS = 90 * 24 * 60 * 60_000

async function main() {
  const env = parseWorkerEnv()
  const log = createLogger('worker', env.LOG_LEVEL)
  const db = await createDatabase({ url: env.DATABASE_URL, dialect: env.DATABASE_DIALECT })
  const build = getWorkerBuildInfo()
  const migrationCheck = createMigrationCheck(db, log)
  const ifCurrent = (work: () => Promise<unknown>) => async () => {
    if (await migrationCheck.canStart()) await work()
  }
  const settings = createSettings(db.settings, settingsKeyFrom(env))
  const paused = env.SEOTOOLS_PAUSE_AUTOMATION
  if (paused) {
    log.warn(
      'SEOTOOLS_PAUSE_AUTOMATION is set: no scheduled crawls, refreshers, update checks or email will run',
    )
  }

  const rendering = await startRenderRuntime({
    browserUrl: env.RENDER_BROWSER_URL,
    concurrency: env.RENDER_CONCURRENCY,
    settings,
    paused,
    canStart: migrationCheck.canStart,
    onError: (err) => log.error({ err }, 'browser check failed'),
  })

  const workerId = `${hostname()}-${process.pid}-${randomBytes(2).toString('hex')}`
  const startedAt = new Date()
  const beat = async () => {
    await migrationCheck.canStart()
    await db.heartbeats
      .beat({ workerId, startedAt, build, outdated: migrationCheck.isOutdated() })
      .catch((err) => log.error({ err }, 'heartbeat failed'))
  }
  await beat()
  const heartbeat = setInterval(beat, WORKER_HEARTBEAT_INTERVAL_MS)

  const shared = {
    db,
    workerId,
    canStart: migrationCheck.canStart,
    getMailer: async () =>
      paused ? unavailableMailer(MAIL_PAUSED, { retry: false }) : getMailer(settings),
    pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
    lockTimeoutMs: env.JOB_LOCK_TIMEOUT_MS,
  }
  // Both make requests to a site, so both run in the crawl lane.
  const crawlTypes = [JOB_TYPES.crawlRun, JOB_TYPES.urlVerify, JOB_TYPES.botTest]
  const runner = createRunner({
    ...shared,
    log,
    handlers: {
      ...handlers,
      ...rendering.handlers,
      [JOB_TYPES.auditRecompute]: createAuditRecomputeHandler({ db }),
      [JOB_TYPES.accessEmail]: createAccessEmailHandler({ db, publicUrl: env.BETTER_AUTH_URL }),
      [JOB_TYPES.incidentAlerts]: createIncidentAlertsHandler({
        db,
        publicUrl: env.BETTER_AUTH_URL,
      }),
      [JOB_TYPES.vitalsAlerts]: createVitalsAlertsHandler({ db, publicUrl: env.BETTER_AUTH_URL }),
      [JOB_TYPES.crawlAlerts]: createCrawlAlertsHandler({ db, publicUrl: env.BETTER_AUTH_URL }),
      [JOB_TYPES.mailSend]: createMailSendHandler({ db }),
      [JOB_TYPES.compareExplain]: createCompareExplainHandler({ db }),
    },
    concurrency: env.WORKER_CONCURRENCY,
    excludeTypes: [...crawlTypes, JOB_TYPES.cwvCollect],
  })
  // A crawl can take hours, so crawls get slots of their own: they must not hold up other jobs.
  const crawlRunner = createRunner({
    ...shared,
    log: log.child({ lane: 'crawl' }),
    handlers: {
      [JOB_TYPES.crawlRun]: createCrawlRunHandler({
        renderService: rendering.service,
        db,
        allowPrivateNetworks: env.CRAWLER_ALLOW_PRIVATE_NETWORKS,
        appVersion: build.version,
        settingsSecret: settingsKeyFrom(env),
      }),
      [JOB_TYPES.botTest]: createBotTestHandler({
        db,
        paused,
        allowPrivateNetworks: env.CRAWLER_ALLOW_PRIVATE_NETWORKS,
        appVersion: build.version,
        settingsSecret: settingsKeyFrom(env),
      }),
      [JOB_TYPES.urlVerify]: createUrlVerifyHandler({
        db,
        allowPrivateNetworks: env.CRAWLER_ALLOW_PRIVATE_NETWORKS,
        appVersion: build.version,
        settingsSecret: settingsKeyFrom(env),
      }),
    },
    concurrency: env.CRAWL_CONCURRENCY,
    types: crawlTypes,
  })
  const vitalsRunner = createRunner({
    ...shared,
    log: log.child({ lane: 'vitals' }),
    handlers: { [JOB_TYPES.cwvCollect]: createCwvCollectHandler({ db, settings, paused }) },
    concurrency: 1,
    types: [JOB_TYPES.cwvCollect],
  })
  vitalsRunner.start()
  runner.start()
  crawlRunner.start()

  const tickScheduler = ifCurrent(() =>
    runDueSchedules(db, log, new Date(), { paused }).catch((err) =>
      log.error({ err }, 'crawl scheduler failed'),
    ),
  )
  // The record of sent email is capped by count and age, so it cannot grow forever.
  const pruneDeliveries = ifCurrent(() =>
    db.incidents
      .prune(new Date(Date.now() - 90 * 86400000))
      .then(() =>
        db.mail.prune({
          before: new Date(Date.now() - MAIL_DELIVERIES_MAX_AGE_MS),
          keep: MAIL_DELIVERIES_KEEP,
        }),
      )
      .then(() =>
        // The compact history of old crawls goes after its domain's days, crawl or no crawl.
        db.crawls.expireHistory({
          now: new Date(),
          defaultDays: DEFAULT_CRAWL_SETTINGS.historyDays ?? 30,
        }),
      )
      .catch((err) => log.error({ err }, 'could not prune the record of sent email or old history'))
      .then(() =>
        db.jobs.prune({
          finishedBefore: new Date(Date.now() - COMPLETED_JOBS_MAX_AGE_MS),
          failedBefore: new Date(Date.now() - FAILED_JOBS_MAX_AGE_MS),
        }),
      )
      .catch((err) => log.error({ err }, 'could not prune finished jobs')),
  )
  void pruneDeliveries()
  const deliveriesTimer = setInterval(() => void pruneDeliveries(), PRUNE_INTERVAL_MS)
  void tickScheduler()
  const scheduler = setInterval(tickScheduler, SCHEDULER_INTERVAL_MS)

  // Icons are looked for on the same beat as schedules: cheap when nothing is due.
  const createFetcher: Parameters<typeof createFaviconRefresher>[0]['createFetcher'] = (config) =>
    createHttpFetcher({ ...config, allowPrivateNetworks: env.CRAWLER_ALLOW_PRIVATE_NETWORKS })
  const favicons = createFaviconRefresher({
    db,
    log: log.child({ lane: 'favicon' }),
    appVersion: build.version,
    settingsSecret: settingsKeyFrom(env),
    createFetcher,
    paused,
  })
  const tickFavicons = ifCurrent(favicons.tick)
  void tickFavicons()
  const faviconTimer = setInterval(tickFavicons, SCHEDULER_INTERVAL_MS)

  const crawlFiles = createCrawlFileRefresher({
    db,
    log: log.child({ lane: 'crawl-files' }),
    appVersion: build.version,
    settingsSecret: settingsKeyFrom(env),
    createFetcher,
    paused,
  })
  const tickCrawlFiles = ifCurrent(crawlFiles.tick)
  void tickCrawlFiles()
  const crawlFilesTimer = setInterval(tickCrawlFiles, SCHEDULER_INTERVAL_MS)

  // Only if an administrator asked for it: otherwise this reads one setting and returns.
  const updates = createUpdateChecker({ settings, log: log.child({ lane: 'updates' }), paused })
  const tickUpdates = ifCurrent(updates.tick)
  void tickUpdates()
  const updatesTimer = setInterval(tickUpdates, SCHEDULER_INTERVAL_MS)

  // After an update that changes the issues, earlier crawls show their old totals until this is done.
  let stopping = false
  const reanalysis = reanalyseOutdatedCrawls({
    db,
    log: log.child({ lane: 'analysis' }),
    stopped: () => stopping,
    canStart: migrationCheck.canStart,
  }).catch((err) => log.error({ err }, 'analysing crawls again failed'))
  // Pairs crawled before this version, or explained with older rules, get their reasons.
  const explanations = requestLatestExplanations({
    db,
    log: log.child({ lane: 'comparison' }),
    stopped: () => stopping,
  }).catch((err) => log.error({ err }, 'asking for comparisons to be explained failed'))

  const shutdown = async (signal: string) => {
    if (stopping) return
    stopping = true
    log.info({ signal }, 'shutting down')
    clearInterval(heartbeat)
    clearInterval(scheduler)
    clearInterval(deliveriesTimer)
    clearInterval(faviconTimer)
    clearInterval(crawlFilesTimer)
    clearInterval(updatesTimer)
    // Crawls resume from their stored queue, so they don't need the grace period to finish.
    await Promise.all([
      runner.stop(),
      crawlRunner.stop(0),
      vitalsRunner.stop(0),
      favicons.stop(),
      crawlFiles.stop(),
      updates.stop(),
      rendering.stop(),
      reanalysis,
      explanations,
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
