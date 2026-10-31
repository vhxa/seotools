import { createDatabase, type Database } from '@seotools/db'
import { getEnv } from './env'

// Keep one connection per process, even across dev hot reloads.
const globalForDb = globalThis as unknown as { __seotoolsDb?: Promise<Database> }

export function getDb(): Promise<Database> {
  if (!globalForDb.__seotoolsDb) {
    const env = getEnv()
    globalForDb.__seotoolsDb = createDatabase({
      url: env.DATABASE_URL,
      dialect: env.DATABASE_DIALECT,
    }).catch((error) => {
      globalForDb.__seotoolsDb = undefined // allow a retry on the next request
      throw error
    })
  }
  return globalForDb.__seotoolsDb
}
