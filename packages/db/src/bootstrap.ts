import { createLogger, type BootstrapEnv } from '@seotools/core'
import { createDatabase } from './client'

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
    } else {
      log.info('RUN_MIGRATIONS=false, skipping migrations')
    }
  } finally {
    await db.close()
  }
}
