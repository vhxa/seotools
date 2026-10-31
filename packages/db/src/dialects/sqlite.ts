import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import BetterSqlite3 from 'better-sqlite3'
import { and, asc, desc, eq, gte, lt, lte, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from 'drizzle-orm/better-sqlite3/migrator'
import { sqlitePathFromUrl } from '../dialect'
import { CREDENTIAL_PROVIDER, EMPTY_COUNTS, toJob, truncateError } from '../mapping'
import * as schema from '../schema/sqlite'
import type { Database } from '../types'

const { jobs, workerHeartbeats, settings, user, account } = schema

export function createSqliteDatabase(options: {
  url: string
  defaultMigrationsDir: () => string
}): Database {
  const path = sqlitePathFromUrl(options.url)
  if (path !== ':memory:') mkdirSync(dirname(resolve(path)), { recursive: true })

  const sqlite = new BetterSqlite3(path)
  // WAL lets the web app read while the worker writes; busy_timeout absorbs short write contention.
  sqlite.pragma('journal_mode = WAL')
  sqlite.pragma('busy_timeout = 5000')
  sqlite.pragma('foreign_keys = ON')
  sqlite.pragma('synchronous = NORMAL')

  const db = drizzle(sqlite, { schema })

  return {
    dialect: 'sqlite',
    orm: {
      db,
      schema: { user, session: schema.session, account, verification: schema.verification },
    },

    async ping() {
      sqlite.prepare('select 1').get()
    },

    async migrate(dir) {
      migrate(db, { migrationsFolder: dir ?? options.defaultMigrationsDir() })
    },

    async close() {
      sqlite.close()
    },

    jobs: {
      async enqueue(input) {
        const now = new Date()
        const [row] = db
          .insert(jobs)
          .values({
            id: randomUUID(),
            type: input.type,
            payload: JSON.stringify(input.payload ?? {}),
            runAt: input.runAt ?? now,
            ...(input.maxAttempts ? { maxAttempts: input.maxAttempts } : {}),
            createdAt: now,
            updatedAt: now,
          })
          .returning()
          .all()
        return toJob(row!)
      },

      async get(id) {
        const row = db.select().from(jobs).where(eq(jobs.id, id)).get()
        return row ? toJob(row) : null
      },

      async list({ limit = 20, status } = {}) {
        const rows = db
          .select()
          .from(jobs)
          .where(status ? eq(jobs.status, status) : undefined)
          .orderBy(desc(jobs.createdAt))
          .limit(limit)
          .all()
        return rows.map(toJob)
      },

      async countByStatus() {
        const rows = db
          .select({ status: jobs.status, count: sql<number>`count(*)` })
          .from(jobs)
          .groupBy(jobs.status)
          .all()
        const counts = { ...EMPTY_COUNTS }
        for (const r of rows) counts[r.status] = Number(r.count)
        return counts
      },

      async claim({ workerId, limit, now = new Date() }) {
        // IMMEDIATE takes the write lock up front, so two workers can never claim the same row.
        const claimed = db.transaction(
          (tx) => {
            const due = tx
              .select()
              .from(jobs)
              .where(and(eq(jobs.status, 'pending'), lte(jobs.runAt, now)))
              .orderBy(asc(jobs.runAt), asc(jobs.createdAt))
              .limit(limit)
              .all()
            return due.map((row) => {
              const patch = {
                status: 'running' as const,
                attempts: row.attempts + 1,
                lockedAt: now,
                lockedBy: workerId,
                updatedAt: now,
              }
              tx.update(jobs).set(patch).where(eq(jobs.id, row.id)).run()
              return { ...row, ...patch }
            })
          },
          { behavior: 'immediate' },
        )
        return claimed.map(toJob)
      },

      async complete({ id, workerId, result }) {
        const now = new Date()
        db.update(jobs)
          .set({
            status: 'completed',
            result: result === undefined ? null : JSON.stringify(result),
            lastError: null,
            lockedAt: null,
            lockedBy: null,
            updatedAt: now,
          })
          .where(and(eq(jobs.id, id), eq(jobs.status, 'running'), eq(jobs.lockedBy, workerId)))
          .run()
      },

      async fail({ id, workerId, error, retryAt }) {
        db.update(jobs)
          .set({
            status: retryAt ? 'pending' : 'failed',
            ...(retryAt ? { runAt: retryAt } : {}),
            lastError: truncateError(error),
            lockedAt: null,
            lockedBy: null,
            updatedAt: new Date(),
          })
          .where(and(eq(jobs.id, id), eq(jobs.status, 'running'), eq(jobs.lockedBy, workerId)))
          .run()
      },

      async requeueStale({ lockedBefore }) {
        const now = new Date()
        const stale = and(eq(jobs.status, 'running'), lt(jobs.lockedAt, lockedBefore))
        const reset = {
          lockedAt: null,
          lockedBy: null,
          lastError: 'Worker lock expired',
          updatedAt: now,
        }
        return db.transaction((tx) => {
          const failed = tx
            .update(jobs)
            .set({ ...reset, status: 'failed' })
            .where(and(stale, gte(jobs.attempts, jobs.maxAttempts)))
            .run().changes
          const requeued = tx
            .update(jobs)
            .set({ ...reset, status: 'pending', runAt: now })
            .where(stale)
            .run().changes
          return failed + requeued
        })
      },
    },

    heartbeats: {
      async beat({ workerId, startedAt, now = new Date() }) {
        db.insert(workerHeartbeats)
          .values({ workerId, startedAt, lastSeenAt: now })
          .onConflictDoUpdate({ target: workerHeartbeats.workerId, set: { lastSeenAt: now } })
          .run()
        db.delete(workerHeartbeats)
          .where(lt(workerHeartbeats.lastSeenAt, new Date(now.getTime() - 24 * 3600_000)))
          .run()
      },
      async latest() {
        const row = db
          .select()
          .from(workerHeartbeats)
          .orderBy(desc(workerHeartbeats.lastSeenAt))
          .limit(1)
          .get()
        return row ?? null
      },
    },

    settings: {
      async get(key) {
        const row = db.select().from(settings).where(eq(settings.key, key)).get()
        return row ? { value: row.value, encrypted: row.encrypted } : null
      },
      async set(key, value, encrypted) {
        const updatedAt = new Date()
        db.insert(settings)
          .values({ key, value, encrypted, updatedAt })
          .onConflictDoUpdate({ target: settings.key, set: { value, encrypted, updatedAt } })
          .run()
      },
      async delete(key) {
        db.delete(settings).where(eq(settings.key, key)).run()
      },
    },

    admin: {
      async findByEmail(email) {
        const found = db.select().from(user).where(eq(user.email, email)).get()
        if (!found) return null
        const cred = db
          .select({ password: account.password })
          .from(account)
          .where(and(eq(account.userId, found.id), eq(account.providerId, CREDENTIAL_PROVIDER)))
          .get()
        return { id: found.id, email: found.email, passwordHash: cred?.password ?? null }
      },
      async create({ id, email, name, passwordHash }) {
        db.transaction((tx) => {
          tx.insert(user).values({ id, email, name, emailVerified: true }).run()
          tx.insert(account)
            .values({
              id: randomUUID(),
              accountId: id,
              providerId: CREDENTIAL_PROVIDER,
              userId: id,
              password: passwordHash,
            })
            .run()
        })
      },
      async exists() {
        return db.select({ id: user.id }).from(user).limit(1).get() !== undefined
      },
    },
  }
}
