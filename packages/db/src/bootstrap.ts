import { DEFAULT_CRAWL_SETTINGS, createLogger, type BootstrapEnv } from '@seotools/core'
import { createDatabase } from './client'
import type { Database } from './types'

/**
 * Applies every domain's retention now, so that an update that changed it (0.2.0 keeps the full
 * results of two crawls and a compact history) takes effect on start, not at each domain's next
 * crawl. Returns how many crawls lost their full results.
 */
async function applyRetention(db: Database): Promise<number> {
  let pruned = 0
  for (const company of await db.companies.list()) {
    for (const domain of company.domains) {
      // An archived domain keeps everything it had, as it was.
      if (domain.archivedAt) continue
      const { retainCrawls } = await db.crawls.settings(domain.id)
      for (const type of ['full', 'priority'] as const) {
        pruned += await db.crawls.prune({ domainId: domain.id, type, keep: retainCrawls })
      }
    }
  }
  await db.crawls.expireHistory({
    now: new Date(),
    defaultDays: DEFAULT_CRAWL_SETTINGS.historyDays ?? 30,
  })
  return pruned
}

/** Runs on every start: applies pending migrations. */
export async function bootstrap(env: BootstrapEnv) {
  const log = createLogger('bootstrap', env.LOG_LEVEL)
  const db = await createDatabase({ url: env.DATABASE_URL, dialect: env.DATABASE_DIALECT })
  try {
    log.info({ dialect: db.dialect }, 'database selected')
    await db.checkMigrations()
    if (env.RUN_MIGRATIONS) {
      await db.migrate()
      log.info({ dialect: db.dialect }, 'migrations applied')
      const pruned = await applyRetention(db)
      if (pruned > 0)
        log.info({ crawls: pruned }, 'older crawl results moved to the compact history')
      // Old crawl results pruned to their compact history can leave the file mostly empty.
      const freed = await db.compact()
      if (freed !== null) log.info({ freedMb: Math.round(freed / 1048576) }, 'database compacted')
    } else {
      log.info('RUN_MIGRATIONS=false, skipping migrations')
    }
  } finally {
    await db.close()
  }
}
