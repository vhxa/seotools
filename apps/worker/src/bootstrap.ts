import { EnvError, parseBootstrapEnv } from '@seotools/core'
import { bootstrap } from '@seotools/db'

// Runs before the app starts (see docker/entrypoint.mjs): applies database migrations.
try {
  await bootstrap(parseBootstrapEnv())
} catch (error) {
  console.error(error instanceof EnvError ? error.message : error)
  process.exit(1)
}
