import { WORKER_STALE_AFTER_MS } from '@seotools/core'
import type { Database } from '@seotools/db'

export type HealthStatus = 'ok' | 'degraded' | 'down'

export interface HealthReport {
  status: HealthStatus
  version: string
  db: { ok: boolean; dialect: string | null }
  worker: { ok: boolean; lastSeen: string | null }
}

/**
 * - `down` (HTTP 503): the database is unreachable.
 * - `degraded` (HTTP 200): the web app works but no worker has checked in recently. With
 *   `requireWorker` (used by the all-in-one Docker healthcheck) this is also a 503.
 */
export async function getHealth(
  getDatabase: () => Promise<Database>,
  options: { requireWorker?: boolean; now?: Date; version?: string } = {},
): Promise<{ httpStatus: 200 | 503; report: HealthReport }> {
  const now = options.now ?? new Date()
  const version = options.version ?? process.env.APP_VERSION ?? 'unknown'

  let db: Database | null = null
  let dbOk = false
  try {
    db = await getDatabase()
    await db.ping()
    dbOk = true
  } catch {
    // Details stay in the server logs; this endpoint is public.
  }

  let lastSeen: Date | null = null
  if (db && dbOk) {
    try {
      lastSeen = (await db.heartbeats.latest())?.lastSeenAt ?? null
    } catch {
      dbOk = false
    }
  }
  const workerOk = lastSeen !== null && now.getTime() - lastSeen.getTime() <= WORKER_STALE_AFTER_MS

  const status: HealthStatus = !dbOk ? 'down' : workerOk ? 'ok' : 'degraded'
  const unhealthy = status === 'down' || (status === 'degraded' && options.requireWorker)

  return {
    httpStatus: unhealthy ? 503 : 200,
    report: {
      status,
      version,
      db: { ok: dbOk, dialect: db?.dialect ?? null },
      worker: { ok: workerOk, lastSeen: lastSeen?.toISOString() ?? null },
    },
  }
}
