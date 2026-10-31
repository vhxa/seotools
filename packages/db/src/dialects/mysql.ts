import { randomUUID } from 'node:crypto'
import { and, desc, eq, gte, inArray, lt, lte, sql } from 'drizzle-orm'
import { drizzle } from 'drizzle-orm/mysql2'
import { migrate } from 'drizzle-orm/mysql2/migrator'
import mysql from 'mysql2/promise'
import { CREDENTIAL_PROVIDER, EMPTY_COUNTS, toJob, truncateError } from '../mapping'
import * as schema from '../schema/mysql'
import type { Database } from '../types'

const { jobs, workerHeartbeats, settings, user, account } = schema

/** mysql2 resolves writes to `[ResultSetHeader, …]`. */
const affected = (res: unknown) => (res as [{ affectedRows: number }])[0].affectedRows

export function createMysqlDatabase(options: {
  url: string
  defaultMigrationsDir: () => string
}): Database {
  const pool = mysql.createPool({ uri: options.url, connectionLimit: 10 })
  const db = drizzle(pool, { schema, mode: 'default' })

  return {
    dialect: 'mysql',
    orm: {
      db,
      schema: { user, session: schema.session, account, verification: schema.verification },
    },

    async ping() {
      await db.execute(sql`select 1`)
    },

    async migrate(dir) {
      await migrate(db, { migrationsFolder: dir ?? options.defaultMigrationsDir() })
    },

    async close() {
      await pool.end()
    },

    jobs: {
      async enqueue(input) {
        const now = new Date()
        const id = randomUUID()
        await db.insert(jobs).values({
          id,
          type: input.type,
          payload: JSON.stringify(input.payload ?? {}),
          runAt: input.runAt ?? now,
          ...(input.maxAttempts ? { maxAttempts: input.maxAttempts } : {}),
          createdAt: now,
          updatedAt: now,
        })
        const [row] = await db.select().from(jobs).where(eq(jobs.id, id))
        return toJob(row!)
      },

      async get(id) {
        const [row] = await db.select().from(jobs).where(eq(jobs.id, id))
        return row ? toJob(row) : null
      },

      async list({ limit = 20, status } = {}) {
        const rows = await db
          .select()
          .from(jobs)
          .where(status ? eq(jobs.status, status) : undefined)
          .orderBy(desc(jobs.createdAt))
          .limit(limit)
        return rows.map(toJob)
      },

      async countByStatus() {
        const rows = await db
          .select({ status: jobs.status, count: sql<number>`count(*)` })
          .from(jobs)
          .groupBy(jobs.status)
        const counts = { ...EMPTY_COUNTS }
        for (const r of rows) counts[r.status] = Number(r.count)
        return counts
      },

      async claim({ workerId, limit, now = new Date() }) {
        // FOR UPDATE SKIP LOCKED (MySQL 8+, MariaDB 10.6+) under READ COMMITTED: no gap locks, so
        // concurrent workers get disjoint rows instead of blocking each other's ranges.
        const claimed = await db.transaction(
          async (tx) => {
            // FORCE INDEX matters: without table statistics MySQL picks a full scan + filesort,
            // which row-locks *every* pending job and starves the other workers. drizzle 0.45 has
            // no index hints yet, so the locking read is raw SQL (conditions still use drizzle's
            // column encoders, so dates are serialized consistently).
            const [idRows] = (await tx.execute(
              sql`select ${jobs.id} as id from ${jobs} force index (jobs_claim_idx)
                where ${and(eq(jobs.status, 'pending'), lte(jobs.runAt, now))}
                order by ${jobs.runAt}, ${jobs.createdAt} limit ${limit}
                for update skip locked`,
            )) as unknown as [{ id: string }[]]
            const ids = idRows.map((r) => r.id)
            if (ids.length === 0) return []
            const byId = new Map(
              (await tx.select().from(jobs).where(inArray(jobs.id, ids))).map((r) => [r.id, r]),
            )
            const due = ids.map((id) => byId.get(id)!)
            const out = []
            for (const row of due) {
              const patch = {
                status: 'running' as const,
                attempts: row.attempts + 1,
                lockedAt: now,
                lockedBy: workerId,
                updatedAt: now,
              }
              await tx.update(jobs).set(patch).where(eq(jobs.id, row.id))
              out.push({ ...row, ...patch })
            }
            return out
          },
          { isolationLevel: 'read committed' },
        )
        return claimed.map(toJob)
      },

      async complete({ id, workerId, result }) {
        await db
          .update(jobs)
          .set({
            status: 'completed',
            result: result === undefined ? null : JSON.stringify(result),
            lastError: null,
            lockedAt: null,
            lockedBy: null,
            updatedAt: new Date(),
          })
          .where(and(eq(jobs.id, id), eq(jobs.status, 'running'), eq(jobs.lockedBy, workerId)))
      },

      async fail({ id, workerId, error, retryAt }) {
        await db
          .update(jobs)
          .set({
            status: retryAt ? 'pending' : 'failed',
            ...(retryAt ? { runAt: retryAt } : {}),
            lastError: truncateError(error),
            lockedAt: null,
            lockedBy: null,
            updatedAt: new Date(),
          })
          .where(and(eq(jobs.id, id), eq(jobs.status, 'running'), eq(jobs.lockedBy, workerId)))
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
        return db.transaction(async (tx) => {
          const failed = await tx
            .update(jobs)
            .set({ ...reset, status: 'failed' })
            .where(and(stale, gte(jobs.attempts, jobs.maxAttempts)))
          const requeued = await tx
            .update(jobs)
            .set({ ...reset, status: 'pending', runAt: now })
            .where(stale)
          return affected(failed) + affected(requeued)
        })
      },
    },

    heartbeats: {
      async beat({ workerId, startedAt, now = new Date() }) {
        await db
          .insert(workerHeartbeats)
          .values({ workerId, startedAt, lastSeenAt: now })
          .onDuplicateKeyUpdate({ set: { lastSeenAt: now } })
        await db
          .delete(workerHeartbeats)
          .where(lt(workerHeartbeats.lastSeenAt, new Date(now.getTime() - 24 * 3600_000)))
      },
      async latest() {
        const [row] = await db
          .select()
          .from(workerHeartbeats)
          .orderBy(desc(workerHeartbeats.lastSeenAt))
          .limit(1)
        return row ?? null
      },
    },

    settings: {
      async get(key) {
        const [row] = await db.select().from(settings).where(eq(settings.key, key))
        return row ? { value: row.value, encrypted: row.encrypted } : null
      },
      async set(key, value, encrypted) {
        const updatedAt = new Date()
        await db
          .insert(settings)
          .values({ key, value, encrypted, updatedAt })
          .onDuplicateKeyUpdate({ set: { value, encrypted, updatedAt } })
      },
      async delete(key) {
        await db.delete(settings).where(eq(settings.key, key))
      },
    },

    admin: {
      async findByEmail(email) {
        const [found] = await db.select().from(user).where(eq(user.email, email))
        if (!found) return null
        const [cred] = await db
          .select({ password: account.password })
          .from(account)
          .where(and(eq(account.userId, found.id), eq(account.providerId, CREDENTIAL_PROVIDER)))
        return { id: found.id, email: found.email, passwordHash: cred?.password ?? null }
      },
      async create({ id, email, name, passwordHash }) {
        await db.transaction(async (tx) => {
          await tx.insert(user).values({ id, email, name, emailVerified: true })
          await tx.insert(account).values({
            id: randomUUID(),
            accountId: id,
            providerId: CREDENTIAL_PROVIDER,
            userId: id,
            password: passwordHash,
          })
        })
      },
      async exists() {
        const rows = await db.select({ id: user.id }).from(user).limit(1)
        return rows.length > 0
      },
    },
  }
}
