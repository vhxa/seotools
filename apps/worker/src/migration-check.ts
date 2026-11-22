import type { Logger } from '@seotools/core'
import { isUnknownMigrationError, type Database } from '@seotools/db'

const CHECK_INTERVAL_MS = 30_000

/** Share one check across all lanes and periodic tasks. An outdated worker must be replaced. */
export function createMigrationCheck(db: Pick<Database, 'checkMigrations'>, log: Logger) {
  let nextCheck = 0
  let pending: Promise<boolean> | undefined
  let outdated = false
  let canWork = false

  async function refresh() {
    try {
      await db.checkMigrations()
      canWork = true
    } catch (err) {
      canWork = false
      outdated = isUnknownMigrationError(err)
      if (outdated) log.error({ err }, 'worker is outdated and will no longer start work')
      else log.error({ err }, 'could not check migrations; pausing new work until the next check')
    }
    return canWork
  }

  return {
    canStart() {
      if (outdated || Date.now() < nextCheck) return Promise.resolve(canWork)
      return (pending ??= refresh().finally(() => {
        nextCheck = Date.now() + CHECK_INTERVAL_MS
        pending = undefined
      }))
    },
    isOutdated: () => outdated,
  }
}
