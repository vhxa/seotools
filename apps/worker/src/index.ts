import { hostname } from 'node:os'
import { randomBytes } from 'node:crypto'
import {
  EnvError,
  WORKER_HEARTBEAT_INTERVAL_MS,
  createLogger,
  createSettings,
  getMailer,
  parseWorkerEnv,
  settingsKeyFrom,
} from '@seotools/core'
import { createDatabase } from '@seotools/db'
import { handlers } from './handlers'
import { createRunner } from './runner'

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

  const runner = createRunner({
    db,
    handlers,
    workerId,
    log,
    getMailer: () => getMailer(settings),
    concurrency: env.WORKER_CONCURRENCY,
    pollIntervalMs: env.WORKER_POLL_INTERVAL_MS,
    lockTimeoutMs: env.JOB_LOCK_TIMEOUT_MS,
  })
  runner.start()

  let stopping = false
  const shutdown = async (signal: string) => {
    if (stopping) return
    stopping = true
    log.info({ signal }, 'shutting down')
    clearInterval(heartbeat)
    await runner.stop()
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
