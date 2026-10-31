import { createLogger, type BootstrapEnv } from '@seotools/core'
import { ensureAdmin } from './admin'
import { createDatabase } from './client'

/** Runs on every start: apply migrations, then sync the admin user with the environment. */
export async function bootstrap(env: BootstrapEnv) {
  const log = createLogger('bootstrap', env.LOG_LEVEL)
  const db = await createDatabase({ url: env.DATABASE_URL, dialect: env.DATABASE_DIALECT })
  try {
    if (env.RUN_MIGRATIONS) {
      await db.migrate()
      log.info({ dialect: db.dialect }, 'migrations applied')
    } else {
      log.info('RUN_MIGRATIONS=false, skipping migrations')
    }
    const result = await ensureAdmin(db, {
      email: env.ADMIN_EMAIL,
      password: env.ADMIN_PASSWORD,
      name: env.ADMIN_NAME,
    })
    log.info(result, 'admin user in sync')
  } finally {
    await db.close()
  }
}
